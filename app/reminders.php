<?php
// Напоминания через Telegram-бота (зовёт cron.php раз в час, шлёт с 10 до 20 по Киеву):
//  вода — 15-го и 19-го, если в этом месяце ещё нет записи воды (Водоканал принимает до 20-го);
//  тепло — 5-го (открылось окно ХТМ) и 22-го, если нет показаний, снятых в окне 5–25.
// Кому: аккаунты с Telegram и состоянием на сервере; выключатель — state.remind.off (Настройки), язык — state.remind.lang.
// Каждое напоминание — не больше раза за месяц (reminders_sent), даже если Telegram не доставил (человек не запускал бота).
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
  public static function needs(array $st, string $kind, string $ym): bool {
    if (!empty($st['remind']['off'])) return false;
    $places = array_values(array_filter((array)($st['places'] ?? []), fn($p) => is_array($p) && empty($p['deleted'])));
    if (!$places && !empty($st['meter'])) $places = [['id' => 'main', 'meter' => $st['meter']]];
    $first = $places[0]['id'] ?? 'main';
    if (str_starts_with($kind, 'water')) {
      foreach ($places as $p) {
        $ms = array_filter((array)($p['water']['meters'] ?? []), fn($m) => is_array($m) && empty($m['deleted']));
        if (!$ms) continue;
        $has = false;
        foreach ((array)($st['water'] ?? []) as $r)
          if (is_array($r) && empty($r['deleted']) && empty($r['base']) && ($r['place'] ?? '') === $p['id'] && str_starts_with((string)($r['date'] ?? ''), $ym)) { $has = true; break; }
        if (!$has) return true;
      }
      return false;
    }
    foreach ($places as $p) {
      if (empty($p['meter'])) continue;
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

  /** Разослать то, что положено сейчас. → [[user_id, kind], …] кому отправили. */
  public static function run(int $now): array {
    if (!Cfg::get('bot_token')) return [];
    $due = self::due($now); if (!$due) return [];
    $out = [];
    $rows = Db::q("SELECT i.user_id, i.external_id, s.data FROM user_identities i JOIN user_state s ON s.user_id = i.user_id WHERE i.type = 'telegram'")->fetchAll();
    foreach ($rows as $row) {
      $uid = (int)$row['user_id'];
      if (Db::one('SELECT 1 AS x FROM reminders_sent WHERE user_id = ? AND kind = ? AND ym = ?', [$uid, $due['kind'], $due['ym']])) continue;
      $st = json_decode((string)$row['data'], true);
      if (!is_array($st) || !self::needs($st, $due['kind'], $due['ym'])) continue;
      $m = self::text($due['kind'], (string)($st['remind']['lang'] ?? 'uk'));
      Db::q('INSERT INTO reminders_sent (user_id, kind, ym, sent_at) VALUES (?, ?, ?, ?)', [$uid, $due['kind'], $due['ym'], Http::iso()]);
      try {
        Telegram::call('sendMessage', ['chat_id' => $row['external_id'], 'text' => $m['text'],
          'reply_markup' => ['inline_keyboard' => [[['text' => $m['button'], 'web_app' => ['url' => $m['url']]]]]]]);
        $out[] = [$uid, $due['kind']];
      } catch (Throwable $e) { error_log('teplo remind: ' . $e->getMessage()); }
    }
    return $out;
  }
}
