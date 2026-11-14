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
    ][preg_replace('/L?\d+$/', '', $kind)] ?? '';
    [$b, $e] = self::window($kind, $ym, $today);
    $loc = (bool)preg_match('/^(water|heat|elec)L\d+$/', $kind);   // 142-я: окно местного поставщика — начало и конец из placesDue
    if ($loc && !empty($places[0]['e'])) { $es = array_column($places, 'e'); sort($es); [$b, $e] = [(string)($places[0]['b'] ?? $es[0]), $es[0]]; }
    $orgs = array_values(array_unique(array_filter(array_map(fn($p) => (string)($p['org'] ?? ''), $places))));
    $s = str_starts_with($kind, 'heat') && !$loc ? ($ru ? 'ХТМ принимает до ' : 'ХТМ приймає до ') . self::dm($e)
      : (str_starts_with($kind, 'waste') ? ($ru ? 'Обычно платят до ' : 'Зазвичай платять до ') . self::dm($e) : ($ru ? 'Передать до ' : 'Передати до ') . self::dm($e));
    if (count($orgs) === 1 && (!str_starts_with($kind, 'heat') || $loc)) $s .= ' · ' . self::short($orgs[0], 40);
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
    $card = BotCard::byMsg($chat, $mid); if ($card) return BotCard::query($card, $uid, $data, $ans);   // картка фото лічильника (121-а)
    if (is_array($d) && ($d['k'] ?? '') === 'fb' && class_exists('Feedback')) return Feedback::query($d, $uid, $data, $chat, $mid, $ans);   // відповідь на відгук (121-а)
    if (!is_array($d) || !$uid || !preg_match('/^(heat|water|elec|gas|waste)L?\d+$/', (string)($d['k'] ?? '')) || !preg_match('/^\d{4}-\d{2}$/', (string)($d['ym'] ?? ''))) return $ans(null);
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

/**
 * Фото лічильника в чат (121-а, власник 12.11: «одне фото й одна кнопка») → картка-віджет: що розпізнано, куди піде, «Відправити»;
 * статус «в черзі → відправлено → прийнято ✓» оновлюється в тій самій картці (cron, editMessageWidgetData).
 * Розпізнає телефон людини (застосунок, кнопка «Розпізнати» під карткою — безкоштовно): у віджета нема мережі, а сервер фото без
 * платного ключа не читає. Застосунок перевіряє цифри (як автоподача) і віддає картці план: що й куди відправити (POST /api/bot/card).
 * «Відправити» — роботи ХТМ і Водоканалу в чергу одразу (натиснула людина — окремої згоди не треба). Після «прийнято» — пропозиція
 * «надалі у фоні» одним дотиком і коротке «усе було зрозуміло?» (відповідь — у /admin).
 */
final class BotCard {
  const V = 1;
  /** Скільки фото чекають в одній картці (альбом, кілька екранів), хвилин. */
  const OPEN_MIN = 15;
  const HTML = <<<'HTML'
<style>
body{margin:0;font:15px/1.35 system-ui,sans-serif;color:var(--tg-theme-text-color)}
.w{padding:12px 14px 10px}h1{font-size:16px;font-weight:600;margin:0}
.s{color:var(--tg-theme-hint-color);font-size:13px;margin-top:2px}
.r{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0 0;margin-top:8px;border-top:1px solid var(--tg-theme-section-separator-color)}
.v{font-weight:600;font-size:20px;line-height:1.2;font-variant-numeric:tabular-nums}.m{color:var(--tg-theme-hint-color);font-size:13px}
.c{font-size:13px;font-weight:500;white-space:nowrap;padding:3px 9px;border-radius:99px;background:var(--tg-theme-secondary-bg-color)}
.c.ok{color:#2e9e5b}.c.no{color:var(--tg-theme-destructive-text-color)}
button{font:inherit;font-size:15px;font-weight:500;border:0;border-radius:10px;padding:9px 14px;background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color);white-space:nowrap}
button.g{background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-link-color)}
.f{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}.f button.b{flex:1}
.e{color:var(--tg-theme-destructive-text-color);font-size:13px;margin-top:6px}
</style>
<div class="w" id="w"></div>
<script>
var W=window.TelegramWidget,L={
uk:{h:'Фото лічильника',n:'фото',nw:'Розпізнає ваш телефон, безкоштовно — натисніть «Розпізнати» під карткою.',fx:'Деякі цифри треба перевірити — «Перевірити в застосунку» під карткою.',snd:'Відправити',q:'В черзі',go:'Відправляю',sd:'Відправлено',ok:'Прийнято',ms:'Лист надіслано',no:'Не прийнято',f:'Не вдалося',oh:'Надалі вносити тепло в кабінет ХТМ самим, без натискань?',ov:'Надалі надсилати воду у фоні самим, без натискань?',oy:'Так, у фоні',on:'Увімкнено — далі без натискань',pq:'Усе було зрозуміло?',py:'Так',pn:'Не зовсім',pt:'Дякуємо',pt2:'Дякуємо — напишіть, що заплутало, кнопкою «Відгук» у застосунку',err:'Не вийшло — спробуйте ще раз'},
ru:{h:'Фото счётчика',n:'фото',nw:'Распознает ваш телефон, бесплатно — нажмите «Распознать» под карточкой.',fx:'Некоторые цифры нужно проверить — «Проверить в приложении» под карточкой.',snd:'Отправить',q:'В очереди',go:'Отправляю',sd:'Отправлено',ok:'Принято',ms:'Письмо отправлено',no:'Не принято',f:'Не получилось',oh:'Дальше вносить тепло в кабинет ХТМ самим, без нажатий?',ov:'Дальше отправлять воду в фоне самим, без нажатий?',oy:'Да, в фоне',on:'Включено — дальше без нажатий',pq:'Всё было понятно?',py:'Да',pn:'Не совсем',pt:'Спасибо',pt2:'Спасибо — напишите, что запутало, кнопкой «Отзыв» в приложении',err:'Не получилось — попробуйте ещё раз'}},
d={},er='',busy=0;
function rd(){try{d=JSON.parse(W.chatData||'{}')||{}}catch(e){d={}}}
function x(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function draw(){var t=L[d.l]||L.uk,r=d.r||[],h='<h1>'+t.h+'</h1>';if(d.n)h+='<div class="s">'+t.n+': '+d.n+'</div>';
if(d.s=='new')h+='<div class="m" style="margin-top:8px">'+t.nw+'</div>';
r.forEach(function(q){var c=q.s?'<span class="c'+(/^(ok|ms)$/.test(q.s)?' ok':q.s=='no'||q.s=='f'?' no':'')+'">'+(/^(ok|ms)$/.test(q.s)?'✓ ':'')+t[q.s]+'</span>':'';
h+='<div class="r"><div><div class="m">'+x(q.t)+(q.w?' → '+x(q.w):'')+'</div><div class="v">'+x(q.v||'—')+'</div>'+(q.m?'<div class="m">'+x(q.m)+'</div>':'')+'</div>'+c+'</div>'});
var can=d.s=='ready'&&r.some(function(q){return q.a&&!q.s});
if(can)h+='<div class="f"><button class="b" data-q="send">'+t.snd+'</button></div>';
if(d.s=='fix')h+='<div class="m" style="margin-top:10px">'+t.fx+'</div>';
var fin=d.s=='sent'&&r.some(function(q){return /^(ok|ms)$/.test(q.s)})&&r.every(function(q){return !q.a||/^(ok|ms|no|f)$/.test(q.s)});
if(fin&&d.o&&d.o!='on')h+='<div class="r"><div class="m">'+(d.o=='vk'?t.ov:t.oh)+'</div><button data-q="auto">'+t.oy+'</button></div>';
if(fin&&d.o=='on')h+='<div class="f"><span class="c ok">✓ '+t.on+'</span></div>';
if(fin&&!d.p)h+='<div class="f"><span class="m">'+t.pq+'</span><button class="g" data-q="p:y">'+t.py+'</button><button class="g" data-q="p:n">'+t.pn+'</button></div>';
if(fin&&d.p)h+='<div class="f"><span class="m">'+(d.p=='n'?t.pt2:t.pt)+'</span></div>';
if(er)h+='<div class="e">'+x(er)+'</div>';
document.getElementById('w').innerHTML=h}
function ask(q,tap){if(busy)return;busy=1;W.request(q).then(function(a){busy=0;er='';if(a&&a.result){try{d=JSON.parse(a.result)}catch(e){}}if(tap)W.HapticFeedback.notificationOccurred('success');draw()},function(){busy=0;if(tap){er=(L[d.l]||L.uk).err;W.HapticFeedback.notificationOccurred('error');draw()}})}
document.getElementById('w').addEventListener('click',function(ev){var t=ev.target;while(t&&t.getAttribute&&!t.getAttribute('data-q'))t=t.parentNode;if(t&&t.getAttribute&&t.getAttribute('data-q'))ask(t.getAttribute('data-q'),1)});
rd();draw();
W.onEvent('chatDataChanged',function(){rd();draw()});
if(W.viewer&&W.chatType=='private'&&d.s=='sent')ask('st',0);
</script>
HTML;

  public static function packed(): int { return strlen((string)gzcompress(self::HTML, 9)); }
  private static function js($s): array { $j = json_decode((string)$s, true); return is_array($j) ? $j : []; }
  private static function cut(string $s, int $n): string { $s = trim(preg_replace('/\s+/u', ' ', $s)); return mb_strlen($s) > $n ? rtrim(mb_substr($s, 0, $n - 1)) . '…' : $s; }
  public static function on(): bool { return !BotWidget::$off && (bool)Cfg::get('bot_widgets', true); }
  private static function kb(int $id, string $lang, bool $fresh): array {
    $ru = $lang === 'ru';
    return ['inline_keyboard' => [[['text' => $fresh ? ($ru ? 'Распознать' : 'Розпізнати') : ($ru ? 'Проверить в приложении' : 'Перевірити в застосунку'),
      'web_app' => ['url' => Cfg::appUrl() . '?inbox=1&card=' . $id]]]]];
  }
  public static function get(int $id): ?array { $r = Db::one('SELECT * FROM bot_cards WHERE id = ?', [$id]); return $r ?: null; }
  public static function byMsg($chat, $mid): ?array { if ($chat === null || $mid === null) return null; $r = Db::one('SELECT * FROM bot_cards WHERE chat_id = ? AND message_id = ?', [(string)$chat, (int)$mid]); return $r ?: null; }

  /** Зберегти й показати новий стан картки (Telegram — editMessageWidgetData; не вийшло — стан однаково в базі, віддамо на запит). */
  public static function put(array $c, array $d, ?string $stage = null, ?array $plan = null, bool $edit = true): array {
    $stage = $stage ?? (string)$c['stage']; $d['s'] = $stage;
    $sets = ['data = ?', 'stage = ?', 'updated_at = ?']; $args = [BotWidget::enc($d), $stage, Http::iso()];
    if ($plan !== null) { $sets[] = 'plan = ?'; $args[] = json_encode($plan, JSON_UNESCAPED_UNICODE); }
    $args[] = (int)$c['id']; Db::q('UPDATE bot_cards SET ' . implode(', ', $sets) . ' WHERE id = ?', $args);
    if ($edit && $c['message_id'] !== null) { try { Telegram::call('editMessageWidgetData', ['chat_id' => $c['chat_id'], 'message_id' => (int)$c['message_id'], 'chat_data' => BotWidget::enc($d)]); } catch (Throwable $e) { /* стан — у базі */ } }
    return $d;
  }

  /** Фото з чату вже в bot_inbox → картка: нова (sendWidget) або та сама, що ще чекає на розпізнавання (альбом). null — карткою не вийшло. */
  public static function photo(int $uid, $chat, string $photoId, string $lang): ?array {
    if (!self::on() || !$uid) return null;
    $lang = $lang === 'ru' ? 'ru' : 'uk';
    $dir = (Cfg::data() ?: sys_get_temp_dir() . '/teplo_data') . '/cache'; if (!is_dir($dir)) @mkdir($dir, 0700, true);
    $lk = @fopen($dir . '/tgcard_' . preg_replace('/\D/', '', (string)$chat) . '.lock', 'c'); if ($lk) flock($lk, LOCK_EX);   // альбом — кілька вебхуків одночасно
    try {
      $since = gmdate('Y-m-d\TH:i:s', time() - self::OPEN_MIN * 60);
      $c = Db::one("SELECT * FROM bot_cards WHERE user_id = ? AND chat_id = ? AND stage = 'new' AND updated_at >= ? ORDER BY id DESC LIMIT 1", [$uid, (string)$chat, $since]);
      if ($c) {
        $ph = self::js($c['photos']); $ph[] = $photoId; $d = self::js($c['data']); $d['n'] = count($ph);
        Db::q('UPDATE bot_cards SET photos = ? WHERE id = ?', [json_encode($ph), (int)$c['id']]);
        return ['card' => (int)$c['id'], 'data' => self::put($c, $d)];
      }
      $d = ['v' => self::V, 'k' => 'rd', 'l' => $lang, 's' => 'new', 'n' => 1, 'r' => []];
      Db::q('INSERT INTO bot_cards (user_id, chat_id, message_id, lang, photos, plan, data, stage, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)',
        [$uid, (string)$chat, $lang, json_encode([$photoId]), BotWidget::enc($d), 'new', Http::iso(), Http::iso()]);
      $id = (int)Db::id();
      $cap = $lang === 'ru' ? 'Фото счётчика — распознаем и отправим' : 'Фото лічильника — розпізнаємо й відправимо';
      $r = Telegram::call('sendWidget', ['chat_id' => $chat, 'html' => self::HTML, 'chat_data' => BotWidget::enc($d), 'allow_queries' => true, 'caption' => $cap, 'reply_markup' => self::kb($id, $lang, true)]);
      $mid = $r['result']['message_id'] ?? null;
      if (empty($r['ok']) || $mid === null) { Db::q('DELETE FROM bot_cards WHERE id = ?', [$id]); return null; }
      Db::q('UPDATE bot_cards SET message_id = ? WHERE id = ?', [(int)$mid, $id]);
      return ['card' => $id, 'data' => $d, 'sent' => true];
    } finally { if ($lk) { flock($lk, LOCK_UN); fclose($lk); } }
  }

  /** POST /api/bot/card {card, items: [{k, t, v, w, ok, m, plan: {svc: htm|vk, in}}]} — застосунок розпізнав фото картки. */
  public static function result(int $uid, array $in): array {
    $c = self::get((int)($in['card'] ?? 0));
    if (!$c || (int)$c['user_id'] !== $uid) throw new HttpError(404, 'card_not_found');
    if (in_array($c['stage'], ['sent'], true)) return ['ok' => true, 'stage' => $c['stage']];
    $items = []; $plan = []; $bad = false; $sent = false; $own = null;
    foreach (array_slice((array)($in['items'] ?? []), 0, 4) as $i => $x) {
      if (!is_array($x)) continue;
      $svc = (string)($x['plan']['svc'] ?? ''); $ok = !empty($x['ok']); if (!$ok) $bad = true;
      // 145-а: квартира зі своїм постачальником цього виду — роботів довідника не пропонуємо, навіть якщо старий застосунок прислав план
      if (in_array($svc, ['htm', 'vk', 'lb'], true)) {
        $own = $own ?? self::ownKinds($uid); $pl = (string)($x['plan']['in']['place'] ?? ''); $kind = $svc === 'htm' ? 'heat' : 'water';
        if ($pl !== '' && isset($own[$pl][$kind])) { $ru = (string)$c['lang'] === 'ru'; $x['plan'] = null; $svc = ''; $x['w'] = $own[$pl][$kind] !== '' ? $own[$pl][$kind] : ($ru ? 'Свой поставщик' : 'Свій постачальник');
          $x['m'] = $ru ? 'Свой поставщик — реквизиты и «Оплачено» в приложении, кнопка под карточкой' : 'Свій постачальник — реквізити й «Оплачено» в застосунку, кнопка під карткою'; }
      }
      // застосунок уже поставив у чергу сам (людина виправила й натиснула там) — картка стежить за тією задачею
      $js = (string)($x['job']['svc'] ?? ''); $jid = (int)($x['job']['id'] ?? 0);
      $jr = $jid && in_array($js, ['htm', 'vk', 'lb'], true) ? Db::one('SELECT * FROM cab_jobs WHERE id = ? AND user_id = ? AND ' . ($js === 'lb' ? "prov LIKE 'L%'" : 'prov = ?'), $js === 'lb' ? [$jid, $uid] : [$jid, $uid, $js]) : null;
      if ($jr) { [$mk] = self::mark($js, $jr); $items[] = ['t' => self::cut((string)($x['t'] ?? ''), 24), 'v' => self::cut((string)($x['v'] ?? ''), 40), 'w' => self::cut((string)($x['w'] ?? ''), 32), 'a' => 1, 's' => $mk, 'm' => '']; $plan[] = ['svc' => $js, 'in' => null, 'job' => $jid]; $sent = true; continue; }
      $can = $ok && in_array($svc, ['htm', 'vk', 'lb'], true) && is_array($x['plan']['in'] ?? null);
      $items[] = ['t' => self::cut((string)($x['t'] ?? ''), 24), 'v' => self::cut((string)($x['v'] ?? ''), 40), 'w' => self::cut((string)($x['w'] ?? ''), 32), 'a' => $can ? 1 : 0, 's' => '', 'm' => self::cut((string)($x['m'] ?? ''), 110)];
      $plan[] = $can ? ['svc' => $svc, 'in' => $x['plan']['in'], 'job' => null] : null;
    }
    if (!$items) throw new HttpError(422, 'card_no_items');
    $d = self::js($c['data']); $d['r'] = $items; unset($d['e']);
    $fix = !empty($in['fix']) || $bad;   // щось не прочитано чи з зауваженнями — «перевірте в застосунку»
    $d = self::put($c, $d, $sent ? 'sent' : ($fix ? 'fix' : 'ready'), $plan);
    // кнопка під карткою: тепер — «Перевірити в застосунку»
    try { if ($c['message_id'] !== null) Telegram::call('editMessageReplyMarkup', ['chat_id' => $c['chat_id'], 'message_id' => (int)$c['message_id'], 'reply_markup' => self::kb((int)$c['id'], (string)$c['lang'], false)]); } catch (Throwable $e) { /* кнопка лишиться «Розпізнати» */ }
    return ['ok' => true, 'stage' => $d['s']];
  }

  /** Свої постачальники людини зі збереженого стану: [id квартири => [вид => назва]] (місто без квартир — 'main'). */
  public static function ownKinds(int $uid): array {
    try { $r = Db::one('SELECT data FROM user_state WHERE user_id = ?', [$uid]); } catch (Throwable $e) { return []; }
    $st = $r ? json_decode((string)$r['data'], true) : null; $out = [];
    foreach ((array)(is_array($st) ? ($st['places'] ?? []) : []) as $p) {
      if (!is_array($p) || !empty($p['deleted'])) continue;
      foreach ((array)($p['prov'] ?? []) as $k => $o) if (is_array($o) && !empty($o['own'])) $out[(string)($p['id'] ?? 'main')][(string)$k] = trim((string)($o['name'] ?? ''));
    }
    return $out;
  }

  /** «25.11 о 09:00» за Києвом. */
  private static function when(int $ts, string $lang): string {
    $d = (new DateTime('@' . $ts))->setTimezone(new DateTimeZone('Europe/Kyiv'));
    return $d->format('d.m') . ($lang === 'ru' ? ' в ' : ' о ') . $d->format('H:i');
  }
  /** Статус задачі робота → позначка картки. */
  public static function mark(string $svc, array $j): array {
    $st = (string)$j['status']; $r = self::js($j['result']);
    $m = ['queued' => 'q', 'sending' => 'go', 'pending' => 'sd', 'unknown' => 'sd', 'ok' => 'ok', 'sent' => 'ms', 'rejected' => 'no', 'failed' => 'f', 'cancelled' => 'f'][$st] ?? 'q';
    $why = $m === 'no' ? (string)($r['reason'] ?? $r['text'] ?? '') : ($m === 'f' ? (string)($r['human'] ?? '') : '');
    return [$m, $why];
  }

  /** Задачі роботів картки → позначки; true — щось змінилось. */
  public static function refresh(array &$d, array $plan): bool {
    $ch = false;
    foreach ($plan as $i => $p) {
      if (!$p || empty($p['job']) || !isset($d['r'][$i])) continue;
      $j = Db::one('SELECT * FROM cab_jobs WHERE id = ?', [(int)$p['job']]); if (!$j) continue;
      [$m, $why] = self::mark((string)$p['svc'], $j);
      if (($d['r'][$i]['s'] ?? '') !== $m) { $d['r'][$i]['s'] = $m; $ch = true; }
      if ($why !== '' && ($d['r'][$i]['m'] ?? '') !== self::cut($why, 110)) { $d['r'][$i]['m'] = self::cut($why, 110); $ch = true; }
    }
    return $ch;
  }

  /** Усе відправлене закінчилось і є «прийнято» — один раз вирішити, що запропонувати «надалі у фоні» (o). true — змінилось. */
  public static function settle(array &$d, array $plan, int $uid): bool {
    if (array_key_exists('o', $d)) return false;
    $r = $d['r'] ?? []; $okp = [];
    foreach ($r as $i => $q) { if (!empty($q['a']) && !in_array($q['s'] ?? '', ['ok', 'ms', 'no', 'f'], true)) return false; if (in_array($q['s'] ?? '', ['ok', 'ms'], true) && !empty($plan[$i])) $okp[] = $plan[$i]; }
    if (!$okp) return false;
    $d['o'] = self::offer($uid, $okp); return true;
  }
  /** «Надалі у фоні» — що запропонувати після «прийнято»: vk / htm, якщо автоподачу ще не ввімкнено. */
  private static function offer(int $uid, array $plan): string {
    $svc = array_values(array_filter(array_map(fn($p) => $p['svc'] ?? '', $plan)));
    try {
      if (in_array('htm', $svc, true) && !HtmSvc::autoOn($uid)) return 'htm';
      if (in_array('vk', $svc, true) && !VkSvc::autoOn($uid)) return 'vk';
    } catch (Throwable $e) { return ''; }
    return '';
  }

  /** Дотик чи фоновий запит з картки (BotWidget::query передає сюди картки фото). */
  public static function query(array $c, int $uid, string $q, callable $ans): array {
    $d = self::js($c['data']); $plan = self::js($c['plan']);
    if (!$uid || (int)$c['user_id'] !== $uid) return $ans($d ?: null);
    $lang = (string)$c['lang']; $changed = false;
    if ($q === 'send' && $c['stage'] === 'ready' && array_filter($plan, fn($p) => $p && empty($p['job']))) {   // нічого відправляти — стадію не чіпаємо (застосунок ще може відправити сам)
      foreach ($plan as $i => &$p) {
        if (!$p || !empty($p['job'])) continue;
        $in = (array)$p['in'] + ['lang' => $lang, 'card' => (int)$c['id']];
        try {
          $r = $p['svc'] === 'htm' ? HtmSvc::cardQueue($uid, $in) : ($p['svc'] === 'lb' ? LocalBot::queue($uid, $in) : VkSvc::queue($uid, ['auto' => false] + $in));
          $p['job'] = (int)($r['job']['id'] ?? 0); $d['r'][$i]['s'] = 'q';
          // місцевий КП приймає лише у вікні подачі — у картці «надішлемо 25.11 о 09:00» (окремого повідомлення нема)
          $na = (int)($r['job']['nextAt'] ?? 0); if ($p['svc'] === 'lb' && $na > time() + 120) $d['r'][$i]['m'] = self::cut(($lang === 'ru' ? 'Отправим ' : 'Надішлемо ') . self::when($na, $lang), 110);
        } catch (Throwable $e) {
          $d['r'][$i]['s'] = 'f'; $d['r'][$i]['m'] = self::cut($e instanceof HttpError ? (string)($e->extra['human'] ?? $e->err) : ($lang === 'ru' ? 'Сервис недоступен' : 'Сервіс недоступний'), 110);
        }
      }
      unset($p);
      self::settle($d, $plan, $uid);
      return $ans(self::put($c, $d, 'sent', $plan));
    }
    if ($q === 'auto' && ($d['o'] ?? '') !== '' && $d['o'] !== 'on') {
      try {
        if ($d['o'] === 'htm') HtmSvc::auto($uid, ['on' => true, 'lang' => $lang]); else VkSvc::auto($uid, ['on' => true, 'consent' => true, 'lang' => $lang]);
        $d['o'] = 'on'; $changed = true;
      } catch (Throwable $e) { return $ans(null); }
    } elseif (preg_match('/^p:([yn])$/', $q, $m) && empty($d['p'])) {
      $d['p'] = $m[1]; $changed = true;
      Db::q('INSERT INTO recog_reports (user_id, photo_ids, kind, ok, text, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$uid, implode(',', self::js($c['photos'])), 'card_poll', $m[1] === 'y' ? 1 : 0, 'Опрос в карточке фото в чате: ' . ($m[1] === 'y' ? 'всё понятно' : 'не совсем понятно'), json_encode(['card' => (int)$c['id'], 'r' => $d['r'] ?? []], JSON_UNESCAPED_UNICODE), Http::iso()]);
    }
    if (self::refresh($d, $plan)) $changed = true;
    if (self::settle($d, $plan, $uid)) $changed = true;
    if ($changed) $d = self::put($c, $d);
    return $ans($d);
  }

  /** /api/health → botCards (122-а): скільки карток фото за 30 днів по стадіях, позначки рядків (ok/no/f/…), опитування, остання — лише числа, без людей. */
  public static function summary(): array {
    try {
      $since = gmdate('Y-m-d\TH:i:s', time() - 30 * 86400); $st = []; $marks = []; $poll = []; $last = null;
      foreach (Db::q('SELECT stage, data, created_at FROM bot_cards WHERE created_at >= ? ORDER BY id DESC LIMIT 500', [$since])->fetchAll() as $c) {
        $st[$c['stage']] = ($st[$c['stage']] ?? 0) + 1; $last = $last ?? $c['created_at']; $d = self::js($c['data']);
        foreach ((array)($d['r'] ?? []) as $q) { $m = (string)($q['s'] ?? '') ?: (!empty($q['a']) ? 'can' : 'info'); $marks[$m] = ($marks[$m] ?? 0) + 1; }
        if (!empty($d['p'])) $poll[$d['p']] = ($poll[$d['p']] ?? 0) + 1;
      }
      $b = Cron::read()['botCards'] ?? null;
      return ['n30' => array_sum($st), 'stage' => (object)$st, 'marks' => (object)$marks, 'poll' => (object)$poll, 'last' => $last, 'cron' => $b];
    } catch (Throwable $e) { return ['error' => 'db']; }
  }

  /** Cron: картки з відправленим — свіжі статуси роботів у ту саму картку (3 доби). */
  public static function cron(?int $now = null): array {
    $since = gmdate('Y-m-d\TH:i:s', ($now ?? time()) - 3 * 86400); $out = [];
    foreach (Db::q("SELECT * FROM bot_cards WHERE stage = 'sent' AND created_at >= ? ORDER BY id DESC LIMIT 50", [$since])->fetchAll() as $c) {
      $d = self::js($c['data']); $plan = self::js($c['plan']);
      if (!array_filter($d['r'] ?? [], fn($q) => !empty($q['a']) && in_array($q['s'] ?? '', ['q', 'go', 'sd'], true))) continue;
      if (self::refresh($d, $plan)) { self::settle($d, $plan, (int)$c['user_id']); self::put($c, $d); $out[] = (int)$c['id']; }
    }
    return $out;
  }
}
