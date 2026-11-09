<?php
// Напоминания через Telegram-бота (зовёт cron.php раз в час, шлёт с 10 до 20 по Киеву):
//  вода — 15-го и 19-го, если в этом месяце ещё нет записи воды (Водоканал принимает до 20-го);
//  тепло — 5-го (открылось окно ХТМ) и 22-го, если нет показаний, снятых в окне 5–25;
//  свет — в предпоследний день месяца (окно Харківобленерго открылось) и 2-го (завтра последний день), если нет показаний в окне;
//  газ — 1-го (приём 1–5) и 4-го (завтра последний день), если нет показаний с 28-го по 5-е.
// Регион (80-я): тексты про ХТМ / Харківводоканал / Харківобленерго — только квартирам, где это так по адресу (довідник, как «Куди передати»);
// остальным — без харьковских названий и сроков, с поставщиком из довідника; тепло вне ХТМ не напоминаем (окно неизвестно). Без адреса — как раньше (Харків).
// Кому: аккаунты с Telegram и состоянием на сервере; выключатель — state.remind.off (Настройки, все квартиры) и place.remindOff
// (страница квартиры), язык — state.remind.lang. Несколько квартир — одно сообщение со списком и кнопкой в каждую (?go=…&place=id).
// Каждое напоминание — не больше раза за месяц (reminders_sent, с итогом Telegram в status — видно в /admin → «Нагадування»);
// при сбое связи (нет ответа, 429, 5xx) — повтор в следующий час. Человек не нажимал «Старт» у бота → status 'blocked', не повторяем.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Reminders {
  const TZ = 'Europe/Kyiv';
  // одно напоминание — за 4 дня до конца приёма (как срок в приложении; владелец 05.11): тепло 21-го (ХТМ до 25-го), вода 16-го (Водоканал до 20-го)
  const DAYS = [16 => 'water16', 21 => 'heat21'];
  /** SMS 4647 (Нафтогаз) закрыли с 28.11.2026 — последний день SMS (как Gs.SMS_UNTIL в web/src/elec.js). */
  const GAS_SMS_UNTIL = '2026-11-27';

  /** Какое напоминание в этот день: [kind, ym] или null. Свет: предпоследний день месяца (за 4 дня до 3-го, окно открылось), газ: 1-е (за 4 дня до 5-го). */
  public static function kindOn(DateTimeImmutable $d): ?array {
    $j = (int)$d->format('j'); $L = (int)$d->format('t');
    if ($j === $L - 1) return ['elec1', $d->format('Y-m')];
    // газ: 1-го (приймання 1–5); ym — місяць, за який показання
    if ($j === 1) return ['gas1', $d->modify('first day of previous month')->format('Y-m')];
    $k = self::DAYS[$j] ?? null;
    return $k ? [$k, $d->format('Y-m')] : null;
  }

  /** Что напоминать в этот момент: ['ym' => '2026-11', 'kind' => 'water16'] или null (не тот день или не то время). */
  public static function due(int $now): ?array {
    $d = (new DateTimeImmutable('@' . $now))->setTimezone(new DateTimeZone(self::TZ));
    $h = (int)$d->format('G'); $k = self::kindOn($d);
    if (!$k || $h < 10 || $h >= 20) return null;
    return ['ym' => $k[1], 'kind' => $k[0]];
  }

  /** Окно показаний газа за месяц ym: с 28-го ym (SMS 4647) по 5-е следующего. → [from, to] */
  public static function gasWindow(string $ym): array {
    return [$ym . '-28', (new DateTimeImmutable($ym . '-01'))->modify('first day of next month')->format('Y-m') . '-05'];
  }

  /** Окно приёма показаний света за месяц ym: с предпоследнего дня ym по 3-е число следующего. → [from, to] */
  public static function elecWindow(string $ym): array {
    $d = new DateTimeImmutable($ym . '-01'); $L = (int)$d->format('t');
    return [$ym . '-' . sprintf('%02d', $L - 1), $d->modify('first day of next month')->format('Y-m') . '-03'];
  }

  /** Поставщики квартиры по её адресу (как «Куди передати» в приложении): ['r' => kh|lv|…, 'htm' => тепло — ХТМ, 'hvk' => вода — Харківводоканал,
   *  'water' => орг. воды, 'elec' => орг. света]. Без адреса — Харків (как было); не нашли пункт — регион из p.city, иначе Харків. */
  public static function placeProv(array $p): array {
    $kh = ['r' => 'kh', 'htm' => true, 'hvk' => true, 'water' => null, 'elec' => null];
    $a = trim((string)($p['address'] ?? '')); $c = is_array($p['city'] ?? null) ? $p['city'] : []; $st = is_array($p['settle'] ?? null) ? $p['settle'] : [];
    if ($a === '' || !class_exists('Providers')) return $kh;
    $n = null; $h = null;
    if (($st['a'] ?? null) === $a && !empty($st['n']) && !empty($st['h'])) { $n = (string)$st['n']; $h = (string)$st['h']; }
    elseif (!empty($c['n']) && !empty($c['h'])) { $n = (string)$c['n']; $h = (string)$c['h']; }
    $tr = ProvEdit::$track; ProvEdit::$track = false;   // рассылка — не «что ищут люди» в /admin
    try { $L = Providers::lookup($a, $n, $h); } catch (Throwable $e) { $L = []; } finally { ProvEdit::$track = $tr; }
    if (empty($L['found'])) { $r = (string)($c['r'] ?? 'kh'); return $r === 'kh' ? $kh : ['r' => $r, 'htm' => false, 'hvk' => false, 'water' => null, 'elec' => null]; }
    $k = (array)($L['kinds'] ?? []);
    return ['r' => (string)($L['place']['r'] ?? 'kh'), 'htm' => ($k['heat']['via'] ?? '') === 'htm', 'hvk' => ($k['water']['via'] ?? '') === 'hvk',
      'water' => ($k['water']['org'] ?? null) ?: null, 'elec' => ($k['elec']['org'] ?? null) ?: null];
  }

  /** Какие квартиры ждут это напоминание: [['id' => 'p2', 'label' => 'Мамина', 'all' => 2], …] (all — сколько квартир всего).
   *  Пропускаем: всё выключено (remind.off), квартира выключена (place.remindOff), счётчик снят (gaps) или прибран (removed). */
  public static function placesDue(array $st, string $kind, string $ym, ?string $today = null): array {
    if (!empty($st['remind']['off'])) return [];
    $today = $today ?? date('Y-m-d');
    // лічильник знято (ремонт, повірка, заміна) і ще не поставили — про нього не нагадуємо
    $off = function (array $p, string $what) use ($today): bool {
      foreach ((array)($p['gaps'] ?? []) as $g)
        if (is_array($g) && empty($g['deleted']) && ($g['what'] ?? '') === $what && (string)($g['from'] ?? '9') <= $today && (($g['to'] ?? '') === '' || (string)$g['to'] > $today)) return true;
      return false;
    };
    $places = array_values(array_filter((array)($st['places'] ?? []), fn($p) => is_array($p) && empty($p['deleted'])));
    if (!$places && !empty($st['meter'])) $places = [['id' => 'main', 'meter' => $st['meter']]];
    $first = $places[0]['id'] ?? 'main'; $all = count($places); $out = [];
    foreach ($places as $i => $p) {
      if (!empty($p['remindOff'])) continue;
      // как в приложении: без названия первая — «Моя квартира», остальные — «Квартира N»
      $label = trim((string)($p['name'] ?? '')) ?: ($i === 0 ? 'Моя квартира' : 'Квартира ' . ($i + 1));
      $need = false;
      if (str_starts_with($kind, 'elec') || str_starts_with($kind, 'gas')) {
        // світло / газ: у кожного діючого лічильника цього виду є показання (не стартові) у вікні приймання
        $mk = str_starts_with($kind, 'gas') ? 'gas' : 'elec';
        [$wf, $wt] = $mk === 'gas' ? self::gasWindow($ym) : self::elecWindow($ym);
        foreach ((array)($p['meters'] ?? []) as $m) {
          if (!is_array($m) || ($m['kind'] ?? '') !== $mk || !empty($m['deleted']) || !empty($m['removed'])) continue;
          $has = false;
          foreach ((array)($st['mrecs'] ?? []) as $r)
            if (is_array($r) && empty($r['deleted']) && empty($r['base']) && empty($r['own']) && ($r['meter'] ?? '') === ($m['id'] ?? '') && ($r['place'] ?? '') === $p['id'] && (string)($r['date'] ?? '') >= $wf && (string)($r['date'] ?? '') <= $wt) { $has = true; break; }
          if (!$has) { $need = true; break; }
        }
      } elseif (str_starts_with($kind, 'water')) {
        // прибранный из квартиры водомер (removed — дата) не напоминает
        $ms = array_filter((array)($p['water']['meters'] ?? []), fn($m) => is_array($m) && empty($m['deleted']) && empty($m['removed']) && !$off($p, (string)($m['id'] ?? '')));
        if ($ms) {
          $need = true;
          foreach ((array)($st['water'] ?? []) as $r)
            if (is_array($r) && empty($r['deleted']) && empty($r['base']) && empty($r['own']) && ($r['place'] ?? '') === $p['id'] && str_starts_with((string)($r['date'] ?? ''), $ym)) { $need = false; break; }
        }
      } elseif (!empty($p['meter']) && empty($p['meter']['removed']) && !$off($p, 'heat')) {
        $need = true;
        foreach ((array)($st['readings'] ?? []) as $r) {
          $d = (string)($r['htm']['date'] ?? '');
          if (is_array($r) && empty($r['deleted']) && empty($r['own']) && empty($r['billOnly']) && ($r['place'] ?? $first) === $p['id'] && $d >= "$ym-05" && $d <= "$ym-25") { $need = false; break; }
        }
      }
      if (!$need) continue;
      // по адресу: харьковский текст или общий; тепло — только ХТМ (у других поставщиков окно приёма не знаем)
      $pv = self::placeProv($p); $what = str_starts_with($kind, 'water') ? 'water' : (str_starts_with($kind, 'elec') ? 'elec' : (str_starts_with($kind, 'gas') ? 'gas' : 'heat'));
      if ($what === 'heat' && !$pv['htm']) continue;
      $kh = $what === 'water' ? $pv['hvk'] : ($what === 'elec' ? $pv['r'] === 'kh' : true);
      $out[] = ['id' => (string)$p['id'], 'label' => mb_substr($label, 0, 40), 'all' => $all, 'kh' => $kh, 'org' => $what === 'water' || $what === 'elec' ? $pv[$what] : null];
    }
    return $out;
  }

  /** Нужно ли это напоминание человеку с таким состоянием (данные — как их хранит сайт: places, water, readings). */
  public static function needs(array $st, string $kind, string $ym, ?string $today = null): bool {
    return (bool)self::placesDue($st, $kind, $ym, $today);
  }

  /** Текст и кнопки. $places — из placesDue: при нескольких квартирах — список («Квартири: Моя, Мамина») и кнопка в каждую. */
  public static function text(string $kind, string $lang, array $places = [], ?string $today = null): array {
    $ru = $lang === 'ru';
    $today = $today ?? (new DateTimeImmutable('now', new DateTimeZone(self::TZ)))->format('Y-m-d');
    $gasSms = $today <= self::GAS_SMS_UNTIL;
    $t = [
      'water16' => $ru ? "💧 До 20-го — 4 дня, чтобы передать показания воды в Водоканал. В этом месяце ещё не вносили.\n\nСфотографируйте водомеры — цифры впишутся сами, готовое сообщение для бота Водоканала будет под рукой."
                       : "💧 До 20-го — 4 дні, щоб передати показання води у Водоканал. Цього місяця ще не вносили.\n\nСфотографуйте водоміри — цифри впишуться самі, готове повідомлення для бота Водоканалу буде під рукою.",
      'heat21' => $ru ? "🔥 До 25-го — 4 дня, чтобы передать показания тепла в ХТМ (принимают с 5 по 25 число). В этом месяце показаний ещё нет.\n\nСнимите показания теплосчётчика — сервис проверит их, как робот ХТМ."
                      : "🔥 До 25-го — 4 дні, щоб передати показання тепла в ХТМ (приймають з 5 по 25 число). Цього місяця показань ще немає.\n\nЗніміть показання теплолічильника — сервіс перевірить їх, як робот ХТМ.",
      'elec1' => $ru ? "⚡ Пора передать показания света: последние 2 дня месяца и 1–3 число — в Харьковоблэнерго. Иначе посчитают «по среднему».\n\nВнесите цифры — сервис проверит их и подскажет, куда передать (приложение «Харэнерго», Viber-бот, колл-центр)."
                     : "⚡ Час передати показання світла: останні 2 дні місяця і 1–3 число — у Харківобленерго. Інакше нарахують «за середнім».\n\nВнесіть цифри — сервіс перевірить їх і підкаже, куди передати (застосунок «Харенерго», Viber-бот, кол-центр).",
      'gas1' => $ru ? ($gasSms ? "🔥 С 1 по 5 число — показания газа (на 1-е), иначе начислят по среднему. Внесите цифры — сервис подготовит SMS на 4647 и подскажет, куда ещё можно передать." : "🔥 С 1 по 5 число — показания газа (на 1-е), иначе начислят по среднему. Внесите цифры — сервис проверит их и подскажет, куда передать: приложение «Куб», бот или кабинет Газсетей, 0 800 303 104.")
                    : ($gasSms ? "🔥 З 1 по 5 число — показання газу (станом на 1-ше), інакше нарахують за середнім. Внесіть цифри — сервіс підготує SMS на 4647 і підкаже, куди ще можна передати." : "🔥 З 1 по 5 число — показання газу (станом на 1-ше), інакше нарахують за середнім. Внесіть цифри — сервіс перевірить їх і підкаже, куди передати: застосунок «Куб», бот чи кабінет Газмереж, 0 800 303 104."),
    ][$kind] ?? '';
    // квартиры не в Харькове (вода — не Харківводоканал, свет — не Харківщина): без харьковских названий и сроков; поставщик — если у всех один
    $water0 = str_starts_with($kind, 'water'); $elec0 = str_starts_with($kind, 'elec');
    if (($water0 || $elec0) && $places && array_filter($places, fn($p) => array_key_exists('kh', $p) && !$p['kh'])) {
      $orgs = array_values(array_unique(array_filter(array_map(fn($p) => (string)($p['org'] ?? ''), $places))));
      $org = count($orgs) === 1 && count(array_filter($places, fn($p) => empty($p['org']))) === 0 ? $orgs[0] : '';
      $t = $water0
        ? ($ru ? '💧 Пора передать показания воды — в этом месяце ещё не вносили' . ($org !== '' ? " (поставщик — $org)" : '') . ".

Сфотографируйте водомеры или впишите цифры — сервис подскажет, куда и до какого числа передать."
               : '💧 Час передати показання води — цього місяця ще не вносили' . ($org !== '' ? " (постачальник — $org)" : '') . ".

Сфотографуйте водоміри або впишіть цифри — сервіс підкаже, куди й до якого числа передати.")
        : ($ru ? '⚡ Конец месяца — пора передать показания света' . ($org !== '' ? " ($org)" : '') . ", иначе начислят «по среднему».

Внесите цифры — сервис проверит их и подскажет, куда и до какого числа передать."
               : '⚡ Кінець місяця — час передати показання світла' . ($org !== '' ? " ($org)" : '') . ", інакше нарахують «за середнім».

Внесіть цифри — сервіс перевірить їх і підкаже, куди й до якого числа передати.");
    }
    $off = $ru ? 'Выключить напоминания — в «Настройках» сервиса.' : 'Вимкнути нагадування — у «Налаштуваннях» сервісу.';
    $water = str_starts_with($kind, 'water'); $elec = str_starts_with($kind, 'elec'); $gas = str_starts_with($kind, 'gas');
    $btn = $gas ? ($ru ? 'Внести газ' : 'Внести газ') : ($elec ? ($ru ? 'Внести свет' : 'Внести світло') : ($water ? ($ru ? 'Внести воду' : 'Внести воду') : ($ru ? 'Снять показания тепла' : 'Зняти показання тепла')));
    $go = Cfg::appUrl() . '?go=' . ($gas ? 'gnew' : ($elec ? 'enew' : ($water ? 'wnew' : 'heat')));
    $many = $places && ($places[0]['all'] ?? 1) > 1;
    if (!$many) return ['text' => $t . "\n\n" . $off, 'button' => $btn, 'url' => $go, 'buttons' => [[$btn, $go]]];
    // несколько квартир: одно сообщение — в каких квартирах ещё не внесли, кнопка в каждую (не больше 6)
    $names = array_map(fn($p) => '«' . $p['label'] . '»', $places);
    $t .= "\n\n" . (count($places) > 1 ? ($ru ? 'Квартиры: ' : 'Квартири: ') : ($ru ? 'Квартира: ' : 'Квартира: ')) . implode(', ', $names) . '.';
    $btns = array_map(fn($p) => [$btn . ' — ' . $p['label'], $go . '&place=' . rawurlencode($p['id'])], array_slice($places, 0, 6));
    $off = $ru ? 'Выключить — в «Настройках» сервиса (для всех квартир) или на странице квартиры.' : 'Вимкнути — у «Налаштуваннях» сервісу (для всіх квартир) або на сторінці квартири.';
    return ['text' => $t . "\n\n" . $off, 'button' => $btns[0][0], 'url' => $btns[0][1], 'buttons' => $btns];
  }

  /** Ближайший день напоминания, начиная с сегодня (если окно 10–20 ещё не закрылось): ['date', 'kind', 'ym']. */
  public static function next(int $now): array {
    $d = (new DateTimeImmutable('@' . $now))->setTimezone(new DateTimeZone(self::TZ));
    for ($i = 0; $i < 40; $i++) {
      $x = $d->modify("+$i day"); $k = self::kindOn($x);
      if ($k && ($i > 0 || (int)$d->format('G') < 20)) return ['date' => $x->format('Y-m-d'), 'kind' => $k[0], 'ym' => $k[1]];
    }
    return [];
  }

  private static function people(): array {
    return Db::q("SELECT i.user_id, i.external_id, i.username, s.data FROM user_identities i JOIN user_state s ON s.user_id = i.user_id WHERE i.type = 'telegram'")->fetchAll();
  }

  /** Кому уйдёт это напоминание (ничего не отправляя) — для /admin: [{user_id, username, lang, sent}]. */
  public static function preview(string $kind, string $ym): array {
    $out = [];
    foreach (self::people() as $row) {
      $st = json_decode((string)$row['data'], true);
      $ps = is_array($st) ? self::placesDue($st, $kind, $ym) : [];
      if (!$ps) continue;
      $s = Db::one('SELECT status, sent_at FROM reminders_sent WHERE user_id = ? AND kind = ? AND ym = ?', [(int)$row['user_id'], $kind, $ym]);
      $out[] = ['user_id' => (int)$row['user_id'], 'username' => $row['username'], 'lang' => (string)($st['remind']['lang'] ?? 'uk'), 'sent' => $s,
        'places' => $ps[0]['all'] > 1 ? array_column($ps, 'label') : []];
    }
    return $out;
  }

  /** Ближайшее напоминание и скольким оно уйдёт (ничего не отправляя) — только числа, для /api/health:
   *  ['date' => '2026-11-16', 'kind' => 'water16', 'ym' => '2026-11', 'n' => кому положено, 'sent' => уже отправлено] или null. */
  public static function nextPreview(int $now): ?array {
    $n = self::next($now); if (!$n) return null;
    $p = self::preview($n['kind'], $n['ym']);
    return $n + ['n' => count($p), 'sent' => count(array_filter($p, fn($x) => !empty($x['sent'])))];
  }

  /** Что уже разослано (последние), с итогом Telegram: ok / blocked / no_chat / error: … */
  public static function log(int $limit = 300): array {
    return Db::q("SELECT r.user_id, r.kind, r.ym, r.sent_at, r.status, i.username, u.email FROM reminders_sent r LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN user_identities i ON i.user_id = r.user_id AND i.type = 'telegram' ORDER BY r.sent_at DESC LIMIT " . max(1, $limit))->fetchAll();
  }

  /** Итог ответа Telegram: 'ok', 'blocked' (остановил бота / не нажимал «Старт»), 'no_chat', 'error: …'; null — сбой связи, повторить через час. */
  public static function status(array $r): ?string {
    if (!empty($r['ok'])) return 'ok';
    $code = (int)($r['error_code'] ?? 0);
    if (!$r || $code === 429 || $code >= 500) return null;
    if ($code === 403) return 'blocked';
    $desc = (string)($r['description'] ?? '');
    if (stripos($desc, 'chat not found') !== false) return 'no_chat';
    return 'error: ' . mb_substr($desc ?: ('код ' . $code), 0, 70);
  }

  /** Разослать то, что положено сейчас. → [[user_id, kind, status], …] — кому пытались отправить. */
  public static function run(int $now): array {
    if (!Cfg::get('bot_token')) return [];
    $due = self::due($now); if (!$due) return [];
    $out = [];
    foreach (self::people() as $row) {
      $uid = (int)$row['user_id'];
      if (Db::one('SELECT 1 AS x FROM reminders_sent WHERE user_id = ? AND kind = ? AND ym = ?', [$uid, $due['kind'], $due['ym']])) continue;
      $st = json_decode((string)$row['data'], true);
      $ps = is_array($st) ? self::placesDue($st, $due['kind'], $due['ym']) : [];
      if (!$ps) continue;
      $m = self::text($due['kind'], (string)($st['remind']['lang'] ?? 'uk'), $ps);
      // сначала отметка (второй запуск cron не пошлёт дубль), потом отправка и её итог
      Db::q('INSERT INTO reminders_sent (user_id, kind, ym, sent_at) VALUES (?, ?, ?, ?)', [$uid, $due['kind'], $due['ym'], Http::iso()]);
      try {
        // адреса сайта не узнали (нет app_url и вебхука) — шлём без кнопки: текст дойдёт, а кнопка на localhost Telegram отвергает
        $msg = ['chat_id' => $row['external_id'], 'text' => $m['text']];
        if (Cfg::appUrlKnown()) $msg['reply_markup'] = ['inline_keyboard' => array_map(fn($b) => [['text' => $b[0], 'web_app' => ['url' => $b[1]]]], $m['buttons'])];
        $r = Telegram::call('sendMessage', $msg);
      } catch (Throwable $e) { error_log('teplo remind: ' . $e->getMessage()); $r = []; }
      $s = self::status($r);
      if ($s === null) Db::q('DELETE FROM reminders_sent WHERE user_id = ? AND kind = ? AND ym = ?', [$uid, $due['kind'], $due['ym']]);   // сбой связи — через час ещё раз
      else Db::q('UPDATE reminders_sent SET status = ? WHERE user_id = ? AND kind = ? AND ym = ?', [$s, $uid, $due['kind'], $due['ym']]);
      $out[] = [$uid, $due['kind'], $s ?? 'retry'];
      if (!Telegram::$send) usleep(50000);   // Telegram: не больше ~30 сообщений в секунду
    }
    return $out;
  }
}
