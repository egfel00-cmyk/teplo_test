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
    $s = self::SITES[$k]; $w = new CabWeb($s['host'], 14.0, $s['cs']); $t = microtime(true);
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
  public static function run(): array {
    $out = ['v' => self::V, 'at' => gmdate('c')];
    foreach (array_keys(self::SITES) as $k) { try { $out[$k] = self::one($k); } catch (Throwable $e) { $out[$k] = ['code' => 0, 'err' => mb_substr($e->getMessage(), 0, 80), 'ok' => false]; } }
    $prev = self::read();
    foreach (array_keys(self::SITES) as $k) {   // когда последний раз открывался — чтобы видеть «был доступен, перестал»
      $out[$k]['lastOk'] = !empty($out[$k]['ok']) ? $out[$k]['at'] : ($prev[$k]['lastOk'] ?? null);
    }
    @mkdir(dirname(self::file()), 0700, true); @file_put_contents(self::file(), json_encode($out, JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $out;
  }
}
