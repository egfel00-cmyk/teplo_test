<?php
// Напоминания через Telegram-бота (зовёт cron.php раз в час, шлёт с 10 до 20 по Киеву):
//  вода — 15-го и 19-го, если в этом месяце ещё нет записи воды (Водоканал принимает до 20-го);
//  тепло — 5-го (открылось окно ХТМ) и 22-го, если нет показаний, снятых в окне 5–25;
//  свет — в предпоследний день месяца (окно Харківобленерго открылось) и 2-го (завтра последний день), если нет показаний в окне;
//  газ — 1-го (приём 1–5) и 4-го (завтра последний день), если нет показаний с 28-го по 5-е.
// Кому: аккаунты с Telegram и состоянием на сервере; выключатель — state.remind.off (Настройки, все квартиры) и place.remindOff
// (страница квартиры), язык — state.remind.lang. Несколько квартир — одно сообщение со списком и кнопкой в каждую (?go=…&place=id).
// Каждое напоминание — не больше раза за месяц (reminders_sent, с итогом Telegram в status — видно в /admin → «Нагадування»);
// при сбое связи (нет ответа, 429, 5xx) — повтор в следующий час. Человек не нажимал «Старт» у бота → status 'blocked', не повторяем.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Reminders {
  const TZ = 'Europe/Kyiv';
  const DAYS = [5 => 'heat5', 15 => 'water15', 19 => 'water19', 22 => 'heat22'];

  /** Какое напоминание в этот день: [kind, ym] или null. Свет: предпоследний день месяца (окно открылось) и 2-е (завтра — последний). */
  public static function kindOn(DateTimeImmutable $d): ?array {
    $j = (int)$d->format('j'); $L = (int)$d->format('t');
    if ($j === $L - 1) return ['elec1', $d->format('Y-m')];
    if ($j === 2) return ['elec2', $d->modify('first day of previous month')->format('Y-m')];
    // газ: 1-го (приймання 1–5) і 4-го (завтра останній день); ym — місяць, за який показання
    if ($j === 1) return ['gas1', $d->modify('first day of previous month')->format('Y-m')];
    if ($j === 4) return ['gas4', $d->modify('first day of previous month')->format('Y-m')];
    $k = self::DAYS[$j] ?? null;
    return $k ? [$k, $d->format('Y-m')] : null;
  }

  /** Что напоминать в этот момент: ['ym' => '2026-11', 'kind' => 'water15'] или null (не тот день или не то время). */
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
          if (is_array($r) && empty($r['deleted']) && empty($r['own']) && ($r['place'] ?? $first) === $p['id'] && $d >= "$ym-05" && $d <= "$ym-25") { $need = false; break; }
        }
      }
      if ($need) $out[] = ['id' => (string)$p['id'], 'label' => mb_substr($label, 0, 40), 'all' => $all];
    }
    return $out;
  }

  /** Нужно ли это напоминание человеку с таким состоянием (данные — как их хранит сайт: places, water, readings). */
  public static function needs(array $st, string $kind, string $ym, ?string $today = null): bool {
    return (bool)self::placesDue($st, $kind, $ym, $today);
  }

  /** Текст и кнопки. $places — из placesDue: при нескольких квартирах — список («Квартири: Моя, Мамина») и кнопка в каждую. */
  public static function text(string $kind, string $lang, array $places = []): array {
    $ru = $lang === 'ru';
    $t = [
      'water15' => $ru ? "💧 До 20-го — показания воды в Водоканал. В этом месяце ещё не вносили.\n\nСфотографируйте водомеры — цифры впишутся сами, готовое сообщение для бота Водоканала будет под рукой."
                       : "💧 До 20-го — показання води у Водоканал. Цього місяця ще не вносили.\n\nСфотографуйте водоміри — цифри впишуться самі, готове повідомлення для бота Водоканалу буде під рукою.",
      'water19' => $ru ? "💧 Завтра, 20-го, — последний день передачи показаний воды в Водоканал. В этом месяце ещё не вносили."
                       : "💧 Завтра, 20-го, — останній день передачі показань води у Водоканал. Цього місяця ще не вносили.",
      'heat5' => $ru ? "🔥 Открылось окно ХТМ: показания тепла принимают с 5 по 25 число. Снимите показания теплосчётчика — сервис проверит их, как робот ХТМ."
                     : "🔥 Відкрилося вікно ХТМ: показання тепла приймають з 5 по 25 число. Зніміть показання теплолічильника — сервіс перевірить їх, як робот ХТМ.",
      'heat22' => $ru ? "🔥 До 25-го — последние дни передачи показаний тепла в ХТМ. В этом месяце показаний ещё нет."
                      : "🔥 До 25-го — останні дні передачі показань тепла в ХТМ. Цього місяця показань ще немає.",
      'elec1' => $ru ? "⚡ Пора передать показания света: последние 2 дня месяца и 1–3 число — в Харьковоблэнерго.\n\nВнесите цифры — сервис проверит их и подскажет, куда передать (приложение «Харэнерго», Viber-бот, колл-центр)."
                     : "⚡ Час передати показання світла: останні 2 дні місяця і 1–3 число — у Харківобленерго.\n\nВнесіть цифри — сервіс перевірить їх і підкаже, куди передати (застосунок «Харенерго», Viber-бот, кол-центр).",
      'elec2' => $ru ? "⚡ Завтра, 3-го, — последний день передачи показаний света. Иначе посчитают «по среднему»."
                     : "⚡ Завтра, 3-го, — останній день передачі показань світла. Інакше нарахують «за середнім».",
      'gas1' => $ru ? "🔥 С 1 по 5 число — показания газа (на 1-е). Внесите цифры — сервис подготовит SMS на 4647 и подскажет, куда ещё можно передать."
                    : "🔥 З 1 по 5 число — показання газу (станом на 1-ше). Внесіть цифри — сервіс підготує SMS на 4647 і підкаже, куди ще можна передати.",
      'gas4' => $ru ? "🔥 Завтра, 5-го, — последний день передачи показаний газа. Иначе начислят по среднему."
                    : "🔥 Завтра, 5-го, — останній день передачі показань газу. Інакше нарахують за середнім.",
    ][$kind] ?? '';
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
