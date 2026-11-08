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
  // платежі і квитанція — синтетика стенда (07.11.2026): на живом кабинете раздел /cabinet/payments/… есть, его вид не снят — осмотр робота (HtmCab::explore) покажет
  if ($path === "/cabinet/payments/$ACC/$SUR") { page_payments(); return; }
  // «Довідка по теплу (нова)» — заголовки как на живом (осмотр 07.11.2026, htmcab.explore th); значения — синтетика
  if ($path === "/cabinet/spr-teplo/$ACC/$SUR") { page_spr(); return; }
  // рахунок — как на живом кабинете (осмотр 07.11.2026): «Сформувати рахунок» → HTML «Рахунок за <місяць> <рік> року» с «Друкувати»/«Назад»; PDF нет
  if ($path === "/cabinet/bill/print/$ACC/$SUR") { page_bill(isset($_GET['hint'])); return; }
  if ($path === "/cabinet/payments/print/$ACC/$SUR/2026-10") { log_req('bill_pdf'); header('Content-Type: application/pdf'); header('Content-Disposition: inline; filename="kvit_' . $ACC . '_2026-10.pdf"'); echo "%PDF-1.4\n% stand kvytantsiia HTM 2026-10\n%%EOF\n"; return; }
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
    . '<p><a href="' . h(acc_url('/cabinet/heat')) . '">Залишити показання по теплу</a></p>'
    . '<p><a href="' . h(acc_url('/cabinet/bill/print')) . '">Сформувати рахунок</a> · <a href="' . h(acc_url('/cabinet/bill/print')) . '?hint=pdf">Зберегти рахунок в PDF</a> · <a href="' . h(acc_url('/cabinet/payments')) . '">Переглянути архів платежів</a></p>'
    . '<p class="stand-note">Таблиця нарахувань на стенді не імітується.</p>', 200, true);
}
function page_list(): void {
  $c = st()['credentials'];
  page('Кабінет | Список квартир (особових рахунків)', '<h1>Список квартир</h1><table class="stand-tbl"><tr><th>№</th><th>Особовий рахунок</th><th>Прізвище</th><th>Адреса</th><th>Дії</th></tr>'
    . '<tr><td>1</td><td><a href="' . h(acc_url()) . '">' . h($c['account']) . '</a></td><td>' . h(mb_strtoupper($c['surname'])) . '</td><td>{{ADDRESS}}</td><td>—</td></tr></table>', 200, true);
}
function page_card(): void { page('Кабінет | Особовий рахунок', '<h1>Особовий рахунок ' . h(st()['credentials']['account']) . '</h1><p><a href="' . h(acc_url('/cabinet/heat')) . '">Залишити показання по теплу</a></p><p><a href="' . h(acc_url('/cabinet/payments')) . '">Платежі та нарахування</a></p>', 200, true); }
/** opt spr=house — довідка як на живому кабінеті 08.11: показання й різниця — БУДИНКОВОГО лічильника (10–99 Гкал), витрата по квартирі = свій лічильник
 *  (журнал «Всі записи», house_own()) + теплові втрати × S_кв / S_буд (стенд обирає таку формулу, щоб робот її знайшов). */
function house_own(): array { return [['2025-09-26', 8.9], ['2025-10-28', 9.05], ['2025-11-27', 9.7], ['2025-12-29', 10.55], ['2026-01-28', 11.45], ['2026-02-26', 12.15], ['2026-03-27', 12.6]]; }
function page_spr_house(array $h): void {
  $own = []; foreach (house_own() as [$d, $e]) $own[substr($d, 0, 7)] = $e;
  $hd = ['2025-10' => [12.4, 1.1], '2025-11' => [48.6, 3.9], '2025-12' => [71.2, 5.2], '2026-01' => [80.5, 6.0], '2026-02' => [66.3, 4.9], '2026-03' => [41.7, 3.2]];
  $prev = 512.1; $tr = ''; $fmt = fn($v, $n) => number_format($v, $n, ',', '');
  foreach ($hd as $ym => [$d, $loss]) {
    $pm = date('Y-m', strtotime($ym . '-01 -1 month')); $e = $own[$ym] - $own[$pm]; $fl = round($e + $loss * 56.6 / 3012.5, 5); $cur = $prev + $d;
    $c = [substr($ym, 5, 2) . '.' . substr($ym, 0, 4), 'ГКал', $fmt($prev, 5), $fmt($cur, 5), $fmt($d, 5), $fmt($loss, 5), $fmt($d + $loss, 5), '3012,50', '56,60', $fmt($fl, 5),
      number_format($fl * 1539.50, 2, ',', ''), '29,40', '', number_format($fl * 1539.50 + 29.4 - 37, 2, ',', '')];
    $tr .= '<tr>' . implode('', array_map(fn($v) => '<td>' . h($v) . '</td>', $c)) . '</tr>'; $prev = $cur;
  }
  page('Кабінет | Довідка по теплу (нова)', '<h1>Довідка по теплу (нова)</h1><table class="stand-tbl"><tr>' . implode('', array_map(fn($v) => '<th>' . h($v) . '</th>', $h)) . '</tr>' . $tr . '</table>', 200, true);
}
function page_spr(): void {
  log_req('spr');
  $h = ['Місяць, рік', 'Одиниці виміру приладу обліку', 'Попередні показання', 'Поточні показання', 'Різниця показань', 'Теплові втрати, Гкал', 'Всього по будинку, Гкал', 'Площа будинку, м2',
    'Площа квартири, м2', 'Витрата по квартирі, Гкал', 'Нараховано за пп т/е, грн.', 'Абонентна плата, грн.', 'Пільга, грн.', 'Надходження, грн'];
  // жовтень 2025 … березень 2026: різниця показань + частка втрат будинку (втрати × 56,6 / 7902,8) = витрата; нараховано = витрата × 1539,50
  $rows = [['10.2025', '9,000', '9,200', 61.2], ['11.2025', '9,200', '9,950', 180.4], ['12.2025', '9,950', '10,850', 230.1], ['01.2026', '10,850', '11,700', 251.7], ['02.2026', '11,700', '12,380', 210.3], ['03.2026', '12,380', '12,910', 150.6]];
  if (opt('spr') === 'house') { page_spr_house($h); return; }
  $tr = '';
  foreach ($rows as [$m, $a, $b, $loss]) {
    $d = (float)str_replace(',', '.', $b) - (float)str_replace(',', '.', $a); $sh = round($loss * 56.6 / 7902.8, 3); $fl = round($d + $sh, 3);
    $c = [$m, 'Гкал', $a, $b, number_format($d, 3, ',', ''), number_format($loss, 3, ',', ''), number_format($loss * 6.5, 3, ',', ''), '7902,80', '56,60', number_format($fl, 3, ',', ''),
      number_format($fl * 1539.50, 2, ',', ' '), '29,40', '0,00', $m === '03.2026' ? '' : '1 500,00'];
    $tr .= '<tr>' . implode('', array_map(fn($v) => '<td>' . h($v) . '</td>', $c)) . '</tr>';
  }
  page('Кабінет | Довідка по теплу (нова)', '<h1>Довідка по теплу (нова)</h1><table class="stand-tbl"><tr>' . implode('', array_map(fn($v) => '<th>' . h($v) . '</th>', $h)) . '</tr>' . $tr . '</table>', 200, true);
}
function page_payments(): void {   // как живой «Архів платежів» (07.11): дата и сумма, ссылки на довідки — квитанций здесь нет
  page('Кабінет | Архів платежів', '<h1>Архів платежів</h1><p><a href="' . h(acc_url('/cabinet/spravka')) . '">Довідка щодо нарахувань та оплати за послугу</a></p><table class="stand-tbl"><tr><th>Дата</th><th>Сума, грн.</th></tr>'
    . '<tr><th colspan="2">Поточні платежі (з 01.11.2026):</th></tr><tr><td>03.11.2026</td><td>245.30</td></tr><tr><th colspan="2">Платежі в розрахунковому місяці:</th></tr></table>', 200, true);
}

/** Рахунок (синтетика по виду живого 07.11): своя страница без меню стенда, windows-1251, стиль и картинка — с сайта, кнопки на JS.
 *  Месяц — opt bill_ym (по умолчанию 2026-09), до сплати — opt bill_pay; bill_ym=none — страница «рахунок ще не сформовано». */
function page_bill(bool $hint): void {
  $ym = opt('bill_ym', '2026-09'); $pay = opt('bill_pay', '245.30'); $c = st()['credentials'];
  header('Content-Type: text/html; charset=windows-1251'); log_req('bill_page', ['ym' => $ym]);
  if ($ym === 'none') { echo mb_convert_encoding('<!doctype html><html><head><title>Кабінет</title></head><body><p>Рахунок ще не сформовано.</p></body></html>', 'Windows-1251', 'UTF-8'); return; }
  $mn = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'][(int)substr($ym, 5, 2) - 1] . ' ' . substr($ym, 0, 4);
  $html = '<!doctype html><html lang="uk"><head><meta charset="windows-1251"><title>Рахунок за ' . $mn . ' року</title><link rel="stylesheet" href="/assets/bill.css">'
    . '<script>function pr(){window.print()}</script></head><body>'
    . ($hint ? '<p class="hint">Щоб зберегти рахунок в PDF, натисніть кнопку "Друкувати" та виберіть у діалозі друку опцію "Зберегти як PDF".</p>' : '')
    . '<div class="noprint"><button onclick="pr()">Друкувати</button> <a href="javascript:history.back()">Назад</a></div>'
    . '<div class="bill"><img src="/assets/bill-logo.png" alt="ХТМ" width="40" height="40"><h2>Рахунок за послуги за ' . $mn . ' року</h2><p>Одержувач: КП «Харківські теплові мережі»</p>'
    . '<p>Особовий рахунок ' . h($c['account']) . ', ' . h(mb_strtoupper($c['surname'])) . '</p>'
    . '<table class="t"><tr><td>-ПЕРЕПЛАТА/+БОРГ за послугу з постачання: теплової енергії</td><td>0.00</td></tr><tr><td>Нараховано за послугу, грн</td><td>' . h($pay) . '</td></tr>'
    . '<tr><td>Нараховано плати за абонентське обслуговування, грн</td><td>0.00</td></tr><tr class="sum"><td><b>ДО СПЛАТИ</b></td><td><b>' . h($pay) . '</b></td></tr></table>'
    . '<p><a href="/cabinet/heat/help" onclick="return false">довідка</a></p></div></body></html>';
  echo mb_convert_encoding($html, 'Windows-1251', 'UTF-8');
}
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
  // сценарий heat_down: вход есть, а страница тепла отвечает 503 (живой кабинет 06.11 22:14 — «check down» дважды)
  if (scenario() === 'heat_down') { http_response_code(503); echo 'Service Unavailable'; exit; }
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
  robot_tick(); $s = st(); $j = $s['journal'];
  // spr=house: минулий сезон у журналі (прийняті) + одна відхилена — робот її не бере
  if (opt('spr') === 'house') { $old = []; foreach (house_own() as [$d, $e]) $old[] = ['date' => $d, 'energy' => $e, 'volume' => 2300, 'flow' => 0.06, 'power' => 1.5, 'tSupply' => 50, 'tReturn' => 30, 'hours' => 30000, 'errHours' => 150, 'errCode' => 'E---', 'note' => '', 'status' => 'accepted', 'status_text' => 'Статус: Показання успішно прийняті'];
    array_splice($old, 3, 0, [['date' => '2025-12-20', 'energy' => 99.9, 'volume' => 2300, 'flow' => 0.06, 'power' => 1.5, 'tSupply' => 50, 'tReturn' => 30, 'hours' => 30000, 'errHours' => 150, 'errCode' => 'E---', 'note' => '', 'status' => 'rejected', 'status_text' => 'Статус: Показання не прийняті з причини: завеликі']]);
    $j = array_merge($old, $j); }
  page('Кабінет | Перегляд журналу показань по теплу', '<h1>ПЕРЕГЛЯД ВСІХ ЗАПИСІВ ЖУРНАЛУ: ПУ ' . h($s['meter']['model']) . ', №' . h($s['meter']['sn']) . '</h1>' . journal_table($j), 200, true);
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
  if ($a === 'set') { opt_set('scenario', in_array($_POST['scenario'] ?? '', SCENARIOS, true) && $_POST['scenario'] !== 'ok' ? $_POST['scenario'] : ''); opt_set('today', preg_match('/^\d{4}-\d{2}-\d{2}$/', $_POST['today'] ?? '') ? $_POST['today'] : ''); opt_set('robot_delay', ctype_digit($_POST['robot_delay'] ?? '') ? $_POST['robot_delay'] : '');
    if (isset($_POST['spr'])) opt_set('spr', $_POST['spr'] === 'house' ? 'house' : '');
    if (isset($_POST['bill_ym'])) opt_set('bill_ym', preg_match('/^(20\d\d-\d\d|none)$/', $_POST['bill_ym']) ? $_POST['bill_ym'] : ''); if (isset($_POST['bill_pay'])) opt_set('bill_pay', preg_match('/^-?\d+\.\d\d$/', $_POST['bill_pay']) ? $_POST['bill_pay'] : ''); }
  if ($a === 'robot') robot_tick(true);
  if ($a === 'reset') st_reset();
  if ($a === 'clear') @unlink(ROOT . '/storage/journal.jsonl');
  header('Location: /stand/admin');
}
