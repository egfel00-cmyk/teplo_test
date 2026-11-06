<?php
// Кабинеты поставщиков, куда робот сервера входит «как человек» (логин и пароль самого человека) и вносит показания.
//  CabWeb   — браузер робота: свой cookie-jar, редиректы только в пределах сайта, кодировка страницы, бюджет времени.
//  CabProbe — раз в 30 минут открывает страницы входа ХТМ, обленерго и Газмереж (без входа): пускают ли наш сервер, есть ли капча.
//             Итог — /api/health → cabs (только код, время, признаки капчи и формы входа).
// Капчу не обходим: увидели капчу — робот останавливается и просит человека внести самому.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class CabWeb {
  /** в тестах: fn(string $method, string $url, ?string $body, string $cookie, array $headers): ['code', 'body', 'cookies' => [], 'location' => ?string, 'err' => ?string] */
  public static $http = null;
  public array $jar = [];
  public array $steps = [];
  private float $t0;
  public function __construct(private string $hostRe, private float $budget = 25.0, private string $charset = 'UTF-8') { $this->t0 = microtime(true); }

  public static function ua(): string { return 'Mozilla/5.0 (compatible; Lichylnyky/1.0; +' . Cfg::appUrl() . ')'; }
  public function left(): float { return $this->budget - (microtime(true) - $this->t0); }
  public function sameSite(string $url): bool { return (bool)preg_match($this->hostRe, (string)parse_url($url, PHP_URL_HOST)); }
  public static function abs(string $u, string $from): string {
    if (preg_match('~^https?://~i', $u)) return $u;
    $p = parse_url($from); $root = ($p['scheme'] ?? 'https') . '://' . ($p['host'] ?? '') . (isset($p['port']) ? ':' . $p['port'] : '');
    if (str_starts_with($u, '//')) return ($p['scheme'] ?? 'https') . ':' . $u;
    if (str_starts_with($u, '/')) return $root . $u;
    $dir = preg_replace('~/[^/]*$~', '/', (string)($p['path'] ?? '/'));
    return $root . $dir . $u;
  }
  private function once(string $method, string $url, ?string $body, array $headers): array {
    $cookie = implode('; ', array_map(fn($k, $v) => $k . '=' . $v, array_keys($this->jar), $this->jar));
    if (self::$http) $r = (self::$http)($method, $url, $body, $cookie, $headers) + ['cookies' => [], 'location' => null, 'err' => null];
    else {
      $left = $this->left(); if ($left < 3) return ['code' => 0, 'body' => '', 'cookies' => [], 'location' => null, 'err' => 'time budget'];
      $hdr = ['cookies' => [], 'location' => null];
      $h = array_merge(['Accept: text/html,application/xhtml+xml,application/json;q=0.9', 'Accept-Language: uk-UA,uk;q=0.9'], $headers);
      if ($cookie !== '') $h[] = 'Cookie: ' . $cookie;
      $ch = curl_init($url);
      curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_TIMEOUT => (int)max(2, min(12, $left - 1)), CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_USERAGENT => self::ua(), CURLOPT_HTTPHEADER => $h, CURLOPT_ENCODING => '', CURLOPT_MAXFILESIZE => 4 * 1024 * 1024,
        CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$hdr) {
          if (preg_match('/^set-cookie:\s*(.+)$/i', trim($line), $m)) $hdr['cookies'][] = $m[1];
          if (preg_match('/^location:\s*(.+)$/i', trim($line), $m)) $hdr['location'] = $m[1];
          return strlen($line);
        }]);
      if ($method === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, (string)$body); }
      $b = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = $b === false ? curl_error($ch) : null; curl_close($ch);
      $r = ['code' => $code, 'body' => is_string($b) ? $b : '', 'err' => $err] + $hdr;
    }
    foreach ((array)$r['cookies'] as $sc) {
      if (!preg_match('/^\s*([^=;\s]+)=([^;]*)(.*)$/', (string)$sc, $m)) continue;
      $gone = $m[2] === '' || $m[2] === 'deleted' || (preg_match('/expires=([^;]+)/i', $m[3], $e) && ($ts = strtotime($e[1])) && $ts < time()) || preg_match('/max-age=0\b/i', $m[3]);
      if ($gone) unset($this->jar[$m[1]]); else $this->jar[$m[1]] = $m[2];
    }
    return $r;
  }
  /** Запрос с редиректами в пределах сайта. → ['code', 'body' (UTF-8), 'url', 'err', 'offsite' => ?string]. Сеть/5xx — code 0/5xx, решает вызывающий. */
  public function req(string $method, string $url, ?string $body = null, array $headers = []): array {
    for ($i = 0; $i < 6; $i++) {
      if (!$this->sameSite($url)) return ['code' => 0, 'body' => '', 'url' => $url, 'err' => 'offsite', 'offsite' => (string)parse_url($url, PHP_URL_HOST)];
      $t = microtime(true);
      $r = $this->once($method, $url, $body, $headers);
      $this->steps[] = [$method, (string)(parse_url($url, PHP_URL_PATH) ?: '/'), (int)$r['code'], (int)round((microtime(true) - $t) * 1000)];
      if (in_array((int)$r['code'], [301, 302, 303, 307, 308], true) && !empty($r['location'])) {
        $url = self::abs(trim((string)$r['location']), $url);
        if (!in_array((int)$r['code'], [307, 308], true)) { $method = 'GET'; $body = null; }
        continue;
      }
      $b = (string)$r['body'];
      if ($this->charset !== 'UTF-8' && $b !== '' && !mb_check_encoding($b, 'UTF-8')) $b = (string)mb_convert_encoding($b, 'UTF-8', $this->charset);
      return ['code' => (int)$r['code'], 'body' => $b, 'url' => $url, 'err' => $r['err'] ?? null, 'offsite' => null];
    }
    return ['code' => 0, 'body' => '', 'url' => $url, 'err' => 'redirects', 'offsite' => null];
  }
  /** Тело формы: пары [имя, значение] → urlencoded в кодировке сайта. */
  public function encode(array $pairs): string {
    $enc = fn($s) => urlencode($this->charset === 'UTF-8' ? (string)$s : (string)mb_convert_encoding((string)$s, $this->charset, 'UTF-8'));
    return implode('&', array_map(fn($p) => $enc($p[0]) . '=' . $enc($p[1]), $pairs));
  }
  public static function dom(string $html): DOMXPath {
    $d = new DOMDocument(); libxml_use_internal_errors(true);
    $html = preg_replace('/<meta\b[^>]*charset\s*=[^>]*>/i', '', $html);   // текст уже в UTF-8 — объявление windows-1251 сбило бы разбор
    $d->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING); libxml_clear_errors();
    return new DOMXPath($d);
  }
  public static function sp(string $s): string { return trim(preg_replace('/\s+/u', ' ', $s)); }
  /** Цифры → #, коротко: так текст сайта можно хранить в журнале без личных данных. */
  public static function mask(string $s, int $n = 220): string { return mb_substr(preg_replace('/\d/', '#', self::sp($s)), 0, $n); }
  /** Признаки капчи и защиты на странице. → ['widget' => bool (видимая капча), 'script' => bool (только скрипт), 'cf' => bool (проверка Cloudflare)] */
  public static function captcha(string $html, int $code = 200): array {
    $widget = (bool)preg_match('/class="[^"]*\b(g-recaptcha|cf-turnstile|h-captcha)\b|name="(cf-turnstile-response|g-recaptcha-response|h-captcha-response)"|data-sitekey=/i', $html);
    $script = (bool)preg_match('~recaptcha/api\.js|challenges\.cloudflare\.com/turnstile|hcaptcha\.com/1/api\.js~i', $html);
    $cf = in_array($code, [403, 503], true) && (bool)preg_match('/cf-chl|challenge-platform|Just a moment|Attention Required/i', $html);
    return ['widget' => $widget, 'script' => $script, 'cf' => $cf];
  }
}

final class CabProbe {
  const V = 1;
  /** Что пробуем: страница входа и признак «это наша форма входа». */
  const SITES = [
    'htm' => ['url' => 'https://www.hts.kharkov.ua/cabinet', 'host' => '/(^|\.)hts\.kharkov\.ua$/i', 'form' => '/name="passw"/i', 'cs' => 'Windows-1251'],
    'obl' => ['url' => 'https://pa.oblenergo.kharkov.ua/frontend/web/index.php/uk/site/login', 'host' => '/^pa\.oblenergo\.kharkov\.ua$/i', 'form' => '/LoginForm\[password\]/', 'cs' => 'UTF-8'],
    'grm' => ['url' => 'https://my.grmu.com.ua/login', 'host' => '/^my\.grmu\.com\.ua$/i', 'form' => '/data-page=/i', 'cs' => 'UTF-8'],
  ];
  public static function file(): string { return Cfg::data() . '/cache/cab_probe.json'; }
  public static function read(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  /** Пора ли пробовать: раз в 30 минут (минута 11 и 41) или сразу после новой версии пробы. */
  public static function due(?int $now = null): bool { $now = $now ?? time(); return ((int)gmdate('i', $now) % 30 === 11) || (int)(self::read()['v'] ?? 0) !== self::V; }
  public static function one(string $k): array {
    $s = self::SITES[$k]; $w = new CabWeb($s['host'], 10.0, $s['cs']); $t = microtime(true);
    $r = $w->req('GET', $s['url']);
    $o = ['code' => $r['code'], 'ms' => (int)round((microtime(true) - $t) * 1000), 'at' => gmdate('c')];
    if ($r['err']) $o['err'] = mb_substr((string)$r['err'], 0, 80);
    if ($r['offsite']) $o['offsite'] = $r['offsite'];
    if ($r['code'] === 200 || $r['code'] === 403 || $r['code'] === 503) {
      $o['form'] = (bool)preg_match($s['form'], $r['body']);
      $o += CabWeb::captcha($r['body'], $r['code']);
      if ($k === 'grm' && preg_match('/data-page="([^"]+)"/', $r['body'], $m)) {   // Laravel + Inertia: настройки страницы входа — JSON в атрибуте
        $p = json_decode(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'), true);
        if (is_array($p)) { $o['component'] = mb_substr((string)($p['component'] ?? ''), 0, 40); $o['captchaProp'] = !empty($p['props']['captcha']); }
      }
    }
    $o['ok'] = $r['code'] === 200 && !empty($o['form']) && empty($o['widget']) && empty($o['cf']) && empty($o['captchaProp']);
    return $o;
  }
  private static function save(array $j): void { @mkdir(dirname(self::file()), 0700, true); @file_put_contents(self::file(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX); }
  /** Пробует сайты по одному и пишет итог после каждого — если cron оборвут на медленном сайте, остальное уже видно. */
  public static function run(): array {
    $prev = self::read(); $out = ['v' => self::V, 'at' => gmdate('c'), 'running' => true] + array_intersect_key($prev, self::SITES);
    self::save($out);
    foreach (array_keys(self::SITES) as $k) {
      $out[$k] = ['code' => 0, 'err' => 'started', 'ok' => false, 'at' => gmdate('c')] + ['lastOk' => $prev[$k]['lastOk'] ?? null]; self::save($out);
      try { $o = self::one($k); } catch (Throwable $e) { $o = ['code' => 0, 'err' => mb_substr($e->getMessage(), 0, 80), 'ok' => false, 'at' => gmdate('c')]; }
      $o['lastOk'] = !empty($o['ok']) ? $o['at'] : ($prev[$k]['lastOk'] ?? null);   // когда последний раз открывался
      $out[$k] = $o; self::save($out);
    }
    unset($out['running']); self::save($out);
    return $out;
  }
}

/** Пароли кабинетов: AES-256-GCM, ключ — случайный, в SITE_DATA/uploads/settings/cab.key (0600), не в базе и не в git.
 *  Утечёт база — паролей не прочитать; взломают сервер целиком — не спасёт ничто, поэтому «забути пароль» у человека всегда под рукой. */
final class CabVault {
  public static function keyFile(): string { return Cfg::data() . '/uploads/settings/cab.key'; }
  private static function key(): string {
    $f = self::keyFile(); $k = @file_get_contents($f);
    if (is_string($k) && strlen($k) === 32) return $k;
    @mkdir(dirname($f), 0700, true);
    $h = @fopen($f, 'x');   // создаёт только первый; второй процесс прочитает созданный
    if ($h) { fwrite($h, random_bytes(32)); fclose($h); @chmod($f, 0600); }
    $k = @file_get_contents($f);
    if (!is_string($k) || strlen($k) !== 32) throw new RuntimeException('cab key unavailable');
    return $k;
  }
  public static function enc(string $s): string {
    $n = random_bytes(12); $tag = '';
    $c = openssl_encrypt($s, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $n, $tag);
    if ($c === false) throw new RuntimeException('encrypt');
    return 'g1:' . base64_encode($n . $tag . $c);
  }
  public static function dec(string $e): ?string {
    if (!str_starts_with($e, 'g1:')) return null; $b = base64_decode(substr($e, 3), true); if ($b === false || strlen($b) < 29) return null;
    $p = openssl_decrypt(substr($b, 28), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, substr($b, 0, 12), substr($b, 12, 16));
    return $p === false ? null : $p;
  }
}

/** Отказ кабинета: код для приложения + слова сайта (цифры замаскированы при записи в журнал). */
final class CabErr extends Exception {
  public function __construct(public string $err, public string $site = '', public array $extra = []) { parent::__construct($err); }
}

/** Кабинет КП «ХТМ» (тепло). Контракт — docs/теплосервис — кабинет ХТМ (снятие 01.11.2026), стенд — tests/htm-mock.
 *  Вход email + пароль (windows-1251, без CSRF), форма показаний открыта 5–25, итог проверки робота ХТМ — в журнале через 15–30 минут. */
final class HtmCab {
  const BASE = 'https://www.hts.kharkov.ua';
  const F = ['date' => 'LastDtPok', 'energy' => 'LastValuePok', 'volume' => 'LastRashPok', 'flow' => 'HeatRash', 'power' => 'HeatPower',
    'tSupply' => 'TempPod', 'tReturn' => 'TempO', 'hours' => 'LastTimePok', 'errHours' => 'ErrorTime', 'errCode' => 'ErrorKod'];
  const DEC = ['energy' => 3, 'volume' => 3, 'flow' => 3, 'power' => 3, 'tSupply' => 2, 'tReturn' => 2];
  public CabWeb $w;
  public array $log = [];
  public static function base(): string { return rtrim((string)Cfg::get('htm_cab_base', self::BASE), '/'); }
  public function __construct(float $budget = 25.0) {
    $host = preg_quote((string)parse_url(self::base(), PHP_URL_HOST), '/');
    $this->w = new CabWeb('/^(www\.)?' . preg_replace('/^www\\\\\./', '', $host) . '$/i', $budget, 'Windows-1251');
  }
  private function get(string $path): array { return $this->guard($this->w->req('GET', CabWeb::abs($path, self::base() . '/'))); }
  private function post(string $url, array $pairs): array { return $this->guard($this->w->req('POST', $url, $this->w->encode($pairs), ['Content-Type: application/x-www-form-urlencoded'])); }
  private function guard(array $r): array {
    if ($r['offsite']) throw new CabErr('changed', 'redirect ' . $r['offsite']);
    if ($r['code'] === 0 || $r['code'] >= 500) throw new CabErr('down', (string)($r['err'] ?? $r['code']));
    $c = CabWeb::captcha($r['body'], $r['code']);
    if ($c['widget'] || $c['cf']) throw new CabErr('captcha');
    return $r;
  }
  private static function msgs(DOMXPath $x): array {
    $out = ['err' => [], 'ok' => []];
    foreach ($x->query("//*[contains(@class,'alert') or contains(@class,'flash') or contains(@class,'help-block')]") as $n) {
      $t = CabWeb::sp($n->textContent); if ($t === '' || mb_strlen($t) > 400) continue;
      $cls = (string)$n->getAttribute('class');
      $out[str_contains($cls, 'success') ? 'ok' : (str_contains($cls, 'danger') || str_contains($cls, 'error') || str_contains($cls, 'help-block') ? 'err' : 'ok')][] = $t;
    }
    return $out;
  }
  public function login(string $email, string $pass): array {
    $this->get('/cabinet');
    $r = $this->post(self::base() . '/cabinet/login', [['email', $email], ['passw', $pass], ['email-signin', '']]);
    if (str_contains($r['body'], '/cabinet/logout')) return $r;
    $m = self::msgs(CabWeb::dom($r['body']));
    throw new CabErr('bad_login', implode(' ', array_slice($m['err'], 0, 2)));
  }
  /** Выйти (вежливо: не оставлять сессий робота на сайте ХТМ); ошибки не важны. */
  public function logout(): void { try { if ($this->w->jar) $this->w->req('GET', self::base() . '/cabinet/logout'); } catch (Throwable $e) {} }
  /** Особові рахунки кабинета: [['acc' => '…', 'sur' => 'ПРІЗВИЩЕ']] — из ссылок /cabinet/{рахунок}/{прізвище}. */
  public function accounts(array $home): array {
    $out = [];
    foreach ([$home, $this->get('/cabinet/list')] as $r) {
      if (!preg_match_all('~href="(?:https?://[^"/]+)?/cabinet/(?:heat/)?(\d{4,14})/([^"/?#]+)"~u', $r['body'], $m, PREG_SET_ORDER)) continue;
      foreach ($m as $x) { $sur = rawurldecode(html_entity_decode($x[2])); if (!isset($out[$x[1]])) $out[$x[1]] = ['acc' => $x[1], 'sur' => $sur]; }
    }
    return array_values($out);
  }
  private static function url(string $acc, string $sur, string $what = 'heat'): string { return self::base() . '/cabinet/' . $what . '/' . rawurlencode($acc) . '/' . rawurlencode(mb_strtoupper($sur)); }
  /** Страница тепла: прибор, последние принятые, открыта ли форма, журнал. */
  public function heat(string $acc, string $sur): array {
    $r = $this->get(self::url($acc, $sur)); $x = CabWeb::dom($r['body']); $txt = CabWeb::sp($x->document->textContent ?? '');
    $o = ['url' => $r['url'], 'meter' => null, 'base' => [], 'open' => false, 'closed' => null, 'min' => null, 'max' => null, 'journal' => [], 'fields' => [], 'html' => $r['body']];
    foreach ($x->query('//h1|//h2|//h3|//h4|//caption|//div[contains(@class,"title")]') as $hn) {   // «ВІДОМІСТЬ … НА dd.mm.yyyy: ПУ <модель>, №<номер>»
      if (preg_match('/ПУ\s+([^,№]{2,40}?),?\s*№\s*([\w\-\/\.]{2,30})\s*$/u', CabWeb::sp($hn->textContent), $m)) { $o['meter'] = ['model' => trim($m[1]), 'serial' => trim($m[2])]; break; }
    }
    foreach (self::F as $k => $id) { $n = $x->query("//*[@id='head_$id']")->item(0); if ($n) $o['base'][$k] = CabWeb::sp($n->textContent); }
    if (preg_match("/min_date\s*=\s*'([\d.]+)'/", $r['body'], $m)) $o['min'] = $m[1];
    if (preg_match("/max_date\s*=\s*'([\d.]+)'/", $r['body'], $m)) $o['max'] = $m[1];
    $form = null;
    foreach ($x->query('//form') as $f) { foreach ($x->query('.//input', $f) as $i) if (strcasecmp((string)$i->getAttribute('name'), self::F['energy']) === 0 || stripos((string)$i->getAttribute('name'), 'LastValue') !== false) { $form = $f; break 2; } }
    if ($form) {
      $o['open'] = true; $o['action'] = CabWeb::abs((string)($form->getAttribute('action') ?: $r['url']), $r['url']);
      foreach ($x->query('.//input|.//select|.//textarea|.//button', $form) as $i) {
        $nm = (string)$i->getAttribute('name'); if ($nm === '') continue;
        // подсказки сайта к полю (маска телефона, длина) — для сверки формы; значения в журнал не пишем
        $o['fields'][] = ['name' => $nm, 'type' => strtolower($i->nodeName === 'input' ? ($i->getAttribute('type') ?: 'text') : $i->nodeName), 'value' => (string)$i->getAttribute('value'),
          'ph' => mb_substr((string)$i->getAttribute('placeholder'), 0, 40), 'max' => (int)$i->getAttribute('maxlength') ?: null, 'pattern' => mb_substr((string)$i->getAttribute('pattern'), 0, 60), 'req' => $i->hasAttribute('required')];
      }
    } elseif (preg_match('/[^.]*тимчасово\s+зупинен[^.]*\.[^.]*\./u', $txt, $m)) $o['closed'] = trim($m[0]);
    // журнал: строка из ≥10 ячеек с датой → «Примітки» → «Статус: …»
    $rows = $x->query('//tr'); $cur = null;
    foreach ($rows as $tr) {
      $tds = $x->query('./td', $tr); $first = $tds->length ? CabWeb::sp($tds->item(0)->textContent) : '';
      if ($tds->length >= 10 && preg_match('/^\d{2}\.\d{2}\.\d{4}$/', $first) && !$x->query("./td[starts-with(@id,'head_')]", $tr)->length) {
        $cls = (string)$tds->item(0)->getAttribute('class');
        $cur = ['date' => $first, 'energy' => CabWeb::sp($tds->item(1)->textContent), 'cls' => $cls, 'status' => str_contains($cls, 'bg-success') ? 'ok' : (str_contains($cls, 'bg-danger') ? 'rejected' : 'pending'), 'text' => ''];
        $o['journal'][] = &$cur; continue;
      }
      $t = CabWeb::sp($tr->textContent);
      if ($cur !== null && preg_match('/^Статус:\s*(.*)$/u', $t, $m)) {
        $cur['text'] = $m[1];
        if (preg_match('/успішно|прийнят[оі]\b/u', $m[1]) && !preg_match('/не\s+при[йн]{1,2}ят/u', $m[1])) $cur['status'] = 'ok';
        elseif (preg_match('/не\s+при[йн]{1,2}ят[іи]?\s*(?:з\s+причини:?)?\s*(.*)$/u', $m[1], $mm)) { $cur['status'] = 'rejected'; $cur['reason'] = trim($mm[1]); }
        unset($cur); $cur = null;
      }
    }
    unset($cur);
    return $o;
  }
  /** Формат как в журнале ХТМ: точка, 3 знака у энергии/объёма/расхода/мощности, 2 — у температур; часы — целые. */
  public static function fmt(string $k, $v): string {
    if ($k === 'date' || $k === 'errCode') return trim((string)$v);
    $v = str_replace([',', ' '], ['.', ''], trim((string)$v));
    if (!is_numeric($v)) throw new CabErr('bad_value', $k);
    return isset(self::DEC[$k]) ? number_format((float)$v, self::DEC[$k], '.', '') : (string)(int)round((float)$v);
  }
  /** Как робот понимает поля открытой формы (без значений): у каждого поля роль — наше значение (date…errCode), hidden/кнопка как есть,
   *  контакт (phone, email, note), галочка (не трогаем) или «незнакомое». → ['roles' => [имя => роль], 'missing' => [наши, которых нет], 'unknown' => [имена], 'match' => bool]. */
  public static function plan(array $fields): array {
    $ours = []; foreach (self::F as $k => $name) $ours[strtolower($name)] = $k;
    $roles = []; $seen = []; $unknown = []; $btn = false;
    foreach ($fields as $f) {
      $nm = (string)$f['name']; $ln = strtolower($nm);
      if (isset($ours[$ln])) { $roles[$nm] = $ours[$ln]; $seen[$ours[$ln]] = 1; continue; }
      if ($f['type'] === 'hidden') { $roles[$nm] = '#hidden'; continue; }
      if (in_array($f['type'], ['submit', 'button'], true)) { $roles[$nm] = $btn ? '#skip' : '#button'; $btn = true; continue; }
      if (preg_match('/phone|tel/i', $nm)) { $roles[$nm] = 'phone'; continue; }
      if (preg_match('/e-?mail/i', $nm)) { $roles[$nm] = 'email'; continue; }
      if (preg_match('/note|prim|comment|koment/i', $nm)) { $roles[$nm] = 'note'; continue; }
      if (in_array($f['type'], ['checkbox', 'radio'], true)) { $roles[$nm] = '#skip'; continue; }
      $roles[$nm] = '?'; $unknown[] = $nm;
    }
    $missing = array_values(array_diff(array_keys(self::F), array_keys($seen)));
    return ['roles' => $roles, 'missing' => $missing, 'unknown' => $unknown, 'match' => !$missing && !$unknown];
  }
  /** Сохранить показания. vals: date (dd.mm.yyyy) + energy … errCode; contact: phone, email, note; h — уже открытая страница heat() (не открывать второй раз).
   *  → ['status' => 'pending'|'ok'|'rejected', 'text', 'flash'] или CabErr (closed, form_changed, form_error, …). Ничего не шлём, если форма не та. */
  public function save(string $acc, string $sur, array $vals, array $contact, ?array $h = null): array {
    $h = $h ?? $this->heat($acc, $sur);
    if (!$h['open']) throw new CabErr('closed', (string)$h['closed']);
    $want = [];
    foreach (self::F as $k => $name) { if (!array_key_exists($k, $vals)) throw new CabErr('bad_value', $k); $want[$k] = self::fmt($k, $vals[$k]); }
    $pl = self::plan($h['fields']);
    if (!$pl['match']) { $this->log['fields'] = array_column($h['fields'], 'name'); throw new CabErr('form_changed', 'missing: ' . implode(',', $pl['missing']) . ' unknown: ' . implode(',', $pl['unknown'])); }
    $pairs = [];
    foreach ($h['fields'] as $f) {
      $role = $pl['roles'][$f['name']] ?? '#skip';
      if (isset($want[$role])) $pairs[] = [$f['name'], $want[$role]];
      elseif ($role === '#hidden' || $role === '#button') $pairs[] = [$f['name'], $f['value']];
      elseif (in_array($role, ['phone', 'email', 'note'], true)) $pairs[] = [$f['name'], (string)($contact[$role] ?? '')];
    }
    $want = [strtolower(self::F['date']) => $want['date'], strtolower(self::F['energy']) => $want['energy']];
    $r = $this->post($h['action'], $pairs);
    $m = self::msgs(CabWeb::dom($r['body']));
    $after = $this->heat($acc, $sur);
    $row = self::find($after['journal'], $want[strtolower(self::F['date'])], $want[strtolower(self::F['energy'])]);
    if (!$row) throw new CabErr('form_error', implode(' ', array_slice($m['err'] ?: $m['ok'], 0, 2)));
    return ['status' => $row['status'], 'text' => $row['text'], 'reason' => $row['reason'] ?? null, 'flash' => implode(' ', array_slice($m['ok'], 0, 1))];
  }
  /** Строка журнала по дате и энергии (энергию сравниваем числом). */
  public static function find(array $journal, string $date, string $energy): ?array {
    foreach ($journal as $j) if ($j['date'] === $date && abs((float)$j['energy'] - (float)$energy) < 0.0005) return $j;
    return null;
  }
}
