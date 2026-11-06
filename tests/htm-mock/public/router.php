<?php
// Стенд v2 — фронт-контроллер. Запуск: php -S 127.0.0.1:8099 -t public public/router.php
declare(strict_types=1);
require __DIR__ . '/../app/stand.php';
require __DIR__ . '/../app/robot.php';

if (PHP_SAPI === 'cli-server') { $p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH); if ($p !== '/' && is_file(__DIR__ . $p)) return false; }
$path = rtrim(rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/'), '/') ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (global_scenarios($path)) return;

$c = st()['credentials']; $ACC = $c['account']; $SUR = mb_strtoupper($c['surname']); $SN = st()['meter']['sn'];

if ($path === '/') { header('Location: /cabinet/login'); return; }
if ($path === '/stand/health') { header('Content-Type: text/plain'); echo 'ok'; return; }
if ($path === '/stand/journal') { header('Content-Type: text/plain; charset=utf-8'); @readfile(ROOT . '/storage/journal.jsonl'); return; }
if ($path === '/stand/state') { header('Content-Type: application/json; charset=utf-8'); robot_tick(); echo json_encode(st(), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT); return; }
if ($path === '/stand/admin') { $method === 'POST' ? do_admin() : page_admin(); return; }
if ($path === '/cabinet/login') { $method === 'POST' ? do_login() : page_login(); return; }
if ($path === '/cabinet/logout') { sess(); session_destroy(); log_req('logout'); header('Location: /cabinet/login'); return; }
if ($path === '/cabinet/heat/help') { page('Кабинет | Правила роботи з журналом', '<h1>Пам\'ятка (стенд)</h1><p>' . h(TX('window_rule')) . '</p><p>Повний текст — у документі проєкту «кабінет ХТМ (зняття 01.11.2026)», §7.</p>', 200, logged_in()); return; }
if (str_starts_with($path, '/cabinet/add') || str_starts_with($path, '/cabinet/settings')) { page('Кабінет', '<p>На стенді ця сторінка навмисно не реалізована (адаптер її не чіпає).</p>', 200, logged_in()); return; }

// всё остальное — только после входа
if (str_starts_with($path, '/cabinet')) {
  if (scenario() === 'session_expired' || !logged_in()) { log_req('auth_required', ['path' => $path]); header('Location: /cabinet/login'); return; }
  if ($path === '/cabinet') { page_account(); return; }
  if ($path === '/cabinet/list') { page_list(); return; }
  if ($path === "/cabinet/$ACC/$SUR") { page_card(); return; }
  if ($path === "/cabinet/heat/$ACC/$SUR") { $method === 'POST' ? do_save() : page_heat(); return; }
  if ($path === "/cabinet/heat/viewall/$ACC/$SUR/$SN") { page_viewall(); return; }
}
page('404', '<p>Немає такої сторінки на стенді: ' . h($path) . '</p>', 404, logged_in());

// ---------------- вход ----------------
function login_html(string $err = ''): string {
  $L = cfg()['login']; $c = st()['credentials'];
  $cap = scenario() === 'captcha' ? '<div class="g-recaptcha" data-marker="stand-captcha" data-sitekey="{{SITEKEY}}">reCAPTCHA (імітація)</div>' : '';
  return '<h1>Вхід до кабінету (тест)</h1>' . ($err ? '<div class="alert alert-danger flash" data-marker="stand-login-error">' . h($err) . '</div>' : '')
    . '<p class="stand-creds">Тестові дані: email <code>' . h($c['email']) . '</code> / пароль <code>' . h($c['password']) . '</code>; рахунок <code>' . h($c['account']) . '</code> / прізвище <code>' . h($c['surname']) . '</code>.</p>'
    . '<div class="stand-two"><form action="/cabinet/login" method="post" enctype="application/x-www-form-urlencoded" class="stand-card" id="acc-enter"><h2>Вхід за особовим рахунком</h2>'
    . '<label>Особовий рахунок<input type="text" name="' . $L['account'] . '" id="acc-input"></label><label>Прізвище (без ініціалів)<input type="text" name="' . $L['surname'] . '" id="lastname-input"></label>'
    . '<p class="stand-note">Після реєстрації вхід за особовим рахунком буде закритий.</p>' . $cap . '<button type="submit" name="' . $L['account_submit'] . '">Вхід</button></form>'
    . '<form action="/cabinet/login" method="post" enctype="application/x-www-form-urlencoded" class="stand-card" id="login-enter"><h2>Вхід за логіном та паролем</h2>'
    . '<label>Логін (адреса електронної пошти)<input type="email" name="' . $L['email'] . '" id="email-input"></label><label>Пароль<input type="password" name="' . $L['password'] . '" id="passw-input"></label>'
    . $cap . '<button type="submit" name="' . $L['email_submit'] . '">Вхід</button></form></div>'
    . '<p>Показання гарячої води — через Telegram-бот (на стенді не імітується).</p>';
}
function page_login(): void { if (logged_in() && scenario() !== 'session_expired') { header('Location: /cabinet'); return; } page('Кабінет | Сторінка входу', login_html()); }
function do_login(): void {
  $L = cfg()['login']; $s = st(); $c = $s['credentials'];
  $byEmail = isset($_POST[$L['email_submit']]) || isset($_POST[$L['email']]);
  log_req('login_attempt', ['mode' => $byEmail ? 'email_password' : 'account_surname', 'fields' => array_keys($_POST)]);
  if (scenario() === 'captcha') { page('Кабінет | Сторінка входу', login_html('Підтвердіть, що ви не робот.'), 200); return; }
  if (scenario() === 'bad_credentials') { page('Кабінет | Сторінка входу', login_html('Невірний логін або пароль.'), 200); return; }
  if ($byEmail) $ok = post($L['email']) === $c['email'] && post($L['password']) === $c['password'];
  else {
    if (!empty($s['registered']) || scenario() === 'account_login_closed') { page('Кабінет | Сторінка входу', '<div class="alert alert-danger flash" data-marker="stand-account-login-closed">Вхід за особовим рахунком закритий: абонент зареєстрований. Увійдіть за логіном і паролем.</div>' . login_html(), 200); return; }
    $ok = post($L['account']) === $c['account'] && mb_strtoupper((string)post($L['surname'])) === mb_strtoupper($c['surname']);
  }
  if (!$ok) { page('Кабінет | Сторінка входу', login_html('Невірний логін або пароль.'), 200); return; }
  sess(); session_regenerate_id(true); $_SESSION['uid'] = 1; log_req('login_ok');
  header('Location: /cabinet');
}

// ---------------- кабинет ----------------
function page_account(): void {
  $c = st()['credentials'];
  page('Кабінет | Стан особового рахунку', '<h1>Стан особового рахунку № ' . h($c['account']) . ' — розрахунковий місяць ' . h(month_ua(today(), false)) . ' ' . substr(today(), 0, 4) . '</h1>'
    . '<p><a href="' . h(acc_url('/cabinet/heat')) . '">Залишити показання по теплу</a></p><p class="stand-note">Таблиця нарахувань на стенді не імітується.</p>', 200, true);
}
function page_list(): void {
  $c = st()['credentials'];
  page('Кабінет | Список квартир (особових рахунків)', '<h1>Список квартир</h1><table class="stand-tbl"><tr><th>№</th><th>Особовий рахунок</th><th>Прізвище</th><th>Адреса</th><th>Дії</th></tr>'
    . '<tr><td>1</td><td><a href="' . h(acc_url()) . '">' . h($c['account']) . '</a></td><td>' . h(mb_strtoupper($c['surname'])) . '</td><td>{{ADDRESS}}</td><td>—</td></tr></table>', 200, true);
}
function page_card(): void { page('Кабінет | Особовий рахунок', '<h1>Особовий рахунок ' . h(st()['credentials']['account']) . '</h1><p><a href="' . h(acc_url('/cabinet/heat')) . '">Залишити показання по теплу</a></p>', 200, true); }

function row_cells(array $r, string $cls = '', bool $head = false): string {
  $keys = ['date', 'energy', 'volume', 'flow', 'power', 'tSupply', 'tReturn', 'hours', 'errHours', 'errCode'];
  $ids = ['date' => 'LastDtPok', 'energy' => 'LastValuePok', 'volume' => 'LastRashPok', 'flow' => 'HeatRash', 'power' => 'HeatPower', 'tSupply' => 'TempPod', 'tReturn' => 'TempO', 'hours' => 'LastTimePok', 'errHours' => 'ErrorTime', 'errCode' => 'ErrorKod'];
  $dec = ['energy' => 3, 'volume' => 3, 'flow' => 3, 'power' => 3, 'tSupply' => 2, 'tReturn' => 2];
  $out = '';
  foreach ($keys as $k) {
    $v = $k === 'date' ? ua_date($r['date']) : (isset($dec[$k]) ? number_format((float)$r[$k], $dec[$k], '.', '') : (string)$r[$k]);
    $out .= '<td' . ($cls ? ' class="' . $cls . '"' : '') . ($head ? ' id="head_' . $ids[$k] . '"' : '') . '>' . h($v) . '</td>';
  }
  return $out;
}
function journal_table(array $recs): string {
  $hdr = ['Дата зняття показань', 'Накопичена енергія, ГКал', 'Обсяг теплоносія, M3', 'Миттєва витрата, М3/Год', 'Миттєва потужність, кВт', 'Температура подачі, Градуси', 'Температура повернення, Градуси', 'Час роботи, Годинами по зрост.', 'Час роботи з помилкою, Годинами по зрост.', 'Код помилки'];
  $h = '<table class="table table-bordered table-condensed table-header-rotated stand-tbl"><tr>' . implode('', array_map(fn($x) => '<th>' . h($x) . '</th>', $hdr)) . '</tr>';
  foreach ($recs as $r) {
    $cls = $r['status'] === 'accepted' ? 'bg-success' : ($r['status'] === 'rejected' ? 'bg-danger' : '');
    $h .= '<tr data-marker="stand-journal-row">' . row_cells($r, $cls) . '</tr>'
      . '<tr><td colspan="10">Примітки: ' . h($r['note'] !== '' ? $r['note'] : 'Немає') . '</td></tr>'
      . '<tr><td colspan="10" data-marker="stand-journal-status">' . h($r['status_text']) . '</td></tr>';
  }
  return $h . '</table>';
}
function page_heat(string $flash = '', string $flashCls = '', array $bad = [], array $old = []): void {
  robot_tick();
  $s = st(); $m = $s['meter']; $t = today();
  $body = '<h3 class="panel-title">ВІДОМІСТЬ ОБЛІКУ СПОЖИВАННЯ ТЕПЛОВОЇ ЕНЕРГІЇ НА ' . ua_date($t) . ': ПУ ' . h($m['model']) . ', №' . h($m['sn']) . '</h3>'
    . '<table class="stand-tbl stand-meter"><tr><th>Дата первинної прийомки (початок експлуатації)</th><td>' . ua_date($m['first_accept']) . '</td></tr>'
    . '<tr><th>Величина перехідної витрати</th><td>' . h((string)$m['qt']) . '</td></tr><tr><th>Повірений до</th><td>' . ua_date($m['verified_until']) . '</td></tr>'
    . '<tr><th>П.І.П-б.</th><td>{{SURNAME}}</td></tr><tr><th>Адреса</th><td>{{ADDRESS}}</td></tr></table>'
    . '<h4>Показання, що пройшли раніше за розрахунком</h4><table class="stand-tbl"><tr>' . row_cells($s['baseline'], 'bg-info-gray', true) . '</tr></table>';
  if ($flash) $body .= '<div class="alert ' . $flashCls . ' flash">' . $flash . '</div>';
  // сценарий banners: постоянные плашки сайта (есть до и после отправки) — робот не должен принимать их за ошибку своей отправки
  if (scenario() === 'banners') $body .= '<div class="alert alert-danger" data-marker="stand-banner-debt">Увага! Нікому не повідомляйте пароль від кабінету.</div>'
    . '<div class="alert alert-info">Рекомендуємо подавати показання до 23 числа.</div>';
  if (window_open()) {
    $first = (new DateTimeImmutable($t))->format('Y-m-01');
    $body .= '<p>' . h(TX('window_rule')) . '</p><p>Введіть показання на нову дату або клікніть іконку в полі дати, щоб відредагувати введені раніше показання:</p>'
      . (scenario() === 'nominmax' ? '<script>$(function () { $(\'#LastDtPok\').datetimepicker({ format: \'DD.MM.YYYY\' }); });</script>' : '<script>var min_date = \'' . ua_date($first) . '\'; var max_date = \'' . ua_date($t) . '\';</script>')
      . heat_form($bad, $old);
  } else {
    $next = (new DateTimeImmutable($t))->modify((int)substr($t, 8, 2) > 25 ? 'first day of next month' : 'first day of this month')->format('Y-m-d');
    $body .= '<div class="alert alert-warning" data-marker="stand-period-closed">' . h(TX('closed', ['month' => month_ua($t, false), 'next' => month_ua($next)])) . '</div>';
  }
  // сценарий banners: журнал обновляется не сразу — новых строк «на перевірці» на странице ещё нет
  $recent = array_slice(scenario() === 'banners' ? array_values(array_filter($s['journal'], fn($r) => $r['status'] !== 'pending')) : $s['journal'], -5);
  $body .= '<h4>Ж У Р Н А Л — Останні записи | <a href="' . h(acc_url('/cabinet/heat/viewall') . '/' . $m['sn']) . '">Всі записи</a></h4>' . journal_table($recent)
    . '<p><a href="/cabinet/heat/help">Правила роботи з журналом</a></p>';
  page('Кабінет | Приймання показань по теплу', $body, 200, true);
}
function heat_form(array $bad, array $old): string {
  $changed = scenario() === 'markup_changed';
  $lbl = ['date' => 'Дата зняття показань', 'energy' => 'Накопичена енергія, ГКал', 'volume' => 'Обсяг теплоносія, M3', 'flow' => 'Миттєва витрата, М3/Год', 'power' => 'Миттєва потужність, кВт', 'tSupply' => 'Температура подачі', 'tReturn' => 'Температура повернення', 'hours' => 'Час роботи', 'errHours' => 'Час роботи з помилкою', 'errCode' => 'Код помилки', 'phone' => 'Контактний телефон', 'email' => 'Email', 'note' => 'Примітки'];
  $h = '<form action="' . h(acc_url('/cabinet/heat')) . '" method="post" enctype="application/x-www-form-urlencoded" class="stand-card" id="heat-form">' . ($changed ? '<p data-marker="stand-markup-changed">Розмітку змінено (сценарій markup_changed).</p>' : '');
  foreach ($lbl as $k => $label) {
    $name = F($k) . ($changed && $k === 'energy' ? '_v2' : '');
    // телефон — как на живом кабинете 06.11.2026: подсказка с телефоном из профиля, часть цифр скрыта
    $ph = $k === 'phone' ? ' placeholder="(067) ***-**-45"' : ($k === 'date' ? ' placeholder="ДД.ММ.РРРР"' : '');
    $h .= '<label class="' . (in_array($k, $bad, true) ? 'has-error' : '') . '">' . h($label) . '<input type="text" name="' . h($name) . '" id="' . h(F($k)) . '" value="' . h($old[$k] ?? '') . '"' . $ph . '>'
      . ($k === 'date' && scenario() === 'banners' ? '<span class="help-block">Тільки показання поточного місяця</span>' : '') . '</label>';
  }
  return $h . '<input type="submit" name="' . h(F('submit')) . '" value="Зберегти показання"></form>';   // как на живом кабинете (06.11.2026)
}
function do_save(): void {
  if (!window_open()) { page_heat(); return; }
  $keys = ['date', 'energy', 'volume', 'flow', 'power', 'tSupply', 'tReturn', 'hours', 'errHours', 'errCode', 'phone', 'email', 'note'];
  $in = []; foreach ($keys as $k) $in[$k] = trim((string)post(F($k)));
  log_req('save_attempt', ['fields' => array_keys($_POST), 'values' => array_diff_key($in, ['phone' => 1, 'email' => 1])]);
  $bad = []; $msgs = [];
  $ymd = ymd_from_ua($in['date']);
  if (!$ymd) { $bad[] = 'date'; $msgs[] = 'Дата має бути у форматі дд.мм.рррр.'; }
  elseif (substr($ymd, 0, 7) !== substr(today(), 0, 7) || $ymd > today()) { $bad[] = 'date'; $msgs[] = 'Можна передавати показання тільки поточного місяця і не пізніше сьогодні.'; }
  foreach (['energy', 'volume', 'flow', 'power', 'tSupply', 'tReturn', 'hours', 'errHours'] as $k) {
    if ($in[$k] === '') { $bad[] = $k; $msgs[] = 'Заповніть усі поля.'; continue; }
    if (str_contains($in[$k], ',')) { $bad[] = $k; $msgs[] = 'Роздільник дробових — крапка.'; continue; }
    if (!is_numeric($in[$k])) { $bad[] = $k; $msgs[] = 'Невірний формат числа.'; }
  }
  foreach (['tSupply', 'tReturn'] as $k) if (!in_array($k, $bad, true) && (float)$in[$k] == 0.0) { $bad[] = $k; $msgs[] = 'Температура подачі/повернення не може бути «0».'; }
  if ($in['phone'] === '') { $bad[] = 'phone'; $msgs[] = 'Введіть контактний телефон.'; }
  elseif (!preg_match('/^\(0\d{2}\) \d{3}-\d{2}-\d{2}$/', $in['phone'])) { $bad[] = 'phone'; $msgs[] = 'Телефон у форматі (0XX) XXX-XX-XX.'; }   // гипотеза стенда: формат как в подсказке
  if (!filter_var($in['email'], FILTER_VALIDATE_EMAIL)) { $bad[] = 'email'; $msgs[] = 'Введіть email.'; }
  $s = st();
  if (!$bad && $ymd) {
    $idx = null; foreach ($s['journal'] as $i => $r) if ($r['date'] === $ymd) $idx = $i;
    if ($idx !== null && $idx !== count($s['journal']) - 1) { $bad[] = 'date'; $msgs[] = 'На цю дату показання вже передані. Редагувати можна лише останній запис.'; }
  }
  if ($bad) { page_heat(h(implode(' ', array_unique($msgs))), 'alert-danger', $bad, $in); return; }
  $rec = ['date' => $ymd, 'energy' => (float)$in['energy'], 'volume' => (float)$in['volume'], 'flow' => (float)$in['flow'], 'power' => (float)$in['power'],
    'tSupply' => (float)$in['tSupply'], 'tReturn' => (float)$in['tReturn'], 'hours' => (int)$in['hours'], 'errHours' => (int)$in['errHours'],
    'errCode' => $in['errCode'] === '' ? 'E---' : $in['errCode'], 'note' => $in['note'], 'status' => 'pending', 'status_text' => TX('status_pending'), 'saved_ts' => time()];
  $last = count($s['journal']) - 1;
  if ($last >= 0 && $s['journal'][$last]['date'] === $ymd) $s['journal'][$last] = $rec; else $s['journal'][] = $rec;
  st_save($s);
  log_req('saved', ['date' => $ymd]);
  page_heat('<span data-marker="stand-saved">' . h(TX('flash_saved')) . '</span>', 'alert-success');
}
function page_viewall(): void {
  robot_tick(); $s = st();
  page('Кабінет | Перегляд журналу показань по теплу', '<h1>ПЕРЕГЛЯД ВСІХ ЗАПИСІВ ЖУРНАЛУ: ПУ ' . h($s['meter']['model']) . ', №' . h($s['meter']['sn']) . '</h1>' . journal_table($s['journal']), 200, true);
}

// ---------------- админка стенда ----------------
function page_admin(): void {
  $opts = implode('', array_map(fn($x) => '<option' . ($x === scenario() ? ' selected' : '') . '>' . $x . '</option>', SCENARIOS));
  $tail = is_file(ROOT . '/storage/journal.jsonl') ? h(implode("\n", array_slice(file(ROOT . '/storage/journal.jsonl', FILE_IGNORE_NEW_LINES), -15))) : '(порожньо)';
  page('Адмінка стенда', '<h1>Адмінка стенда</h1><form method="post" class="stand-card"><label>Сценарій<select name="scenario">' . $opts . '</select></label>'
    . '<label>Дата стенда (порожньо — сьогодні)<input type="date" name="today" value="' . h(opt('today')) . '"></label>'
    . '<label>Затримка робота, сек (за замовчуванням 1200)<input name="robot_delay" value="' . h(opt('robot_delay')) . '"></label>'
    . '<button name="act" value="set">Застосувати</button> <button name="act" value="robot">Запустити робота зараз</button> <button name="act" value="reset">Скинути стан</button> <button name="act" value="clear">Очистити журнал запитів</button></form>'
    . '<h2>Журнал запитів (останні 15)</h2><pre class="stand-journal">' . $tail . '</pre><p><a href="/stand/state">/stand/state</a> · <a href="/stand/journal">/stand/journal</a></p>');
}
function do_admin(): void {
  $a = $_POST['act'] ?? '';
  if ($a === 'set') { opt_set('scenario', in_array($_POST['scenario'] ?? '', SCENARIOS, true) && $_POST['scenario'] !== 'ok' ? $_POST['scenario'] : ''); opt_set('today', preg_match('/^\d{4}-\d{2}-\d{2}$/', $_POST['today'] ?? '') ? $_POST['today'] : ''); opt_set('robot_delay', ctype_digit($_POST['robot_delay'] ?? '') ? $_POST['robot_delay'] : ''); }
  if ($a === 'robot') robot_tick(true);
  if ($a === 'reset') st_reset();
  if ($a === 'clear') @unlink(ROOT . '/storage/journal.jsonl');
  header('Location: /stand/admin');
}
