<?php
// Теплосервис — JSON API. Чистая функция Api::handle(запрос) → ответ (тестируется без веб-сервера).
//  GET  /api/config                 → {botUsername, telegramLogin, build, auto} (auto — у кого «Відправити у фоні», лендинг)
//  GET  /api/me                     → {user} | 401
//  POST /api/auth/register          {email, password}
//  POST /api/auth/login             {email, password}
//  POST /api/auth/telegram/webapp   {initData}           — вход внутри бота (Mini App)
//  POST /api/auth/telegram/widget   {id, ..., hash}      — кнопка «Увійти через Telegram» на сайте
//  POST /api/bot/write-ok            → {user} — Mini App нынешнего бота: человек разрешил боту писать (снимает user.botStart)
//  POST /api/auth/link-bot          → {url} t.me/<бот>?start=link_<token> — привязать Telegram через бота (15 мин)
//  POST /api/auth/link-telegram     {widget data}        — привязать Telegram к аккаунту с паролем
//  POST /api/auth/password          {email, password}    — задать email+пароль аккаунту из Telegram
//  POST /api/auth/logout
//  GET  /api/state                  → {state, version}
//  PUT  /api/state                  {state, baseVersion} → {version} | 409 {state, version}; прошлая версия → user_state_hist (StateHist)
//  POST /api/bot/webhook            (заголовок X-Telegram-Bot-Api-Secret-Token); фото в чате → bot_inbox
//  GET  /api/inbox, GET /api/inbox/file?id=…, POST /api/inbox/done {ids} — фото из бота на распознавание в браузере
//  POST /api/bot/setup              (заголовок X-Setup-Secret = webhook_secret) — вебхук, кнопка меню, /start
//  POST /api/recognize/upload       фото СЫРЫМ телом (Content-Type: image/*) → {id}
//  POST /api/docs/upload?place&kind  документ к счётчику или платёжка (kind=bill; фото/PDF сырым телом) · GET /api/docs · GET /api/docs/file?id · POST /api/docs/delete
//  GET /api/docs/link?id → {url: 'docs/open?id&e&s'} — подписанная ссылка на 15 мин (открыть PDF во внешнем браузере из Telegram)
//  GET  /api/photo?id=…             фото к записи истории — байты, только хозяину
//  POST /api/photo/keep             {ids, keep} — фото записи хранить, пока есть запись (keep=false — снова по сроку photo_keep_days)
//  GET  /api/vk/replies             ответы бота Водоканала, пересланные нашему боту (подтверждение передачи воды)
//  GET  /api/bot/replies?src=obl|grm  то же для света (@Kooz2bot) и газа (@mygrmu_bot)
//  GET  /api/vk/status · POST /api/vk/event {kind}  работают ли бот и кабинет Водоканала (VkStatus, app/admin.php)
//  POST /api/vk/bill {acc, fam, place} — квитанция Водоканала (PDF) в docs, если новая
//  POST /api/vk/cab/check {acc, fam} · POST /api/vk/cab/send {acc, fam, items: [{key, value, serial?, name?}], date?}
//                                   кабинет Водоканала «без реєстрації»: что видит сайт / отправить показания (VkCab, app/vkcab.php)
//  GET  /api/cab/htm · POST /api/cab/htm/connect {email, password, phone?, consent} · POST /api/cab/forget {prov}
//  POST /api/cab/htm/check {acc?} · POST /api/cab/htm/send {acc?, rid, place, vals, delay?}   кабинет ХТМ по паролю человека (HtmSvc, app/htmsvc.php)
//  POST /api/cab/htm/auto {on} · POST /api/cab/htm/cancel {job} · POST /api/cab/htm/now {job}   автоподача: очередь внесений после фото в бот
//  GET /api/lb?bot=&place= · POST /api/lb/connect|forget|queue|cancel|now — автоподача місцевим КП (LocalBot, app/localbot.php)
//  GET /api/vk/jobs · POST /api/vk/queue {acc, fam, rid, place, items, auto?} · POST /api/vk/auto {on, consent} · POST /api/vk/job/cancel|now {job}
//                                   вода → сайт Водоканалу «у фоні» и автоподача після фото в бот (VkSvc, app/vksvc.php)
//  GET  /api/relay/next?v=           ретранслятор NAS (X-Relay-Key): «idle N» или шаг задания текстом (Relay)
//  POST /api/relay/done?id=&s=[&e=]  сырой вывод curl -i шага → «ok» / «ok end»
//  POST /api/relay/probe?t=obl|form&via=nas  вывод curl -i -L страницы обленерго с NAS владельца (без входа, сырой текст) → RelayProbe; GET — итог и команда
//  GET  /api/weather?from&to       средняя за сутки в Харькове (Open-Meteo, кэш) — для истории
//  POST /api/recognize/local        {ids, results} — итог распознавания в браузере (свой движок, без нейросети) → в аналитику
//  POST /api/recognize/run          {ids[≤3], offset, ctx} → распознанное (vision-API, ключ в config.php)
//  POST /api/recognize/report       {ids, missing, conflicts, corrections} — итог для аналитики
//  GET  /api/places/suggest?q=&r=   підказка населеного пункту у формі адреси (Providers::suggest), вхід не потрібен
//  POST /api/visit                  {vid, device, os, tg, pwa, sw} — с чего открыли сайт (аналитика устройств), вход не нужен
//  POST /api/feedback               {text, contact?, page, screen, lang} — плавающая кнопка «Відгук», вход не нужен
//  GET  /api/admin/*                аналитика владельца (только admins из config.php), см. app/admin.php
//  GET  /api/admin/photo?id=…       байты фото (не JSON)
//  Пути здесь — без SITE_BASE: index.php отрезает его.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Req {
  public function __construct(public string $method, public string $path, public array $server = [], public array $cookies = [], public string $body = '') {}
  public function json(): array { $j = json_decode($this->body, true); return is_array($j) ? $j : []; }
  public function query(): array { parse_str((string)($this->server['QUERY_STRING'] ?? ''), $q); return $q; }
  public function header(string $name): string { return (string)($this->server['HTTP_' . strtoupper(str_replace('-', '_', $name))] ?? ''); }
}
final class Res {
  public array $cookies = [];
  /** Если задан — index.php отдаёт файл ['path','mime'] вместо JSON. */
  public ?array $file = null;
  /** Если задан — index.php отдаёт text/plain (ретранслятор NAS: sh читает строки). */
  public ?string $text = null;
  /** Если задан — index.php отдаёт text/html (страница отписки от писем /api/mail/off). */
  public ?string $html = null;
  public function __construct(public int $status = 200, public array $body = []) {}
}

final class Api {
  public static function handle(Req $r): Res {
    $res = new Res();
    try {
      $ip = Http::ip($r->server);
      if (strlen($r->body) > self::bodyLimit($r->path)) throw new HttpError(413, 'too_large');
      $isHook = $r->path === '/api/bot/webhook' || $r->path === '/api/bot/setup';
      if (!$isHook) RateLimit::hit('ip_all', $ip);
      // CSRF: для изменяющих запросов заголовок X-CSRF должен совпасть с cookie ts_csrf (double submit) + SameSite=Lax
      // Без перевірки: вхід Mini App (initData підписана Telegram), журнал дій, вибір у банері cookie і запити із заголовком X-Session (вікно Telegram, де
      // cookie не зберігаються: чужий сайт власний заголовок без CORS не надішле, а cookie такі запити не використовують).
      // проба обленерго с NAS (RelayProbe) — curl без cookie и без входа: подделывать нечего, ничего от имени человека не меняет
      // /api/visit — отметка «открыли сайт» (аналитика, как журнал): подделывать нечего; с CSRF терялась у новых посетителей (08.11)
      $csrfFree = $isHook || $r->path === '/api/auth/telegram/webapp' || $r->path === '/api/events' || $r->path === '/api/consent' || $r->path === '/api/visit' || $r->path === '/api/relay/probe' || $r->path === '/api/relay/done' || $r->path === '/api/mail/off' || $r->header('X-Session') !== '';   // /api/mail/off — по подписи из письма (и One-Click из почтовика)
      if (!$csrfFree && $r->method !== 'GET') {
        $c = (string)($r->cookies['ts_csrf'] ?? ''); $h = $r->header('X-CSRF');
        if ($c === '' || !hash_equals($c, $h)) throw new HttpError(403, 'csrf');
      }
      $user = self::sessionUser($r);
      $out = self::route($r, $res, $user, $ip);
      $res->body = $out;
    } catch (HttpError $e) {
      $res->status = $e->status; $res->body = ['error' => $e->err] + $e->extra;
    }
    // CSRF-cookie выдаём всегда, если её нет (её читает JS и кладёт в заголовок)
    if (empty($r->cookies['ts_csrf'])) self::cookie($res, 'ts_csrf', bin2hex(random_bytes(16)), Http::now() + 86400 * 365, false);
    return $res;
  }

  /** Сколько байт тела принимаем: фото и документы (платёжки PDF) — до max_photo_bytes, вывод curl с NAS — max_probe_bytes, остальное — max_body_bytes.
   *  index.php читает php://input тем же лимитом (+1 байт — чтобы отличить «ровно лимит» от «больше»). */
  public static function bodyLimit(string $path): int {
    return (int)Cfg::get(in_array($path, ['/api/recognize/upload', '/api/docs/upload'], true) ? 'max_photo_bytes' : (in_array($path, ['/api/relay/probe', '/api/relay/done'], true) ? 'max_probe_bytes' : 'max_body_bytes'));
  }
  public static function rev(): string {
    $root = dirname(__DIR__); $h = '';
    foreach (array_merge([$root . '/index.php', $root . '/cron.php'], glob(__DIR__ . '/*.php') ?: []) as $f) $h .= basename($f) . ':' . (string)@md5_file($f) . ';';
    return substr(md5($h), 0, 12);
  }
  private static function route(Req $r, Res $res, ?array $user, string $ip): array {
    $m = $r->method; $p = $r->path; $in = $r->json();
    switch ("$m $p") {
      case 'GET /api/config': return ['botUsername' => Cfg::get('bot_username') ?: null, 'telegramLogin' => (bool)Cfg::get('bot_token'), 'recognition' => (bool)Cfg::get('anthropic_api_key'),
        'build' => substr((string)@md5_file(dirname(__DIR__) . '/web/dist/site.html'), 0, 12), 'auto' => LocalBot::autoIds()];
      case 'GET /api/health': {   // жив ли cron (напоминания, чистка) — без подробностей
        // пересланные ответы ботов поставщиков — только сколько (бот + как поняли), тексты — в /admin: есть ли по чему править botKind
        $fwd = []; try { foreach (Db::q('SELECT src, kind, COUNT(*) AS n FROM vk_replies GROUP BY src, kind')->fetchAll() as $x) $fwd[$x['src'] . ' ' . $x['kind']] = (int)$x['n']; } catch (Throwable $e) {}
        $g = Gpv::read(); $cr = Cron::read();
        // ошибки рассылки напоминаний (не blocked/no_chat): вид, месяц, когда и ответ Telegram — цифры замаскированы, без людей (разобрать без /admin)
        // только за 3 недели: старая ошибка (elec2 02.11.2026 — кнопка на localhost, исправлено c5f9c64) не висит в каждой сверке
        $rerr = []; try { foreach (Db::q("SELECT kind, ym, sent_at, status FROM reminders_sent WHERE status LIKE 'error%' ORDER BY sent_at DESC LIMIT 3")->fetchAll() as $x)
          if (strtotime((string)$x['sent_at']) > time() - 21 * 86400) $rerr[] = ['kind' => $x['kind'], 'ym' => $x['ym'], 'at' => $x['sent_at'], 'status' => preg_replace('/\d/', '#', mb_substr((string)$x['status'], 0, 90))]; } catch (Throwable $e) {}
        // gpvReady / remindNext — кому придут утренний график и ближайшее напоминание (считает cron, только числа);
        // vkcab — итог журнала кабинета Водоканала по «операция итог» (была ли живая проверка рахунку человеком)
        // rev — отпечаток серверного кода (md5 файлов app/*.php, index.php, cron.php): сверить с `php tests/rev.php`, что пуш уже на бою
        return ['ok' => true, 'rev' => self::rev(), 'cronAgo' => Cron::age(), 'remind' => (object)($cr['remind'] ?? []), 'remindNext' => $cr['remindNext'] ?? null, 'remindErr' => $rerr, 'cronApp' => $cr['hourly']['app'] ?? null, 'fwd' => (object)$fwd,
          'gpvSent' => (object)($cr['gpvSent'] ?? []), 'gpvReady' => $cr['gpvReady'] ?? null,
          'gpv' => ['at' => $g['at'] ?? null, 'update' => $g['update'] ?? null, 'days' => array_keys((array)($g['days'] ?? [])), 'err' => $g['err'] ?? null],
          'vkcab' => VkCab::summary(), 'cabs' => (object)CabProbe::read(), 'prov' => ProvAdmin::health(),
          // кабинет ХТМ: итоги операций, сколько подключено, внесения по статусам и последняя увиденная форма (имена/типы полей, без значений)
          'htmcab' => HtmSvc::summary(), 'vksvc' => VkSvc::summary(), 'lbot' => LocalBot::summary(), 'vkBills' => VkBills::summary(), 'htmBills' => HtmBills::summary(), 'htmSpr' => HtmSpr::summary(),
          // проба обленерго с украинского адреса (NAS владельца → POST /api/relay/probe): код, Cloudflare, капча, формы — решает, быть ли ретранслятору
          'uaProbe' => (object)RelayProbe::summary(), 'uaCheck' => (object)UaCheck::summary(),
          // ретранслятор на NAS: включён ли, на связи ли (сек. назад, версия сценария, страна), пауза, задания по состояниям
          'relay' => Relay::summary(),
          // бот: имя, последняя смена (с кого на кого, что перенесено — числа) и попытка сменить из чата; токенов нет
          'bot' => Telegram::health(),
          // ошибки у людей за 3 дня: JS и API по месту, тосты (≥ 3 браузера), устройства — числа и тексты ошибок, без людей
          'errs' => (function () { try { return Journal::errSummary(3); } catch (Throwable $e) { return ['err' => $e->getMessage()]; } })(),
          'indexnow' => class_exists('IndexNow', false) ? IndexNow::summary() : null,
          // почта (81-я): включена ли, сколько писем за сутки по видам и итогам, последний сбой — без адресов
          'mail' => class_exists('Mail', false) ? Mail::health() : null];
      }
      // отписка от нагадувань на e-mail: GET — страница с кнопкой (почтовые сканеры ходят по ссылкам — по GET не отписываем), POST — отписать (и One-Click)
      case 'GET /api/mail/off': case 'POST /api/mail/off': {
        $q = $r->query(); $uid = (int)($q['u'] ?? 0); $t = (string)($q['t'] ?? ''); $ok = $uid > 0 && hash_equals(Mail::optoutToken($uid), $t);
        $done = $ok && $m === 'POST' && Mail::optout($uid, $t);
        $res->html = Mail::optoutPage($ok, $done, $uid, $t); return [];
      }
      case 'GET /api/me': if (!$user) throw new HttpError(401, 'unauthorized'); return ['user' => self::publicUser($user)];
      // нарахування ХТМ по місяцях із «Довідки по теплу» кабінету (робот бере разом із квитанцією) — лише свої
      case 'GET /api/htm/spr': if (!$user) throw new HttpError(401, 'unauthorized'); return ['places' => HtmSpr::mine((int)$user['id'])];

      case 'POST /api/auth/register': {
        RateLimit::hit('register_ip', $ip);
        [$email, $pass] = self::creds($in);
        if (Db::one('SELECT id FROM users WHERE email = ?', [$email])) throw new HttpError(409, 'email_taken');
        Db::q('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)', [$email, password_hash($pass, PASSWORD_DEFAULT), Http::iso()]);
        $u = self::userById(Db::id()); self::startSession($res, $u, $r, $ip); self::audit($u['id'], 'register', $ip);
        return ['user' => self::publicUser($u)];
      }
      case 'POST /api/auth/login': {
        RateLimit::hit('login_ip', $ip);
        $email = mb_strtolower(trim((string)($in['email'] ?? ''))); $pass = (string)($in['password'] ?? '');
        RateLimit::check('login_fail_acc', $email);               // аккаунт заблокирован после N неудач
        $u = $email !== '' ? Db::one('SELECT * FROM users WHERE email = ?', [$email]) : null;
        // одинаковое время ответа: проверяем хэш и для несуществующего email
        $ok = password_verify($pass, ($u['password_hash'] ?? null) ?: self::dummyHash());
        if (!$u || !$u['password_hash'] || !$ok) { RateLimit::hit('login_fail_acc', $email); self::audit($u['id'] ?? null, 'login_fail', $ip); throw new HttpError(401, 'bad_credentials'); }
        if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) Db::q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
        self::startSession($res, $u, $r, $ip); self::audit($u['id'], 'login', $ip);
        return ['user' => self::publicUser($u)];
      }
      case 'POST /api/auth/telegram/webapp':
      case 'POST /api/auth/telegram/widget': {
        RateLimit::hit('telegram_ip', $ip);
        if ($p === '/api/auth/telegram/webapp') {
          // после смены бота (Admin::setBot) сайт ещё открывают из меню прежнего — его подпись тоже принимаем
          try { $tg = Telegram::verifyWebApp((string)($in['initData'] ?? ''), (string)Cfg::get('bot_token')); }
          catch (HttpError $e) { $prev = (string)Cfg::get('bot_token_prev'); if ($e->err !== 'telegram_bad_signature' || $prev === '') throw $e; $tg = Telegram::verifyWebApp((string)($in['initData'] ?? ''), $prev); }
        } else $tg = Telegram::verifyWidget($in, (string)Cfg::get('bot_token'));
        $tgBot = $p !== '/api/auth/telegram/webapp' ? '' : (isset($prev) && $prev !== '' ? 'prev' : 'cur');   // Mini App нынешнего бота или прежнего (из его меню)
        $idn = Db::one("SELECT * FROM user_identities WHERE type = 'telegram' AND external_id = ?", [$tg['id']]);
        if ($idn) { $u = self::userById((int)$idn['user_id']); Db::q("UPDATE user_identities SET username = ? WHERE id = ?", [$tg['username'], $idn['id']]); }
        else {
          Db::q('INSERT INTO users (name, created_at) VALUES (?, ?)', [$tg['name'] ?: null, Http::iso()]);
          $uid = Db::id();
          try { Db::q("INSERT INTO user_identities (user_id, type, external_id, username, linked_at) VALUES (?, 'telegram', ?, ?, ?)", [$uid, $tg['id'], $tg['username'], Http::iso()]); }
          catch (PDOException $e) {   // два первых входа разом: второй — в ту же учётку, лишнего пустого пользователя не оставляем
            $idn = Db::one("SELECT * FROM user_identities WHERE type = 'telegram' AND external_id = ?", [$tg['id']]); if (!$idn) throw $e;
            Db::q('DELETE FROM users WHERE id = ?', [$uid]); $uid = (int)$idn['user_id'];
          }
          $u = self::userById($uid);
        }
        if ($tgBot === 'cur' && !empty($tg['write'])) Telegram::markBotOk((string)$tg['id']);   // открыл Mini App нынешнего бота и разрешил ему писать
        $tok = self::startSession($res, $u, $r, $ip); self::audit($u['id'], 'login_telegram', $ip);
        // Mini App: токен сесії й у відповіді — вікно Telegram на Mac інколи не зберігає cookie; тоді застосунок шле його заголовком X-Session
        return ['user' => self::publicUser($u)] + ($p === '/api/auth/telegram/webapp' ? ['session' => $tok, 'tgBot' => $tgBot] : []);
      }
      case 'POST /api/bot/write-ok': {   // Mini App нынешнего бота: человек разрешил боту писать (requestWriteAccess) — плашка «натисніть Старт» уходит
        if (!$user) throw new HttpError(401, 'unauthorized');
        $tgi = Db::one("SELECT external_id FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$user['id']]);
        if ($tgi) Telegram::markBotOk((string)$tgi['external_id']);
        return ['user' => self::publicUser(self::userById((int)$user['id']))];
      }
      case 'POST /api/auth/link-bot': {   // ссылка на бота для привязки Telegram без виджета (работает при любом CSP)
        if (!$user) throw new HttpError(401, 'unauthorized');
        RateLimit::hit('telegram_ip', $ip);
        $bot = (string)Cfg::get('bot_username'); if ($bot === '') throw new HttpError(503, 'no_bot');
        $tok = bin2hex(random_bytes(16));
        Db::q('INSERT INTO link_tokens (token, user_id, expires_at) VALUES (?, ?, ?)', [$tok, $user['id'], time() + 900]);
        return ['url' => 'https://t.me/' . rawurlencode($bot) . '?start=link_' . $tok, 'expiresIn' => 900];
      }
      case 'POST /api/auth/link-telegram': {
        if (!$user) throw new HttpError(401, 'unauthorized');
        RateLimit::hit('telegram_ip', $ip);
        $tg = Telegram::verifyWidget($in, (string)Cfg::get('bot_token'));
        $idn = Db::one("SELECT * FROM user_identities WHERE type = 'telegram' AND external_id = ?", [$tg['id']]);
        if ($idn && (int)$idn['user_id'] !== (int)$user['id']) throw new HttpError(409, 'telegram_linked_elsewhere');
        if (!$idn) Db::q("INSERT INTO user_identities (user_id, type, external_id, username, linked_at) VALUES (?, 'telegram', ?, ?, ?)", [$user['id'], $tg['id'], $tg['username'], Http::iso()]);
        self::audit($user['id'], 'link_telegram', $ip);
        return ['user' => self::publicUser(self::userById((int)$user['id']))];
      }
      case 'POST /api/auth/password': {
        if (!$user) throw new HttpError(401, 'unauthorized');
        RateLimit::hit('register_ip', $ip);
        [$email, $pass] = self::creds($in);
        $other = Db::one('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, $user['id']]);
        if ($other) throw new HttpError(409, 'email_taken');
        Db::q('UPDATE users SET email = ?, password_hash = ? WHERE id = ?', [$email, password_hash($pass, PASSWORD_DEFAULT), $user['id']]);
        // смена пароля завершает все остальные сессии
        Db::q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [$user['id'], hash('sha256', (string)($r->cookies['ts_sid'] ?? ''))]);
        self::audit($user['id'], 'set_password', $ip);
        return ['user' => self::publicUser(self::userById((int)$user['id']))];
      }
      case 'POST /api/auth/logout': {
        if (!empty($r->cookies['ts_sid'])) Db::q('DELETE FROM sessions WHERE token_hash = ?', [hash('sha256', (string)$r->cookies['ts_sid'])]);
        if ($r->header('X-Session') !== '') Db::q('DELETE FROM sessions WHERE token_hash = ?', [hash('sha256', $r->header('X-Session'))]);
        self::cookie($res, 'ts_sid', '', 1, true);
        return ['ok' => true];
      }

      case 'GET /api/state': {
        if (!$user) throw new HttpError(401, 'unauthorized');
        RateLimit::hit('state_user', (string)$user['id']);
        $row = Db::one('SELECT data, version FROM user_state WHERE user_id = ?', [$user['id']]);
        return ['state' => $row ? json_decode($row['data'], true) : null, 'version' => $row ? (int)$row['version'] : 0];
      }
      case 'PUT /api/state': {
        if (!$user) throw new HttpError(401, 'unauthorized');
        RateLimit::hit('state_user', (string)$user['id']);
        $state = $in['state'] ?? null; $base = (int)($in['baseVersion'] ?? 0);
        if (!is_array($state) || !isset($state['readings']) || !is_array($state['readings'])) throw new HttpError(422, 'bad_state');
        $row = Db::one('SELECT data, version, updated_at FROM user_state WHERE user_id = ?', [$user['id']]);
        $cur = $row ? (int)$row['version'] : 0;
        if ($cur !== $base) throw new HttpError(409, 'conflict', ['state' => json_decode($row['data'], true), 'version' => $cur]);
        $json = json_encode($state, JSON_UNESCAPED_UNICODE);
        if ($row) {
          // одновременная запись с другого устройства успела раньше — не затираем её молча, а отдаём как конфликт (клиент сольёт и повторит)
          if (Db::q('UPDATE user_state SET data = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?', [$json, Http::iso(), $user['id'], $cur])->rowCount() !== 1) {
            $now = Db::one('SELECT data, version FROM user_state WHERE user_id = ?', [$user['id']]);
            throw new HttpError(409, 'conflict', ['state' => json_decode((string)$now['data'], true), 'version' => (int)$now['version']]);
          }
          // прошлая версия — в историю (вернуть из /admin, если сохранение что-то затёрло)
          if ($row['data'] !== $json) StateHist::put((int)$user['id'], (string)$row['data'], $cur, (string)$row['updated_at']);
        }
        else try { Db::q('INSERT INTO user_state (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)', [$user['id'], $json, Http::iso()]); }
        catch (PDOException $e) {   // первая запись с двух устройств разом — вторая получает конфликт (клиент сольёт и повторит), а не 500
          $now = Db::one('SELECT data, version FROM user_state WHERE user_id = ?', [$user['id']]); if (!$now) throw $e;
          throw new HttpError(409, 'conflict', ['state' => json_decode((string)$now['data'], true), 'version' => (int)$now['version']]);
        }
        return ['version' => $cur + 1];
      }

      case 'POST /api/recognize/upload': {   // копия фото для /admin; без входа — по id браузера из аналитики (101-а)
        [$uid, $vid] = Recognize::who($user, $r);
        return Recognize::upload($uid, $r->body, $r->header('Content-Type') ?: (string)($r->server['CONTENT_TYPE'] ?? ''), $vid);
      }
      case 'POST /api/recognize/run': {
        if (!$user) throw new HttpError(401, 'unauthorized');
        RateLimit::hit('recog_run', (string)$user['id']);
        return Recognize::run((int)$user['id'], $in);   // без ключа — 503 recognition_off, но фото и причина остаются в аналитике
      }
      case 'POST /api/recognize/local': {
        [$uid, $vid] = Recognize::who($user, $r);
        return Recognize::local($uid, $in, $vid);
      }
      case 'POST /api/recognize/report': {
        [$uid, $vid] = Recognize::who($user, $r);
        return Recognize::report($uid, $in, $vid);
      }
      case 'GET /api/photo': {   // фото к записи истории (тепло/вода) — только хозяину
        if (!$user) throw new HttpError(401, 'unauthorized');
        $id = (string)($r->query()['id'] ?? '');
        $ph = preg_match('/^[a-f0-9]{24}$/', $id) ? Db::one('SELECT * FROM photos WHERE id = ? AND user_id = ?', [$id, (int)$user['id']]) : null;
        if (!$ph || !is_file(Recognize::path($ph))) throw new HttpError(404, 'not_found');
        $res->file = ['path' => Recognize::path($ph), 'mime' => $ph['mime']]; return [];
      }
      case 'POST /api/photo/keep': {
        if (!$user) throw new HttpError(401, 'unauthorized');
        $on = ($in['keep'] ?? true) ? 1 : 0; $n = 0;
        foreach (array_slice((array)($in['ids'] ?? []), 0, 100) as $id)
          if (is_string($id) && preg_match('/^[a-f0-9]{24}$/', $id)) $n += Db::q('UPDATE photos SET kept = ? WHERE id = ? AND user_id = ?', [$on, $id, (int)$user['id']])->rowCount();
        return ['ok' => true, 'n' => $n];
      }
      case 'GET /api/vk/replies': {   // ответы бота Водоканала, пересланные нашему боту (последние 30 дней)
        if (!$user) throw new HttpError(401, 'unauthorized');
        $rows = Db::q("SELECT id, kind, text, msg_at FROM vk_replies WHERE user_id = ? AND src = 'vk' AND msg_at > ? ORDER BY id DESC LIMIT 10", [(int)$user['id'], time() - 30 * 86400])->fetchAll();
        return ['replies' => array_map(fn($x) => ['id' => (int)$x['id'], 'kind' => $x['kind'], 'text' => $x['text'], 'at' => (int)$x['msg_at']], $rows)];
      }
      case 'GET /api/bot/replies': {   // то же для света (src=obl, @Kooz2bot) и газа (src=grm, @mygrmu_bot)
        if (!$user) throw new HttpError(401, 'unauthorized');
        $src = (string)($r->query()['src'] ?? ''); if (!isset(Telegram::FWD_BOTS[$src]) || $src === 'vk') throw new HttpError(422, 'bad_src');
        $rows = Db::q('SELECT id, kind, text, msg_at FROM vk_replies WHERE user_id = ? AND src = ? AND msg_at > ? ORDER BY id DESC LIMIT 10', [(int)$user['id'], $src, time() - 30 * 86400])->fetchAll();
        return ['src' => $src, 'replies' => array_map(fn($x) => ['id' => (int)$x['id'], 'kind' => $x['kind'], 'text' => $x['text'], 'at' => (int)$x['msg_at']], $rows)];
      }
      case 'GET /api/gpv': return Gpv::api();
      case 'GET /api/providers': { RateLimit::hit('prov', $ip); $q = $r->query();   // постачальники й тарифи за адресою (адресу не зберігаємо); n+h — уточнений пункт
        return Providers::lookup((string)($q['q'] ?? ''), isset($q['n']) ? (string)$q['n'] : null, isset($q['h']) ? (string)$q['h'] : null); }
      case 'GET /api/places/suggest': { RateLimit::hit('plsug', $ip); $q = $r->query();   // підказка населеного пункту у формі адреси (нічого не зберігаємо)
        return Providers::suggest((string)($q['q'] ?? ''), preg_replace('/[^a-z]/', '', (string)($q['r'] ?? ''))); }
      case 'GET /api/gpv/addr': RateLimit::hit('gpv_addr', $ip); return Gpv::lookup((string)($r->query()['q'] ?? ''));   // черга відключень за адресою квартири (адресу не зберігаємо)
      case 'GET /api/gpv/site': return Gpv::site() + ['list' => Gpv::listMeta(), 'docs' => Gpv::docsMeta()];
      case 'GET /api/gpv/doc': { $f = Gpv::docFile((string)($r->query()['k'] ?? '')); if (!$f) throw new HttpError(404, 'not_found'); $res->file = $f; return []; }   // офіційний PDF-перелік з сайту обленерго (сервер забирає раз на добу)
      case 'GET /api/gpv/list.pdf': { $f = Gpv::listFile((string)($r->query()['f'] ?? '')); if (!$f) throw new HttpError(404, 'not_found'); $res->file = $f; return []; }   // официальный перечень «Адреси та черги» (переслан боту из канала обленерго)   // как устроена официальная форма «черга за адресою» (разведка сервером, без личных данных)   // графики отключений света Харьковоблэнерго (без входа; очередь квартиры — в её данных)
      case 'POST /api/relay/probe': {   // вывод curl -i -L страницы обленерго с NAS владельца (команда — RelayProbe::command)
        RateLimit::hit('relay_ip', $ip);
        return RelayProbe::accept((string)($r->query()['t'] ?? ''), $r->body, $r->header('CF-IPCountry'), (string)($r->query()['via'] ?? ''));
      }
      case 'GET /api/relay/probe': return RelayProbe::one((string)($r->query()['t'] ?? ''));
      // ретранслятор: NAS спрашивает шаг (текст «idle N» или «job id step» + строки) и возвращает сырой вывод curl -i; ключ — заголовок X-Relay-Key
      case 'GET /api/relay/next': { Relay::auth($r->header('X-Relay-Key'), $ip); $res->text = Relay::next((int)($r->query()['v'] ?? 0), $r->header('CF-IPCountry')); return []; }
      case 'POST /api/relay/done': { Relay::auth($r->header('X-Relay-Key'), $ip); $q = $r->query();
        $res->text = Relay::done((int)($q['id'] ?? 0), (int)($q['s'] ?? -1), $r->body, $r->header('CF-IPCountry'), (string)preg_replace('/[^a-z]/', '', (string)($q['e'] ?? ''))); return []; }
      case 'GET /api/vk/status': return VkStatus::status();   // бот и кабинет Водоканала — работают ли (без входа)
      case 'POST /api/vk/event': {   // «Відправити» / «Прийняв» / «Не відповідає» / «Помилка» — для статуса бота
        if (!$user) throw new HttpError(401, 'unauthorized');
        RateLimit::hit('recog_upload', (string)$user['id']);
        return VkStatus::event((int)$user['id'], (string)($in['kind'] ?? ''));
      }
      case 'POST /api/vk/cab/check': if (!$user) throw new HttpError(401, 'unauthorized'); return VkCab::check((int)$user['id'], $in);
      case 'POST /api/vk/bill': if (!$user) throw new HttpError(401, 'unauthorized'); return VkCab::bill((int)$user['id'], $in);   // квитанція з сайту Водоканалу — у фоні при заході
      case 'POST /api/vk/cab/send': if (!$user) throw new HttpError(401, 'unauthorized'); return VkCab::send((int)$user['id'], $in);
      case 'GET /api/cab/htm': if (!$user) throw new HttpError(401, 'unauthorized'); return HtmSvc::status((int)$user['id']);
      case 'POST /api/cab/htm/connect': if (!$user) throw new HttpError(401, 'unauthorized'); return HtmSvc::connect((int)$user['id'], $in);
      case 'POST /api/cab/htm/check': if (!$user) throw new HttpError(401, 'unauthorized'); return HtmSvc::check((int)$user['id'], $in);
      case 'POST /api/cab/htm/send': if (!$user) throw new HttpError(401, 'unauthorized'); return HtmSvc::send((int)$user['id'], $in);
      case 'POST /api/cab/htm/auto': if (!$user) throw new HttpError(401, 'unauthorized'); return HtmSvc::auto((int)$user['id'], $in);
      case 'POST /api/cab/htm/cancel': if (!$user) throw new HttpError(401, 'unauthorized'); return HtmSvc::cancel((int)$user['id'], $in);
      case 'POST /api/cab/htm/now': if (!$user) throw new HttpError(401, 'unauthorized'); return HtmSvc::now((int)$user['id'], $in);
      case 'POST /api/cab/forget': if (!$user) throw new HttpError(401, 'unauthorized'); return ($in['prov'] ?? '') === 'vk' ? VkSvc::forget((int)$user['id']) : HtmSvc::forget((int)$user['id'], $in);
      case 'GET /api/lb': if (!$user) throw new HttpError(401, 'unauthorized'); return LocalBot::status((int)$user['id'], $r->query());
      case 'POST /api/lb/connect': if (!$user) throw new HttpError(401, 'unauthorized'); return LocalBot::connect((int)$user['id'], $in);
      case 'POST /api/lb/forget': if (!$user) throw new HttpError(401, 'unauthorized'); return LocalBot::forget((int)$user['id'], $in);
      case 'POST /api/lb/queue': if (!$user) throw new HttpError(401, 'unauthorized'); return LocalBot::queue((int)$user['id'], $in);
      case 'POST /api/lb/cancel': if (!$user) throw new HttpError(401, 'unauthorized'); return LocalBot::cancel((int)$user['id'], $in);
      case 'POST /api/lb/now': if (!$user) throw new HttpError(401, 'unauthorized'); return LocalBot::now((int)$user['id'], $in);
      case 'GET /api/vk/jobs': if (!$user) throw new HttpError(401, 'unauthorized'); return VkSvc::status((int)$user['id']);
      case 'POST /api/vk/queue': if (!$user) throw new HttpError(401, 'unauthorized'); return VkSvc::queue((int)$user['id'], $in);
      case 'POST /api/vk/auto': if (!$user) throw new HttpError(401, 'unauthorized'); return VkSvc::auto((int)$user['id'], $in);
      case 'POST /api/vk/job/cancel': if (!$user) throw new HttpError(401, 'unauthorized'); return VkSvc::cancel((int)$user['id'], $in);
      case 'POST /api/vk/job/now': if (!$user) throw new HttpError(401, 'unauthorized'); return VkSvc::now((int)$user['id'], $in);
      case 'GET /api/weather': return Weather::range((string)($r->query()['from'] ?? ''), (string)($r->query()['to'] ?? ''));   // погода к истории — всем, кэш
      case 'POST /api/docs/upload': {   // документ к счётчику сырым телом: ?place=&kind=passport|verification|other&name=
        if (!$user) throw new HttpError(401, 'unauthorized');
        RateLimit::hit('recog_upload', (string)$user['id']);
        return Docs::upload((int)$user['id'], $r->body, $r->header('Content-Type'), $r->query());
      }
      // фото, присланные боту: список, файл, «разобрано»
      case 'GET /api/inbox': {
        if (!$user) throw new HttpError(401, 'unauthorized');
        $rows = Db::q('SELECT photo_id, taken_at FROM bot_inbox WHERE user_id = ? AND done = 0 AND taken_at > ? ORDER BY taken_at, created_at', [(int)$user['id'], time() - 7 * 86400])->fetchAll();
        return ['items' => array_map(fn($x) => ['id' => $x['photo_id'], 'takenAt' => (int)$x['taken_at']], $rows)];
      }
      case 'GET /api/inbox/file': {
        if (!$user) throw new HttpError(401, 'unauthorized');
        $ph = Db::one('SELECT p.* FROM photos p JOIN bot_inbox b ON b.photo_id = p.id WHERE p.id = ? AND b.user_id = ?', [(string)($r->query()['id'] ?? ''), (int)$user['id']]);
        if (!$ph || !is_file(Recognize::path($ph))) throw new HttpError(404, 'not_found');
        $res->file = ['path' => Recognize::path($ph), 'mime' => $ph['mime']]; return [];
      }
      case 'POST /api/inbox/done': {
        if (!$user) throw new HttpError(401, 'unauthorized');
        foreach (array_slice((array)($in['ids'] ?? []), 0, 50) as $id) Db::q('UPDATE bot_inbox SET done = 1 WHERE photo_id = ? AND user_id = ?', [(string)$id, (int)$user['id']]);
        return ['ok' => true];
      }
      case 'GET /api/docs': if (!$user) throw new HttpError(401, 'unauthorized'); return Docs::list((int)$user['id']);
      case 'GET /api/docs/file': if (!$user) throw new HttpError(401, 'unauthorized'); $res->file = Docs::file((int)$user['id'], (string)($r->query()['id'] ?? '')); return [];
      case 'GET /api/docs/link': if (!$user) throw new HttpError(401, 'unauthorized'); return Docs::link((int)$user['id'], (string)($r->query()['id'] ?? ''));
      case 'GET /api/docs/open': $res->file = Docs::open($r->query()); return [];   // по подписанной ссылке, без входа (PDF платёжки из Telegram)
      case 'POST /api/docs/delete': if (!$user) throw new HttpError(401, 'unauthorized'); return Docs::delete((int)$user['id'], (string)($in['id'] ?? ''));
      case 'POST /api/feedback': return Feedback::create($user, $in, $r, $ip);
      case 'POST /api/visit': return Visits::hit($user, $in, $r, $ip);
      case 'POST /api/events': return Journal::push($user, $in, $r, $ip);   // журнал действий (app/journal.php)
      case 'POST /api/consent': return Consent::record($user, $in, $ip);   // выбор в баннере cookie (app/visits.php)
      case 'GET /api/admin/me': if (!$user) throw new HttpError(401, 'unauthorized'); return ['admin' => Admin::is($user)];
      case 'POST /api/bot/setup': {
        $secret = (string)Cfg::get('webhook_secret');
        if ($secret === '' || !Cfg::get('bot_token') || !hash_equals($secret, $r->header('X-Setup-Secret'))) throw new HttpError(403, 'forbidden');
        $res0 = Telegram::setup(); unset($res0['errors']); return $res0;
      }
      case 'POST /api/bot/webhook': {
        $secret = (string)Cfg::get('webhook_secret');
        if ($secret === '' || !hash_equals($secret, $r->header('X-Telegram-Bot-Api-Secret-Token'))) throw new HttpError(403, 'forbidden');
        Telegram::handleUpdate($r->json());
        return ['ok' => true];
      }
    }
    if (str_starts_with($p, '/api/admin/')) {
      if (!$user) throw new HttpError(401, 'unauthorized');
      if (!Admin::is($user)) throw new HttpError(403, 'not_admin');
      if ("$m $p" === 'GET /api/admin/photo') { $res->file = Admin::photoFile((string)($r->query()['id'] ?? '')); return []; }
      return Admin::route("$m $p", $r->query(), $in, $user);
    }
    throw new HttpError(404, 'not_found');
  }

  private static function dummyHash(): string { static $h = null; return $h ??= password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT); }
  private static function creds(array $in): array {
    $email = mb_strtolower(trim((string)($in['email'] ?? ''))); $pass = (string)($in['password'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) throw new HttpError(422, 'bad_email');
    if (mb_strlen($pass) < 8 || strlen($pass) > 200) throw new HttpError(422, 'weak_password');
    return [$email, $pass];
  }
  private static function userById(int $id): array { $u = Db::one('SELECT * FROM users WHERE id = ?', [$id]); if (!$u) throw new HttpError(401, 'unauthorized'); return $u; }
  private static function publicUser(array $u): array {
    $tg = Db::one("SELECT external_id, username FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$u['id']]);
    return ['id' => (int)$u['id'], 'email' => $u['email'], 'name' => $u['name'], 'hasPassword' => !empty($u['password_hash']),
      'telegram' => $tg ? ['id' => $tg['external_id'], 'username' => $tg['username']] : null,
      'botStart' => $tg ? Telegram::needStart((int)$u['id']) : null];
  }
  private static function sessionUser(Req $r): ?array {
    $t = (string)($r->cookies['ts_sid'] ?? ''); if ($t === '') $t = substr($r->header('X-Session'), 0, 128); if ($t === '') return null;
    $s = Db::one('SELECT * FROM sessions WHERE token_hash = ?', [hash('sha256', $t)]);
    if (!$s || (int)$s['expires_at'] < Http::now()) return null;
    return Db::one('SELECT * FROM users WHERE id = ?', [$s['user_id']]);
  }
  private static function startSession(Res $res, array $u, Req $r, string $ip): string {
    $t = bin2hex(random_bytes(32)); $exp = Http::now() + 86400 * (int)Cfg::get('session_days', 30);
    Db::q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?)', [hash('sha256', $t), $u['id'], Http::now(), $exp, $ip, substr($r->header('User-Agent'), 0, 200)]);
    Db::q('UPDATE users SET last_login_at = ? WHERE id = ?', [Http::iso(), $u['id']]);
    // старая сессия этого браузера больше не нужна
    if (!empty($r->cookies['ts_sid'])) Db::q('DELETE FROM sessions WHERE token_hash = ?', [hash('sha256', (string)$r->cookies['ts_sid'])]);
    self::cookie($res, 'ts_sid', $t, $exp, true);
    return $t;
  }
  private static function cookie(Res $res, string $name, string $val, int $exp, bool $httpOnly): void {
    // путь cookie = адрес сайта: на общем домене pokabot.xyz не пересекаемся с другими сайтами
    $res->cookies[] = [$name, $val, ['expires' => $exp, 'path' => (Cfg::base() ?: '') . '/', 'secure' => (bool)Cfg::get('cookie_secure', true), 'httponly' => $httpOnly, 'samesite' => 'Lax']];
  }
  private static function audit(?int $uid, string $action, string $ip): void { Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, $action, $ip, Http::iso()]); }
}
