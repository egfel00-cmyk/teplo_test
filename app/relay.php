<?php
// Ретранслятор на NAS владельца (Украина). Обленерго не пускает наш сервер (Германия, Cloudflare по стране), а украинский адрес — пускает
// (UaCheck 07.11: кабинет и форма 200). Сервер ставит задания, NAS сам их забирает (GET /api/relay/next) — входящих портов на NAS нет —
// делает один запрос curl к сайту обленерго с домашнего адреса и возвращает сырой вывод (POST /api/relay/done). Думает сервер: что открыть,
// какие поля заполнить, принял ли сайт. NAS — исполнитель с белым списком адресов: чужой адрес не откроет, даже если сервер взломают.
// Позиция: подача только по кнопке, в окне приёма, ≥ GAP с между подачами, стоп на первом отказе (Cloudflare, капча, незнакомая страница).
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Relay {
  /** Версия сценария NAS: сценарий шлёт её в каждом запросе; /admin подскажет «обновите задачу», если старше. */
  const V = 1;
  /** Куда NAS вообще может ходить (начало адреса, со слешем — хост целиком). Тот же список вшит в сценарий. */
  const PREFIX = ['https://oblenergo.kharkiv.ua/', 'https://www.oblenergo.kharkiv.ua/', 'https://pa.oblenergo.kharkov.ua/', 'https://oblenergo.kharkov.ua/', 'https://www.oblenergo.kharkov.ua/'];
  const GAP = 60;          // секунд между подачами (один домашний адрес на всех)
  const STALE = 180;       // шаг выдан и не вернулся за 3 мин — сбой
  const ONLINE = 150;      // NAS спрашивал задания не позже — «на связи»
  const MAX_STEPS = 8;     // шагов на задание (редиректы, многошаговые формы)
  const ACCEPT = 'Accept: text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8';

  public static function prefixes(): array { $p = Cfg::get('relay_prefixes'); return is_array($p) && $p ? array_values(array_map('strval', $p)) : self::PREFIX; }
  public static function allowed(string $url): bool { foreach (self::prefixes() as $p) if (str_starts_with($url, $p)) return true; return false; }
  /** Адрес страницы: obl — кабинет, form — онлайн-форма (для стенда — relay_url_obl / relay_url_form в config.php). */
  public static function url(string $t): string { return (string)(Cfg::get('relay_url_' . $t) ?: RelayProbe::T[$t]['url']); }

  // ---------- настройки: токен NAS и пауза (SITE_DATA/uploads/settings/relay.json, 0600, не в git) ----------
  private static function file(): string { return Cfg::data() . '/uploads/settings/relay.json'; }
  public static function conf(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  private static function saveConf(array $c): void { @mkdir(dirname(self::file()), 0700, true); @file_put_contents(self::file(), json_encode($c, JSON_UNESCAPED_UNICODE), LOCK_EX); @chmod(self::file(), 0600); }
  public static function on(): bool { return (string)(self::conf()['token'] ?? '') !== ''; }
  /** Новый токен (старый перестаёт работать) + первое задание — проба обеих страниц. */
  public static function newToken(): void {
    $c = self::conf(); $c['token'] = bin2hex(random_bytes(20)); $c['at'] = time(); unset($c['paused']); self::saveConf($c);
    @unlink(self::seenFile());   // «на связи» — только у сценария с новым ключом
    if (!Db::one("SELECT id FROM relay_jobs WHERE kind = 'probe' AND state IN ('new', 'run')")) self::create('probe', [], null);
  }
  public static function off(): void { $c = self::conf(); unset($c['token']); self::saveConf($c); }
  public static function auth(string $k, string $ip): void {
    $t = (string)(self::conf()['token'] ?? '');
    if ($t !== '' && $k !== '' && hash_equals($t, $k)) return;
    RateLimit::hit('relay_bad', $ip); throw new HttpError(403, 'relay_key');
  }
  /** Стоп на первом отказе: дальше задания подачи не выдаются, пока владелец не нажмёт «Продолжить» в /admin. Проба — можно. */
  public static function pause(string $why, ?int $job): void { $c = self::conf(); $c['paused'] = ['at' => time(), 'why' => $why, 'job' => $job]; self::saveConf($c); }
  public static function resume(): void { $c = self::conf(); unset($c['paused']); self::saveConf($c); }

  // ---------- на связи ли NAS: время последнего вопроса, версия сценария, страна (CF-IPCountry; IP не пишем) ----------
  private static function seenFile(): string { return Cfg::data() . '/cache/relay_seen.json'; }
  public static function seenRead(): array { $j = json_decode((string)@file_get_contents(self::seenFile()), true); return is_array($j) ? $j : []; }
  private static function seen(int $v, string $cc): void {
    $s = self::seenRead(); $s['at'] = time(); $s['v'] = $v; $cc = strtoupper($cc); if (preg_match('/^[A-Z]{2}$/', $cc)) $s['cc'] = $cc; $s['first'] = $s['first'] ?? time();
    @mkdir(dirname(self::seenFile()), 0700, true); @file_put_contents(self::seenFile(), json_encode($s), LOCK_EX);
  }
  public static function online(): bool { $s = self::seenRead(); return isset($s['at']) && time() - (int)$s['at'] <= self::ONLINE; }

  // ---------- очередь ----------
  public static function create(string $kind, array $payload, ?int $user): int {
    $first = $kind === 'probe' ? ['t' => 'form'] : [];
    $req = self::req('GET', self::url('form'));   // проба — сначала форма, потом кабинет; подача — онлайн-форма (без пароля)
    Db::q('INSERT INTO relay_jobs (kind, user_id, payload, state, step, req, ctx, log, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)',
      [$kind, $user, json_encode($payload, JSON_UNESCAPED_UNICODE), 'new', json_encode($req), json_encode($first + ['url' => $req['u'], 'posts' => 0, 'hops' => 0]), '[]', time()]);
    return (int)Db::id();
  }
  public static function job(int $id): ?array {
    $j = Db::one('SELECT * FROM relay_jobs WHERE id = ?', [$id]); if (!$j) return null;
    foreach (['payload', 'req', 'ctx', 'log', 'result'] as $k) $j[$k] = $j[$k] === null ? null : json_decode((string)$j[$k], true);
    return $j;
  }
  private static function upd(int $id, array $set): void {
    $a = []; $v = [];
    foreach ($set as $k => $x) { $a[] = "$k = ?"; $v[] = is_array($x) ? json_encode($x, JSON_UNESCAPED_UNICODE) : $x; }
    $v[] = $id; Db::q('UPDATE relay_jobs SET ' . implode(', ', $a) . ' WHERE id = ?', $v);
  }
  /** Запрос шага: метод, адрес, заголовки (только из белого списка сценария), тело одной строкой (urlencoded — без переводов строк). */
  public static function req(string $m, string $u, array $h = [], ?string $b = null, ?string $ref = null): array {
    $h = array_merge([self::ACCEPT], $ref ? ['Referer: ' . $ref] : [], $h);
    return ['m' => $m, 'u' => $u, 'h' => array_values($h)] + ($b !== null ? ['b' => $b] : []);
  }
  private static function text(array $j): string {
    $q = $j['req']; $o = 'job ' . (int)$j['id'] . ' ' . (int)$j['step'] . "\nmethod " . $q['m'] . "\nurl " . $q['u'] . "\n";
    foreach ($q['h'] as $h) $o .= 'h ' . str_replace(["\r", "\n"], '', $h) . "\n";
    if (isset($q['b'])) $o .= 'body ' . str_replace(["\r", "\n"], '', (string)$q['b']) . "\n";
    return $o . 'last ' . (!empty($q['last']) ? 1 : 0) . "\n";
  }
  /** GET /api/relay/next (X-Relay-Key) → текст: «idle N» — подождать N с, или шаг задания. Один шаг за раз: NAS последовательный. */
  public static function next(int $v, string $cc): string {
    self::seen($v, $cc); $now = time();
    foreach (Db::q("SELECT id FROM relay_jobs WHERE state = 'run' AND taken_at < ?", [$now - self::STALE])->fetchAll() as $r) self::finish((int)$r['id'], 'fail', 'timeout', null);
    Db::q("UPDATE relay_jobs SET state = 'fail', err = 'expired', done_at = ? WHERE state = 'new' AND created_at < ?", [$now, $now - 86400]);
    if (Db::one("SELECT id FROM relay_jobs WHERE state = 'run'")) return "idle 3\n";
    $paused = isset(self::conf()['paused']);
    foreach (Db::q("SELECT id, kind, step FROM relay_jobs WHERE state = 'new' ORDER BY id")->fetchAll() as $r) {
      if ($r['kind'] === 'send' && $paused) continue;
      // между подачами — не чаще GAP: считаем от последнего шага любой подачи
      if ($r['kind'] === 'send' && (int)$r['step'] === 0) { $l = Db::one("SELECT MAX(done_at) AS t FROM relay_jobs WHERE kind = 'send' AND done_at IS NOT NULL"); if ($l && $l['t'] && $now - (int)$l['t'] < self::GAP) continue; }
      $j = self::job((int)$r['id']);
      if (!self::allowed((string)$j['req']['u'])) { self::finish((int)$j['id'], 'fail', 'offsite', ['url' => mb_substr((string)$j['req']['u'], 0, 120)]); continue; }
      self::upd((int)$j['id'], ['state' => 'run', 'taken_at' => $now]);
      return self::text($j);
    }
    // кто-то ждёт (подача отложена на GAP) — спросить скоро; иначе раз в 10 с
    return Db::one("SELECT id FROM relay_jobs WHERE state = 'new'") ? "idle 5\n" : "idle 10\n";
  }
  /** POST /api/relay/done?id=&s=[&e=] — сырой вывод curl -i (+ метка -w). e — NAS отказался (адрес не из белого списка). → «ok» / «ok end». */
  public static function done(int $id, int $s, string $raw, string $cc, string $e = ''): string {
    $j = self::job($id);
    if (!$j || $j['state'] !== 'run' || (int)$j['step'] !== $s) return "stale\n";
    $log = (array)$j['log'];
    if ($e !== '') { $log[] = ['s' => $s, 'refused' => mb_substr($e, 0, 20)]; self::upd($id, ['log' => $log]); self::finish($id, 'fail', 'nas_refused', null); self::pause('nas_refused', $id); return "ok end\n"; }
    $sp = RelayProbe::split($raw); $code = $sp['codes'] ? (int)end($sp['codes']) : (int)($sp['w']['code'] ?? 0);
    $u = (string)$j['req']['u']; $p = parse_url($u);
    $log[] = array_filter(['s' => $s, 'm' => $j['req']['m'], 'u' => ($p['host'] ?? '') . ($p['path'] ?? '/'), 'code' => $code, 'len' => strlen($sp['body']), 'sec' => $sp['w']['s'] ?? null], fn($x) => $x !== null);
    self::upd($id, ['log' => $log]);
    try { $r = self::advance($j, $raw, $sp, $code, strtoupper($cc)); }
    catch (Throwable $ex) { error_log('teplo relay: ' . $ex->getMessage()); $r = ['fail' => 'server', 'res' => null]; }
    if (isset($r['req'])) {
      if ($s + 1 >= self::MAX_STEPS) { self::finish($id, 'fail', 'too_many_steps', $r['res'] ?? null); self::pause('too_many_steps', $id); return "ok end\n"; }
      self::upd($id, ['state' => 'new', 'step' => $s + 1, 'req' => $r['req'], 'ctx' => $r['ctx'] ?? $j['ctx']]);
      return "ok\n";
    }
    if (isset($r['fail'])) { self::finish($id, 'fail', $r['fail'], $r['res'] ?? null); if (!empty($r['pause'])) self::pause($r['fail'], $id); }
    else self::finish($id, 'done', null, $r['res'] ?? null);
    return "ok end\n";
  }
  private static function finish(int $id, string $state, ?string $err, ?array $res): void {
    self::upd($id, ['state' => $state, 'err' => $err, 'done_at' => time()] + ($res !== null ? ['result' => $res] : []));
    $j = self::job($id); if ($j && $j['kind'] === 'send') self::notify($j);
  }
  /** Подача закончилась — сообщить в Telegram тому, кто нажал (если вошёл через Telegram). */
  private static function notify(array $j): void {
    if (!$j['user_id']) return;
    try {
      $tg = Db::one("SELECT external_id FROM user_identities WHERE user_id = ? AND type = 'telegram'", [(int)$j['user_id']]); if (!$tg) return;
      $p = (array)$j['payload']; $acc = (string)($p['acc'] ?? '');
      $txt = $j['state'] === 'done' ? '✅ Харківобленерго прийняв показання світла (рахунок ' . $acc . ').' : '⚠️ Показання світла не передано (рахунок ' . $acc . '): ' . ($j['result']['msg'] ?? $j['err'] ?? '') . '. Передайте самі: бот @Kooz2bot або форма на сайті обленерго.';
      Telegram::call('sendMessage', ['chat_id' => (string)$tg['external_id'], 'text' => $txt]);
    } catch (Throwable $e) { error_log('teplo relay notify: ' . $e->getMessage()); }
  }
  /** Следующий шаг по ответу сайта. → ['req' => …, 'ctx' => …] | ['fail' => код, 'pause' => bool, 'res' => …] | ['res' => …] (готово). */
  private static function advance(array $j, string $raw, array $sp, int $code, string $cc): array {
    $ctx = (array)$j['ctx']; $url = (string)$j['req']['u']; $body = $sp['body'];
    // редирект — сами идём дальше (NAS без -L: чужой хост в редиректе он бы открыл)
    if ($code >= 300 && $code < 400 && isset($sp['h']['location'])) {
      $to = CabWeb::abs((string)$sp['h']['location'], $url);
      if (!self::allowed($to)) return ['fail' => 'offsite', 'pause' => true, 'res' => ['to' => (string)parse_url($to, PHP_URL_HOST)]];
      if (($ctx['hops'] = (int)($ctx['hops'] ?? 0) + 1) > 3) return ['fail' => 'redirect_loop', 'pause' => true];
      $ctx['url'] = $to; return ['req' => self::req('GET', $to, [], null, $url), 'ctx' => $ctx];
    }
    $ctx['hops'] = 0;
    if ($j['kind'] === 'probe') {
      $t = (string)($ctx['t'] ?? 'form');
      $a = RelayProbe::accept($t, $raw, $cc, 'relay');
      $res = (array)($j['result'] ?? []); $res[$t] = $a['verdict'];
      if ($t === 'form' && $a['verdict'] === 'ok') $res['plan'] = RelayForm::brief(RelayForm::plan($body, $ctx['url'] ?? $url, ['acc' => '0', 'zones' => ['all' => '0']]));
      self::upd((int)$j['id'], ['result' => $res]);
      if ($t === 'form') { $u = self::url('obl'); return ['req' => self::req('GET', $u), 'ctx' => ['t' => 'obl', 'url' => $u, 'hops' => 0]]; }
      return ['res' => $res];
    }
    // подача и сухая проверка: отказ сайта — стоп для всех (пауза), ошибка в данных человека — только это задание
    if ($code === 0) return ['fail' => 'down', 'res' => ['w' => $sp['w']]];
    $hh = array_filter(['server' => strtolower((string)($sp['h']['server'] ?? '')), 'cf-mitigated' => strtolower((string)($sp['h']['cf-mitigated'] ?? ''))], fn($v) => $v !== '');
    $cf = CabWeb::cfKind($body, $code, $hh);
    if ($cf) return ['fail' => 'cloudflare', 'pause' => true, 'res' => $cf];
    $cap = CabWeb::captcha($body, $code);
    if ($cap['widget'] || $cap['cf']) return ['fail' => 'captcha', 'pause' => true, 'res' => $cap];
    $p = (array)$j['payload']; $posts = (int)($ctx['posts'] ?? 0);
    if ($posts > 0) {
      $v = RelayForm::verdict($sp);
      if ($v['kind'] === 'ok') return ['res' => ['msg' => $v['msg'] ?? null, 'code' => $code]];
      if ($v['kind'] === 'err') return ['fail' => 'site_err', 'res' => ['msg' => $v['msg'] ?? null, 'code' => $code]];
      if ($v['kind'] !== 'form' || $posts >= 3) return ['fail' => 'unknown_page', 'pause' => true, 'res' => ['code' => $code, 'skel' => RelayForm::skel($body)]];
    }
    $plan = RelayForm::plan($body, $url, $p);
    if (!$plan['ok']) return ['fail' => $plan['err'], 'pause' => true, 'res' => RelayForm::brief($plan) + ['code' => $code, 'skel' => RelayForm::skel($body)]];
    if ($j['kind'] === 'dry') return ['res' => RelayForm::brief($plan) + ['pairs' => $plan['pairs'], 'code' => $code]];
    $ctx['posts'] = $posts + 1; $ctx['url'] = $plan['action'];
    $pu = parse_url($plan['action']); $origin = ($pu['scheme'] ?? 'https') . '://' . ($pu['host'] ?? '') . (isset($pu['port']) ? ':' . $pu['port'] : '');
    $enc = implode('&', array_map(fn($x) => rawurlencode((string)$x[0]) . '=' . rawurlencode((string)$x[1]), $plan['pairs']));
    if ($plan['method'] === 'get') { $to = $plan['action'] . (str_contains($plan['action'], '?') ? '&' : '?') . $enc; return ['req' => self::req('GET', $to, [], null, $url), 'ctx' => $ctx]; }
    return ['req' => self::req('POST', $plan['action'], ['Content-Type: application/x-www-form-urlencoded', 'Origin: ' . $origin], $enc, $url), 'ctx' => $ctx];
  }

  /** Окно приёма показаний света (Харківобленерго): предпоследний день месяца — 3-е число, по Киеву. */
  public static function elecWin(?int $now = null): bool {
    $d = new DateTimeImmutable('@' . ($now ?? time())); $d = $d->setTimezone(new DateTimeZone('Europe/Kyiv'));
    $day = (int)$d->format('j'); return $day <= 3 || $day >= (int)$d->format('t') - 1;
  }
  /** /admin → «Отправить показания света через NAS» / «Проверить без отправки». Пока — только админы (свой и мамин рахунок). */
  public static function send(array $in, array $me, bool $dry): array {
    if (!self::on()) throw new HttpError(409, 'relay_off');
    $acc = preg_replace('/\D/', '', (string)($in['acc'] ?? '')); if (strlen($acc) < 5 || strlen($acc) > 20) throw new HttpError(422, 'bad_acc');
    $z = []; foreach (['all', 'day', 'night', 'peak', 'half'] as $k) if (isset($in['zones'][$k]) && trim((string)$in['zones'][$k]) !== '') {
      $v = str_replace(',', '.', trim((string)$in['zones'][$k])); if (!preg_match('/^\d{1,7}(\.\d{1,2})?$/', $v)) throw new HttpError(422, 'bad_value', ['zone' => $k]); $z[$k] = $v;
    }
    $ks = array_keys($z); sort($ks);
    if (!in_array($ks, [['all'], ['day', 'night'], ['half', 'night', 'peak']], true)) throw new HttpError(422, 'bad_zones', ['need' => 'all | day+night | peak+half+night']);
    if (!$dry) {
      if (isset(self::conf()['paused'])) throw new HttpError(409, 'relay_paused', ['paused' => self::conf()['paused']]);
      if (!self::elecWin() && empty($in['force'])) throw new HttpError(409, 'window_closed');
      if (Db::one("SELECT id FROM relay_jobs WHERE kind = 'send' AND state IN ('new', 'run')")) throw new HttpError(409, 'busy');
    }
    $id = self::create($dry ? 'dry' : 'send', ['acc' => $acc, 'zones' => $z] + (!empty($in['serial']) ? ['serial' => preg_replace('/[^\w\-]/u', '', (string)$in['serial'])] : []), (int)$me['id']);
    return ['ok' => true, 'id' => $id, 'online' => self::online()];
  }
  public static function jobs(int $n = 12): array {
    $out = [];
    foreach (Db::q('SELECT id FROM relay_jobs ORDER BY id DESC LIMIT ' . max(1, min(50, $n)))->fetchAll() as $r) {
      $j = self::job((int)$r['id']);
      $out[] = ['id' => (int)$j['id'], 'kind' => $j['kind'], 'state' => $j['state'], 'err' => $j['err'], 'step' => (int)$j['step'], 'user' => $j['user_id'] ? (int)$j['user_id'] : null,
        'payload' => $j['payload'], 'result' => $j['result'], 'log' => $j['log'], 'at' => (int)$j['created_at'], 'done' => $j['done_at'] ? (int)$j['done_at'] : null];
    }
    return $out;
  }
  /** /api/health → relay: включён ли, на связи ли, пауза, задания по состояниям — без токена и без рахунков. */
  public static function summary(): array {
    $s = self::seenRead(); $c = self::conf(); $st = [];
    try { foreach (Db::q('SELECT state, COUNT(*) AS n FROM relay_jobs GROUP BY state')->fetchAll() as $r) $st[$r['state']] = (int)$r['n']; } catch (Throwable $e) {}
    $last = null; try { $l = Db::one('SELECT id, kind, state, err, created_at FROM relay_jobs ORDER BY id DESC LIMIT 1'); if ($l) $last = ['id' => (int)$l['id'], 'kind' => $l['kind'], 'state' => $l['state'], 'err' => $l['err'], 'at' => gmdate('c', (int)$l['created_at'])]; } catch (Throwable $e) {}
    return ['on' => self::on(), 'v' => $s['v'] ?? null, 'cc' => $s['cc'] ?? null, 'seenAgo' => isset($s['at']) ? time() - (int)$s['at'] : null, 'online' => self::online(),
      'paused' => isset($c['paused']) ? ['why' => $c['paused']['why'], 'at' => gmdate('c', (int)$c['paused']['at'])] : null, 'jobs' => (object)$st, 'last' => $last, 'win' => self::elecWin()];
  }
  /** /admin: всё для блока «Ретранслятор (NAS)», в т.ч. сценарий с токеном (только админам). */
  public static function admin(string $base): array {
    $c = self::conf(); $tok = (string)($c['token'] ?? '');
    return self::summary() + ['V' => self::V, 'script' => $tok !== '' ? self::script($base, $tok) : null, 'tokenAt' => isset($c['at']) ? gmdate('c', (int)$c['at']) : null,
      'pausedJob' => $c['paused']['job'] ?? null, 'jobsList' => self::jobs(), 'gap' => self::GAP];
  }

  /** Сценарий для задачи DSM (sh/BusyBox, раз в минуту): спрашивает задания ~50 с, выполняет по одному, только адреса из белого списка. */
  public static function script(string $base, string $token): string {
    $base = rtrim($base, '/'); $P = implode(' ', self::prefixes()); $_v = self::V;
    $ua = 'Mozilla/5.0 (compatible; Lichylnyky/1.0; +' . $base . '/)';
    return <<<SH
#!/bin/sh
# Лічильники — ретранслятор показань світла (v{$_v}). Задача DSM раз у хвилину; вхідних портів не треба:
# сам питає завдання в {$base}, ходить ЛИШЕ на сайти обленерго (список P), повертає відповідь сайту.
K='{$token}'
S='{$base}'
V={$_v}
P='{$P}'
UA='{$ua}'
D=/tmp/lichylnyky
mkdir -p "\$D" && chmod 700 "\$D" || exit 1
if ! mkdir "\$D/lock" 2>/dev/null; then
  [ -n "\$(find "\$D/lock" -maxdepth 0 -mmin +3 2>/dev/null)" ] || exit 0
  rm -rf "\$D/lock"; mkdir "\$D/lock" || exit 0
fi
trap 'rm -rf "\$D/lock"' EXIT
trap 'exit 1' INT TERM
find "\$D" -maxdepth 1 -name 'j*' -mmin +60 -exec rm -f {} \; 2>/dev/null
T0=\$(date +%s)
while [ \$((\$(date +%s) - T0)) -lt 50 ]; do
  curl -s -m 20 -H "X-Relay-Key: \$K" -o "\$D/job" "\$S/api/relay/next?v=\$V" || { sleep 10; continue; }
  a=''; read -r a id st < "\$D/job"; [ -n "\$a" ] || { sleep 10; continue; }
  case "\$a" in
    idle) case "\$id" in ''|*[!0-9]*) id=10;; esac; [ "\$id" -gt 20 ] && id=20; sleep "\$id"; continue;;
    job) ;;
    *relay_key*) exit 0;;
    *) sleep 10; continue;;
  esac
  case "\$id\$st" in ''|*[!0-9]*) sleep 5; continue;; esac
  m=GET; u=''; l=0; e=''; : > "\$D/h"; rm -f "\$D/b"
  tail -n +2 "\$D/job" > "\$D/rest"
  while IFS= read -r ln; do
    k=\${ln%% *}; v=\${ln#* }
    case "\$k" in
      method) case "\$v" in GET|POST) m=\$v;; *) e=method;; esac;;
      url) u=\$v; ok=''; for p in \$P; do case "\$u" in "\$p"*) ok=1;; esac; done; [ -n "\$ok" ] || e=host;;
      h) case "\$v" in 'Accept: '*|'Content-Type: '*|'Referer: '*|'Origin: '*|'X-Requested-With: '*|'X-CSRF-Token: '*) printf '%s\\n' "\$v" >> "\$D/h";; *) e=header;; esac;;
      body) printf '%s' "\$v" > "\$D/b";;
      last) l=\$v;;
    esac
  done < "\$D/rest"
  [ -n "\$u" ] || e=\${e:-nourl}
  if [ -n "\$e" ]; then
    curl -s -m 20 -H "X-Relay-Key: \$K" -H 'Content-Type: text/plain' --data-binary "refused \$e" "\$S/api/relay/done?id=\$id&s=\$st&e=\$e&v=\$V" > /dev/null
    rm -f "\$D/j\$id"; continue
  fi
  if [ -f "\$D/b" ]; then
    curl -s -i -g -m 25 -A "\$UA" -b "\$D/j\$id" -c "\$D/j\$id" -H 'Accept-Language: uk-UA,uk;q=0.9' -H @"\$D/h" -X "\$m" --data-binary @"\$D/b" -w '\\n#lichylnyky %{http_code} %{num_redirects} %{time_total}\\n' "\$u" > "\$D/out" 2>/dev/null
  else
    curl -s -i -g -m 25 -A "\$UA" -b "\$D/j\$id" -c "\$D/j\$id" -H 'Accept-Language: uk-UA,uk;q=0.9' -H @"\$D/h" -w '\\n#lichylnyky %{http_code} %{num_redirects} %{time_total}\\n' "\$u" > "\$D/out" 2>/dev/null
  fi
  r=\$(curl -s -m 30 -H "X-Relay-Key: \$K" -H 'Content-Type: text/plain' --data-binary @"\$D/out" "\$S/api/relay/done?id=\$id&s=\$st&v=\$V")
  case "\$r" in *end*) rm -f "\$D/j\$id";; esac
  [ "\$l" = 1 ] && rm -f "\$D/j\$id"
  rm -f "\$D/out" "\$D/b"
done
SH;
  }
}

/** Разбор страниц обленерго для подачи: какие поля — рахунок, показання по зонам, согласие; что осталось непонятным; принял ли сайт. */
final class RelayForm {
  /** Роль поля по имени и подписи (порядок важен: «напівпік» раньше «пік», «номер лічильника» раньше «показання лічильника»). */
  const ROLE = [
    'acc' => '/особов|рахун|лицев|абонент|account|\bacc\b|\bls\b|personal_?(?:acc|num)|ls_?num|\beic\b/u',
    'serial' => '/номер\s+лічильн|номер\s+счетчик|№\s*лічильн|заводськ|заводск|serial|counter_?num|meter_?num|meter_?no/u',
    'half' => '/напівпік|полупик|half/u',
    'peak' => '/(?<!напів)пік|(?<!полу)пик|peak/u',
    'night' => '/ніч|ноч|night|\bt2\b|zone_?2|зона\s*2/u',
    'day' => '/денн|день|\bday\b|\bt1\b|zone_?1|зона\s*1/u',
    'all' => '/показ|pokaz|indicat|reading|value|counter|лічильн|счетч|квт|kwh/u',
    'consent' => '/згод|погоджу|соглас|consent|agree|персональн/u',
  ];
  public static function role(string $name, string $label): ?string {
    $s = mb_strtolower($label . ' ' . preg_replace('/[\[\]]/', ' ', $name));
    foreach (self::ROLE as $r => $re) if (preg_match($re, $s)) return $r;
    return null;
  }
  private static function label(DOMXPath $x, DOMElement $e): string {
    $id = (string)$e->getAttribute('id'); $t = '';
    if ($id !== '') foreach ($x->query("//label[@for='" . str_replace("'", '', $id) . "']") as $l) $t .= ' ' . $l->textContent;
    for ($p = $e->parentNode; $t === '' && $p instanceof DOMElement; $p = $p->parentNode) if (strtolower($p->nodeName) === 'label') $t = $p->textContent;
    foreach (['placeholder', 'aria-label', 'title'] as $a) $t .= ' ' . $e->getAttribute($a);
    return CabWeb::sp($t);
  }
  /** Поля формы: [{n, type, v, req, role, opts?, checked?}] (в порядке документа; кнопки — отдельно). */
  public static function fields(DOMXPath $x, DOMElement $f): array {
    $out = []; $id = (string)$f->getAttribute('id');
    $q = './/input|.//select|.//textarea|.//button' . ($id !== '' ? "|//*[@form='" . str_replace("'", '', $id) . "']" : '');
    foreach ($x->query($q, $f) as $e) {
      if (!$e instanceof DOMElement || $e->hasAttribute('disabled')) continue;
      $tag = strtolower($e->nodeName); $n = (string)$e->getAttribute('name');
      $type = $tag === 'input' ? strtolower($e->getAttribute('type') ?: 'text') : ($tag === 'button' ? 'submit:' . strtolower($e->getAttribute('type') ?: 'submit') : $tag);
      $o = ['n' => $n, 'type' => $type, 'v' => (string)$e->getAttribute('value'), 'req' => $e->hasAttribute('required') || $e->getAttribute('aria-required') === 'true'];
      if ($tag === 'select') { $o['opts'] = []; $sel = null; foreach ($x->query('.//option', $e) as $op) if ($op instanceof DOMElement) { $v = $op->hasAttribute('value') ? (string)$op->getAttribute('value') : CabWeb::sp($op->textContent); $o['opts'][] = [$v, CabWeb::sp($op->textContent)]; if ($op->hasAttribute('selected')) $sel = $v; } $o['v'] = $sel ?? ($o['opts'][0][0] ?? ''); }
      if ($tag === 'textarea') $o['v'] = (string)$e->textContent;
      if (in_array($type, ['checkbox', 'radio'], true)) $o['checked'] = $e->hasAttribute('checked');
      $o['role'] = in_array($type, ['hidden', 'submit:submit', 'submit:button', 'submit:reset', 'submit', 'button', 'reset', 'image'], true) ? null : self::role($n, self::label($x, $e));
      $out[] = $o;
    }
    return $out;
  }
  /** Что и куда слать. p = ['acc', 'zones' => [all | day+night | peak+half+night], 'serial'?]. → ['ok', 'err'?, 'action', 'method', 'pairs' => [[имя, значение]…], 'roles', 'unknown', 'missing'] */
  public static function plan(string $html, string $url, array $p): array {
    if (!preg_match('/<form\b/i', $html)) return ['ok' => false, 'err' => preg_match('/<(input|select|textarea)\b/i', $html) ? 'js_form' : 'no_form', 'roles' => [], 'unknown' => [], 'missing' => []];
    $x = CabWeb::dom($html); $best = null; $bestS = -1; $bestF = [];
    foreach ($x->query('//form') as $f) {
      if (!$f instanceof DOMElement) continue; $fs = self::fields($x, $f); $s = 0;
      foreach ($fs as $o) $s += match ($o['role']) { 'acc' => 4, 'all', 'day', 'night', 'peak', 'half' => 2, null => 0, default => 1 };
      if (preg_match('/password/', implode(' ', array_column($fs, 'type')))) $s -= 5;   // форма входа в кабинет — не наша
      if ($s > $bestS) { $bestS = $s; $best = $f; $bestF = $fs; }
    }
    if (!$best || $bestS < 2) return ['ok' => false, 'err' => 'no_form', 'roles' => [], 'unknown' => [], 'missing' => []];
    $z = (array)($p['zones'] ?? []); $roles = []; $pairs = []; $unknown = []; $used = []; $submit = null; $noVal = [];
    $readF = array_values(array_filter($bestF, fn($o) => in_array($o['role'], ['all', 'day', 'night', 'peak', 'half'], true)));
    $onlyOne = count($readF) === 1;
    foreach ($bestF as $o) {
      $n = $o['n']; $t = $o['type'];
      if (str_starts_with($t, 'submit') || $t === 'image') { if ($submit === null && $n !== '' && $t !== 'submit:button' && $t !== 'submit:reset') $submit = [$n, $o['v']]; continue; }
      if ($n === '') continue;
      if ($t === 'hidden') { $pairs[] = [$n, $o['v']]; continue; }
      $r = $o['role']; $val = null;
      if ($r === 'acc') $val = (string)($p['acc'] ?? '');
      elseif ($r === 'serial') $val = isset($p['serial']) ? (string)$p['serial'] : null;
      elseif (in_array($r, ['all', 'day', 'night', 'peak', 'half'], true)) {
        // одно поле показаний на всю форму — однозонный (или всё в одном поле); иначе — по зонам
        $uk = $onlyOne && count($z) === 1 ? (string)array_key_first($z) : (isset($z[$r]) ? $r : ($r === 'day' && isset($z['all']) ? 'all' : null));
        if ($uk !== null) { $val = (string)$z[$uk]; $used[$uk] = 1; }
      }
      elseif ($r === 'consent') { if (in_array($t, ['checkbox', 'radio'], true)) { $pairs[] = [$n, $o['v'] !== '' ? $o['v'] : 'on']; $roles[$n] = 'consent'; } continue; }
      if ($t === 'checkbox' || $t === 'radio') { if (!empty($o['checked'])) $pairs[] = [$n, $o['v'] !== '' ? $o['v'] : 'on']; if ($o['req'] && empty($o['checked'])) $unknown[] = $n; continue; }
      if ($t === 'select' && $val === null) {
        // выбор зонности счётчика («Однозонний / Двозонний …») — по числу зон, иначе как стоит
        $nz = max(1, min(3, count($z))); $pick = null;
        if (preg_match('/зон|zone|тариф|tarif/u', mb_strtolower($n . ' ' . implode(' ', array_column($o['opts'] ?? [], 1))))) foreach ($o['opts'] ?? [] as [$ov, $ot]) if (preg_match('/(^|\D)' . $nz . '(\D|$)|' . ['', 'одно|одн', 'дво|дву', 'тр'][$nz] . '/u', mb_strtolower($ov . ' ' . $ot))) { $pick = $ov; break; }
        $pairs[] = [$n, $pick ?? $o['v']]; if ($pick !== null) $roles[$n] = 'zones'; continue;
      }
      // поле показаний есть, а цифры для этой зоны нет (двозонна форма, а у нас одна цифра) — не хватает данных, а не непонятное поле
      if ($val === null && in_array($r, ['all', 'day', 'night', 'peak', 'half'], true)) { $noVal[] = $r; continue; }
      if ($val === null) { if ($o['req'] || $r !== null) $unknown[] = $n . ($r ? ':' . $r : ''); else $pairs[] = [$n, $o['v']]; continue; }
      $pairs[] = [$n, $val]; $roles[$n] = $r;
    }
    if ($submit) $pairs[] = $submit;
    $have = array_values($roles); $missing = [];
    if (!in_array('acc', $have, true)) $missing[] = 'acc';
    foreach (array_keys($z) as $k) if (!isset($used[$k])) $missing[] = $k;
    $missing = array_values(array_unique(array_merge($missing, $noVal)));
    $act = trim((string)$best->getAttribute('action')); $action = CabWeb::abs($act !== '' ? $act : $url, $url);
    $o = ['action' => $action, 'method' => strtolower($best->getAttribute('method') ?: 'get') === 'post' ? 'post' : 'get', 'pairs' => $pairs, 'roles' => $roles, 'unknown' => $unknown, 'missing' => $missing];
    // рахунок есть, а полей показаний нет — первый шаг двухшаговой формы (рахунок → показання): шлём рахунок, дальше посмотрим
    $accOnly = !$readF && in_array('acc', $have, true) && !$unknown;
    if ($accOnly) return ['ok' => true, 'step' => 'acc'] + $o;
    if ($unknown) return ['ok' => false, 'err' => 'unknown_fields'] + $o;
    if ($missing) return ['ok' => false, 'err' => 'missing'] + $o;
    if (!Relay::allowed($action)) return ['ok' => false, 'err' => 'offsite'] + $o;
    return ['ok' => true] + $o;
  }
  /** Коротко для /admin и журнала: роли полей, непонятные, чего не хватает — без значений. */
  public static function brief(array $pl): array {
    return array_filter(['ok' => $pl['ok'], 'err' => $pl['err'] ?? null, 'step' => $pl['step'] ?? null, 'method' => $pl['method'] ?? null,
      'action' => isset($pl['action']) ? ((string)parse_url($pl['action'], PHP_URL_HOST) . (string)parse_url($pl['action'], PHP_URL_PATH)) : null,
      'roles' => $pl['roles'] ?: null, 'unknown' => $pl['unknown'] ?: null, 'missing' => $pl['missing'] ?: null,
      'fields' => isset($pl['pairs']) ? array_map(fn($x) => $x[0], $pl['pairs']) : null], fn($v) => $v !== null);
  }
  const OK_RE = '/показ\S*\s+(?:успішно\s+)?(?:прийнят|збережен|передан|отриман|внесен|принят|сохранен)|дякуємо|успішн|успешн|thank\s*you|success/u';
  const ERR_RE = '/помилк|невірн|не\s+вірн|не\s+знайден|некорект|не\s+прийнят|ошибк|неверн|не\s+найден|не\s+принят|error|invalid/u';
  /** Ответ сайта после отправки → ['kind' => ok|err|form|unknown, 'msg' => текст (цифры → #)]. */
  public static function verdict(array $sp): array {
    $b = $sp['body']; $ct = strtolower((string)($sp['h']['content-type'] ?? ''));
    if (str_contains($ct, 'json') || preg_match('/^\s*[\{\[]/', $b)) {
      $j = json_decode($b, true);
      if (is_array($j)) {
        $flat = []; array_walk_recursive($j, function ($v, $k) use (&$flat) { $flat[] = $k . ': ' . (is_bool($v) ? ($v ? 'true' : 'false') : (string)$v); }); $s = mb_strtolower(implode(' | ', $flat));
        $bad = !empty($j['error']) || !empty($j['errors']) || (isset($j['success']) && $j['success'] === false) || (isset($j['status']) && in_array($j['status'], [false, 'error', 'fail'], true));
        $good = (isset($j['success']) && $j['success'] === true) || (isset($j['status']) && in_array($j['status'], [true, 'ok', 'success'], true)) || preg_match(self::OK_RE, $s);
        return ['kind' => $bad ? 'err' : ($good ? 'ok' : 'unknown'), 'msg' => CabWeb::mask(implode(' | ', $flat), 200)];
      }
    }
    if (!preg_match('/<(?:html|body|div|p|form)\b/i', $b)) return ['kind' => 'unknown', 'msg' => CabWeb::mask(strip_tags($b), 120)];
    $x = CabWeb::dom($b);
    foreach ($x->query('//script|//style|//noscript') as $n) $n->parentNode->removeChild($n);
    $cls = fn(string $c) => "//*[contains(concat(' ', normalize-space(@class), ' '), ' $c ')]";
    $msg = function (string $q) use ($x): string { $t = ''; foreach ($x->query($q) as $n) $t .= ' ' . $n->textContent; return CabWeb::sp($t); };
    $err = $msg(implode('|', array_map($cls, ['alert-danger', 'alert-error', 'error-summary', 'help-block-error', 'invalid-feedback', 'has-error', 'error', 'text-danger'])));
    $ok = $msg(implode('|', array_map($cls, ['alert-success', 'success', 'text-success', 'alert-info'])));
    if ($err !== '' && preg_match('/\w/u', $err)) return ['kind' => 'err', 'msg' => CabWeb::mask($err, 200)];
    if ($ok !== '' && preg_match(self::OK_RE, mb_strtolower($ok))) return ['kind' => 'ok', 'msg' => CabWeb::mask($ok, 200)];
    $all = mb_strtolower(CabWeb::sp($x->query('//body')->item(0)?->textContent ?? $b));
    // форма с полями показаний снова — следующий шаг (рахунок принят, теперь цифры); ошибки при этом ищем выше
    foreach ($x->query('//form') as $f) if ($f instanceof DOMElement) foreach (RelayForm::fields($x, $f) as $o) if (in_array($o['role'], ['all', 'day', 'night', 'peak', 'half'], true)) return ['kind' => 'form'];
    if (preg_match(self::OK_RE, $all, $m)) return ['kind' => 'ok', 'msg' => CabWeb::mask(mb_substr($all, max(0, mb_strpos($all, $m[0]) - 60), 200), 200)];
    if (preg_match(self::ERR_RE, $all, $m)) return ['kind' => 'err', 'msg' => CabWeb::mask(mb_substr($all, max(0, mb_strpos($all, $m[0]) - 60), 200), 200)];
    return ['kind' => 'unknown'];
  }
  /** Скелет незнакомой страницы для /admin: формы и поля, без текста (как у Водоканала). */
  public static function skel(string $html): ?string {
    if (!preg_match('/<(?:html|body|form|div)\b/i', $html)) return null;
    $x = CabWeb::dom($html); $root = $x->query('//body')->item(0);
    return $root instanceof DOMElement ? mb_substr(VkCab::skel($root, '', '', 0), 0, 6000) : null;
  }
}
