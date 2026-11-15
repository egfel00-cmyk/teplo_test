<?php
declare(strict_types=1);

/**
 * 154-а: «Увійти через Apple» у застосунку iPhone (App Store 4.8: є вхід через Telegram → потрібен рівноцінний вхід Apple).
 * Застосунок отримує identityToken (JWT, RS256) від iOS і шле його сюди; ми перевіряємо підпис ключами Apple (JWKS),
 * видавця, отримувача (Bundle ID застосунку), строк і nonce. Людина — `user_identities.type = 'apple'`, external_id = `sub`.
 */
final class Apple {
  public const ISS = 'https://appleid.apple.com';
  public const JWKS = 'https://appleid.apple.com/auth/keys';
  /** Bundle ID застосунку; інший (наприклад, Services ID для сайту) — `apple_aud` у config.php (через кому). */
  public const AUD = ['ua.com.peredai.app'];

  public static function auds(): array {
    $x = trim((string)Cfg::get('apple_aud'));
    return $x === '' ? self::AUD : array_values(array_filter(array_map('trim', explode(',', $x))));
  }

  /** Ключі Apple — з кешу на добу (Apple міняє їх рідко), при невідомому kid — свіжі. */
  public static function keys(bool $fresh = false): array {
    $f = Cfg::data() . '/cache/apple_jwks.json';
    if (!$fresh && is_file($f) && filemtime($f) > time() - 86400) { $j = json_decode((string)file_get_contents($f), true); if (is_array($j['keys'] ?? null)) return $j['keys']; }
    $url = (string)(Cfg::get('apple_jwks_url') ?: self::JWKS);
    if (str_starts_with($url, 'file://')) { $b = @file_get_contents(substr($url, 7)); $code = $b === false ? 0 : 200; }   // локальні тести
    else {
      $ch = curl_init($url);
      curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS]);
      $b = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    }
    $j = is_string($b) && $code === 200 ? json_decode($b, true) : null;
    if (!is_array($j['keys'] ?? null)) throw new HttpError(503, 'apple_keys_unavailable');
    @file_put_contents($f, $b, LOCK_EX);
    return $j['keys'];
  }

  /** Перевірити з ключами з кешу; невідомий kid (Apple змінила ключі) — ще раз зі свіжими. */
  public static function check(string $jwt, ?string $nonce): array {
    try { return self::verify($jwt, self::keys(), self::auds(), $nonce); }
    catch (HttpError $e) { if ($e->err !== 'apple_unknown_key') throw $e; return self::verify($jwt, self::keys(true), self::auds(), $nonce); }
  }

  /**
   * Перевірити токен. $nonce — сирий nonce із застосунку (у токені — його sha256 hex). Повертає ['sub', 'email', 'relay'].
   * $keys — JWKS (тести дають свої), $now — для тестів.
   */
  public static function verify(string $jwt, array $keys, array $aud, ?string $nonce = null, ?int $now = null): array {
    $now = $now ?? time();
    $p = explode('.', $jwt);
    if (count($p) !== 3) throw new HttpError(401, 'apple_bad_token');
    $h = json_decode(self::b64($p[0]), true); $c = json_decode(self::b64($p[1]), true); $sig = self::b64($p[2]);
    if (!is_array($h) || !is_array($c) || ($h['alg'] ?? '') !== 'RS256' || empty($h['kid'])) throw new HttpError(401, 'apple_bad_token');
    $jwk = null; foreach ($keys as $k) if (($k['kid'] ?? '') === $h['kid'] && ($k['kty'] ?? '') === 'RSA') { $jwk = $k; break; }
    if (!$jwk) throw new HttpError(401, 'apple_unknown_key');
    $pem = self::pem((string)$jwk['n'], (string)$jwk['e']);
    if (openssl_verify($p[0] . '.' . $p[1], $sig, $pem, OPENSSL_ALGO_SHA256) !== 1) throw new HttpError(401, 'apple_bad_signature');
    if (($c['iss'] ?? '') !== self::ISS) throw new HttpError(401, 'apple_bad_issuer');
    $ta = (array)($c['aud'] ?? []); if (!array_intersect($ta, $aud)) throw new HttpError(401, 'apple_bad_audience');
    if ((int)($c['exp'] ?? 0) < $now - 60) throw new HttpError(401, 'apple_expired');
    if ($nonce !== null && $nonce !== '' && !hash_equals(hash('sha256', $nonce), (string)($c['nonce'] ?? ''))) throw new HttpError(401, 'apple_bad_nonce');
    $sub = (string)($c['sub'] ?? ''); if ($sub === '' || strlen($sub) > 128) throw new HttpError(401, 'apple_bad_token');
    $email = mb_strtolower(trim((string)($c['email'] ?? '')));
    $relay = !empty($c['is_private_email']) && $c['is_private_email'] !== 'false';
    return ['sub' => $sub, 'email' => filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '', 'relay' => $relay];
  }

  private static function b64(string $s): string { return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

  /** JWK (n, e) → PEM відкритого ключа RSA (SubjectPublicKeyInfo). */
  public static function pem(string $n, string $e): string {
    $int = function (string $b): string { if ($b !== '' && ord($b[0]) > 0x7f) $b = "\0" . $b; return "\x02" . self::len(strlen($b)) . $b; };
    $rsa = $int(self::b64($n)) . $int(self::b64($e));
    $seq = "\x30" . self::len(strlen($rsa)) . $rsa;
    $bit = "\x03" . self::len(strlen($seq) + 1) . "\0" . $seq;
    $alg = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";
    $spki = "\x30" . self::len(strlen($alg . $bit)) . $alg . $bit;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
  }
  private static function len(int $l): string {
    if ($l < 0x80) return chr($l);
    $s = ''; while ($l > 0) { $s = chr($l & 0xff) . $s; $l >>= 8; }
    return chr(0x80 | strlen($s)) . $s;
  }
}
