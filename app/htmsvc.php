<?php
// Автоподача в кабинет КП «ХТМ» над роботом HtmCab (app/cabs.php). Робот входит логином и паролем самого человека, по его согласию,
// и вносит показания только по нажатию «Внести в кабінет ХТМ». Капчу не обходим — увидели капчу → «внесіть самі».
//  GET  /api/cab/htm              → подключён ли кабинет, рахунки, последние внесения и их проверка роботом ХТМ
//  POST /api/cab/htm/connect      {email, password, phone?, consent: true, lang} — пробный вход; удался → пароль в CabVault, рахунки
//  POST /api/cab/forget           {prov: 'htm'} — «Забути пароль»: вход удаляем сразу, внесения на проверке больше не перечитываем
//  POST /api/cab/htm/check        {acc?, lang} — что видит кабинет: прибор, последние принятые, окно, журнал; структура формы — в журнал
//                                   (имена и типы полей, без значений и личных данных) и в /api/health → htmcab.form
//  POST /api/cab/htm/send         {acc?, rid, vals: {date, energy, …, errCode}, phone?, email?, lang, delay?} — внести. Дальше cron (HtmSvc::cron)
//                                   перечитывает журнал через AFTER минут → Telegram «✅ ХТМ прийняв» / «❌ не прийняв: причина»
//  Автоподача (по согласию, переключатель на экране кабинета): фото в бот → приложение распознало, все проверки пройдены → send {delay: true}
//  ставит внесение в очередь (queued) на AUTO_DELAY секунд — Telegram «📝 внесемо о HH:MM», можно скасувати; cron вносит сам.
//  POST /api/cab/htm/auto {on}    — включить/выключить автоподачу · POST /api/cab/htm/cancel {job} · POST /api/cab/htm/now {job}
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class HtmSvc {
  const PROV = 'htm';
  /** Когда перечитать журнал после внесения (минуты): робот ХТМ проверяет 15–30 минут, иногда дольше. */
  const AFTER = [20, 40, 70, 130, 360];
  /** Автоподача: сколько секунд внесение ждёт в очереди (можно отменить), прежде чем робот внесёт сам. */
  public static function autoDelay(): int { return max(60, (int)Cfg::get('htm_auto_delay', 600)); }
  public static function logFile(): string { return Cfg::data() . '/cache/htmcab_log.json'; }
  public static function log(): array { $j = json_decode((string)@file_get_contents(self::logFile()), true); return is_array($j) ? $j : []; }

  private static string $lang = 'uk';
  private static function lang(array $in): void { self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk'; }
  private static function h(string $k, array $p = []): string {
    $ru = self::$lang === 'ru';
    $m = [
      'bad_email' => $ru ? 'Впишите e-mail, с которым входите в кабинет ХТМ.' : 'Впишіть e-mail, з яким входите в кабінет ХТМ.',
      'bad_pass' => $ru ? 'Впишите пароль от кабинета ХТМ.' : 'Впишіть пароль від кабінету ХТМ.',
      'consent' => $ru ? 'Чтобы робот вносил показания за вас, нужно ваше согласие — отметьте галочку.' : 'Щоб робот вносив показання за вас, потрібна ваша згода — поставте позначку.',
      'bad_login' => $ru ? 'Кабинет ХТМ не пустил с этим e-mail и паролем. Проверьте их, войдя на сайт ХТМ.' : 'Кабінет ХТМ не пустив з цим e-mail і паролем. Перевірте їх, увійшовши на сайт ХТМ.',
      'relogin' => $ru ? 'Пароль от кабинета ХТМ больше не подходит. Подключите кабинет заново.' : 'Пароль від кабінету ХТМ більше не підходить. Підключіть кабінет знову.',
      'captcha' => $ru ? 'Кабинет ХТМ попросил капчу — робот туда не входит. Внесите показания сами на сайте ХТМ.' : 'Кабінет ХТМ попросив капчу — робот туди не входить. Внесіть показання самі на сайті ХТМ.',
      'down' => $ru ? 'Сайт ХТМ сейчас не отвечает. Попробуйте позже.' : 'Сайт ХТМ зараз не відповідає. Спробуйте пізніше.',
      'changed' => $ru ? 'Сайт ХТМ показал незнакомую страницу (возможно, обновился). Внесите сами — мы уже видим проблему.' : 'Сайт ХТМ показав незнайому сторінку (можливо, оновився). Внесіть самі — ми вже бачимо проблему.',
      'form_changed' => $ru ? 'Форма показаний на сайте ХТМ изменилась — робот ничего не отправил. Внесите сами на сайте ХТМ, а мы поправим робота.' : 'Форма показань на сайті ХТМ змінилася — робот нічого не надіслав. Внесіть самі на сайті ХТМ, а ми виправимо робота.',
      'closed' => $ru ? 'Приём показаний на сайте ХТМ сейчас закрыт (открыт с 5 по 25 число).' : 'Прийом показань на сайті ХТМ зараз закритий (відкритий з 5 по 25 число).',
      'off' => $ru ? 'Кабинет ХТМ не подключён.' : 'Кабінет ХТМ не підключено.',
      'no_acc' => $ru ? 'В кабинете ХТМ нет лицевого счёта {a}. Выберите счёт из кабинета.' : 'У кабінеті ХТМ немає особового рахунку {a}. Оберіть рахунок із кабінету.',
      'pick_acc' => $ru ? 'В кабинете несколько лицевых счетов — выберите, какой у этой квартиры.' : 'У кабінеті кілька особових рахунків — оберіть, який у цієї квартири.',
      'no_accs' => $ru ? 'В кабинете ХТМ не нашли ни одного лицевого счёта.' : 'У кабінеті ХТМ не знайшли жодного особового рахунку.',
      'bad_value' => $ru ? 'Проверьте «{f}»: {why}' : 'Перевірте «{f}»: {why}',
      'need_phone' => $ru ? 'Форма ХТМ требует телефон — впишите его.' : 'Форма ХТМ вимагає телефон — впишіть його.',
      'form_error' => $ru ? 'Сайт ХТМ не сохранил показания.' : 'Сайт ХТМ не зберіг показання.',
      'busy' => $ru ? 'Слишком много попыток. Подождите немного и попробуйте снова.' : 'Забагато спроб. Зачекайте трохи й спробуйте знову.',
      'auto_off' => $ru ? 'Автоподача выключена — внесите кнопкой «Внести в кабинет ХТМ».' : 'Автоподачу вимкнено — внесіть кнопкою «Внести в кабінет ХТМ».',
      'no_job' => $ru ? 'Это внесение уже не в очереди.' : 'Це внесення вже не в черзі.',
    ][$k];
    foreach ($p as $a => $b) $m = str_replace('{' . $a . '}', (string)$b, $m);
    return $m;
  }
  private static function fail(int $st, string $k, array $p = [], array $extra = []): HttpError { return new HttpError($st, 'cab_' . $k, ['human' => self::h($k, $p)] + $extra); }
  /** Отказ робота → ответ приложению: свой код и человеческий текст; слова сайта — только при отказе входа и ошибке формы. */
  private static function cabErr(CabErr $e): HttpError {
    $map = ['bad_login' => 401, 'captcha' => 423, 'down' => 502, 'changed' => 502, 'form_changed' => 409, 'closed' => 409, 'form_error' => 422, 'bad_value' => 422];
    $site = in_array($e->err, ['bad_login', 'form_error', 'closed'], true) && $e->site !== '' ? ['site' => mb_substr($e->site, 0, 300)] : [];
    return self::fail($map[$e->err] ?? 502, isset($map[$e->err]) && $e->err !== 'bad_value' ? $e->err : 'changed', [], $site);
  }
  private static function limit(int $uid): void {
    try { RateLimit::hit('htm_cab', (string)$uid); RateLimit::hit('htm_cab_all', 'all'); }
    catch (HttpError $e) { throw new HttpError(429, 'rate_limited', ['human' => self::h('busy')] + $e->extra); }
  }

  // ---------- вход человека ----------
  private static function creds(int $uid): ?array { return Db::one('SELECT * FROM cab_creds WHERE user_id = ? AND prov = ?', [$uid, self::PROV]); }
  private static function js(?string $s): array { $j = json_decode((string)$s, true); return is_array($j) ? $j : []; }
  private static function phone($s): string {
    $s = trim((string)$s); $d = preg_replace('/\D/', '', $s);
    if ($d === '') return '';
    if (strlen($d) === 10 && $d[0] === '0') $d = '38' . $d;
    if (strlen($d) === 12 && str_starts_with($d, '380')) return '+' . $d;
    if (strlen($d) < 9 || strlen($d) > 15) throw self::fail(422, 'need_phone');
    return '+' . $d;
  }
  private static function pubAccs(array $accs): array { return array_map(fn($a) => ['acc' => (string)$a['acc'], 'sur' => (string)$a['sur']], $accs); }

  /** GET /api/cab/htm */
  public static function status(int $uid): array {
    $c = self::creds($uid); $info = $c ? self::js($c['info']) : []; $ex = $c ? self::js($c['extra']) : [];
    $jobs = Db::q('SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? ORDER BY id DESC LIMIT 12', [$uid, self::PROV])->fetchAll();
    return ['connected' => (bool)$c, 'login' => $c['login'] ?? null, 'state' => $c['state'] ?? null, 'accounts' => self::pubAccs((array)($info['accounts'] ?? [])),
      'phone' => $ex['phone'] ?? '', 'auto' => !empty($ex['auto']), 'autoDelay' => self::autoDelay(), 'since' => $c['created_at'] ?? null, 'checkedAt' => $c['checked_at'] ?? null, 'jobs' => array_map([self::class, 'pubJob'], $jobs)];
  }
  public static function pubJob(array $j): array {
    $p = self::js($j['payload']); $r = self::js($j['result']);
    return ['id' => (int)$j['id'], 'acc' => $j['acc'], 'rid' => $p['rid'] ?? null, 'place' => $p['place'] ?? null, 'date' => $p['vals']['date'] ?? null, 'energy' => $p['vals']['energy'] ?? null,
      'status' => $j['status'], 'text' => $r['text'] ?? '', 'reason' => $r['reason'] ?? null, 'why' => $r['why'] ?? null, 'at' => strtotime((string)$j['created_at']) ?: null,
      'checkedAt' => $r['checkedAt'] ?? null, 'nextAt' => in_array($j['status'], ['pending', 'queued'], true) ? (int)$j['next_at'] : null, 'auto' => !empty($p['auto']), 'human' => $r['human'] ?? null];
  }

  /** POST /api/cab/htm/connect — пробный вход; не пустил — ничего не храним. */
  public static function connect(int $uid, array $in): array {
    self::lang($in);
    $email = mb_strtolower(trim((string)($in['email'] ?? ''))); $pass = (string)($in['password'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) throw self::fail(422, 'bad_email');
    if ($pass === '' || strlen($pass) > 200) throw self::fail(422, 'bad_pass');
    if (($in['consent'] ?? false) !== true) throw self::fail(422, 'consent');
    $phone = self::phone($in['phone'] ?? '');
    self::limit($uid);
    $cab = new HtmCab(25.0);
    try { $home = $cab->login($email, $pass); $accs = $cab->accounts($home); }
    catch (CabErr $e) { self::diag(['op' => 'connect', 'user' => $uid, 'result' => $e->err, 'site' => CabWeb::mask($e->site), 'steps' => $cab->w->steps]); throw self::cabErr($e); }
    finally { $cab->logout(); }
    $info = json_encode(['accounts' => $accs, 'at' => time()], JSON_UNESCAPED_UNICODE);
    $old = self::creds($uid); if ($phone === '' && $old) $phone = (string)(self::js($old['extra'])['phone'] ?? '');   // подключили заново без телефона — прежний остаётся
    $extra = ['phone' => $phone, 'consentAt' => gmdate('c'), 'lang' => self::$lang]; if ($old && !empty(self::js($old['extra'])['auto'])) $extra['auto'] = true;   // подключили заново — автоподача как была
    $extra = json_encode($extra, JSON_UNESCAPED_UNICODE);
    $sec = CabVault::enc($pass);
    if ($old) Db::q("UPDATE cab_creds SET login = ?, secret = ?, extra = ?, state = 'ok', info = ?, created_at = ?, checked_at = ? WHERE user_id = ? AND prov = ?", [$email, $sec, $extra, $info, Http::iso(), Http::iso(), $uid, self::PROV]);
    else Db::q("INSERT INTO cab_creds (user_id, prov, login, secret, extra, state, info, created_at, checked_at) VALUES (?, ?, ?, ?, ?, 'ok', ?, ?, ?)", [$uid, self::PROV, $email, $sec, $extra, $info, Http::iso(), Http::iso()]);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'htm_cab_connect', null, Http::iso()]);
    self::diag(['op' => 'connect', 'user' => $uid, 'result' => 'ok', 'n' => count($accs), 'steps' => $cab->w->steps]);
    return ['ok' => true] + self::status($uid);
  }

  /** POST /api/cab/forget {prov} — удалить вход в кабинет. Внесения на проверке больше не перечитываем (пароля нет). */
  public static function forget(int $uid, array $in): array {
    if (($in['prov'] ?? self::PROV) !== self::PROV) throw new HttpError(422, 'bad_prov');
    Db::q('DELETE FROM cab_creds WHERE user_id = ? AND prov = ?', [$uid, self::PROV]);
    Db::q("UPDATE cab_jobs SET status = 'unknown', result = ?, updated_at = ? WHERE user_id = ? AND prov = ? AND status = 'pending'", [json_encode(['why' => 'forgot', 'checkedAt' => time()]), Http::iso(), $uid, self::PROV]);
    Db::q("UPDATE cab_jobs SET status = 'cancelled', result = ?, next_at = 0, updated_at = ? WHERE user_id = ? AND prov = ? AND status = 'queued'", [json_encode(['why' => 'forgot', 'checkedAt' => time()]), Http::iso(), $uid, self::PROV]);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'htm_cab_forget', null, Http::iso()]);
    self::diag(['op' => 'forget', 'user' => $uid, 'result' => 'ok']);
    return ['ok' => true] + self::status($uid);
  }

  /** Войти сохранённым паролем и выбрать рахунок. → [HtmCab, ['acc', 'sur'], creds]. Пароль больше не подходит — state bad_login, ничего не пробуем повторно. */
  private static function enter(int $uid, string $want, string $op): array {
    $c = self::creds($uid); if (!$c) throw self::fail(409, 'off');
    if ($c['state'] === 'bad_login') throw self::fail(401, 'relogin');
    $pass = CabVault::dec((string)$c['secret']); if ($pass === null) { self::state($uid, 'bad_login'); throw self::fail(401, 'relogin'); }
    $cab = new HtmCab(25.0);
    try { $home = $cab->login((string)$c['login'], $pass); $accs = $cab->accounts($home); }
    catch (CabErr $e) {
      self::diag(['op' => $op, 'user' => $uid, 'result' => $e->err, 'where' => 'login', 'site' => CabWeb::mask($e->site), 'steps' => $cab->w->steps]);
      if ($e->err === 'bad_login') { self::state($uid, 'bad_login'); throw self::fail(401, 'relogin'); }
      if ($e->err === 'captcha') self::state($uid, 'captcha');
      throw self::cabErr($e);
    }
    if (!$accs) { self::diag(['op' => $op, 'user' => $uid, 'result' => 'no_accs', 'steps' => $cab->w->steps]); throw self::fail(409, 'no_accs'); }
    Db::q("UPDATE cab_creds SET info = ?, state = 'ok', checked_at = ? WHERE user_id = ? AND prov = ?", [json_encode(['accounts' => $accs, 'at' => time()], JSON_UNESCAPED_UNICODE), Http::iso(), $uid, self::PROV]);
    $want = preg_replace('/\D/', '', $want);
    if ($want === '') { if (count($accs) > 1) throw self::fail(409, 'pick_acc', [], ['accounts' => self::pubAccs($accs)]); $acc = $accs[0]; }
    else { $acc = null; foreach ($accs as $a) if ($a['acc'] === $want) $acc = $a; if (!$acc) throw self::fail(409, 'no_acc', ['a' => $want], ['accounts' => self::pubAccs($accs)]); }
    return [$cab, $acc, $c];
  }
  private static function state(int $uid, string $s): void { Db::q('UPDATE cab_creds SET state = ? WHERE user_id = ? AND prov = ?', [$s, $uid, self::PROV]); }

  /** Структура формы для журнала и сверки: имена, типы, роли и подсказки сайта — без значений. */
  private static function formInfo(array $h): array {
    if (!$h['open']) return ['open' => false];
    $pl = HtmCab::plan($h['fields']);
    return ['open' => true, 'action' => (string)parse_url((string)($h['action'] ?? ''), PHP_URL_PATH), 'match' => $pl['match'], 'missing' => $pl['missing'], 'unknown' => $pl['unknown'],
      'fields' => array_slice(array_map(fn($f) => array_filter(['n' => $f['name'], 't' => $f['type'], 'r' => $pl['roles'][$f['name']] ?? null, 'ph' => CabWeb::mask((string)($f['ph'] ?? ''), 40) ?: null, 'max' => $f['max'] ?? null, 'pat' => ($f['pattern'] ?? '') ?: null, 'req' => !empty($f['req']) ?: null], fn($v) => $v !== null), $h['fields']), 0, 40),
      'minMax' => $h['min'] !== null && $h['max'] !== null];
  }
  private static function pubJournal(array $j): array {
    return array_map(fn($r) => ['date' => $r['date'], 'energy' => $r['energy'], 'status' => $r['status'], 'text' => mb_substr((string)$r['text'], 0, 300), 'reason' => $r['reason'] ?? null], array_slice($j, 0, 8));
  }

  /** POST /api/cab/htm/check — что видит кабинет. Ничего не вносит. */
  public static function check(int $uid, array $in): array {
    self::lang($in); self::limit($uid);
    [$cab, $acc] = self::enter($uid, (string)($in['acc'] ?? ''), 'check');
    try { $h = $cab->heat($acc['acc'], $acc['sur']); }
    catch (CabErr $e) { self::diag(['op' => 'check', 'user' => $uid, 'result' => $e->err, 'steps' => $cab->w->steps]); throw self::cabErr($e); }
    finally { $cab->logout(); }
    $fi = self::formInfo($h);
    self::diag(['op' => 'check', 'user' => $uid, 'result' => 'ok', 'meter' => (bool)$h['meter'], 'base' => array_keys($h['base']), 'form' => $fi, 'journal' => array_map(fn($r) => $r['status'], $h['journal']), 'closed' => $h['closed'] ? CabWeb::mask($h['closed'], 160) : null, 'steps' => $cab->w->steps]);
    return ['ok' => true, 'acc' => $acc['acc'], 'meter' => $h['meter'], 'base' => (object)$h['base'], 'open' => $h['open'], 'closed' => $h['closed'], 'min' => $h['min'], 'max' => $h['max'],
      'journal' => self::pubJournal($h['journal']), 'form' => ['open' => $h['open'], 'match' => $fi['match'] ?? null, 'phone' => in_array('phone', array_column($fi['fields'] ?? [], 'r'), true)]];
  }

  // ---------- внести ----------
  private static function label(string $k): string {
    $ru = self::$lang === 'ru';
    return ['date' => $ru ? 'Дата снятия' : 'Дата зняття', 'energy' => $ru ? 'Накопленная энергия' : 'Накопичена енергія', 'volume' => $ru ? 'Объём теплоносителя' : 'Обсяг теплоносія',
      'flow' => $ru ? 'Мгновенный расход' : 'Миттєва витрата', 'power' => $ru ? 'Мгновенная мощность' : 'Миттєва потужність', 'tSupply' => $ru ? 'Температура подачи' : 'Температура подачі',
      'tReturn' => $ru ? 'Температура обратки' : 'Температура повернення', 'hours' => $ru ? 'Время работы' : 'Час роботи', 'errHours' => $ru ? 'Время работы с ошибкой' : 'Час роботи з помилкою',
      'errCode' => $ru ? 'Код ошибки' : 'Код помилки'][$k] ?? $k;
  }
  private static function bad(string $k, string $uk, string $ru): HttpError { return self::fail(422, 'bad_value', ['f' => self::label($k), 'why' => self::$lang === 'ru' ? $ru : $uk], ['field' => $k]); }
  private static function dt(string $s): ?int { if (!preg_match('/^(\d{2})\.(\d{2})\.(\d{4})$/', $s, $m) || !checkdate((int)$m[2], (int)$m[1], (int)$m[3])) return null; return gmmktime(0, 0, 0, (int)$m[2], (int)$m[1], (int)$m[3]); }
  /** Значения из приложения → формат журнала ХТМ (точка, знаки); всё 10 обязательны. */
  private static function vals(array $v): array {
    $out = [];
    foreach (array_keys(HtmCab::F) as $k) {
      $x = trim((string)($v[$k] ?? ''));
      if ($k === 'date') { if (!self::dt($x)) throw self::bad($k, 'потрібна дата дд.мм.рррр.', 'нужна дата дд.мм.гггг.'); $out[$k] = $x; continue; }
      if ($k === 'errCode') { if ($x === '' || mb_strlen($x) > 20 || !preg_match('/^[\p{L}\d\-\s.,:\/]+$/u', $x)) throw self::bad($k, 'як на екрані лічильника, напр. «E---».', 'как на экране счётчика, напр. «E---».'); $out[$k] = $x; continue; }
      $n = str_replace([',', ' '], ['.', ''], $x);
      if ($n === '' || !is_numeric($n) || (float)$n < 0 || (float)$n > 1e8) throw self::bad($k, 'лише цифри й крапка.', 'только цифры и точка.');
      $out[$k] = HtmCab::fmt($k, $n);
    }
    return $out;
  }
  /** Главные правила робота ХТМ против «последних принятых» из кабинета (полные — в приложении, web/src/rules.js). */
  private static function rules(array $v, array $h): void {
    $d = self::dt($v['date']); $b = $h['base'];
    if ($h['min'] && ($m = self::dt($h['min'])) && $d < $m) throw self::bad('date', 'кабінет приймає дати від ' . $h['min'] . '.', 'кабинет принимает даты от ' . $h['min'] . '.');
    if ($h['max'] && ($m = self::dt($h['max'])) && $d > $m) throw self::bad('date', 'кабінет приймає дати до ' . $h['max'] . '.', 'кабинет принимает даты до ' . $h['max'] . '.');
    if (!empty($b['date']) && ($bd = self::dt((string)$b['date'])) && $d <= $bd) throw self::bad('date', 'має бути пізніше останніх прийнятих (' . $b['date'] . ').', 'должна быть позже последних принятых (' . $b['date'] . ').');
    $num = fn($s) => is_numeric(str_replace([',', ' '], ['.', ''], (string)$s)) ? (float)str_replace([',', ' '], ['.', ''], (string)$s) : null;
    foreach (['energy', 'volume', 'hours', 'errHours'] as $k) {
      $p = $num($b[$k] ?? null); if ($p !== null && (float)$v[$k] < $p) throw self::bad($k, 'менше за останні прийняті (' . $b[$k] . ').', 'меньше последних принятых (' . $b[$k] . ').');
    }
    $pe = $num($b['energy'] ?? null); if ($pe !== null && (float)$v['energy'] - $pe >= 15) throw self::bad('energy', 'завеликий приріст — перевірте крапку.', 'слишком большой прирост — проверьте точку.');
    foreach (['tSupply', 'tReturn'] as $k) { $t = (float)$v[$k]; if ($t < 5 || $t > 95) throw self::bad($k, 'від 5 до 95 °C.', 'от 5 до 95 °C.'); }
  }

  /** POST /api/cab/htm/auto {on} — автоподача: фото в бот → приложение распознало и проверило → внесение в очередь, робот вносит сам. */
  public static function auto(int $uid, array $in): array {
    self::lang($in);
    $c = self::creds($uid); if (!$c) throw self::fail(409, 'off');
    $on = ($in['on'] ?? false) === true; $ex = self::js($c['extra']);
    if ($on) { $ex['auto'] = true; $ex['autoAt'] = gmdate('c'); } else unset($ex['auto'], $ex['autoAt']);
    Db::q('UPDATE cab_creds SET extra = ? WHERE user_id = ? AND prov = ?', [json_encode($ex, JSON_UNESCAPED_UNICODE), $uid, self::PROV]);
    if (!$on) Db::q("UPDATE cab_jobs SET status = 'cancelled', result = ?, next_at = 0, updated_at = ? WHERE user_id = ? AND prov = ? AND status = 'queued'", [json_encode(['why' => 'auto_off', 'checkedAt' => time()]), Http::iso(), $uid, self::PROV]);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'htm_cab_auto_' . ($on ? 'on' : 'off'), null, Http::iso()]);
    self::diag(['op' => 'auto', 'user' => $uid, 'result' => $on ? 'on' : 'off']);
    return ['ok' => true] + self::status($uid);
  }
  /** Включена ли автоподача у человека (бот по ней выбирает кнопку «Розпізнати й внести»). */
  public static function autoOn(int $uid): bool { $c = self::creds($uid); return $c && $c['state'] !== 'bad_login' && !empty(self::js($c['extra'])['auto']); }

  /** POST /api/cab/htm/send — внести показания (по нажатию человека; delay — автоподача: в очередь, робот внесёт сам через autoDelay()).
   *  Повтор того же — возвращает уже созданное. */
  public static function send(int $uid, array $in): array {
    self::lang($in);
    $rid = substr(preg_replace('/[^\w\-]/', '', (string)($in['rid'] ?? '')), 0, 40); $place = substr(preg_replace('/[^\w\-]/', '', (string)($in['place'] ?? '')), 0, 40);
    $vals = self::vals((array)($in['vals'] ?? []));
    $c = self::creds($uid); if (!$c) throw self::fail(409, 'off');
    foreach (Db::q("SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? AND status IN ('queued', 'pending', 'ok') ORDER BY id DESC LIMIT 12", [$uid, self::PROV])->fetchAll() as $j) {
      $p = self::js($j['payload']);
      // то же показание (дата + энергия) уже внесено и не отклонено — второй раз не вносим (двойное нажатие, второе устройство)
      if (($p['vals']['date'] ?? '') === $vals['date'] && abs((float)($p['vals']['energy'] ?? -1) - (float)$vals['energy']) < 0.0005) return ['ok' => true, 'dup' => true, 'job' => self::pubJob($j)];
    }
    $acc = preg_replace('/\D/', '', (string)($in['acc'] ?? ''));
    $phone = self::phone($in['phone'] ?? ''); $email = filter_var(trim((string)($in['email'] ?? '')), FILTER_VALIDATE_EMAIL) ?: '';
    $payload = ['rid' => $rid, 'place' => $place, 'vals' => $vals, 'lang' => self::$lang];
    if (($in['delay'] ?? false) === true) {
      if ($c['state'] === 'bad_login') throw self::fail(401, 'relogin');
      if (empty(self::js($c['extra'])['auto'])) throw self::fail(409, 'auto_off');
      self::limit($uid);
      $at = time() + self::autoDelay();
      Db::q("INSERT INTO cab_jobs (user_id, prov, acc, payload, status, result, tries, next_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?)",
        [$uid, self::PROV, $acc, json_encode($payload + ['auto' => true, 'phone' => $phone, 'email' => $email], JSON_UNESCAPED_UNICODE), json_encode(['checkedAt' => time()]), $at, Http::iso(), Http::iso()]);
      $job = Db::one('SELECT * FROM cab_jobs WHERE id = ?', [Db::id()]);
      Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'htm_cab_send_queued', null, Http::iso()]);
      self::diag(['op' => 'queue', 'user' => $uid, 'result' => 'queued']);
      self::notify($uid, self::pubJob($job));
      return ['ok' => true, 'job' => self::pubJob($job)];
    }
    self::limit($uid);
    [$a, $r] = self::submit($uid, $acc, $vals, $phone, $email, 'send');
    return ['ok' => true, 'job' => self::record($uid, $a, $payload, $r)];
  }
  /** Войти, проверить форму и правила против «последних принятых», внести. → [рахунок, итог HtmCab::save]. Ошибки — HttpError с человеческим текстом. */
  private static function submit(int $uid, string $want, array $vals, string $phone, string $email, string $op): array {
    [$cab, $acc, $c] = self::enter($uid, $want, $op);
    $ex = self::js($c['extra']);
    try {
      $h = $cab->heat($acc['acc'], $acc['sur']);
      if (!$h['open']) { self::diag(['op' => $op, 'user' => $uid, 'result' => 'closed', 'closed' => $h['closed'] ? CabWeb::mask($h['closed'], 160) : null, 'steps' => $cab->w->steps]); throw self::fail(409, 'closed', [], $h['closed'] ? ['site' => mb_substr($h['closed'], 0, 300)] : []); }
      $fi = self::formInfo($h);
      if (!$fi['match']) { self::diag(['op' => $op, 'user' => $uid, 'result' => 'form_changed', 'form' => $fi, 'steps' => $cab->w->steps]); throw self::fail(409, 'form_changed'); }
      self::rules($vals, $h);
      $phone = $phone ?: (string)($ex['phone'] ?? '');
      $email = $email ?: (string)$c['login'];
      if ($phone === '' && in_array('phone', array_column($fi['fields'], 'r'), true)) throw self::fail(422, 'need_phone');
      $r = $cab->save($acc['acc'], $acc['sur'], $vals, ['phone' => $phone, 'email' => $email, 'note' => ''], $h);
    } catch (CabErr $e) {
      self::diag(['op' => $op, 'user' => $uid, 'result' => $e->err, 'site' => CabWeb::mask($e->site), 'fields' => $cab->log['fields'] ?? null, 'steps' => $cab->w->steps]);
      throw self::cabErr($e);
    } finally { $cab->logout(); }
    if ($phone !== '' && $phone !== ($ex['phone'] ?? '')) Db::q('UPDATE cab_creds SET extra = ? WHERE user_id = ? AND prov = ?', [json_encode(['phone' => $phone] + $ex, JSON_UNESCAPED_UNICODE), $uid, self::PROV]);
    self::diag(['op' => $op, 'user' => $uid, 'result' => in_array($r['status'], ['ok', 'rejected'], true) ? $r['status'] : 'pending', 'flash' => CabWeb::mask((string)$r['flash'], 160), 'steps' => $cab->w->steps]);
    return [$acc['acc'], $r];
  }
  /** Итог внесения → строка cab_jobs (новая или из очереди). Сразу «прийнято/не прийнято» — Telegram сразу, иначе ждём робота ХТМ. */
  private static function record(int $uid, string $acc, array $payload, array $r, ?int $jobId = null): array {
    $st = in_array($r['status'], ['ok', 'rejected'], true) ? $r['status'] : 'pending';
    $res = ['text' => mb_substr((string)$r['text'], 0, 400), 'reason' => $r['reason'] ? mb_substr((string)$r['reason'], 0, 400) : null, 'flash' => mb_substr((string)$r['flash'], 0, 300), 'checkedAt' => time()];
    $next = $st === 'pending' ? time() + self::AFTER[0] * 60 : 0;
    if ($jobId) Db::q('UPDATE cab_jobs SET acc = ?, status = ?, result = ?, tries = 0, next_at = ?, created_at = ?, updated_at = ? WHERE id = ?', [$acc, $st, json_encode($res, JSON_UNESCAPED_UNICODE), $next, Http::iso(), Http::iso(), $jobId]);
    else Db::q('INSERT INTO cab_jobs (user_id, prov, acc, payload, status, result, tries, next_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [$uid, self::PROV, $acc, json_encode($payload, JSON_UNESCAPED_UNICODE), $st, json_encode($res, JSON_UNESCAPED_UNICODE), $next, Http::iso(), Http::iso()]);
    $job = Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$jobId ?: Db::id()]);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'htm_cab_send_' . $st, null, Http::iso()]);
    if ($st !== 'pending') self::notify($uid, self::pubJob($job));
    return self::pubJob($job);
  }
  /** Внесение из очереди автоподачи: сейчас (кнопка «Внести зараз» или cron по сроку). Не вышло — failed с человеческим текстом и Telegram. */
  private static function runQueued(array $j): array {
    $uid = (int)$j['user_id']; $p = self::js($j['payload']); self::$lang = ($p['lang'] ?? '') === 'ru' ? 'ru' : 'uk';
    // захватываем строку: второй cron или «Внести зараз» в ту же секунду не внесёт дважды
    if (Db::q("UPDATE cab_jobs SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'queued'", [Http::iso(), $j['id']])->rowCount() !== 1) return self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]));
    try {
      [$a, $r] = self::submit($uid, (string)$j['acc'], (array)$p['vals'], (string)($p['phone'] ?? ''), (string)($p['email'] ?? ''), 'autosend');
      return self::record($uid, $a, $p, $r, (int)$j['id']);
    } catch (Throwable $e) {
      $why = $e instanceof HttpError ? preg_replace('/^cab_/', '', $e->err) : 'down';
      $human = $e instanceof HttpError ? (string)($e->extra['human'] ?? '') : self::h('down');
      Db::q("UPDATE cab_jobs SET status = 'failed', result = ?, next_at = 0, updated_at = ? WHERE id = ?", [json_encode(['why' => $why, 'human' => mb_substr($human, 0, 300), 'field' => $e instanceof HttpError ? ($e->extra['field'] ?? null) : null, 'checkedAt' => time()], JSON_UNESCAPED_UNICODE), Http::iso(), $j['id']]);
      Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'htm_cab_auto_failed', null, Http::iso()]);
      $job = self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]));
      self::notify($uid, $job);
      return $job;
    }
  }
  private static function queued(int $uid, array $in): array {
    $j = Db::one("SELECT * FROM cab_jobs WHERE id = ? AND user_id = ? AND prov = ?", [(int)($in['job'] ?? 0), $uid, self::PROV]);
    if (!$j || $j['status'] !== 'queued') throw self::fail(409, 'no_job', [], $j ? ['job' => self::pubJob($j)] : []);
    return $j;
  }
  /** POST /api/cab/htm/cancel {job} — отменить внесение из очереди автоподачи. */
  public static function cancel(int $uid, array $in): array {
    self::lang($in); $j = self::queued($uid, $in);
    Db::q("UPDATE cab_jobs SET status = 'cancelled', result = ?, next_at = 0, updated_at = ? WHERE id = ? AND status = 'queued'", [json_encode(['why' => 'user', 'checkedAt' => time()]), Http::iso(), $j['id']]);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'htm_cab_auto_cancel', null, Http::iso()]);
    self::diag(['op' => 'cancel', 'user' => $uid, 'result' => 'ok']);
    return ['ok' => true, 'job' => self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]))];
  }
  /** POST /api/cab/htm/now {job} — внести из очереди сейчас, не дожидаясь срока. */
  public static function now(int $uid, array $in): array {
    self::lang($in); $j = self::queued($uid, $in); self::limit($uid);
    return ['ok' => true, 'job' => self::runQueued($j)];
  }

  // ---------- cron: перечитать журнал ----------
  /** Внесения «на перевірці» — раз в минуту не больше 6, по одному входу на человека. → [[job id, итог], …] */
  public static function cron(?int $now = null): array {
    $now = $now ?? time(); $out = [];
    // автоподача: срок очереди вышел — вносим (не больше 3 за минуту: каждое — свой вход в кабинет)
    foreach (Db::q("SELECT * FROM cab_jobs WHERE prov = ? AND status = 'queued' AND next_at <= ? ORDER BY next_at LIMIT 3", [self::PROV, $now])->fetchAll() as $j) {
      $r = self::runQueued($j); $out[] = [(int)$j['id'], 'auto ' . $r['status']];
    }
    $jobs = Db::q("SELECT * FROM cab_jobs WHERE prov = ? AND status = 'pending' AND next_at <= ? ORDER BY next_at LIMIT 6", [self::PROV, $now])->fetchAll();
    $by = []; foreach ($jobs as $j) $by[(int)$j['user_id']][] = $j;
    foreach ($by as $uid => $list) {
      $pages = []; $cab = null; $fatal = null;
      try { [$cab] = self::enter($uid, (string)$list[0]['acc'], 'recheck'); }
      catch (HttpError $e) { $fatal = $e->err; }
      foreach ($list as $j) {
        $p = self::js($j['payload']); $tries = (int)$j['tries'] + 1; $res = self::js($j['result']);
        $row = null; $err = $fatal;
        if (!$err) {
          try {
            $accs = self::js((string)(self::creds($uid)['info'] ?? ''))['accounts'] ?? []; $sur = null; foreach ($accs as $a) if ($a['acc'] === $j['acc']) $sur = $a['sur'];
            if ($sur === null) $err = 'cab_no_acc';
            else { $pages[$j['acc']] = $pages[$j['acc']] ?? $cab->heat($j['acc'], $sur)['journal']; $row = HtmCab::find($pages[$j['acc']], (string)$p['vals']['date'], (string)$p['vals']['energy']); }
          } catch (CabErr $e) { $err = 'cab_' . $e->err; }
        }
        $fin = $row && in_array($row['status'], ['ok', 'rejected'], true) ? $row['status'] : null;
        // пароль не подошёл или капча — ждать бессмысленно: «перевірте самі»
        if (!$fin && in_array($err, ['cab_relogin', 'cab_captcha', 'cab_off', 'cab_no_acc'], true)) { $fin = 'unknown'; $res['why'] = substr($err, 4); }
        if (!$fin && $tries >= count(self::AFTER)) { $fin = 'unknown'; $res['why'] = $row ? 'slow' : ($err ? 'down' : 'lost'); }
        $res['checkedAt'] = $now;
        if ($row) { $res['text'] = mb_substr((string)$row['text'], 0, 400); $res['reason'] = isset($row['reason']) ? mb_substr((string)$row['reason'], 0, 400) : ($res['reason'] ?? null); }
        if ($fin) Db::q('UPDATE cab_jobs SET status = ?, result = ?, tries = ?, next_at = 0, updated_at = ? WHERE id = ?', [$fin, json_encode($res, JSON_UNESCAPED_UNICODE), $tries, Http::iso(), $j['id']]);
        else {
          $t0 = strtotime((string)$j['created_at']) ?: $now;
          Db::q('UPDATE cab_jobs SET result = ?, tries = ?, next_at = ?, updated_at = ? WHERE id = ?', [json_encode($res, JSON_UNESCAPED_UNICODE), $tries, max($now + 300, $t0 + self::AFTER[$tries] * 60), Http::iso(), $j['id']]);
        }
        if ($fin) { $jj = Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]); self::notify($uid, self::pubJob($jj)); }
        $out[] = [(int)$j['id'], $fin ?? ('wait' . ($err ? ' ' . $err : ''))];
      }
      if ($cab) $cab->logout();
      self::diag(['op' => 'recheck', 'user' => $uid, 'result' => implode(',', array_map(fn($x) => $x[1], array_filter($out, fn($x) => in_array($x[0], array_map(fn($j) => (int)$j['id'], $list), true)))), 'steps' => $cab ? $cab->w->steps : []]);
    }
    return $out;
  }

  /** «✅ ХТМ прийняв» / «❌ не прийняв: причина» / «⏳ не дочекались» — в Telegram человеку (если привязан). */
  public static function notify(int $uid, array $job): void {
    $tg = Db::one("SELECT external_id FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$uid]); if (!$tg || !Cfg::get('bot_token')) return;
    $jr = Db::one('SELECT payload FROM cab_jobs WHERE id = ?', [$job['id']]); $ru = (self::js($jr['payload'] ?? '')['lang'] ?? 'uk') === 'ru';
    $what = ($ru ? 'от ' : 'від ') . $job['date'] . ' (' . $job['energy'] . ' Гкал' . ($job['acc'] ? ($ru ? ', счёт ' : ', рахунок ') . $job['acc'] : '') . ')';
    if ($job['status'] === 'cancelled') return;
    if ($job['status'] === 'queued') {
      $hm = (new DateTimeImmutable('@' . (int)$job['nextAt']))->setTimezone(new DateTimeZone('Europe/Kyiv'))->format('H:i');
      $txt = $ru ? "📝 Распознали показания тепла $what — все проверки пройдены.\nВнесём в кабинет ХТМ в $hm. Что-то не так — нажмите «Отменить» в «Счётчиках» до этого времени."
                 : "📝 Розпізнали показання тепла $what — усі перевірки пройдено.\nВнесемо в кабінет ХТМ о $hm. Щось не так — натисніть «Скасувати» в «Лічильниках» до цього часу.";
    }
    elseif ($job['status'] === 'failed') $txt = ($ru ? "⚠️ Не внесли показания тепла $what в кабинет ХТМ.\n" : "⚠️ Не внесли показання тепла $what у кабінет ХТМ.\n") . ($job['human'] ?: self::h('down')) .
      ($ru ? "\n\nОткройте «Счётчики» — там можно исправить и внести кнопкой или внести самим на сайте ХТМ." : "\n\nВідкрийте «Лічильники» — там можна виправити й внести кнопкою або внести самим на сайті ХТМ.");
    elseif ($job['status'] === 'ok') $txt = ($ru ? "✅ ХТМ принял показания тепла $what." : "✅ ХТМ прийняв показання тепла $what.") . ($job['text'] !== '' ? "\n«" . $job['text'] . '»' : '');
    elseif ($job['status'] === 'rejected') $txt = ($ru ? "❌ ХТМ не принял показания тепла $what.\nПричина: " : "❌ ХТМ не прийняв показання тепла $what.\nПричина: ") . ($job['reason'] ?: $job['text'] ?: '—') .
      ($ru ? "\n\nОткройте «Счётчики» — подскажем, что исправить, и внесём снова." : "\n\nВідкрийте «Лічильники» — підкажемо, що виправити, і внесемо знову.");
    elseif ($job['why'] === 'relogin') $txt = $ru ? "🔑 Пароль от кабинета ХТМ больше не подходит — робот не может проверить показания $what. Подключите кабинет заново в «Счётчиках» или посмотрите журнал на сайте ХТМ." : "🔑 Пароль від кабінету ХТМ більше не підходить — робот не може перевірити показання $what. Підключіть кабінет знову в «Лічильниках» або подивіться журнал на сайті ХТМ.";
    elseif ($job['why'] === 'forgot') return;
    else $txt = $ru ? "⏳ Робот ХТМ так и не проверил показания $what. Посмотрите журнал в кабинете ХТМ позже — если там «прийнято», отметьте это в «Счётчиках»." : "⏳ Робот ХТМ так і не перевірив показання $what. Подивіться журнал у кабінеті ХТМ пізніше — якщо там «прийнято», позначте це в «Лічильниках».";
    $p = ['chat_id' => $tg['external_id'], 'text' => $txt];
    if (Cfg::appUrlKnown()) $p['reply_markup'] = ['inline_keyboard' => [[['text' => $ru ? 'Открыть «Счётчики»' : 'Відкрити «Лічильники»', 'web_app' => ['url' => Cfg::appUrl() . '?go=heat' . ($job['place'] ? '&place=' . rawurlencode((string)$job['place']) : '')]]]]];
    try { Telegram::call('sendMessage', $p); } catch (Throwable $e) { /* не дошло — в приложении статус всё равно виден */ }
  }

  // ---------- журнал для /admin и /api/health: без паролей, рахунков и слов с цифрами ----------
  /** Путь страницы кабинета без рахунку и прізвища (они в адресе: /cabinet/heat/{рахунок}/{ПРІЗВИЩЕ}). */
  public static function path(string $p): string { return preg_replace('~^(/cabinet/(?:[a-z\-]+/)*?)\d{4,14}(?:/[^/?#]+)?~i', '$1{acc}/{sur}', $p); }
  private static function diag(array $d): void {
    $d = ['at' => time()] + $d;
    if (isset($d['steps'])) $d['steps'] = array_map(fn($s) => [$s[0], self::path((string)$s[1])] + $s, (array)$d['steps']);
    if (isset($d['form']['action'])) $d['form']['action'] = self::path((string)$d['form']['action']);
    $l = self::log(); $l[] = $d; $l = array_slice($l, -40);
    @mkdir(dirname(self::logFile()), 0700, true); @file_put_contents(self::logFile(), json_encode($l, JSON_UNESCAPED_UNICODE), LOCK_EX);
  }
  /** /api/health → htmcab: «операция итог» по журналу, последняя операция человека, последняя увиденная форма (имена и типы полей) и внесения по статусам. */
  public static function summary(): array {
    $n = []; $last = null; $form = null; $seen = null;
    foreach (self::log() as $e) {
      // что робот прочитал со страницы тепла при последней проверке — без значений: нашёл ли прибор, какие «последние принятые», окно, статусы журнала
      if (($e['op'] ?? '') === 'check' && ($e['result'] ?? '') === 'ok') $seen = ['at' => gmdate('c', (int)$e['at']), 'meter' => $e['meter'] ?? null, 'base' => $e['base'] ?? [],
        'open' => !empty($e['form']['open']), 'minMax' => $e['form']['minMax'] ?? null, 'journal' => array_count_values(array_map('strval', (array)($e['journal'] ?? []))), 'closed' => $e['closed'] ?? null];
      $k = preg_replace('/[^a-z]/', '', (string)($e['op'] ?? '?')) . ' ' . preg_replace('/[^a-z_,]/', '', (string)($e['result'] ?? '?'));
      $n[$k] = ($n[$k] ?? 0) + 1;
      if (($e['op'] ?? '') !== 'recheck') $last = max((int)$last, (int)($e['at'] ?? 0));
      if (!empty($e['form']['open'])) $form = ['at' => gmdate('c', (int)$e['at']), 'match' => $e['form']['match'], 'missing' => $e['form']['missing'], 'unknown' => $e['form']['unknown'],
        'fields' => array_map(fn($f) => trim(($f['n'] ?? '') . ':' . ($f['t'] ?? '') . (isset($f['r']) ? '→' . $f['r'] : '')), $e['form']['fields'] ?? []),
        // подсказки сайта к полям (обязательное, длина, шаблон, placeholder) — чтобы сверить формат телефона и чисел
        'hints' => (object)array_filter(array_combine(array_map(fn($f) => (string)($f['n'] ?? ''), $e['form']['fields'] ?? []), array_map(fn($f) => implode(' ', array_filter([!empty($f['req']) ? 'req' : '', isset($f['max']) ? 'max=' . $f['max'] : '', isset($f['pat']) ? 'pat=' . $f['pat'] : '', isset($f['ph']) ? 'ph=' . $f['ph'] : ''])), $e['form']['fields'] ?? [])))];
    }
    ksort($n); $jobs = [];
    try { foreach (Db::q('SELECT status, COUNT(*) AS c FROM cab_jobs WHERE prov = ? GROUP BY status', [self::PROV])->fetchAll() as $x) $jobs[$x['status']] = (int)$x['c']; } catch (Throwable $e) {}
    $cr = 0; try { $cr = (int)(Db::one('SELECT COUNT(*) AS c FROM cab_creds WHERE prov = ?', [self::PROV])['c'] ?? 0); } catch (Throwable $e) {}
    return ['n' => (object)$n, 'lastUser' => $last ? gmdate('c', $last) : null, 'connected' => $cr, 'jobs' => (object)$jobs, 'form' => $form, 'seen' => $seen];
  }
}
