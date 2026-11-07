<?php
// Вода → сайт Водоканалу «у фоні» и автоподача после фото в бот, над VkCab (app/vkcab.php).
//  «Відправити у фоні» (по нажатию человека): показания ставятся в очередь сервера, cron в ближайшую минуту входит на сайт Водоканалу
//  рахунком и прізвищем, вносит и пишет в Telegram «✅ прийняв» / «❌ не прийняв» / «⚠️ не надіслали». Человек может закрыть приложение.
//  Автоподача (по отдельному согласию, переключатель в «Налаштуваннях» → «Кабінети й автовідправка»): фото холодного водомера в бот →
//  приложение распознало уверенно, все проверки пройдены → очередь на AUTO_DELAY секунд (Telegram «📝 надішлемо о HH:MM», можно скасувати).
//  Рахунок и прізвище хранятся только в строке очереди (прізвище — зашифровано CabVault) и стираются, как только отправка закончилась.
//  GET  /api/vk/jobs                 → согласие на автоподачу, последние отправки
//  POST /api/vk/queue                {acc, fam, rid, place, items: [{key?, value, serial?, kind?, name?}], auto?} — в очередь
//  POST /api/vk/auto {on, consent}   · POST /api/vk/job/cancel {job} · POST /api/vk/job/now {job} · POST /api/cab/forget {prov: 'vk'}
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class VkSvc {
  const PROV = 'vk';
  /** «Сайт не відповідає» — сколько раз ещё пробуем (через 15 минут), прежде чем сказать «не надіслали». */
  const DOWN_TRIES = 3;
  public static function autoDelay(): int { return max(60, (int)Cfg::get('vk_auto_delay', 600)); }
  private static string $lang = 'uk';
  private static function lang(array $in): void { self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk'; VkCab::lang(self::$lang); }
  private static function h(string $k): string {
    $ru = self::$lang === 'ru';
    return [
      'consent' => $ru ? 'Чтобы отправлять показания воды самим после фото в бот, нужно ваше согласие — отметьте галочку.' : 'Щоб надсилати показання води самим після фото в бот, потрібна ваша згода — поставте позначку.',
      'auto_off' => $ru ? 'Автоотправка воды выключена — отправьте кнопкой.' : 'Автовідправку води вимкнено — надішліть кнопкою.',
      'no_job' => $ru ? 'Эта отправка уже не в очереди.' : 'Це надсилання вже не в черзі.',
      'items' => $ru ? 'Нечего отправлять: нет показаний.' : 'Нічого надсилати: немає показань.',
      'down' => $ru ? 'Сайт Водоканала не отвечал несколько раз подряд.' : 'Сайт Водоканалу не відповідав кілька разів поспіль.',
      'lost' => $ru ? 'Данные для входа на сайт Водоканала потерялись — отправьте ещё раз.' : 'Дані для входу на сайт Водоканалу загубилися — надішліть ще раз.',
    ][$k];
  }
  private static function js(?string $s): array { $j = json_decode((string)$s, true); return is_array($j) ? $j : []; }
  private static function creds(int $uid): ?array { return Db::one('SELECT * FROM cab_creds WHERE user_id = ? AND prov = ?', [$uid, self::PROV]); }
  public static function autoOn(int $uid): bool { $c = self::creds($uid); return $c && !empty(self::js($c['extra'])['auto']); }

  public static function pubJob(array $j): array {
    $p = self::js($j['payload']); $r = self::js($j['result']);
    return ['id' => (int)$j['id'], 'acc' => $j['acc'], 'rid' => $p['rid'] ?? null, 'place' => $p['place'] ?? null, 'items' => array_map(fn($x) => ['name' => $x['name'], 'value' => $x['value'], 'kind' => $x['kind'] ?? null], (array)($p['items'] ?? [])),
      'status' => $j['status'], 'text' => $r['text'] ?? '', 'why' => $r['why'] ?? null, 'human' => $r['human'] ?? null, 'auto' => !empty($p['auto']),
      'at' => strtotime((string)$j['created_at']) ?: null, 'doneAt' => $r['doneAt'] ?? null, 'nextAt' => in_array($j['status'], ['queued', 'sending'], true) ? (int)$j['next_at'] : null];
  }
  /** GET /api/vk/jobs */
  public static function status(int $uid): array {
    $c = self::creds($uid); $ex = $c ? self::js($c['extra']) : [];
    $jobs = Db::q('SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? ORDER BY id DESC LIMIT 12', [$uid, self::PROV])->fetchAll();
    return ['auto' => !empty($ex['auto']), 'autoAt' => $ex['autoAt'] ?? null, 'autoDelay' => self::autoDelay(), 'send' => VkCab::ready(), 'jobs' => array_map([self::class, 'pubJob'], $jobs)];
  }
  /** POST /api/vk/auto {on, consent} — включить (с согласием) / выключить автоотправку воды; выключение отменяет очередь автоподачи. */
  public static function auto(int $uid, array $in): array {
    self::lang($in); $on = ($in['on'] ?? false) === true;
    if ($on && ($in['consent'] ?? false) !== true) throw new HttpError(422, 'vk_consent', ['human' => self::h('consent')]);
    $c = self::creds($uid); $ex = $c ? self::js($c['extra']) : [];
    if ($on) $ex = ['auto' => true, 'autoAt' => gmdate('c'), 'consentAt' => gmdate('c'), 'lang' => self::$lang] + $ex; else unset($ex['auto'], $ex['autoAt']);
    $e = json_encode($ex, JSON_UNESCAPED_UNICODE);
    if ($c) Db::q('UPDATE cab_creds SET extra = ?, checked_at = ? WHERE user_id = ? AND prov = ?', [$e, Http::iso(), $uid, self::PROV]);
    elseif ($on) Db::q("INSERT INTO cab_creds (user_id, prov, login, secret, extra, state, info, created_at, checked_at) VALUES (?, ?, '', '', ?, 'ok', NULL, ?, ?)", [$uid, self::PROV, $e, Http::iso(), Http::iso()]);
    if (!$on) self::cancelAuto($uid, 'auto_off');
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'vk_auto_' . ($on ? 'on' : 'off'), null, Http::iso()]);
    return ['ok' => true] + self::status($uid);
  }
  private static function cancelAuto(int $uid, string $why): void {
    foreach (Db::q("SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? AND status = 'queued'", [$uid, self::PROV])->fetchAll() as $j) {
      $p = self::js($j['payload']); if (empty($p['auto']) && $why === 'auto_off') continue;
      self::finish((int)$j['id'], 'cancelled', ['why' => $why]);
    }
  }
  /** POST /api/cab/forget {prov: 'vk'} — забыть согласие на автоотправку и отменить всё, что ждёт в очереди. */
  public static function forget(int $uid): array {
    Db::q('DELETE FROM cab_creds WHERE user_id = ? AND prov = ?', [$uid, self::PROV]);
    self::cancelAuto($uid, 'forgot');
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'vk_forget', null, Http::iso()]);
    return ['ok' => true] + self::status($uid);
  }

  /** POST /api/vk/queue — «Відправити у фоні» (сразу, cron в ближайшую минуту) или автоподача (auto: через autoDelay, только с согласием). Повтор — то же. */
  public static function queue(int $uid, array $in): array {
    self::lang($in);
    [$acc, $fam] = VkCab::input($in);
    $items = VkCab::items((array)($in['items'] ?? []), true);
    if (!$items) throw new HttpError(422, 'vk_no_items', ['human' => self::h('items')]);
    $rid = substr(preg_replace('/[^\w\-]/', '', (string)($in['rid'] ?? '')), 0, 40); $place = substr(preg_replace('/[^\w\-]/', '', (string)($in['place'] ?? '')), 0, 40);
    $auto = ($in['auto'] ?? false) === true;
    if ($auto && !self::autoOn($uid)) throw new HttpError(409, 'vk_auto_off', ['human' => self::h('auto_off')]);
    $sig = fn(array $l) => implode('|', array_map(fn($x) => ($x['serial'] ?? '') . '=' . $x['value'], $l));
    foreach (Db::q("SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? AND status IN ('queued', 'sending', 'ok') ORDER BY id DESC LIMIT 12", [$uid, self::PROV])->fetchAll() as $j) {
      $p = self::js($j['payload']); if ($j['acc'] === $acc && $sig((array)($p['items'] ?? [])) === $sig($items)) return ['ok' => true, 'dup' => true, 'job' => self::pubJob($j)];
    }
    VkCab::limit($uid);
    $at = time() + ($auto ? self::autoDelay() : 0);
    $payload = ['rid' => $rid, 'place' => $place, 'items' => $items, 'lang' => self::$lang, 'auto' => $auto, 'sec' => CabVault::enc(json_encode(['fam' => $fam], JSON_UNESCAPED_UNICODE))];
    Db::q("INSERT INTO cab_jobs (user_id, prov, acc, payload, status, result, tries, next_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?)",
      [$uid, self::PROV, $acc, json_encode($payload, JSON_UNESCAPED_UNICODE), json_encode(['checkedAt' => time()]), $at, Http::iso(), Http::iso()]);
    $job = self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [Db::id()]));
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'vk_queue_' . ($auto ? 'auto' : 'bg'), null, Http::iso()]);
    if ($auto) self::notify($uid, $job);
    return ['ok' => true, 'job' => $job];
  }
  private static function mine(int $uid, array $in): array {
    $j = Db::one('SELECT * FROM cab_jobs WHERE id = ? AND user_id = ? AND prov = ?', [(int)($in['job'] ?? 0), $uid, self::PROV]);
    if (!$j || $j['status'] !== 'queued') throw new HttpError(409, 'vk_no_job', ['human' => self::h('no_job')] + ($j ? ['job' => self::pubJob($j)] : []));
    return $j;
  }
  /** POST /api/vk/job/cancel {job} */
  public static function cancel(int $uid, array $in): array { self::lang($in); $j = self::mine($uid, $in); self::finish((int)$j['id'], 'cancelled', ['why' => 'user']); return ['ok' => true, 'job' => self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]))]; }
  /** POST /api/vk/job/now {job} — отправить из очереди сейчас. */
  public static function now(int $uid, array $in): array { self::lang($in); $j = self::mine($uid, $in); VkCab::limit($uid); return ['ok' => true, 'job' => self::run($j)]; }

  /** Итог отправки: статус и результат; рахунок и прізвище из очереди стираем — больше не нужны. */
  private static function finish(int $id, string $st, array $res): void {
    $j = Db::one('SELECT payload FROM cab_jobs WHERE id = ?', [$id]); $p = self::js($j['payload'] ?? ''); unset($p['sec']);
    Db::q('UPDATE cab_jobs SET status = ?, result = ?, payload = ?, next_at = 0, updated_at = ? WHERE id = ?', [$st, json_encode($res + ['doneAt' => time()], JSON_UNESCAPED_UNICODE), json_encode($p, JSON_UNESCAPED_UNICODE), Http::iso(), $id]);
  }
  /** Отправить одну строку очереди (cron по сроку или «Надіслати зараз»). */
  private static function run(array $j): array {
    $uid = (int)$j['user_id']; $p = self::js($j['payload']); self::$lang = ($p['lang'] ?? '') === 'ru' ? 'ru' : 'uk'; VkCab::lang(self::$lang);
    if (Db::q("UPDATE cab_jobs SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'queued'", [Http::iso(), $j['id']])->rowCount() !== 1) return self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]));
    $sec = self::js((string)CabVault::dec((string)($p['sec'] ?? ''))); $fam = (string)($sec['fam'] ?? '');
    if ($fam === '') { self::finish((int)$j['id'], 'failed', ['why' => 'lost', 'human' => self::h('lost')]); }
    else try {
      $r = VkCab::deliver($uid, (string)$j['acc'], $fam, (array)$p['items'], null, !empty($p['auto']) ? 'autosend' : 'bgsend', true);
      self::finish((int)$j['id'], ['ok' => 'ok', 'err' => 'rejected'][$r['result']] ?? 'unknown', ['text' => $r['text'], 'keys' => $r['keys']]);
    } catch (Throwable $e) {
      $why = $e instanceof HttpError ? preg_replace('/^(cab|vk)_/', '', $e->err) : 'down';
      if ($why === 'down' && (int)$j['tries'] + 1 < self::DOWN_TRIES) {   // сайт не ответил — ещё раз через 15 минут, без сообщений
        Db::q("UPDATE cab_jobs SET status = 'queued', tries = tries + 1, next_at = ?, updated_at = ? WHERE id = ?", [time() + 900, Http::iso(), $j['id']]);
        return self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]));
      }
      self::finish((int)$j['id'], 'failed', ['why' => $why, 'human' => mb_substr($why === 'down' ? self::h('down') : (string)($e instanceof HttpError ? ($e->extra['human'] ?? '') : ''), 0, 400)]);
    }
    $job = self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]));
    if ($job['status'] !== 'ok') self::notify($uid, $job);   // «✅ прийняв» уже написал VkCab::deliver
    return $job;
  }
  /** cron: срок очереди вышел — отправляем (не больше 3 за минуту: каждое — свой вход на сайт). */
  public static function cron(?int $now = null): array {
    $out = [];
    foreach (Db::q("SELECT * FROM cab_jobs WHERE prov = ? AND status = 'queued' AND next_at <= ? ORDER BY next_at LIMIT 3", [self::PROV, $now ?? time()])->fetchAll() as $j) { $r = self::run($j); $out[] = [(int)$j['id'], $r['status']]; }
    return $out;
  }
  /** Telegram: «📝 надішлемо о HH:MM», «❌ не прийняв», «⚠️ не надіслали», «⏳ сайт не сказав». */
  public static function notify(int $uid, array $job): void {
    $tg = Db::one("SELECT external_id FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$uid]); if (!$tg || !Cfg::get('bot_token')) return;
    $ru = self::$lang === 'ru'; $acc = $job['acc'];
    $lines = implode("\n", array_map(fn($x) => '• ' . ($x['name'] ?: ($ru ? 'счётчик' : 'лічильник')) . ' — ' . $x['value'], $job['items']));
    $tail = $job['text'] !== '' ? "\n\n" . ($ru ? 'Ответ сайта: ' : 'Відповідь сайту: ') . '«' . mb_substr($job['text'], 0, 300) . '»' : '';
    switch ($job['status']) {
      case 'queued':
        $hm = (new DateTimeImmutable('@' . (int)$job['nextAt']))->setTimezone(new DateTimeZone('Europe/Kyiv'))->format('H:i');
        $txt = ($ru ? "📝 Распознали показания воды (счёт $acc) — все проверки пройдены:\n" : "📝 Розпізнали показання води (рахунок $acc) — усі перевірки пройдено:\n") . $lines .
          ($ru ? "\n\nОтправим на сайт Водоканала в $hm. Что-то не так — нажмите «Отменить» в «Счётчиках» до этого времени." : "\n\nНадішлемо на сайт Водоканалу о $hm. Щось не так — натисніть «Скасувати» в «Лічильниках» до цього часу."); break;
      case 'rejected': $txt = ($ru ? "❌ Сайт Водоканала не принял показания (счёт $acc):\n" : "❌ Сайт Водоканалу не прийняв показання (рахунок $acc):\n") . $lines . $tail . ($ru ? "\n\nОткройте «Счётчики» — исправьте и отправьте снова." : "\n\nВідкрийте «Лічильники» — виправте й надішліть знову."); break;
      case 'unknown': $txt = ($ru ? "⏳ Отправили на сайт Водоканала (счёт $acc), но сайт не сказал, принял ли:\n" : "⏳ Надіслали на сайт Водоканалу (рахунок $acc), але сайт не сказав, чи прийняв:\n") . $lines . $tail . ($ru ? "\n\nПроверьте в боте Водоканала (@hvk_user_bot) и отметьте в «Счётчиках»." : "\n\nПеревірте в боті Водоканалу (@hvk_user_bot) і позначте в «Лічильниках»."); break;
      case 'failed': $txt = ($ru ? "⚠️ Не отправили показания воды на сайт Водоканала (счёт $acc).\n" : "⚠️ Не надіслали показання води на сайт Водоканалу (рахунок $acc).\n") . ($job['human'] ?: '') . ($ru ? "\n\nОткройте «Счётчики» — там можно отправить кнопкой или через бот Водоканала." : "\n\nВідкрийте «Лічильники» — там можна надіслати кнопкою або через бот Водоканалу."); break;
      default: return;
    }
    $p = ['chat_id' => $tg['external_id'], 'text' => $txt];
    if (Cfg::appUrlKnown()) $p['reply_markup'] = ['inline_keyboard' => [[['text' => $ru ? 'Открыть «Счётчики»' : 'Відкрити «Лічильники»', 'web_app' => ['url' => Cfg::appUrl() . '?go=water-cold' . ($job['place'] ? '&place=' . rawurlencode((string)$job['place']) : '')]]]]];
    try { Telegram::call('sendMessage', $p); } catch (Throwable $e) { /* не дошло — в приложении статус виден */ }
  }
  /** /api/health → vksvc: очередь по статусам и согласия (без рахунков). */
  public static function summary(): array {
    $jobs = []; $n = 0;
    try { foreach (Db::q('SELECT status, COUNT(*) AS c FROM cab_jobs WHERE prov = ? GROUP BY status', [self::PROV])->fetchAll() as $x) $jobs[$x['status']] = (int)$x['c']; $n = (int)(Db::one('SELECT COUNT(*) AS c FROM cab_creds WHERE prov = ?', [self::PROV])['c'] ?? 0); } catch (Throwable $e) {}
    return ['jobs' => (object)$jobs, 'auto' => $n];
  }
}

/** Квитанции Водоканала в фоне, без участия человека (владелец 07.11.2026: «квитанции скачивать и добавлять в фоне автоматом без участия юзера»).
 *  cron, с 1-го по 25-е, 7:00–21:59 по Киеву, не больше одного входа на сайт за минуту. Квартира подходит, если человек сам вписал для сайта
 *  Водоканала особовий рахунок і прізвище, не выключил «Квитанції самі» (place.water.billAuto !== false) и у неё есть запись воды за прошлый
 *  месяц без квитанции с сайта. Тогда входим «без реєстрації» (только чтение, как «Перевірити»), новую квитанцию (другой отпечаток) кладём в документы
 *  и прикрепляем к записи прямо в данных человека на сервере (`bills += {…, auto: 'vk'}`, новая версия; прошлая — в историю, как при сохранении) —
 *  на любом устройстве она появится при следующей синхронизации. Та же, что уже есть (сайт ещё не обновил), — снова через RETRY; взяли за месяц —
 *  больше за него не ходим (даже если человек убрал файл); «не знайдено» — не ходим, пока рахунок или прізвище не изменятся. Ничего не вносим. */
final class VkBills {
  const RETRY = 20 * 3600, FROM_H = 7, TO_H = 22, IDLE = 1800;
  public static function file(): string { return Cfg::data() . '/cache/vk_bills.json'; }
  public static function read(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  private static function write(array $j): void { @mkdir(dirname(self::file()), 0700, true); @file_put_contents(self::file(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX); }
  /** За какой месяц квитанция: прошлый по Киеву. */
  public static function ym(int $now): string { return Gpv::kyiv($now)->modify('first day of last month')->format('Y-m'); }
  /** Отпечаток данных входа — помнить «не знайдено» без самих рахунку и прізвища. */
  private static function sig(array $t): string { return substr(sha1($t['acc'] . '|' . mb_strtolower($t['fam'])), 0, 12); }
  private static function first(array $places): string { return (string)($places[0]['id'] ?? 'main'); }
  private static function live(array $st): array { return array_values(array_filter((array)($st['places'] ?? []), fn($p) => is_array($p) && empty($p['deleted']) && !empty($p['id']))); }
  /** Запись воды квартиры за месяц ym, к которой можно прикрепить квитанцию: не стартовая, последняя по дате; у какой-то записи месяца уже есть
   *  квитанция с сайта — null (второй раз не кладём). $water — массив записей (массивы или объекты). → индекс в $water или null */
  public static function recIdx(array $water, string $place, string $first, string $ym): ?int {
    $best = null; $bd = '';
    foreach ($water as $i => $r) {
      $r = (array)$r; if (empty($r['id']) || !empty($r['deleted']) || !empty($r['base'])) continue;
      if ((string)($r['place'] ?? $first) !== $place || substr((string)($r['date'] ?? ''), 0, 7) !== $ym) continue;
      foreach ((array)($r['bills'] ?? []) as $b) if ((((array)$b)['auto'] ?? '') === 'vk') return null;
      if ($best === null || (string)$r['date'] >= $bd) { $best = $i; $bd = (string)$r['date']; }
    }
    return $best;
  }
  /** Квартиры состояния, где можно взять квитанцию за ym. → [{place, acc, fam}] */
  public static function targets(array $st, string $ym): array {
    $places = self::live($st); if (!$places) return [];
    $first = self::first($places); $out = [];
    foreach ($places as $p) {
      $w = (array)($p['water'] ?? []); if (($w['billAuto'] ?? null) === false) continue;
      try { [$acc, $fam] = VkCab::input(['acc' => (string)($w['account'] ?? ''), 'fam' => (string)($w['surname'] ?? '')]); } catch (HttpError $e) { continue; }
      if (self::recIdx((array)($st['water'] ?? []), (string)$p['id'], $first, $ym) === null) continue;
      $out[] = ['place' => (string)$p['id'], 'acc' => $acc, 'fam' => $fam];
    }
    return $out;
  }
  /** Прикрепить квитанцию к записи воды за ym в данных человека (новая версия; конфликт с устройством — до 3 попыток). → прикрепили ли */
  public static function attach(int $uid, string $place, string $ym, array $doc): bool {
    for ($i = 0; $i < 3; $i++) {
      $row = Db::one('SELECT data, version, updated_at FROM user_state WHERE user_id = ?', [$uid]); if (!$row) return false;
      $st = json_decode((string)$row['data']);   // объекты, не массивы: пустые {} остаются {}
      $arr = json_decode((string)$row['data'], true);
      if (!is_object($st) || !is_array($arr) || !isset($st->water) || !is_array($st->water)) return false;
      $idx = self::recIdx($st->water, $place, self::first(self::live($arr)), $ym); if ($idx === null) return false;
      $r = $st->water[$idx]; if (!isset($r->bills) || !is_array($r->bills)) $r->bills = [];
      $r->bills[] = (object)['id' => (string)$doc['id'], 'mime' => (string)($doc['mime'] ?? 'application/pdf'), 'name' => (string)($doc['name'] ?? ''), 'bytes' => (int)($doc['bytes'] ?? 0), 'at' => (string)($doc['createdAt'] ?? Http::iso()), 'auto' => 'vk'];
      $r->updatedAt = (int)round(microtime(true) * 1000);   // запись новее — при слиянии с устройством побеждает она (остальное не трогаем)
      $json = json_encode($st, JSON_UNESCAPED_UNICODE); if ($json === false) return false;
      if (Db::q('UPDATE user_state SET data = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?', [$json, Http::iso(), $uid, (int)$row['version']])->rowCount() === 1) {
        StateHist::put($uid, (string)$row['data'], (int)$row['version'], (string)$row['updated_at'], 'vkbill');
        return true;
      }
    }
    return false;
  }
  /** cron: одна квартира за запуск. → [[uid, итог]] или [] */
  public static function cron(?int $now = null): array {
    $now = $now ?? time(); $k = Gpv::kyiv($now); $h = (int)$k->format('G');
    if ((int)$k->format('j') > 25 || $h < self::FROM_H || $h >= self::TO_H || !VkCab::ready() || Cfg::get('vk_bills_auto', true) === false) return [];
    $cab = (array)(VkStatus::read()['cab'] ?? []); if (empty($cab['everOk']) || ($cab['state'] ?? '') !== 'ok') return [];
    $j = self::read(); if ((int)($j['idle'] ?? 0) > $now) return [];
    $ym = self::ym($now); $todo = null;
    foreach (Db::q('SELECT user_id, data FROM user_state ORDER BY user_id')->fetchAll() as $row) {
      $st = json_decode((string)$row['data'], true); if (!is_array($st)) continue;
      foreach (self::targets($st, $ym) as $t) {
        $e = (array)($j['p'][$row['user_id'] . '|' . $t['place']] ?? []);
        if (($e['got'] ?? '') === $ym || (($e['bad'] ?? '') !== '' && $e['bad'] === self::sig($t)) || $now - (int)($e['at'] ?? 0) < self::RETRY) continue;
        $todo = [(int)$row['user_id'], $t]; break 2;
      }
    }
    if (!$todo) { $j['idle'] = $now + self::IDLE; self::write($j); return []; }   // некуда идти — не перебираем всех каждую минуту
    [$uid, $t] = $todo; $key = $uid . '|' . $t['place'];
    $e = (array)($j['p'][$key] ?? []); $e = ['at' => $now, 'ym' => $ym, 'n' => ($e['ym'] ?? '') === $ym ? (int)($e['n'] ?? 0) + 1 : 1] + array_intersect_key($e, ['got' => 1]);
    $j['p'][$key] = $e; self::write($j);   // отметка до входа: упадём посередине — не повторим через минуту
    $r = []; $guess = null;
    try {
      RateLimit::hit('vk_cab_all', 'all');
      $r = VkCab::fetchBill($uid, $t['acc'], $t['fam'], $t['place'], 'autobill');
      $doc = $r['doc'] ?? null; $dym = (string)($r['ym'] ?? ($doc['ym'] ?? '')); $guess = $r['guess'] ?? null;
      if (!empty($r['none'])) $res = 'nobill';
      elseif (!$doc || $dym === '') $res = 'nobill';
      elseif (!empty($r['same']) && $dym !== $ym) $res = 'same';   // сайт ещё показывает прошлую квитанцию
      else {
        // квитанция за месяц со страницы может оказаться не тем месяцем — кладём к своему месяцу, если такая запись есть
        $ok = self::attach($uid, $t['place'], $dym, $doc);
        $res = $ok ? (!empty($r['same']) ? 'attached' : 'got') : 'norec';
        if ($ok && $dym === $ym) $e['got'] = $ym;
      }
    } catch (HttpError $x) { $res = $x->err === 'cab_not_found' ? 'notfound' : (preg_replace('/^(cab|vk)_/', '', $x->err) ?: 'err'); if ($res === 'notfound') $e['bad'] = self::sig($t); }
    catch (Throwable $x) { $res = 'down'; error_log('teplo vk bills: ' . $x->getMessage()); }
    $e['res'] = $res;
    $j = self::read(); $j['p'][$key] = $e; $j['last'] = ['at' => $now, 'res' => $res] + ($guess !== null ? ['guess' => (bool)$guess] : []);
    $n = (array)($j['n'][$ym] ?? []); $n[$res] = (int)($n[$res] ?? 0) + 1; $j['n'] = array_slice([$ym => $n] + (array)($j['n'] ?? []), 0, 3, true);
    self::write($j);
    return [[$uid, $res]];
  }
  /** /api/health → vkBills: последний итог и счёт по месяцам (без рахунків и людей). */
  public static function summary(): array {
    $j = self::read();
    return ['last' => isset($j['last']) ? ['at' => gmdate('c', (int)$j['last']['at'])] + array_diff_key($j['last'], ['at' => 1]) : null, 'n' => (object)($j['n'] ?? []), 'places' => count((array)($j['p'] ?? [])),
      'idleTill' => !empty($j['idle']) && $j['idle'] > time() ? gmdate('c', (int)$j['idle']) : null];
  }
}
