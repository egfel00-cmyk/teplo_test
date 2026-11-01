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
  public static function call(string $method, array $params, ?string $token = null): array {
    if (self::$send) return (self::$send)($method, $params, $token);
    $ch = curl_init('https://api.telegram.org/bot' . ($token ?? Cfg::get('bot_token')) . '/' . $method);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($params), CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
    $r = curl_exec($ch); curl_close($ch);
    return json_decode((string)$r, true) ?: [];
  }

  /** Подключить бота к сайту: вебхук, кнопка меню (открывает Mini App), команда /start. */
  public static function setup(): array {
    $url = Cfg::appUrl(); $out = [];
    $out['setWebhook'] = self::call('setWebhook', ['url' => $url . 'api/bot/webhook', 'secret_token' => (string)Cfg::get('webhook_secret'), 'allowed_updates' => ['message'], 'drop_pending_updates' => true]);
    $out['setChatMenuButton'] = self::call('setChatMenuButton', ['menu_button' => ['type' => 'web_app', 'text' => 'Теплосервіс', 'web_app' => ['url' => $url]]]);
    $out['setMyCommands'] = self::call('setMyCommands', ['commands' => [['command' => 'start', 'description' => 'Відкрити Теплосервіс']]]);
    $errs = []; foreach ($out as $k => $x) if (empty($x['ok'])) $errs[] = $k . ': ' . ($x['description'] ?? 'нет ответа');
    return ['ok' => !$errs, 'appUrl' => $url, 'telegram' => array_map(fn($x) => !empty($x['ok']), $out), 'errors' => $errs];
  }

  /** Вебхук: /start (и любое сообщение) → кнопка, открывающая сайт как Mini App. */
  /** /start link_<token>: привязать этот Telegram к аккаунту, который попросил ссылку на сайте. Возвращает текст ответа. */
  public static function linkByToken(array $from, string $token, string $lang): string {
    $ru = $lang === 'ru'; $tgId = (string)($from['id'] ?? ''); $un = $from['username'] ?? null;
    Db::q('DELETE FROM link_tokens WHERE expires_at < ?', [time()]);
    $row = preg_match('/^[a-f0-9]{32}$/', $token) ? Db::one('SELECT * FROM link_tokens WHERE token = ?', [$token]) : null;
    if (!$row || $tgId === '') return $ru ? 'Ссылка устарела. Откройте сайт → Настройки → «Привязать Telegram» ещё раз.' : 'Посилання застаріло. Відкрийте сайт → Налаштування → «Прив’язати Telegram» ще раз.';
    $uid = (int)$row['user_id']; Db::q('DELETE FROM link_tokens WHERE token = ?', [$token]);
    $mine = Db::one("SELECT * FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$uid]);
    if ($mine && (string)$mine['external_id'] !== $tgId) return $ru ? 'К этому аккаунту уже привязан другой Telegram.' : 'До цього акаунта вже прив’язаний інший Telegram.';
    $idn = Db::one("SELECT * FROM user_identities WHERE type = 'telegram' AND external_id = ?", [$tgId]);
    if ($idn && (int)$idn['user_id'] === $uid) return $ru ? 'Этот Telegram уже привязан к вашему аккаунту — вход через бота открывает его.' : 'Цей Telegram уже прив’язаний до вашого акаунта — вхід через бота відкриває його.';
    if ($idn) {
      // Telegram уже вошёл раньше и получил свой отдельный аккаунт: если там нет e-mail и показаний — переносим, иначе не трогаем
      $other = (int)$idn['user_id']; $ou = Db::one('SELECT email FROM users WHERE id = ?', [$other]); $os = Db::one('SELECT data FROM user_state WHERE user_id = ?', [$other]);
      $od = $os ? json_decode((string)$os['data'], true) : null;
      $hasData = ($ou['email'] ?? null) || (is_array($od) && (count(array_filter((array)($od['readings'] ?? []), fn($r) => is_array($r) && empty($r['deleted']))) || !empty($od['baseline'])));
      if ($hasData) return $ru ? 'У этого Telegram уже есть отдельный аккаунт с данными. Напишите нам через «Отзыв» на сайте — объединим вручную.' : 'У цього Telegram уже є окремий акаунт з даними. Напишіть нам через «Відгук» на сайті — об’єднаємо вручну.';
      Db::q('UPDATE user_identities SET user_id = ?, username = ? WHERE id = ?', [$uid, $un, $idn['id']]);
      Db::q('DELETE FROM sessions WHERE user_id = ?', [$other]);
    } else Db::q("INSERT INTO user_identities (user_id, type, external_id, username, linked_at) VALUES (?, 'telegram', ?, ?, ?)", [$uid, $tgId, $un, Http::iso()]);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'link_telegram_bot', null, Http::iso()]);
    return $ru ? 'Готово: Telegram привязан к вашему аккаунту. Теперь кнопка ниже и вход через Telegram открывают те же показания.' : 'Готово: Telegram прив’язано до вашого акаунта. Тепер кнопка нижче й вхід через Telegram відкривають ті самі показання.';
  }

  public static function handleUpdate(array $u): ?array {
    $msg = $u['message'] ?? null; if (!$msg || empty($msg['chat']['id'])) return null;
    $lang = str_starts_with((string)($msg['from']['language_code'] ?? ''), 'ru') ? 'ru' : 'uk';
    $linkText = null;
    if (preg_match('/^\/start\s+link_([a-f0-9]{32})\b/', (string)($msg['text'] ?? ''), $m)) $linkText = self::linkByToken((array)($msg['from'] ?? []), $m[1], $lang);
    $text = $lang === 'ru'
      ? "Теплосервис помогает снять показания теплосчётчика, проверить их как робот ХТМ и не пропустить окно приёма (5–25 число).\n\nНажмите кнопку — откроется сервис, вход через Telegram произойдёт сам."
      : "Теплосервіс допомагає зняти показання тепло­лічильника, перевірити їх як робот ХТМ і не пропустити вікно приймання (5–25 число).\n\nНатисніть кнопку — відкриється сервіс, вхід через Telegram відбудеться сам.";
    $btn = $lang === 'ru' ? 'Открыть Теплосервис' : 'Відкрити Теплосервіс';
    if ($linkText !== null) $text = $linkText;
    $params = ['chat_id' => $msg['chat']['id'], 'text' => $text,
      'reply_markup' => ['inline_keyboard' => [[['text' => $btn, 'web_app' => ['url' => Cfg::appUrl()]]]]]];
    self::call('sendMessage', $params);
    return $params;
  }
}
