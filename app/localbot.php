<?php
// Автоподача до місцевих постачальників (області) — загальний робот замість окремого коду під кожне КП.
// Владелец 10.11.2026: «даю да на все автоотправки всех коммунальных провайдеров во всех громадах, что уже добавлены — и на новые сразу,
// если есть возможность отправлять данные в фоне». Как подключать новых — skills/oblast-providers/SKILL.md, раздел «Автоподача».
//
//  t form — показання приймає форма на сайті без входу: особовий рахунок → сторінка абонента → форма показань (Кам’янець, mtve.kp.km.ua);
//  t cab  — кабінет із паролем людини: звичайна HTML-форма входу без капчі → форма показань;
//  t mail — постачальник приймає показання на e-mail: лист зі скриньки сервісу (лише коли пошта налаштована, Mail::on()).
//
// Правила (як у Водоканалу й ХТМ): капчу й антибот-перевірки не обходимо — побачили, стоп і «подайте самі»; лише за згодою людини;
// підключення = «Перевірити»: дійти до форми показань і НЕ надіслати; подаємо тільки те, що однозначно лягає в поля (номер лічильника в підписі
// або одне поле на один лічильник), інакше стоп — каркас сторінки без цифр іде в /admin (/api/health → lbot.last), щоб наступна сесія доналаштувала.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class LocalBot {
  /** Боти за `via` у довіднику (app/data/prov_*.json). Ключ ≤ 7 символів (cab_creds.prov = 'L' + ключ, VARCHAR(8)). */
  const BOTS = [
    // Кам’янець-Подільський: «Переглянути стан оплати послуг. Передати поточні показники» — код абонента (74-108-61) у три поля p1–p3 → сторінка
    // абонента → «Передати поточні покази водолічильника» → поля лічильників (1–5) → «Зберегти»; показання перевіряє оператор КП (на сайті — пізніше).
    'mtve' => ['t' => 'form', 'kinds' => ['water'], 'org' => 'КП «Міськтепловоденергія»', 'site' => 'mtve.kp.km.ua',
      'start' => 'https://mtve.kp.km.ua/', 'host' => '~(^|\.)mtve\.kp\.km\.ua$~i', 'need' => ['acc'], 'acc' => ['fields' => ['p1', 'p2', 'p3'], 'hint' => '74-108-61'],
      'win' => [1, 28], 'later' => true,
      // 10.11.2026 (102-а): на живому сайті код абонента перевіряє скрипт сторінки (AJAX, під полями — «Помилковий код абонента»), звичайний GET ?p1&p2&p3
      // повертає головну без сторінки абонента (проба v2: page/no_form). Ендпоінт скрипта не розбираємо — бота вимкнено, доки не з’явиться звичайний шлях.
      'off' => 'script'],
    // Чорноморськ: показання холодної води з 25 числа до кінця місяця — у т.ч. на e-mail водоканалу (сайт cvk.od.ua, 10.11.2026)
    // Львівщина, світло: Львівобленерго приймає показники на pokaz@loe.lviv.ua — лист «10-значний код пробіл показник» (приклад «0000011111 2222»;
    // golossokal.com.ua 03.2026, zaxid.net). Вікно — з 28 числа до 3-го наступного. Лише однозонний: формату для зон не знайшли.
    'loe' => ['t' => 'mail', 'kinds' => ['elec'], 'org' => 'Львівобленерго', 'site' => 'loe.lviv.ua', 'to' => 'pokaz@loe.lviv.ua', 'fmt' => 'code',
      'need' => ['acc'], 'acc' => ['digits' => 10, 'hint' => '0000011111'], 'win' => [28, 3], 'one' => true],
    'cvk' => ['t' => 'mail', 'kinds' => ['water'], 'org' => 'КП «Чорноморськводоканал»', 'site' => 'cvk.od.ua',
      'to' => 'chornomorskvodokanal@gmail.com', 'need' => ['acc', 'name', 'addr', 'phone'], 'win' => [25, 31]],
    // Львів, вода (103-я): ЛМКП «Львівводоканал» приймає показання холодної (і гарячої — для водовідведення) води на e-mail відділу збуту свого району
    // (zaxid.net 27.04.2020 і 28.10.2021 — адреси всіх районів; sykhiv.media 2025 — sih_r@ діє). Лист «номер особового рахунку, адреса, номер лічильника-кінцевий показник»
    // — без номера лічильника не надсилаємо (`serial`). Строк — з 10 числа до передостаннього робочого дня місяця; беремо до 25-го (у лютому передостанній робочий буває 25-го).
    'lvk' => ['t' => 'mail', 'kinds' => ['water'], 'org' => 'ЛМКП «Львівводоканал»', 'site' => 'lvk.lviv.ua', 'fmt' => 'line', 'serial' => true,
      'need' => ['dist', 'acc', 'addr'], 'win' => [10, 25],
      'to' => ['gal' => 'gal_r@lvk.lviv.ua', 'fra' => 'fra_r@lvk.lviv.ua', 'lych' => 'lych_r@lvk.lviv.ua', 'sih' => 'sih_r@lvk.lviv.ua',
        'zal' => 'zal_r@lvk.lviv.ua', 'she' => 'she_r@lvk.lviv.ua', 'pozam' => 'pozam_r@lvk.lviv.ua'],
      'dists' => ['gal' => ['Галицький', 'Галицкий'], 'fra' => ['Франківський', 'Франковский'], 'lych' => ['Личаківський', 'Лычаковский'],
        'sih' => ['Сихівський', 'Сиховский'], 'zal' => ['Залізничний', 'Железнодорожный'], 'she' => ['Шевченківський', 'Шевченковский'],
        'pozam' => ['Поза містом: Винники, Брюховичі, Рудне, села громади', 'За городом: Винники, Брюховичи, Рудно, сёла громады']]],
  ];
  const NEED = ['dist', 'acc', 'name', 'addr', 'phone', 'login', 'pass'];
  /** Адреса листа: одна на бота або за районом людини (`dist`). */
  public static function to(array $b, array $c = []): string { $t = $b['to'] ?? ''; return is_array($t) ? (string)($t[$c['dist'] ?? ''] ?? '') : (string)$t; }
  public static function get(string $id): ?array { return isset(self::BOTS[$id]) ? self::BOTS[$id] + ['id' => $id] : null; }
  public static function prov(string $id): string { return 'L' . $id; }
  /** Тести: вимкнені (`off`) боти — увімкнути (на стенді вмикає й `lb_base_<бот>` у config.php). */
  public static bool $forceOn = false;
  public static function ready(string $id): bool {
    $b = self::get($id); if (!$b || Cfg::get('lb_off_' . $id) === true) return false;
    if (!empty($b['off']) && !self::$forceOn && !Cfg::get('lb_base_' . $id)) return false;
    return $b['t'] === 'mail' ? Mail::on() : class_exists('DOMDocument');
  }
  /** Що бачить застосунок про бота (без секретів). */
  public static function pub(string $id): array {
    $b = self::get($id);
    return ['id' => $id, 't' => $b['t'], 'org' => $b['org'], 'site' => $b['site'] ?? null, 'kinds' => $b['kinds'], 'need' => $b['need'], 'hint' => $b['acc']['hint'] ?? null,
      'win' => $b['win'] ?? null, 'later' => !empty($b['later']), 'to' => is_string($b['to'] ?? null) ? $b['to'] : null, 'fmt' => $b['fmt'] ?? null, 'one' => !empty($b['one']),
      'serial' => !empty($b['serial']), 'ready' => self::ready($id)] + (isset($b['dists']) ? ['dists' => array_map(fn($k, $v) => [$k, $v[0], $v[1]], array_keys($b['dists']), $b['dists'])] : []);
  }

  // ---------- вікно подачі: поза ним «Відправити у фоні» ставить у чергу на відкриття (9:00 за Києвом) ----------
  public static function kyiv(int $ts): DateTimeImmutable { return (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone('Europe/Kyiv')); }
  /** → час, коли можна надсилати: зараз (у вікні) або початок найближчого вікна. */
  public static function openAt(?array $win, int $now): int {
    if (!$win) return $now;
    [$a, $b] = $win; $d = self::kyiv($now); $day = (int)$d->format('j'); $last = (int)$d->format('t');
    if ($a > $b) {   // вікно через межу місяця (28-го … 3-го): поза ним — 28-ше цього місяця
      if ($day >= min($a, $last) || $day <= $b) return $now;
      return max($now, $d->setDate((int)$d->format('Y'), (int)$d->format('n'), min($a, $last))->setTime(9, 0)->getTimestamp());
    }
    if ($day >= $a && $day <= min($b, $last)) return $now;
    $m = $day > min($b, $last) ? $d->modify('first day of next month') : $d;
    $start = $m->setDate((int)$m->format('Y'), (int)$m->format('n'), min($a, (int)$m->format('t')))->setTime(9, 0);
    return max($now, $start->getTimestamp());
  }

  // ---------- облікові дані людини: cab_creds (user_id, 'L'+бот) — extra: {місце: {acc, consentAt, lang, chk}}, secret: зашифроване {місце: {name, addr, phone, login, pass}} ----------
  private static function js(?string $s): array { $j = json_decode((string)$s, true); return is_array($j) ? $j : []; }
  private static function row(int $uid, string $id): ?array { return Db::one('SELECT * FROM cab_creds WHERE user_id = ? AND prov = ?', [$uid, self::prov($id)]); }
  /** Дані підключення для місця (з розшифрованими полями) або null. */
  public static function creds(int $uid, string $id, string $place): ?array {
    $r = self::row($uid, $id); if (!$r) return null;
    $ex = self::js($r['extra']); if (!isset($ex[$place])) return null;
    $sec = self::js((string)CabVault::dec((string)$r['secret']));
    return $ex[$place] + (array)($sec[$place] ?? []);
  }
  private static function save(int $uid, string $id, string $place, ?array $pub, ?array $sec): void {
    $r = self::row($uid, $id); $ex = $r ? self::js($r['extra']) : []; $s = $r ? self::js((string)CabVault::dec((string)$r['secret'])) : [];
    if ($pub === null) unset($ex[$place], $s[$place]); else { $ex[$place] = $pub; $s[$place] = $sec ?? []; }
    if (!$ex) { Db::q('DELETE FROM cab_creds WHERE user_id = ? AND prov = ?', [$uid, self::prov($id)]); return; }
    $e = json_encode($ex, JSON_UNESCAPED_UNICODE); $se = CabVault::enc(json_encode($s, JSON_UNESCAPED_UNICODE));
    if ($r) Db::q('UPDATE cab_creds SET extra = ?, secret = ?, checked_at = ? WHERE user_id = ? AND prov = ?', [$e, $se, Http::iso(), $uid, self::prov($id)]);
    else Db::q("INSERT INTO cab_creds (user_id, prov, login, secret, extra, state, info, created_at, checked_at) VALUES (?, ?, '', ?, ?, 'ok', NULL, ?, ?)", [$uid, self::prov($id), $se, $e, Http::iso(), Http::iso()]);
  }
  private static function botOr404(array $in): array {
    $id = (string)($in['bot'] ?? ''); $b = self::get($id);
    if (!$b) throw new HttpError(404, 'lb_unknown');
    return [$id, $b];
  }
  private static function placeId(array $in): string { return substr(preg_replace('/[^\w\-]/', '', (string)($in['place'] ?? '')), 0, 40) ?: 'p0'; }
  private static string $lang = 'uk';
  public static function h(string $k, array $v = []): string {
    $ru = self::$lang === 'ru';
    $s = [
      'consent' => $ru ? 'Чтобы отправлять показания самим, нужно ваше согласие — отметьте галочку.' : 'Щоб надсилати показання самим, потрібна ваша згода — поставте позначку.',
      'acc' => $ru ? 'Впишите лицевой счёт так, как на квитанции или в абонентской книжке: {hint}.' : 'Впишіть особовий рахунок так, як на квитанції чи в абонентській книжці: {hint}.',
      'acc0' => $ru ? 'Впишите лицевой счёт (цифры с квитанции).' : 'Впишіть особовий рахунок (цифри з квитанції).',
      'name' => $ru ? 'Впишите фамилию, имя и отчество владельца счёта.' : 'Впишіть прізвище, ім’я та по батькові власника рахунку.',
      'addr' => $ru ? 'Впишите адрес: улица, дом, квартира.' : 'Впишіть адресу: вулиця, будинок, квартира.',
      'phone' => $ru ? 'Впишите телефон — по нему с вами свяжется абонотдел, если что-то не так.' : 'Впишіть телефон — за ним з вами зв’яжеться абонвідділ, якщо щось не так.',
      'login' => $ru ? 'Впишите логин (e-mail) от кабинета.' : 'Впишіть логін (e-mail) від кабінету.',
      'pass' => $ru ? 'Впишите пароль от кабинета.' : 'Впишіть пароль від кабінету.',
      'off' => $ru ? 'Сейчас этот способ не работает — отправьте сами (кнопки ниже).' : 'Зараз цей спосіб не працює — надішліть самі (кнопки нижче).',
      'conn' => $ru ? 'Сначала подключите автоотправку.' : 'Спершу підключіть автовідправку.',
      'items' => $ru ? 'Нечего отправлять: нет показаний.' : 'Нічого надсилати: немає показань.',
      'no_job' => $ru ? 'Эта отправка уже не в очереди.' : 'Це надсилання вже не в черзі.',
      'down' => $ru ? 'Сайт не отвечал несколько раз подряд.' : 'Сайт не відповідав кілька разів поспіль.',
      'captcha' => $ru ? 'Сайт показал проверку «я не робот» — её мы не проходим. Отправьте сами.' : 'Сайт показав перевірку «я не робот» — її ми не проходимо. Надішліть самі.',
      'notfound' => $ru ? 'Сайт не нашёл такой лицевой счёт — проверьте цифры.' : 'Сайт не знайшов такий особовий рахунок — перевірте цифри.',
      'login_bad' => $ru ? 'Кабинет не пустил с этим логином и паролем.' : 'Кабінет не пустив із цим логіном і паролем.',
      'page' => $ru ? 'Страница сайта не такая, как мы ждали, — ничего не отправили. Отправьте сами; мы разберёмся.' : 'Сторінка сайту не така, як ми чекали, — нічого не надіслали. Надішліть самі; ми розберемося.',
      'fields' => $ru ? 'Не поняли, в какое поле какой счётчик, — ничего не отправили. Впишите номера счётчиков в их настройках или отправьте сами.' : 'Не зрозуміли, у яке поле який лічильник, — нічого не надіслали. Впишіть номери лічильників у їхніх налаштуваннях або надішліть самі.',
      'mail' => $ru ? 'Почта сервиса сейчас не работает.' : 'Пошта сервісу зараз не працює.',
      'one' => $ru ? 'Так можно передать только однозонный счётчик (одно число). Двухзонный передайте сами — кнопки ниже.' : 'Так можна передати лише однозонний лічильник (одне число). Двозонний передайте самі — кнопки нижче.',
      'dist' => $ru ? 'Выберите район — письмо уйдёт в отдел сбыта вашего района.' : 'Оберіть район — лист піде у відділ збуту вашого району.',
      'serial' => $ru ? 'Впишите номер счётчика в его настройках — {org} принимает показания только с номером счётчика.' : 'Впишіть номер лічильника в його налаштуваннях — {org} приймає показання лише з номером лічильника.',
    ][$k];
    foreach ($v as $a => $b) $s = str_replace('{' . $a . '}', (string)$b, $s);
    return $s;
  }
  private static function err(string $k, int $code = 422, array $v = []): HttpError { return new HttpError($code, 'lb_' . $k, ['human' => self::h($k, $v)]); }

  /** Рахунок у поля форми: «74-108-61» → [74, 108, 61] (стільки частин, скільки полів); одне поле — лише цифри. */
  public static function accParts(array $b, string $acc): ?array {
    $n = count($b['acc']['fields'] ?? []) ?: 1; $acc = trim($acc);
    if ($n === 1) { $d = preg_replace('/\D/', '', $acc); $need = (int)($b['acc']['digits'] ?? 0); return ($need ? strlen($d) === $need : strlen($d) >= 3 && strlen($d) <= 20) ? [$d] : null; }
    $p = preg_split('/\D+/', $acc, -1, PREG_SPLIT_NO_EMPTY);
    return count($p) === $n && max(array_map('strlen', $p)) <= 10 ? $p : null;
  }
  /** Перевірка полів людини → [pub (рахунок), sec (решта)]. */
  private static function input(array $b, array $in): array {
    $pub = []; $sec = [];
    foreach ($b['need'] as $f) {
      $v = trim(preg_replace('/\s+/u', ' ', (string)($in[$f] ?? '')));
      $ok = match ($f) {
        'dist' => isset($b['dists'][$v]),
        'acc' => self::accParts($b, $v) !== null,
        'name' => mb_strlen($v) >= 3 && mb_strlen($v) <= 80 && (bool)preg_match("/^[\p{L}'’ʼ.\- ]+$/u", $v),
        'addr' => mb_strlen($v) >= 5 && mb_strlen($v) <= 160,
        'phone' => (bool)preg_match('/^\+?[\d\s()\-]{9,18}$/', $v) && strlen(preg_replace('/\D/', '', $v)) >= 9,
        'login' => mb_strlen($v) >= 3 && mb_strlen($v) <= 120,
        'pass' => ($v = (string)($in[$f] ?? '')) !== '' && strlen($v) <= 120,
        default => false,
      };
      if (!$ok) throw self::err($f === 'acc' && !empty($b['acc']['hint']) ? 'acc' : ($f === 'acc' ? 'acc0' : $f), 422, ['hint' => $b['acc']['hint'] ?? '']);
      if ($f === 'acc' || $f === 'dist') $pub[$f] = $v; else $sec[$f] = $v;
    }
    return [$pub, $sec];
  }

  // ---------- API ----------
  /** GET /api/lb?bot=&place= — бот, підключення цього місця (свої дані — для заповнення форми; пароль — ніколи), черга. */
  public static function status(int $uid, array $q): array {
    [$id] = self::botOr404($q); $place = self::placeId($q); $c = self::creds($uid, $id, $place);
    $conn = $c ? array_filter(['dist' => $c['dist'] ?? null, 'acc' => $c['acc'] ?? null, 'name' => $c['name'] ?? null, 'addr' => $c['addr'] ?? null, 'phone' => $c['phone'] ?? null, 'login' => $c['login'] ?? null,
      'pass' => isset($c['pass']) ? true : null, 'at' => $c['consentAt'] ?? null, 'chk' => $c['chk'] ?? null], fn($v) => $v !== null) : null;
    $jobs = Db::q('SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? ORDER BY id DESC LIMIT 12', [$uid, self::prov($id)])->fetchAll();
    $pb = self::pub($id); if ($c && $pb['to'] === null && self::to(self::get($id), $c) !== '') $pb['to'] = self::to(self::get($id), $c);   // адреса району
    return ['bot' => $pb, 'conn' => $conn, 'jobs' => array_values(array_filter(array_map([self::class, 'pubJob'], $jobs), fn($j) => ($j['place'] ?? '') === $place))];
  }
  /** POST /api/lb/connect {bot, place, consent, acc?, name?, addr?, phone?, login?, pass?, lang} — зберегти й перевірити (дійти до форми, нічого не надіслати). */
  public static function connect(int $uid, array $in): array {
    self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk';
    [$id, $b] = self::botOr404($in); $place = self::placeId($in);
    if (!self::ready($id)) throw self::err($b['t'] === 'mail' ? 'mail' : 'off', 409);
    if (($in['consent'] ?? false) !== true) throw self::err('consent');
    $old = self::creds($uid, $id, $place) ?? [];
    if (in_array('pass', $b['need'], true) && (string)($in['pass'] ?? '') === '' && isset($old['pass'])) $in['pass'] = $old['pass'];   // пароль не міняли
    [$pub, $sec] = self::input($b, $in);
    self::limit($uid);
    $chk = ['at' => time(), 'ok' => true];
    if ($b['t'] !== 'mail') {
      try { $r = LbWalk::run($b, $pub + $sec, [], false); $chk += ['meters' => $r['meters'] ?? null]; }
      catch (HttpError $e) {
        $why = preg_replace('/^lb_/', '', $e->err);
        if (in_array($why, ['notfound', 'login_bad', 'captcha'], true)) { Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'lb_conn_' . $id . '_' . $why, null, Http::iso()]); throw $e; }
        $chk = ['at' => time(), 'ok' => false, 'why' => $why];   // сайт не відповів або незнайома сторінка — підключення зберігаємо, спробуємо при надсиланні
      }
    }
    self::save($uid, $id, $place, $pub + ['consentAt' => gmdate('c'), 'lang' => self::$lang, 'chk' => $chk], $sec);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'lb_conn_' . $id, null, Http::iso()]);
    return ['ok' => true] + self::status($uid, ['bot' => $id, 'place' => $place]);
  }
  /** POST /api/lb/forget {bot, place} — забути дані й згоду, скасувати чергу цього місця. */
  public static function forget(int $uid, array $in): array {
    [$id] = self::botOr404($in); $place = self::placeId($in);
    self::save($uid, $id, $place, null, null);
    foreach (Db::q("SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? AND status = 'queued'", [$uid, self::prov($id)])->fetchAll() as $j)
      if ((self::js($j['payload'])['place'] ?? '') === $place) self::finish((int)$j['id'], 'cancelled', ['why' => 'forgot']);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'lb_forget_' . $id, null, Http::iso()]);
    return ['ok' => true] + self::status($uid, ['bot' => $id, 'place' => $place]);
  }
  public static function items(array $raw): array {
    $out = [];
    foreach (array_slice($raw, 0, 6) as $it) {
      if (!is_array($it)) continue; $v = str_replace(',', '.', trim((string)($it['value'] ?? '')));
      if (!preg_match('/^\d{1,7}(?:\.\d{1,3})?$/', $v)) continue;
      $out[] = ['value' => $v, 'serial' => isset($it['serial']) && trim((string)$it['serial']) !== '' ? mb_substr(trim((string)$it['serial']), 0, 30) : null, 'name' => mb_substr(trim((string)($it['name'] ?? '')), 0, 40),
        'kind' => in_array($it['kind'] ?? null, ['cold', 'hot', 'elec', 'gas', 'heat'], true) ? $it['kind'] : null];
    }
    return $out;
  }
  /** POST /api/lb/queue {bot, place, rid, items, lang} — «Відправити у фоні»: зараз (cron за хвилину) або на відкриття вікна подачі. Те саме ще раз — не дублюємо. */
  public static function queue(int $uid, array $in): array {
    self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk';
    [$id, $b] = self::botOr404($in); $place = self::placeId($in);
    if (!self::ready($id)) throw self::err($b['t'] === 'mail' ? 'mail' : 'off', 409);
    $c = self::creds($uid, $id, $place); if (!$c) throw self::err('conn', 409);
    $items = self::items((array)($in['items'] ?? [])); if (!$items) throw self::err('items');
    if (!empty($b['one']) && count($items) !== 1) throw self::err('one');
    if (!empty($b['serial'])) foreach ($items as $x) if (($x['serial'] ?? null) === null) throw self::err('serial', 422, ['org' => $b['org']]);
    $rid = substr(preg_replace('/[^\w\-]/', '', (string)($in['rid'] ?? '')), 0, 40);
    $sig = fn(array $l) => implode('|', array_map(fn($x) => ($x['serial'] ?? '') . '=' . $x['value'], $l));
    foreach (Db::q("SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? AND status IN ('queued', 'sending', 'ok', 'sent') ORDER BY id DESC LIMIT 12", [$uid, self::prov($id)])->fetchAll() as $j) {
      $p = self::js($j['payload']); if (($p['place'] ?? '') === $place && $sig((array)($p['items'] ?? [])) === $sig($items)) return ['ok' => true, 'dup' => true, 'job' => self::pubJob($j)];
    }
    self::limit($uid);
    // з того ж місця раніше поставлене й ще не надіслане — замінюємо новими цифрами
    foreach (Db::q("SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? AND status = 'queued'", [$uid, self::prov($id)])->fetchAll() as $j) if ((self::js($j['payload'])['place'] ?? '') === $place) self::finish((int)$j['id'], 'cancelled', ['why' => 'replaced']);
    $at = self::openAt($b['win'] ?? null, time());
    Db::q("INSERT INTO cab_jobs (user_id, prov, acc, payload, status, result, tries, next_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', NULL, 0, ?, ?, ?)",
      [$uid, self::prov($id), mb_substr((string)($c['acc'] ?? ''), 0, 40), json_encode(['rid' => $rid, 'place' => $place, 'items' => $items, 'lang' => self::$lang], JSON_UNESCAPED_UNICODE), $at, Http::iso(), Http::iso()]);
    $job = self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [Db::id()]));
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'lb_queue_' . $id, null, Http::iso()]);
    if ($at > time() + 120) self::notify($uid, $id, $job);   // «надішлемо 25-го о 9:00»
    return ['ok' => true, 'job' => $job];
  }
  private static function mine(int $uid, array $in): array {
    $j = Db::one("SELECT * FROM cab_jobs WHERE id = ? AND user_id = ? AND prov LIKE 'L%'", [(int)($in['job'] ?? 0), $uid]);
    if (!$j || $j['status'] !== 'queued') throw new HttpError(409, 'lb_no_job', ['human' => self::h('no_job')] + ($j ? ['job' => self::pubJob($j)] : []));
    return $j;
  }
  /** POST /api/lb/cancel {job} */
  public static function cancel(int $uid, array $in): array { self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk'; $j = self::mine($uid, $in); self::finish((int)$j['id'], 'cancelled', ['why' => 'user']); return ['ok' => true, 'job' => self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]))]; }
  /** POST /api/lb/now {job} — у вікні подачі надіслати зараз, не чекаючи cron. */
  public static function now(int $uid, array $in): array {
    self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk'; $j = self::mine($uid, $in);
    $b = self::get(substr((string)$j['prov'], 1)); if ($b && self::openAt($b['win'] ?? null, time()) > time()) return ['ok' => true, 'job' => self::pubJob($j)];
    self::limit($uid); return ['ok' => true, 'job' => self::run($j)];
  }
  public static function limit(int $uid): void {
    try { RateLimit::hit('lb_user', (string)$uid); RateLimit::hit('lb_all', 'all'); }
    catch (HttpError $e) { throw new HttpError(429, 'rate_limited', ['human' => self::$lang === 'ru' ? 'Слишком часто — попробуйте через несколько минут.' : 'Занадто часто — спробуйте за кілька хвилин.'] + $e->extra); }
  }

  public static function pubJob(array $j): array {
    $p = self::js($j['payload']); $r = self::js($j['result']);
    return ['id' => (int)$j['id'], 'bot' => substr((string)$j['prov'], 1), 'rid' => $p['rid'] ?? null, 'place' => $p['place'] ?? null,
      'items' => array_map(fn($x) => ['name' => $x['name'], 'value' => $x['value'], 'kind' => $x['kind'] ?? null], (array)($p['items'] ?? [])),
      'status' => $j['status'], 'text' => $r['text'] ?? '', 'why' => $r['why'] ?? null, 'human' => $r['human'] ?? null,
      'at' => strtotime((string)$j['created_at']) ?: null, 'doneAt' => $r['doneAt'] ?? null, 'nextAt' => in_array($j['status'], ['queued', 'sending'], true) ? (int)$j['next_at'] : null];
  }
  private static function finish(int $id, string $st, array $res): void {
    Db::q('UPDATE cab_jobs SET status = ?, result = ?, next_at = 0, updated_at = ? WHERE id = ?', [$st, json_encode($res + ['doneAt' => time()], JSON_UNESCAPED_UNICODE), Http::iso(), $id]);
  }
  /** Надіслати одне з черги. Статуси: ok (сайт сказав «прийнято»), sent (лист пішов — підтвердження e-mail не дає), rejected, unknown, failed. */
  private static function run(array $j): array {
    $uid = (int)$j['user_id']; $id = substr((string)$j['prov'], 1); $b = self::get($id); $p = self::js($j['payload']);
    self::$lang = ($p['lang'] ?? '') === 'ru' ? 'ru' : 'uk';
    if (Db::q("UPDATE cab_jobs SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'queued'", [Http::iso(), $j['id']])->rowCount() !== 1) return self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]));
    $c = $b ? self::creds($uid, $id, (string)($p['place'] ?? '')) : null;
    if (!$b || !$c) self::finish((int)$j['id'], 'failed', ['why' => 'conn', 'human' => self::h('conn')]);
    elseif (!self::ready($id)) self::finish((int)$j['id'], 'failed', ['why' => 'off', 'human' => self::h($b['t'] === 'mail' ? 'mail' : 'off')]);
    else try {
      if ($b['t'] === 'mail') { $r = self::mail($uid, $b, $c, (array)$p['items']); self::finish((int)$j['id'], 'sent', ['text' => $r['text']]); }
      else {
        $r = LbWalk::run($b, $c, (array)$p['items'], true);
        self::finish((int)$j['id'], ['ok' => 'ok', 'err' => 'rejected'][$r['result']] ?? 'unknown', ['text' => $r['text'] ?? '']);
        self::last($id, ['at' => time(), 'res' => $r['result']]);
      }
    } catch (Throwable $e) {
      $why = $e instanceof HttpError ? preg_replace('/^lb_/', '', $e->err) : 'down';
      if ($e instanceof HttpError && isset($e->extra['skel'])) self::last($id, ['at' => time(), 'res' => $why, 'skel' => $e->extra['skel'], 'plan' => $e->extra['plan'] ?? null]);
      if ($why === 'down' && (int)$j['tries'] + 1 < 3) {
        Db::q("UPDATE cab_jobs SET status = 'queued', tries = tries + 1, next_at = ?, updated_at = ? WHERE id = ?", [time() + 900, Http::iso(), $j['id']]);
        return self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]));
      }
      $human = $e instanceof HttpError ? (string)($e->extra['human'] ?? '') : '';
      self::finish((int)$j['id'], 'failed', ['why' => $why, 'human' => mb_substr($human !== '' ? $human : self::h('down'), 0, 400)]);
    }
    $job = self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]));
    self::notify($uid, $id, $job);
    return $job;
  }
  /** Лист постачальнику: хто, рахунок, адреса, показання; Reply-To — e-mail людини (якщо є), щоб абонвідділ відповідав їй. */
  private static function mail(int $uid, array $b, array $c, array $items): array {
    $u = Db::one('SELECT email FROM users WHERE id = ?', [$uid]); $email = (string)($u['email'] ?? '');
    $to = self::to($b, $c); if ($to === '') throw self::err('dist');
    if (($b['fmt'] ?? '') === 'code') {   // лист читає програма постачальника: лише «код показник», без зайвого тексту
      $code = (string)(self::accParts($b, (string)($c['acc'] ?? ''))[0] ?? ''); $v = (string)preg_replace('/\..*$/', '', (string)$items[0]['value']);
      Mail::send(['to' => $to, 'subject' => $code . ' ' . $v, 'text' => $code . ' ' . $v, 'replyTo' => Mail::deliverable($email) ? $email : '', 'kind' => 'submit', 'user' => $uid]);
      return ['text' => 'e-mail → ' . $to];
    }
    $d = self::kyiv(time())->format('d.m.Y');
    if (($b['fmt'] ?? '') === 'line') {   // взірець постачальника: «номер особового рахунку, адреса, номер лічильника-кінцевий показник» — рядок на лічильник
      $acc = trim((string)($c['acc'] ?? '')); $addr = trim((string)($c['addr'] ?? ''));
      $rows = implode("\n", array_map(fn($x) => $acc . ', ' . $addr . ', ' . $x['serial'] . '-' . preg_replace('/\..*$/', '', (string)$x['value']), $items));
      $text = "Доброго дня!\n\nПоказання лічильників води станом на $d:\n\n" . $rows .
        "\n\nЛист надіслано на прохання абонента сервісом «Лічильники» (" . Cfg::appUrl() . ")." . (Mail::deliverable($email) ? " Відповідь — на адресу абонента: $email." : '');
      Mail::send(['to' => $to, 'subject' => 'Показання лічильників води — о/р ' . $acc, 'text' => $text, 'replyTo' => Mail::deliverable($email) ? $email : '', 'kind' => 'submit', 'user' => $uid]);
      return ['text' => 'e-mail → ' . $to];
    }
    $lines = implode("\n", array_map(fn($x) => '— ' . ($x['name'] ?: 'лічильник') . ($x['serial'] ? ' № ' . $x['serial'] : '') . ': ' . $x['value'] . ' м³', $items));
    $text = "Доброго дня!\n\nПередаю показання лічильників води станом на $d.\n\nОсобовий рахунок: " . ($c['acc'] ?? '') . "\nАбонент: " . ($c['name'] ?? '') .
      "\nАдреса: " . ($c['addr'] ?? '') . "\nТелефон: " . ($c['phone'] ?? '') . "\n\n" . $lines .
      "\n\nЛист надіслано на прохання абонента сервісом «Лічильники» (" . Cfg::appUrl() . ")." . (Mail::deliverable($email) ? " Відповідь — на адресу абонента: $email." : ' Питання — за телефоном абонента.');
    Mail::send(['to' => $to, 'subject' => 'Показання лічильників води — о/р ' . ($c['acc'] ?? ''), 'text' => $text, 'replyTo' => Mail::deliverable($email) ? $email : '', 'kind' => 'submit', 'user' => $uid]);
    return ['text' => 'e-mail → ' . $to];
  }
  /** cron: строк черги настав — надсилаємо (не більше 2 за хвилину: кожне — свій захід на сайт). */
  public static function cron(?int $now = null): array {
    $out = [];
    try { $rows = Db::q("SELECT * FROM cab_jobs WHERE prov LIKE 'L%' AND status = 'queued' AND next_at <= ? ORDER BY next_at LIMIT 2", [$now ?? time()])->fetchAll(); } catch (Throwable $e) { return []; }
    foreach ($rows as $j) { $r = self::run($j); $out[] = [(int)$j['id'], $r['status']]; }
    return $out;
  }
  /** Telegram: «📝 надішлемо …», «✅ прийнято», «📨 лист надіслано», «❌ / ⚠️ / ⏳». */
  public static function notify(int $uid, string $id, array $job): void {
    $tg = Db::one("SELECT external_id FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$uid]); if (!$tg || !Cfg::get('bot_token')) return;
    $b = self::get($id); $ru = self::$lang === 'ru'; $org = $b['org'] ?? '';
    $lines = implode("\n", array_map(fn($x) => '• ' . ($x['name'] ?: ($ru ? 'счётчик' : 'лічильник')) . ' — ' . $x['value'], $job['items']));
    $tail = $job['text'] !== '' && $job['status'] !== 'sent' ? "\n\n" . ($ru ? 'Ответ сайта: ' : 'Відповідь сайту: ') . '«' . mb_substr($job['text'], 0, 300) . '»' : '';
    switch ($job['status']) {
      case 'queued':
        $when = self::kyiv((int)$job['nextAt'])->format('d.m H:i');
        $txt = ($ru ? "📝 Показания поставлены в очередь — $org примет их с начала срока подачи. Отправим $when:\n" : "📝 Показання в черзі — $org приймає їх із початку строку подачі. Надішлемо $when:\n") . $lines .
          ($ru ? "\n\nПередумали — «Отменить» в «Счётчиках»." : "\n\nПередумали — «Скасувати» в «Лічильниках»."); break;
      case 'ok': $txt = ($ru ? "✅ $org — сайт принял показания:\n" : "✅ $org — сайт прийняв показання:\n") . $lines . $tail . (!empty($b['later']) ? ($ru ? "\n\nИх проверит оператор — на сайте появятся позже." : "\n\nЇх перевірить оператор — на сайті з’являться пізніше.") : ''); break;
      case 'sent': $to = preg_replace('/^e-mail → /u', '', (string)$job['text']); $txt = ($ru ? "📨 Отправили показания письмом в $org ($to):\n" : "📨 Надіслали показання листом у $org ($to):\n") . $lines . ($ru ? "\n\nПодтверждения по e-mail поставщик обычно не присылает — сверяйте с квитанцией." : "\n\nПідтвердження на e-mail постачальник зазвичай не надсилає — звіряйте з квитанцією."); break;
      case 'rejected': $txt = ($ru ? "❌ $org — сайт не принял показания:\n" : "❌ $org — сайт не прийняв показання:\n") . $lines . $tail . ($ru ? "\n\nОткройте «Счётчики» — исправьте и отправьте снова." : "\n\nВідкрийте «Лічильники» — виправте й надішліть знову."); break;
      case 'unknown': $txt = ($ru ? "⏳ Отправили в $org, но сайт не сказал, принял ли:\n" : "⏳ Надіслали в $org, але сайт не сказав, чи прийняв:\n") . $lines . $tail; break;
      case 'failed': $txt = ($ru ? "⚠️ Не отправили показания в $org.\n" : "⚠️ Не надіслали показання в $org.\n") . ($job['human'] ?: '') . ($ru ? "\n\nОткройте «Счётчики» — там все способы отправить самому." : "\n\nВідкрийте «Лічильники» — там усі способи надіслати самому."); break;
      default: return;
    }
    $p = ['chat_id' => $tg['external_id'], 'text' => $txt];
    if (Cfg::appUrlKnown()) $p['reply_markup'] = ['inline_keyboard' => [[['text' => $ru ? 'Открыть «Счётчики»' : 'Відкрити «Лічильники»', 'web_app' => ['url' => Cfg::appUrl() . '?go=' . (in_array('elec', (array)($b['kinds'] ?? []), true) ? 'elec' : 'water-cold') . ($job['place'] ? '&place=' . rawurlencode((string)$job['place']) : '')]]]]];
    try { Telegram::call('sendMessage', $p); } catch (Throwable $e) { /* не дійшло — статус видно в застосунку */ }
  }
  // ---------- проба «не знайдено» (як у Водоканалу): вигаданий рахунок, лише читання — чи веде нас живий сайт тим шляхом, що й стенд ----------
  // Раз на PROBE_V для кожного form-бота (cron, хвилина % 10 === 9). Підсумок — /api/health → lbot.<бот>.probe: notfound — шлях працює
  // (сайт прийняв рахунок формою й відповів «не знайдено»); page/acc_again — форму веде скрипт сторінки, треба дивитися (каркас — без тексту й цифр).
  const PROBE_V = 2, PROBE_ACC = ['mtve' => '0-0-0'];
  public static function probe(): ?array {
    $j = json_decode((string)@file_get_contents(self::lastFile()), true); $j = is_array($j) ? $j : [];
    foreach (self::BOTS as $id => $b) {
      if ($b['t'] !== 'form' || !isset(self::PROBE_ACC[$id]) || (int)($j[$id]['probe']['v'] ?? 0) === self::PROBE_V) continue;
      $res = ['v' => self::PROBE_V, 'at' => time()];
      try { $r = LbWalk::run(self::get($id), ['acc' => self::PROBE_ACC[$id]], [], false); $res['res'] = 'form'; $res['meters'] = $r['meters'] ?? null; }
      catch (HttpError $e) { $res['res'] = preg_replace('/^lb_/', '', $e->err); if (isset($e->extra['why'])) $res['why'] = $e->extra['why']; if (isset($e->extra['skel'])) $res['skel'] = mb_substr((string)$e->extra['skel'], 0, 3000); }
      catch (Throwable $e) { $res['res'] = 'error'; $res['err'] = mb_substr(get_class($e) . ': ' . preg_replace('/\d/', '#', $e->getMessage()), 0, 160); }
      $j = json_decode((string)@file_get_contents(self::lastFile()), true); $j = is_array($j) ? $j : [];
      $j[$id] = array_merge((array)($j[$id] ?? []), ['probe' => $res]); @file_put_contents(self::lastFile(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX);
      return [$id, $res['res']];
    }
    return null;
  }
  // ---------- для /admin і /api/health: останні заходи роботів (без рахунків і цифр) ----------
  public static function lastFile(): string { return Cfg::data() . '/cache/lbot_last.json'; }
  public static function last(string $id, array $x): void { $j = json_decode((string)@file_get_contents(self::lastFile()), true); $j = is_array($j) ? $j : []; $j[$id] = $x + (isset($j[$id]['probe']) ? ['probe' => $j[$id]['probe']] : []); @file_put_contents(self::lastFile(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX); }
  public static function summary(): array {
    $jobs = []; $conn = [];
    try {
      foreach (Db::q("SELECT prov, status, COUNT(*) AS c FROM cab_jobs WHERE prov LIKE 'L%' GROUP BY prov, status")->fetchAll() as $x) $jobs[substr($x['prov'], 1)][$x['status']] = (int)$x['c'];
      foreach (Db::q("SELECT prov, COUNT(*) AS c FROM cab_creds WHERE prov LIKE 'L%' GROUP BY prov")->fetchAll() as $x) $conn[substr($x['prov'], 1)] = (int)$x['c'];
    } catch (Throwable $e) {}
    $last = json_decode((string)@file_get_contents(self::lastFile()), true);
    $bots = []; foreach (self::BOTS as $id => $b) $bots[$id] = ['t' => $b['t'], 'ready' => self::ready($id)] + (!empty($b['off']) ? ['off' => $b['off']] : []) + [ 'conn' => $conn[$id] ?? 0, 'jobs' => (object)($jobs[$id] ?? [])] + (is_array($last) && isset($last[$id]) ? ['last' => array_diff_key($last[$id], ['skel' => 1, 'probe' => 1])] + (isset($last[$id]['probe']) ? ['probe' => $last[$id]['probe']] : []) : []);
    return $bots;
  }
}

/** Прохід сайту: [вхід або рахунок] → [посилання «передати показання»] → форма показань → (надіслати). Розбір полів — RelayForm (роль за назвою й підписом). */
final class LbWalk {
  const LINK_RE = '/передат\S*\s+(?:поточн\S*\s+)?показ|внести\s+показ|подат\S*\s+показ|передать\s+показ|показ\S*\s+(?:водо)?лічильн|показания\s+счетчик/u';
  /** → ['result' => ready|ok|err|unknown, 'meters' => n, 'text'?]. $send=false — лише дійти до форми показань. Не вийшло — HttpError lb_* (нічого не надіслано). */
  public static function run(array $b, array $c, array $items, bool $send): array {
    // локальний стенд (tests/lb-mock): config.php 'lb_base_<бот>' => 'http://127.0.0.1:8096/'
    $base = isset($b['id']) ? (string)(Cfg::get('lb_base_' . $b['id']) ?: '') : '';
    if ($base !== '') { $b['start'] = $base; $b['host'] = '~^' . preg_quote((string)parse_url($base, PHP_URL_HOST), '~') . '$~'; }
    $w = new CabWeb($b['host'], 25.0);
    $r = self::get($w, $b['start']);
    if ($b['t'] === 'cab') $r = self::login($w, $b, $c, $r);
    else $r = self::account($w, $b, $c, $r);
    for ($hop = 0; $hop < 3; $hop++) {
      $f = self::readForm($r['body']);
      if ($f) break;
      $link = self::link($r['body'], $r['url'], $w);
      if (!$link) throw self::page('no_form', $r['body']);
      $r = self::get($w, $link);
    }
    if (empty($f)) throw self::page('no_form', $r['body']);
    [$form, $fields, $read] = $f;
    if (!$send) return ['result' => 'ready', 'meters' => count($read)];
    $pairs = self::fill($fields, $read, $items, $r['body']);
    $act = trim((string)$form->getAttribute('action')); $action = CabWeb::abs($act !== '' ? $act : $r['url'], $r['url']);
    if (!$w->sameSite($action)) throw self::page('offsite', $r['body']);
    $post = strtolower($form->getAttribute('method') ?: 'get') === 'post';
    $s = $post ? $w->req('POST', $action, $w->encode($pairs), ['Content-Type: application/x-www-form-urlencoded', 'Referer: ' . $r['url']])
      : $w->req('GET', $action . (str_contains($action, '?') ? '&' : '?') . $w->encode($pairs));
    if ((int)$s['code'] === 0 || (int)$s['code'] >= 500) return ['result' => 'unknown', 'text' => ''];   // POST не повторюємо — могли й зберегти
    $v = RelayForm::verdict($s);
    return ['result' => match ($v['kind']) { 'ok' => 'ok', 'err' => 'err', default => 'unknown' }, 'text' => (string)($v['msg'] ?? ''), 'meters' => count($read)];
  }
  private static function get(CabWeb $w, string $url): array {
    $r = $w->req('GET', $url);
    if ((int)$r['code'] === 0 || (int)$r['code'] >= 500) throw new HttpError(502, 'lb_down');
    self::guard($r);
    return $r;
  }
  /** Капча / перевірка Cloudflare — стоп: не обходимо. */
  private static function guard(array $r): void {
    $cp = CabWeb::captcha((string)$r['body'], (int)$r['code']);
    if ($cp['widget'] || $cp['cf'] || CabWeb::cfKind((string)$r['body'], (int)$r['code'], (array)($r['h'] ?? []))) throw new HttpError(409, 'lb_captcha', ['human' => self::hum('captcha')]);
    if ((int)$r['code'] >= 400) throw new HttpError(502, 'lb_down');
  }
  private static function hum(string $k): string { return LocalBot::h($k); }
  /** Незнайома сторінка: каркас без тексту й цифр — у /admin (LocalBot::last). */
  private static function page(string $why, string $html, array $plan = []): HttpError {
    return new HttpError(422, 'lb_page', ['human' => self::hum('page'), 'why' => $why, 'skel' => RelayForm::skel($html), 'plan' => $plan ?: null]);
  }
  /** Форма з полями рахунку (за назвами з налаштувань бота) → надіслати рахунок. */
  private static function account(CabWeb $w, array $b, array $c, array $r): array {
    $names = (array)($b['acc']['fields'] ?? []); $parts = LocalBot::accParts($b, (string)($c['acc'] ?? ''));
    if (!$names || !$parts) throw new HttpError(422, 'lb_acc0', ['human' => self::hum('notfound')]);
    $x = CabWeb::dom($r['body']); $form = null;
    foreach ($x->query('//form') as $f) { if (!$f instanceof DOMElement) continue; $have = array_column(RelayForm::fields($x, $f), 'n'); if (!array_diff($names, $have)) { $form = $f; break; } }
    if (!$form) throw self::page('no_acc_form', $r['body']);
    $pairs = []; $vals = array_combine($names, $parts);
    foreach (RelayForm::fields($x, $form) as $o) {
      if ($o['n'] === '') continue;
      if (isset($vals[$o['n']])) { $pairs[] = [$o['n'], $vals[$o['n']]]; continue; }
      if (str_starts_with($o['type'], 'submit')) { if ($o['type'] === 'submit:submit') $pairs[] = [$o['n'], $o['v']]; continue; }
      if (in_array($o['type'], ['checkbox', 'radio'], true)) { if (!empty($o['checked'])) $pairs[] = [$o['n'], $o['v'] !== '' ? $o['v'] : 'on']; continue; }
      if ($o['type'] === 'password') throw self::page('acc_pass', $r['body']);
      $pairs[] = [$o['n'], $o['v']];
    }
    $act = trim((string)$form->getAttribute('action')); $action = CabWeb::abs($act !== '' ? $act : $r['url'], $r['url']);
    $post = strtolower($form->getAttribute('method') ?: 'get') === 'post';
    $base = preg_replace('/[?#].*$/', '', $action);
    $s = $post ? $w->req('POST', $action, $w->encode($pairs), ['Content-Type: application/x-www-form-urlencoded', 'Referer: ' . $r['url']]) : $w->req('GET', $base . '?' . $w->encode($pairs));
    if ((int)$s['code'] === 0 || (int)$s['code'] >= 500) throw new HttpError(502, 'lb_down');
    self::guard($s);
    if (self::notFound($s['body']) && !self::readForm($s['body'])) throw new HttpError(422, 'lb_notfound', ['human' => self::hum('notfound')]);
    // та сама форма рахунку знову і нічого більше — сайт рахунок не прийняв (або форму веде скрипт сторінки)
    $x2 = CabWeb::dom($s['body']); $again = false;
    foreach ($x2->query('//form') as $f) if ($f instanceof DOMElement && !array_diff($names, array_column(RelayForm::fields($x2, $f), 'n'))) $again = true;
    if ($again && !self::readForm($s['body']) && !self::link($s['body'], $s['url'], $w)) throw self::page('acc_again', $s['body']);
    return $s;
  }
  /** Звичайна HTML-форма входу (логін + пароль) → увійти. */
  private static function login(CabWeb $w, array $b, array $c, array $r): array {
    if (!empty($b['login'])) $r = self::get($w, $b['login']);
    $x = CabWeb::dom($r['body']); $form = null;
    foreach ($x->query('//form') as $f) if ($f instanceof DOMElement && in_array('password', array_column(RelayForm::fields($x, $f), 'type'), true)) { $form = $f; break; }
    if (!$form) throw self::page('no_login', $r['body']);
    $pairs = []; $userSet = false;
    foreach (RelayForm::fields($x, $form) as $o) {
      if ($o['n'] === '') continue; $t = $o['type'];
      if ($t === 'password') { $pairs[] = [$o['n'], (string)($c['pass'] ?? '')]; continue; }
      if (!$userSet && in_array($t, ['text', 'email', 'tel'], true)) { $pairs[] = [$o['n'], (string)($c['login'] ?? '')]; $userSet = true; continue; }
      if (str_starts_with($t, 'submit')) { if ($t === 'submit:submit') $pairs[] = [$o['n'], $o['v']]; continue; }
      if (in_array($t, ['checkbox', 'radio'], true)) { if (!empty($o['checked'])) $pairs[] = [$o['n'], $o['v'] !== '' ? $o['v'] : 'on']; continue; }
      $pairs[] = [$o['n'], $o['v']];
    }
    $act = trim((string)$form->getAttribute('action')); $action = CabWeb::abs($act !== '' ? $act : $r['url'], $r['url']);
    $s = $w->req('POST', $action, $w->encode($pairs), ['Content-Type: application/x-www-form-urlencoded', 'Referer: ' . $r['url']]);
    if ((int)$s['code'] === 0 || (int)$s['code'] >= 500) throw new HttpError(502, 'lb_down');
    self::guard($s);
    if (preg_match('/type=["\']?password/i', $s['body']) && !self::readForm($s['body'])) throw new HttpError(422, 'lb_login_bad', ['human' => self::hum('login_bad')]);
    return $s;
  }
  private static function notFound(string $html): bool {
    $t = mb_strtolower(CabWeb::sp(strip_tags(preg_replace('~<(script|style)\b.*?</\1>~is', ' ', $html))));
    return (bool)preg_match('/не\s+знайден|не\s+знайдено|не\s+найден|невірн\S*\s+(?:код|рахун|номер)|неверн\S*\s+(?:код|сч[её]т|номер)|абонент\S*\s+не\s+(?:існу|знайд)|немає\s+такого/u', $t);
  }
  /** Форма з полями показань → [DOMElement форма, поля, поля показань]. Форма входу (пароль) — не наша. */
  public static function readForm(string $html): ?array {
    if (!preg_match('/<form\b/i', $html)) return null;
    $x = CabWeb::dom($html); $best = null;
    foreach ($x->query('//form') as $f) {
      if (!$f instanceof DOMElement) continue; $fs = RelayForm::fields($x, $f);
      if (in_array('password', array_column($fs, 'type'), true)) continue;
      // поле без підпису в рядку таблиці («Лічильник № … | [  ]») — роль за текстом рядка
      foreach ($fs as $i => $o) if ($o['role'] === null && $o['n'] !== '' && in_array($o['type'], ['text', 'number', 'tel'], true)) {
        $rr = RelayForm::role($o['n'], mb_strtolower(self::around($html, $o['n']))); if (in_array($rr, ['all', 'day', 'night', 'peak', 'half'], true)) $fs[$i]['role'] = $rr;
      }
      $read = array_values(array_filter($fs, fn($o) => in_array($o['role'], ['all', 'day', 'night', 'peak', 'half'], true) && in_array($o['type'], ['text', 'number', 'tel'], true) && $o['n'] !== ''));
      if ($read && (!$best || count($read) > count($best[2]))) $best = [$f, $fs, $read];
    }
    return $best;
  }
  /** Посилання «Передати показання» на тому ж сайті. */
  private static function link(string $html, string $url, CabWeb $w): ?string {
    $x = CabWeb::dom($html);
    foreach ($x->query('//a[@href]') as $a) {
      if (!$a instanceof DOMElement) continue; $t = mb_strtolower(CabWeb::sp($a->textContent . ' ' . $a->getAttribute('title')));
      $h = trim((string)$a->getAttribute('href')); if ($h === '' || str_starts_with($h, '#') || preg_match('/^(javascript|mailto|tel):/i', $h)) continue;
      if (preg_match(self::LINK_RE, $t)) { $u = CabWeb::abs($h, $url); if ($w->sameSite($u)) return $u; }
    }
    return null;
  }
  /** Текст навколо поля (підпис, рядок таблиці) — щоб знайти номер лічильника. */
  public static function around(string $html, string $name): string {
    $x = CabWeb::dom($html);
    foreach ($x->query("//*[@name='" . str_replace("'", '', $name) . "']") as $e) {
      $t = ''; $id = $e instanceof DOMElement ? (string)$e->getAttribute('id') : '';
      if ($id !== '') foreach ($x->query("//label[@for='" . str_replace("'", '', $id) . "']") as $l) $t .= ' ' . $l->textContent;
      for ($p = $e->parentNode, $i = 0; $p instanceof DOMElement && $i < 4; $p = $p->parentNode, $i++) {
        $s = CabWeb::sp($p->textContent); if (mb_strlen($s) > 300) break; $t .= ' ' . $s;
        if (in_array(strtolower($p->nodeName), ['tr', 'li', 'fieldset'], true)) break;
      }
      return $t . ' ' . $name;
    }
    return $name;
  }
  /** Показання → поля. Один лічильник і одне поле — просто; кілька — за номером лічильника в підписі/рядку, потім за видом (холодна/гаряча). Неоднозначно — стоп. */
  public static function fill(array $fields, array $read, array $items, string $html): array {
    if (!$items) throw new HttpError(422, 'lb_items');
    $map = [];   // ім'я поля → значення
    if (count($read) === 1 && count($items) === 1) $map[$read[0]['n']] = $items[0]['value'];
    else {
      $ctx = []; foreach ($read as $o) $ctx[$o['n']] = mb_strtolower(self::around($html, $o['n']));
      $left = $items;
      foreach ($left as $k => $it) {
        $sd = preg_replace('/\D/', '', (string)($it['serial'] ?? '')); if (strlen($sd) < 4) continue;
        $hit = array_keys(array_filter($ctx, fn($t, $n) => !isset($map[$n]) && str_contains(preg_replace('/\D/', '', $t), $sd), ARRAY_FILTER_USE_BOTH));
        if (count($hit) === 1) { $map[$hit[0]] = $it['value']; unset($left[$k]); }
      }
      foreach (['cold' => '/холодн/u', 'hot' => '/гаряч|горяч/u'] as $kind => $re) {
        $its = array_filter($left, fn($it) => ($it['kind'] ?? null) === $kind);
        $fs = array_keys(array_filter($ctx, fn($t, $n) => !isset($map[$n]) && preg_match($re, $t), ARRAY_FILTER_USE_BOTH));
        if (count($its) === 1 && count($fs) === 1) { $map[$fs[0]] = reset($its)['value']; unset($left[array_key_first($its)]); }
      }
      if ($left) throw new HttpError(422, 'lb_fields', ['human' => self::hum('fields'), 'skel' => RelayForm::skel($html)]);
    }
    $pairs = [];
    foreach ($fields as $o) {
      $n = $o['n']; $t = $o['type']; if ($n === '') continue;
      if (isset($map[$n])) { $pairs[] = [$n, $map[$n]]; continue; }
      if (str_starts_with($t, 'submit')) { if ($t === 'submit:submit') $pairs[] = [$n, $o['v']]; continue; }
      if (in_array($t, ['checkbox', 'radio'], true)) { if (!empty($o['checked']) || $o['role'] === 'consent') $pairs[] = [$n, $o['v'] !== '' ? $o['v'] : 'on']; continue; }
      // поле показань, яке нам не дісталося (лічильник, якого в людини немає в застосунку) — обов'язкове: стоп; ні — лишаємо, як є
      if (in_array($o['role'], ['all', 'day', 'night', 'peak', 'half'], true) && $o['req']) throw new HttpError(422, 'lb_fields', ['human' => self::hum('fields'), 'skel' => RelayForm::skel($html)]);
      $pairs[] = [$n, $o['v']];
    }
    return $pairs;
  }
}
