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
    // «сайт ХТМ не отвечает / незнакомая страница» — 424, не 502: 502 и 504 от нас Cloudflare подменяет своей HTML-страницей, и приложение
    // вместо «Сайт ХТМ зараз не відповідає» писало «Не вдалося зв'язатися з сервером» (06.11 22:14, «Перевірити» владельца)
    $map = ['bad_login' => 401, 'captcha' => 423, 'down' => 424, 'changed' => 424, 'form_changed' => 409, 'closed' => 409, 'form_error' => 422, 'bad_value' => 422];
    $site = in_array($e->err, ['bad_login', 'form_error', 'closed'], true) && $e->site !== '' ? ['site' => mb_substr($e->site, 0, 300)] : [];
    return self::fail($map[$e->err] ?? 424, isset($map[$e->err]) && $e->err !== 'bad_value' ? $e->err : 'changed', [], $site);
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
      'minMax' => $h['min'] !== null && $h['max'] !== null, 'win' => $h['win'] ?? null];
  }
  /** Как страница тепла задаёт окно дат и сколько на ней плашек — без значений и личных данных (то же, что пишет «Перевірити»):
   *  пишется и при внесении, чтобы первое живое внесение само показало окно, не дожидаясь «Перевірити». */
  private static function page(array $h): array {
    return ['minMax' => $h['min'] !== null && $h['max'] !== null, 'win' => $h['win'] ?? null, 'dateJs' => $h['dateJs'] ?? [], 'alerts' => $h['alerts'] ?? null];
  }
  private static function pubJournal(array $j): array {
    return array_map(fn($r) => ['date' => $r['date'], 'energy' => $r['energy'], 'status' => $r['status'], 'text' => mb_substr((string)$r['text'], 0, 300), 'reason' => $r['reason'] ?? null], array_slice($j, 0, 8));
  }

  /** POST /api/cab/htm/check — что видит кабинет. Ничего не вносит. */
  public static function check(int $uid, array $in): array {
    self::lang($in); self::limit($uid);
    [$acc, $h, $fi] = self::look($uid, (string)($in['acc'] ?? ''), 'check');
    [$lo, $hi] = self::window($h);
    return ['ok' => true, 'acc' => $acc['acc'], 'meter' => $h['meter'], 'base' => (object)$h['base'], 'open' => $h['open'], 'closed' => $h['closed'], 'min' => $lo, 'max' => $hi, 'winSrc' => $h['min'] !== null && $h['max'] !== null ? 'page' : 'calendar',
      'journal' => self::pubJournal($h['journal']), 'form' => ['open' => $h['open'], 'match' => $fi['match'] ?? null, 'phone' => in_array('phone', array_column($fi['fields'] ?? [], 'r'), true)]];
  }

  /** Войти и прочитать страницу тепла — ничего не вносит. op: check (кнопка человека) | look (cron, учётки админа). → [рахунок, страница, форма без значений]. */
  private static function look(int $uid, string $want, string $op): array {
    [$cab, $acc] = self::enter($uid, $want, $op);
    $ex = null;
    try {
      $h = $cab->heat($acc['acc'], $acc['sur']);
      // осмотр кабинета (только чтение): где квитанция — меню, карточка рахунку, платежі; сбой осмотра «Перевірити» не ломает
      $pg = []; if (!empty($cab->home['url'])) $pg[(string)$cab->home['url']] = (string)$cab->home['body']; $pg[(string)$h['url']] = (string)$h['html'];
      try { $ex = $cab->explore($pg, $acc['acc'], $acc['sur']); } catch (Throwable $e) { $ex = ['err' => CabWeb::mask($e->getMessage(), 80)]; }
      // «Довідка по теплу» — структура таблицы (заголовки, маски ячеек) в _last; LOOK_V 5: + весь журнал квартирного лічильника (viewall) к уже сохранённой довідке
      // этой учётки (свои данные админа, как у bill) — сервер сверяет «витрату по квартирі» со своим лічильником (HtmSpr::check → own)
      try { $sp = $cab->sprTeplo($acc['acc'], $acc['sur']); if ($sp) { HtmSpr::saveShape($sp); HtmSpr::refresh($uid, $sp, $cab->ownJournal($h, $acc['acc'], $acc['sur'])); } } catch (Throwable $e) {}
    }
    catch (CabErr $e) { self::diag(['op' => $op, 'user' => $uid, 'result' => $e->err, 'steps' => $cab->w->steps]); throw self::cabErr($e); }
    finally { $cab->logout(); }
    $fi = self::formInfo($h);
    self::diag(['op' => $op, 'user' => $uid, 'result' => 'ok', 'meter' => (bool)$h['meter'], 'base' => array_keys($h['base']), 'form' => $fi, 'win' => [$h['min'] !== null, $h['max'] !== null, $h['win'] ?? null], 'dateJs' => $h['dateJs'] ?? [], 'alerts' => $h['alerts'] ?? null, 'journal' => array_map(fn($r) => $r['status'], $h['journal']), 'closed' => $h['closed'] ? CabWeb::mask($h['closed'], 160) : null,
      'explore' => $ex ? array_diff_key($ex, ['billBody' => 1, 'billRaw' => 1]) : null, 'steps' => $cab->w->steps]);
    return [$acc, $h, $fi, $ex];
  }
  /** «Перевірити» без кнопки: владелец неделю не нажимал (06.11 17:26 — последний раз, а окно дат, плашки и журнал нужны до первого живого внесения).
   *  Раз на LOOK_V (сайт не ответил — ещё до 3 раз, через 10 мин) сервер сам читает кабинеты ХТМ УЧЁТОК АДМИНА (config.php → admins), как VkStatus::recheck
   *  у Водоканала: только чтение, ничего не вносит; рахунок — первый из кабинета. Итог — /api/health → htmcab.seen (by: cron) и htmcab.look. → итоги или null. */
  const LOOK_V = 7;   // 2: осмотр кабинета — где квитанция (explore), 07.11.2026; 3: + «Довідки щодо нарахувань» (spravka, sprvds) — есть ли прошлые рахунки; 4: + структура «Довідки по теплу» (08.11);
                      // 5: + журнал квартирного лічильника (viewall) к довідке — формула «витрати по квартирі» (08.11, 59-я сессия)
                      // 6: + архив рахунків — адрес рахунку за прошлый месяц и строки «Довідок щодо нарахувань» масками (09.11, 82-я)
                      // 7: довідка — <pre> с таблицей внутри (на 6 вышла одной строкой): строки по br/tr; до 90 строк по 160 знаков
  /** LOOK_V 6: есть ли в кабинете прошлые рахунки (HtmCab::archive) — отдельным входом, только чтение. В журнал — без цифр и людей:
   *  строки довідок — HtmSpr::gw (цифры → #, не общие слова → Ж), сколько строк похожи на месяцы и сколько со словами нарахування/оплати/перерахунку. */
  private static function archiveLook(int $uid, string $want): string {
    [$cab, $acc] = self::enter($uid, $want, 'archive');
    try { $a = $cab->archive($acc['acc'], $acc['sur']); }
    catch (CabErr $e) { self::diag(['op' => 'archive', 'user' => $uid, 'result' => $e->err, 'steps' => $cab->w->steps]); return $e->err; }
    finally { $cab->logout(); }
    $docs = [];
    foreach ($a['docs'] as $k => $d) {
      if (isset($d['lines'])) {
        $ls = (array)$d['lines']; $kw = [];
        foreach (['борг' => '/борг/iu', 'нарах' => '/нарах/iu', 'донарах' => '/донарах/iu', 'перерах' => '/перерах|скорег|коригув/iu', 'оплач' => '/оплач|сплач|надійш|надход/iu', 'гкал' => '/гкал/iu', 'серед' => '/середн/iu', 'тепл' => '/тепл/iu', 'гаряч' => '/гаряч|гвп/iu'] as $w => $re)
          $kw[$w] = count(array_filter($ls, fn($l) => preg_match($re, $l)));
        $d = ['n' => count($ls), 'months' => count(array_filter($ls, fn($l) => HtmCab::monthOf($l) !== null || preg_match('/(?<!\d)\d{2}\.20\d\d(?!\d)/', $l))), 'kw' => $kw,
          'lines' => array_map(fn($l) => HtmSpr::gw($l, 160), array_slice($ls, 0, 90))] + array_diff_key($d, ['lines' => 1]);
      }
      $docs[$k] = $d;
    }
    self::diag(['op' => 'archive', 'user' => $uid, 'result' => 'ok', 'archive' => ['base' => $a['base'], 'page' => $a['page'], 'probe' => $a['probe'], 'docs' => $docs], 'steps' => $cab->w->steps]);
    return 'ok';
  }
  public static function lookFile(): string { return Cfg::data() . '/cache/htm_look.json'; }
  public static function lookState(): array { $j = json_decode((string)@file_get_contents(self::lookFile()), true); return is_array($j) ? $j : []; }
  public static function lookAdmins(?int $now = null): ?array {
    $now = $now ?? time(); $j = self::lookState();
    if ((int)($j['v'] ?? 0) === self::LOOK_V) {   // уже было на этой версии: повтор — только если сайт ХТМ не ответил (до 3 раз, не чаще раза в 10 мин)
      $retry = in_array('cab_down', (array)($j['res'] ?? []), true) && (int)($j['tries'] ?? 0) < 3 && $now - (int)($j['at'] ?? 0) >= 600;
      if (!$retry) return null;
    }
    $res = [];
    foreach (Db::q("SELECT c.user_id, c.info, u.email FROM cab_creds c JOIN users u ON u.id = c.user_id WHERE c.prov = ? AND c.state <> 'bad_login' ORDER BY c.user_id", [self::PROV])->fetchAll() as $c) {
      if (count($res) >= 2) break;
      if (!Admin::is(['id' => (int)$c['user_id'], 'email' => $c['email']])) continue;
      $acc = (string)(self::js($c['info'])['accounts'][0]['acc'] ?? '');
      try { self::look((int)$c['user_id'], $acc, 'look'); $res[] = 'ok'; } catch (HttpError $e) { $res[] = $e->err; }
      // 6: есть ли прошлые рахунки и что в «Довідках щодо нарахувань» — отдельным входом (свой бюджет 25 с)
      if (end($res) === 'ok') { try { $res[] = 'arch ' . self::archiveLook((int)$c['user_id'], $acc); } catch (HttpError $e) { $res[] = 'arch ' . $e->err; } }
    }
    $same = (int)($j['v'] ?? 0) === self::LOOK_V;
    $j = ['v' => self::LOOK_V, 'at' => $now, 'res' => $res, 'tries' => ($same ? (int)($j['tries'] ?? 0) : 0) + 1];
    @mkdir(dirname(self::lookFile()), 0700, true); @file_put_contents(self::lookFile(), json_encode($j), LOCK_EX);
    return $res;
  }

  /** Квитанция из кабинета ХТМ (только чтение): вход сохранённым паролем → «Сформувати рахунок» (HTML «Рахунок за <місяць> <рік> року», живой кабинет 07.11.2026)
   *  → копия страницы (HtmCab::billDoc: без скриптов, стили и картинки внутри) в docs (kind bill, src htm, mime text/html, ym — из заголовка рахунку).
   *  Рахунку нет — запасной путь: осмотр кабинета и PDF, похожий на квитанцию за $ym (как было до 07.11). Та же (отпечаток текста) — same; нет — none.
   *  Журнал кабинета: op autobill (cron — не человек), итог bill | same | nobill — без цифр и прізвищ. → {doc, ym, pay, kind} | {same, doc, ym, pay} | {none} */
  /** З таблиці рахунку (HtmSpr::billTable) — те, що пояснює «до сплати» людині: нараховано за місяць за тепло й ГВ і тепло наперед
   *  («донараховано до кінця поточного місяця» / «… до кінця попереднього місяця» — зняте). Лише числа рахунку цієї людини, у її ж запис. */
  public static function billParts(array $bt): array {
    $o = [];
    foreach (['pre' => $bt['pre'] ?? null, 'unpre' => $bt['unpre'] ?? null, 'heatM' => $bt['heat']['month'] ?? null, 'hotM' => $bt['hot']['month'] ?? null] as $k => $v)
      if (is_int($v) || is_float($v)) $o[$k] = number_format((float)$v, 2, '.', '');
    return $o;
  }
  public static function bill(int $uid, string $want, string $place, string $ym): array {
    [$cab, $acc] = self::enter($uid, $want, 'autobill');
    $bp = null; $bd = null; $ex = null;
    try {
      try { $bp = $cab->billPage($acc['acc'], $acc['sur']); } catch (CabErr $e) { if ($e->err !== 'down') throw $e; }
      if ($bp) $bd = $cab->billDoc($bp);
      else { $pg = []; if (!empty($cab->home['url'])) $pg[(string)$cab->home['url']] = (string)$cab->home['body']; $ex = $cab->explore($pg, $acc['acc'], $acc['sur'], $ym); }
      // «Довідка по теплу» — нарахування ХТМ по місяцях (втрати будинку, витрата по квартирі, абонплата): той самий вхід, лише читання
      try {
        $sp = $cab->sprTeplo($acc['acc'], $acc['sur']);
        if ($sp) {   // + журнал свого лічильника (витрата по квартирі = свій лічильник + частка будинку) — той самий вхід, лише читання
          try { $sp['own'] = $cab->ownJournal($cab->heat($acc['acc'], $acc['sur']), $acc['acc'], $acc['sur']); } catch (CabErr $e) { if ($e->err === 'captcha') throw $e; }
          HtmSpr::save($uid, $place, $sp);
        }
      } catch (CabErr $e) { if ($e->err === 'captcha') throw $e; }
    }
    catch (CabErr $e) { self::diag(['op' => 'autobill', 'user' => $uid, 'result' => $e->err, 'steps' => $cab->w->steps]); throw self::cabErr($e); }
    finally { $cab->logout(); }
    $mn = fn(string $m) => ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'][(int)substr($m, 5, 2) - 1] . ' ' . substr($m, 0, 4);
    if ($bp && $bd) {
      $sha = sha1('htm|' . $bp['text']); $info = ['ym' => $bp['ym'], 'pay' => $bp['pay'] !== null, 'bytes' => strlen($bd['html']), 'css' => $bd['css'], 'img' => $bd['img']];
      $parts = self::billParts(HtmSpr::billTable((string)$bp['html']));
      if ($d = Docs::bySha($uid, $sha)) { self::diag(['op' => 'autobill', 'user' => $uid, 'result' => 'same', 'page' => $info, 'steps' => $cab->w->steps]); return ['same' => true, 'doc' => $d, 'ym' => $bp['ym'], 'pay' => $bp['pay'], 'parts' => $parts, 'kind' => 'html']; }
      $doc = Docs::put($uid, $bd['html'], 'text/html', 'html', $place, 'bill', 'Квитанція ХТМ, ' . $mn($bp['ym']), ['src' => 'htm', 'ym' => $bp['ym'], 'sha' => $sha]);
      self::diag(['op' => 'autobill', 'user' => $uid, 'result' => 'bill', 'page' => $info, 'steps' => $cab->w->steps]);
      return ['doc' => $doc, 'ym' => $bp['ym'], 'pay' => $bp['pay'], 'parts' => $parts, 'guess' => false, 'kind' => 'html'];
    }
    $body = (string)($ex['billBody'] ?? ''); $raw = (array)($ex['billRaw'] ?? []);
    $pub = array_diff_key((array)$ex, ['billBody' => 1, 'billRaw' => 1]);
    if ($body === '') { self::diag(['op' => 'autobill', 'user' => $uid, 'result' => 'nobill', 'explore' => $pub, 'steps' => $cab->w->steps]); return ['none' => true]; }
    $sha = sha1($body);
    if ($d = Docs::bySha($uid, $sha)) { self::diag(['op' => 'autobill', 'user' => $uid, 'result' => 'same', 'steps' => $cab->w->steps]); return ['same' => true, 'doc' => $d, 'ym' => (string)($d['ym'] ?? ''), 'kind' => 'pdf']; }
    $dym = HtmCab::monthOf((string)($raw['txt'] ?? '')) ?? HtmCab::monthOf((string)($raw['row'] ?? '')) ?? HtmCab::monthOf((string)($raw['disp'] ?? '')) ?? HtmCab::monthOf((string)($raw['u'] ?? ''));
    $guess = $dym === null; $dym = $dym ?? $ym;
    $doc = Docs::put($uid, $body, 'application/pdf', 'pdf', $place, 'bill', 'Квитанція ХТМ, ' . $mn($dym), ['src' => 'htm', 'ym' => $dym, 'sha' => $sha]);
    self::diag(['op' => 'autobill', 'user' => $uid, 'result' => 'bill', 'guess' => $guess, 'bill' => $pub['bill'] ?? null, 'steps' => $cab->w->steps]);
    return ['doc' => $doc, 'ym' => $dym, 'guess' => $guess, 'kind' => 'pdf'];
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
  /** Окно дат формы → [від, до] (dd.mm.yyyy): со страницы кабинета; чего нет — по календарю Киева (1-е число месяца … сегодня). */
  public static function window(array $h, ?int $now = null): array {
    $k = (new DateTimeImmutable('@' . ($now ?? time())))->setTimezone(new DateTimeZone('Europe/Kyiv'));
    $lo = $h['min'] && self::dt((string)$h['min']) ? (string)$h['min'] : $k->format('01.m.Y');
    $hi = $h['max'] && self::dt((string)$h['max']) ? (string)$h['max'] : $k->format('d.m.Y');
    return [$lo, $hi];
  }
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
    // окно дат: со страницы (min/max датапикера), иначе — по календарю, как правило ХТМ «показання поточного місяця»: с 1-го числа по сегодня (Киев).
    // Важно для очереди: внесение, поставленное 31-го, а внесённое 1-го, или дата «завтра» — не уйдут.
    [$lo, $hi] = self::window($h);
    if ($d < self::dt($lo)) throw self::bad('date', 'кабінет приймає дати від ' . $lo . '.', 'кабинет принимает даты от ' . $lo . '.');
    if ($d > self::dt($hi)) throw self::bad('date', 'кабінет приймає дати до ' . $hi . '.', 'кабинет принимает даты до ' . $hi . '.');
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
      $h = $cab->heat($acc['acc'], $acc['sur']); $pg = self::page($h);
      if (!$h['open']) { self::diag(['op' => $op, 'user' => $uid, 'result' => 'closed', 'closed' => $h['closed'] ? CabWeb::mask($h['closed'], 160) : null, 'page' => $pg, 'steps' => $cab->w->steps]); throw self::fail(409, 'closed', [], $h['closed'] ? ['site' => mb_substr($h['closed'], 0, 300)] : []); }
      $fi = self::formInfo($h);
      if (!$fi['match']) { self::diag(['op' => $op, 'user' => $uid, 'result' => 'form_changed', 'form' => $fi, 'page' => $pg, 'steps' => $cab->w->steps]); throw self::fail(409, 'form_changed'); }
      try { self::rules($vals, $h); }
      catch (HttpError $e) { self::diag(['op' => $op, 'user' => $uid, 'result' => preg_replace('/^cab_/', '', $e->err), 'field' => $e->extra['field'] ?? null, 'page' => $pg, 'steps' => $cab->w->steps]); throw $e; }
      $phone = $phone ?: (string)($ex['phone'] ?? '');
      $email = $email ?: (string)$c['login'];
      if ($phone === '' && in_array('phone', array_column($fi['fields'], 'r'), true)) throw self::fail(422, 'need_phone');
      $r = $cab->save($acc['acc'], $acc['sur'], $vals, ['phone' => $phone, 'email' => $email, 'note' => ''], $h);
    } catch (CabErr $e) {
      self::diag(['op' => $op, 'user' => $uid, 'result' => $e->err, 'site' => CabWeb::mask($e->site), 'fields' => $cab->log['fields'] ?? null, 'page' => $pg ?? null, 'banners' => $cab->log['banners'] ?? null, 'steps' => $cab->w->steps]);
      throw self::cabErr($e);
    } finally { $cab->logout(); }
    if ($phone !== '' && $phone !== ($ex['phone'] ?? '')) Db::q('UPDATE cab_creds SET extra = ? WHERE user_id = ? AND prov = ?', [json_encode(['phone' => $phone] + $ex, JSON_UNESCAPED_UNICODE), $uid, self::PROV]);
    self::diag(['op' => $op, 'user' => $uid, 'result' => in_array($r['status'], ['ok', 'rejected'], true) ? $r['status'] : (!empty($r['unseen']) ? 'unseen' : 'pending'), 'flash' => CabWeb::mask((string)$r['flash'], 160), 'banners' => $cab->log['banners'] ?? null, 'page' => $pg, 'steps' => $cab->w->steps]);
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
    $n = []; $last = null; $form = null; $seen = null; $lastSend = null; $lastErr = null; $explore = null; $archive = null;
    foreach (self::log() as $e) {
      // архив рахунків (LOOK_V 6): варианты адреса рахунку за прошлый месяц и строки довідок масками
      if (($e['op'] ?? '') === 'archive') $archive = ['at' => gmdate('c', (int)$e['at']), 'result' => $e['result'] ?? null] + (array)($e['archive'] ?? []) + (($e['result'] ?? '') !== 'ok' ? ['steps' => array_slice((array)($e['steps'] ?? []), -6)] : []);
      // осмотр кабинета: страницы (пути без рахунку, ссылки, рамки, заголовки таблиц), похожая на квитанцию ссылка и что по ней пришло — без цифр и прізвищ
      if (!empty($e['explore'])) $explore = ['at' => gmdate('c', (int)$e['at']), 'by' => ($e['op'] ?? '') === 'look' ? 'cron' : 'user'] + (array)$e['explore'];
      // что робот прочитал со страницы тепла при последней проверке — без значений: нашёл ли прибор, какие «последние принятые», окно, статусы журнала
      if (in_array($e['op'] ?? '', ['check', 'look'], true) && ($e['result'] ?? '') === 'ok') $seen = ['at' => gmdate('c', (int)$e['at']), 'by' => ($e['op'] ?? '') === 'look' ? 'cron' : 'user', 'meter' => $e['meter'] ?? null, 'base' => $e['base'] ?? [],
        'open' => !empty($e['form']['open']), 'minMax' => $e['form']['minMax'] ?? null, 'win' => $e['form']['win'] ?? null, 'dateJs' => $e['dateJs'] ?? null, 'alerts' => $e['alerts'] ?? null, 'journal' => array_count_values(array_map('strval', (array)($e['journal'] ?? []))), 'closed' => $e['closed'] ?? null];
      // последний сбой робота (сайт не ответил, страница не та, капча…) — по шагам: метод, путь без рахунку, код, мс, ошибка сети
      if (!in_array((string)($e['result'] ?? ''), ['ok', 'pending', 'unseen', 'rejected', 'on', 'off', 'queued', 'bad_value', 'bad_login', 'bill', 'same', 'nobill'], true) && ($e['op'] ?? '') !== 'recheck')
        $lastErr = ['at' => gmdate('c', (int)$e['at']), 'op' => $e['op'] ?? null, 'result' => $e['result'] ?? null, 'where' => $e['where'] ?? null, 'steps' => array_slice((array)($e['steps'] ?? []), -8)];
      // последнее внесение (кнопкой или автоподачей) — итог и что было на странице: окно дат, плашки до отправки, ответ сайта (цифры скрыты)
      if (in_array($e['op'] ?? '', ['send', 'autosend'], true) && ($e['where'] ?? '') !== 'login') $lastSend = ['at' => gmdate('c', (int)$e['at']), 'op' => $e['op'], 'result' => $e['result'] ?? null, 'field' => $e['field'] ?? null,
        'flash' => ($e['flash'] ?? '') !== '', 'site' => ($e['site'] ?? '') !== '', 'banners' => $e['banners'] ?? null] + (array)($e['page'] ?? []);   // сами слова — только в /admin: /api/health открыт всем
      $k = preg_replace('/[^a-z]/', '', (string)($e['op'] ?? '?')) . ' ' . preg_replace('/[^a-z_,]/', '', (string)($e['result'] ?? '?'));
      $n[$k] = ($n[$k] ?? 0) + 1;
      if (!in_array($e['op'] ?? '', ['recheck', 'look', 'autobill', 'archive'], true)) $last = max((int)$last, (int)($e['at'] ?? 0));   // cron — не человек
      if (!empty($e['form']['open'])) $form = ['at' => gmdate('c', (int)$e['at']), 'match' => $e['form']['match'], 'missing' => $e['form']['missing'], 'unknown' => $e['form']['unknown'],
        'fields' => array_map(fn($f) => trim(($f['n'] ?? '') . ':' . ($f['t'] ?? '') . (isset($f['r']) ? '→' . $f['r'] : '')), $e['form']['fields'] ?? []),
        // подсказки сайта к полям (обязательное, длина, шаблон, placeholder) — чтобы сверить формат телефона и чисел
        'hints' => (object)array_filter(array_combine(array_map(fn($f) => (string)($f['n'] ?? ''), $e['form']['fields'] ?? []), array_map(fn($f) => implode(' ', array_filter([!empty($f['req']) ? 'req' : '', isset($f['max']) ? 'max=' . $f['max'] : '', isset($f['pat']) ? 'pat=' . $f['pat'] : '', isset($f['ph']) ? 'ph=' . $f['ph'] : ''])), $e['form']['fields'] ?? [])))];
    }
    ksort($n); $jobs = [];
    try { foreach (Db::q('SELECT status, COUNT(*) AS c FROM cab_jobs WHERE prov = ? GROUP BY status', [self::PROV])->fetchAll() as $x) $jobs[$x['status']] = (int)$x['c']; } catch (Throwable $e) {}
    $cr = 0; try { $cr = (int)(Db::one('SELECT COUNT(*) AS c FROM cab_creds WHERE prov = ?', [self::PROV])['c'] ?? 0); } catch (Throwable $e) {}
    $lk = self::lookState(); $look = $lk ? ['v' => (int)($lk['v'] ?? 0), 'at' => gmdate('c', (int)($lk['at'] ?? 0)), 'res' => (array)($lk['res'] ?? []), 'tries' => (int)($lk['tries'] ?? 0)] : null;
    return ['n' => (object)$n, 'lastUser' => $last ? gmdate('c', $last) : null, 'connected' => $cr, 'jobs' => (object)$jobs, 'form' => $form, 'seen' => $seen, 'lastSend' => $lastSend, 'lastErr' => $lastErr, 'look' => $look, 'explore' => $explore, 'archive' => $archive];
  }
}

/** Квитанции ХТМ в фоне, без человека (владелец 07.11.2026: «платёжки ХТМ тоже автоматом скачивались в запись об оплате в истории»;
 *  «квитанция должна соответствовать переданным показаниям по месяцам»). Как VkBills у Водоканала.
 *  Кто: подключил кабинет ХТМ (cab_creds htm, пароль подходит, не капча) и не выключил «Квитанції самі» (place.meter.billAuto !== false); рахунок квартиры —
 *  place.meter.account (среди рахунків кабинета), без него — единственный рахунок кабинета, если в данных одна квартира с теплосчётчиком.
 *  Куда: месяц — из заголовка рахунку («Рахунок за вересень 2026 року»); к записи тепла (state.readings) квартиры за этот месяц (htm.date) — bills += {…, auto: 'htm'};
 *  показаний за этот месяц нет — отдельная запись истории «Платіжка ХТМ» {billOnly: true, ym, htm.date = последний день месяца, bills} (приложение не считает её показаниями).
 *  Когда: каждый день 7:00–21:59 по Киеву, один вход за минуту на всех; квартира — раз в 20 ч (новый рахунок кабинет выставляет раз в месяц и с запозданием);
 *  месяц, который уже клали (got), — больше не кладём, даже если человек убрал файл. Только чтение: вход, GET страниц, выход. /api/health → htmBills. */
final class HtmBills {
  const RETRY = 20 * 3600, FROM_H = 7, TO_H = 22, IDLE = 1800;
  public static function file(): string { return Cfg::data() . '/cache/htm_bills.json'; }
  public static function read(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  private static function write(array $j): void { @mkdir(dirname(self::file()), 0700, true); @file_put_contents(self::file(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX); }
  public static function ym(int $now): string { return Gpv::kyiv($now)->modify('first day of last month')->format('Y-m'); }
  private static function live(array $st): array {
    $ps = array_values(array_filter((array)($st['places'] ?? []), fn($p) => is_array($p) && empty($p['deleted']) && !empty($p['id'])));
    if (!$ps && !empty($st['meter'])) $ps = [['id' => 'main', 'meter' => $st['meter']]];
    return $ps;
  }
  private static function first(array $places): string { return (string)($places[0]['id'] ?? 'main'); }
  private static function dateOf($r): string { $r = (array)$r; return (string)(((array)($r['htm'] ?? []))['date'] ?? ''); }
  /** Месяц записи: у «Платіжки ХТМ» — ym, у показаний — месяц даты. */
  private static function monthOf($r): string { $r = (array)$r; return !empty($r['billOnly']) ? (string)($r['ym'] ?? '') : substr(self::dateOf($r), 0, 7); }
  /** Куда положить квитанцию за ym: [индекс записи | null — новой «Платіжкой ХТМ», уже есть квитанция ХТМ за этот месяц]. Показания — раньше «Платіжки»,
   *  из показаний месяца — последние по дате. */
  public static function target(array $readings, string $place, string $first, string $ym): array {
    $best = null; $bd = ''; $only = null;
    foreach ($readings as $i => $r) {
      $ra = (array)$r; if (empty($ra['id']) || !empty($ra['deleted'])) continue;
      if ((string)($ra['place'] ?? $first) !== $place || self::monthOf($r) !== $ym) continue;
      foreach ((array)($ra['bills'] ?? []) as $b) if ((((array)$b)['auto'] ?? '') === 'htm') return [null, true];
      if (!empty($ra['billOnly'])) { $only = $only ?? $i; continue; }
      $d = self::dateOf($r); if ($best === null || $d >= $bd) { $best = $i; $bd = $d; }
    }
    return [$best ?? $only, false];
  }
  /** Каждая квартира с теплосчётчиком: [причина, цель]. off — «Квитанції самі» выключено, noacc — рахунок квартиры не из этого кабинета (или не понять, какой),
   *  ok — цель {place, acc}. $accs — рахунки кабинета [{acc, sur}]. */
  public static function why(array $st, array $accs): array {
    $places = self::live($st); if (!$places) return [];
    $out = [];
    $heat = array_values(array_filter($places, fn($p) => is_array($p['meter'] ?? null) && empty($p['meter']['removed'])));
    $have = array_map(fn($a) => (string)($a['acc'] ?? ''), $accs);
    foreach ($heat as $p) {
      $m = (array)$p['meter']; $id = (string)$p['id'];
      if (($m['billAuto'] ?? null) === false) { $out[] = ['off', null]; continue; }
      $acc = preg_replace('/\D/', '', (string)($m['account'] ?? ''));
      if ($acc === '' && count($have) === 1 && count($heat) === 1) $acc = $have[0];
      if ($acc === '' || !in_array($acc, $have, true)) { $out[] = ['noacc', null]; continue; }
      $out[] = ['ok', ['place' => $id, 'acc' => $acc]];
    }
    return $out;
  }
  /** Положить квитанцию за ym в данные человека (новая версия; конфликт с устройством — до 3 попыток; прошлая — в историю, причина htmbill).
   *  → got (к показаниям месяца) | new (новая «Платіжка ХТМ») | have (за этот месяц уже есть) | fail */
  public static function attach(int $uid, string $place, string $ym, array $doc): string {
    if (!preg_match('/^20\d\d-(0[1-9]|1[0-2])$/', $ym)) return 'fail';
    for ($i = 0; $i < 3; $i++) {
      $row = Db::one('SELECT data, version, updated_at FROM user_state WHERE user_id = ?', [$uid]); if (!$row) return 'fail';
      $st = json_decode((string)$row['data']); $arr = json_decode((string)$row['data'], true);   // объекты: пустые {} остаются {}
      if (!is_object($st) || !is_array($arr) || !isset($st->readings) || !is_array($st->readings)) return 'fail';
      [$idx, $have] = self::target($st->readings, $place, self::first(self::live($arr)), $ym); if ($have) return 'have';
      $ms = (int)round(microtime(true) * 1000);   // запись новее — при слиянии с устройством побеждает она
      $bill = (object)(['id' => (string)$doc['id'], 'mime' => (string)($doc['mime'] ?? 'application/pdf'), 'name' => (string)($doc['name'] ?? ''), 'bytes' => (int)($doc['bytes'] ?? 0), 'at' => (string)($doc['createdAt'] ?? Http::iso()), 'auto' => 'htm', 'ym' => $ym]
        + (isset($doc['pay']) && is_numeric($doc['pay']) ? ['pay' => (string)$doc['pay']] : [])
        + array_filter(array_intersect_key((array)($doc['parts'] ?? []), ['pre' => 1, 'unpre' => 1, 'heatM' => 1, 'hotM' => 1]), 'is_numeric'));
      if ($idx !== null) {
        $r = $st->readings[$idx]; if (!isset($r->bills) || !is_array($r->bills)) $r->bills = [];
        $r->bills[] = $bill; $r->updatedAt = $ms; $res = empty($r->billOnly) ? 'got' : 'new';
      } else {
        $st->readings[] = (object)['id' => 'hb' . bin2hex(random_bytes(6)), 'place' => $place, 'billOnly' => true, 'ym' => $ym, 'htm' => (object)['date' => (new DateTimeImmutable($ym . '-01'))->format('Y-m-t')],
          'bills' => [$bill], 'source' => 'htm', 'createdAt' => Http::iso(), 'updatedAt' => $ms];
        $res = 'new';
      }
      $json = json_encode($st, JSON_UNESCAPED_UNICODE); if ($json === false) return 'fail';
      if (Db::q('UPDATE user_state SET data = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?', [$json, Http::iso(), $uid, (int)$row['version']])->rowCount() === 1) {
        StateHist::put($uid, (string)$row['data'], (int)$row['version'], (string)$row['updated_at'], 'htmbill');
        return $res;
      }
    }
    return 'fail';
  }
  /** cron: одна квартира за запуск. → [[uid, итог]] или [] */
  public static function cron(?int $now = null): array {
    $now = $now ?? time(); $h = (int)Gpv::kyiv($now)->format('G');
    if ($h < self::FROM_H || $h >= self::TO_H || Cfg::get('htm_bills_auto', true) === false) return [];
    $j = self::read(); if ((int)($j['idle'] ?? 0) > $now) return [];
    $ym = self::ym($now); $todo = null; $cnt = [];
    $rows = Db::q("SELECT c.user_id, c.info, s.data FROM cab_creds c JOIN user_state s ON s.user_id = c.user_id WHERE c.prov = 'htm' AND c.state NOT IN ('bad_login', 'captcha') ORDER BY c.user_id")->fetchAll();
    foreach ($rows as $row) {
      $st = json_decode((string)$row['data'], true); if (!is_array($st)) continue;
      $info = json_decode((string)$row['info'], true); $accs = (array)(is_array($info) ? ($info['accounts'] ?? []) : []);
      foreach (self::why($st, $accs) as [$why, $t]) {
        if ($t) {
          $e = (array)($j['p'][$row['user_id'] . '|' . $t['place']] ?? []);
          $why = $now - (int)($e['at'] ?? 0) < self::RETRY ? 'retry' : '';
          if ($why === '') { $todo = [(int)$row['user_id'], $t]; break 2; }
        }
        $cnt[$why] = ($cnt[$why] ?? 0) + 1;
      }
    }
    if (!$todo) { $j['idle'] = $now + self::IDLE; $j['scan'] = ['at' => $now, 'ym' => $ym, 'cabs' => count($rows), 'k' => $cnt]; self::write($j); return []; }
    [$uid, $t] = $todo; $key = $uid . '|' . $t['place'];
    $e = (array)($j['p'][$key] ?? []); $got = array_values(array_filter((array)($e['got'] ?? []), 'is_string')); if (is_string($e['got'] ?? null)) $got = [$e['got']];
    $e = ['at' => $now, 'n' => (int)($e['n'] ?? 0) + 1, 'got' => $got];
    $j['p'][$key] = $e; self::write($j);   // отметка до входа: упадём посередине — не повторим через минуту
    $guess = null; $dym = ''; $kind = null;
    try {
      RateLimit::hit('htm_cab_all', 'all');
      $r = HtmSvc::bill($uid, $t['acc'], $t['place'], $ym);
      $doc = $r['doc'] ?? null; $dym = (string)($r['ym'] ?? ''); $guess = $r['guess'] ?? null; $kind = $r['kind'] ?? null;
      if (!empty($r['none']) || !$doc || $dym === '') $res = 'nobill';
      elseif (in_array($dym, $got, true)) $res = 'same';   // за этот месяц уже клали (человек мог убрать файл — не возвращаем)
      else {
        $res = self::attach($uid, $t['place'], $dym, $doc + ['pay' => $r['pay'] ?? null, 'parts' => $r['parts'] ?? []]);
        if (in_array($res, ['got', 'new', 'have'], true)) $e['got'] = array_slice(array_values(array_unique(array_merge([$dym], $got))), 0, 24);
        if ($res === 'have') $res = 'same';
      }
    } catch (HttpError $x) { $res = preg_replace('/^(cab|htm)_/', '', $x->err) ?: 'err'; }
    catch (Throwable $x) { $res = 'down'; error_log('teplo htm bills: ' . $x->getMessage()); }
    $e['res'] = $res; if ($dym !== '') $e['ym'] = $dym;
    $j = self::read(); $j['p'][$key] = $e;
    $j['last'] = ['at' => $now, 'res' => $res] + ($dym !== '' ? ['ym' => $dym] : []) + ($kind ? ['kind' => $kind] : []) + ($guess !== null ? ['guess' => (bool)$guess] : []);
    $n = (array)($j['n'][$ym] ?? []); $n[$res] = (int)($n[$res] ?? 0) + 1; $j['n'] = array_slice([$ym => $n] + (array)($j['n'] ?? []), 0, 3, true);
    self::write($j);
    return [[$uid, $res]];
  }
  /** /api/health → htmBills: последний итог, счёт по месяцам и почему последний обход никуда не пошёл (без рахунків и людей). */
  public static function summary(): array {
    $j = self::read();
    return ['last' => isset($j['last']) ? ['at' => gmdate('c', (int)$j['last']['at'])] + array_diff_key($j['last'], ['at' => 1]) : null, 'n' => (object)($j['n'] ?? []), 'places' => count((array)($j['p'] ?? [])),
      'idleTill' => !empty($j['idle']) && $j['idle'] > time() ? gmdate('c', (int)$j['idle']) : null,
      'scan' => isset($j['scan']) ? ['at' => gmdate('c', (int)$j['scan']['at']), 'ym' => (string)$j['scan']['ym'], 'cabs' => (int)($j['scan']['cabs'] ?? 0), 'k' => (object)($j['scan']['k'] ?? [])] : null];
  }
}

/** Нарахування ХТМ по місяцях («Довідка по теплу» кабінету) — особисті дані людини: SITE_DATA/cache/htm_spr/<uid>_<квартира>.json (наружу не віддається),
 *  приложению — GET /api/htm/spr (лише своє). Для /api/health — лише скільки рядків, які колонки знайшли й маска формату (без цифр). */
final class HtmSpr {
  const BILLS_V = 5;
  // частка ЗБП квартири з лічильником, Гкал на м² за місяць опалення (14 квитанцій ХТМ 2024–2026, як R.C.ZBP_M2 у web/src/rules.js);
  // «частка будинку» понад свій лічильник більша за ZBP_MAX_M2 (чи 5 % свого тепла) — це місяці за середнім, а не формула ХТМ
  const ZBP_M2 = 0.00025, ZBP_MAX_M2 = 0.0006, ZBP_MAX_OWN = 0.05;
  public static function dir(): string { return Cfg::data() . '/cache/htm_spr'; }
  private static function file(int $uid, string $place): string { return self::dir() . '/' . $uid . '_' . substr(preg_replace('/[^A-Za-z0-9_-]/', '', $place), 0, 40) . '.json'; }
  public static function save(int $uid, string $place, array $sp): void {
    @mkdir(self::dir(), 0700, true); $f = self::file($uid, $place);
    // журнал свого лічильника не прочитався в цей раз — лишаємо прежній
    $old = json_decode((string)@file_get_contents($f), true) ?: [];
    $own = isset($sp['own']) && is_array($sp['own']) ? array_values($sp['own']) : ($old['own'] ?? null);
    // довідка в кабінеті — лише останній сезон: місяці копимо (свіжий рядок місяця — поверх старого), щоб звірка формули росла з кожним сезоном; до 36 місяців
    $by = []; foreach (array_merge((array)($old['rows'] ?? []), (array)$sp['rows']) as $r) if (isset($r['ym'])) $by[(string)$r['ym']] = $r;
    ksort($by); $rows = array_slice(array_values($by), -36);
    @file_put_contents($f, json_encode(['at' => time(), 'place' => $place, 'rows' => $rows] + ($own !== null ? ['own' => $own] : []), JSON_UNESCAPED_UNICODE), LOCK_EX);
    $rs = $sp['rows']; @file_put_contents(self::dir() . '/_last.json', json_encode(['at' => time(), 'rows' => count($rs), 'cols' => $sp['cols'], 'fmt' => $sp['fmt'],
      'from' => $rs ? $rs[0]['ym'] : null, 'to' => $rs ? $rs[count($rs) - 1]['ym'] : null,
      // какие поля в строках заполнены (сколько строк с числом) — проверить разбор на живом без самих чисел
      'filled' => (object)array_map(fn($k) => count(array_filter($rs, fn($r) => isset($r[$k]) && $r[$k] !== null)), array_combine($sp['cols'], $sp['cols'])),
      'shape' => $sp['shape'] ?? null], JSON_UNESCAPED_UNICODE), LOCK_EX);
  }
  /** Только структура таблицы (осмотр кабинета админа, HtmSvc::look): в _last.json → shape, строки людей не трогаем. */
  public static function saveShape(array $sp): void {
    @mkdir(self::dir(), 0700, true); $f = self::dir() . '/_last.json'; $j = json_decode((string)@file_get_contents($f), true);
    $j = is_array($j) ? $j : ['at' => time(), 'rows' => count($sp['rows']), 'cols' => $sp['cols'], 'fmt' => $sp['fmt']];
    $j['shape'] = ($sp['shape'] ?? []) + ['at' => gmdate('c')]; @file_put_contents($f, json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX);
  }
  /** Осмотр кабинета админа (HtmSvc::look): свежая довідка и журнал свого лічильника — в уже сохранённые файлы этой учётки (квартиру знает bill). */
  public static function refresh(int $uid, array $sp, array $own): void {
    foreach ((glob(self::dir() . '/' . $uid . '_*.json') ?: []) as $f) {
      $j = json_decode((string)@file_get_contents($f), true); if (!is_array($j) || !isset($j['place'])) continue;
      self::save($uid, (string)$j['place'], ['rows' => $sp['rows'] ?: $j['rows'], 'cols' => $sp['cols'], 'fmt' => $sp['fmt'], 'shape' => $sp['shape'] ?? null] + ($own ? ['own' => $own] : []));
    }
  }
  /** Свої дані: [{place, at, rows, own}] — own: журнал свого лічильника з кабінету [{date, energy, status}] */
  public static function mine(int $uid): array {
    $out = [];
    foreach ((glob(self::dir() . '/' . $uid . '_*.json') ?: []) as $f) { $j = json_decode((string)@file_get_contents($f), true); if (is_array($j) && !empty($j['rows'])) $out[] = ['place' => (string)$j['place'], 'at' => gmdate('c', (int)$j['at']), 'rows' => $j['rows'], 'own' => $j['own'] ?? []]; }
    return $out;
  }
  public static function summary(): ?array {
    $j = json_decode((string)@file_get_contents(self::dir() . '/_last.json'), true); if (!is_array($j)) return null;
    // сверка — по последней сохранённой довідке (та, о которой _last): без людей и без личных сумм и Гкал
    $nf = null; foreach ((glob(self::dir() . '/*_*.json') ?: []) as $f) if (basename($f)[0] !== '_' && ($nf === null || filemtime($f) > filemtime($nf))) $nf = $f;
    $fj = $nf ? (json_decode((string)@file_get_contents($nf), true) ?: []) : []; $rows = $fj['rows'] ?? [];
    $ck = $rows ? self::check($rows, (array)($fj['own'] ?? [])) : null;
    // квитанції тієї ж квартири (копії рахунків з кабінету) против довідки — «Разом» сходиться з рахунком? (лише відсотки й мітки рядків)
    if ($ck !== null && preg_match('/^(\d+)_([A-Za-z0-9_-]+)\.json$/', basename((string)$nf), $m)) { try { $bc = self::billsOf((int)$m[1], $m[2], $rows); if ($bc) $ck['bills'] = $bc; } catch (Throwable $e) {} }
    return ['at' => gmdate('c', (int)$j['at'])] + array_diff_key($j, ['at' => 1]) + ($ck !== null ? ['check' => $ck] : []);
  }
  /** Квитанція ХТМ (копія рахунку, Docs src htm) → рядки таблиці [мітка, число]; цифри в мітці → #. Живий рахунок 07.11: «-ПЕРЕПЛАТА/+БОРГ…»,
   *  «Нараховано за послугу, грн», «Нараховано плати за абонентське обслуговування, грн», «ДО СПЛАТИ». */
  public static function billLines(string $html): array {
    if (trim($html) === '') return [];
    $x = CabWeb::dom($html); $out = [];
    foreach ($x->query('//tr') as $tr) {
      $tds = $x->query('./td|./th', $tr); if ($tds->length < 2) continue;
      $lab = CabWeb::sp((string)$tds->item(0)->textContent); $v = str_replace([' ', "\u{a0}", ','], ['', '', '.'], CabWeb::sp((string)$tds->item($tds->length - 1)->textContent));
      if ($lab === '' || !preg_match('/^[-+]?\d{1,9}(\.\d{1,3})?$/', $v)) continue;
      $out[] = [mb_substr((string)preg_replace('/\d/u', '#', $lab), 0, 80), (float)$v];
      if (count($out) >= 30) break;
    }
    return $out;
  }
  /** Мітка з рахунку без людей: цифри → #, лише загальні слова рахунків; будь-яке інше слово (прізвище, вулиця) → Ж. */
  public static function gw(string $s, int $n = 60): string {
    static $voc = null;
    if ($voc === null) $voc = array_flip(explode(' ', 'нараховано нарахування донараховано до кінця кінець поточного попереднього наступного місяця місяць місяці теплової теплова теплову енергії енергія енергію '
      . 'гарячої гаряча гарячу холодної води вода воду послуга послугу послуги послуг послугою за з із та і й на в у по від для абонентське абонентського обслуговування плати плата '
      . 'оплата оплати оплачено сплачено сплати сплатити сплачено надійшло надходження борг боргу переплата переплати сальдо початок початку періоду період разом всього усього '
      . 'перерахунок перерахунку перерахунки пільга пільги субсидія субсидії постачання тариф тарифом тарифу обсяг обсягу спожито спожита гкал грн кількість сума суми '
      . 'показання показань лічильника лічильник квартира квартири площа площі опалення вартість ціна норма нормою середнім середньомісячним коригування компенсація '
      . 'пеня штраф інші дата номер пдв рік року станом комунальна комунальні частка будинку внутрішньобудинкової системи загальнобудинкових витрати втрати витрата '
      . 'місяців одержувач рахунок особовий отримувач платник адреса поточні попередні поточне попереднє різниця одиниця виміру дата сплатити кількість осіб опалювана '
      . 'м2 м³ куб код єдрпоу iban банк призначення платежу споживання будинковий квартирний розподіл мзк кінці поточні показники вид тепла теплота тепло квартирі '
      . 'гвп цо вартістю нараховано: всього: разом: обсяг, гкал, грн, лічильника, тарифу, сума, мзк, плата, борг, переплата, енергія, вода, послуга, послуги,'));
    return mb_substr((string)preg_replace_callback('/\p{L}[\p{L}\'’-]*/u', fn($m) => isset($voc[mb_strtolower($m[0])]) ? $m[0] : 'Ж', CabWeb::mask($s, 400)), 0, $n);
  }
  /** Будова таблиць рахунку без сум і людей (живий рахунок 08.11 інший, ніж стенд: рядки «теплової енергії», «донараховано до кінця поточного
   *  місяця», «гарячої води» — колонки треба побачити): по рядках — кількість клітинок і маски (gw: цифри → #, не загальні слова → Ж,
   *  colspan/rowspan). До 3 таблиць, до 16 рядків. */
  public static function billShape(string $html): array {
    if (trim($html) === '') return [];
    $x = CabWeb::dom($html); $out = ['tables' => $x->query('//table')->length, 'rows' => []];
    // лише «листові» рядки (без вкладених таблиць: живий рахунок — одна таблиця-макет із вкладеними) і лише з числами — там суми
    foreach ([0] as $ti) {
      foreach ($x->query('//tr[not(.//table)]') as $tr) {
        if (count($out['rows']) >= 40) break 2; if (!preg_match('/\d/', (string)$tr->textContent)) continue; $cs = [];
        foreach ($x->query('./td|./th', $tr) as $c) {
          $sp = ((int)$c->getAttribute('colspan') > 1 ? ' [c' . (int)$c->getAttribute('colspan') . ']' : '') . ((int)$c->getAttribute('rowspan') > 1 ? ' [r' . (int)$c->getAttribute('rowspan') . ']' : '');
          $cs[] = ($c->nodeName === 'th' ? 'th:' : '') . self::gw((string)$c->textContent, 45) . $sp;
        }
        if ($cs) $out['rows'][] = count($cs) . ': ' . implode(' | ', $cs);
      }
    }
    return $out;
  }
  /** Живий рахунок ХТМ (будова з бою 08.11, shape): таблиця «Послуги з постачання | Тариф | Витрата… | Кількість… | Нараховано за послугу | Пільга |
   *  Нараховано плати за абонентське обслуговування | −Переплата/+борг на 1… | Оплачено у… | Нараховано за місяць (= послуга − пільга + абонплата) |
   *  Перерахунки… | Нараховано всього | −Переплата/+борг на кінець», рядки «теплової енергії» і «гарячої води» (colspan/rowspan), під теплом —
   *  «донараховано до кінця поточного місяця» і «… нарахування до кінця попереднього місяця», «ДО СПЛАТИ». Колонки — за позицією з урахуванням colspan.
   *  → ['heat' => [cost, lgota, abon, debt, paid, month, recalc, total, end], 'hot' => […], 'pre' => донараховано, 'unpre' => зняте за попередній, 'pay'] або [] */
  public static function billTable(string $html): array {
    if (trim($html) === '') return [];
    $x = CabWeb::dom($html); $num = fn(string $s) => preg_match('/^[-+]?\d{1,9}(?:[.,]\d{1,3})?$/', $v = str_replace([' ', "\u{a0}", 'грн.', 'грн'], '', CabWeb::sp($s))) ? (float)str_replace(',', '.', $v) : null;
    $cells = function ($tr) use ($x) { $o = []; $p = 0; foreach ($x->query('./td|./th', $tr) as $c) { $o[] = [$p, CabWeb::sp((string)$c->textContent)]; $p += max(1, (int)$c->getAttribute('colspan')); } return $o; };
    $map = null; $out = [];
    foreach ($x->query('//tr[not(.//table)]') as $tr) {
      $cs = $cells($tr); $t = implode(' | ', array_column($cs, 1));
      if ($map === null) {
        if (!preg_match('/нараховано за послугу/iu', $t) || count($cs) < 8) continue;
        $map = []; $nb = 0;
        foreach ($cs as [$p, $h]) {
          $k = preg_match('/нараховано за послугу/iu', $h) ? 'cost' : (preg_match('/пільг/iu', $h) ? 'lgota' : (preg_match('/абонентськ/iu', $h) ? 'abon' : (preg_match('/переплат|борг/iu', $h) ? ($nb++ ? 'end' : 'debt')
            : (preg_match('/оплачено/iu', $h) ? 'paid' : (preg_match('/за місяць/iu', $h) ? 'month' : (preg_match('/перерахун/iu', $h) ? 'recalc' : (preg_match('/всього|усього/iu', $h) ? 'total' : null)))))));
          if ($k !== null && !isset($map[$k])) $map[$k] = $p;
        }
        continue;
      }
      $first = mb_strtolower($cs[0][1] ?? '');
      if (preg_match('/донараховано до кінця поточного/u', $t)) {
        for ($i = 0; $i < count($cs); $i++) { $v = $num($cs[$i][1]); if ($v === null) continue; $lab = mb_strtolower($cs[$i - 1][1] ?? ''); if (str_contains($lab, 'поточного')) $out['pre'] = $v; elseif (str_contains($lab, 'попереднього')) $out['unpre'] = $v; }
        continue;
      }
      if (preg_match('/^до сплати/u', $first)) { foreach ($cs as $i => [$p, $s]) if ($i > 0 && ($v = $num($s)) !== null) { $out['pay'] = $v; break; } continue; }
      $svc = str_contains($first, 'тепло') ? 'heat' : (str_contains($first, 'гаряч') ? 'hot' : null);
      if ($svc === null || isset($out[$svc])) continue;
      $byPos = []; foreach ($cs as [$p, $s]) $byPos[$p] = $num($s);
      $r = []; foreach ($map as $k => $p) if (array_key_exists($p, $byPos) && $byPos[$p] !== null) $r[$k] = $byPos[$p];
      if ($r) $out[$svc] = $r;
    }
    return $out;
  }
  /** Рядки квитанції → debt (переплата «−» / борг «+»), cost (нараховано за послугу), abon (абонентське), lgota (пільга, субсидія), recalc (перерахунок), pay (до сплати). */
  public static function billKeys(array $lines): array {
    $k = [];
    foreach ($lines as [$l, $v]) {
      $key = preg_match('/до\s+сплати|до\s+оплати/iu', $l) ? 'pay' : (preg_match('/переплат|борг/iu', $l) ? 'debt' : (preg_match('/абонент/iu', $l) ? 'abon'
        : (preg_match('/пільг|субсид/iu', $l) ? 'lgota' : (preg_match('/перерахун|коригув/iu', $l) ? 'recalc' : (preg_match('/нарахован/iu', $l) ? 'cost' : null)))));
      if ($key !== null && !isset($k[$key])) $k[$key] = $v;
    }
    return $k;
  }
  /** Звірка квитанцій з довідкою: $bills — [ym => billKeys]. Для кожного місяця квитанції — рядок довідки того ж місяця (same), попереднього (prev),
   *  наступного (next): нараховано (cost) і абонплата квитанції против довідки, «до сплати − борг» против «Разом» довідки (нараховано + абонплата − пільга).
   *  → {of, months, err: {ym: {al: {cost, abon, pay}}}, ok: {al: місяців, де нараховано збіглося до 0,5 %}, best} — лише відсотки. */
  public static function billCheck(array $rows, array $bills): array {
    $nn = fn($r, $k) => isset($r[$k]) && is_numeric($r[$k]) ? (float)$r[$k] : null;
    $pc = fn(float $a, float $b) => abs($b) < 0.005 ? (abs($a) < 0.005 ? 0.0 : null) : round(($a - $b) / abs($b) * 100, 2) + 0.0;
    $by = []; foreach ($rows as $r) if (isset($r['ym'])) $by[(string)$r['ym']] = $r;
    ksort($bills); $err = []; $okN = ['same' => 0, 'prev' => 0, 'next' => 0]; $of = ['same' => 0, 'prev' => 0, 'next' => 0];
    foreach ($bills as $ym => $b) {
      foreach (['same' => 0, 'prev' => -1, 'next' => 1] as $al => $sh) {
        $m = date('Y-m', strtotime($ym . '-01 ' . ($sh < 0 ? '-1' : '+' . $sh) . ' month')); $r = $by[$m] ?? null; if (!$r) continue;
        $e = [];
        if (isset($b['cost']) && $nn($r, 'cost') !== null) $e['cost'] = $pc((float)$b['cost'], $nn($r, 'cost'));
        if (isset($b['abon']) && $nn($r, 'abon') !== null) $e['abon'] = $pc((float)$b['abon'], $nn($r, 'abon'));
        $tot = ($nn($r, 'cost') ?? 0) + ($nn($r, 'abon') ?? 0) - max(0, $nn($r, 'lgota') ?? 0);
        if (isset($b['month']) && $tot > 0) $e['month'] = $pc((float)$b['month'], $tot);   // «Нараховано за місяць» рахунку против «Разом» довідки
        if (isset($b['pre']) && $nn($r, 'cost') > 0) $e['pre%'] = round(((float)$b['pre'] - (float)($b['unpre'] ?? 0)) / $nn($r, 'cost') * 100, 1) + 0.0;   // донараховано до кінця місяця − зняте за попередній, % від довідки
        elseif (isset($b['pay']) && !isset($b['month']) && $tot > 0) $e['pay'] = $pc((float)$b['pay'] - (float)($b['debt'] ?? 0), $tot);
        if (!$e) continue;
        $err[$ym][$al] = $e;
        if (isset($e['cost'])) { $of[$al]++; if ($e['cost'] !== null && abs($e['cost']) <= 0.5) $okN[$al]++; }
      }
    }
    $best = null; foreach ($okN as $al => $n) if ($n > 0 && ($best === null || $n > $okN[$best])) $best = $al;
    return ['of' => count($bills), 'months' => array_keys($bills), 'err' => (object)$err, 'ok' => $okN, 'cmp' => $of, 'best' => $best];
  }
  /** Квитанції людини по квартирі (Docs src htm, HTML) → billCheck з довідкою + мітки рядків останнього рахунку (як виглядає живий рахунок).
   *  Кеш — cache/htm_spr/_bills.json за списком документів і часом довідки, щоб /api/health не розбирав HTML щоразу. */
  public static function billsOf(int $uid, string $place, array $rows): ?array {
    $ds = Db::q("SELECT id, file, ym, mime FROM docs WHERE user_id = ? AND place = ? AND src = 'htm' AND ym IS NOT NULL ORDER BY created_at DESC LIMIT 24", [$uid, $place])->fetchAll();
    if (!$ds) return null;
    $key = sha1(self::BILLS_V . '|' . implode(',', array_column($ds, 'id')) . '|' . json_encode($rows));   // BILLS_V — новий розбір, кеш заново
    $cf = self::dir() . '/_bills.json'; $c = json_decode((string)@file_get_contents($cf), true);
    if (is_array($c) && ($c['key'] ?? '') === $key && isset($c['out'])) return $c['out'];
    $bills = []; $lines = null; $shape = null; $pdf = 0;
    foreach ($ds as $d) {
      if ((string)$d['mime'] !== 'text/html') { $pdf++; continue; }
      $html = (string)@file_get_contents(Docs::root() . '/' . $uid . '/' . basename((string)$d['file'])); $ls = self::billLines($html);
      if ($lines === null) { $lines = array_map(fn($l) => self::gw((string)$l), array_column($ls, 0)); $shape = self::billShape($html); }
      $bt = self::billTable($html);   // живий формат (колонки); стенд і старі — рядки «мітка | сума»
      $k = isset($bt['heat']) ? $bt['heat'] + array_intersect_key($bt, ['pre' => 1, 'unpre' => 1, 'pay' => 1]) + ['hot' => isset($bt['hot'])] : self::billKeys($ls);
      if ($k && !isset($bills[(string)$d['ym']])) $bills[(string)$d['ym']] = $k;
    }
    $lk = $bills ? array_keys(array_filter((array)reset($bills), fn($v) => $v !== null && $v !== false)) : [];   // які поля рахунку розпізнано (без сум)
    $out = self::billCheck($rows, $bills) + ['keys' => $lk, 'lines' => $lines ?? [], 'shape' => $shape ?? [], 'pdf' => $pdf];
    @file_put_contents($cf, json_encode(['key' => $key, 'out' => $out], JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $out;
  }
  /** Сверка довідки ХТМ (владелец 08.11: «цены в платежках больше — чтобы совпадало»), без личных чисел — только доли и проценты,
   *  плюс публичные тарифы (грн/Гкал, абонплата). formula — витрата по квартирі = різниця + втрати × S_кв / S_буд (Методика № 315);
   *  tariff — нараховано / витрата по місяцях; paid — сколько месяцев «надходження» (тот же или следующий месяц) = нараховано + абонплата − пільга;
   *  calc — наш расчёт приложения (hsprCalib + costOf: різниця × (1 + k) × тариф + абонплата) против суммы ХТМ, ошибка в % по месяцам. */
  /** «Площа будинку» в довідці буває неможливою — живий кабінет 08.11: у листопаді й січні двозначна (як квартира), в інші місяці чотиризначна.
   *  Тоді S_кв/S_буд ≈ 1 замість ≈ 0,01 і частка будинку «× S» завищена в ~100 разів. Будинок менший за 3 квартири — описка: беремо медіану
   *  нормальних місяців. → [рядки з виправленою площею, [ym…] виправлених, cv нормальних площ %]. */
  public static function fixArea(array $rows): array {
    $nn = fn($r, $k) => isset($r[$k]) && is_numeric($r[$k]) ? (float)$r[$k] : null;
    $odd = fn($r) => $nn($r, 'sHouse') !== null && $nn($r, 'sFlat') > 0 && $nn($r, 'sHouse') < 3 * $nn($r, 'sFlat');
    $ok = []; foreach ($rows as $r) if ($nn($r, 'sHouse') > 0 && !$odd($r)) $ok[] = $nn($r, 'sHouse');
    if (!$ok) return [$rows, [], null];
    sort($ok); $n = count($ok); $med = $n % 2 ? $ok[intdiv($n, 2)] : ($ok[$n / 2 - 1] + $ok[$n / 2]) / 2;
    $m = array_sum($ok) / $n; $cv = $n > 1 && $m > 0 ? round(sqrt(array_sum(array_map(fn($x) => ($x - $m) ** 2, $ok)) / ($n - 1)) / $m * 100, 2) : null;
    $fixed = [];
    foreach ($rows as &$r) if ($odd($r)) { $r['sHouse'] = $med; $fixed[] = (string)$r['ym']; }
    unset($r);
    return [$rows, $fixed, $cv];
  }
  public static function check(array $rows, array $own = []): array {
    [$rows, $areaFix, $areaCv] = self::fixArea($rows);
    $nn = fn($r, $k) => isset($r[$k]) && is_numeric($r[$k]) ? (float)$r[$k] : null;
    $pc = fn(float $a, float $b) => $b != 0.0 ? round(($a - $b) / abs($b) * 100, 1) : null;
    $sum = fn($r) => ($nn($r, 'cost') ?? 0) + ($nn($r, 'abon') ?? 0) - max(0, $nn($r, 'lgota') ?? 0);
    $fo = ['of' => 0, 'ok' => 0, 'err' => []]; $tar = []; $share = [];
    foreach ($rows as $r) {
      [$d, $l, $sh, $sf, $fl, $c] = [$nn($r, 'diff'), $nn($r, 'loss'), $nn($r, 'sHouse'), $nn($r, 'sFlat'), $nn($r, 'flat'), $nn($r, 'cost')];
      if ($d !== null && $l !== null && $sh > 0 && $sf !== null && $fl !== null) {
        $fo['of']++; $e = $d + $l * $sf / $sh - $fl; if (abs($e) <= max(0.002, abs($fl) * 0.005)) $fo['ok']++; $fo['err'][$r['ym']] = $fl > 0 ? round($e / $fl * 100, 2) + 0.0 : null;
      }
      if ($fl > 0 && $c !== null) $tar[$r['ym']] = round($c / $fl, 2);
      if ($d > 0 && $fl !== null) $share[$r['ym']] = round(($fl - $d) / $d, 3);
    }
    // надходження: оплата за месяц приходит в том же или следующем месяце
    $by = []; foreach ($rows as $r) $by[$r['ym']] = $r;
    $paid = ['of' => 0, 'same' => 0, 'next' => 0, 'err' => []];
    foreach ($rows as $r) {
      $s = $sum($r); if ($s <= 0) continue; $nx = date('Y-m', strtotime($r['ym'] . '-01 +1 month'));
      $p0 = $nn($r, 'paid'); $p1 = isset($by[$nx]) ? $nn($by[$nx], 'paid') : null; if ($p0 === null && $p1 === null) continue;
      $paid['of']++; if ($p0 !== null && abs($p0 - $s) <= 1) $paid['same']++; elseif ($p1 !== null && abs($p1 - $s) <= 1) $paid['next']++;
      $paid['err'][$r['ym']] = ['same' => $p0 !== null ? $pc($p0, $s) : null, 'next' => $p1 !== null ? $pc($p1, $s) : null];
    }
    // наш расчёт — как приложение (hsprCalib): тариф — медиана, k — Σ(витрата − різниця) / Σ різниця за последние 8 месяцев, абонплата — последняя
    $tv = array_values(array_filter($tar, fn($v) => $v > 300 && $v < 10000)); sort($tv); $tm = $tv ? $tv[intdiv(count($tv), 2)] : null;
    $hr = array_slice(array_values(array_filter($rows, fn($r) => $nn($r, 'diff') > 0 && $nn($r, 'flat') !== null && $nn($r, 'flat') >= $nn($r, 'diff'))), -8);
    $sd = array_sum(array_map(fn($r) => $nn($r, 'diff'), $hr)); $sl = array_sum(array_map(fn($r) => $nn($r, 'flat') - $nn($r, 'diff'), $hr));
    $k = $sd > 0 && count($hr) >= 2 ? $sl / $sd : 0.0; $ab = null; foreach ($rows as $r) if ($nn($r, 'abon') > 0) $ab = $nn($r, 'abon');
    $calc = [];
    // строки з будинковим лічильником (різниця втричі й більше за витрату квартири) так не рахуються — їх перевіряє own.model (свій лічильник + частка будинку)
    $bld = fn($r) => $nn($r, 'diff') !== null && $nn($r, 'flat') > 0 && $nn($r, 'diff') > $nn($r, 'flat') * 3; $nb = count(array_filter($rows, $bld));
    if ($tm) foreach ($rows as $r) { $d = $nn($r, 'diff'); $s = $sum($r); if ($d !== null && $d >= 0 && $s > 0 && !$bld($r)) $calc[$r['ym']] = $pc($d * (1 + $k) * $tm + ($ab ?? 0), $s); }
    $ce = array_map('abs', array_filter($calc, fn($v) => $v !== null));
    // что на самом деле в колонках (живая довідка 08.11: різниця в десятки раз больше витрати): гипотезы витрати по квартирі — медиана |ошибки| в %
    $q = fn($r) => [$nn($r, 'diff'), $nn($r, 'loss'), $nn($r, 'house'), ($nn($r, 'sHouse') ?? 0) > 0 ? ($nn($r, 'sFlat') ?? 0) / $nn($r, 'sHouse') : null, $nn($r, 'flat')];
    $H = ['diff+loss*s' => fn($d, $l, $h, $s) => $d + $l * $s, 'house*s' => fn($d, $l, $h, $s) => $h * $s, 'diff*s' => fn($d, $l, $h, $s) => $d * $s, '(diff+loss)*s' => fn($d, $l, $h, $s) => ($d + $l) * $s,
      '(diff-loss)*s' => fn($d, $l, $h, $s) => ($d - $l) * $s, 'loss*s' => fn($d, $l, $h, $s) => $l * $s, '(house-loss)*s' => fn($d, $l, $h, $s) => ($h - $l) * $s, '(house-diff)*s' => fn($d, $l, $h, $s) => ($h - $d) * $s,
      'diff/1163+loss*s' => fn($d, $l, $h, $s) => $d / 1163 + $l * $s, 'diff/1.163+loss*s' => fn($d, $l, $h, $s) => $d / 1.163 + $l * $s, 'diff/4.1868+loss*s' => fn($d, $l, $h, $s) => $d / 4.1868 + $l * $s];
    $hyp = [];
    foreach ($H as $name => $f) {
      $es = []; foreach ($rows as $r) { [$d, $l, $h, $s, $fl] = $q($r); if ($d === null || $l === null || $h === null || $s === null || !($fl > 0)) continue; $es[] = abs(($f($d, $l, $h, $s) - $fl) / $fl * 100); }
      if ($es) { sort($es); $hyp[$name] = round($es[intdiv(count($es), 2)], 1); }
    }
    asort($hyp);
    $cp = 0; $cpn = 0; foreach ($rows as $r) { $p = $nn($r, 'prev'); $c = $nn($r, 'cur'); $d = $nn($r, 'diff'); if ($p === null || $c === null || $d === null) continue; $cpn++; if (abs($c - $p - $d) <= max(0.0015, abs($d) * 0.001)) $cp++; }
    $rat = []; foreach ($rows as $r) { [$d, $l, $h, $s, $fl] = $q($r); if ($fl > 0) $rat[$r['ym']] = array_filter(['diff' => $d !== null ? round($d / $fl, 2) : null, 'loss*s' => $l !== null && $s ? round($l * $s / $fl, 2) : null,
      'house*s' => $h !== null && $s ? round($h * $s / $fl, 2) : null, 'loss/house' => $h > 0 && $l !== null ? round($l / $h, 3) : null], fn($v) => $v !== null); }
    return ['units' => array_values(array_unique(array_filter(array_map(fn($r) => $r['unit'] ?? null, $rows)))), 'curPrev' => ['of' => $cpn, 'ok' => $cp], 'hyp' => $hyp, 'toFlat' => $rat,
      's' => ($s0 = $q($rows[count($rows) - 1])[3]) !== null ? round($s0, 5) : null, 'formula' => $fo, 'tariff' => $tar, 'abon' => array_values(array_unique(array_filter(array_map(fn($r) => $nn($r, 'abon'), $rows), fn($v) => $v !== null))),
      'lgota' => count(array_filter($rows, fn($r) => $nn($r, 'lgota') > 0)), 'share' => $share, 'k' => round($k, 3), 'paid' => $paid,
      'calc' => ['err' => $calc, 'max' => $ce ? max($ce) : null] + ($nb ? ['bld' => $nb] : []),
      // площа будинку: які місяці виправлено (описка ХТМ) і чи стала вона в інші місяці (cv %)
      'area' => ['fixed' => $areaFix, 'cv' => $areaCv]] + ($own ? ['own' => self::ownFit($rows, $own)] : []);
  }
  /** Тепло свого лічильника за місяць (Гкал) по журналу кабінету: кінець місяця — останні показання з датою в цьому місяці (same),
   *  у наступному (next) або лінійно на 1-ше число наступного (interp); відхилені — не беремо. → [ym => e] */
  public static function ownMonths(array $own, string $al): array {
    $end = self::ownEnds($own, $al);
    $out = []; foreach ($end as $m => $e) { $pm = date('Y-m', strtotime($m . '-01 -1 month')); if (isset($end[$pm]) && $e >= $end[$pm]) $out[$m] = $e - $end[$pm]; }
    return $out;
  }
  /** Проміжки між показаннями свого лічильника — і через пропущені місяці (до 4): живий журнал 08.11 — 13 записів, а сусідніх місяців у довідці лише 1.
   *  Лише місяці, які є в довідці з витратою. → [{ms: [ym…], e: своє за проміжок, v: Σ витрата, D/L/H: Σ різниця/втрати/усього × S_кв/S_буд, sf, money: Σ нараховано + абонплата − пільга, cost, n}] */
  public static function ownIntervals(array $rows, array $own, string $al): array {
    $nn = fn($r, $k) => isset($r[$k]) && is_numeric($r[$k]) ? (float)$r[$k] : null;
    $by = []; foreach ($rows as $r) if (isset($r['ym']) && $nn($r, 'flat') !== null) $by[$r['ym']] = $r;
    $end = self::ownEnds($own, $al); $ks = array_keys($end); $out = [];
    for ($i = 1; $i < count($ks); $i++) {
      [$a, $b] = [$ks[$i - 1], $ks[$i]]; $de = $end[$b] - $end[$a]; if ($de < 0) continue;
      $ms = []; for ($m = date('Y-m', strtotime($a . '-01 +1 month')); $m <= $b && count($ms) <= 4; $m = date('Y-m', strtotime($m . '-01 +1 month'))) $ms[] = $m;
      if (count($ms) > 4 || array_filter($ms, fn($m) => !isset($by[$m]))) continue;
      $iv = ['ms' => $ms, 'e' => $de, 'v' => 0.0, 'D' => 0.0, 'L' => 0.0, 'H' => 0.0, 'sf' => null, 'money' => 0.0, 'cost' => 0.0, 'n' => count($ms)];
      foreach ($ms as $m) {
        $r = $by[$m]; $sh = $nn($r, 'sHouse'); $sf = $nn($r, 'sFlat'); $s = $sh > 0 && $sf !== null ? $sf / $sh : 0.0;
        $iv['v'] += $nn($r, 'flat'); $iv['D'] += ($nn($r, 'diff') ?? 0) * $s; $iv['L'] += ($nn($r, 'loss') ?? 0) * $s; $iv['H'] += ($nn($r, 'house') ?? 0) * $s;
        if ($sf > 0) $iv['sf'] = $sf;
        $iv['cost'] += $nn($r, 'cost') ?? 0; $iv['money'] += ($nn($r, 'cost') ?? 0) + ($nn($r, 'abon') ?? 0) - max(0, $nn($r, 'lgota') ?? 0);
      }
      if ($iv['v'] > 0) $out[] = $iv;
    }
    return $out;
  }
  /** Кінці місяців свого лічильника [ym => Гкал] (по зростанню): same — останні показання з датою в цьому місяці, next — у наступному, interp — лінійно на 1-ше. */
  public static function ownEnds(array $own, string $al): array {
    $p = array_values(array_filter($own, fn($r) => ($r['status'] ?? '') !== 'rejected' && isset($r['date'], $r['energy']) && is_numeric($r['energy'])));
    usort($p, fn($a, $b) => strcmp($a['date'], $b['date'])); if (count($p) < 2) return [];
    $end = [];
    if ($al === 'interp') {
      $t = fn(string $d) => (int)(strtotime($d . ' 00:00:00 UTC') / 86400);
      $m0 = substr($p[0]['date'], 0, 7); $m1 = substr($p[count($p) - 1]['date'], 0, 7);
      for ($m = $m0; $m <= $m1; $m = date('Y-m', strtotime($m . '-01 +1 month'))) {
        $b = $t(date('Y-m-d', strtotime($m . '-01 +1 month'))); $lo = null; $hi = null;
        foreach ($p as $r) { if ($t($r['date']) <= $b) $lo = $r; elseif ($hi === null) $hi = $r; }
        if ($lo && $hi && $t($hi['date']) > $t($lo['date']) && $t($hi['date']) - $t($lo['date']) <= 75) $end[$m] = (float)$lo['energy'] + ((float)$hi['energy'] - (float)$lo['energy']) * ($b - $t($lo['date'])) / ($t($hi['date']) - $t($lo['date']));
      }
    } else foreach ($p as $r) { $m = substr($r['date'], 0, 7); if ($al === 'next') $m = date('Y-m', strtotime($m . '-01 -1 month')); $end[$m] = (float)$r['energy']; }
    ksort($end); return $end;
  }
  /** «Витрата по квартирі» проти свого лічильника (Методика № 315: свій лічильник + частка будинку) — без чисел людей: лише % похибки й сталість співвідношень.
   *  Рахує по проміжках між показаннями (ownIntervals: і через пропущені місяці), а не лише по сусідніх місяцях.
   *  hyp — медіана |похибки| в % для готових формул; ratio — частка понад свій лічильник x = v − e відносно втрат × S, усього по будинку × S, свого тепла,
   *  площі квартири (на 1000 м² за місяць): медіана й розкид (cv); loo — та ж частка з коефіцієнтом, підібраним БЕЗ цього проміжку (чесна перевірка: яка основа
   *  передбачає витрату ХТМ); money — гроші так само: (e + c × основа) × тариф + абонплата проти нарахованого ХТМ. Найменша loo = формула ХТМ.
   *  scale — поточні показання довідки / свої (якщо це той самий лічильник в інших одиницях). */
  public static function ownFit(array $rows, array $own): array {
    $nn = fn($r, $k) => isset($r[$k]) && is_numeric($r[$k]) ? (float)$r[$k] : null;
    $med = function (array $a) { if (!$a) return null; sort($a); $n = count($a); return $n % 2 ? $a[intdiv($n, 2)] : ($a[$n / 2 - 1] + $a[$n / 2]) / 2; };
    $cv = function (array $a) { $n = count($a); if ($n < 2) return null; $m = array_sum($a) / $n; if (abs($m) < 1e-9) return null; $v = 0; foreach ($a as $x) $v += ($x - $m) ** 2; return round(sqrt($v / ($n - 1)) / abs($m) * 100, 1); };
    // готові формули на сумах проміжку: e — своє, D/L/H — Σ різниця/втрати/усього по будинку × S_кв/S_буд
    $H = ['own' => fn($i) => $i['e'], 'own+loss*s' => fn($i) => $i['e'] + $i['L'], 'own+house*s' => fn($i) => $i['e'] + $i['H'], 'own+diff*s' => fn($i) => $i['e'] + $i['D'],
      'own/4.1868' => fn($i) => $i['e'] / 4.1868, 'own*0.86' => fn($i) => $i['e'] * 0.86, 'own/4.1868+loss*s' => fn($i) => $i['e'] / 4.1868 + $i['L'], 'own*0.86+loss*s' => fn($i) => $i['e'] * 0.86 + $i['L']];
    // основи частки понад свій лічильник: x ≈ c × основа
    $B = ['loss*s' => fn($i) => $i['L'], 'house*s' => fn($i) => $i['H'], 'own' => fn($i) => $i['e'], 'area' => fn($i) => $i['sf'] > 0 ? $i['sf'] * $i['n'] / 1000 : 0.0];
    $tv = []; foreach ($rows as $r) { $f = $nn($r, 'flat'); $c = $nn($r, 'cost'); if ($f > 0 && $c > 0 && $c / $f > 300 && $c / $f < 10000) $tv[] = $c / $f; }
    $tar = $med($tv); $ab = null; foreach ($rows as $r) if ($nn($r, 'abon') > 0) $ab = $nn($r, 'abon');
    $out = ['n' => count($own), 'from' => $own ? substr((string)$own[0]['date'], 0, 7) : null, 'to' => $own ? substr((string)$own[count($own) - 1]['date'], 0, 7) : null,
      'rejected' => count(array_filter($own, fn($r) => ($r['status'] ?? '') === 'rejected')), 'al' => []];
    $best = null; $model = null; $fit = []; $zl = null;
    foreach (['same', 'next', 'interp'] as $al) {
      $iv = self::ownIntervals($rows, $own, $al); $hy = []; $ra = []; $neg = 0;
      foreach ($iv as $i) {
        foreach ($H as $k => $f) $hy[$k][] = abs(($f($i) - $i['v']) / $i['v'] * 100);
        $x = $i['v'] - $i['e']; if ($x < 0) $neg++;
        foreach ($B as $k => $f) { $b = $f($i); if ($b > 0) $ra[$k][] = $x / $b; }
      }
      $loo = []; $mon = [];
      foreach (['own', 'area'] as $k) { $sx = 0.0; $sb = 0.0; foreach ($iv as $i) { $b = $B[$k]($i); if ($b > 0) { $sx += $i['v'] - $i['e']; $sb += $b; } } if ($sb > 0) $fit[$al][$k] = max(0.0, $sx / $sb); }
      if (count($iv) >= 2) foreach ($B as $k => $f) {
        $es = []; $ms = [];
        foreach ($iv as $j => $i) {
          $sx = 0.0; $sb = 0.0; foreach ($iv as $j2 => $i2) if ($j2 !== $j && $f($i2) > 0) { $sx += $i2['v'] - $i2['e']; $sb += $f($i2); }
          if ($sb <= 0 || !($f($i) > 0)) continue;
          $p = $i['e'] + $sx / $sb * $f($i); $es[] = abs($p - $i['v']) / $i['v'] * 100;
          if ($tar && $i['money'] > 0) $ms[] = abs($p * $tar + ($ab ?? 0) * $i['n'] - $i['money']) / $i['money'] * 100;
        }
        if ($es) $loo[$k] = round($med($es), 1); if ($ms) $mon[$k] = round($med($ms), 1);
      }
      asort($loo);
      $hm = []; foreach ($hy as $k => $a) $hm[$k] = round($med($a), 1); asort($hm);
      $rr = []; foreach ($ra as $k => $a) $rr[$k] = ['med' => round($med($a), 3), 'cv' => $cv($a)];
      // по проміжках (без чисел людей): місяці, своє — % від витрати ХТМ, частка понад своє відносно кожної основи — у разах від медіани
      $ivs = [];
      foreach ($iv as $i) {
        $x = $i['v'] - $i['e']; $row = ['ms' => implode(',', $i['ms']), 'own%' => round($i['e'] / $i['v'] * 100, 1)];
        foreach ($B as $k => $f) { $b0 = $f($i); $m0 = $rr[$k]['med'] ?? null; if ($b0 > 0 && $m0) $row[$k] = round($x / $b0 / $m0, 2); }
        $ivs[] = $row;
      }
      $out['al'][$al] = ['iv' => count($iv), 'months' => array_sum(array_column($iv, 'n')), 'over' => count($iv) - $neg, 'hyp' => $hm, 'ratio' => $rr, 'ivs' => $ivs] + ($loo ? ['loo' => $loo, 'money' => $mon] : []);
      $top = $hm ? reset($hm) : null; if ($top !== null && count($iv) >= 2 && ($best === null || $top < $best[1])) $best = [$al, $top, array_key_first($hm)];
      if ($loo && ($model === null || reset($loo) < $model['err'])) $model = ['al' => $al, 'basis' => array_key_first($loo), 'err' => reset($loo), 'money' => $mon[array_key_first($loo)] ?? null, 'own' => $loo['own'] ?? null, 'iv' => count($iv)];
      foreach (['own', 'area'] as $k) if (isset($loo[$k], $fit[$al][$k]) && ($zl === null || $loo[$k] < $zl['err'])) $zl = ['al' => $al, 'basis' => $k, 'err' => $loo[$k]];
    }
    // як hsprCalib у браузері: підбір частки (основа own чи area, найменша помилка «без себе») беремо, лише якщо він схожий на ЗБП; інакше — ZBP_M2 × площа
    if ($zl) {
      $c = $fit[$zl['al']][$zl['basis']]; $m2 = $zl['basis'] === 'area' ? $c / 1000 : null;
      $ok = $zl['basis'] === 'area' ? $m2 <= self::ZBP_MAX_M2 : $c <= self::ZBP_MAX_OWN;
      $out['zbp'] = $zl + ['c' => round($c, 4), 'perM2' => $m2 === null ? null : round($m2, 5), 'ok' => $ok, 'use' => $ok ? 'fit' : 'm2', 'm2' => self::ZBP_M2];
    }
    if ($best) $out['best'] = ['al' => $best[0], 'hyp' => $best[2], 'err' => $best[1]];
    if ($model) $out['model'] = $model;
    // ті самі це показання, що в довідці (поточні), лише в інших одиницях?
    $em = []; foreach ($own as $r) if (($r['status'] ?? '') !== 'rejected') $em[substr((string)$r['date'], 0, 7)] = (float)$r['energy'];
    $sc = []; foreach ($rows as $r) { $c = $nn($r, 'cur'); if ($c !== null && ($em[$r['ym']] ?? 0) > 0) $sc[] = $c / $em[$r['ym']]; }
    if ($sc) $out['scale'] = ['med' => round($med($sc), 4), 'cv' => $cv($sc), 'n' => count($sc)];
    return $out;
  }
}
