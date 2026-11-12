<?php
// Віджети в особистому чаті з ботом (Bot API 10.4, 09.11.2026): нагадування — інтерактивною карткою.
// Що вміє картка: строк і скільки днів лишилось (смужка), по квартирі — внесено/оплачено чи ні, «Оплатив» для вивозу сміття
// (запис оплати в історію одним дотиком), «Нагадати завтра»; коли картка на екрані — раз просить у бота свіжий стан
// (уже внесли показання в застосунку — картка сама стане «Готово»). Під карткою — ті самі кнопки, що відкривають застосунок.
// Код картки однаковий для всіх; дані — chat_data (≤ 1024 байти, бачить лише цей чат). Секретів у картці немає.
// Ліміти Telegram: HTML ≤ 32 КБ і ≤ 4096 байт після zlib 9; відповідь на дотик — ≤ 15 с, ≤ 1024 байти; 5 запитів / 5 с.
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class BotWidget {
  /** Версія коду картки — у chat_data (v), щоб відрізняти старі картки. */
  const V = 1;
  /** Тести старого шляху (звичайне повідомлення) вимикають картки тут. */
  public static bool $off = false;
  /** Годинник для тестів (null — зараз). */
  public static ?int $now = null;

  /** Код картки: один на всі нагадування. Тексти — тут же (uk/ru), дані — TelegramWidget.chatData. */
  const HTML = <<<'HTML'
<style>
body{margin:0;font:15px/1.35 system-ui,sans-serif;color:var(--tg-theme-text-color)}
.w{padding:12px 14px 10px}
h1{font-size:16px;font-weight:600;margin:0}
.s{color:var(--tg-theme-hint-color);font-size:13px;margin-top:2px}
.b{height:6px;border-radius:3px;background:var(--tg-theme-secondary-bg-color);margin:10px 0 4px;overflow:hidden}
.b i{display:block;height:100%;border-radius:3px;background:var(--tg-theme-button-color)}
.b.l i{background:var(--tg-theme-destructive-text-color)}
.r{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0 0;margin-top:8px;border-top:1px solid var(--tg-theme-section-separator-color)}
.n{font-weight:500}.m{color:var(--tg-theme-hint-color);font-size:13px}
.ok{color:#2e9e5b;font-weight:500;font-size:14px;white-space:nowrap}
button{font:inherit;font-size:14px;border:0;border-radius:10px;padding:8px 12px;background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color);white-space:nowrap}
button.g{background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-link-color)}
.f{display:flex;gap:8px;align-items:center;margin-top:12px}
.e{color:var(--tg-theme-destructive-text-color);font-size:13px;margin-top:6px}
</style>
<div class="w" id="w"></div>
<script>
var W=window.TelegramWidget,L={
uk:{left:'Залишилось',d:['день','дні','днів'],last:'Сьогодні останній день',over:'Строк минув',pay:'Оплатив',later:'Нагадати завтра',snz:'Нагадаю',done:'Готово',paid:'Оплачено',need:'Ще не внесено',topay:'До оплати',err:'Не вийшло — спробуйте ще раз',all:'Усе зроблено'},
ru:{left:'Осталось',d:['день','дня','дней'],last:'Сегодня последний день',over:'Срок прошёл',pay:'Оплатил',later:'Напомнить завтра',snz:'Напомню',done:'Готово',paid:'Оплачено',need:'Ещё не внесено',topay:'К оплате',err:'Не получилось — попробуйте ещё раз',all:'Всё сделано'}},
d={},er='',busy=0;
function rd(){try{d=JSON.parse(W.chatData||'{}')||{}}catch(e){d={}}}
function x(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function pl(n,f){var a=n%10,b=n%100;return f[a==1&&b!=11?0:a>=2&&a<=4&&(b<12||b>14)?1:2]}
function draw(){var t=L[d.l]||L.uk,p=d.p||[],h='<h1>'+x(d.t)+'</h1>';if(d.s)h+='<div class="s">'+x(d.s)+'</div>';
var all=p.length&&p.every(function(q){return q.d});
if(d.e&&!all){var now=new Date(),e=new Date(d.e+'T23:59:59'),b=new Date((d.b||d.e)+'T00:00:00'),k=Math.ceil((e-now)/864e5),f=Math.max(0,Math.min(1,(now-b)/Math.max(1,e-b)));
h+='<div class="b'+(k<=1?' l':'')+'"><i style="width:'+Math.round(f*100)+'%"></i></div><div class="m">'+(k<1?t.over:k==1?t.last:t.left+' '+k+' '+pl(k,t.d))+'</div>'}
p.forEach(function(q,i){h+='<div class="r"><div><div class="n">'+x(q.n)+'</div><div class="m">'+x(q.v||(d.k=='waste10'?t.topay:t.need))+'</div></div>'+
(q.d?'<span class="ok">✓ '+x(q.x||(d.k=='waste10'?t.paid:t.done))+'</span>':(d.k=='waste10'&&q.v?'<button data-q="paid:'+i+'">'+t.pay+'</button>':''))+'</div>'});
if(all)h+='<div class="f"><span class="ok">✓ '+t.all+'</span></div>';
else h+='<div class="f">'+(d.z?'<span class="m">'+t.snz+' '+x(d.z)+'</span>':'<button class="g" data-q="later">'+t.later+'</button>')+'</div>';
if(er)h+='<div class="e">'+x(er)+'</div>';
document.getElementById('w').innerHTML=h}
function ask(q,tap){if(busy)return;busy=1;W.request(q).then(function(a){busy=0;er='';if(a&&a.result){try{d=JSON.parse(a.result)}catch(e){}}if(tap)W.HapticFeedback.notificationOccurred('success');draw()},function(e){busy=0;if(tap){er=(L[d.l]||L.uk).err;W.HapticFeedback.notificationOccurred('error');draw()}})}
document.getElementById('w').addEventListener('click',function(ev){var t=ev.target;while(t&&t.getAttribute&&!t.getAttribute('data-q'))t=t.parentNode;if(t&&t.getAttribute&&t.getAttribute('data-q'))ask(t.getAttribute('data-q'),1)});
rd();draw();
W.onEvent('chatDataChanged',function(){rd();draw()});
if(W.viewer&&W.chatType=='private')ask('st',0);
</script>
HTML;

  /** Байтів після zlib 9 (ліміт Telegram — 4096). */
  public static function packed(): int { return strlen((string)gzcompress(self::HTML, 9)); }

  private static function short(string $s, int $n): string { $s = trim(preg_replace('/\s+/u', ' ', $s)); return mb_strlen($s) > $n ? rtrim(mb_substr($s, 0, $n - 1)) . '…' : $s; }
  private static function dm(string $d): string { return substr($d, 8, 2) . '.' . substr($d, 5, 2); }

  /** Строк і початок смужки: [від, до] (Y-m-d). */
  public static function window(string $kind, string $ym, string $today): array {
    $next = (new DateTimeImmutable($ym . '-01'))->modify('first day of next month')->format('Y-m');
    if (str_starts_with($kind, 'heat')) return [$ym . '-05', $ym . '-25'];
    if (str_starts_with($kind, 'water')) return [$ym . '-01', $ym . '-20'];
    if (str_starts_with($kind, 'elec')) return Reminders::elecWindow($ym);
    if (str_starts_with($kind, 'gas')) return Reminders::gasWindow($ym);
    if (str_starts_with($kind, 'waste')) return [$next . '-01', $next . '-20'];
    return [$today, $today];
  }

  /** chat_data картки: {v, k, ym, l, t, s, b, e, p:[{id, n, v, d, x}], z}. Не влізло в 1024 байти — null (тоді звичайне повідомлення). */
  public static function data(string $kind, string $ym, string $lang, array $places, string $today): ?array {
    $ru = $lang === 'ru';
    $mon = Reminders::MONTHS[$ru ? 'ru' : 'uk'][(int)substr($ym, 5, 2) - 1] ?? '';
    $t = [
      'heat' => $ru ? 'Показания тепла' : 'Показання тепла', 'water' => $ru ? 'Показания воды' : 'Показання води',
      'elec' => $ru ? 'Показания света' : 'Показання світла', 'gas' => $ru ? 'Показания газа' : 'Показання газу',
      'waste' => ($ru ? 'Вывоз мусора за ' : 'Вивіз сміття за ') . $mon,
    ][preg_replace('/\d+$/', '', $kind)] ?? '';
    [$b, $e] = self::window($kind, $ym, $today);
    $orgs = array_values(array_unique(array_filter(array_map(fn($p) => (string)($p['org'] ?? ''), $places))));
    $s = str_starts_with($kind, 'heat') ? ($ru ? 'ХТМ принимает до ' : 'ХТМ приймає до ') . self::dm($e)
      : (str_starts_with($kind, 'waste') ? ($ru ? 'Обычно платят до ' : 'Зазвичай платять до ') . self::dm($e) : ($ru ? 'Передать до ' : 'Передати до ') . self::dm($e));
    if (count($orgs) === 1 && !str_starts_with($kind, 'heat')) $s .= ' · ' . self::short($orgs[0], 40);
    $p = [];
    foreach (array_slice($places, 0, 4) as $q) {
      $v = '';
      if (str_starts_with($kind, 'waste') && ($q['sum'] ?? null) !== null) $v = '≈ ' . str_replace('.', ',', number_format((float)$q['sum'], 2, '.', '')) . ' грн';
      $p[] = ['id' => (string)$q['id'], 'n' => self::short((string)($q['label'] ?? ''), 28), 'v' => $v, 'a' => ($q['sum'] ?? null) !== null ? round((float)$q['sum'], 2) : null, 'd' => 0];
    }
    $d = ['v' => self::V, 'k' => $kind, 'ym' => $ym, 'l' => $ru ? 'ru' : 'uk', 't' => $t, 's' => $s, 'b' => $b, 'e' => $e, 'p' => $p];
    return strlen(self::enc($d)) <= 1024 ? $d : null;
  }

  public static function enc(array $d): string { return (string)json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }

  /** Надіслати нагадування карткою. $m — Reminders::text(); [] — Telegram відмовив (тоді звичайне повідомлення). */
  public static function send(string $chatId, array $m, array $d, ?array $keyboard): array {
    $cap = self::short((string)strtok((string)$m['text'], "\n"), 300);
    $msg = ['chat_id' => $chatId, 'html' => self::HTML, 'chat_data' => self::enc($d), 'allow_queries' => true, 'caption' => $cap];
    if ($keyboard) $msg['reply_markup'] = $keyboard;
    $r = Telegram::call('sendWidget', $msg);
    return !empty($r['ok']) ? $r : [];
  }

  /** Дотик чи фоновий запит з картки (update widget_query) → answerWidgetQuery з новим станом (і editMessageWidgetData, щоб стан лишився). */
  public static function query(array $q): ?array {
    $id = (string)($q['id'] ?? ''); $data = (string)($q['data'] ?? ''); $tg = (string)($q['from']['id'] ?? '');
    $chat = $q['chat']['id'] ?? null; $mid = $q['message_id'] ?? null;
    if ($id === '') return null;
    $ans = function (?array $d) use ($id): array { $p = ['widget_query_id' => $id]; if ($d !== null) $p['data'] = self::enc($d); Telegram::call('answerWidgetQuery', $p); return $p; };
    $d = self::stored($chat, $mid);   // у запиті Telegram стану картки немає — беремо збережений при відправці
    $uid = $tg !== '' ? (int)(Db::one("SELECT user_id FROM user_identities WHERE type = 'telegram' AND external_id = ?", [$tg])['user_id'] ?? 0) : 0;
    if (!is_array($d) || !$uid || !preg_match('/^(heat|water|elec|gas|waste)\d+$/', (string)($d['k'] ?? '')) || !preg_match('/^\d{4}-\d{2}$/', (string)($d['ym'] ?? ''))) return $ans(null);
    $today = (new DateTimeImmutable('@' . (self::$now ?? time())))->setTimezone(new DateTimeZone(Reminders::TZ))->format('Y-m-d');
    $changed = false;
    if ($data === 'later') {
      $at = (new DateTimeImmutable($today))->modify('+1 day')->format('Y-m-d');
      Db::q('DELETE FROM reminder_snooze WHERE user_id = ? AND kind = ? AND ym = ?', [$uid, $d['k'], $d['ym']]);
      Db::q('INSERT INTO reminder_snooze (user_id, kind, ym, at, chat_id) VALUES (?, ?, ?, ?, ?)', [$uid, $d['k'], $d['ym'], $at, (string)$chat]);
      $d['z'] = self::dm($at) . ' ' . ($d['l'] === 'ru' ? 'в 10:00' : 'о 10:00'); $changed = true;
    } elseif (preg_match('/^paid:(\d)$/', $data, $mm) && str_starts_with($d['k'], 'waste')) {
      $i = (int)$mm[1]; $pl = $d['p'][$i] ?? null;
      if (is_array($pl) && empty($pl['d']) && ($pl['a'] ?? null) !== null && self::payWaste($uid, (string)$pl['id'], (string)$d['ym'], (float)$pl['a'], $today)) {
        $d['p'][$i]['d'] = 1; $d['p'][$i]['x'] = 'Оплачено ' . self::dm($today); $changed = true;
      }
    }
    // свіжий стан: що вже внесли/оплатили в застосунку
    $row = Db::one('SELECT data FROM user_state WHERE user_id = ?', [$uid]);
    $st = $row ? json_decode((string)$row['data'], true) : null;
    if (is_array($st)) {
      $due = array_column(Reminders::placesDue($st, (string)$d['k'], (string)$d['ym'], $today), 'id');
      foreach ($d['p'] as $i => $pl) if (empty($pl['d']) && !in_array($pl['id'], $due, true)) { $d['p'][$i]['d'] = 1; $changed = true; }
    }
    if ($changed && $chat !== null && $mid !== null) { try { Telegram::call('editMessageWidgetData', ['chat_id' => $chat, 'message_id' => $mid, 'chat_data' => self::enc($d)]); } catch (Throwable $e) { /* стан повернемо у відповіді */ } }
    if ($changed && $chat !== null && $mid !== null) self::remember($chat, $mid, $d);
    return $ans($d);
  }

  /** Останній відомий стан картки (якщо Telegram не прислав chat_data у запиті). */
  private static function stored($chat, $mid): ?array {
    if ($chat === null || $mid === null) return null;
    $r = Db::one('SELECT data FROM widget_msgs WHERE chat_id = ? AND message_id = ?', [(string)$chat, (int)$mid]);
    $d = $r ? json_decode((string)$r['data'], true) : null; return is_array($d) ? $d : null;
  }
  public static function remember($chat, $mid, array $d): void {
    Db::q('DELETE FROM widget_msgs WHERE chat_id = ? AND message_id = ?', [(string)$chat, (int)$mid]);
    Db::q('INSERT INTO widget_msgs (chat_id, message_id, data, at) VALUES (?, ?, ?, ?)', [(string)$chat, (int)$mid, self::enc($d), Http::iso()]);
  }

  /** «Оплатив» з картки: запис оплати вивозу сміття за місяць ym у стан людини (як у застосунку, src: bot). */
  public static function payWaste(int $uid, string $place, string $ym, float $amount, string $today): bool {
    for ($try = 0; $try < 3; $try++) {
      $row = Db::one('SELECT data, version, updated_at FROM user_state WHERE user_id = ?', [$uid]); if (!$row) return false;
      $st = json_decode((string)$row['data']); if (!is_object($st) || !isset($st->places) || !is_array($st->places)) return false;
      $done = false; $ms = (int)round(microtime(true) * 1000);
      foreach ($st->places as $p) {
        if (!is_object($p) || ($p->id ?? '') !== $place || !empty($p->deleted)) continue;
        if (!isset($p->waste) || !is_object($p->waste)) return false;
        if (Reminders::wastePaid(json_decode((string)json_encode($p->waste), true) ?: [], $ym)) return true;   // уже записали в застосунку
        if (!isset($p->waste->pays) || !is_array($p->waste->pays)) $p->waste->pays = [];
        $p->waste->pays[] = (object)['id' => 'wb' . base_convert((string)$ms, 10, 36), 'ym' => $ym, 'n' => 1, 'date' => $today, 'amount' => round($amount, 2), 'src' => 'bot', 'updatedAt' => $ms];
        $p->updatedAt = $ms; $done = true; break;   // квартира новіша — при злитті з пристроєм перемагає вона
      }
      if (!$done) return false;
      $json = json_encode($st, JSON_UNESCAPED_UNICODE); if ($json === false) return false;
      if (Db::q('UPDATE user_state SET data = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?', [$json, Http::iso(), $uid, (int)$row['version']])->rowCount() === 1) {
        if (class_exists('StateHist')) StateHist::put($uid, (string)$row['data'], (int)$row['version'], (string)$row['updated_at'], 'botpay');
        return true;
      }
    }
    return false;
  }
}
