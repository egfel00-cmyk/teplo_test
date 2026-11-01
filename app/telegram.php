<?php
// Проверка подписей Telegram и бот. Документация Telegram:
//  Mini App: secret = HMAC_SHA256(key="WebAppData", msg=bot_token); hash = hex(HMAC_SHA256(key=secret, msg=data_check_string))
//  Login Widget: secret = SHA256(bot_token);                         hash = hex(HMAC_SHA256(key=secret, msg=data_check_string))
//  data_check_string — пары key=value (кроме hash), отсортированные по ключу, через \n.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Telegram {
  const MAX_AGE = 86400; // подпись не старше суток

  /** Mini App: initData (строка query) → данные пользователя или исключение. */
  public static function verifyWebApp(string $initData, string $token): array {
    parse_str($initData, $p);
    $hash = (string)($p['hash'] ?? ''); unset($p['hash']);
    if ($hash === '' || $token === '') throw new HttpError(401, 'telegram_bad_signature');
    ksort($p);
    $dcs = implode("\n", array_map(fn($k) => $k . '=' . $p[$k], array_keys($p)));
    $secret = hash_hmac('sha256', $token, 'WebAppData', true);
    if (!hash_equals(hash_hmac('sha256', $dcs, $secret), $hash)) throw new HttpError(401, 'telegram_bad_signature');
    if (Http::now() - (int)($p['auth_date'] ?? 0) > self::MAX_AGE) throw new HttpError(401, 'telegram_expired');
    $u = json_decode((string)($p['user'] ?? ''), true);
    if (!is_array($u) || empty($u['id'])) throw new HttpError(401, 'telegram_no_user');
    return ['id' => (string)$u['id'], 'username' => $u['username'] ?? null, 'name' => trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? ''))];
  }

  /** Login Widget на сайте: поля id, first_name, last_name, username, photo_url, auth_date, hash. */
  public static function verifyWidget(array $d, string $token): array {
    $allowed = ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date'];
    $hash = (string)($d['hash'] ?? '');
    if ($hash === '' || $token === '') throw new HttpError(401, 'telegram_bad_signature');
    $p = []; foreach ($allowed as $k) if (isset($d[$k]) && $d[$k] !== '') $p[$k] = (string)$d[$k];
    ksort($p);
    $dcs = implode("\n", array_map(fn($k) => $k . '=' . $p[$k], array_keys($p)));
    if (!hash_equals(hash_hmac('sha256', $dcs, hash('sha256', $token, true)), $hash)) throw new HttpError(401, 'telegram_bad_signature');
    if (Http::now() - (int)($p['auth_date'] ?? 0) > self::MAX_AGE) throw new HttpError(401, 'telegram_expired');
    return ['id' => $p['id'], 'username' => $p['username'] ?? null, 'name' => trim(($p['first_name'] ?? '') . ' ' . ($p['last_name'] ?? ''))];
  }

  /** Вызов Bot API. В тестах подменяется. */
  public static $send = null;
  public static function call(string $method, array $params): array {
    if (self::$send) return (self::$send)($method, $params);
    $ch = curl_init('https://api.telegram.org/bot' . Cfg::get('bot_token') . '/' . $method);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($params), CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
    $r = curl_exec($ch); curl_close($ch);
    return json_decode((string)$r, true) ?: [];
  }

  /** Вебхук: /start (и любое сообщение) → кнопка, открывающая сайт как Mini App. */
  public static function handleUpdate(array $u): ?array {
    $msg = $u['message'] ?? null; if (!$msg || empty($msg['chat']['id'])) return null;
    $lang = str_starts_with((string)($msg['from']['language_code'] ?? ''), 'ru') ? 'ru' : 'uk';
    $text = $lang === 'ru'
      ? "Теплосервис помогает снять показания теплосчётчика, проверить их как робот ХТМ и не пропустить окно приёма (5–25 число).\n\nНажмите кнопку — откроется сервис, вход через Telegram произойдёт сам."
      : "Теплосервіс допомагає зняти показання тепло­лічильника, перевірити їх як робот ХТМ і не пропустити вікно приймання (5–25 число).\n\nНатисніть кнопку — відкриється сервіс, вхід через Telegram відбудеться сам.";
    $btn = $lang === 'ru' ? 'Открыть Теплосервис' : 'Відкрити Теплосервіс';
    $params = ['chat_id' => $msg['chat']['id'], 'text' => $text,
      'reply_markup' => ['inline_keyboard' => [[['text' => $btn, 'web_app' => ['url' => Cfg::appUrl()]]]]]];
    self::call('sendMessage', $params);
    return $params;
  }
}
