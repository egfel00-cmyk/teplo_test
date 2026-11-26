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
    return ['id' => (string)$u['id'], 'username' => $u['username'] ?? null, 'name' => trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? '')), 'write' => !empty($u['allows_write_to_bot'])];
  }

  /** Бот точно может писать этому человеку (он написал боту, нажал «Старт» или разрешил в Mini App) — снимает плашку «натисніть Старт». */
  public static function markBotOk(string $tgId): void {
    if ($tgId === '') return;
    try { Db::q("UPDATE user_identities SET bot_ok = ? WHERE type = 'telegram' AND external_id = ?", [Http::iso(), $tgId]); } catch (Throwable $e) { /* не головне */ }
  }

  /** Нужна ли человеку плашка «Бот змінився — натисніть «Старт»»: последний итог рассылки ему — no_chat/blocked и после него
   *  он боту не писал. → ['bot' => имя бота] или null. */
  public static function needStart(int $uid): ?array {
    $bot = (string)Cfg::get('bot_username'); if ($bot === '') return null;
    $i = Db::one("SELECT bot_ok FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$uid]); if (!$i) return null;
    $s = Db::one('SELECT status, sent_at FROM reminders_sent WHERE user_id = ? AND status IS NOT NULL ORDER BY sent_at DESC LIMIT 1', [$uid]);
    if (!$s || !in_array($s['status'], ['no_chat', 'blocked'], true)) return null;
    if ((string)($i['bot_ok'] ?? '') !== '' && strcmp((string)$i['bot_ok'], (string)$s['sent_at']) >= 0) return null;
    return ['bot' => $bot, 'why' => (string)$s['status']];
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
    $out['setWebhook'] = self::call('setWebhook', ['url' => $url . 'api/bot/webhook', 'secret_token' => (string)Cfg::get('webhook_secret'), 'allowed_updates' => self::UPDATES, 'drop_pending_updates' => true]);
    $out += self::menuSetup();
    $errs = []; foreach ($out as $k => $x) if (empty($x['ok'])) $errs[] = $k . ': ' . ($x['description'] ?? 'нет ответа');
    return ['ok' => !$errs, 'appUrl' => $url, 'telegram' => array_map(fn($x) => !empty($x['ok']), $out), 'errors' => $errs];
  }

  /** Кнопка меню бота «Відкрити» (за замовчуванням, укр.) і команда /start укр./рос. Telegram не дає підпис кнопки за мовою —
   *  російськомовним ставимо «Открыть» у їхньому чаті (handleUpdate). cron викликає раз на MENU_V (Cron: botMenuV).
   *  MENU_V 3 (84-я): ще й опис бота і «Про бота» — about(). 4 (147-я): у описі порядок видів — світло, вода, газ, тепло. */
  const MENU_V = 7;   // 151-а: назва сервісу в описі й кнопках — «передай»; 6 (155-а): + Хмельниччина в описі; 7 (179-я): + команда /dostup (спільний доступ)
  /** Які оновлення приймає вебхук. HOOK_V — версія цього переліку: cron перевстановлює вебхук раз на версію (без drop_pending). */
  const UPDATES = ['message', 'widget_query', 'callback_query'];   // 179-я: кнопки під карткою запрошення в спільну квартиру
  const HOOK_V = 3;
  public static function hookUpdate(): array {
    $url = Cfg::appUrl() . 'api/bot/webhook';
    return self::call('setWebhook', ['url' => $url, 'secret_token' => (string)Cfg::get('webhook_secret'), 'allowed_updates' => self::UPDATES]);
  }
  public static function menuText(string $lang): string { return $lang === 'ru' ? 'Открыть' : 'Відкрити'; }

  /** Опис бота (порожній чат — «Що вміє цей бот?», до 512 знаків) і «Про бота» в профілі (до 120). Раніше стояв текст старого бота
   *  (перенесений 07.11, «Харків»); 84-я: чотири області, фото, куди передати, нагадування — як на лендингу. */
  public static function about(string $lang): array {
    $host = (string)parse_url(Cfg::appUrl(), PHP_URL_HOST) ?: 'peredai.com.ua';
    if ($lang === 'ru') return [
      'description' => "«передай» — показания света, воды, газа и тепла в одном месте.\n\n"
        . "• Сфотографируйте счётчик — цифры распознаются сами.\n• Подскажем, куда и до какого числа передать, — с готовым текстом.\n"
        . "• Напомним здесь, в Telegram, за 4 дня до конца приёма.\n• Несколько квартир — у каждой свои счётчики.\n\n"
        . "Бесплатно — Харьковская, Киевская, Одесская, Львовская и Хмельницкая области. Начните чат кнопкой внизу.",
      'short_description' => "Показания счётчиков: фото → цифры, куда и до какого числа передать, напоминания. Бесплатно. $host"];
    return [
      'description' => "«передай» — показання світла, води, газу й тепла в одному місці.\n\n"
        . "• Сфотографуйте лічильник — цифри розпізнаються самі.\n• Підкажемо, куди й до якого числа передати, — з готовим текстом.\n"
        . "• Нагадаємо тут, у Telegram, за 4 дні до кінця прийому.\n• Кілька квартир — у кожної свої лічильники.\n\n"
        . "Безкоштовно — Харківщина, Київщина, Одещина, Львівщина, Хмельниччина. Почніть чат кнопкою внизу.",
      'short_description' => "Показання лічильників: фото → цифри, куди й до якого числа передати, нагадування. Безкоштовно. $host"];
  }

  public static function menuSetup(): array {
    $url = Cfg::appUrl(); $out = [];
    $out['setChatMenuButton'] = self::call('setChatMenuButton', ['menu_button' => ['type' => 'web_app', 'text' => self::menuText('uk'), 'web_app' => ['url' => $url]]]);
    // 179-я: /dostup — спільний доступ до квартир кнопками (запросити, прибрати, вийти)
    $out['setMyCommands'] = self::call('setMyCommands', ['commands' => [['command' => 'start', 'description' => 'Відкрити «передай»'], ['command' => 'dostup', 'description' => 'Спільний доступ до квартир']]]);
    $out['setMyCommands_ru'] = self::call('setMyCommands', ['commands' => [['command' => 'start', 'description' => 'Открыть «передай»'], ['command' => 'dostup', 'description' => 'Совместный доступ к квартирам']], 'language_code' => 'ru']);
    // прежний опис (за замовчуванням) — один раз у кеш: що було до нас (/api/health → bot.about.prev), щоб можна було повернути
    $pf = Cfg::data() . '/cache/bot_about_prev.json';
    if (!is_file($pf)) { $g = self::call('getMyDescription', []); if (!empty($g['ok'])) @file_put_contents($pf, json_encode(['at' => time(), 'description' => (string)($g['result']['description'] ?? '')], JSON_UNESCAPED_UNICODE)); }
    // за замовчуванням і uk — українською, ru — російською; en — порожньо (Telegram покаже за замовчуванням)
    $ab = ['at' => time(), 'v' => self::MENU_V, 'ok' => 0, 'errors' => []];
    foreach (['' => 'uk', 'uk' => 'uk', 'ru' => 'ru', 'en' => null] as $lc => $l) {
      $q = $lc !== '' ? ['language_code' => $lc] : []; $a = $l ? self::about($l) : ['description' => '', 'short_description' => ''];
      foreach (['setMyDescription' => 'description', 'setMyShortDescription' => 'short_description'] as $set => $k) {
        $r = self::call($set, $q + [$k => $a[$k]]); $out[$set . ($lc !== '' ? "_$lc" : '')] = $r;
        if (!empty($r['ok'])) $ab['ok']++; else $ab['errors'][] = $set . ($lc !== '' ? " $lc" : '') . ': ' . mb_substr((string)($r['description'] ?? 'нет ответа'), 0, 80);
      }
    }
    @file_put_contents(Cfg::data() . '/cache/bot_about.json', json_encode($ab, JSON_UNESCAPED_UNICODE));
    return $out;
  }

  /** Новый бот вместо старого (владелец 07.11.2026: «все описание перенести с прошлого бота в новый и настройки тоже»): через Bot API у старого бота читаем
   *  описание (description), «О боте» (short description) и команды — по умолчанию и для uk/ru/en — и записываем новому; у старого снимаем вебхук (иначе его
   *  сообщения шли бы к нам и отвечал бы новый бот). Имя, аватар, домен входа (/setdomain), privacy — только в @BotFather, их Bot API не переносит.
   *  Вызывать ПОСЛЕ setup() нового (setup ставит /start — старые команды, если их больше, перекрывают). → ['copied' => [что], 'skipped' => [что], 'errors' => [...]] */
  public static function copyProfile(string $old, string $new): array {
    $out = ['copied' => [], 'skipped' => [], 'errors' => []];
    if ($old === '' || $old === $new) return $out;
    $me = self::call('getMe', [], $old); if (empty($me['ok'])) { $out['errors'][] = 'old getMe: ' . ($me['description'] ?? 'нет ответа'); return $out; }
    foreach (['', 'uk', 'ru', 'en'] as $lc) {
      $q = $lc === '' ? [] : ['language_code' => $lc]; $tag = $lc === '' ? 'default' : $lc;
      foreach ([['getMyDescription', 'setMyDescription', 'description'], ['getMyShortDescription', 'setMyShortDescription', 'short_description']] as [$get, $set, $k]) {
        $g = self::call($get, $q, $old); $v = (string)($g['result'][$k] ?? '');
        if (empty($g['ok'])) { $out['errors'][] = "$get $tag: " . ($g['description'] ?? 'нет ответа'); continue; }
        if ($v === '') { $out['skipped'][] = "$k $tag"; continue; }
        $r = self::call($set, $q + [$k => $v], $new); if (!empty($r['ok'])) $out['copied'][] = "$k $tag"; else $out['errors'][] = "$set $tag: " . ($r['description'] ?? 'нет ответа');
      }
      $g = self::call('getMyCommands', $q, $old); $cmds = array_values(array_filter((array)($g['result'] ?? []), fn($c) => is_array($c) && !empty($c['command'])));
      if ($cmds && count($cmds) > 1) { $r = self::call('setMyCommands', $q + ['commands' => array_map(fn($c) => ['command' => (string)$c['command'], 'description' => (string)($c['description'] ?? '')], $cmds)], $new); if (!empty($r['ok'])) $out['copied'][] = "commands $tag"; else $out['errors'][] = "setMyCommands $tag: " . ($r['description'] ?? 'нет ответа'); }
    }
    $d = self::call('deleteWebhook', [], $old); if (!empty($d['ok'])) $out['copied'][] = 'old webhook off'; else $out['errors'][] = 'old deleteWebhook: ' . ($d['description'] ?? 'нет ответа');
    $out['old'] = (string)($me['result']['username'] ?? '');
    return $out;
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
  /** Официальные боты поставщиков, чьи ответы человек пересылает нам как подтверждение: вода, свет, газ. */
  const FWD_BOTS = ['vk' => 'hvk_user_bot', 'obl' => 'Kooz2bot', 'grm' => 'mygrmu_bot'];
  /** Из чьего бота переслано (forward_origin — Bot API 7+, forward_from — старые клиенты): vk / obl / grm или null. */
  public static function fwdSrc(array $msg): ?string {
    $o = $msg['forward_origin'] ?? null; $u = is_array($o) ? ($o['sender_user'] ?? null) : null;
    if (!is_array($u)) $u = $msg['forward_from'] ?? null;
    if (!is_array($u)) return null;
    foreach (self::FWD_BOTS as $src => $bot) if (strcasecmp((string)($u['username'] ?? ''), $bot) === 0) return $src;
    return null;
  }
  /** Переслано из бота Водоканала. */
  public static function isVkForward(array $msg): bool { return self::fwdSrc($msg) === 'vk'; }
  /** Что ответил бот Водоканала: ok — показания приняты, err — ошибка, info — прочее (ID счётчиков, баланс). */
  public static function vkKind(string $t): string {
    if (preg_match('/помилк|ошибк|невірн|неверн|не\s+знайден|не\s+найден|не\s+прийн|не\s+прин|не\s+вдал|не\s+удал|не\s+передан|некорект|відхилен|отклонен/iu', $t)) return 'err';
    if (preg_match('/прийнят|прийнято|принят|збережен|сохранен|успішн|успешн|зарахован|зачислен|отриман|получен/iu', $t)) return 'ok';
    return 'info';
  }
  /** То же для бота света/газа. Там «збережено» бывает и про номер телефона, поэтому ok — только если рядом слово про показания
   *  («Показники прийнято», «ваші показання успішно передано»); иначе info — человек подтвердит кнопкой «Прийняв». */
  public static function botKind(string $src, string $t): string {
    if ($src === 'vk' || self::vkKind($t) === 'err') return self::vkKind($t);
    $acc = '(?:прийнят|принят|збережен|сохранен|зарахован|зачислен|отриман|получен|передан|внесен|врахован|учтен)';
    return preg_match('/показ\p{L}*(?:[^\p{L}]+\p{L}+){0,6}?[^\p{L}]+' . $acc . '|' . $acc . '\p{L}*(?:[^\p{L}]+\p{L}+){0,2}?[^\p{L}]+показ/iu', $t) ? 'ok' : 'info';
  }
  /** Человек переслал нам ответ бота Водоканала / Харківобленерго / Газмереж — сохраняем: сервис покажет его у счётчика и сам
   *  отметит «передано» (подтверждено). */
  public static function vkReply(array $msg, string $lang, string $src = 'vk'): array {
    $ru = $lang === 'ru'; $chat = $msg['chat']['id'];
    $text = trim((string)($msg['text'] ?? $msg['caption'] ?? ''));
    $at = (int)($msg['forward_origin']['date'] ?? $msg['forward_date'] ?? $msg['date'] ?? time());
    $kind = $text === '' ? 'info' : self::botKind($src, $text);
    try {
      $uid = self::userFor((array)($msg['from'] ?? []));
      RateLimit::hit('bot_photo', (string)$uid);
      $before = $src === 'vk' ? VkStatus::bot() : null;
      if ($text !== '') Db::q('INSERT INTO vk_replies (user_id, kind, text, msg_at, created_at, src) VALUES (?, ?, ?, ?, ?, ?)', [$uid, $kind, mb_substr($text, 0, 3000), $at, Http::iso(), $src]);
      if ($text !== '' && $before !== null) VkStatus::aliveAgain($before, $uid);   // любой ответ бота Водоканала — он работает: пишем тем, кто жаловался
    } catch (Throwable $e) { $kind = 'fail'; }
    $who = [
      'vk' => [$ru ? 'Водоканала' : 'Водоканалу', $ru ? 'воды' : 'води', 'water-cold'],
      'obl' => [$ru ? 'Харьковоблэнерго' : 'Харківобленерго', $ru ? 'света' : 'світла', 'elec'],
      'grm' => [$ru ? 'Газсетей' : 'Газмереж', $ru ? 'газа' : 'газу', 'gas'],
    ][$src];
    $msgs = $src === 'vk' ? [
      'ok' => $ru ? "✅ Сохранил подтверждение Водоканала. В «передай» показания воды отметятся переданными." : "✅ Зберіг підтвердження Водоканалу. У «передай» показання води позначаться переданими.",
      'err' => $ru ? "Водоканал ответил ошибкой. Откройте «передай» — подскажем, что проверить (лицевой счёт, фамилия, ID счётчиков)." : "Водоканал відповів помилкою. Відкрийте «передай» — підкажемо, що перевірити (особовий рахунок, прізвище, ID лічильників).",
      'info' => $ru ? "Сохранил ответ Водоканала — он виден в «передай» у воды (ID счётчиков можно вставить оттуда)." : "Зберіг відповідь Водоканалу — її видно в «передай» біля води (ID лічильників можна вставити звідти).",
    ] : [
      'ok' => $ru ? "✅ Сохранил подтверждение {$who[0]}. В «передай» показания {$who[1]} отметятся переданными." : "✅ Зберіг підтвердження {$who[0]}. У «передай» показання {$who[1]} позначаться переданими.",
      'err' => $ru ? "Бот {$who[0]} ответил ошибкой. Откройте «передай» — подскажем, что проверить (" . ($src === 'obl' ? 'ЄР — 12 цифр, показания' : 'лицевой счёт, показания') . ")."
                   : "Бот {$who[0]} відповів помилкою. Відкрийте «передай» — підкажемо, що перевірити (" . ($src === 'obl' ? 'ЄР — 12 цифр, показання' : 'особовий рахунок, показання') . ").",
      'info' => $ru ? "Сохранил ответ бота {$who[0]} — он виден в «передай» у {$who[1]}. Если там «принято» — нажмите «Принял»." : "Зберіг відповідь бота {$who[0]} — її видно в «передай» біля {$who[1]}. Якщо там «прийнято» — натисніть «Прийняв».",
    ];
    $msgs['fail'] = $ru ? "Не удалось сохранить ответ. Перешлите его ещё раз чуть позже." : "Не вдалося зберегти відповідь. Перешліть її ще раз трохи пізніше.";
    $empty = $ru ? "Перешлите текстовый ответ бота {$who[0]}." : "Перешліть текстову відповідь бота {$who[0]}.";
    $params = ['chat_id' => $chat, 'text' => $text === '' && $kind !== 'fail' ? $empty : $msgs[$kind]];
    if ($kind !== 'fail') $params['reply_markup'] = ['inline_keyboard' => [[['text' => $ru ? 'Открыть «передай»' : 'Відкрити «передай»', 'web_app' => ['url' => Cfg::appUrl() . '?go=' . $who[2]]]]]];
    if (!Cfg::appUrlKnown()) unset($params['reply_markup']);
    self::call('sendMessage', $params);
    return $params + ['kind' => $kind, 'src' => $src];
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
    // картка фото (121-а): цифри, «Відправити», статус — в одній картці; альбом — та сама картка. Не вийшло — як раніше, текстом
    try { $card = class_exists('BotCard') && isset($uid, $p) ? BotCard::photo($uid, $chat, (string)$p['id'], $lang) : null; } catch (Throwable $e) { $card = null; }
    if ($card) return ['saved' => true, 'card' => $card];
    // альбом приходит отдельными сообщениями — отвечаем один раз на альбом и не чаще раза в минуту на чат
    $dir = (Cfg::data() ?: sys_get_temp_dir() . '/teplo_data') . '/cache'; if (!is_dir($dir)) @mkdir($dir, 0700, true);
    $key = $dir . '/tgreply_' . preg_replace('/\D/', '', (string)$chat);
    $last = @filemtime($key) ?: 0;
    if (time() - $last < 60) return ['saved' => true, 'reply' => false];
    @touch($key);
    // автоподача в кабинет ХТМ включена — одна кнопка: распознать, проверить и поставить в очередь (внесём сами, можно отменить)
    // автовідправка ввімкнена (тепло — кабінет ХТМ, вода — сайт Водоканалу) — одна кнопка: распознать, проверить и поставить в очередь
    $ah = false; $av = false;
    try { $ah = class_exists('HtmSvc') && isset($uid) && HtmSvc::autoOn($uid); $av = class_exists('VkSvc') && isset($uid) && VkSvc::autoOn($uid); } catch (Throwable $e) { $ah = $av = false; }
    $auto = $ah || $av;
    if ($auto) {
      $where = $ru ? ($ah && $av ? 'тепло — в кабинет ХТМ, холодную воду — на сайт Водоканала' : ($ah ? 'в кабинет ХТМ' : 'на сайт Водоканала (холодную воду)'))
                   : ($ah && $av ? 'тепло — у кабінет ХТМ, холодну воду — на сайт Водоканалу' : ($ah ? 'у кабінет ХТМ' : 'на сайт Водоканалу (холодну воду)'));
      $text = $ru
        ? "📷 Фото получено. Теплосчётчик — пришлите все экраны (можно альбомом), по одному экрану на фото. Водомеры — одним кадром или по фото на каждый.\n\nКогда всё отправите, нажмите «Распознать и внести»: если все значения прочитаны уверенно и проверки пройдены, через несколько минут передадим их сами ($where) и напишем сюда. Если что-то не так — покажем, что проверить."
        : "📷 Фото отримано. Теплолічильник — надішліть усі екрани (можна альбомом), по одному екрану на фото. Водоміри — одним кадром або по фото на кожен.\n\nКоли все надішлете, натисніть «Розпізнати й внести»: якщо всі значення прочитано впевнено й перевірки пройдено, за кілька хвилин передамо їх самі ($where) і напишемо сюди. Якщо щось не так — покажемо, що перевірити.";
      $params = ['chat_id' => $chat, 'text' => $text,
        'reply_markup' => ['inline_keyboard' => [[['text' => $ru ? 'Распознать и внести' : 'Розпізнати й внести', 'web_app' => ['url' => Cfg::appUrl() . '?inbox=1&auto=1']]]]]];
      self::call('sendMessage', $params);
      return $params + ['auto' => true];
    }
    $text = $ru
      ? "📷 Фото получено. Теплосчётчик — пришлите все экраны (можно альбомом), по одному экрану на фото. Водомеры — можно одним кадром оба или по фото на каждый.\n\nКогда всё отправите, нажмите кнопку: сервис распознает цифры, разложит по счётчикам и покажет на проверку."
      : "📷 Фото отримано. Теплолічильник — надішліть усі екрани (можна альбомом), по одному екрану на фото. Водоміри — можна одним кадром обидва або по фото на кожен.\n\nКоли все надішлете, натисніть кнопку: сервіс розпізнає цифри, розкладе по лічильниках і покаже на перевірку.";
    $params = ['chat_id' => $chat, 'text' => $text,
      'reply_markup' => ['inline_keyboard' => [[['text' => $ru ? 'Распознать фото' : 'Розпізнати фото', 'web_app' => ['url' => Cfg::appUrl() . '?inbox=1']]]]]];
    self::call('sendMessage', $params);
    return $params;
  }

  /** Токен бота в тексте (в т.ч. пересланное сообщение @BotFather «Use this token…»). */
  public static function tokenIn(array $msg): ?string {
    return preg_match('/(?<![\w:])(\d{6,15}:[A-Za-z0-9_\-]{30,60})(?![\w\-])/', (string)($msg['text'] ?? $msg['caption'] ?? ''), $m) ? $m[1] : null;
  }
  private static function chatLog(string $res): void { @file_put_contents(Cfg::data() . '/cache/bot_chat.json', json_encode(['at' => time(), 'res' => $res]), LOCK_EX); }
  /** Смена бота из чата (владелец 07.11: «перенеси и настрой бот сам»): админ присылает или пересылает текущему боту сообщение @BotFather с токеном
   *  нового → то же, что /admin → «Настройки» → Telegram (Admin::setBot: getMe, сохранить, вебхук, перенос описания и команд, у старого — снять вебхук).
   *  Только в личке и только от Telegram админа (Admin::isTg). Сообщение с токеном удаляем из чата; ответ — от старого бота (чат с ним). */
  public static function botFromChat(array $msg, string $token, string $lang): array {
    $chat = $msg['chat']['id']; $old = (string)Cfg::get('bot_token'); $ru = $lang === 'ru'; $private = ($msg['chat']['type'] ?? 'private') === 'private';
    if ($private && !empty($msg['message_id'])) { try { self::call('deleteMessage', ['chat_id' => $chat, 'message_id' => $msg['message_id']], $old); } catch (Throwable $e) {} }
    if (!$private || !Admin::isTg((array)($msg['from'] ?? []))) {
      self::chatLog('not_admin');
      $p = ['chat_id' => $chat, 'text' => $ru
        ? "🔒 Это похоже на токен бота. Сменить бота сервиса может только администратор — из своего Telegram, привязанного к учётке администратора. Сообщение с токеном удалено."
        : "🔒 Це схоже на токен бота. Змінити бота сервісу може лише адміністратор — зі свого Telegram, прив’язаного до облікового запису адміністратора. Повідомлення з токеном видалено."];
      self::call('sendMessage', $p, $old); return $p + ['bot' => 'not_admin'];
    }
    if ($token === $old) {
      self::chatLog('same');
      $p = ['chat_id' => $chat, 'text' => $ru ? "Этот бот уже подключён — ничего не менял. Сообщение с токеном удалено." : "Цей бот уже підключено — нічого не міняв. Повідомлення з токеном видалено."];
      self::call('sendMessage', $p, $old); return $p + ['bot' => 'same'];
    }
    try { $r = Admin::setBot($token); }
    catch (HttpError $e) {
      self::chatLog('err ' . $e->err);
      $p = ['chat_id' => $chat, 'text' => ($ru ? '⚠️ Не вышло: ' : '⚠️ Не вийшло: ') . ($e->extra['human'] ?? $e->err) . ($ru ? "\n\nБот остался прежним. Сообщение с токеном удалено." : "\n\nБот лишився попередній. Повідомлення з токеном видалено.")];
      self::call('sendMessage', $p, $old); return $p + ['bot' => 'err'];
    }
    $new = (string)$r['bot']; $mv = (array)($r['moved'] ?? []); $cp = implode(' ', (array)($mv['copied'] ?? []));
    $what = array_values(array_filter([preg_match('/(^| )description /', $cp) ? ($ru ? 'описание' : 'опис') : '',
      str_contains($cp, 'short_description') ? ($ru ? 'короткое описание' : 'короткий опис') : '', str_contains($cp, 'commands') ? ($ru ? 'команды' : 'команди') : '']));
    $nErr = count((array)($mv['errors'] ?? [])) + count((array)($r['setup']['errors'] ?? []));
    $host = (string)parse_url(Cfg::appUrl(), PHP_URL_HOST);
    self::chatLog($nErr ? 'ok_partial' : 'ok');
    $text = $ru
      ? "✅ Бот заменён: теперь сервис — @$new.\nПеренесено со старого: " . ($what ? implode(', ', $what) : 'нечего (описания у старого не было)') . '.' . ($nErr ? "\nНе удалось: $nErr (подробности — /admin → «Настройки»)." : '')
        . "\n\nОсталось в @BotFather (это умеет только он):\n• /setdomain → @$new → $host — чтобы на сайте работал вход через Telegram;\n• по желанию — аватар (/setuserpic).\n\nОткройте @$new и нажмите «Старт» — напоминания и графики теперь будут приходить оттуда. Сообщение с токеном удалено."
      : "✅ Бота замінено: тепер сервіс — @$new.\nПеренесено зі старого: " . ($what ? implode(', ', $what) : 'нічого (опису в старого не було)') . '.' . ($nErr ? "\nНе вдалося: $nErr (деталі — /admin → «Настройки»)." : '')
        . "\n\nЛишилось у @BotFather (це вміє лише він):\n• /setdomain → @$new → $host — щоб на сайті працював вхід через Telegram;\n• за бажанням — аватар (/setuserpic).\n\nВідкрийте @$new і натисніть «Старт» — нагадування й графіки тепер приходитимуть звідти. Повідомлення з токеном видалено.";
    $p = ['chat_id' => $chat, 'text' => $text, 'reply_markup' => ['inline_keyboard' => [[['text' => '@' . $new, 'url' => 'https://t.me/' . $new]]]]];
    self::call('sendMessage', $p, $old); return $p + ['bot' => 'ok'];
  }
  /** /api/health → bot: имя бота, есть ли прежний (вход из его меню), есть ли у админа Telegram для смены из чата, последняя смена и попытка из чата. Без токенов. */
  public static function health(): array {
    $mv = json_decode((string)@file_get_contents(Cfg::data() . '/cache/bot_moved.json'), true); $ch = json_decode((string)@file_get_contents(Cfg::data() . '/cache/bot_chat.json'), true);
    $adm = null; try { $adm = Admin::hasTg(); } catch (Throwable $e) {}
    return ['username' => (string)Cfg::get('bot_username') ?: null, 'prev' => (string)Cfg::get('bot_token_prev') !== '', 'adminTg' => $adm,
      'moved' => is_array($mv) ? ['at' => gmdate('c', (int)($mv['at'] ?? 0)), 'from' => (string)($mv['from'] ?? ''), 'to' => (string)($mv['to'] ?? ''), 'copied' => array_values((array)($mv['copied'] ?? [])), 'errors' => count((array)($mv['errors'] ?? []))] : null,
      'chat' => is_array($ch) ? ['at' => gmdate('c', (int)($ch['at'] ?? 0)), 'res' => (string)($ch['res'] ?? '')] : null,
      'needStart' => self::needStartCount(), 'about' => self::aboutHealth()];
  }
  /** Опис бота (84-я): коли й якої версії поставлено, скільки вдалося з 8, помилки Telegram; prev — початок опису, що стояв до нас (текст бота публічний). */
  private static function aboutHealth(): ?array {
    $ab = json_decode((string)@file_get_contents(Cfg::data() . '/cache/bot_about.json'), true); $pv = json_decode((string)@file_get_contents(Cfg::data() . '/cache/bot_about_prev.json'), true);
    if (!is_array($ab) && !is_array($pv)) return null;
    return ['at' => is_array($ab) ? gmdate('c', (int)($ab['at'] ?? 0)) : null, 'v' => $ab['v'] ?? null, 'ok' => $ab['ok'] ?? null, 'errors' => array_values((array)($ab['errors'] ?? [])),
      'prev' => is_array($pv) ? mb_substr((string)($pv['description'] ?? ''), 0, 120) : null];
  }
  /** Скольким людям сейчас показывается плашка «натисніть Старт» (последний итог рассылки no_chat/blocked, после него боту не писали) — только число. */
  public static function needStartCount(): ?int {
    try {
      $last = [];
      foreach (Db::q("SELECT r.user_id, r.status, r.sent_at, i.bot_ok FROM reminders_sent r JOIN user_identities i ON i.user_id = r.user_id AND i.type = 'telegram' WHERE r.status IS NOT NULL ORDER BY r.sent_at")->fetchAll() as $x) $last[(int)$x['user_id']] = $x;
      return count(array_filter($last, fn($x) => in_array($x['status'], ['no_chat', 'blocked'], true) && strcmp((string)($x['bot_ok'] ?? ''), (string)$x['sent_at']) < 0));
    } catch (Throwable $e) { return null; }
  }

  public static function handleUpdate(array $u): ?array {
    if (isset($u['widget_query']) && is_array($u['widget_query'])) return class_exists('BotWidget') ? BotWidget::query($u['widget_query']) : null;
    if (isset($u['callback_query']) && is_array($u['callback_query'])) {
      if (preg_match('/^l[ix]:/', (string)($u['callback_query']['data'] ?? ''))) return TgLogin::botCallback($u['callback_query']);   // 190-я: «Так, увійти» в браузері
      return class_exists('Share') ? Share::botCallback($u['callback_query']) : null;
    }
    $msg = $u['message'] ?? null; if (!$msg || empty($msg['chat']['id'])) return null;
    // человек написал боту в личку — бот теперь может ему писать (плашка «натисніть Старт» уходит)
    if (($msg['chat']['type'] ?? '') === 'private' && !empty($msg['from']['id'])) self::markBotOk((string)$msg['from']['id']);
    $lang = str_starts_with((string)($msg['from']['language_code'] ?? ''), 'ru') ? 'ru' : 'uk';
    // 190-я: «Зберегти через Telegram» на сайті (t.me/<бот>?start=in_<t>) — питання «Увійти в браузері …?» з кнопкою
    if (preg_match('/^\/start\s+in_([A-Za-z0-9_-]{24})(?![A-Za-z0-9_-])/', (string)($msg['text'] ?? ''), $im)) return TgLogin::botStart($msg, $im[1], $lang);
    // 179-я: запрошення в спільну квартиру (t.me/<бот>?start=j<токен>) — картка з «Приєднатися»
    if (class_exists('Share') && preg_match('/^\/start\s+j([A-Za-z0-9_-]{24})(?![A-Za-z0-9_-])/', (string)($msg['text'] ?? ''), $sm)) return Share::botStart($msg, $sm[1], $lang);
    if (class_exists('Share') && preg_match('/^\/(dostup|access)(@\w+)?(\s|$)/', (string)($msg['text'] ?? ''))) return Share::botMenu((array)($msg['from'] ?? []), $msg['chat']['id'], $lang);
    if (($tk = self::tokenIn($msg)) !== null) return self::botFromChat($msg, $tk, $lang);
    if (($src = self::fwdSrc($msg)) !== null) return self::vkReply($msg, $lang, $src);
    // перелік «Адреси та черги» з каналу Харківобленерго — для визначення черги відключень за адресою (app/gpv.php)
    if (class_exists('Gpv') && Gpv::isListDoc($msg)) return Gpv::listFromBot($msg, $lang);
    if (!empty($msg['photo']) || (isset($msg['document']['mime_type']) && preg_match('#^image/(jpeg|png|webp)$#', (string)$msg['document']['mime_type']))) return self::photo($msg, $lang);
    $linkText = null;
    if (preg_match('/^\/start\s+link_([a-f0-9]{32})\b/', (string)($msg['text'] ?? ''), $m)) $linkText = self::linkByToken((array)($msg['from'] ?? []), $m[1], $lang);
    // привітання на /start (і на будь-яке повідомлення без фото) — що вміє сервіс + кнопка, що відкриває Mini App
    $text = $lang === 'ru'
      ? "👋 Здравствуйте! Это «передай» — показания всех счётчиков в одном месте.\n\n🔥 Тепло, 💧 горячая и холодная вода, 💡 свет, 🔥 газ — для одной квартиры или нескольких (своей, родительской, той, что сдаёте).\n\nЧто умеет сервис:\n📷 цифры с фото счётчика распознаёт сам — фото можно прислать и прямо сюда, в чат;\n✅ проверит показания, прежде чем вы их передадите;\n📤 подскажет, куда и как передать — по адресу квартиры (Харьковщина, Киев и область, Одесщина, Львовщина);\n⏰ напомнит, когда пора подавать показания;\n💡 на Харьковщине — каждое утро график отключений света для вашей очереди;\n📊 сохранит историю и покажет, сколько это стоило.\n\nНажмите кнопку ниже и добавьте первый счётчик — это займёт минуту."
      : "👋 Вітаю! Це «передай» — показання всіх лічильників в одному місці.\n\n🔥 Тепло, 💧 гаряча й холодна вода, 💡 світло, 🔥 газ — для однієї квартири чи кількох (своєї, батьківської, тієї, що здаєте).\n\nЩо вміє сервіс:\n📷 цифри з фото лічильника розпізнає сам — фото можна надіслати й прямо сюди, в чат;\n✅ перевірить показання, перш ніж ви їх передасте;\n📤 підкаже, куди й як передати — за адресою квартири (Харківщина, Київ і область, Одещина, Львівщина);\n⏰ нагадає, коли час подавати показання;\n💡 на Харківщині — щоранку графік відключень світла для вашої черги;\n📊 збереже історію й покаже, скільки це коштувало.\n\nНатисніть кнопку нижче й додайте свій перший лічильник — це займе хвилину.";
    $btn = $lang === 'ru' ? 'Открыть «передай»' : 'Відкрити «передай»';
    // кнопка меню в цьому чаті — мовою людини (за замовчуванням для всіх — «Відкрити»)
    if ($lang === 'ru' && preg_match('/^\/start\b/', (string)($msg['text'] ?? ''))) { try { self::call('setChatMenuButton', ['chat_id' => $msg['chat']['id'], 'menu_button' => ['type' => 'web_app', 'text' => self::menuText('ru'), 'web_app' => ['url' => Cfg::appUrl()]]]); } catch (Throwable $e) { /* не головне */ } }
    if ($linkText !== null) $text = $linkText;
    $params = ['chat_id' => $msg['chat']['id'], 'text' => $text,
      'reply_markup' => ['inline_keyboard' => [[['text' => $btn, 'web_app' => ['url' => Cfg::appUrl()]]]]]];
    self::call('sendMessage', $params);
    return $params;
  }
}

/** 190-я (власник 25.11: «після першого налаштування — явно: збережіться через Telegram чи свій акаунт, щоб не втратити дані й входити з інших браузерів»).
 *  Раніше «Увійти через Telegram» на сайті лише відкривала бота: вхід був у вікні Telegram, браузер лишався без входу, і внесене в ньому туди не потрапляло.
 *  Тепер вхід — САМЕ В ЦЬОМУ БРАУЗЕРІ: браузер складає посилання t.me/<бот>?start=in_<t> (t — 24 випадкові символи; посилання одразу в <a href>, тож телефон
 *  відкриває Telegram без блокування вікон) і реєструє t з хешем свого секрету k (POST /api/auth/tg/start) → бот на /start in_<t> питає «Увійти в браузері
 *  Chrome · Windows? Код на сайті — NNNN» → «Так, увійти» (li:<t>): акаунт цього Telegram (userFor, немає — новий) у рядку → браузер (POST /api/auth/tg/poll {t, k})
 *  отримує сесію, і його дані йдуть в акаунт (sync.js pull(true)). Без «Так» нічого: саме посилання вхід не дає, і без k (лише t з посилання) — теж. 15 хв, один раз. */
final class TgLogin {
  const TTL = 900;
  private static function okT(string $t): bool { return (bool)preg_match('/^[A-Za-z0-9_-]{24}$/', $t); }
  private static function row(string $t): ?array {
    if (!self::okT($t)) return null;
    $x = Db::one('SELECT * FROM tg_logins WHERE token_hash = ?', [hash('sha256', $t)]);
    return $x && (int)$x['expires_at'] >= time() ? $x : null;
  }
  /** «Chrome · Windows» з User-Agent — у боті видно, який браузер просить вхід. */
  public static function uaShort(string $ua): string {
    $b = ''; foreach (['~EdgA?/|EdgiOS~' => 'Edge', '~OPR/|Opera~' => 'Opera', '~SamsungBrowser~' => 'Samsung Internet', '~Firefox/|FxiOS~' => 'Firefox', '~PeredaiApp/~' => 'застосунок', '~CriOS|Chrome/~' => 'Chrome', '~Safari/~' => 'Safari'] as $re => $n) if (preg_match($re, $ua)) { $b = $n; break; }
    $o = ''; foreach (['~iPhone~' => 'iPhone', '~iPad~' => 'iPad', '~Android~' => 'Android', '~Windows~' => 'Windows', '~Mac OS X|Macintosh~' => 'Mac', '~Linux~' => 'Linux'] as $re => $n) if (preg_match($re, $ua)) { $o = $n; break; }
    return implode(' · ', array_filter([$b, $o]));
  }
  /** Браузер реєструє своє посилання: t (є в посиланні) і хеш k (лише в браузера). Повтор того ж t з тим самим k — той самий код. */
  public static function start(array $in, string $ua): array {
    $t = (string)($in['t'] ?? ''); $k = (string)($in['k'] ?? '');
    if (!self::okT($t) || !preg_match('/^[A-Za-z0-9_-]{32,64}$/', $k)) throw new HttpError(422, 'bad_token');
    $bot = (string)Cfg::get('bot_username'); if ($bot === '' || !Cfg::get('bot_token')) throw new HttpError(503, 'no_bot');
    Db::q('DELETE FROM tg_logins WHERE expires_at < ?', [time() - 86400]);
    // 191-а: pre — браузер реєструє t і k ще до дотику (кнопку щойно намалювали): у вбудованих браузерах (Threads, Instagram) запит після дотику
    // обривався переходом на t.me — рядка не було, бот казав «застаріло». Дотик (pre = 0) лише переводить 'pre' → 'new' і подовжує строк.
    $pre = !empty($in['pre']);
    $h = hash('sha256', $t); $x = Db::one('SELECT kh, code, st, expires_at FROM tg_logins WHERE token_hash = ?', [$h]);
    if ($x) {
      if (!hash_equals((string)$x['kh'], hash('sha256', $k))) throw new HttpError(409, 'bad_token');
      if (!$pre && in_array($x['st'], ['pre', 'new'], true)) { Db::q("UPDATE tg_logins SET st = 'new', expires_at = ? WHERE token_hash = ? AND st IN ('pre', 'new')", [time() + self::TTL, $h]); $x['expires_at'] = time() + self::TTL; }
      return ['code' => $x['code'], 'bot' => $bot, 'ttl' => max(0, (int)$x['expires_at'] - time())];
    }
    $code = sprintf('%04d', random_int(0, 9999));
    Db::q('INSERT INTO tg_logins (token_hash, kh, code, ua, lang, st, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)',
      [$h, hash('sha256', $k), $code, mb_substr(self::uaShort($ua), 0, 60), ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk', $pre ? 'pre' : 'new', time(), time() + self::TTL]);
    return ['code' => $code, 'bot' => $bot, 'ttl' => self::TTL];
  }
  /** Браузер питає: підтвердили? → state wait | seen (бот показав питання) | no («Ні, це не я»); ok — один раз, з uid (сесію ставить Api). Чужий k — як немає. */
  public static function poll(array $in): array {
    $t = (string)($in['t'] ?? ''); $x = self::row($t);
    if (!$x || !hash_equals((string)$x['kh'], hash('sha256', (string)($in['k'] ?? '')))) throw new HttpError(410, 'tg_expired');
    if ($x['st'] === 'ok' && (int)$x['user_id'] > 0) {
      if (Db::q("UPDATE tg_logins SET st = 'used' WHERE token_hash = ? AND st = 'ok'", [hash('sha256', $t)])->rowCount() !== 1) throw new HttpError(410, 'tg_expired');
      return ['state' => 'ok', 'uid' => (int)$x['user_id']];
    }
    if ($x['st'] === 'used') throw new HttpError(410, 'tg_expired');
    return ['state' => $x['st'] === 'no' ? 'no' : ($x['st'] === 'seen' ? 'seen' : 'wait')];
  }
  private static function host(): string { return (string)(parse_url(Cfg::appUrl(), PHP_URL_HOST) ?: 'сайті'); }
  private static function stale(bool $ru): string {
    return $ru ? '🔐 Ссылка для входа устарела. На сайте нажмите «Сохранить через Telegram» ещё раз.' : '🔐 Посилання для входу застаріло. На сайті натисніть «Зберегти через Telegram» ще раз.';
  }
  /** /start in_<t>: питання з браузером і кодом, кнопки «Так, увійти» / «Ні, це не я». */
  public static function botStart(array $msg, string $t, string $lang): array {
    $ru = $lang === 'ru'; $chat = $msg['chat']['id']; $x = self::row($t);
    if (!$x || !in_array($x['st'], ['pre', 'new', 'seen'], true)) { $p = ['chat_id' => $chat, 'text' => self::stale($ru)]; Telegram::call('sendMessage', $p); return $p; }
    // 'pre' — дотик до сайту не долетів (сторінка вже пішла на t.me), але браузер зареєстрував посилання заздалегідь: питаємо, як звичайно
    Db::q("UPDATE tg_logins SET st = 'seen', expires_at = ? WHERE token_hash = ? AND st IN ('pre', 'new')", [time() + self::TTL, hash('sha256', $t)]);
    $br = trim((string)($x['ua'] ?? '')); $br = $br === 'застосунок' ? ($ru ? 'в приложении «передай»' : 'у застосунку «передай»') : ($br !== '' ? ($ru ? 'в браузере ' : 'у браузері ') . $br : ($ru ? 'в браузере' : 'у браузері'));
    $host = self::host();
    $txt = $ru
      ? "🔐 Войти в «передай» {$br}?\n\nКод на сайте — {$x['code']}. Счётчики и показания из браузера сохранятся в аккаунте этого Telegram — их можно будет открыть на любом телефоне или компьютере.\n\nЕсли вы не нажимали «Сохранить через Telegram» на {$host} — ничего не нажимайте."
      : "🔐 Увійти в «передай» {$br}?\n\nКод на сайті — {$x['code']}. Лічильники й показання з браузера збережуться в акаунті цього Telegram — їх можна буде відкрити на будь-якому телефоні чи комп’ютері.\n\nЯкщо ви не натискали «Зберегти через Telegram» на {$host} — нічого не натискайте.";
    $p = ['chat_id' => $chat, 'text' => $txt, 'reply_markup' => ['inline_keyboard' => [[['text' => $ru ? '✅ Да, войти' : '✅ Так, увійти', 'callback_data' => 'li:' . $t]],
      [['text' => $ru ? 'Нет, это не я' : 'Ні, це не я', 'callback_data' => 'lx:' . $t]]]]];
    Telegram::call('sendMessage', $p); return $p;
  }
  /** li:<t> — так: акаунт цього Telegram у рядок (браузер забере сесію); lx:<t> — ні. */
  public static function botCallback(array $cq): ?array {
    if (!preg_match('/^l([ix]):([A-Za-z0-9_-]{24})$/', (string)($cq['data'] ?? ''), $m)) return null;
    $from = (array)($cq['from'] ?? []); $ru = str_starts_with((string)($from['language_code'] ?? ''), 'ru');
    $msg = (array)($cq['message'] ?? []); $chat = $msg['chat']['id'] ?? ($from['id'] ?? null); $mid = $msg['message_id'] ?? null;
    Telegram::call('answerCallbackQuery', ['callback_query_id' => $cq['id'] ?? '']);
    $edit = function (string $text, ?array $kb) use ($chat, $mid) {
      $p = ['chat_id' => $chat, 'message_id' => $mid, 'text' => $text] + ($kb ? ['reply_markup' => ['inline_keyboard' => $kb]] : []);
      if ($chat !== null && $mid !== null) Telegram::call('editMessageText', $p); elseif ($chat !== null) { unset($p['message_id']); Telegram::call('sendMessage', $p); }
      return $p;
    };
    $h = hash('sha256', $m[2]); $x = self::row($m[2]);
    if (!$x || !in_array($x['st'], ['new', 'seen'], true)) return $edit(self::stale($ru), null);
    if ($m[1] === 'x') {
      Db::q("UPDATE tg_logins SET st = 'no' WHERE token_hash = ? AND st IN ('new', 'seen')", [$h]);
      return $edit($ru ? '🔐 Хорошо, вход не подтверждён — браузер остался без входа.' : '🔐 Добре, вхід не підтверджено — браузер лишився без входу.', null);
    }
    $uid = Telegram::userFor($from);
    if (!Db::one('SELECT name FROM users WHERE id = ? AND name IS NOT NULL', [$uid])) { $nm = trim(($from['first_name'] ?? '') . ' ' . ($from['last_name'] ?? '')); if ($nm !== '') Db::q('UPDATE users SET name = ? WHERE id = ?', [mb_substr($nm, 0, 80), $uid]); }
    Db::q("UPDATE tg_logins SET st = 'ok', user_id = ? WHERE token_hash = ? AND st IN ('new', 'seen')", [$uid, $h]);
    Telegram::markBotOk((string)($from['id'] ?? ''));
    return $edit($ru ? "✅ Готово. Вернитесь в браузер — там уже вход, и данные сохранятся в аккаунте сами.\n\nВ следующий раз на другом устройстве нажмите «Войти через Telegram» — откроются те же показания."
      : "✅ Готово. Поверніться в браузер — там уже вхід, і дані збережуться в акаунті самі.\n\nНаступного разу на іншому пристрої натисніть «Увійти через Telegram» — відкриються ті самі показання.",
      [[['text' => $ru ? 'Открыть «передай»' : 'Відкрити «передай»', 'web_app' => ['url' => Cfg::appUrl()]]]]);
  }
  /** /api/health: за 7 днів — скільки разів почали, підтвердили, забрали вхід, відмовились (лише числа). */
  public static function summary(): array {
    try { $r = Db::one("SELECT SUM(CASE WHEN st <> 'pre' THEN 1 ELSE 0 END) AS n, SUM(CASE WHEN st = 'pre' THEN 1 ELSE 0 END) AS pre, SUM(CASE WHEN st IN ('ok', 'used') THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN st = 'used' THEN 1 ELSE 0 END) AS used, SUM(CASE WHEN st = 'no' THEN 1 ELSE 0 END) AS no, SUM(CASE WHEN st = 'seen' THEN 1 ELSE 0 END) AS seen FROM tg_logins WHERE created_at >= ?", [time() - 7 * 86400]) ?? [];
      return array_map('intval', ['n' => $r['n'] ?? 0, 'pre' => $r['pre'] ?? 0, 'seen' => $r['seen'] ?? 0, 'ok' => $r['ok'] ?? 0, 'used' => $r['used'] ?? 0, 'no' => $r['no'] ?? 0]); }
    catch (Throwable $e) { return ['err' => 'db']; }
  }
}
