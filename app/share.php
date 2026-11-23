<?php
// 179-я (власник 23.11): спільна квартира — одну квартиру ведуть кілька людей: власник житла й орендар, батьки й діти, члени родини,
// тестові акаунти. Хто створив квартиру (власник) запрошує й прибирає людей; учасники вносять показання, позначають оплату, бачать історію.
//
// Як живуть дані. У кожної людини — свій стан (user_state, один JSON). Спільна квартира лежить копією в стані кожного учасника — зі своїм
// id квартири (у власника — його, у решти — «sh<номер>»). Після кожного збереження будь-кого (PUT /api/state) і щохвилини (cron, якщо
// стан когось змінив робот) сервер зводить копії: записи показань (readings, water, mrecs) — за id, новіший за updatedAt; поля квартири —
// кожне окремо, новіше за міткою _kt[поле] (ставить застосунок при зміні, sync.js зливає так само). Особисте — назва, колір, значок,
// «нагадування для цієї квартири» — у кожного своє, не зводиться (PERSONAL). Кабінети постачальників і паролі — лише у того, хто підключив.
//
// Запрошення: посилання (будь-який месенджер, QR), лист на e-mail, у Telegram — бот з кнопкою «Приєднатися». Токен — 18 випадкових байт,
// у базі лише sha256; діє 7 днів, на одну людину; власник бачить і скасовує. Лист на e-mail — сам собі вхід (людина без акаунта
// приєднується без пароля: посилання прийшло на її пошту).
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Share {
  const TTL = 7 * 86400;          // запрошення діє 7 днів
  const MAX_PEOPLE = 8;           // людей у квартирі разом із власником
  const MAX_INVITES = 10;         // активних запрошень на квартиру
  /** Поля квартири, які в кожного учасника свої (не зводяться між людьми). */
  // 180-я (власник 23.11: «со мной пошарили квартиру — у меня „Квартира 4“, у владельца „Моя квартира“, название должно быть одинаковое у всех»): назва — спільна
  const RULES = 2;   // версія правил зведення (2 — 180-я: спільна назва); shares.rv менше — cron зводить ще раз
  const PERSONAL = ['id', 'color', 'icon', 'deleted', 'updatedAt', '_kt', 'sh', 'gpvTg', 'remindOff', 'v'];
  const RECS = ['readings', 'water', 'mrecs'];
  /** Тести: підміна часу (мс) для детермінованих міток. */
  public static ?int $nowMs = null;

  private static function table(): void {
    static $done = false; if ($done) return; $done = true;
    $my = Db::driver() !== 'sqlite'; $ai = $my ? 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'; $tail = $my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    $pdo = Db::pdo();
    $pdo->exec("CREATE TABLE IF NOT EXISTS shares (id $ai, owner_id INT NOT NULL, created_at VARCHAR(25) NOT NULL, synced_at INT NOT NULL DEFAULT 0)$tail");
    $pdo->exec("CREATE TABLE IF NOT EXISTS share_members (share_id INT NOT NULL, user_id INT NOT NULL, pid VARCHAR(40) NOT NULL, role VARCHAR(8) NOT NULL, name VARCHAR(80) NULL, joined_at VARCHAR(25) NOT NULL, ver INT NOT NULL DEFAULT 0, PRIMARY KEY (share_id, user_id))$tail");
    $pdo->exec("CREATE TABLE IF NOT EXISTS share_invites (id $ai, share_id INT NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, by_user INT NOT NULL, email VARCHAR(190) NULL, via VARCHAR(8) NOT NULL, lang CHAR(2) NOT NULL DEFAULT 'uk', created_at INT NOT NULL, expires_at INT NOT NULL, used_by INT NULL, used_at INT NULL, revoked TINYINT NOT NULL DEFAULT 0)$tail");
    $pdo->exec('CREATE INDEX IF NOT EXISTS ix_share_members_user ON share_members (user_id)');
    // 180-я: rv — за якими правилами зведено (cron зводить ще раз старіші), bg — власник дозволив учасникам «у фоні» через свої кабінети
    foreach (['rv' => 'INT NOT NULL DEFAULT 0', 'bg' => 'TINYINT NOT NULL DEFAULT 0', 'bg_at' => 'INT NULL'] as $c => $def) {
      $has = false;
      if (!$my) { foreach ($pdo->query('PRAGMA table_info(shares)')->fetchAll() as $col) if (($col['name'] ?? '') === $c) $has = true; }
      else $has = (bool)$pdo->query("SHOW COLUMNS FROM shares LIKE '$c'")->fetch();
      if (!$has) $pdo->exec("ALTER TABLE shares ADD COLUMN $c $def");
    }
  }
  private static function ms(): int { return self::$nowMs ?? (int)round(microtime(true) * 1000); }

  // ---------------------------------------------------------------- хто є хто
  /** Як людину бачать інші: ім'я з учасника, з акаунта (Telegram), частина e-mail до «@», нік Telegram. */
  public static function nameOf(int $uid, ?string $own = null): string {
    if ($own !== null && trim($own) !== '') return mb_substr(trim($own), 0, 60);
    $u = Db::one('SELECT name, email FROM users WHERE id = ?', [$uid]) ?? [];
    if (trim((string)($u['name'] ?? '')) !== '') return mb_substr(trim((string)$u['name']), 0, 60);
    if (!empty($u['email'])) return mb_substr(explode('@', (string)$u['email'])[0], 0, 60);
    $tg = Db::one("SELECT username FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$uid]);
    return $tg && $tg['username'] ? '@' . $tg['username'] : '';
  }
  private static function members(int $sid): array {
    self::table();
    return Db::q("SELECT * FROM share_members WHERE share_id = ? ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, joined_at, user_id", [$sid])->fetchAll();
  }
  /** Чи ділять двоє людей хоч одну квартиру (фото й платіжки записів спільної квартири — видно всім її учасникам). */
  public static function together(int $a, int $b): bool {
    if ($a <= 0 || $b <= 0) return false; if ($a === $b) return true;
    try { self::table(); return (bool)Db::one('SELECT 1 AS x FROM share_members m1 JOIN share_members m2 ON m2.share_id = m1.share_id WHERE m1.user_id = ? AND m2.user_id = ?', [$a, $b]); }
    catch (Throwable $e) { return false; }
  }

  // ---------------------------------------------------------------- стан людини
  private static function load(int $uid): ?array {
    $row = Db::one('SELECT data, version, updated_at FROM user_state WHERE user_id = ?', [$uid]); if (!$row) return null;
    $st = json_decode((string)$row['data']);   // об'єктами: порожні {} лишаються {} (150-а)
    return is_object($st) ? ['st' => $st, 'ver' => (int)$row['version'], 'raw' => (string)$row['data'], 'at' => (string)$row['updated_at']] : null;
  }
  /** Записати стан, якщо версія та сама (інакше — false: хтось устиг раніше, зведення повториться). Минула версія — в історію (StateHist). */
  private static function store(int $uid, ?array $cur, object $st, string $why): bool {
    $json = json_encode($st, JSON_UNESCAPED_UNICODE); if ($json === false) return false;
    if ($cur === null) {
      try { Db::q('INSERT INTO user_state (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)', [$uid, $json, Http::iso()]); return true; }
      catch (PDOException $e) { return false; }
    }
    if ($json === $cur['raw']) return true;
    if (Db::q('UPDATE user_state SET data = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?', [$json, Http::iso(), $uid, $cur['ver']])->rowCount() !== 1) return false;
    if (class_exists('StateHist')) try { StateHist::put($uid, $cur['raw'], $cur['ver'], $cur['at'], $why); } catch (Throwable $e) { /* історія — не головне */ }
    return true;
  }
  private static function places(object $st): array { return isset($st->places) && is_array($st->places) ? $st->places : []; }
  private static function placeIn(object $st, string $pid, bool $live = true): ?object {
    foreach (self::places($st) as $p) if (is_object($p) && ($p->id ?? null) === $pid && (!$live || empty($p->deleted))) return $p;
    return null;
  }
  /** Перша квартира як у застосунку (RD: записи без place — першої в списку, навіть видаленої). */
  private static function first(object $st): string { $ps = self::places($st); return isset($ps[0]) && is_object($ps[0]) && isset($ps[0]->id) ? (string)$ps[0]->id : 'main'; }
  private static function recIn(object $r, string $pid, string $first): bool { return is_object($r) && isset($r->id) && (string)($r->place ?? $first) === $pid; }

  /** Час зміни поля квартири: мітка _kt[поле]; квартира без _kt (стара версія застосунку) — час усієї квартири. */
  private static function tk(object $p, string $k): float {
    $kt = $p->_kt ?? null;
    if (is_object($kt)) return isset($kt->$k) && is_numeric($kt->$k) ? (float)$kt->$k : 0.0;
    if (is_array($kt)) return isset($kt[$k]) && is_numeric($kt[$k]) ? (float)$kt[$k] : 0.0;
    return is_numeric($p->updatedAt ?? null) ? (float)$p->updatedAt : 0.0;
  }
  private static function rt(object $r): float {
    if (is_numeric($r->updatedAt ?? null) && (float)$r->updatedAt > 0) return (float)$r->updatedAt;
    $t = strtotime((string)($r->createdAt ?? '')); return $t ? $t * 1000.0 : 0.0;
  }
  private static function dup($v) { return $v === null || is_scalar($v) ? $v : json_decode(json_encode($v, JSON_UNESCAPED_UNICODE)); }
  /** Підпис значення без різниці в порядку ключів ({} і [] — різні). */
  private static function canon($v) {
    if (is_object($v)) { $a = get_object_vars($v); ksort($a); $o = []; foreach ($a as $k => $x) $o[$k] = self::canon($x); return ['{}' => $o]; }
    if (is_array($v)) return array_map([self::class, 'canon'], $v);
    return $v;
  }
  private static function sig($v): string { return md5((string)json_encode(self::canon($v), JSON_UNESCAPED_UNICODE)); }

  // ---------------------------------------------------------------- зведення копій
  /** Звести спільну квартиру sid між учасниками. → скільки станів переписано (-1 — квартиру розпущено). */
  public static function sync(int $sid, string $why = 'share'): int {
    self::table();
    for ($try = 0; $try < 4; $try++) {
      $ms = self::members($sid); if (!$ms) return 0;
      $owner = null; foreach ($ms as $m) if ($m['role'] === 'owner') $owner = $m;
      if (!$owner) { self::dissolve($sid, 0, 'no_owner'); return -1; }
      $cur = []; $parts = [];
      foreach ($ms as $m) {
        $uid = (int)$m['user_id']; $c = self::load($uid); $cur[$uid] = $c;
        $p = $c ? self::placeIn($c['st'], (string)$m['pid']) : null;
        if (!$p) {   // квартиру видалили (чи «стерли все»): власник — розпускаємо для всіх; учасник — він вийшов
          if ($m['role'] === 'owner') { self::dissolve($sid, $uid, 'deleted'); return -1; }
          self::drop($sid, $uid, false, 'left'); continue 2;
        }
        $first = self::first($c['st']); $recs = [];
        foreach (self::RECS as $rk) { $recs[$rk] = []; foreach ((isset($c['st']->$rk) && is_array($c['st']->$rk) ? $c['st']->$rk : []) as $r) if (self::recIn($r, (string)$m['pid'], $first)) $recs[$rk][] = $r; }
        $parts[] = ['m' => $m, 'p' => $p, 'recs' => $recs];
      }
      [$u, $ukt] = self::unionPlace(array_map(fn($x) => $x['p'], $parts));
      // назви ніхто не давав — та, яку бачить власник («Моя квартира» / «Квартира 3»), стає назвою для всіх; мітка 1 — будь-яке перейменування сильніше
      if (trim((string)($u->name ?? '')) === '') { $u->name = self::ownLabel($cur[(int)$owner['user_id']]['st'] ?? null, (string)$owner['pid']); $ukt->name = max(1, (int)($ukt->name ?? 0)); }
      $urecs = self::unionRecs(array_map(fn($x) => $x['recs'], $parts));
      $ppl = []; foreach ($ms as $m) $ppl[(string)$m['user_id']] = self::nameOf((int)$m['user_id'], $m['name']);
      $oname = $ppl[(string)$owner['user_id']] ?? ''; $sbg = (int)(Db::one('SELECT bg FROM shares WHERE id = ?', [$sid])['bg'] ?? 0);
      $wrote = 0; $lost = false;
      foreach ($parts as $x) {
        $m = $x['m']; $uid = (int)$m['user_id']; $c = $cur[$uid]; $st = $c['st']; $pid = (string)$m['pid'];
        $sh = (object)['sid' => $sid, 'role' => $m['role'], 'me' => $uid, 'n' => count($ms), 'own' => $oname, 'ownId' => (int)$owner['user_id'], 'ppl' => (object)$ppl, 'at' => (int)(strtotime((string)$m['joined_at']) ?: time()) * 1000]; if ($sbg) $sh->bg = 1;
        $old = $x['p'];
        $np = new stdClass;
        foreach (self::PERSONAL as $k) if (property_exists($old, $k)) $np->$k = $old->$k;
        foreach (get_object_vars($u) as $k => $v) $np->$k = self::dup($v);
        $np->id = $pid;
        $kt = new stdClass;
        $okt = $old->_kt ?? null; if (is_object($okt) || is_array($okt)) foreach ((array)$okt as $k => $v) if (in_array($k, self::PERSONAL, true) && is_numeric($v)) $kt->$k = $v;
        foreach (get_object_vars($ukt) as $k => $v) $kt->$k = $v;
        $chSh = self::sig($old->sh ?? null) !== self::sig($sh);
        $np->sh = $sh; if ($chSh) $kt->sh = self::ms();
        elseif (isset($kt->sh) === false && is_object($okt) && isset($okt->sh)) $kt->sh = $okt->sh;
        $np->_kt = $kt;
        $mx = 0.0; foreach (get_object_vars($ukt) as $v) $mx = max($mx, (float)$v);
        $np->updatedAt = (int)max((float)($old->updatedAt ?? 0), $mx, $chSh ? (float)$kt->sh : 0);
        // записи: свої з інших квартир — як є; спільні — зведені (place — id квартири цієї людини)
        $first = self::first($st); $same = self::sigPlace($old) === self::sigPlace($np) && !$chSh;
        $nrecs = [];
        foreach (self::RECS as $rk) {
          $mine = []; foreach ($x['recs'][$rk] as $r) $mine[(string)$r->id] = $r;
          $list = []; $keep = isset($st->$rk) && is_array($st->$rk) ? $st->$rk : [];
          foreach ($keep as $r) if (!self::recIn($r, $pid, $first)) $list[] = $r;
          foreach ($urecs[$rk] as $id => $r) {
            if (isset($mine[$id]) && self::sigRec($mine[$id]) === self::sigRec($r)) { $list[] = $mine[$id]; continue; }
            $same = false; $cr = self::dup($r); if ((string)($cr->place ?? $first) !== $pid) $cr->place = $pid; $list[] = $cr;
          }
          if (count($mine) !== count($urecs[$rk])) $same = false;
          $nrecs[$rk] = $list;
        }
        if ($same) continue;
        $ns = self::dup($st);
        foreach (self::RECS as $rk) $ns->$rk = self::dup($nrecs[$rk]);
        $pl = []; foreach (self::places($ns) as $p) $pl[] = is_object($p) && ($p->id ?? null) === $pid && empty($p->deleted) ? $np : $p; $ns->places = $pl;
        $ns->updatedAt = max((int)($ns->updatedAt ?? 0), (int)$np->updatedAt);
        if (!self::store($uid, $c, $ns, $why)) { $lost = true; break; }
        $wrote++;
      }
      if ($lost) continue;   // хтось записав посеред зведення — ще раз
      foreach ($ms as $m) { $v = Db::one('SELECT version FROM user_state WHERE user_id = ?', [(int)$m['user_id']]); Db::q('UPDATE share_members SET ver = ? WHERE share_id = ? AND user_id = ?', [(int)($v['version'] ?? 0), $sid, (int)$m['user_id']]); }
      Db::q('UPDATE shares SET synced_at = ?, rv = ? WHERE id = ?', [time(), self::RULES, $sid]);
      return $wrote;
    }
    return 0;
  }
  private static function sigPlace(object $p): string { $c = self::dup($p); unset($c->updatedAt); return self::sig($c); }
  private static function sigRec(object $r): string { $c = self::dup($r); unset($c->place); return self::sig($c); }
  /** Назва квартири так, як її показує застосунок власника без назви: перша — «Моя квартира», інші — «Квартира N» (pl_mine / pl_unnamed, однаково uk і ru). */
  private static function ownLabel(?object $st, string $pid): string {
    $i = 0; foreach ($st ? self::places($st) : [] as $q) { if (!is_object($q) || !empty($q->deleted)) continue; if ((string)($q->id ?? '') === $pid) break; $i++; }
    return $i === 0 ? 'Моя квартира' : 'Квартира ' . ($i + 1);
  }
  /** Поля квартири: кожне — від того, хто змінив його останнім (_kt); рівно — від того, чия квартира новіша; далі — власник (перший).
   *  Назва при рівних мітках — непорожня, далі власника: копія учасника, створена порожньою, не стирає назву власника. */
  private static function unionPlace(array $ps): array {
    $keys = [];
    foreach ($ps as $p) {
      foreach (get_object_vars($p) as $k => $_) if (!in_array($k, self::PERSONAL, true)) $keys[$k] = 1;
      $kt = $p->_kt ?? null; if (is_object($kt) || is_array($kt)) foreach ((array)$kt as $k => $_) if (!in_array((string)$k, self::PERSONAL, true)) $keys[(string)$k] = 1;
    }
    $u = new stdClass; $ukt = new stdClass;
    foreach (array_keys($keys) as $k) {
      $k = (string)$k; $best = null; $bt = -1.0; $bu = -1.0;
      if ($k === 'name') {
        foreach ($ps as $p) { $t = self::tk($p, $k); $ne = trim((string)($p->name ?? '')) !== '' ? 1.0 : 0.0; if ($t > $bt || ($t === $bt && $ne > $bu)) { $best = $p; $bt = $t; $bu = $ne; } }
      } else
      foreach ($ps as $p) { $t = self::tk($p, $k); $pu = (float)($p->updatedAt ?? 0); if ($t > $bt || ($t === $bt && $pu > $bu)) { $best = $p; $bt = $t; $bu = $pu; } }
      if ($best && property_exists($best, $k)) $u->$k = self::dup($best->$k);
      if ($bt > 0) $ukt->$k = (int)$bt;
    }
    // «Кому платите» — ще й по видах за власною міткою ts (як sync.js, 148-а)
    if (isset($u->prov) && is_object($u->prov)) foreach ($ps as $p) {
      if (!isset($p->prov) || !is_object($p->prov)) continue;
      foreach (get_object_vars($p->prov) as $kk => $a) { $c = $u->prov->$kk ?? null; if (is_object($a) && (float)($a->ts ?? 0) > (float)(is_object($c) ? ($c->ts ?? 0) : 0)) $u->prov->$kk = self::dup($a); }
    }
    return [$u, $ukt];
  }
  /** Записи показань: за id, новіший за updatedAt (як sync.js); рівно — від першого (власника). */
  private static function unionRecs(array $all): array {
    $out = [];
    foreach (self::RECS as $rk) {
      $map = [];
      foreach ($all as $recs) foreach ($recs[$rk] as $r) { $id = (string)$r->id; if (!isset($map[$id]) || self::rt($r) > self::rt($map[$id])) $map[$id] = $r; }
      uasort($map, fn($a, $b) => strcmp((string)($a->createdAt ?? ''), (string)($b->createdAt ?? '')));
      $out[$rk] = $map;
    }
    return $out;
  }

  /** Прибрати людину з квартири: її копію — «надгробком» (зникне з її списку); власнику й іншим — оновлений склад. */
  private static function drop(int $sid, int $uid, bool $tomb, string $why): void {
    $m = Db::one('SELECT * FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, $uid]); if (!$m) return;
    Db::q('DELETE FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, $uid]);
    self::unmark($uid, (string)$m['pid'], $tomb);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'share_' . $why, null, Http::iso()]);
  }
  /** Зняти з квартири людини позначку спільної (tomb — ще й видалити квартиру з її списку). */
  private static function unmark(int $uid, string $pid, bool $tomb): void {
    for ($i = 0; $i < 3; $i++) {
      $c = self::load($uid); if (!$c) return; $p = self::placeIn($c['st'], $pid, false); if (!$p) return;
      $ns = self::dup($c['st']); $now = self::ms();
      foreach (self::places($ns) as $q) if (is_object($q) && ($q->id ?? null) === $pid) {
        if (!isset($q->_kt) || !is_object($q->_kt)) $q->_kt = new stdClass;
        unset($q->sh); $q->_kt->sh = $now;
        if ($tomb) { $q->deleted = true; $q->_kt->deleted = $now; }
        $q->updatedAt = $now;
      }
      $ns->updatedAt = max((int)($ns->updatedAt ?? 0), $now);
      if (self::store($uid, $c, $ns, 'share')) return;
    }
  }
  /** Розпустити спільну квартиру: учасникам — квартира зникає (власник видалив її), власнику — знімаємо позначку. */
  public static function dissolve(int $sid, int $by, string $why): void {
    self::table();
    foreach (self::members($sid) as $m) { $uid = (int)$m['user_id']; if ($m['role'] === 'owner') self::unmark($uid, (string)$m['pid'], false); else { self::unmark($uid, (string)$m['pid'], true); self::tell($uid, 'gone', $sid, $by); } }
    Db::q('DELETE FROM share_members WHERE share_id = ?', [$sid]);
    Db::q('UPDATE share_invites SET revoked = 1 WHERE share_id = ? AND used_at IS NULL', [$sid]);
    Db::q('DELETE FROM shares WHERE id = ?', [$sid]);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$by ?: null, 'share_dissolve_' . $why, null, Http::iso()]);
  }

  /** Після збереження людини (PUT /api/state): звести всі її спільні квартири. → чи переписано її власний стан (застосунку — забрати). */
  public static function afterPut(int $uid): bool {
    try {
      self::table();
      $ver0 = (int)(Db::one('SELECT version FROM user_state WHERE user_id = ?', [$uid])['version'] ?? 0);
      foreach (Db::q('SELECT share_id FROM share_members WHERE user_id = ?', [$uid])->fetchAll() as $s) self::sync((int)$s['share_id'], 'share');
      return (int)(Db::one('SELECT version FROM user_state WHERE user_id = ?', [$uid])['version'] ?? 0) !== $ver0;
    } catch (Throwable $e) { error_log('teplo share afterPut: ' . $e->getMessage()); return false; }
  }
  /** cron: квартири, де чийсь стан змінився не через PUT (роботи ХТМ, Водоканалу, квитанції) — звести. → [[sid, записано]] */
  public static function cron(): array {
    self::table(); $out = [];
    $rows = Db::q('SELECT DISTINCT m.share_id FROM share_members m JOIN user_state s ON s.user_id = m.user_id WHERE s.version <> m.ver LIMIT 30')->fetchAll();
    // правила зведення змінились (180-я: спільна назва) — звести ще раз усі, зведені за старими
    $seen = array_column($rows, 'share_id');
    foreach (Db::q('SELECT id AS share_id FROM shares WHERE rv < ? LIMIT 30', [self::RULES])->fetchAll() as $x) if (!in_array($x['share_id'], $seen)) $rows[] = $x;
    foreach ($rows as $r) { try { $out[] = [(int)$r['share_id'], self::sync((int)$r['share_id'], 'share')]; } catch (Throwable $e) { error_log('teplo share cron: ' . $e->getMessage()); } }
    Db::q('DELETE FROM share_invites WHERE expires_at < ? AND used_at IS NULL', [time() - 30 * 86400]);
    return $out;
  }

  // ---------------------------------------------------------------- запрошення
  /** Токен запрошення — HMAC від його номера й секрету сервера: у базі лише sha256 токена, а власник може скопіювати те саме посилання ще раз. */
  public static function tok(int $id): string { return substr(rtrim(strtr(base64_encode(hash_hmac('sha256', 'share-inv:' . $id, Cfg::secret(), true)), '+/', '-_'), '='), 0, 24); }
  /** Нове запрошення → [id, токен]. */
  private static function newInvite(int $sid, int $by, ?string $email, string $via, string $lang, int $exp): array {
    Db::q('INSERT INTO share_invites (share_id, token_hash, by_user, email, via, lang, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [$sid, 'tmp' . bin2hex(random_bytes(30)), $by, $email, $via, $lang, time(), $exp]);
    $id = Db::id(); $t = self::tok($id); Db::q('UPDATE share_invites SET token_hash = ? WHERE id = ?', [hash('sha256', $t), $id]);
    return [$id, $t];
  }
  private static function goodTok(string $t): bool { return (bool)preg_match('/^[A-Za-z0-9_-]{24}$/', $t); }
  /** Спільна квартира людини за id її квартири (або null). */
  private static function shareOf(int $uid, string $pid): ?array {
    self::table(); return Db::one('SELECT * FROM share_members WHERE user_id = ? AND pid = ?', [$uid, $pid]);
  }
  private static function placeLabel(?object $p, string $lang): array {
    $ru = $lang === 'ru'; $name = trim((string)($p->name ?? ''));
    $city = is_object($p->city ?? null) ? trim((string)($p->city->n ?? '')) : '';
    $addr = trim(($city !== '' ? $city . ', ' : '') . trim((string)($p->street ?? ''))); if ($addr === '' || $addr === ',') $addr = trim((string)($p->address ?? ''));
    return ['name' => $name !== '' ? $name : ($ru ? 'Квартира' : 'Квартира'), 'addr' => mb_substr(trim($addr, ', '), 0, 120)];
  }
  public static function urls(string $t): array {
    $bot = (string)Cfg::get('bot_username');
    return ['url' => Cfg::appUrl() . '#join-' . $t, 'tg' => $bot !== '' ? 'https://t.me/' . rawurlencode($bot) . '?start=j' . $t : null];
  }
  /** Запросити людину в квартиру pid. in: {pid, email?, lang?}. Лише власник квартири (хто створив). */
  public static function invite(int $uid, array $in): array {
    self::table();
    $pid = (string)($in['pid'] ?? ''); if (!preg_match('/^[\w-]{1,40}$/', $pid)) throw new HttpError(422, 'bad_place');
    $c = self::load($uid); $p = $c ? self::placeIn($c['st'], $pid) : null; if (!$p) throw new HttpError(409, 'place_not_synced');
    $m = self::shareOf($uid, $pid);
    if ($m && $m['role'] !== 'owner') throw new HttpError(403, 'not_owner');
    if (!$m) {
      Db::q('INSERT INTO shares (owner_id, created_at) VALUES (?, ?)', [$uid, Http::iso()]); $sid = Db::id();
      Db::q("INSERT INTO share_members (share_id, user_id, pid, role, joined_at) VALUES (?, ?, ?, 'owner', ?)", [$sid, $uid, $pid, Http::iso()]);
    } else $sid = (int)$m['share_id'];
    $lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk';
    $email = mb_strtolower(trim((string)($in['email'] ?? '')));
    if ($email !== '' && (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190)) throw new HttpError(422, 'bad_email');
    $live = (int)(Db::one('SELECT COUNT(*) AS n FROM share_invites WHERE share_id = ? AND used_at IS NULL AND revoked = 0 AND expires_at > ?', [$sid, time()])['n'] ?? 0);
    if (count(self::members($sid)) >= self::MAX_PEOPLE) throw new HttpError(409, 'share_full');
    // посилання (не e-mail): є ще не використане й свіже (> 1 дня до кінця) — віддаємо його ж (те саме посилання), щоб у списку не множились
    if ($email === '' && empty($in['fresh'])) {
      $old = Db::one("SELECT * FROM share_invites WHERE share_id = ? AND via = 'link' AND used_at IS NULL AND revoked = 0 AND expires_at > ? ORDER BY id DESC", [$sid, time() + 86400]);
      if ($old) return ['sid' => $sid, 'id' => (int)$old['id'], 'exp' => (int)$old['expires_at'], 'email' => null] + self::urls(self::tok((int)$old['id'])) + self::mine($uid);
    }
    if ($live >= self::MAX_INVITES) throw new HttpError(429, 'too_many_invites');
    if ($email !== '' && !Mail::on()) throw new HttpError(503, 'mail_off');
    $exp = time() + self::TTL;
    [$iid, $t] = self::newInvite($sid, $uid, $email !== '' ? $email : null, $email !== '' ? 'mail' : 'link', $lang, $exp);
    if ($email !== '') {
      try { self::mailInvite($email, $t, $uid, $p, $lang, false); }
      catch (HttpError $e) { Db::q('DELETE FROM share_invites WHERE id = ?', [$iid]); throw new HttpError(503, 'mail_failed'); }
    }
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, $email !== '' ? 'share_invite_mail' : 'share_invite', null, Http::iso()]);
    self::sync($sid);   // позначка «спільна» на квартирі власника
    return ['sid' => $sid, 'id' => $iid, 'exp' => $exp, 'email' => $email !== '' ? $email : null] + self::urls($t) + self::mine($uid);
  }
  private static function mailInvite(string $email, string $t, int $by, ?object $p, string $lang, bool $confirm): void {
    $ru = $lang === 'ru'; $who = self::nameOf($by) ?: ($ru ? 'Человек' : 'Людина'); $pl = self::placeLabel($p, $lang);
    $what = '«' . $pl['name'] . '»' . ($pl['addr'] !== '' ? ' (' . $pl['addr'] . ')' : '');
    $url = Cfg::appUrl() . '#join-' . $t;
    $paras = $confirm
      ? ($ru ? ['Здравствуйте.', "Вы хотите присоединиться к квартире $what в «передай» — её пригласил(а) вести $who.", 'Чтобы подтвердить, что это ваша почта, нажмите кнопку — и квартира появится у вас. Пароль не нужен.']
             : ['Вітаємо.', "Ви хочете приєднатися до квартири $what у «передай» — її запросив(ла) вести $who.", 'Щоб підтвердити, що це ваша пошта, натисніть кнопку — і квартира з’явиться у вас. Пароль не потрібен.'])
      : ($ru ? ['Здравствуйте.', "$who приглашает вас вести вместе квартиру $what в «передай» — показания счётчиков, передача и оплата в одном месте.", 'Вы будете видеть и вносить показания этой квартиры, ' . $who . ' — видеть ваши. Ваши другие квартиры остаются только вашими. Пароль не нужен.']
             : ['Вітаємо.', "$who запрошує вас вести разом квартиру $what у «передай» — показання лічильників, передача й оплата в одному місці.", 'Ви бачитимете й вноситимете показання цієї квартири, ' . $who . ' — бачитиме ваші. Ваші інші квартири лишаються лише вашими. Пароль не потрібен.']);
    $foot = $ru ? 'Ссылка действует 7 дней. Если вы не ждали письма — ничего не делайте.' : 'Посилання діє 7 днів. Якщо ви не чекали листа — нічого не робіть.';
    $btn = $ru ? 'Присоединиться' : 'Приєднатися';
    $text = implode("\n\n", $paras) . "\n\n$btn: $url\n\n$foot\n\n— peredai.com.ua";
    Mail::send(['to' => [$email], 'kind' => 'share', 'user' => $by, 'subject' => $confirm ? ($ru ? 'Подтвердите почту — «передай»' : 'Підтвердіть пошту — «передай»') : ($ru ? "$who приглашает вас в квартиру — «передай»" : "$who запрошує вас у квартиру — «передай»"),
      'text' => $text, 'html' => Mail::layout($lang, $paras, [$btn, $url], $foot)]);
  }
  private static function inviteRow(string $t): ?array {
    self::table(); if (!self::goodTok($t)) return null;
    return Db::one('SELECT i.*, s.owner_id FROM share_invites i JOIN shares s ON s.id = i.share_id WHERE i.token_hash = ?', [hash('sha256', $t)]);
  }
  /** Що за запрошення (екран #join і картка в боті): хто, яка квартира, чи ще діє. Вхід не потрібен. */
  public static function preview(string $t, ?array $user, string $lang = 'uk'): array {
    $i = self::inviteRow($t);
    if (!$i) return ['state' => 'bad'];
    $sid = (int)$i['share_id']; $owner = (int)$i['owner_id'];
    $om = Db::one("SELECT * FROM share_members WHERE share_id = ? AND role = 'owner'", [$sid]);
    $c = $om ? self::load($owner) : null; $p = $c ? self::placeIn($c['st'], (string)$om['pid']) : null;
    $pl = self::placeLabel($p, $lang); $n = count(self::members($sid));
    $out = ['owner' => self::nameOf($owner, $om['name'] ?? null), 'place' => $pl['name'], 'addr' => $pl['addr'], 'n' => $n, 'email' => $i['email'] ? self::mask((string)$i['email']) : null, 'kinds' => $p ? self::kinds($p) : []];
    if ($user) {
      if ((int)$user['id'] === $owner) return ['state' => 'own'] + $out;
      $mm = Db::one('SELECT pid FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, (int)$user['id']]);
      if ($mm) return ['state' => 'member', 'pid' => $mm['pid']] + $out;
    }
    if ((int)$i['revoked'] || !$p) return ['state' => 'revoked'] + $out;
    if ($i['used_at'] !== null) return ['state' => 'used'] + $out;
    if ((int)$i['expires_at'] < time()) return ['state' => 'expired'] + $out;
    if ($n >= self::MAX_PEOPLE) return ['state' => 'full'] + $out;
    return ['state' => 'ok'] + $out;
  }
  private static function mask(string $e): string { [$a, $d] = array_pad(explode('@', $e, 2), 2, ''); return mb_substr($a, 0, 2) . '•••@' . $d; }
  /** Які лічильники в квартирі (для картки запрошення): heat, hot, cold, elec, gas, waste. */
  private static function kinds(object $p): array {
    $k = [];
    if (isset($p->meter) && is_object($p->meter) && empty($p->meter->removed)) $k['heat'] = 1;
    foreach ((is_object($p->water ?? null) && is_array($p->water->meters ?? null) ? $p->water->meters : []) as $m) if (is_object($m) && empty($m->deleted) && empty($m->removed)) $k[($m->kind ?? '') === 'hot' ? 'hot' : 'cold'] = 1;
    foreach ((is_array($p->meters ?? null) ? $p->meters : []) as $m) if (is_object($m) && empty($m->deleted) && empty($m->removed) && in_array($m->kind ?? '', ['elec', 'gas'], true)) $k[$m->kind] = 1;
    if (is_object($p->waste ?? null) && !empty($p->waste->on)) $k['waste'] = 1;
    return array_values(array_filter(['elec', 'hot', 'cold', 'gas', 'heat', 'waste'], fn($x) => isset($k[$x])));
  }

  /** Приєднатися за запрошенням. uid — хто увійшов (0 — ще ні). in: {t, email?, name?, state?, lang?}.
   *  → {pid, sid} | {sent: e-mail} (посилання без входу: підтвердити пошту листом) | {login: uid, pid, sid} (лист на пошту — сам собі вхід; сесію відкриває Api). */
  public static function join(int $uid, string $t, array $in): array {
    self::table();
    $i = self::inviteRow($t); if (!$i) throw new HttpError(404, 'invite_bad');
    $sid = (int)$i['share_id']; $lang = ($in['lang'] ?? $i['lang']) === 'ru' ? 'ru' : 'uk';
    if ($uid > 0) {
      if ($uid === (int)$i['owner_id']) throw new HttpError(409, 'invite_own');
      $mm = Db::one('SELECT pid FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, $uid]);
      if ($mm) return ['pid' => $mm['pid'], 'sid' => $sid, 'already' => true];
    }
    if ((int)$i['revoked']) throw new HttpError(410, 'invite_revoked');
    if ($i['used_at'] !== null) throw new HttpError(410, 'invite_used');
    if ((int)$i['expires_at'] < time()) throw new HttpError(410, 'invite_expired');
    if (count(self::members($sid)) >= self::MAX_PEOPLE) throw new HttpError(409, 'share_full');
    $login = false;
    if ($uid <= 0) {
      if ($i['email']) {   // лист прийшов на цю пошту: є акаунт з нею — входимо в нього, нема — новий, без пароля
        $u = Db::one('SELECT id FROM users WHERE email = ?', [(string)$i['email']]);
        if ($u) $uid = (int)$u['id'];
        else { Db::q('INSERT INTO users (email, name, created_at) VALUES (?, ?, ?)', [(string)$i['email'], mb_substr(trim((string)($in['name'] ?? '')), 0, 80) ?: null, Http::iso()]); $uid = Db::id(); }
        $login = true;
      } else {
        $email = mb_strtolower(trim((string)($in['email'] ?? '')));
        if ($email === '') throw new HttpError(401, 'login_needed');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) throw new HttpError(422, 'bad_email');
        if (!Mail::on()) throw new HttpError(503, 'mail_off');
        RateLimit::hit('forgot_acc', $email);
        // підтвердити пошту: нове запрошення на цю адресу (на місці цього — воно вже не діє), лист із посиланням
        [$i2, $t2] = self::newInvite($sid, (int)$i['by_user'], $email, 'mail2', $lang, min((int)$i['expires_at'], time() + 86400));
        $om = Db::one("SELECT * FROM share_members WHERE share_id = ? AND role = 'owner'", [$sid]); $c = $om ? self::load((int)$om['user_id']) : null;
        try { self::mailInvite($email, $t2, (int)$i['by_user'], $c ? self::placeIn($c['st'], (string)$om['pid']) : null, $lang, true); }
        catch (HttpError $e) { Db::q('DELETE FROM share_invites WHERE id = ?', [$i2]); throw new HttpError(503, 'mail_failed'); }
        return ['sent' => self::mask($email)];
      }
    }
    if ($uid === (int)$i['owner_id']) throw new HttpError(409, 'invite_own');
    // разом два натискання — пройде лише одне
    if (Db::q('UPDATE share_invites SET used_by = ?, used_at = ? WHERE id = ? AND used_at IS NULL', [$uid, time(), (int)$i['id']])->rowCount() !== 1) throw new HttpError(410, 'invite_used');
    $mm = Db::one('SELECT pid FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, $uid]);
    if ($mm) return ['pid' => $mm['pid'], 'sid' => $sid, 'already' => true] + ($login ? ['login' => $uid] : []);
    // перший вхід цього акаунта з даними, внесеними без входу на цьому пристрої (state) — вони стають його даними, не губляться
    $c = self::load($uid);
    $st = $c ? $c['st'] : null;
    if (!$st) {
      $raw = isset($in['state']) && is_array($in['state']) ? json_decode((string)json_encode($in['state'], JSON_UNESCAPED_UNICODE)) : null;
      $st = is_object($raw) && isset($raw->readings) && is_array($raw->readings) ? $raw : (object)['v' => 1, 'onboarded' => true, 'readings' => [], 'water' => [], 'mrecs' => [], 'places' => []];
    }
    $st->onboarded = true;
    if (!isset($st->places) || !is_array($st->places)) $st->places = [];
    // порожня «Моя квартира», яку застосунок створив сам (без лічильників, адреси й записів), — геть: спільна стає першою
    $ids = []; $live = [];
    foreach ($st->places as $q) if (is_object($q) && isset($q->id)) { $ids[(string)$q->id] = 1; if (empty($q->deleted)) $live[] = $q; }
    if (count($live) === 1 && self::fresh($st, $live[0])) { $live[0]->deleted = true; $live[0]->updatedAt = self::ms(); if (!isset($live[0]->_kt) || !is_object($live[0]->_kt)) $live[0]->_kt = new stdClass; $live[0]->_kt->deleted = self::ms(); }
    $pid = 'sh' . $sid; $n = 2; while (isset($ids[$pid])) $pid = 'sh' . $sid . '_' . $n++;
    $st->places[] = (object)['id' => $pid, 'name' => '', 'v' => 2, 'updatedAt' => 0, '_kt' => new stdClass];
    if (!self::store($uid, $c, $st, 'share')) throw new HttpError(409, 'conflict_retry');
    Db::q("INSERT INTO share_members (share_id, user_id, pid, role, name, joined_at) VALUES (?, ?, ?, 'member', ?, ?)", [$sid, $uid, $pid, mb_substr(trim((string)($in['name'] ?? '')), 0, 80) ?: null, Http::iso()]);
    self::sync($sid);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'share_join', null, Http::iso()]);
    self::tell((int)$i['owner_id'], 'joined', $sid, $uid);
    return ['pid' => $pid, 'sid' => $sid] + ($login ? ['login' => $uid] : []);
  }
  private static function fresh(object $st, object $p): bool {
    if (trim((string)($p->name ?? '')) !== '' || trim((string)($p->address ?? '')) !== '' || trim((string)($p->street ?? '')) !== '') return false;
    if (self::kinds($p) || (is_object($p->meter ?? null))) return false;
    $first = self::first($st);
    foreach (self::RECS as $rk) foreach ((isset($st->$rk) && is_array($st->$rk) ? $st->$rk : []) as $r) if (is_object($r) && empty($r->deleted) && self::recIn($r, (string)$p->id, $first)) return false;
    return true;
  }

  /** Спільні квартири людини: хто ще має доступ; власнику — ще й запрошення, що чекають. */
  public static function mine(int $uid): array {
    self::table(); $out = [];
    foreach (Db::q('SELECT * FROM share_members WHERE user_id = ?', [$uid])->fetchAll() as $me) {
      $sid = (int)$me['share_id']; $ms = self::members($sid); $own = $me['role'] === 'owner';
      $ppl = array_map(fn($m) => ['id' => (int)$m['user_id'], 'name' => self::nameOf((int)$m['user_id'], $m['name']), 'role' => $m['role'], 'me' => (int)$m['user_id'] === $uid,
        'at' => (string)$m['joined_at'], 'via' => self::via((int)$m['user_id'])], $ms);
      $inv = [];
      if ($own) foreach (Db::q('SELECT * FROM share_invites WHERE share_id = ? AND used_at IS NULL AND revoked = 0 AND expires_at > ? ORDER BY id DESC', [$sid, time()])->fetchAll() as $i)
        $inv[] = ['id' => (int)$i['id'], 'via' => $i['via'], 'email' => $i['email'], 'exp' => (int)$i['expires_at'], 'at' => (int)$i['created_at']] + ($i['via'] === 'link' ? self::urls(self::tok((int)$i['id'])) : []);
      $sh = Db::one('SELECT bg FROM shares WHERE id = ?', [$sid]);
      $out[] = ['sid' => $sid, 'pid' => $me['pid'], 'role' => $me['role'], 'people' => $ppl, 'invites' => $inv, 'bg' => (bool)(int)($sh['bg'] ?? 0)] + ($own ? ['bgVia' => self::ownerVia($uid, (string)$me['pid'])] : []);
    }
    return ['shares' => $out];
  }

  // ---------------------------------------------------------------- 180-я: «у фоні» учасника через кабінети власника
  // Власник галочкою дозволяє (shares.bg): учасник без свого підключення надсилає показання ЦІЄЇ квартири через підключення власника (ХТМ, місцеві КП).
  // Паролі й дані входу учасник не бачить; рахунок — лише цієї квартири (не інші квартири власника). Водоканал — і так рахунком і прізвищем квартири.
  /** POST /api/share/bg {sid, on} — лише власник. */
  public static function bg(int $uid, array $in): array {
    self::table(); $sid = (int)($in['sid'] ?? 0); $on = ($in['on'] ?? false) === true;
    $me = Db::one('SELECT role FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, $uid]);
    if (!$me || $me['role'] !== 'owner') throw new HttpError(403, 'not_owner');
    Db::q('UPDATE shares SET bg = ?, bg_at = ? WHERE id = ?', [$on ? 1 : 0, time(), $sid]);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'share_bg_' . ($on ? 'on' : 'off'), null, Http::iso()]);
    self::sync($sid);
    return self::mine($uid);
  }
  /** Що відкриває галочка власника «у фоні через мої кабінети» для цієї квартири: ['htm'] або [].
   *  183-я (власник 23.11: «у каждой квартиры свой вход для всех поставщиков»): входи самої квартири — ХТМ цієї квартири ('hp…') і місцевих КП (LocalBot) —
   *  у спільній і так для всіх, хто її веде; галочка лишилась лише для основного кабінету ХТМ власника (рахунок цієї квартири в ньому), коли входу квартири немає. */
  private static function ownerVia(int $uid, string $pid): array {
    foreach (Db::q("SELECT extra FROM cab_creds WHERE user_id = ? AND prov LIKE 'hp%'", [$uid])->fetchAll() as $r) { $ex = json_decode((string)$r['extra'], true); if (is_array($ex) && (string)($ex['place'] ?? '') === $pid) return []; }
    $c = Db::one("SELECT state FROM cab_creds WHERE user_id = ? AND prov = 'htm'", [$uid]);
    return $c && $c['state'] !== 'bad_login' ? ['htm'] : [];
  }
  /** 183-я (власник 23.11: «у каждой квартиры свой вход для всех поставщиков»): інші люди тієї самої спільної квартири → [[uid, їхня копія pid], …]
   *  (власник і учасники, крім самого uid); квартира не спільна — []. */
  public static function mates(int $uid, string $pid): array {
    if ($pid === '') return [];
    try { self::table(); } catch (Throwable $e) { return []; }
    $m = Db::one('SELECT share_id FROM share_members WHERE user_id = ? AND pid = ?', [$uid, $pid]); if (!$m) return [];
    return array_map(fn($r) => [(int)$r['user_id'], (string)$r['pid']], Db::q("SELECT user_id, pid FROM share_members WHERE share_id = ? AND user_id <> ? ORDER BY role = 'owner' DESC, user_id", [(int)$m['share_id'], $uid])->fetchAll());
  }
  /** Спільні квартири людини: [її pid, …]. */
  public static function pidsOf(int $uid): array {
    try { self::table(); } catch (Throwable $e) { return []; }
    return array_map(fn($r) => (string)$r['pid'], Db::q('SELECT pid FROM share_members WHERE user_id = ?', [$uid])->fetchAll());
  }
  /** Учасник uid і його копія квартири pid → власник, якщо він дозволив «у фоні»: ['uid', 'pid', 'sid', 'name'] або null. */
  public static function bgOwner(int $uid, string $pid): ?array {
    if ($pid === '') return null;
    try { self::table(); } catch (Throwable $e) { return null; }
    $m = Db::one("SELECT m.share_id, s.bg FROM share_members m JOIN shares s ON s.id = m.share_id WHERE m.user_id = ? AND m.pid = ? AND m.role = 'member'", [$uid, $pid]);
    if (!$m || !(int)$m['bg']) return null;
    $o = Db::one("SELECT user_id, pid, name FROM share_members WHERE share_id = ? AND role = 'owner'", [(int)$m['share_id']]); if (!$o) return null;
    return ['uid' => (int)$o['user_id'], 'pid' => (string)$o['pid'], 'sid' => (int)$m['share_id'], 'name' => self::nameOf((int)$o['user_id'], $o['name'])];
  }
  /** Рахунки цієї квартири в стані власника (теплолічильник, гаряча, холодна) — лише на них учасник може надсилати через кабінет власника. */
  public static function placeAccs(int $owner, string $pid): array {
    $c = self::load($owner); $p = $c ? self::placeIn($c['st'], $pid) : null; if (!$p) return [];
    $d = fn($x) => preg_replace('/\D/', '', is_scalar($x) ? (string)$x : '');
    $w = is_object($p->water ?? null) ? $p->water : new stdClass; $acc = is_object($w->acc ?? null) ? $w->acc : new stdClass;
    $st = $c['st']; $m = ((string)($st->placeId ?? self::first($st)) === $pid && is_object($st->meter ?? null)) ? $st->meter : ($p->meter ?? null);   // поточна квартира — S.meter
    return array_values(array_unique(array_filter([$d(is_object($m) ? ($m->account ?? '') : ''), $d($acc->hot ?? ''), $d($acc->cold ?? ($w->account ?? ''))])));
  }
  /** Спільні квартири учасника зі згодою «у фоні»: [{mpid, uid (власник), pid (квартира власника), sid, name}] — для GET /api/cab/htm. */
  public static function bgMine(int $uid): array {
    try { self::table(); } catch (Throwable $e) { return []; }
    $out = [];
    foreach (Db::q("SELECT m.pid, m.share_id FROM share_members m JOIN shares s ON s.id = m.share_id WHERE m.user_id = ? AND m.role = 'member' AND s.bg = 1", [$uid])->fetchAll() as $r) {
      $o = self::bgOwner($uid, (string)$r['pid']); if ($o) $out[] = ['mpid' => (string)$r['pid']] + $o;   // mpid — копія учасника, pid — квартира власника
    }
    return $out;
  }
  /** Як людина заходить (для власника: «Telegram» / «пошта») — без самих адрес. */
  private static function via(int $uid): string {
    if (Db::one("SELECT 1 AS x FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$uid])) return 'tg';
    $u = Db::one('SELECT email FROM users WHERE id = ?', [$uid]); return $u && $u['email'] ? 'mail' : '';
  }
  public static function revoke(int $uid, array $in): array {
    self::table(); $i = Db::one('SELECT i.*, s.owner_id FROM share_invites i JOIN shares s ON s.id = i.share_id WHERE i.id = ?', [(int)($in['id'] ?? 0)]);
    if (!$i || (int)$i['owner_id'] !== $uid) throw new HttpError(404, 'not_found');
    Db::q('UPDATE share_invites SET revoked = 1 WHERE id = ?', [(int)$i['id']]);
    return self::mine($uid);
  }
  /** Власник прибирає людину. */
  public static function remove(int $uid, array $in): array {
    self::table(); $sid = (int)($in['sid'] ?? 0); $who = (int)($in['user'] ?? 0);
    $me = Db::one('SELECT role FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, $uid]);
    if (!$me || $me['role'] !== 'owner') throw new HttpError(403, 'not_owner');
    if ($who === $uid) throw new HttpError(422, 'owner_cant_leave');
    if (!Db::one('SELECT 1 AS x FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, $who])) throw new HttpError(404, 'not_found');
    self::drop($sid, $who, true, 'removed'); self::tell($who, 'removed', $sid, $uid); self::sync($sid);
    return self::mine($uid);
  }
  /** Учасник виходить сам (квартира зникає з його списку; у власника все лишається). */
  public static function leave(int $uid, array $in): array {
    self::table(); $sid = (int)($in['sid'] ?? 0);
    $me = Db::one('SELECT role FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, $uid]);
    if (!$me) throw new HttpError(404, 'not_found');
    if ($me['role'] === 'owner') throw new HttpError(422, 'owner_cant_leave');
    $own = (int)(Db::one('SELECT owner_id FROM shares WHERE id = ?', [$sid])['owner_id'] ?? 0);
    self::drop($sid, $uid, true, 'left'); self::tell($own, 'left', $sid, $uid); self::sync($sid);
    return self::mine($uid);
  }
  /** Акаунт видаляють: людина виходить звідусіль; де вона власник — квартиру в інших прибрано. */
  public static function forget(int $uid): void {
    try { self::table();
      foreach (Db::q('SELECT share_id, role FROM share_members WHERE user_id = ?', [$uid])->fetchAll() as $m) {
        if ($m['role'] === 'owner') self::dissolve((int)$m['share_id'], $uid, 'account'); else { Db::q('DELETE FROM share_members WHERE share_id = ? AND user_id = ?', [(int)$m['share_id'], $uid]); self::sync((int)$m['share_id']); }
      }
      Db::q('UPDATE share_invites SET revoked = 1 WHERE by_user = ?', [$uid]);
    } catch (Throwable $e) { error_log('teplo share forget: ' . $e->getMessage()); }
  }

  // ---------------------------------------------------------------- Telegram
  /** Повідомлення в Telegram (якщо людина там є): joined — власнику, left — власнику, removed — тому, кого прибрали, gone — квартиру видалили. */
  private static function tell(int $to, string $what, int $sid, int $who): void {
    if ($to <= 0 || !Cfg::get('bot_token')) return;
    try {
      $tg = Db::one("SELECT external_id FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$to]); if (!$tg) return;
      $c = self::load($to); $lang = $c && (($c['st']->remind->lang ?? $c['st']->lang ?? '') === 'ru') ? 'ru' : 'uk'; $ru = $lang === 'ru';
      $m = Db::one('SELECT pid FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, $to]);
      $p = $c && $m ? self::placeIn($c['st'], (string)$m['pid']) : null; $pl = self::placeLabel($p, $lang)['name'];
      $wm = Db::one('SELECT name FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, $who]);
      $name = self::nameOf($who, $wm['name'] ?? null) ?: ($ru ? 'Человек' : 'Людина');
      $txt = [
        'joined' => $ru ? "👥 $name теперь ведёт с вами квартиру «{$pl}»: видит и вносит показания. Убрать — в «передай» → квартира → «Совместный доступ»." : "👥 $name тепер веде з вами квартиру «{$pl}»: бачить і вносить показання. Прибрати — у «передай» → квартира → «Спільний доступ».",
        'left' => $ru ? "👥 $name вышел(ла) из квартиры «{$pl}». У вас всё осталось." : "👥 $name вийшов(ла) з квартири «{$pl}». У вас усе лишилось.",
        'removed' => $ru ? "👥 $name убрал(а) вас из квартиры «{$pl}» — теперь её у вас нет. Ваши другие квартиры на месте." : "👥 $name прибрав(ла) вас із квартири «{$pl}» — тепер її у вас немає. Ваші інші квартири на місці.",
        'gone' => $ru ? "👥 $name удалил(а) общую квартиру — у вас её больше нет. Ваши другие квартиры на месте." : "👥 $name видалив(ла) спільну квартиру — у вас її більше немає. Ваші інші квартири на місці.",
      ][$what] ?? null;
      if ($txt === null) return;
      $params = ['chat_id' => $tg['external_id'], 'text' => $txt];
      if (in_array($what, ['joined', 'left'], true)) $params['reply_markup'] = ['inline_keyboard' => [[['text' => $ru ? 'Открыть «передай»' : 'Відкрити «передай»', 'web_app' => ['url' => Cfg::appUrl()]]]]];
      Telegram::call('sendMessage', $params);
    } catch (Throwable $e) { error_log('teplo share tell: ' . $e->getMessage()); }
  }
  /** /start j<токен>: картка запрошення з кнопками «Приєднатися» / «Ні, дякую». */
  public static function botStart(array $msg, string $t, string $lang): array {
    $ru = $lang === 'ru'; $pv = self::preview($t, null, $lang); $chat = $msg['chat']['id'];
    $tgId = (string)($msg['from']['id'] ?? '');
    $idn = $tgId !== '' ? Db::one("SELECT user_id FROM user_identities WHERE type = 'telegram' AND external_id = ?", [$tgId]) : null;
    if ($idn) $pv = self::preview($t, ['id' => (int)$idn['user_id']], $lang);
    $open = [['text' => $ru ? 'Открыть «передай»' : 'Відкрити «передай»', 'web_app' => ['url' => Cfg::appUrl()]]];
    if ($pv['state'] !== 'ok') {
      $why = ['member' => $ru ? 'Вы уже ведёте эту квартиру — она в «передай».' : 'Ви вже ведете цю квартиру — вона в «передай».',
        'own' => $ru ? 'Это ваше приглашение — отправьте ссылку тому, кого приглашаете.' : 'Це ваше запрошення — надішліть посилання тому, кого запрошуєте.',
        'used' => $ru ? 'По этой ссылке уже присоединились. Попросите новую.' : 'За цим посиланням уже приєдналися. Попросіть нове.',
        'expired' => $ru ? 'Приглашение устарело (действует 7 дней). Попросите новое.' : 'Запрошення застаріло (діє 7 днів). Попросіть нове.',
        'full' => $ru ? 'В квартире уже максимум людей.' : 'У квартирі вже найбільше людей.',
      ][$pv['state']] ?? ($ru ? 'Приглашение не действует. Попросите новое.' : 'Запрошення не діє. Попросіть нове.');
      $p = ['chat_id' => $chat, 'text' => '👥 ' . $why, 'reply_markup' => ['inline_keyboard' => [$open]]];
      Telegram::call('sendMessage', $p); return $p;
    }
    $what = '«' . $pv['place'] . '»' . ($pv['addr'] !== '' ? "\n📍 " . $pv['addr'] : '');
    $txt = $ru
      ? "👥 {$pv['owner']} приглашает вести вместе квартиру $what\n\nВы будете видеть и вносить показания этой квартиры, {$pv['owner']} — видеть ваши. Ваши другие квартиры остаются только вашими."
      : "👥 {$pv['owner']} запрошує вести разом квартиру $what\n\nВи бачитимете й вноситимете показання цієї квартири, {$pv['owner']} — бачитиме ваші. Ваші інші квартири лишаються лише вашими.";
    $p = ['chat_id' => $chat, 'text' => $txt, 'reply_markup' => ['inline_keyboard' => [[['text' => $ru ? '✅ Присоединиться' : '✅ Приєднатися', 'callback_data' => 'sj:' . $t]], [['text' => $ru ? 'Нет, спасибо' : 'Ні, дякую', 'callback_data' => 'sx']]]]];
    Telegram::call('sendMessage', $p); return $p;
  }
  /** /dostup (команда в меню бота «Спільний доступ»): квартири людини кнопками — хто веде, «Запросити», «Прибрати …», «Вийти».
   *  Для тих, кому зручніше в Telegram, ніж у застосунку (власник 23.11: «через телеграм бота — меню с кнопками, если так будет проще»). */
  public static function botMenu(array $from, $chat, string $lang, $mid = null, string $note = ''): array {
    self::table(); $ru = $lang === 'ru';
    $idn = Db::one("SELECT user_id FROM user_identities WHERE type = 'telegram' AND external_id = ?", [(string)($from['id'] ?? '')]);
    $open = [['text' => $ru ? 'Открыть «передай»' : 'Відкрити «передай»', 'web_app' => ['url' => Cfg::appUrl()]]];
    $c = $idn ? self::load((int)$idn['user_id']) : null;
    $live = []; foreach ($c ? self::places($c['st']) : [] as $p) if (is_object($p) && isset($p->id) && empty($p->deleted)) $live[] = $p;
    if (!$live) { $p = ['chat_id' => $chat, 'text' => '👥 ' . ($ru ? 'Сначала добавьте квартиру в «передай» — потом здесь можно будет пригласить родных или арендатора.' : 'Спершу додайте квартиру в «передай» — потім тут можна буде запросити рідних чи орендаря.'), 'reply_markup' => ['inline_keyboard' => [$open]]];
      Telegram::call($mid ? 'editMessageText' : 'sendMessage', $p + ($mid ? ['message_id' => $mid] : [])); return $p; }
    $uid = (int)$idn['user_id']; $lines = []; $kb = []; $i = 0;
    foreach ($live as $p) {
      $i++; $lbl = trim((string)($p->name ?? '')) ?: ($i === 1 ? ($ru ? 'Моя квартира' : 'Моя квартира') : ($ru ? "Квартира $i" : "Квартира $i"));
      $m = Db::one('SELECT * FROM share_members WHERE user_id = ? AND pid = ?', [$uid, (string)$p->id]);
      $ms = $m ? self::members((int)$m['share_id']) : [];
      if ($m && $m['role'] !== 'owner') {
        $own = ''; foreach ($ms as $x) if ($x['role'] === 'owner') $own = self::nameOf((int)$x['user_id'], $x['name']);
        $lines[] = "🏠 «{$lbl}» — " . ($ru ? "ведёт $own, вы участник" : "веде $own, ви учасник");
        $kb[] = [['text' => ($ru ? '🚪 Выйти из «' : '🚪 Вийти з «') . mb_substr($lbl, 0, 24) . '»', 'callback_data' => 'sl:' . (int)$m['share_id']]];
        continue;
      }
      $others = array_values(array_filter($ms, fn($x) => (int)$x['user_id'] !== $uid));
      $lines[] = "🏠 «{$lbl}» — " . ($others ? ($ru ? 'вы, ' : 'ви, ') . implode(', ', array_map(fn($x) => self::nameOf((int)$x['user_id'], $x['name']), $others)) : ($ru ? 'только вы' : 'лише ви'));
      if (strlen((string)$p->id) <= 40) $kb[] = [['text' => ($ru ? '➕ Пригласить в «' : '➕ Запросити в «') . mb_substr($lbl, 0, 24) . '»', 'callback_data' => 'sp:' . $p->id]];
      foreach ($others as $x) $kb[] = [['text' => '✖ ' . ($ru ? 'Убрать ' : 'Прибрати ') . mb_substr(self::nameOf((int)$x['user_id'], $x['name']), 0, 24), 'callback_data' => 'sr:' . (int)$m['share_id'] . ':' . (int)$x['user_id']]];
    }
    $kb[] = $open;
    $txt = ($note !== '' ? $note . "

" : '') . '👥 ' . ($ru ? "Совместный доступ — кто ведёт ваши квартиры:

" : "Спільний доступ — хто веде ваші квартири:

") . implode("
", $lines) .
      "

" . ($ru ? 'Приглашённый видит и вносит показания этой квартиры, вы — его. Другие квартиры и пароли кабинетов — только ваши.' : 'Запрошений бачить і вносить показання цієї квартири, ви — його. Інші квартири й паролі кабінетів — лише ваші.');
    $p = ['chat_id' => $chat, 'text' => $txt, 'reply_markup' => ['inline_keyboard' => $kb]];
    Telegram::call($mid ? 'editMessageText' : 'sendMessage', $p + ($mid ? ['message_id' => $mid] : [])); return $p;
  }

  /** Натиснули кнопку під карткою запрошення чи в меню «Спільний доступ». */
  public static function botCallback(array $cq): ?array {
    $data = (string)($cq['data'] ?? ''); if (!preg_match('/^s[jxmprRlL](:|$)/', $data)) return null;
    if (!preg_match('/^s[jx](:|$)/', $data)) return self::botMenuAct($cq, $data);
    $from = (array)($cq['from'] ?? []); $lang = str_starts_with((string)($from['language_code'] ?? ''), 'ru') ? 'ru' : 'uk'; $ru = $lang === 'ru';
    $msg = (array)($cq['message'] ?? []); $chat = $msg['chat']['id'] ?? ($from['id'] ?? null); $mid = $msg['message_id'] ?? null;
    $edit = function (string $text, ?array $kb) use ($chat, $mid) {
      $p = ['chat_id' => $chat, 'message_id' => $mid, 'text' => $text] + ($kb ? ['reply_markup' => ['inline_keyboard' => $kb]] : []);
      if ($chat !== null && $mid !== null) Telegram::call('editMessageText', $p); elseif ($chat !== null) { unset($p['message_id']); Telegram::call('sendMessage', $p); }
      return $p;
    };
    if ($data === 'sx') { Telegram::call('answerCallbackQuery', ['callback_query_id' => $cq['id'] ?? '']); return $edit($ru ? '👥 Хорошо, не присоединяемся. Если передумаете — попросите ссылку ещё раз.' : '👥 Добре, не приєднуємось. Якщо передумаєте — попросіть посилання ще раз.', null); }
    $t = substr($data, 3);
    try {
      $uid = Telegram::userFor($from);
      if (!Db::one('SELECT name FROM users WHERE id = ? AND name IS NOT NULL', [$uid])) { $nm = trim(($from['first_name'] ?? '') . ' ' . ($from['last_name'] ?? '')); if ($nm !== '') Db::q('UPDATE users SET name = ? WHERE id = ?', [mb_substr($nm, 0, 80), $uid]); }
      $j = self::join($uid, $t, ['lang' => $lang]);
      Telegram::markBotOk((string)($from['id'] ?? ''));
      Telegram::call('answerCallbackQuery', ['callback_query_id' => $cq['id'] ?? '', 'text' => $ru ? 'Готово' : 'Готово']);
      $url = Cfg::appUrl() . '?go=home&place=' . rawurlencode((string)$j['pid']);
      return $edit($ru ? "✅ Готово! Квартира теперь у вас в «передай». Нажмите кнопку — увидите её счётчики и сможете внести показания." : "✅ Готово! Квартира тепер у вас у «передай». Натисніть кнопку — побачите її лічильники й зможете внести показання.",
        [[['text' => $ru ? 'Открыть квартиру' : 'Відкрити квартиру', 'web_app' => ['url' => $url]]]]);
    } catch (HttpError $e) {
      Telegram::call('answerCallbackQuery', ['callback_query_id' => $cq['id'] ?? '']);
      $why = ['invite_used' => $ru ? 'По этой ссылке уже присоединились. Попросите новую.' : 'За цим посиланням уже приєдналися. Попросіть нове.',
        'invite_expired' => $ru ? 'Приглашение устарело. Попросите новое.' : 'Запрошення застаріло. Попросіть нове.',
        'invite_own' => $ru ? 'Это ваше приглашение — отправьте его тому, кого приглашаете.' : 'Це ваше запрошення — надішліть його тому, кого запрошуєте.',
        'share_full' => $ru ? 'В квартире уже максимум людей.' : 'У квартирі вже найбільше людей.'][$e->err] ?? ($ru ? 'Не получилось. Попросите новую ссылку.' : 'Не вийшло. Попросіть нове посилання.');
      return $edit('👥 ' . $why, null);
    }
  }

  /** Кнопки меню «Спільний доступ»: sm — меню; sp:<квартира> — запросити; sr/sR:<sid>:<людина> — прибрати (питання / так); sl/sL:<sid> — вийти. */
  private static function botMenuAct(array $cq, string $data): array {
    $from = (array)($cq['from'] ?? []); $lang = str_starts_with((string)($from['language_code'] ?? ''), 'ru') ? 'ru' : 'uk'; $ru = $lang === 'ru';
    $msg = (array)($cq['message'] ?? []); $chat = $msg['chat']['id'] ?? ($from['id'] ?? null); $mid = $msg['message_id'] ?? null;
    Telegram::call('answerCallbackQuery', ['callback_query_id' => $cq['id'] ?? '']);
    $idn = Db::one("SELECT user_id FROM user_identities WHERE type = 'telegram' AND external_id = ?", [(string)($from['id'] ?? '')]);
    if (!$idn) return self::botMenu($from, $chat, $lang, $mid);
    $uid = (int)$idn['user_id']; $parts = explode(':', $data);
    $nm = function (int $sid, int $who) { $m = Db::one('SELECT name FROM share_members WHERE share_id = ? AND user_id = ?', [$sid, $who]); return self::nameOf($who, $m['name'] ?? null); };
    $ask = function (string $q, string $yes, string $cb) use ($chat, $mid, $ru) {
      $p = ['chat_id' => $chat, 'message_id' => $mid, 'text' => '👥 ' . $q, 'reply_markup' => ['inline_keyboard' => [[['text' => $yes, 'callback_data' => $cb]], [['text' => $ru ? 'Отмена' : 'Скасувати', 'callback_data' => 'sm']]]]];
      Telegram::call('editMessageText', $p); return $p;
    };
    try {
      switch ($parts[0]) {
        case 'sp': {
          $j = self::invite($uid, ['pid' => (string)($parts[1] ?? ''), 'lang' => $lang]);
          $c = self::load($uid); $p = $c ? self::placeIn($c['st'], (string)$parts[1]) : null; $lbl = self::placeLabel($p, $lang)['name'];
          $me = self::nameOf($uid);
          Telegram::call('sendMessage', ['chat_id' => $chat, 'text' => $ru ? '👇 Перешлите сообщение ниже тому, кого приглашаете (ссылка — для одного человека, действует 7 дней).' : '👇 Перешліть повідомлення нижче тому, кого запрошуєте (посилання — для однієї людини, діє 7 днів).']);
          $inv = ['chat_id' => $chat, 'text' => ($ru ? ($me !== '' ? "$me приглашает" : 'Приглашаю') . " вас вести вместе квартиру «{$lbl}» в «передай»: показания счётчиков, передача и оплата в одном месте.

В Telegram — нажмите и «Присоединиться»: {$j['tg']}
Без Telegram: {$j['url']}"
            : ($me !== '' ? "$me запрошує" : 'Запрошую') . " вас вести разом квартиру «{$lbl}» у «передай»: показання лічильників, передача й оплата в одному місці.

У Telegram — натисніть і «Приєднатися»: {$j['tg']}
Без Telegram: {$j['url']}"), 'disable_web_page_preview' => true];
          Telegram::call('sendMessage', $inv); return $inv;
        }
        case 'sr': return $ask($ru ? 'Убрать ' . $nm((int)$parts[1], (int)$parts[2]) . ' из квартиры? У него(неё) она исчезнет, ваши показания на месте.' : 'Прибрати ' . $nm((int)$parts[1], (int)$parts[2]) . ' з квартири? У нього(неї) вона зникне, ваші показання на місці.',
          $ru ? '✖ Да, убрать' : '✖ Так, прибрати', 'sR:' . (int)$parts[1] . ':' . (int)$parts[2]);
        case 'sR': { $who = $nm((int)$parts[1], (int)$parts[2]); self::remove($uid, ['sid' => (int)$parts[1], 'user' => (int)$parts[2]]); return self::botMenu($from, $chat, $lang, $mid, ($ru ? '✅ Убрали: ' : '✅ Прибрали: ') . $who); }
        case 'sl': return $ask($ru ? 'Выйти из квартиры? Она исчезнет из вашего списка; у владельца всё останется.' : 'Вийти з квартири? Вона зникне з вашого списку; у власника все залишиться.', $ru ? '🚪 Да, выйти' : '🚪 Так, вийти', 'sL:' . (int)$parts[1]);
        case 'sL': self::leave($uid, ['sid' => (int)$parts[1]]); return self::botMenu($from, $chat, $lang, $mid, $ru ? '✅ Вы вышли из квартиры.' : '✅ Ви вийшли з квартири.');
        default: return self::botMenu($from, $chat, $lang, $mid);
      }
    } catch (HttpError $e) {
      return self::botMenu($from, $chat, $lang, $mid, '⚠️ ' . ($e->err === 'place_not_synced' ? ($ru ? 'Квартира ещё не сохранилась на сервере — откройте «передай» и попробуйте снова.' : 'Квартира ще не збереглась на сервері — відкрийте «передай» і спробуйте знову.')
        : ($e->err === 'share_full' ? ($ru ? 'В квартире уже 8 человек.' : 'У квартирі вже 8 людей.') : ($ru ? 'Не получилось — попробуйте ещё раз.' : 'Не вийшло — спробуйте ще раз.'))));
    }
  }

  public static function summary(): array {
    try { self::table();
      return ['shares' => (int)(Db::one('SELECT COUNT(*) AS n FROM shares')['n'] ?? 0), 'people' => (int)(Db::one("SELECT COUNT(*) AS n FROM share_members WHERE role = 'member'")['n'] ?? 0),
        'invites7' => (int)(Db::one('SELECT COUNT(*) AS n FROM share_invites WHERE created_at > ?', [time() - 7 * 86400])['n'] ?? 0),
        'joined7' => (int)(Db::one('SELECT COUNT(*) AS n FROM share_invites WHERE used_at > ?', [time() - 7 * 86400])['n'] ?? 0),
        'stale' => (int)(Db::one('SELECT COUNT(DISTINCT m.share_id) AS n FROM share_members m JOIN user_state s ON s.user_id = m.user_id WHERE s.version <> m.ver')['n'] ?? 0)];
    } catch (Throwable $e) { return ['err' => 'db']; }
  }
}
