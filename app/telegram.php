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
    $out['setChatMenuButton'] = self::call('setChatMenuButton', ['menu_button' => ['type' => 'web_app', 'text' => 'Лічильники', 'web_app' => ['url' => $url]]]);
    $out['setMyCommands'] = self::call('setMyCommands', ['commands' => [['command' => 'start', 'description' => 'Відкрити Лічильники']]]);
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

  /** Скачать файл Telegram по file_id. В тестах подменяется. */
  public static $fetch = null;
  public static function file(string $fileId): ?string {
    if (self::$fetch) return (self::$fetch)($fileId);
    $f = self::call('getFile', ['file_id' => $fileId]); $path = $f['result']['file_path'] ?? '';
    if ($path === '' || ($f['result']['file_size'] ?? 0) > 20 * 1024 * 1024) return null;
    $ch = curl_init('https://api.telegram.org/file/bot' . Cfg::get('bot_token') . '/' . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_MAXFILESIZE => 20 * 1024 * 1024]);
    $b = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    return $code === 200 && is_string($b) && $b !== '' ? $b : null;
  }
  /** Аккаунт этого Telegram (как при входе через Mini App): нет — создаём. */
  public static function userFor(array $from): int {
    $tgId = (string)($from['id'] ?? ''); if ($tgId === '') throw new HttpError(400, 'no_user');
    $idn = Db::one("SELECT * FROM user_identities WHERE type = 'telegram' AND external_id = ?", [$tgId]);
    if ($idn) return (int)$idn['user_id'];
    $name = trim(($from['first_name'] ?? '') . ' ' . ($from['last_name'] ?? ''));
    Db::q('INSERT INTO users (name, created_at) VALUES (?, ?)', [$name ?: null, Http::iso()]); $uid = Db::id();
    Db::q("INSERT INTO user_identities (user_id, type, external_id, username, linked_at) VALUES (?, 'telegram', ?, ?, ?)", [$uid, $tgId, $from['username'] ?? null, Http::iso()]);
    return $uid;
  }
  const VK_BOT = 'hvk_user_bot';
  /** Переслано из бота Водоканала (forward_origin — Bot API 7+, forward_from — старые клиенты). */
  public static function isVkForward(array $msg): bool {
    $o = $msg['forward_origin'] ?? null; $u = is_array($o) ? ($o['sender_user'] ?? null) : null;
    if (!is_array($u)) $u = $msg['forward_from'] ?? null;
    return is_array($u) && strcasecmp((string)($u['username'] ?? ''), self::VK_BOT) === 0;
  }
  /** Что ответил бот Водоканала: ok — показания приняты, err — ошибка, info — прочее (ID счётчиков, баланс). */
  public static function vkKind(string $t): string {
    if (preg_match('/помилк|ошибк|невірн|неверн|не\s+знайден|не\s+найден|не\s+прийн|не\s+прин|не\s+вдал|не\s+удал|некорект|відхилен|отклонен/iu', $t)) return 'err';
    if (preg_match('/прийнят|прийнято|принят|збережен|сохранен|успішн|успешн|зарахован|зачислен|отриман|получен/iu', $t)) return 'ok';
    return 'info';
  }
  /** Человек переслал нам ответ бота Водоканала — сохраняем: сервис покажет его у воды и сам отметит «передано» (подтверждено). */
  public static function vkReply(array $msg, string $lang): array {
    $ru = $lang === 'ru'; $chat = $msg['chat']['id'];
    $text = trim((string)($msg['text'] ?? $msg['caption'] ?? ''));
    $at = (int)($msg['forward_origin']['date'] ?? $msg['forward_date'] ?? $msg['date'] ?? time());
    $kind = $text === '' ? 'info' : self::vkKind($text);
    try {
      $uid = self::userFor((array)($msg['from'] ?? []));
      RateLimit::hit('bot_photo', (string)$uid);
      if ($text !== '') Db::q('INSERT INTO vk_replies (user_id, kind, text, msg_at, created_at) VALUES (?, ?, ?, ?, ?)', [$uid, $kind, mb_substr($text, 0, 3000), $at, Http::iso()]);
    } catch (Throwable $e) { $kind = 'fail'; }
    $msgs = [
      'ok' => $ru ? "✅ Сохранил подтверждение Водоканала. В «Счётчиках» показания воды отметятся переданными." : "✅ Зберіг підтвердження Водоканалу. У «Лічильниках» показання води позначаться переданими.",
      'err' => $ru ? "Водоканал ответил ошибкой. Откройте «Счётчики» — подскажем, что проверить (лицевой счёт, фамилия, ID счётчиков)." : "Водоканал відповів помилкою. Відкрийте «Лічильники» — підкажемо, що перевірити (особовий рахунок, прізвище, ID лічильників).",
      'info' => $ru ? "Сохранил ответ Водоканала — он виден в «Счётчиках» у воды (ID счётчиков можно вставить оттуда)." : "Зберіг відповідь Водоканалу — її видно в «Лічильниках» біля води (ID лічильників можна вставити звідти).",
      'fail' => $ru ? "Не удалось сохранить ответ. Перешлите его ещё раз чуть позже." : "Не вдалося зберегти відповідь. Перешліть її ще раз трохи пізніше.",
    ];
    $params = ['chat_id' => $chat, 'text' => $text === '' && $kind !== 'fail' ? ($ru ? 'Перешлите текстовый ответ бота Водоканала.' : 'Перешліть текстову відповідь бота Водоканалу.') : $msgs[$kind]];
    if ($kind !== 'fail') $params['reply_markup'] = ['inline_keyboard' => [[['text' => $ru ? 'Открыть «Счётчики»' : 'Відкрити «Лічильники»', 'web_app' => ['url' => Cfg::appUrl() . '?go=water-cold']]]]];
    if (!Cfg::appUrlKnown()) unset($params['reply_markup']);
    self::call('sendMessage', $params);
    return $params + ['kind' => $kind];
  }

  /** Фото счётчика в чате с ботом → в «входящие» аккаунта; распознаёт браузер, когда человек откроет сервис кнопкой. */
  public static function photo(array $msg, string $lang): array {
    $ru = $lang === 'ru'; $chat = $msg['chat']['id'];
    $fileId = !empty($msg['photo']) ? (string)end($msg['photo'])['file_id'] : (string)$msg['document']['file_id'];   // самый большой размер — последний
    $saved = false;
    try {
      $uid = self::userFor((array)($msg['from'] ?? []));
      RateLimit::hit('bot_photo', (string)$uid);
      $body = self::file($fileId);
      if ($body !== null) {
        $info = @getimagesizefromstring($body);
        $p = Recognize::upload($uid, $body, (string)($info['mime'] ?? 'image/jpeg'));
        Db::q('INSERT INTO bot_inbox (photo_id, user_id, taken_at, created_at) VALUES (?, ?, ?, ?)', [$p['id'], $uid, (int)($msg['date'] ?? time()), Http::iso()]);
        $saved = true;
      }
    } catch (Throwable $e) { $saved = false; }
    if (!$saved) {
      $params = ['chat_id' => $chat, 'text' => $ru ? 'Не удалось сохранить фото. Пришлите его ещё раз (до 20 МБ, JPEG/PNG).' : 'Не вдалося зберегти фото. Надішліть його ще раз (до 20 МБ, JPEG/PNG).'];
      self::call('sendMessage', $params); return $params;
    }
    // альбом приходит отдельными сообщениями — отвечаем один раз на альбом и не чаще раза в минуту на чат
    $dir = (Cfg::data() ?: sys_get_temp_dir() . '/teplo_data') . '/cache'; if (!is_dir($dir)) @mkdir($dir, 0700, true);
    $key = $dir . '/tgreply_' . preg_replace('/\D/', '', (string)$chat);
    $last = @filemtime($key) ?: 0;
    if (time() - $last < 60) return ['saved' => true, 'reply' => false];
    @touch($key);
    $n = (int)(Db::one('SELECT COUNT(*) AS n FROM bot_inbox WHERE user_id = (SELECT user_id FROM user_identities WHERE type = ? AND external_id = ?) AND done = 0', ['telegram', (string)$msg['from']['id']])['n'] ?? 1);
    $text = $ru
      ? "📷 Фото получено. Теплосчётчик — пришлите все экраны (можно альбомом), по одному экрану на фото. Водомеры — можно одним кадром оба или по фото на каждый.\n\nКогда всё отправите, нажмите кнопку: сервис распознает цифры, разложит по счётчикам и покажет на проверку."
      : "📷 Фото отримано. Теплолічильник — надішліть усі екрани (можна альбомом), по одному екрану на фото. Водоміри — можна одним кадром обидва або по фото на кожен.\n\nКоли все надішлете, натисніть кнопку: сервіс розпізнає цифри, розкладе по лічильниках і покаже на перевірку.";
    $params = ['chat_id' => $chat, 'text' => $text,
      'reply_markup' => ['inline_keyboard' => [[['text' => $ru ? 'Распознать фото' : 'Розпізнати фото', 'web_app' => ['url' => Cfg::appUrl() . '?inbox=1']]]]]];
    self::call('sendMessage', $params);
    return $params;
  }

  public static function handleUpdate(array $u): ?array {
    $msg = $u['message'] ?? null; if (!$msg || empty($msg['chat']['id'])) return null;
    $lang = str_starts_with((string)($msg['from']['language_code'] ?? ''), 'ru') ? 'ru' : 'uk';
    if (self::isVkForward($msg)) return self::vkReply($msg, $lang);
    if (!empty($msg['photo']) || (isset($msg['document']['mime_type']) && preg_match('#^image/(jpeg|png|webp)$#', (string)$msg['document']['mime_type']))) return self::photo($msg, $lang);
    $linkText = null;
    if (preg_match('/^\/start\s+link_([a-f0-9]{32})\b/', (string)($msg['text'] ?? ''), $m)) $linkText = self::linkByToken((array)($msg['from'] ?? []), $m[1], $lang);
    $text = $lang === 'ru'
      ? "«Счётчики» помогают снять показания тепла и воды, проверить их и не пропустить сроки: тепло — ХТМ (5–25 число), вода — Водоканал (до 20-го).\n\nМожно просто прислать сюда фото экранов теплосчётчика или водомеров — распознаю цифры.\n\nНажмите кнопку — откроется сервис, вход через Telegram произойдёт сам."
      : "«Лічильники» допомагають зняти показання тепла й води, перевірити їх і не пропустити строки: тепло — ХТМ (5–25 число), вода — Водоканал (до 20-го).\n\nМожна просто надіслати сюди фото екранів теплолічильника або водомірів — розпізнаю цифри.\n\nНатисніть кнопку — відкриється сервіс, вхід через Telegram відбудеться сам.";
    $btn = $lang === 'ru' ? 'Открыть «Счётчики»' : 'Відкрити «Лічильники»';
    if ($linkText !== null) $text = $linkText;
    $params = ['chat_id' => $msg['chat']['id'], 'text' => $text,
      'reply_markup' => ['inline_keyboard' => [[['text' => $btn, 'web_app' => ['url' => Cfg::appUrl()]]]]]];
    self::call('sendMessage', $params);
    return $params;
  }
}
