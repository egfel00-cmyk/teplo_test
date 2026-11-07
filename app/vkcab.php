<?php
// Кабинет Водоканала billing.vodokanal.kharkov.ua (Yii2, ведёт КП «ХТМ» філія «Харківзбут»): «Вхід без реєстрації» —
// особовий рахунок + прізвище → форма показань. Снято 04.11.2026 в Chrome владельца (только просмотр):
//   /login: form#no-login-form → POST /get-form-send-indications, поля _csrf-frontend, NoLoginForm[acc], NoLoginForm[fam]; капчи нет;
//   дальше (по js/common.js сайта): form#send-counters-form, у каждого лічильника DynamicModel[newIndication…], дата — select
//   DynamicModel[dataIndication…] (сайт выставляет одну дату всем).
// Человек нажимает «Відправити через сайт Водоканалу» и подтверждает экран «Перевірте» — тогда наш сервер (Водоканал его пускает
// с 04.11.2026, VkStatus) делает то же, что браузер: открывает /login (cookie + CSRF), вводит рахунок и прізвище, заполняет показания
// и отправляет. Сам, без нажатия, — никогда. Рахунок и прізвище приходят из приложения в каждом запросе и у нас не хранятся.
// Структура страниц, которую увидели (без личных данных: цифры замаскированы), — журнал SITE_DATA/cache/vkcab_log.json, /admin.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class VkCab {
  const BASE = 'https://billing.vodokanal.kharkov.ua';
  /** Ответ сайта «рахунок не знайдено» (свои слова Водоканала). */
  const NF_RE = '/не\s*коректн|некоректн|невірн|неверн|не\s+знайден|не\s+найден|не\s+значат|не\s+співпада|не\s+совпада|не\s+існу|не\s+существ|не\s+відповіда|не\s+соответств/iu';
  /** В тестах: fn(string $method, string $url, ?string $body, string $cookie): ['code', 'body', 'cookies' => [Set-Cookie…], 'location' => ?string, 'err' => ?string] */
  public static $http = null;
  public static function base(): string { return rtrim((string)Cfg::get('vk_cab_base', self::BASE), '/'); }
  /** Можно ли отправлять через кабинет: есть разбор HTML (php-xml) и не выключено в config.php ('vk_cab_send' => false). */
  public static function ready(): bool { return class_exists('DOMDocument') && Cfg::get('vk_cab_send', true) !== false; }
  public static function logFile(): string { return Cfg::data() . '/cache/vkcab_log.json'; }
  public static function log(): array { $j = json_decode((string)@file_get_contents(self::logFile()), true); return is_array($j) ? $j : []; }

  // ---------- что приходит из приложения ----------
  public static function input(array $in): array {
    $acc = preg_replace('/\D/', '', (string)($in['acc'] ?? '')); $fam = trim(preg_replace('/\s+/u', ' ', (string)($in['fam'] ?? '')));
    if (strlen($acc) < 3 || strlen($acc) > 14) throw new HttpError(422, 'bad_acc', ['human' => self::h('acc')]);
    if (mb_strlen($fam) < 2 || mb_strlen($fam) > 20 || !preg_match("/^[\p{L}'’ʼ\- ]+$/u", $fam)) throw new HttpError(422, 'bad_fam', ['human' => self::h('fam')]);
    return [$acc, $fam];
  }
  private static $lang = 'uk';
  public static function lang(string $l): void { self::$lang = $l === 'ru' ? 'ru' : 'uk'; }
  private static function h(string $k, array $p = []): string {
    $ru = self::$lang === 'ru';
    $m = [
      'acc' => $ru ? 'Впишите лицевой счёт Водоканала — цифры, как в квитанции.' : 'Впишіть особовий рахунок Водоканалу — цифри, як у квитанції.',
      'fam' => $ru ? 'Впишите фамилию владельца счёта, как в квитанции (до 20 букв, без инициалов).' : 'Впишіть прізвище власника рахунку, як у квитанції (до 20 літер, без ініціалів).',
      'down' => $ru ? 'Сайт Водоканала сейчас не отвечает. Попробуйте позже или отправьте через бот Водоканала.' : 'Сайт Водоканалу зараз не відповідає. Спробуйте пізніше або надішліть через бот Водоканалу.',
      'nodom' => $ru ? 'Отправка через сайт Водоканала на нашем сервере ещё не включена. Отправьте через бот Водоканала.' : 'Надсилання через сайт Водоканалу на нашому сервері ще не ввімкнене. Надішліть через бот Водоканалу.',
      'notfound' => $ru ? 'Сайт Водоканала не принял счёт {a} с фамилией «{f}». Проверьте по квитанции лицевой счёт и фамилию владельца — по-украински, без инициалов. Если всё верно, возможно, на счёте не числятся счётчики — тогда отправьте через бот Водоканала.' : 'Сайт Водоканалу не прийняв рахунок {a} з прізвищем «{f}». Перевірте за квитанцією особовий рахунок і прізвище власника — українською, без ініціалів. Якщо все вірно, можливо, на рахунку не значаться лічильники — тоді надішліть через бот Водоканалу.',
      'ukr' => $ru ? 'В фамилии есть русские буквы (ы, э, ъ, ё) — впишите её по-украински, как в квитанции.' : 'У прізвищі є російські літери (ы, э, ъ, ё) — впишіть його українською, як у квитанції.',
      'changed' => $ru ? 'Сайт Водоканала показал страницу, которую мы не узнали (возможно, он изменился). Отправьте через бот Водоканала — мы уже видим проблему.' : 'Сайт Водоканалу показав сторінку, яку ми не впізнали (можливо, він змінився). Надішліть через бот Водоканалу — ми вже бачимо проблему.',
      'items' => $ru ? 'Нечего отправлять: нет показаний для счётчиков Водоканала.' : 'Нічого надсилати: немає показань для лічильників Водоканалу.',
      'mismatch' => $ru ? 'На сайте Водоканала изменился список счётчиков. Проверьте ещё раз, какой счётчик какой.' : 'На сайті Водоканалу змінився список лічильників. Перевірте ще раз, який лічильник який.',
      'busy' => $ru ? 'Слишком много попыток. Подождите немного и попробуйте снова.' : 'Забагато спроб. Зачекайте трохи й спробуйте знову.',
      'less' => $ru ? 'Показание «{n}» меньше, чем Водоканал уже знает ({p}) — не отправили. Проверьте цифры.' : 'Показання «{n}» менше, ніж Водоканал уже знає ({p}) — не надіслали. Перевірте цифри.',
      'which' => $ru ? 'Не поняли, какой счётчик на сайте Водоканала какой. Отправьте кнопкой «Проверить» — там можно выбрать.' : 'Не зрозуміли, який лічильник на сайті Водоканалу який. Надішліть через «Перевірити» — там можна вибрати.',
    ][$k];
    foreach ($p as $a => $b) $m = str_replace('{' . $a . '}', (string)$b, $m);
    return $m;
  }

  // ---------- HTTP: свой cookie-jar, редиректы только внутри сайта Водоканала ----------
  private static array $jar = []; private static array $steps = []; private static float $t0 = 0;
  public static function abs(string $u, string $from): string {
    if (preg_match('~^https?://~i', $u)) return $u;
    $p = parse_url($from); $root = ($p['scheme'] ?? 'https') . '://' . ($p['host'] ?? '') . (isset($p['port']) ? ':' . $p['port'] : '');
    if (str_starts_with($u, '//')) return ($p['scheme'] ?? 'https') . ':' . $u;
    if (str_starts_with($u, '/')) return $root . $u;
    $dir = preg_replace('~/[^/]*$~', '/', (string)($p['path'] ?? '/')); return $root . $dir . $u;
  }
  private static function sameSite(string $url): bool {
    $a = parse_url(self::base()); $b = parse_url($url);
    return strcasecmp((string)($a['host'] ?? ''), (string)($b['host'] ?? '')) === 0 && (int)($a['port'] ?? 0) === (int)($b['port'] ?? 0);
  }
  private static function once(string $method, string $url, ?string $body): array {
    $cookie = implode('; ', array_map(fn($k, $v) => $k . '=' . $v, array_keys(self::$jar), self::$jar));
    if (self::$http) $r = (self::$http)($method, $url, $body, $cookie) + ['cookies' => [], 'location' => null, 'err' => null];
    else {
      $left = 28 - (microtime(true) - self::$t0); if ($left < 3) return ['code' => 0, 'body' => '', 'cookies' => [], 'location' => null, 'err' => 'time budget'];
      $hdr = ['cookies' => [], 'location' => null];
      $ch = curl_init($url);
      $ua = 'Mozilla/5.0 (compatible; Lichylnyky/1.0; +' . Cfg::appUrl() . ')';   // честно: кто мы
      $h = ['Accept: text/html,application/xhtml+xml', 'Accept-Language: uk-UA,uk;q=0.9'];
      if ($cookie !== '') $h[] = 'Cookie: ' . $cookie;
      if ($body !== null) $h[] = 'Content-Type: application/x-www-form-urlencoded';
      curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_TIMEOUT => (int)min(10, $left - 1), CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_USERAGENT => $ua, CURLOPT_HTTPHEADER => $h, CURLOPT_ENCODING => '', CURLOPT_MAXFILESIZE => 3 * 1024 * 1024,
        CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$hdr) {
          if (preg_match('/^set-cookie:\s*(.+)$/i', trim($line), $m)) $hdr['cookies'][] = $m[1];
          if (preg_match('/^location:\s*(.+)$/i', trim($line), $m)) $hdr['location'] = $m[1];
          return strlen($line);
        }]);
      if ($method === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, (string)$body); }
      $b = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $ct = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE); $err = $b === false ? curl_error($ch) : null; curl_close($ch);
      $r = ['code' => $code, 'body' => is_string($b) ? $b : '', 'err' => $err, 'ctype' => $ct] + $hdr;
    }
    foreach ((array)$r['cookies'] as $sc) {
      if (!preg_match('/^\s*([^=;\s]+)=([^;]*)(.*)$/', (string)$sc, $m)) continue;
      $gone = $m[2] === '' || $m[2] === 'deleted' || (preg_match('/expires=([^;]+)/i', $m[3], $e) && ($ts = strtotime($e[1])) && $ts < time()) || preg_match('/max-age=0\b/i', $m[3]);
      if ($gone) unset(self::$jar[$m[1]]); else self::$jar[$m[1]] = $m[2];
    }
    return $r;
  }
  private static function req(string $method, string $url, ?string $body = null): array {
    for ($i = 0; $i < 5; $i++) {
      if (!self::sameSite($url)) throw new HttpError(424, 'cab_changed', ['human' => self::h('changed')]);
      $r = self::once($method, $url, $body);
      self::$steps[] = [$method, (string)(parse_url($url, PHP_URL_PATH) ?: '/'), (int)$r['code']];
      if ((int)$r['code'] === 0 || (int)$r['code'] >= 500) { self::diag(['result' => 'down', 'err' => $r['err'] ? mb_substr((string)$r['err'], 0, 100) : null]); throw new HttpError(424, 'cab_down', ['human' => self::h('down')]); }
      if (in_array((int)$r['code'], [301, 302, 303, 307, 308], true) && !empty($r['location'])) {
        $url = self::abs(trim((string)$r['location']), $url);
        if (!in_array((int)$r['code'], [307, 308], true)) { $method = 'GET'; $body = null; }
        continue;
      }
      return $r + ['url' => $url];
    }
    throw new HttpError(424, 'cab_changed', ['human' => self::h('changed')]);
  }
  private static function encode(array $pairs): string { return implode('&', array_map(fn($p) => urlencode((string)$p[0]) . '=' . urlencode((string)$p[1]), $pairs)); }

  // ---------- разбор HTML ----------
  private static function dom(string $html): DOMXPath {
    $d = new DOMDocument(); $prev = libxml_use_internal_errors(true);
    $d->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_COMPACT);
    libxml_clear_errors(); libxml_use_internal_errors($prev);
    return new DOMXPath($d);
  }
  private static function cls(string $c): string { return "contains(concat(' ', normalize-space(@class), ' '), ' $c ')"; }
  public static function sp(string $s): string { return trim(preg_replace('/\s+/u', ' ', $s)); }
  /** Текст узла без выпадающих списков, скриптов и подсказок полей. */
  private static function text(DOMNode $n): string {
    if ($n instanceof DOMText) return $n->nodeValue;
    if ($n instanceof DOMElement && in_array(strtolower($n->nodeName), ['select', 'option', 'script', 'style', 'button', 'noscript'], true)) return ' ';
    $s = ''; foreach ($n->childNodes as $c) $s .= self::text($c) . (in_array(strtolower($c->nodeName), ['td', 'th', 'div', 'p', 'li', 'br', 'label', 'span'], true) ? ' ' : '');
    return $s;
  }
  public static function mask(string $s): string { return mb_substr(preg_replace('/\d/', '#', self::sp($s)), 0, 260); }
  /** Сообщения сайта: ошибки полей (help-block у has-error), алерты, сводка ошибок. */
  private static function messages(DOMXPath $x): array {
    $out = ['err' => [], 'ok' => [], 'info' => []];
    foreach ($x->query('//*[' . self::cls('help-block') . ' or ' . self::cls('invalid-feedback') . ' or ' . self::cls('error-summary') . ' or ' . self::cls('alert-danger') . ' or ' . self::cls('alert-error') . ' or ' . self::cls('has-error') . ' or ' . self::cls('flash-error') . ']') as $e) {
      if ($e instanceof DOMElement && preg_match('/\bhas-error\b/', $e->getAttribute('class'))) { foreach ($x->query('.//*[' . self::cls('help-block') . ']', $e) as $hb) { $t = self::sp($hb->textContent); if ($t !== '') $out['err'][] = $t; } continue; }
      $t = self::sp(self::text($e)); if ($t !== '') $out['err'][] = $t;
    }
    foreach ($x->query('//*[' . self::cls('alert-success') . ' or ' . self::cls('flash-success') . ' or ' . self::cls('alert-info') . ' or ' . self::cls('alert-warning') . ' or ' . self::cls('alert') . ']') as $e) {
      $t = self::sp(self::text($e)); if ($t === '') continue;
      $c = $e instanceof DOMElement ? $e->getAttribute('class') : '';
      if (preg_match('/alert-success|flash-success/', $c)) $out['ok'][] = $t; elseif (!preg_match('/alert-danger|alert-error/', $c)) $out['info'][] = $t;
    }
    foreach ($out as &$l) $l = array_values(array_unique(array_map(fn($t) => mb_substr($t, 0, 300), $l)));
    return $out;
  }
  /** Поля формы так, как их отправил бы браузер: [[name, value], …] + сами элементы для подмены. */
  private static function fields(DOMXPath $x, DOMElement $form): array {
    $out = [];
    foreach ($x->query('.//input|.//select|.//textarea', $form) as $e) {
      /** @var DOMElement $e */
      $name = $e->getAttribute('name'); if ($name === '' || $e->hasAttribute('disabled')) continue;
      $tag = strtolower($e->nodeName); $type = strtolower($e->getAttribute('type') ?: 'text');
      if ($tag === 'input' && in_array($type, ['submit', 'button', 'image', 'reset', 'file'], true)) continue;
      if ($tag === 'input' && in_array($type, ['checkbox', 'radio'], true) && !$e->hasAttribute('checked')) continue;
      if ($tag === 'select') {
        $opts = iterator_to_array($x->query('.//option', $e)); if (!$opts) continue;
        $sel = null; foreach ($opts as $o) if ($o->hasAttribute('selected')) $sel = $o; $sel = $sel ?? $opts[0];
        $val = $sel->hasAttribute('value') ? $sel->getAttribute('value') : self::sp($sel->textContent);
        $out[] = ['name' => $name, 'value' => $val, 'type' => 'select', 'el' => $e, 'opts' => array_map(fn($o) => ['v' => $o->hasAttribute('value') ? $o->getAttribute('value') : self::sp($o->textContent), 't' => self::sp($o->textContent)], $opts)];
      } else $out[] = ['name' => $name, 'value' => $tag === 'textarea' ? $e->textContent : $e->getAttribute('value'), 'type' => $tag === 'textarea' ? 'textarea' : $type, 'el' => $e];
    }
    return $out;
  }
  private static function isInd(string $name): bool { return (bool)preg_match('/newindication/i', $name); }
  private static function isDate(string $name): bool { return (bool)preg_match('/dataindication|dateindication|date_?ind/i', $name); }
  /** Лічильники формы: у каждого поля newIndication — строка (tr или блок) с номером, видом, прошлыми показаниями. */
  private static function meters(DOMXPath $x, array $fields): array {
    $out = [];
    foreach ($fields as $f) {
      if (!self::isInd($f['name']) || $f['type'] === 'select' || $f['type'] === 'hidden') continue;
      $row = $x->query('ancestor::tr[1]', $f['el'])->item(0); $heads = []; $cells = [];
      if ($row) {
        foreach ($x->query('./td|./th', $row) as $td) $cells[] = self::sp(self::text($td));
        $tbl = $x->query('ancestor::table[1]', $row)->item(0);
        if ($tbl) { $ths = $x->query('.//thead//th', $tbl); if (!$ths->length) $ths = $x->query('(.//tr[th])[1]/th', $tbl); foreach ($ths as $th) $heads[] = self::sp($th->textContent); }
      } else {
        $row = $f['el']; for ($i = 0; $i < 4 && $row->parentNode instanceof DOMElement; $i++) { $row = $row->parentNode; if (preg_match('/row|counter|meter|lich|panel|item|card/i', $row->getAttribute('class'))) break; }
        $cells = array_values(array_filter(array_map(fn($n) => self::sp(self::text($n)), iterator_to_array($x->query('./*', $row))), fn($t) => $t !== ''));
      }
      $all = self::sp(implode(' · ', array_filter($cells, fn($t) => $t !== '')));
      $kind = preg_match('/гаряч|горяч|гвп|\bгв\b/iu', $all) ? 'hot' : (preg_match('/холодн|хвп|\bхв\b/iu', $all) ? 'cold' : null);
      // номер лічильника: колонка «№ / номер / заводський», иначе — самое длинное «слово» из цифр (≥ 5) в строке
      $serial = null; $prev = null; $prevDate = null;
      foreach ($heads as $i => $hd) {
        $c = $cells[$i] ?? '';
        if ($serial === null && preg_match('/№|номер|завод|лічильн|счетчик|счётчик/iu', $hd) && preg_match('/[\w\-\/]*\d[\w\-\/]*/u', $c, $m)) $serial = $m[0];
        if ($prev === null && preg_match('/попер|останн|предыд|последн|поточн|текущ/iu', $hd) && !preg_match('/дат/iu', $hd) && preg_match('/\d+(?:[.,]\d+)?/', $c, $m)) $prev = (float)str_replace(',', '.', $m[0]);
        if ($prevDate === null && preg_match('/дат/iu', $hd) && preg_match('/\d{1,2}\.\d{1,2}\.\d{2,4}/', $c, $m)) $prevDate = $m[0];
      }
      if ($serial === null && preg_match_all('/\b[\w\-\/]*\d{5,}[\w\-\/]*\b/u', $all, $mm)) { usort($mm[0], fn($a, $b) => strlen($b) - strlen($a)); $serial = $mm[0][0]; }
      $out[] = ['key' => $f['name'], 'label' => mb_substr($all, 0, 200), 'cells' => array_slice($cells, 0, 8), 'heads' => array_slice($heads, 0, 8), 'kind' => $kind, 'serial' => $serial, 'prev' => $prev, 'prevDate' => $prevDate, 'el' => $f['el'], 'row' => $row];
    }
    return $out;
  }
  private static function addr(DOMXPath $x): ?string {
    foreach ($x->query('//body//text()') as $t) { $s = self::sp($t->nodeValue); if (preg_match('/^(?:адреса?:?\s*)?(?:м\.\s*\S+,?\s*)?(?:вул|вулиця|ул|улица|просп|проспект|пров|провулок|пер|переулок|пл|площа|бульв|бульвар|шосе|узвіз|майдан|набережна)\.?\s+\S/iu', $s)) return mb_substr($s, 0, 120); }
    return null;
  }

  // ---------- шаги ----------
  /** Открыть «Вхід без реєстрації» и войти по рахунку и прізвищу. → [xpath, form, fields, meters, page] */
  private static function open(string $acc, string $fam, string $op): array {
    if (!self::ready()) throw new HttpError(503, 'cab_off', ['human' => self::h('nodom')]);
    self::$jar = []; self::$steps = []; self::$t0 = microtime(true); self::$cur = ['op' => $op];
    $login = self::req('GET', self::base() . '/login');
    $x = self::dom((string)$login['body']);
    $f = $x->query("//form[@id='no-login-form']")->item(0) ?? $x->query("//form[.//input[contains(@name,'NoLoginForm')]]")->item(0);
    if (!$f) { self::diag(['result' => 'changed', 'where' => 'login', 'forms' => self::formsInfo($x), 'page' => self::pageInfo($x, $login, $fam, $acc)]); throw new HttpError(424, 'cab_changed', ['human' => self::h('changed')]); }
    $pairs = [];
    foreach (self::fields($x, $f) as $fl) {
      $v = $fl['value'];
      if (preg_match('/NoLoginForm\[acc\]/i', $fl['name'])) $v = $acc; elseif (preg_match('/NoLoginForm\[fam\]/i', $fl['name'])) $v = $fam;
      $pairs[] = [$fl['name'], $v];
    }
    if (!array_filter($pairs, fn($p) => preg_match('/NoLoginForm\[acc\]/i', $p[0]))) $pairs[] = ['NoLoginForm[acc]', $acc];
    if (!array_filter($pairs, fn($p) => preg_match('/NoLoginForm\[fam\]/i', $p[0]))) $pairs[] = ['NoLoginForm[fam]', $fam];
    $btn = $x->query(".//button[@name][not(@type) or @type='submit']|.//input[@type='submit'][@name]", $f)->item(0);
    if ($btn instanceof DOMElement) $pairs[] = [$btn->getAttribute('name'), $btn->getAttribute('value')];
    $action = self::abs($f->getAttribute('action') ?: '/get-form-send-indications', (string)$login['url']);
    $page = self::req('POST', $action, self::encode($pairs));
    $x2 = self::dom((string)$page['body']);
    $form = $x2->query("//form[@id='send-counters-form']")->item(0) ?? $x2->query("//form[.//*[contains(@name,'newIndication')]]")->item(0);
    if (!$form) {
      $msgs = self::messages($x2);
      // живой сайт (проба 04.11.2026): чужой рахунок → 200, страница без форм, «Не коректні дані: особовий рахунок або Прізвище абонента, або на
      // особовому рахунку не значаться лічильники. Можливо необхідно вказати прізвище українською мовою». Старый вариант — снова форма входа.
      $still = $x2->query("//form[@id='no-login-form']")->item(0) !== null || ($msgs['err'] && preg_match(self::NF_RE, implode(' ', $msgs['err'])));
      self::diag(['result' => $still ? 'notfound' : 'changed', 'where' => 'check', 'msgs' => self::maskMsgs($msgs), 'forms' => self::formsInfo($x2)] + ($still ? [] : ['page' => self::pageInfo($x2, $page, $fam, $acc)]));
      if ($still) throw new HttpError(422, 'cab_not_found', ['human' => self::h('notfound', ['a' => $acc, 'f' => $fam]) . (preg_match('/[ыэъёЫЭЪЁ]/u', $fam) ? ' ' . self::h('ukr') : ''), 'site' => array_slice($msgs['err'], 0, 3)]);
      throw new HttpError(424, 'cab_changed', ['human' => self::h('changed'), 'site' => array_slice(array_merge($msgs['err'], $msgs['info']), 0, 3)]);
    }
    $fields = self::fields($x2, $form); $ms = self::meters($x2, $fields);
    if (!$ms) { self::diag(['result' => 'changed', 'where' => 'form', 'forms' => self::formsInfo($x2), 'page' => self::pageInfo($x2, $page, $fam, $acc)]); throw new HttpError(424, 'cab_changed', ['human' => self::h('changed')]); }
    return ['x' => $x2, 'form' => $form, 'fields' => $fields, 'meters' => $ms, 'page' => $page];
  }
  private static function pubMeters(array $ms): array { return array_map(fn($m) => array_intersect_key($m, array_flip(['key', 'label', 'kind', 'serial', 'prev', 'prevDate'])), $ms); }
  private static function dates(array $fields): array {
    foreach ($fields as $f) if ($f['type'] === 'select' && self::isDate($f['name'])) return array_map(fn($o) => ['v' => $o['v'], 't' => $o['t'], 'sel' => $o['v'] === $f['value']], array_slice($f['opts'], 0, 12));
    return [];
  }

  /** POST /api/vk/cab/check {acc, fam} — что видит сайт Водоканала: лічильники (номер, вид, прошлые показания) и даты. */
  public static function check(int $uid, array $in): array {
    self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk';
    [$acc, $fam] = self::input($in); self::limit($uid);
    $c = self::open($acc, $fam, 'check');
    self::diag(['result' => 'ok', 'where' => 'check', 'form' => self::formInfo($c['x'], $c['form'], $c['fields'], $c['meters']), 'msgs' => self::maskMsgs(self::messages($c['x'])), 'user' => $uid]);
    return ['ok' => true, 'meters' => self::pubMeters($c['meters']), 'dates' => self::dates($c['fields']), 'addr' => self::addr($c['x'])];
  }

  /** Показания из запроса → [{key|null, value, serial, name, kind}] (до 6). keyless — ключ поля сайта можно не знать (очередь: сервер найдёт сам). */
  public static function items(array $raw, bool $keyless = false): array {
    $out = [];
    foreach (array_slice($raw, 0, 6) as $it) {
      if (!is_array($it)) continue; $v = str_replace(',', '.', trim((string)($it['value'] ?? '')));
      $key = is_string($it['key'] ?? null) && self::isInd($it['key']) ? $it['key'] : null;
      if (!preg_match('/^\d{1,7}(?:\.\d{1,3})?$/', $v) || (!$keyless && $key === null)) continue;
      $out[] = ['key' => $key, 'value' => $v, 'serial' => isset($it['serial']) && $it['serial'] !== '' ? mb_substr((string)$it['serial'], 0, 30) : null, 'name' => mb_substr(trim((string)($it['name'] ?? '')), 0, 40),
        'kind' => in_array($it['kind'] ?? null, ['cold', 'hot'], true) ? $it['kind'] : null];
    }
    return $out;
  }

  /** POST /api/vk/cab/send {acc, fam, items: [{key, value, serial?, name?}], date?, lang?} — отправить показания. Только по нажатию человека. */
  public static function send(int $uid, array $in): array {
    self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk';
    [$acc, $fam] = self::input($in);
    $items = self::items((array)($in['items'] ?? []));
    if (!$items) throw new HttpError(422, 'cab_no_items', ['human' => self::h('items')]);
    self::limit($uid);
    $r = self::deliver($uid, $acc, $fam, $items, isset($in['date']) ? (string)$in['date'] : null, 'send', false);
    return ['ok' => $r['result'] === 'ok', 'result' => $r['result'], 'text' => $r['text'], 'at' => $r['at'], 'id' => 'cab-' . $r['at'], 'keys' => $r['keys']];
  }
  /** Войти по рахунку и прізвищу, разложить показания по лічильникам сайта, отправить форму. → ['result' => ok|err|unknown, 'text', 'at', 'keys' => [i => ключ поля]].
   *  strict (очередь, без человека): ключ можно не знать — сервер найдёт лічильник по номеру, виду или единственный; меньше того, что сайт уже знает, — не шлём.
   *  Не узнали страницу / не тот рахунок / не поняли, какой лічильник, — HttpError (ничего не отправлено). */
  public static function deliver(int $uid, string $acc, string $fam, array $items, ?string $date, string $op, bool $strict): array {
    $c = self::open($acc, $fam, $op);
    $byKey = []; foreach ($c['meters'] as $m) $byKey[$m['key']] = $m;
    $digits = fn($s) => preg_replace('/\D/', '', (string)$s); $used = []; $map = [];
    $miss = function () use ($c) { self::diag(['result' => 'mismatch', 'where' => 'send', 'form' => self::formInfo($c['x'], $c['form'], $c['fields'], $c['meters'])]); return new HttpError(409, 'cab_mismatch', ['human' => self::h('mismatch'), 'meters' => self::pubMeters($c['meters'])]); };
    foreach ($items as $i => $it) {
      $sd = ltrim($digits($it['serial']), '0');
      $m = $it['key'] !== null ? ($byKey[$it['key']] ?? null) : null;
      $bad = $m && $sd !== '' && !str_contains($digits($m['label']), $sd);
      if (!$strict) { if (!$m || $bad) throw $miss(); }
      else {
        if ($bad) $m = null;
        if (!$m && $sd !== '') foreach ($c['meters'] as $x) if (!isset($used[$x['key']]) && str_contains($digits($x['label']), $sd)) { $m = $x; break; }
        if (!$m && $it['kind']) {
          $cand = array_values(array_filter($c['meters'], fn($x) => !isset($used[$x['key']]) && $x['kind'] === $it['kind']));
          if (count($cand) === 1 && count(array_filter($items, fn($y) => $y['kind'] === $it['kind'])) === 1) $m = $cand[0];
        }
        if (!$m && count($c['meters']) === 1 && count($items) === 1) $m = $c['meters'][0];
        if (!$m) { self::diag(['result' => 'which', 'where' => 'send', 'form' => self::formInfo($c['x'], $c['form'], $c['fields'], $c['meters'])]); throw new HttpError(409, 'cab_which', ['human' => self::h('which'), 'meters' => self::pubMeters($c['meters'])]); }
        if ($m['prev'] !== null && (float)$it['value'] < (float)$m['prev']) { self::diag(['result' => 'less', 'where' => 'send']); throw new HttpError(422, 'cab_less', ['human' => self::h('less', ['n' => $it['name'] ?: $it['value'], 'p' => $m['prev']]), 'item' => $i]); }
      }
      if (isset($used[$m['key']])) throw $miss();
      $used[$m['key']] = 1; $map[$i] = $m['key'];
    }
    $vals = []; foreach ($items as $i => $it) $vals[$map[$i]] = $it['value'];
    // поля формы как у браузера; показания — в свои поля, дата — выбранная человеком (если есть такая), иначе как предложил сайт
    $pairs = [];
    foreach ($c['fields'] as $f) {
      $v = $f['value'];
      if (isset($vals[$f['name']])) $v = $vals[$f['name']];
      elseif ($f['type'] === 'select' && self::isDate($f['name']) && $date !== null && in_array($date, array_column($f['opts'], 'v'), true)) $v = $date;
      $pairs[] = [$f['name'], $v];
    }
    $btn = $c['x']->query(".//button[@name][not(@type) or @type='submit']|.//input[@type='submit'][@name]", $c['form'])->item(0);
    if ($btn instanceof DOMElement) $pairs[] = [$btn->getAttribute('name'), $btn->getAttribute('value')];
    $action = self::abs($c['form']->getAttribute('action') ?: (string)$c['page']['url'], (string)$c['page']['url']);
    $resp = self::req(strtoupper($c['form']->getAttribute('method') ?: 'POST') === 'GET' ? 'GET' : 'POST', $action, self::encode($pairs));
    $x = self::dom((string)$resp['body']); $msgs = self::messages($x);
    $okRe = '/(?:показ\p{L}*(?:[^\p{L}]+\p{L}+){0,5}?[^\p{L}]+(?:прийнят|принят|збережен|сохранен|передан|внесен|зарахован|врахован|учтен))|(?:(?:прийнят|принят|збережен|сохранен|передан|внесен|зарахован|врахован|учтен)\p{L}*(?:[^\p{L}]+\p{L}+){0,2}?[^\p{L}]+показ)|успішно|успешно/iu';
    $okText = array_values(array_filter(array_merge($msgs['ok'], $msgs['info']), fn($t) => preg_match($okRe, $t)));
    // форма вернулась с ошибками у наших полей — это «помилка», даже если где-то есть общий алерт
    $fieldErr = [];
    $f2 = $x->query("//form[@id='send-counters-form']")->item(0) ?? $x->query("//form[.//*[contains(@name,'newIndication')]]")->item(0);
    if ($f2) foreach (self::meters($x, self::fields($x, $f2)) as $m) if (isset($vals[$m['key']]) && $m['row'] instanceof DOMElement) {
      foreach ($x->query('.//*[' . self::cls('help-block') . ' or ' . self::cls('invalid-feedback') . ']', $m['row']) as $hb) { $t = self::sp($hb->textContent); if ($t !== '') $fieldErr[] = $t; }
    }
    if ($fieldErr || ($msgs['err'] && !$msgs['ok'])) $result = 'err';
    elseif ($msgs['ok'] || $okText) $result = 'ok';
    else $result = 'unknown';
    $text = $result === 'err' ? implode(' ', array_slice(array_unique(array_merge($fieldErr, $msgs['err'])), 0, 3)) : implode(' ', array_slice($msgs['ok'] ?: $okText ?: $msgs['info'], 0, 2));
    self::diag(['result' => $result, 'where' => $op, 'form' => self::formInfo($c['x'], $c['form'], $c['fields'], $c['meters']), 'msgs' => self::maskMsgs($msgs), 'fieldErr' => array_map([self::class, 'mask'], $fieldErr), 'n' => count($items), 'user' => $uid]);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'vk_cab_' . $op . '_' . $result, null, Http::iso()]);
    $at = time();
    if ($result === 'ok') self::notify($uid, $acc, array_map(fn($it, $i) => ['name' => $it['name'] ?: ($byKey[$map[$i]]['serial'] ? '№ ' . $byKey[$map[$i]]['serial'] : ''), 'value' => $it['value']], $items, array_keys($items)), $text);
    return ['result' => $result, 'text' => mb_substr($text, 0, 400), 'at' => $at, 'keys' => $map];
  }
  /** «✅ Водоканал прийняв» — в Telegram человеку (если привязан). lines: [{name, value}] */
  public static function notify(int $uid, string $acc, array $lines, string $text, ?string $head = null): void {
    $tg = Db::one("SELECT external_id FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$uid]); if (!$tg || !Cfg::get('bot_token')) return;
    $ru = self::$lang === 'ru'; $l = [];
    foreach ($lines as $it) $l[] = '• ' . ($it['name'] ?: ($ru ? 'счётчик' : 'лічильник')) . ' — ' . $it['value'];
    $p = ['chat_id' => $tg['external_id'], 'text' => ($head ?? ($ru ? "✅ Водоканал принял показания (счёт $acc):" : "✅ Водоканал прийняв показання (рахунок $acc):")) . "\n" . implode("\n", $l) . ($text !== '' ? "\n\n" . ($ru ? 'Ответ сайта: ' : 'Відповідь сайту: ') . '«' . mb_substr($text, 0, 300) . '»' : '')];
    if (Cfg::appUrlKnown()) $p['reply_markup'] = ['inline_keyboard' => [[['text' => $ru ? 'Открыть «Счётчики»' : 'Відкрити «Лічильники»', 'web_app' => ['url' => Cfg::appUrl() . '?go=water-cold']]]]];
    try { Telegram::call('sendMessage', $p); } catch (Throwable $e) { /* не дошло — не страшно */ }
  }
  public static function limit(int $uid): void {
    try { RateLimit::hit('vk_cab', (string)$uid); RateLimit::hit('vk_cab_all', 'all'); }
    catch (HttpError $e) { throw new HttpError(429, 'rate_limited', ['human' => self::h('busy')] + $e->extra); }
  }

  // ---------- проба «не знайдено»: как живой сайт отвечает на заведомо чужой рахунок ----------
  // Сервер сам, без человека, раз на PROBE_V (cron, VkStatus::probeNotFound): вводит выдуманный рахунок и смотрит ответ. Показания не
  // шлёт. Итог — в журнал (op probe) и в /api/vk/status → probe (рахунок выдуманный, цифры замаскированы). Поправили разбор — PROBE_V + 1.
  const PROBE_V = 2, PROBE_ACC = '1000001', PROBE_FAM = 'Перевірка';
  public static function probe(?int $now = null): array {
    $now = $now ?? time(); $site = []; self::$lang = 'uk';
    try { self::open(self::PROBE_ACC, self::PROBE_FAM, 'probe'); $err = 'found'; }   // вдруг такой рахунок есть — ничего о нём не пишем
    catch (HttpError $e) { $err = $e->err; $site = array_map([self::class, 'mask'], array_slice((array)($e->extra['site'] ?? []), 0, 3)); }
    $l = self::log(); $d = $l ? $l[count($l) - 1] : [];
    $d = $err !== 'found' && ($d['op'] ?? '') === 'probe' && (int)($d['at'] ?? 0) >= time() - 60 ? array_intersect_key($d, array_flip(['result', 'where', 'steps', 'msgs', 'forms', 'err'])) : [];
    return ['v' => self::PROBE_V, 'at' => $now, 'error' => $err, 'site' => $site] + $d;
  }

  /** Итог журнала для /api/health — только числа: сколько записей «операция итог» (check ok, send ok, probe notfound…) среди
   *  последних 40 и когда была последняя проверка/отправка человека (не проба сервера). Слова сайта и рахунки — только в /admin. */
  public static function summary(): array {
    $n = []; $last = null;
    foreach (self::log() as $e) {
      $op = preg_replace('/[^a-z]/', '', (string)($e['op'] ?? '')) ?: '?'; $r = preg_replace('/[^a-z_]/', '', (string)($e['result'] ?? '')) ?: '?';
      $n["$op $r"] = ($n["$op $r"] ?? 0) + 1;
      if ($op !== 'probe' && (int)($e['at'] ?? 0) > (int)$last) $last = (int)$e['at'];
    }
    ksort($n);
    // последний сбой человека (не проба): шаги и структура страницы без слов сайта — как htmcab.lastErr
    $le = null;
    foreach (array_reverse(self::log()) as $e) if (($e['op'] ?? '') !== 'probe' && in_array($e['result'] ?? '', ['changed', 'down', 'mismatch', 'which'], true)) {
      $le = ['at' => gmdate('c', (int)($e['at'] ?? 0))] + array_intersect_key($e, array_flip(['op', 'result', 'where', 'steps', 'err']));
      if (isset($le['steps'])) $le['steps'] = array_map(fn($st) => [(string)($st[0] ?? ''), preg_replace('/\d/', '#', (string)($st[1] ?? '')), (int)($st[2] ?? 0)], (array)$le['steps']);
      if (isset($e['forms'])) $le['forms'] = array_map(fn($f) => ['id' => $f['id'] ?? '', 'action' => preg_replace('/\d/', '#', (string)($f['action'] ?? '')), 'names' => array_map(fn($v) => preg_replace('/\d/', '#', (string)$v), (array)($f['names'] ?? []))], (array)$e['forms']);
      if (isset($e['msgs'])) $le['msgsN'] = array_map(fn($l) => count((array)$l), (array)$e['msgs']);
      if (isset($e['page'])) { $le['page'] = $e['page']; unset($le['page']['text']); }
      break;
    }
    return ['n' => (object)$n, 'lastUser' => $last ? gmdate('c', $last) : null, 'lastErr' => $le];
  }

  // ---------- журнал для /admin: структура без личных данных ----------
  private static array $cur = [];
  private static function maskMsgs(array $m): array { return array_map(fn($l) => array_map([self::class, 'mask'], array_slice($l, 0, 5)), $m); }
  private static function formsInfo(DOMXPath $x): array {
    $out = [];
    foreach ($x->query('//form') as $f) { /** @var DOMElement $f */
      $names = []; foreach ($x->query('.//*[@name]', $f) as $e) $names[] = $e->getAttribute('name');
      $out[] = ['id' => $f->getAttribute('id'), 'action' => (string)parse_url($f->getAttribute('action'), PHP_URL_PATH), 'names' => array_slice(array_values(array_unique($names)), 0, 30)];
    }
    return array_slice($out, 0, 6);
  }
  /** Страница, которую не узнали: что на ней есть (для разбора «сайт изменился»). Без личных данных: цифры — #, прізвище и рахунок — ***,
   *  строки, похожие на адрес, не пишем. text (заголовки, подписи — слова сайта) — только в /admin; остальное — структура (и в /api/health). */
  private static function pageInfo(DOMXPath $x, array $resp, string $fam = '', string $acc = ''): array {
    $html = (string)($resp['body'] ?? '');
    $clean = function (string $s) use ($fam, $acc): string {
      $s = self::sp($s);
      foreach (array_filter([$fam, $acc], fn($v) => mb_strlen($v) >= 2) as $v) $s = preg_replace('/' . preg_quote($v, '/') . '/iu', '***', $s);
      return self::mask($s);
    };
    $path = fn(string $u): string => preg_replace('/\d/', '#', (string)(parse_url($u, PHP_URL_PATH) ?? ''));
    $txt = [];
    foreach ($x->query('//title|//h1|//h2|//h3|//h4|//h5|//legend|//label|//th|//button|//*[' . self::cls('panel-heading') . ' or ' . self::cls('card-header') . ' or ' . self::cls('modal-title') . ']') as $e) {
      $t = self::sp(self::text($e)); if ($e instanceof DOMElement && strtolower($e->nodeName) === 'button') $t = self::sp($e->textContent);
      if ($t === '' || preg_match('/(?:^|\s)(?:вул|вулиця|ул|улица|просп|проспект|пров|пер|бульв|кв)\.?\s/iu', $t)) continue;
      $txt[] = mb_substr($clean($t), 0, 120); if (count($txt) >= 16) break;
    }
    $names = []; foreach ($x->query('//input[@name]|//select[@name]|//textarea[@name]|//button[@name]') as $e) $names[] = strtolower($e->nodeName) . ':' . preg_replace('/\d/', '#', $e->getAttribute('name'));
    $scripts = []; foreach ($x->query('//script[@src]') as $e) $scripts[] = $path($e->getAttribute('src'));
    $ajax = [];
    foreach ($x->query('//script[not(@src)]') as $e) if (preg_match_all('~["\'](/[a-z][a-z0-9_\-]*(?:/[a-z0-9_\-.]+)*)(?:\?[^"\']*)?["\']~i', $e->textContent, $m)) foreach ($m[1] as $u) $ajax[] = preg_replace('/\d/', '#', $u);
    $links = []; foreach ($x->query('//a[@href]') as $e) { $h = $e->getAttribute('href'); if ($h !== '' && $h[0] !== '#' && !preg_match('~^(?:mailto|tel|javascript):~i', $h)) $links[] = $path($h); }
    $frames = []; foreach ($x->query('//iframe[@src]') as $e) $frames[] = (string)parse_url($e->getAttribute('src'), PHP_URL_HOST) . $path($e->getAttribute('src'));
    $j = json_decode($html, true); $u = fn(array $a, int $n) => array_slice(array_values(array_unique(array_filter($a, fn($v) => $v !== ''))), 0, $n);
    return ['url' => $path((string)($resp['url'] ?? '')), 'code' => (int)($resp['code'] ?? 0), 'ctype' => mb_substr((string)($resp['ctype'] ?? ''), 0, 60), 'len' => strlen($html),
      'json' => is_array($j) ? array_slice(array_keys($j), 0, 12) : null, 'tables' => $x->query('//table')->length, 'rows' => $x->query('//tr')->length,
      'names' => $u($names, 40), 'scripts' => $u($scripts, 15), 'ajax' => $u($ajax, 20), 'links' => $u($links, 25), 'frames' => $u($frames, 5),
      'captcha' => (bool)preg_match('~g-recaptcha|cf-turnstile|h-captcha|recaptcha/api\.js|challenges\.cloudflare\.com~i', $html), 'text' => $u($txt, 16)];
  }
  private static function formInfo(DOMXPath $x, DOMElement $form, array $fields, array $ms): array {
    return ['id' => $form->getAttribute('id'), 'action' => (string)parse_url($form->getAttribute('action'), PHP_URL_PATH), 'method' => $form->getAttribute('method'),
      'fields' => array_slice(array_map(fn($f) => [$f['name'], $f['type']] + ($f['type'] === 'select' ? [2 => count($f['opts']), 3 => self::mask($f['opts'][0]['t'] ?? '')] : []), $fields), 0, 40),
      'heads' => $ms[0]['heads'] ?? [], 'rows' => array_map(fn($m) => ['key' => $m['key'], 'cells' => array_map([self::class, 'mask'], $m['cells']), 'kind' => $m['kind'], 'serial' => $m['serial'] !== null, 'prev' => $m['prev'] !== null], $ms)];
  }
  private static function diag(array $d): void {
    $d = ['at' => time(), 'op' => self::$cur['op'] ?? '?', 'steps' => self::$steps] + $d;
    $l = self::log(); $l[] = $d; $l = array_slice($l, -40);
    @mkdir(dirname(self::logFile()), 0700, true); @file_put_contents(self::logFile(), json_encode($l, JSON_UNESCAPED_UNICODE), LOCK_EX);
  }
}
