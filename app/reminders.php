<?php
// Напоминания через Telegram-бота (зовёт cron.php раз в час, шлёт с 10 до 20 по Киеву):
//  вода — 15-го и 19-го, если в этом месяце ещё нет записи воды (Водоканал принимает до 20-го);
//  тепло — 5-го (открылось окно ХТМ) и 22-го, если нет показаний, снятых в окне 5–25.
// Кому: аккаунты с Telegram и состоянием на сервере; выключатель — state.remind.off (Настройки), язык — state.remind.lang.
// Каждое напоминание — не больше раза за месяц (reminders_sent, с итогом Telegram в status — видно в /admin → «Нагадування»);
// при сбое связи (нет ответа, 429, 5xx) — повтор в следующий час. Человек не нажимал «Старт» у бота → status 'blocked', не повторяем.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Reminders {
  const TZ = 'Europe/Kyiv';
  const DAYS = [5 => 'heat5', 15 => 'water15', 19 => 'water19', 22 => 'heat22'];

  /** Что напоминать в этот момент: ['ym' => '2026-11', 'kind' => 'water15'] или null (не тот день или не то время). */
  public static function due(int $now): ?array {
    $d = (new DateTimeImmutable('@' . $now))->setTimezone(new DateTimeZone(self::TZ));
    $h = (int)$d->format('G'); $kind = self::DAYS[(int)$d->format('j')] ?? null;
    if (!$kind || $h < 10 || $h >= 20) return null;
    return ['ym' => $d->format('Y-m'), 'kind' => $kind];
  }

  /** Нужно ли это напоминание человеку с таким состоянием (данные — как их хранит сайт: places, water, readings). */
  public static function needs(array $st, string $kind, string $ym, ?string $today = null): bool {
    if (!empty($st['remind']['off'])) return false;
    $today = $today ?? date('Y-m-d');
    // лічильник знято (ремонт, повірка, заміна) і ще не поставили — про нього не нагадуємо
    $off = function (array $p, string $what) use ($today): bool {
      foreach ((array)($p['gaps'] ?? []) as $g)
        if (is_array($g) && empty($g['deleted']) && ($g['what'] ?? '') === $what && (string)($g['from'] ?? '9') <= $today && (($g['to'] ?? '') === '' || (string)$g['to'] > $today)) return true;
      return false;
    };
    $places = array_values(array_filter((array)($st['places'] ?? []), fn($p) => is_array($p) && empty($p['deleted'])));
    if (!$places && !empty($st['meter'])) $places = [['id' => 'main', 'meter' => $st['meter']]];
    $first = $places[0]['id'] ?? 'main';
    if (str_starts_with($kind, 'water')) {
      foreach ($places as $p) {
        $ms = array_filter((array)($p['water']['meters'] ?? []), fn($m) => is_array($m) && empty($m['deleted']) && !$off($p, (string)($m['id'] ?? '')));
        if (!$ms) continue;
        $has = false;
        foreach ((array)($st['water'] ?? []) as $r)
          if (is_array($r) && empty($r['deleted']) && empty($r['base']) && ($r['place'] ?? '') === $p['id'] && str_starts_with((string)($r['date'] ?? ''), $ym)) { $has = true; break; }
        if (!$has) return true;
      }
      return false;
    }
    foreach ($places as $p) {
      if (empty($p['meter']) || $off($p, 'heat')) continue;
      $has = false;
      foreach ((array)($st['readings'] ?? []) as $r) {
        $d = (string)($r['htm']['date'] ?? '');
        if (is_array($r) && empty($r['deleted']) && ($r['place'] ?? $first) === $p['id'] && $d >= "$ym-05" && $d <= "$ym-25") { $has = true; break; }
      }
      if (!$has) return true;
    }
    return false;
  }

  public static function text(string $kind, string $lang): array {
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
    ][$kind] ?? '';
    $off = $ru ? 'Выключить напоминания — в «Настройках» сервиса.' : 'Вимкнути нагадування — у «Налаштуваннях» сервісу.';
    $water = str_starts_with($kind, 'water');
    $btn = $water ? ($ru ? 'Внести воду' : 'Внести воду') : ($ru ? 'Снять показания тепла' : 'Зняти показання тепла');
    return ['text' => $t . "\n\n" . $off, 'button' => $btn, 'url' => Cfg::appUrl() . '?go=' . ($water ? 'wnew' : 'heat')];
  }

  /** Ближайший день напоминания, начиная с сегодня (если окно 10–20 ещё не закрылось): ['date', 'kind', 'ym']. */
  public static function next(int $now): array {
    $d = (new DateTimeImmutable('@' . $now))->setTimezone(new DateTimeZone(self::TZ));
    for ($i = 0; $i < 40; $i++) {
      $x = $d->modify("+$i day"); $k = self::DAYS[(int)$x->format('j')] ?? null;
      if ($k && ($i > 0 || (int)$d->format('G') < 20)) return ['date' => $x->format('Y-m-d'), 'kind' => $k, 'ym' => $x->format('Y-m')];
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
      if (!is_array($st) || !self::needs($st, $kind, $ym)) continue;
      $s = Db::one('SELECT status, sent_at FROM reminders_sent WHERE user_id = ? AND kind = ? AND ym = ?', [(int)$row['user_id'], $kind, $ym]);
      $out[] = ['user_id' => (int)$row['user_id'], 'username' => $row['username'], 'lang' => (string)($st['remind']['lang'] ?? 'uk'), 'sent' => $s];
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
      if (!is_array($st) || !self::needs($st, $due['kind'], $due['ym'])) continue;
      $m = self::text($due['kind'], (string)($st['remind']['lang'] ?? 'uk'));
      // сначала отметка (второй запуск cron не пошлёт дубль), потом отправка и её итог
      Db::q('INSERT INTO reminders_sent (user_id, kind, ym, sent_at) VALUES (?, ?, ?, ?)', [$uid, $due['kind'], $due['ym'], Http::iso()]);
      try {
        $r = Telegram::call('sendMessage', ['chat_id' => $row['external_id'], 'text' => $m['text'],
          'reply_markup' => ['inline_keyboard' => [[['text' => $m['button'], 'web_app' => ['url' => $m['url']]]]]]]);
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
