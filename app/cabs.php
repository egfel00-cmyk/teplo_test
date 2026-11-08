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
  /** Один curl на весь заход робота: соединение и TLS-сессия переиспользуются (живой кабинет ХТМ 06.11 22:14 — новое соединение на 5-м запросе
   *  не установилось за 6 с, хотя предыдущие прошли). curl_reset между запросами сбрасывает опции, но не живые соединения. */
  private $ch = null;
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
      $hdr = ['cookies' => [], 'location' => null, 'h' => []];
      $h = array_merge(['Accept: text/html,application/xhtml+xml,application/json;q=0.9', 'Accept-Language: uk-UA,uk;q=0.9'], $headers);
      if ($cookie !== '') $h[] = 'Cookie: ' . $cookie;
      if ($this->ch === null) $this->ch = curl_init(); else curl_reset($this->ch);
      $ch = $this->ch;
      curl_setopt_array($ch, [CURLOPT_URL => $url, CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_TIMEOUT => (int)max(2, min(12, $left - 1)), CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_USERAGENT => self::ua(), CURLOPT_HTTPHEADER => $h, CURLOPT_ENCODING => '', CURLOPT_MAXFILESIZE => 4 * 1024 * 1024,
        CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$hdr) {
          if (preg_match('/^set-cookie:\s*(.+)$/i', trim($line), $m)) $hdr['cookies'][] = $m[1];
          if (preg_match('/^location:\s*(.+)$/i', trim($line), $m)) $hdr['location'] = $m[1];
          if (preg_match('/^(cf-mitigated|server):\s*(.{0,40})/i', trim($line), $m)) $hdr['h'][strtolower($m[1])] = strtolower(trim($m[2]));   // вид отказа Cloudflare (CabWeb::cfKind)
          if (preg_match('/^(content-type|content-disposition):\s*(.{0,160})/i', trim($line), $m)) $hdr['h'][strtolower($m[1])] = trim($m[2]);   // квитанция: PDF ли и как названа
          return strlen($line);
        }]);
      if ($method === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, (string)$body); }
      $b = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = $b === false ? curl_error($ch) : null;
      if ($b === false) { curl_close($ch); $this->ch = null; }   // сеть подвела — следующая попытка на свежем соединении
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
      for ($try = 0; ; $try++) {
        $t = microtime(true);
        $r = $this->once($method, $url, $body, $headers);
        $this->steps[] = [$method, (string)(parse_url($url, PHP_URL_PATH) ?: '/'), (int)$r['code'], (int)round((microtime(true) - $t) * 1000)] + (!empty($r['err']) ? [4 => mb_substr((string)$r['err'], 0, 90)] : []);
        // не соединились / оборвалось — GET повторяем один раз (он ничего не меняет на сайте); POST — никогда: могли и сохранить
        if ((int)$r['code'] !== 0 || $method !== 'GET' || $try >= 1 || ($r['err'] ?? '') === 'time budget' || ($r['err'] ?? '') === 'offsite' || $this->left() < 8) break;
      }
      if (in_array((int)$r['code'], [301, 302, 303, 307, 308], true) && !empty($r['location'])) {
        $url = self::abs(trim((string)$r['location']), $url);
        if (!in_array((int)$r['code'], [307, 308], true)) { $method = 'GET'; $body = null; }
        continue;
      }
      $b = (string)$r['body'];
      // перекодировать только текст: PDF (квитанция) и прочие файлы — как пришли
      if ($this->charset !== 'UTF-8' && $b !== '' && !str_starts_with($b, '%PDF-') && !str_contains($b, "\0") && !mb_check_encoding($b, 'UTF-8')) $b = (string)mb_convert_encoding($b, 'UTF-8', $this->charset);
      return ['code' => (int)$r['code'], 'body' => $b, 'url' => $url, 'err' => $r['err'] ?? null, 'offsite' => null, 'h' => (array)($r['h'] ?? [])];
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
  /** Какой отказ Cloudflare: geo — сайт закрыл страну (1009: из Украины пустит), challenge — проверка «вы человек» (managed/JS challenge),
   *  block — правило WAF (1020, «you have been blocked», бан IP 1006–1008), ua — подпись клиента (1010), rate — лимит (1015/1012); null — не Cloudflare.
   *  → ['cfKind', 'cfCode' (номер ошибки), 'cfCc' (страна из текста 1009)] — только коды, без слов страницы. */
  public static function cfKind(string $html, int $code, array $h = []): array {
    $isCf = ($h['server'] ?? '') === 'cloudflare' || isset($h['cf-mitigated']) || (bool)preg_match('/cloudflare/i', $html);
    if (!in_array($code, [403, 429, 503], true) || !$isCf) return [];
    $o = [];
    if (preg_match('/cf-error-code[^>]*>\s*(\d{4})|Error\s+(?:code:?\s*)?(?:<[^>]+>\s*)*(1\d{3})\b/i', $html, $m)) $o['cfCode'] = (int)($m[1] !== '' ? $m[1] : $m[2]);
    if (preg_match('/banned the country or region your IP address is in \(([A-Z]{2})\)/', $html, $m)) $o['cfCc'] = $m[1];
    $n = $o['cfCode'] ?? 0;
    $o['cfKind'] = match (true) {
      $n === 1009 || isset($o['cfCc']) => 'geo',
      $n === 1010 => 'ua',
      $n === 1015 || $n === 1012 => 'rate',
      in_array($n, [1006, 1007, 1008, 1020], true) => 'block',
      ($h['cf-mitigated'] ?? '') === 'challenge' || (bool)preg_match('/cf-chl|challenge-platform|Just a moment/i', $html) => 'challenge',
      (bool)preg_match('/you have been blocked|Attention Required/i', $html) => 'block',
      default => 'other',
    };
    return $o;
  }
}

final class CabProbe {
  const V = 4;   // 4: captchaKind — turnstile (ключ 0x4…) / recaptcha (6L…) / hcaptcha (uuid); 2: вид отказа Cloudflare (cfKind/cfCode/cfCc) и robots.txt — понять, пустит ли обленерго из Украины (ретранслятор); 3: что в настройке captcha Газмереж (captchaShape) — включена ли
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
      $o += CabWeb::cfKind($r['body'], $r['code'], $r['h'] ?? []);
      // отказ Cloudflare: robots.txt того же сайта — закрыт весь сайт (страна/сеть) или только страницы (бот-проверка)
      if (isset($o['cfKind'])) { $rb = $w->req('GET', CabWeb::abs('/robots.txt', $s['url'])); $o['robots'] = (int)$rb['code']; }
      if ($k === 'grm' && preg_match('/data-page="([^"]+)"/', $r['body'], $m)) {   // Laravel + Inertia: настройки страницы входа — JSON в атрибуте
        $p = json_decode(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'), true);
        if (is_array($p)) {
          $o['component'] = mb_substr((string)($p['component'] ?? ''), 0, 40); $o['captchaProp'] = !empty($p['props']['captcha']);
          // какая это настройка: {enabled: false, …} — капча выключена; ключи и типы без значений (строки — длина), булевы и числа — как есть
          $o['captchaShape'] = self::shape($p['props']['captcha'] ?? null);
          $o['captchaOn'] = self::captchaOn($p['props']['captcha'] ?? null);
          $o['captchaKind'] = self::captchaKind($p['props']['captcha'] ?? null);
          $o['props'] = array_slice(array_keys((array)($p['props'] ?? [])), 0, 30);
        }
      }
    }
    $o['ok'] = $r['code'] === 200 && !empty($o['form']) && empty($o['widget']) && empty($o['cf']) && ($k === 'grm' ? ($o['captchaOn'] ?? null) === false : empty($o['captchaProp']));
    return $o;
  }
  /** Форма значения без самих значений: bool/число/null — как есть, строка — 'str:<длина>' (короткое слово-тип вроде «recaptcha» — целиком), массив — по ключам (2 уровня). */
  public static function shape($v, int $d = 0) {
    if (is_array($v)) { if ($d >= 2) return 'arr:' . count($v); $o = []; foreach (array_slice($v, 0, 15, true) as $k => $x) $o[(string)$k] = self::shape($x, $d + 1); return $o; }
    if (is_string($v)) return preg_match('/^[a-z_\-]{1,20}$/i', $v) ? $v : 'str:' . strlen($v);
    return $v;
  }
  /** Чья капча по публичному ключу сайта: Cloudflare Turnstile — «0x4…», Google reCAPTCHA — «6L…», hCaptcha — uuid. */
  public static function captchaKind($v): ?string {
    if (is_array($v)) { foreach ($v as $x) if (is_string($x) && ($k = self::captchaKind($x))) return $k; return null; }
    if (!is_string($v)) return null;
    return match (true) { (bool)preg_match('/^0x4[A-Za-z0-9_\-]{10,}$/', $v) => 'turnstile', (bool)preg_match('/^6L[A-Za-z0-9_\-]{20,}$/', $v) => 'recaptcha',
      (bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $v) => 'hcaptcha', default => null };
  }
  /** Включена ли капча по настройке: true/false/null (не поняли). Массив с enabled/active/on/required — по нему; пустое/false/0 — нет. */
  public static function captchaOn($v): ?bool {
    if ($v === null || $v === false || $v === 0 || $v === '' || $v === []) return false;
    if ($v === true || is_string($v) || is_int($v)) return true;
    if (is_array($v)) { foreach (['enabled', 'enable', 'active', 'on', 'required', 'show', 'visible', 'is_enabled'] as $k) if (array_key_exists($k, $v)) return (bool)$v[$k]; return null; }
    return null;
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

/** Проба обленерго «из Украины» — решает, будет ли ретранслятор на NAS. Нашему серверу (Германия) Cloudflare обленерго отвечает managed challenge
 *  (CabProbe: 403, cf-mitigated challenge, robots.txt тоже 403). Пустит ли тот же сайт домашний украинский адрес — проверяет NAS владельца:
 *  curl -i -L страницы с тем же User-Agent и Accept, что у робота (CabWeb), и весь вывод — сюда: POST /api/relay/probe?t=obl|form&via=nas (сырой текст).
 *  Разбираем здесь: коды по шагам, вид отказа Cloudflare, капча (чья), формы и их поля, поля вне форм, скрипты, AJAX-адреса, скелет главной формы.
 *  Храним структуру и сам вывод: это публичные страницы без входа (личных данных нет) — новая версия разбора (V) перечитает его без нового запуска на NAS.
 *  Страна отправителя — CF-IPCountry от Cloudflare перед нашим сайтом (IP не пишем). /api/health → uaProbe (без скелета), GET /api/relay/probe?t= — целиком. */
/** Обленерго с украинских узлов check-host.net — ответ «пустят ли из Украины», пока NAS владельца не запустил RelayProbe. Узел check-host делает обычный
 *  GET страницы и отдаёт только код ответа (тела нет). 200 с Украины → нашему серверу отказ по стране/сети, домашний адрес почти наверняка пустят;
 *  403/503 и с Украины → проверка ботов на весь сайт: узлы — дата-центры, домашний адрес ещё может пройти, решит только NAS. Ничего не вводим и не шлём.
 *  Раз на V, два шага cron: start — список узлов (nodes/hosts) → украинские (до 4) → check-http обеих страниц RelayProbe::T; через ≥ 20 с — check-result
 *  (до 8 раз, пока все узлы не ответят). /api/health → uaCheck. */
final class UaCheck {
  const V = 1;
  const API = 'https://check-host.net';
  /** в тестах: fn(string $url): ['code' => int, 'body' => string] */
  public static $http = null;
  private static int $code = 0;   // код последнего ответа API — для подсказки, если формат не тот
  public static function file(): string { return Cfg::data() . '/cache/ua_check.json'; }
  public static function read(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  private static function save(array $j): void { @mkdir(dirname(self::file()), 0700, true); @file_put_contents(self::file(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX); }
  private static function get(string $path): ?array {
    $url = self::API . $path;
    if (self::$http) $r = (self::$http)($url);
    else {
      $ch = curl_init($url);
      curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_USERAGENT => CabWeb::ua(),
        CURLOPT_HTTPHEADER => ['Accept: application/json'], CURLOPT_MAXFILESIZE => 1024 * 1024]);
      $b = curl_exec($ch); $r = ['code' => (int)curl_getinfo($ch, CURLINFO_HTTP_CODE), 'body' => is_string($b) ? $b : '']; curl_close($ch);
    }
    self::$code = (int)$r['code'];
    $j = $r['code'] === 200 ? json_decode((string)$r['body'], true) : null;
    return is_array($j) ? $j : null;
  }
  /** Что пришло вместо ожидаемого (без значений): код и ключи ответа / текст error. */
  private static function hint(?array $r): array {
    if ($r === null) return ['code' => self::$code];
    return ['keys' => array_slice(array_map('strval', array_keys($r)), 0, 6)] + (isset($r['error']) ? ['error' => mb_substr((string)$r['error'], 0, 60)] : []);
  }
  /** Украинские узлы из nodes/hosts: location ["ua", "Ukraine", "Kyiv"] (или имя ua1.node…) → [имя => город]. */
  public static function uaNodes(array $hosts): array {
    $o = [];
    foreach ((array)($hosts['nodes'] ?? []) as $name => $n) {
      $loc = array_values((array)($n['location'] ?? []));
      if (strtolower((string)($loc[0] ?? '')) === 'ua' || preg_match('/^ua\d*\./i', (string)$name)) $o[(string)$name] = mb_substr((string)($loc[2] ?? $loc[1] ?? ''), 0, 30);
    }
    return array_slice($o, 0, 4, true);
  }
  /** Ответ узла check-http: [[1, 0.13, "OK", "200", ip]] / [[0, 3.0, "Connection timed out", null, null]] / null (ещё идёт). IP сайта не пишем. */
  public static function cell($x): ?array {
    if (!is_array($x) || !is_array($x[0] ?? null)) return null;
    $a = $x[0]; $code = isset($a[3]) && is_numeric($a[3]) ? (int)$a[3] : null;
    return ['code' => $code, 'ok' => (bool)($a[0] ?? false), 'msg' => mb_substr((string)($a[2] ?? ''), 0, 40), 'ms' => (int)round((float)($a[1] ?? 0) * 1000)];
  }
  /** По странице: хоть один узел — 200 → ok; все ответившие — 403/503 → blocked; не ответили/другое → unknown. */
  public static function verdict(array $cells): string {
    $codes = array_values(array_filter(array_map(fn($c) => $c['code'] ?? null, $cells), fn($c) => $c !== null));
    if (in_array(200, $codes, true)) return 'ok';
    if ($codes && !array_diff($codes, [403, 503])) return 'blocked';
    return 'unknown';
  }
  public static function run(?int $now = null): ?array {
    $now = $now ?? time(); $j = self::read();
    if ((int)($j['v'] ?? 0) !== self::V) {   // шаг 1: узлы и запуск проверок
      $j = ['v' => self::V, 'at' => gmdate('c', $now), 'ts' => $now, 'tries' => 0, 'req' => [], 'res' => []];
      $h = self::get('/nodes/hosts'); $nodes = self::uaNodes($h ?? []);
      $j['nodes'] = $nodes;
      if (!$nodes) { $j['done'] = true; $j['err'] = 'no_ua_nodes'; $j['hint'] = self::hint($h) + ['n' => count((array)($h['nodes'] ?? []))]; self::save($j); return $j; }
      $q = implode('', array_map(fn($n) => '&node=' . rawurlencode($n), array_keys($nodes)));
      foreach (RelayProbe::T as $t => $x) {
        $r = self::get('/check-http?host=' . rawurlencode($x['url']) . $q);
        if (!empty($r['request_id'])) $j['req'][$t] = (string)$r['request_id']; else $j['res'][$t] = ['err' => 'start_failed', 'hint' => self::hint($r)];
      }
      if (!$j['req']) { $j['done'] = true; $j['err'] = 'start_failed'; }
      self::save($j); return $j;
    }
    if (!empty($j['done']) || $now - (int)($j['ts'] ?? 0) < 20) return null;   // шаг 2: результаты (не чаще раза в 20 с)
    $j['ts'] = $now; $j['tries'] = (int)($j['tries'] ?? 0) + 1; $pending = 0;
    foreach ((array)$j['req'] as $t => $id) {
      $r = self::get('/check-result/' . rawurlencode((string)$id)); $cells = [];
      foreach (array_keys((array)$j['nodes']) as $n) { $c = is_array($r) ? self::cell($r[$n] ?? null) : null; if ($c === null) $pending++; else $cells[$n] = $c; }
      $j['res'][$t] = ['nodes' => $cells, 'verdict' => self::verdict($cells)];
    }
    if (!$pending || $j['tries'] >= 8) { $j['done'] = true; $j['doneAt'] = gmdate('c', $now); }
    self::save($j); return $j;
  }
  /** Для /api/health: узлы, по страницам — вердикт и «код сообщение» по узлам. */
  public static function summary(): array {
    $j = self::read(); if (!$j) return [];
    $o = ['v' => $j['v'] ?? null, 'at' => $j['at'] ?? null, 'done' => !empty($j['done']), 'nodes' => $j['nodes'] ?? [], 'tries' => $j['tries'] ?? 0];
    if (!empty($j['err'])) $o['err'] = $j['err'];
    if (!empty($j['hint'])) $o['hint'] = $j['hint'];
    foreach ((array)($j['res'] ?? []) as $t => $x) $o[$t] = ['verdict' => $x['verdict'] ?? ($x['err'] ?? null), 'nodes' => array_map(fn($c) => trim(($c['code'] ?? '—') . ' ' . ($c['msg'] ?? '')), (array)($x['nodes'] ?? []))] + (isset($x['hint']) ? ['hint' => $x['hint']] : []);
    return $o;
  }
}

final class RelayProbe {
  const V = 1;
  /** obl — кабинет (вход email + пароль, без капчи); form — онлайн-форма «передача показників» (рахунок + показання, без входа). */
  const T = [
    'obl' => ['url' => 'https://pa.oblenergo.kharkov.ua/frontend/web/index.php/uk/site/login', 'form' => '/LoginForm\[password\]/'],
    'form' => ['url' => 'https://oblenergo.kharkiv.ua/uk/transmissionofmeterreadings', 'form' => null],
  ];
  /** Метка, которую дописывает curl -w в конце вывода: итоговый код, сколько редиректов, секунды. */
  const MARK = '#lichylnyky';
  public static function dir(): string { return Cfg::data() . '/cache/ua_probe'; }
  private static function rawFile(string $t): string { return self::dir() . '/' . $t . '.raw'; }
  private static function file(): string { return self::dir() . '/probe.json'; }
  private static function load(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  private static function save(array $j): void { @mkdir(self::dir(), 0700, true); @file_put_contents(self::file(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX); }

  /** Команда для NAS / Mac (одна строка): обе страницы → сюда. Та же строка — в docs и в ответе владельцу. */
  public static function command(string $base = 'https://peredai.com.ua'): string {
    $base = rtrim($base, '/');
    return "UA='Mozilla/5.0 (compatible; Lichylnyky/1.0; +$base/)'; for t in obl form; do case \$t in obl) u='" . self::T['obl']['url'] . "';; form) u='" . self::T['form']['url'] . "';; esac; "
      . "curl -s -i -L -m 25 -A \"\$UA\" -H 'Accept: text/html,application/xhtml+xml,application/json;q=0.9' -H 'Accept-Language: uk-UA,uk;q=0.9' -w '\\n" . self::MARK . " %{http_code} %{num_redirects} %{time_total}\\n' \"\$u\""
      . " | curl -s -m 30 -H 'Content-Type: text/plain' --data-binary @- \"$base/api/relay/probe?t=\$t&via=nas\"; echo; done";
  }

  /** Вывод curl -i -L (+ метка -w) → ['codes' => коды по шагам, 'h' => заголовки последнего ответа (имена — строчными), 'body', 'w' => ?['code', 'redirects', 's']]. */
  public static function split(string $raw): array {
    $w = null;
    if (preg_match('/\r?\n?' . preg_quote(self::MARK, '/') . ' (\d{3}) (\d+) ([\d.,]+)\s*$/', $raw, $m, PREG_OFFSET_CAPTURE)) {
      $w = ['code' => (int)$m[1][0], 'redirects' => (int)$m[2][0], 's' => round((float)str_replace(',', '.', $m[3][0]), 2)]; $raw = substr($raw, 0, $m[0][1]);
    }
    $codes = []; $h = []; $loc = null;
    // блоки заголовков подряд: редиректы (-L) и «HTTP/1.1 200 Connection established» прокси; тело — после последнего
    while (count($codes) < 12 && preg_match('~^HTTP/[\d.]+\s+(\d{3})[^\r\n]*\r?\n~', $raw, $m)) {
      $a = strpos($raw, "\r\n\r\n"); $b = strpos($raw, "\n\n");
      $end = $a === false ? ($b === false ? strlen($raw) : $b + 2) : ($b === false || $a < $b ? $a + 4 : $b + 2);
      $block = substr($raw, 0, $end); $raw = (string)substr($raw, $end);
      $codes[] = (int)$m[1]; $h = [];
      foreach (preg_split('/\r?\n/', $block) as $ln) if (preg_match('/^([A-Za-z0-9\-]+):\s*(.*)$/', $ln, $mm)) $h[strtolower($mm[1])] = mb_substr(trim($mm[2]), 0, 200);
      if (isset($h['location'])) $loc = $h['location'];   // куда вёл последний редирект
    }
    return ['codes' => $codes, 'h' => $h, 'body' => $raw, 'w' => $w, 'loc' => $loc];
  }
  /** Адрес без запроса: host + path (страницы публичные — цифры не прячем). */
  private static function loc(string $u, string $from): string {
    $a = CabWeb::abs(trim($u), $from); $p = parse_url($a);
    $same = strcasecmp((string)($p['host'] ?? ''), (string)parse_url($from, PHP_URL_HOST)) === 0;
    return mb_substr(($same ? '' : (string)($p['host'] ?? '')) . (string)($p['path'] ?? '/'), 0, 120);
  }
  /** Разбор одной страницы. → структура без слов страницы (кроме заголовка <title> публичного сайта). */
  public static function analyze(string $t, string $raw): array {
    $s = self::split($raw); $body = $s['body']; $url = self::T[$t]['url'];
    $code = $s['codes'] ? (int)end($s['codes']) : (int)($s['w']['code'] ?? 0);
    $o = ['v' => self::V, 'code' => $code, 'codes' => $s['codes'], 'len' => strlen($body)] + ($s['w'] ? ['w' => $s['w']] : []);
    if (count($s['codes']) > 1 && $s['loc'] !== null) $o['final'] = self::loc((string)$s['loc'], $url);
    $hh = array_filter(['server' => strtolower((string)($s['h']['server'] ?? '')), 'cf-mitigated' => strtolower((string)($s['h']['cf-mitigated'] ?? ''))], fn($v) => $v !== '');
    if ($hh) $o['h'] = $hh;
    if (isset($s['h']['cf-ray'])) $o['cfRay'] = true;
    $o += CabWeb::captcha($body, $code);
    $o += CabWeb::cfKind($body, $code, $hh);
    // чья капча: ключ на странице (data-sitekey) или скрипт; reCAPTCHA v3 (render=6L…) — невидимая, тоже капча
    if (preg_match_all('/data-sitekey=["\']([^"\']+)/i', $body, $m)) foreach ($m[1] as $k) if ($kk = CabProbe::captchaKind($k)) { $o['captchaKind'] = $kk; break; }
    if (!isset($o['captchaKind'])) $o['captchaKind'] = match (true) {
      (bool)preg_match('~challenges\.cloudflare\.com/turnstile~i', $body) => 'turnstile', (bool)preg_match('~hcaptcha\.com/1/api\.js~i', $body) => 'hcaptcha',
      (bool)preg_match('~recaptcha/(?:api|enterprise)\.js\?[^"\']*render=6L~i', $body) => 'recaptcha3', (bool)preg_match('~recaptcha/(?:api|enterprise)\.js~i', $body) => 'recaptcha', default => null };
    if ($o['captchaKind'] === null) unset($o['captchaKind']);
    $o['form'] = false;
    if ($body !== '' && preg_match('/<(?:html|body|form|div|input)\b/i', $body)) {
      $x = CabWeb::dom($body);
      if (($tn = $x->query('//title')->item(0)) && ($tt = CabWeb::sp($tn->textContent)) !== '') $o['title'] = mb_substr($tt, 0, 90);
      $fieldOf = function (DOMElement $i): ?string {
        $tag = strtolower($i->nodeName); $nm = (string)$i->getAttribute('name');
        if ($nm === '' && $tag !== 'button') return null;
        $type = $tag === 'input' ? strtolower($i->getAttribute('type') ?: 'text') : $tag;
        return $type . ':' . mb_substr($nm !== '' ? $nm : '(' . ($i->getAttribute('id') ?: 'button') . ')', 0, 50) . ($i->hasAttribute('required') ? '*' : '');
      };
      $forms = []; $best = null; $bestN = -1; $visible = 0;
      foreach ($x->query('//form') as $f) {
        $fs = []; $vis = 0;
        foreach ($x->query('.//input|.//select|.//textarea|.//button', $f) as $i) if ($i instanceof DOMElement && ($fd = $fieldOf($i)) !== null) { $fs[] = $fd; if (preg_match('/^(text|number|tel|email|password|search|textarea|select):/', $fd)) $vis++; }
        $id = (string)$f->getAttribute('id'); if ($id !== '') foreach ($x->query("//*[@form='" . str_replace("'", '', $id) . "']") as $i) if ($i instanceof DOMElement && ($fd = $fieldOf($i)) !== null) { $fs[] = $fd; $vis++; }
        $forms[] = array_filter(['id' => mb_substr($id, 0, 40) ?: null, 'action' => self::loc((string)($f->getAttribute('action') ?: $url), $url), 'method' => strtolower($f->getAttribute('method') ?: 'get'), 'n' => count($fs), 'fields' => array_slice($fs, 0, 30)], fn($v) => $v !== null);
        if ($vis > $bestN) { $bestN = $vis; $best = $f; } $visible = max($visible, $vis);
        if (count($forms) >= 8) break;
      }
      $o['forms'] = $forms;
      // поля вне <form> — форма на JS (собирает и шлёт сама)
      $loose = []; foreach ($x->query('//input[not(ancestor::form)][not(@form)]|//select[not(ancestor::form)][not(@form)]|//textarea[not(ancestor::form)][not(@form)]') as $i) if ($i instanceof DOMElement && ($fd = $fieldOf($i)) !== null) $loose[] = $fd;
      if ($loose) $o['loose'] = array_slice(array_values(array_unique($loose)), 0, 25);
      $u = fn(array $a, int $n) => array_slice(array_values(array_unique(array_filter($a, fn($v) => $v !== ''))), 0, $n);
      $sc = []; foreach ($x->query('//script[@src]') as $e) $sc[] = self::loc((string)$e->getAttribute('src'), $url);
      $o['scripts'] = $u($sc, 20);
      $aj = []; foreach ($x->query('//script[not(@src)]') as $e) if (preg_match_all('~["\'](?:https?://([a-z0-9.\-]+))?(/[a-z][a-z0-9_\-]*(?:/[a-z0-9_\-.]+)+)(?:\?[^"\']*)?["\']~i', $e->textContent, $mm, PREG_SET_ORDER)) foreach ($mm as $q) $aj[] = ($q[1] ?? '') . $q[2];
      $o['ajax'] = $u($aj, 20);
      $fr = []; foreach ($x->query('//iframe[@src]') as $e) $fr[] = self::loc((string)$e->getAttribute('src'), $url);
      if ($fr) $o['frames'] = $u($fr, 6);
      $re = self::T[$t]['form'];
      // кабинет — по полю пароля; онлайн-форма — есть форма (или поля вне форм) хотя бы с одним полем для ввода
      $o['form'] = $re ? (bool)preg_match($re, $body) : ($visible > 0 || (bool)array_filter($loose, fn($fd) => (bool)preg_match('/^(text|number|tel|search|textarea|select):/', $fd)));
      $root = $best ? $best->parentNode : null;
      if ($root instanceof DOMElement) $o['skel'] = mb_substr(VkCab::skel($root, '', '', 0), 0, 8000);
    }
    $o['verdict'] = match (true) {
      $code === 0 && $o['len'] === 0 => 'down',
      isset($o['cfKind']) => 'cloudflare',
      !empty($o['widget']) || in_array($o['captchaKind'] ?? '', ['turnstile', 'hcaptcha', 'recaptcha3'], true) => 'captcha',
      $code === 200 && $o['form'] => 'ok',
      $code === 200 => 'noform',
      default => 'other',
    };
    return $o;
  }
  /** POST /api/relay/probe?t=obl|form&via=nas — вывод curl с NAS. → короткий итог (его видно в Терминале / журнале задачи DSM). */
  public static function accept(string $t, string $raw, string $cc, string $via): array {
    if (!isset(self::T[$t])) throw new HttpError(422, 'bad_target', ['targets' => array_keys(self::T)]);
    $o = self::analyze($t, $raw);
    $j = self::load(); $prev = (array)($j[$t] ?? []);
    $o = ['at' => gmdate('c'), 'cc' => (preg_match('/^[A-Z]{2}$/', strtoupper($cc)) ? strtoupper($cc) : null), 'via' => (substr((string)preg_replace('/[^a-z0-9]/', '', strtolower($via)), 0, 12) ?: null), 'n' => (int)($prev['n'] ?? 0) + 1] + $o;
    @mkdir(self::dir(), 0700, true); @file_put_contents(self::rawFile($t), $raw, LOCK_EX);
    $j[$t] = $o; self::save($j);
    return ['ok' => true, 't' => $t, 'verdict' => $o['verdict'], 'code' => $o['code'], 'cc' => $o['cc']] + (isset($o['cfKind']) ? ['cfKind' => $o['cfKind']] : []) + (isset($o['captchaKind']) ? ['captcha' => $o['captchaKind']] : []);
  }
  /** Все пробы; разобранные старой версией — перечитать из сохранённого вывода (время, страна, via — прежние). */
  public static function read(): array {
    $j = self::load(); $ch = false;
    foreach (array_keys(self::T) as $t) {
      if (!isset($j[$t]) || (int)($j[$t]['v'] ?? 0) === self::V || !is_file(self::rawFile($t))) continue;
      $j[$t] = array_intersect_key($j[$t], array_flip(['at', 'cc', 'via', 'n'])) + self::analyze($t, (string)@file_get_contents(self::rawFile($t))); $ch = true;
    }
    if ($ch) self::save($j);
    return $j;
  }
  /** /api/health → uaProbe: без скелета формы (он — в GET /api/relay/probe?t=). */
  public static function summary(): array {
    $out = []; foreach (self::read() as $t => $o) if (isset(self::T[$t]) && is_array($o)) { unset($o['skel']); $out[$t] = $o; }
    return $out;
  }
  public static function one(string $t): array { if (!isset(self::T[$t])) throw new HttpError(422, 'bad_target', ['targets' => array_keys(self::T)]); return ['t' => $t, 'url' => self::T[$t]['url'], 'probe' => self::read()[$t] ?? null, 'command' => self::command(Cfg::appUrlKnown() ? Cfg::appUrl() : 'https://peredai.com.ua')]; }
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
  /** главная кабинета после входа (url, body) — для осмотра (explore) */
  public ?array $home = null;
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
    if (str_contains($r['body'], '/cabinet/logout')) { $this->home = $r; return $r; }
    $m = self::msgs(CabWeb::dom($r['body']));
    throw new CabErr('bad_login', implode(' ', array_slice($m['err'], 0, 2)));
  }
  /** Выйти (вежливо: не оставлять сессий робота на сайте ХТМ); ошибки не важны. */
  public function logout(): void { try { if ($this->w->jar) $this->w->req('GET', self::base() . '/cabinet/logout'); } catch (Throwable $e) {} }
  /** Особові рахунки кабинета: [['acc' => '…', 'sur' => 'ПРІЗВИЩЕ']] — из ссылок /cabinet/{рахунок}/{прізвище}. */
  public function accounts(array $home): array {
    $out = [];
    $pages = [$home];
    try { $pages[] = $this->get('/cabinet/list'); }
    catch (CabErr $e) { if ($e->err !== 'down' || !preg_match('~href="(?:https?://[^"/]+)?/cabinet/(?:heat/)?\d{4,14}/~', (string)$home['body'])) throw $e; }   // список не открылся, но рахунки видны на главной
    foreach ($pages as $r) {
      if (!preg_match_all('~href="(?:https?://[^"/]+)?/cabinet/(?:heat/)?(\d{4,14})/([^"/?#]+)"~u', $r['body'], $m, PREG_SET_ORDER)) continue;
      foreach ($m as $x) { $sur = rawurldecode(html_entity_decode($x[2])); if (!isset($out[$x[1]])) $out[$x[1]] = ['acc' => $x[1], 'sur' => $sur]; }
    }
    return array_values($out);
  }
  private static function url(string $acc, string $sur, string $what = 'heat'): string { return self::base() . '/cabinet/' . $what . '/' . rawurlencode($acc) . '/' . rawurlencode(mb_strtoupper($sur)); }
  /** Страница тепла: прибор, последние принятые, открыта ли форма, журнал. */
  public function heat(string $acc, string $sur): array {
    $r = $this->get(self::url($acc, $sur)); $x = CabWeb::dom($r['body']); $txt = CabWeb::sp($x->document->textContent ?? '');
    $o = ['url' => $r['url'], 'meter' => null, 'base' => [], 'open' => false, 'closed' => null, 'min' => null, 'max' => null, 'win' => null, 'journal' => [], 'fields' => [], 'html' => $r['body']];
    foreach ($x->query('//h1|//h2|//h3|//h4|//caption|//div[contains(@class,"title")]') as $hn) {   // «ВІДОМІСТЬ … НА dd.mm.yyyy: ПУ <модель>, №<номер>»
      if (preg_match('/ПУ\s+([^,№]{2,40}?),?\s*№\s*([\w\-\/\.]{2,30})\s*$/u', CabWeb::sp($hn->textContent), $m)) { $o['meter'] = ['model' => trim($m[1]), 'serial' => trim($m[2])]; break; }
    }
    foreach (self::F as $k => $id) { $n = $x->query("//*[@id='head_$id']")->item(0); if ($n) $o['base'][$k] = CabWeb::sp($n->textContent); }
    // окно дат формы: «min_date = '05.11.2026'» (снятие 01.11); на живом 06.11 так не нашлось — терпимо к кавычкам, minDate:, startDate: (bootstrap-datepicker),
    // «2026-11-05»; и атрибуты самого поля даты (min/max, data-min-date, data-date-start-date). Не нашли — окно считает HtmSvc по календарю (1-е число … сегодня).
    $D = '["\']?(\d{1,4}[.\/-]\d{1,2}[.\/-]\d{2,4})';
    foreach (['min' => 'min_?date|start_?date', 'max' => 'max_?date|end_?date'] as $k => $re) if (preg_match('/\b(?:' . $re . ')["\']?\s*[=:]\s*(?:new\s+Date\(\s*)?' . $D . '/i', $r['body'], $m)) { $o[$k] = self::dmy($m[1]); $o['win'] = 'js'; }
    $dn = $x->query("//input[@name='" . self::F['date'] . "' or @id='" . self::F['date'] . "']")->item(0);
    if ($dn instanceof DOMElement) foreach (['min' => ['min', 'data-min-date', 'data-date-start-date', 'data-mindate'], 'max' => ['max', 'data-max-date', 'data-date-end-date', 'data-maxdate']] as $k => $attrs)
      foreach ($attrs as $at) if ($o[$k] === null && preg_match('/^\s*' . substr($D, 5) . '\s*$/', (string)$dn->getAttribute($at), $m)) { $o[$k] = self::dmy($m[1]); $o['win'] = 'attr'; }
    // для сверки: как страница задаёт окно дат (куски скриптов рядом с min/max/datepicker, без личных данных — только даты и слова)
    $o['dateJs'] = [];
    if (preg_match_all('/[^;{}\n]{0,60}\b(?:min_?date|max_?date|start_?date|end_?date|datetimepicker|datepicker)\b[^;{}\n]{0,80}/iu', $r['body'], $mm)) foreach (array_slice(array_unique($mm[0]), 0, 4) as $sn) $o['dateJs'][] = mb_substr(CabWeb::sp((string)preg_replace('/\d{5,}/u', '#', $sn)), 0, 150);
    if ($dn instanceof DOMElement) { $a = []; foreach ($dn->attributes as $at) if (!in_array($at->name, ['value', 'name', 'id'], true)) $a[] = $at->name . (preg_match('/date|min|max/i', $at->name) ? '=' . mb_substr(preg_replace('/\d{5,}/', '#', $at->value), 0, 30) : ''); if ($a) $o['dateJs'][] = 'input: ' . implode(' ', array_slice($a, 0, 10)); }
    $al = self::msgs($x); $o['alerts'] = ['err' => count($al['err']), 'ok' => count($al['ok'])];   // постоянные плашки страницы — только сколько (сверка с живым)
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
  /** Месяц квитанции по тексту: «жовтень 2026», «за октябрь 2026», «2026-10», «10.2026», «202610» → «2026-10»; не нашли — null. */
  public static function monthOf(string $s): ?string {
    $names = ['01' => 'січ|январ', '02' => 'лют|феврал', '03' => 'берез|март', '04' => 'квіт|апрел', '05' => 'трав|ма[йя]', '06' => 'черв|июн', '07' => 'лип|июл', '08' => 'серп|август',
      '09' => 'верес|сентябр', '10' => 'жовт|октябр', '11' => 'листоп|ноябр', '12' => 'груд|декабр'];
    $best = null;
    foreach ($names as $mm => $re) if (preg_match('/(?<![\p{L}])(?:' . $re . ')[\p{L}]*\s+(20\d\d)(?!\d)/iu', $s, $m, PREG_OFFSET_CAPTURE) && ($best === null || $m[0][1] < $best[0])) $best = [$m[0][1], $m[1][0] . '-' . $mm];
    if ($best) return $best[1];
    if (preg_match('/(?<!\d)(20\d\d)[-_.\/]?(0[1-9]|1[0-2])(?![\d])/', $s, $m)) return $m[1] . '-' . $m[2];
    if (preg_match('/(?<![\d.])(0[1-9]|1[0-2])[._\/-](20\d\d)(?!\d)/', $s, $m)) return $m[2] . '-' . $m[1];
    return null;
  }
  /** Насколько ссылка похожа на квитанцию: 0 — нет; рамка/embed — выше всех (решает вызывающий), «.pdf», «квитанція», «друк» — 2, «рахунок за…» — 1. */
  public static function billish(string $href, string $text): int {
    if (preg_match('~\.pdf\b|pdf|kvit|kvyt|invoice|receipt|print|druk~i', $href) || preg_match('/квитанц|квітанц|рахунок[- ]повідомлен|платіжк|роздрук|друк|pdf/iu', $text)) return 2;
    return preg_match('~rahunok|rakhunok|/bill~i', $href) || preg_match('/рахун(ок|ку)\s+за\b|завантажити/iu', $text) ? 1 : 0;
  }
  /** Осмотр кабинета для сверки (только чтение): главная, карточка рахунку, платежи и похожие разделы — какие ссылки, рамки, заголовки таблиц;
   *  первая ссылка, похожая на квитанцию, — GET и что пришло (PDF ли, размер, тип). Ничего не нажимаем: POST, logout, add, remove — никогда.
   *  Без личных данных: рахунок и прізвище в адресах и текстах → {acc}/{sur}, цифры → #. $pages — уже открытые страницы [путь => html].
   *  $ym — нужный месяц квитанции («2026-10»): ссылка с этим месяцем в тексте/строке таблицы/адресе — первой.
   *  → ['pages' => [...], 'bill' => {...}|null, 'billBody' => ?string, 'billRaw' => {u, txt, row, disp} (сам PDF и сырой текст — только вызывающему, не в журнал)] */
  public function explore(array $pages, string $acc, string $sur, ?string $ym = null): array {
    $base = self::base(); $surU = mb_strtoupper($sur);
    $mp = function (string $u) use ($acc, $sur, $surU): string {
      $p = (string)(parse_url($u, PHP_URL_PATH) ?: '/'); $q = (string)(parse_url($u, PHP_URL_QUERY) ?? '');
      $p = rawurldecode($p); $q = rawurldecode($q);
      foreach ([[$acc, '{acc}'], [$surU, '{sur}'], [$sur, '{sur}']] as [$k, $v]) if ($k !== '') { $p = str_ireplace($k, $v, $p); $q = str_ireplace($k, $v, $q); }
      $p = preg_replace('/\d/', '#', $p); $q = preg_replace('/\d/', '#', $q);
      return mb_substr($p . ($q !== '' ? '?' . $q : ''), 0, 120);
    };
    $mt = function (string $t, int $n = 50) use ($sur, $surU): string { $t = CabWeb::sp($t); foreach ([$surU, $sur] as $k) if ($k !== '') $t = str_ireplace($k, '{sur}', $t); return CabWeb::mask($t, $n); };
    $safe = fn(string $u) => $this->w->sameSite($u) && preg_match('~^/cabinet(/|$)~', (string)parse_url($u, PHP_URL_PATH)) && !preg_match('~logout|/add\b|remove|delete|/del\b|settings|/heat/~i', (string)parse_url($u, PHP_URL_PATH));
    $out = ['pages' => [], 'bill' => null, 'billBody' => null]; $cands = []; $seen = [];
    $scan = function (string $url, string $html, int $code) use (&$out, &$cands, &$seen, $mp, $mt, $acc) {
      $x = CabWeb::dom($html); $pg = ['p' => $mp($url), 'code' => $code, 'title' => $mt((string)($x->query('//title')->item(0)?->textContent ?? ''), 80), 'links' => [], 'frames' => [], 'th' => [], 'say' => [], 'forms' => []];
      foreach ($x->query('//a[@href]') as $a) {
        $href = trim((string)$a->getAttribute('href')); if ($href === '' || $href[0] === '#' || preg_match('/^(javascript|mailto|tel):/i', $href)) continue;
        $abs = CabWeb::abs($href, $url); $k = $mp($abs); $txt = CabWeb::sp($a->textContent);
        $own = preg_match('~^/cabinet/\{acc\}/\{sur\}/?$~', $k);   // ссылка на свой рахунок — текст (адрес) не пишем
        if (count($pg['links']) < 40 && !isset($seen[$url . '|' . $k])) { $seen[$url . '|' . $k] = 1; $pg['links'][] = [$k, $own || mb_strlen($txt) > 60 ? '' : $mt($txt, 40)]; }
        if ($sc = self::billish($href, $txt)) {
          $row = $a; while ($row && !in_array(strtolower($row->nodeName), ['tr', 'li', 'p', 'div'], true)) $row = $row->parentNode;   // строка таблицы рядом: «Жовтень 2026 … Квитанція»
          $cands[] = ['u' => $abs, 'k' => $k, 'how' => 'a', 'txt' => $mt($txt, 40), 'sc' => $sc, 'raw' => ['txt' => mb_substr($txt, 0, 120), 'row' => $row ? mb_substr(CabWeb::sp(implode(' ', array_map(fn($t) => $t->nodeValue, iterator_to_array($x->query('.//text()', $row))))), 0, 200) : '']];
        }
        $out['_next'][] = $abs;
      }
      foreach ($x->query('//iframe[@src]|//embed[@src]|//object[@data]') as $f) {
        $src = trim((string)($f->getAttribute('src') ?: $f->getAttribute('data'))); if ($src === '') continue;
        $abs = CabWeb::abs($src, $url); $pg['frames'][] = $f->nodeName . ' ' . $mp($abs);
        $cands[] = ['u' => $abs, 'k' => $mp($abs), 'how' => $f->nodeName, 'txt' => '', 'sc' => 3, 'raw' => ['txt' => '', 'row' => mb_substr(CabWeb::sp((string)($x->query('//h1|//h2|//h3')->item(0)?->textContent ?? '')), 0, 200)]];
      }
      foreach ($x->query('//form') as $f) $pg['forms'][] = strtoupper((string)($f->getAttribute('method') ?: 'get')) . ' ' . $mp(CabWeb::abs((string)($f->getAttribute('action') ?: $url), $url)) . ' ' . implode(',', array_slice(array_map(fn($i) => (string)$i->getAttribute('name'), iterator_to_array($x->query('.//input[@name]|.//select[@name]|.//button[@name]', $f))), 0, 10));
      foreach ($x->query('//th') as $th) { $t = $mt($th->textContent, 40); if ($t !== '' && count($pg['th']) < 20) $pg['th'][] = $t; }
      $txt = CabWeb::sp(implode(' ', array_map(fn($t) => $t->nodeValue, iterator_to_array($x->query('//body//text()[not(ancestor::script) and not(ancestor::style)]')))));   // ячейки — через пробел
      if (preg_match_all('/[^.!?\n]{0,40}(?:квитанц|рахунок\s+за|рахунку\s+за|сформ|друк|завантаж|нараховано|до\s+сплати|сплачено|борг)[^.!?\n]{0,40}/iu', $txt, $m)) foreach (array_slice(array_unique($m[0]), 0, 6) as $sn) $pg['say'][] = $mt($sn, 90);
      $pg['forms'] = array_slice($pg['forms'], 0, 6);
      $out['pages'][] = $pg;
    };
    foreach ($pages as $u => $html) $scan((string)$u, (string)$html, 200);
    // карточка рахунку и разделы «платежі / рахунки / квитанції» — не больше 4 страниц
    $card = $base . '/cabinet/' . rawurlencode($acc) . '/' . rawurlencode($surU);
    $todo = [$card]; $done = array_map('strval', array_keys($pages));
    foreach ((array)($out['_next'] ?? []) as $u) if ($safe($u) && preg_match('~/cabinet/(payments?|pay|rahun\w*|kvit\w*|bill\w*|invoice\w*|spr-teplo|spravka|sprvds|nach\w*|saldo|borg)~i', (string)parse_url($u, PHP_URL_PATH))) $todo[] = $u;
    $n = 0; $i = 0;
    while ($i < count($todo)) {
      $u = $todo[$i++];
      if ($n >= 4 || $this->w->left() < 9) break;
      if (in_array($u, $done, true) || !$safe($u)) continue;
      if (array_filter($cands, fn($c) => $c['u'] === $u && $c['sc'] >= 2)) continue;   // похожее на квитанцию — не страница: откроем ниже как файл
      $done[] = $u; $n++; $out['_next'] = [];
      try { $r = $this->get($u); } catch (CabErr $e) { $out['pages'][] = ['p' => $mp($u), 'err' => $e->err]; continue; }
      $done[] = $r['url'];
      $scan($r['url'], $r['body'], (int)$r['code']);
      foreach ((array)($out['_next'] ?? []) as $u2) if ($safe($u2) && preg_match('~/cabinet/(payments?|rahun\w*|kvit\w*|bill\w*|invoice\w*|spravka|sprvds)~i', (string)parse_url($u2, PHP_URL_PATH)) && !in_array($u2, $todo, true)) $todo[] = $u2;
    }
    unset($out['_next']);
    // квитанция: самые похожие ссылки с сайта ХТМ (рамка/embed — первыми), не больше 2 GET; уже открытые страницы — не в счёт
    $out['tried'] = []; $uniq = [];
    while (count($out['tried']) < 3 && $this->w->left() >= 7) {
      $c = null;   // самая похожая из ещё не открытых (рамки страницы-обёртки, найденные по дороге, — тоже)
      $score = fn($x) => $x['sc'] * 10 + ($ym !== null && self::monthOf($x['raw']['txt'] . ' | ' . $x['raw']['row'] . ' | ' . rawurldecode($x['u'])) === $ym ? 5 : 0);
      foreach ($cands as $x) if (!isset($uniq[$x['u']]) && !in_array($x['u'], $done, true) && $this->w->sameSite($x['u']) && !preg_match('~logout|/add\b|remove|delete~i', $x['u']) && ($c === null || $score($x) > $score($c))) $c = $x;
      if (!$c) break;
      $uniq[$c['u']] = 1;
      try { $r = $this->get($c['u']); } catch (CabErr $e) { $out['tried'][] = ['p' => $c['k'], 'how' => $c['how'], 'err' => $e->err]; continue; }
      $b = (string)$r['body']; $pdf = str_starts_with($b, '%PDF-');
      $t = ['p' => $c['k'], 'how' => $c['how'], 'txt' => $c['txt'], 'code' => (int)$r['code'], 'type' => mb_substr((string)($r['h']['content-type'] ?? ''), 0, 60), 'pdf' => $pdf, 'bytes' => strlen($b),
        'disp' => $mt((string)($r['h']['content-disposition'] ?? ''), 80), 'html' => $pdf ? null : $mt((string)(CabWeb::dom($b)->query('//title')->item(0)?->textContent ?? ''), 60)];
      $out['tried'][] = $t; $done[] = $r['url'];
      if ($pdf) { $out['bill'] = $t; $out['billBody'] = $b; $out['billRaw'] = $c['raw'] + ['u' => rawurldecode($c['u']), 'disp' => (string)($r['h']['content-disposition'] ?? '')]; break; }
      if ($r['code'] === 200 && $b !== '') $scan($r['url'], $b, 200);   // страница-обёртка квитанции: её рамки и ссылки — тоже кандидаты
    }
    unset($out['_next']); $out['cands'] = count($cands);
    return $out;
  }
  /** Рахунок из кабинета (живой кабинет, осмотр 07.11.2026): на главной «Сформувати рахунок» → /cabinet/bill/print/{acc}/{sur} — HTML-страница
   *  «Рахунок за <місяць> <рік> року» с кнопками «Друкувати» / «Назад». PDF кабинет не отдаёт: «Зберегти рахунок в PDF» (?hint=pdf) — та же страница
   *  с подсказкой «Друкувати → Зберегти як PDF». Только GET. → ['url', 'html' (UTF-8), 'title', 'ym', 'text', 'pay'] | null (не рахунок / месяц не понять). */
  /** «Довідка по теплу» (/cabinet/spr-teplo/{acc}/{sur}, 08.11): по місяцях — показання, різниця, теплові втрати й усього по будинку, площі, витрата по квартирі,
   *  нараховано, абонплата, пільга, надходження. Тільки читання. Колонки — за текстом заголовків (порядок може змінитись).
   *  → ['rows' => [{ym, prev, cur, diff, loss, house, sHouse, sFlat, flat, cost, abon, lgota, paid, unit}], 'cols' => [ключі, що знайшли], 'fmt' => {ym, num} (маска, без цифр)] | null */
  public function sprTeplo(string $acc, string $sur): ?array {
    $r = $this->get(self::url($acc, $sur, 'spr-teplo'));
    if ($r['code'] !== 200 || $r['body'] === '') return null;
    return self::parseSpr($r['body']);
  }
  const SPR = ['ym' => '/місяць/iu', 'unit' => '/одиниц/iu', 'prev' => '/попередн/iu', 'cur' => '/поточн/iu', 'diff' => '/різниц/iu', 'loss' => '/втрат/iu', 'house' => '/по\s*будинку/iu',
    'sHouse' => '/площа\s+будинку/iu', 'sFlat' => '/площа\s+квартир/iu', 'flat' => '/витрата\s+по\s+квартир/iu', 'cost' => '/нараховано/iu', 'abon' => '/абонент/iu', 'lgota' => '/пільг/iu', 'paid' => '/надходж/iu'];
  public static function num(string $s): ?float {
    $s = str_replace(["\u{a0}", "\u{202f}", ' '], '', trim($s)); if ($s === '' || $s === '-' || $s === '—') return null;
    $s = str_replace(',', '.', $s); return is_numeric($s) ? (float)$s : null;
  }
  public static function parseSpr(string $html): ?array {
    $x = CabWeb::dom($html); $best = null;
    foreach ($x->query('//table') as $tb) {
      $ths = []; foreach ($x->query('.//th', $tb) as $th) $ths[] = CabWeb::sp($th->textContent);
      if (!$ths) { $tr0 = $x->query('.//tr', $tb)->item(0); if ($tr0) foreach ($x->query('./td', $tr0) as $td) $ths[] = CabWeb::sp($td->textContent); }
      $map = []; foreach ($ths as $i => $t) foreach (self::SPR as $k => $re) if (!isset($map[$k]) && preg_match($re, $t)) { $map[$k] = $i; break; }
      if (isset($map['ym'], $map['flat']) && (!$best || count($map) > count($best[1]))) $best = [$tb, $map, count($ths)];
    }
    if (!$best) return null;
    [$tb, $map, $nc] = $best; $rows = []; $fmt = ['ym' => null, 'num' => null];
    foreach ($x->query('.//tr', $tb) as $tr) {
      $tds = []; foreach ($x->query('./td', $tr) as $td) $tds[] = CabWeb::sp($td->textContent);
      if (count($tds) < max(3, count($map) - 2)) continue;
      // строки короче шапки (первая ячейка объединена) — выравниваем по правому краю
      $off = count($tds) < $nc ? count($tds) - $nc : 0;
      $cell = function (string $k) use ($tds, $map, $off) { $i = ($map[$k] ?? -99) + $off; return $i >= 0 && isset($tds[$i]) ? $tds[$i] : null; };
      $mc = (string)($tds[$map['ym']] ?? ''); $ym = preg_match('/^(\d{1,2})\.(\d{1,2})\.(20\d\d)$/', $mc, $m) ? $m[3] . '-' . str_pad($m[2], 2, '0', STR_PAD_LEFT) : self::monthOf($mc);
      if ($ym === null && preg_match('/^(\d{1,2})[.\/](20\d\d)$/', $mc, $m)) $ym = $m[2] . '-' . str_pad($m[1], 2, '0', STR_PAD_LEFT);
      if ($ym === null) continue;
      $row = ['ym' => $ym];
      foreach (array_keys(self::SPR) as $k) if (!in_array($k, ['ym', 'unit'], true)) { $c = $cell($k); $row[$k] = $c === null ? null : self::num($c); }
      $u = $cell('unit'); if ($u !== null && $u !== '') $row['unit'] = mb_substr($u, 0, 12);
      $fmt['ym'] = $fmt['ym'] ?? CabWeb::mask($mc, 20); if ($fmt['num'] === null && ($c = $cell('flat')) !== null && $c !== '') $fmt['num'] = CabWeb::mask($c, 20);
      $rows[] = $row;
    }
    usort($rows, fn($a, $b) => strcmp($a['ym'], $b['ym']));
    // структура таблицы без чисел (живая довідка 08.11: втрати/по будинку скачут по месяцам — разобрать, где съезжают колонки):
    // заголовки с colspan/rowspan, сколько строк шапки, по строкам — число ячеек и маски (цифры → #)
    $sp = function ($n) { $c = (int)$n->getAttribute('colspan'); $r = (int)$n->getAttribute('rowspan'); return ($c > 1 ? ' [c' . $c . ']' : '') . ($r > 1 ? ' [r' . $r . ']' : ''); };
    $heads = []; foreach ($x->query('.//th', $tb) as $th) $heads[] = mb_substr(CabWeb::sp($th->textContent), 0, 40) . $sp($th);
    $shape = ['nc' => $nc, 'heads' => $heads, 'thRows' => $x->query('.//tr[th]', $tb)->length, 'map' => $map, 'rows' => []];
    foreach ($x->query('.//tr[td]', $tb) as $i => $tr) {
      if (count($shape['rows']) >= 8) break; $cs = [];
      foreach ($x->query('./td', $tr) as $td) $cs[] = CabWeb::mask($td->textContent, 16) . $sp($td);
      $shape['rows'][] = count($cs) . ': ' . implode(' | ', $cs);
    }
    return ['rows' => array_slice($rows, -36), 'cols' => array_keys($map), 'fmt' => $fmt, 'shape' => $shape];
  }
  public function billPage(string $acc, string $sur): ?array {
    $u = null;
    if (!empty($this->home['body'])) foreach (CabWeb::dom((string)$this->home['body'])->query('//a[@href]') as $a) {
      $h = CabWeb::abs(trim((string)$a->getAttribute('href')), (string)$this->home['url']);
      if (preg_match('~^/cabinet/bill/print/~i', (string)parse_url($h, PHP_URL_PATH)) && !str_contains((string)parse_url($h, PHP_URL_QUERY), 'pdf') && $this->w->sameSite($h)) { $u = $h; break; }
    }
    $r = $this->get($u ?? self::url($acc, $sur, 'bill/print'));
    if ($r['code'] !== 200 || $r['body'] === '' || str_starts_with($r['body'], '%PDF-')) return null;
    $x = CabWeb::dom($r['body']); $title = CabWeb::sp((string)($x->query('//title')->item(0)?->textContent ?? ''));
    $text = CabWeb::sp(implode(' ', array_map(fn($t) => $t->nodeValue, iterator_to_array($x->query('//body//text()[not(ancestor::script) and not(ancestor::style)]')))));
    $head = $title . ' | ' . mb_substr($text, 0, 400);
    if (!preg_match('/рахун(ок|ку)\s+(за\s+послуг\S*\s+)?за\s/iu', $head)) return null;
    $ym = self::monthOf($title) ?? self::monthOf(mb_substr($text, 0, 400));
    if ($ym === null) return null;
    $pay = preg_match('/до\s+сплати\D{0,30}?(-?\d[\d\x{a0} ]{0,9}(?:[.,]\d{1,2})?)/iu', $text, $m) ? str_replace([',', ' ', "\u{a0}"], ['.', '', ''], $m[1]) : null;
    return ['url' => $r['url'], 'html' => $r['body'], 'title' => $title, 'ym' => $ym, 'text' => $text, 'pay' => $pay !== null && is_numeric($pay) ? $pay : null];
  }
  private static function cleanCss(string $c): string {
    $c = preg_replace('~@import[^;]*;?|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding|</?style~i', '', $c);
    return mb_substr((string)$c, 0, 300000);
  }
  /** Копия рахунку в историю: самостоятельная страница — без скриптов, кнопок, форм и ссылок; стили (link) и картинки сайта ХТМ — внутри (data:),
   *  пока сессия кабинета жива (до logout). Отдаём со своего сервера под CSP sandbox (index.php): ни скриптов, ни запросов наружу.
   *  $b — billPage(). → ['html', 'css' => n, 'img' => n] */
  public function billDoc(array $b): array {
    $x = CabWeb::dom((string)$b['html']); $d = $x->document; $css = []; $nimg = 0; $got = 0;
    foreach (iterator_to_array($x->query('//link[@href]')) as $l) {
      if (!preg_match('/stylesheet/i', (string)$l->getAttribute('rel')) || count($css) >= 3 || $this->w->left() < 6) continue;
      $u = CabWeb::abs(trim((string)$l->getAttribute('href')), (string)$b['url']); if (!$this->w->sameSite($u)) continue;
      try { $r = $this->w->req('GET', $u); if ($r['code'] === 200 && strlen($r['body']) < 400000 && !preg_match('~<(html|script|body)\b~i', $r['body'])) $css[] = self::cleanCss($r['body']); } catch (Throwable $e) {}
    }
    foreach (iterator_to_array($x->query('//style')) as $st) $css[] = self::cleanCss((string)$st->textContent);
    foreach (iterator_to_array($x->query('//img')) as $im) {
      $src = trim((string)$im->getAttribute('src')); $data = null;
      if (preg_match('~^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$~i', $src)) $data = $src;
      elseif ($src !== '' && $nimg < 8 && $this->w->left() >= 6) {
        $u = CabWeb::abs($src, (string)$b['url']);
        if ($this->w->sameSite($u)) {
          $nimg++;
          try {
            $r = $this->w->req('GET', $u); $info = $r['code'] === 200 && strlen($r['body']) < 400000 ? @getimagesizefromstring($r['body']) : false;
            if ($info && in_array($info['mime'] ?? '', ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], true)) { $data = 'data:' . $info['mime'] . ';base64,' . base64_encode($r['body']); $got++; }
          } catch (Throwable $e) {}
        }
      }
      foreach (iterator_to_array($im->attributes) as $at) if (!in_array(strtolower($at->name), ['alt', 'width', 'height', 'style', 'class', 'align', 'border'], true)) $im->removeAttribute($at->name);
      if ($data) $im->setAttribute('src', $data); else $im->parentNode?->removeChild($im);
    }
    // кнопки страницы («Друкувати», «Назад», «Зберегти в PDF») — не нужны в копии
    foreach (iterator_to_array($x->query('//a|//span|//div|//td|//p')) as $n) {
      $t = CabWeb::sp((string)$n->textContent);
      if (mb_strlen($t) <= 30 && preg_match('/^(друкувати|друк|роздрукувати|назад|печать|печатать|print|back|зберегти\s.*pdf)$/iu', $t) && ($n->nodeName === 'a' || $n->hasAttribute('onclick') || !$x->query('.//table', $n)->length)) $n->parentNode?->removeChild($n);
    }
    foreach (['script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'style', 'template', 'video', 'audio', 'source', 'canvas', 'title', 'head'] as $tag)
      foreach (iterator_to_array($d->getElementsByTagName($tag)) as $n) $n->parentNode?->removeChild($n);
    foreach (iterator_to_array($d->getElementsByTagName('form')) as $f) { while ($f->firstChild) $f->parentNode->insertBefore($f->firstChild, $f); $f->parentNode->removeChild($f); }
    foreach (iterator_to_array($x->query('//*')) as $n) {
      foreach (iterator_to_array($n->attributes) as $at) {
        $an = strtolower($at->name);
        if (str_starts_with($an, 'on') || in_array($an, ['href', 'xlink:href', 'action', 'formaction', 'target', 'srcset', 'src', 'data', 'ping', 'background', 'poster'], true) && !($n->nodeName === 'img' && $an === 'src')) $n->removeAttribute($at->name);
        elseif ($an === 'style') $n->setAttribute('style', self::cleanCss((string)$at->value));
      }
    }
    $body = $d->getElementsByTagName('body')->item(0); $inner = '';
    if ($body) foreach ($body->childNodes as $c) $inner .= $d->saveHTML($c);
    $title = htmlspecialchars((string)$b['title'], ENT_QUOTES, 'UTF-8');
    $note = 'Копія рахунку з кабінету КП «ХТМ» (hts.kharkov.ua), збережено ' . (new DateTimeImmutable('now', new DateTimeZone('Europe/Kyiv')))->format('d.m.Y') . ' сервісом «Лічильники». Зберегти PDF — «Друк» у меню браузера.';
    $html = '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=820"><meta name="robots" content="noindex"><title>' . $title . '</title>'
      . ($css ? '<style>' . implode("\n", $css) . '</style>' : '')
      . '<style>.lc-copy{font:13px/1.4 system-ui,-apple-system,sans-serif;color:#444;background:#f2f2f2;border:1px solid #ddd;border-radius:6px;padding:6px 10px;margin:8px 0 12px}@media print{.lc-copy{display:none}}</style></head>'
      . '<body><div class="lc-copy">' . htmlspecialchars($note, ENT_QUOTES, 'UTF-8') . '</div>' . $inner . '</body></html>';
    return ['html' => $html, 'css' => count($css), 'img' => $got];
  }
  /** «2026-11-05» / «5.11.2026» → «05.11.2026». */
  public static function dmy(string $s): string {
    if (preg_match('/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/', $s, $m)) return sprintf('%02d.%02d.%04d', $m[3], $m[2], $m[1]);
    if (preg_match('/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/', $s, $m)) return sprintf('%02d.%02d.%04d', $m[1], $m[2], $m[3]);
    return $s;
  }
  /** Телефон в том виде, что подсказывает форма: placeholder «(067) ***-**-45» (живой кабинет 06.11) → «(050) 111-22-33»; иначе как есть (+380…). */
  public static function phoneFor(string $phone, string $ph): string {
    $d = preg_replace('/\D/', '', $phone); if (strlen($d) === 12 && str_starts_with($d, '380')) $d = substr($d, 2);
    if (strlen($d) !== 10 || $d[0] !== '0') return $phone;
    if (preg_match('/^\(\S{3}\)(\s?)\S{3}-\S{2}-\S{2}$/u', trim($ph), $m)) return '(' . substr($d, 0, 3) . ')' . $m[1] . substr($d, 3, 3) . '-' . substr($d, 6, 2) . '-' . substr($d, 8, 2);
    return $phone;
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
      elseif ($role === 'phone') $pairs[] = [$f['name'], self::phoneFor((string)($contact['phone'] ?? ''), (string)($f['ph'] ?? ''))];
      elseif (in_array($role, ['email', 'note'], true)) $pairs[] = [$f['name'], (string)($contact[$role] ?? '')];
    }
    $want = [strtolower(self::F['date']) => $want['date'], strtolower(self::F['energy']) => $want['energy']];
    // плашки, что были на странице ещё до отправки (красный баннер сайта, подсказка help-block у поля, «рекомендуємо до 23»), — не ответ на нашу отправку
    $was = ($h['html'] ?? '') !== '' ? self::msgs(CabWeb::dom((string)$h['html'])) : ['err' => [], 'ok' => []];
    $r = $this->post($h['action'], $pairs);
    $m = self::msgs(CabWeb::dom($r['body']));
    foreach (['err', 'ok'] as $k) $m[$k] = array_values(array_diff($m[$k], $was[$k]));
    if ($was['err'] || $was['ok']) $this->log['banners'] = count($was['err']) + count($was['ok']);
    $after = $this->heat($acc, $sur);
    $row = self::find($after['journal'], $want[strtolower(self::F['date'])], $want[strtolower(self::F['energy'])]);
    // сайт сказал «ошибка» — не сохранено; ошибок нет, а строки в журнале ещё нет (журнал обновляется не сразу) — не «не зберіг»,
    // а «на перевірці»: cron перечитает журнал и, не найдя за 6 ч, честно скажет «перевірте самі»
    if (!$row && $m['err']) throw new CabErr('form_error', implode(' ', array_slice($m['err'], 0, 2)));
    if (!$row) { $this->log['unseen'] = true; return ['status' => 'pending', 'text' => '', 'reason' => null, 'flash' => implode(' ', array_slice($m['ok'], 0, 1)), 'unseen' => true]; }
    return ['status' => $row['status'], 'text' => $row['text'], 'reason' => $row['reason'] ?? null, 'flash' => implode(' ', array_slice($m['ok'], 0, 1))];
  }
  /** Строка журнала по дате и энергии (энергию сравниваем числом). */
  public static function find(array $journal, string $date, string $energy): ?array {
    $n = fn($v) => (float)str_replace([',', ' ', "\u{a0}"], ['.', '', ''], trim((string)$v));   // «14,445» / «14 445.000» — как бы ни показал журнал
    foreach ($journal as $j) if (self::dmy(trim((string)$j['date'])) === self::dmy(trim($date)) && abs($n($j['energy']) - $n($energy)) < 0.0005) return $j;
    return null;
  }
}
