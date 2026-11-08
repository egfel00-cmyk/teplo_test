<?php
// Робот кабинета ХТМ против стенда tests/htm-mock. Запуск: стенд на 127.0.0.1:8099 (tests/htm-mock/start.sh), затем php tests/htm_cab.php
declare(strict_types=1);
define('TEPLO', 1);
require __DIR__ . '/../app/core.php';
require __DIR__ . '/../app/cabs.php';
$TMP = sys_get_temp_dir() . '/teplo_htm_' . getmypid(); putenv('SITE_DATA=' . $TMP);
$BASE = getenv('HTM_BASE') ?: 'http://127.0.0.1:8099';
Cfg::set(['app_url' => 'https://teplo.example/', 'htm_cab_base' => $BASE]);
$pass = 0; $fail = 0;
function ok(string $n, bool $c, $info = null): void { global $pass, $fail; echo ($c ? '  OK  ' : ' FAIL ') . $n . (!$c && $info !== null ? '  → ' . json_encode($info, JSON_UNESCAPED_UNICODE) : '') . "\n"; $c ? $pass++ : $fail++; }
function stand(string $body): void { global $BASE; $ch = curl_init($BASE . '/stand/admin'); curl_setopt_array($ch, [CURLOPT_POST => 1, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => 1]); curl_exec($ch); curl_close($ch); }
stand('act=reset'); stand('act=set&scenario=ok&today=2026-11-10&robot_delay=0&spr=');

$V = ['date' => '10.11.2026', 'energy' => '14.445', 'volume' => '2332,676', 'flow' => '0.063', 'power' => '1.5', 'tSupply' => '50.12', 'tReturn' => '30.4', 'hours' => '35078', 'errHours' => '153', 'errCode' => 'E---'];
$C = ['phone' => '+380501112233', 'email' => 'test@stand.local', 'note' => ''];

$h = new HtmCab();
try { $h->login('test@stand.local', 'wrong-pass'); ok('неверный пароль → bad_login', false); } catch (CabErr $e) { ok('неверный пароль → bad_login', $e->err === 'bad_login', $e->site); }
$h = new HtmCab(); $home = $h->login('test@stand.local', 'stand-pass-123'); ok('вход по email и паролю', str_contains($home['body'], '/cabinet/logout'));
$acc = $h->accounts($home); ok('особовий рахунок найден', ($acc[0]['acc'] ?? '') === '1000000061' && mb_strtoupper($acc[0]['sur'] ?? '') === 'ТЕСТОВИЙ', $acc);
$p = $h->heat($acc[0]['acc'], $acc[0]['sur']);
ok('прибор и номер из заголовка', ($p['meter']['model'] ?? '') === 'Sharky 774' && ($p['meter']['serial'] ?? '') === '70000061', $p['meter']);
ok('последние принятые (head_*)', ($p['base']['energy'] ?? '') === '13.245' && ($p['base']['hours'] ?? '') === '34598', $p['base']);
ok('форма открыта 10-го, есть min/max', $p['open'] && $p['min'] && $p['max'], [$p['open'], $p['min'], $p['max']]);
$r = $h->save($acc[0]['acc'], $acc[0]['sur'], $V, $C);
ok('сохранено, в журнале строка нашей даты', in_array($r['status'], ['pending', 'ok'], true), $r);
$h2 = new HtmCab(); $h2->login('test@stand.local', 'stand-pass-123'); stand('act=robot');
$row = HtmCab::find($h2->heat($acc[0]['acc'], $acc[0]['sur'])['journal'], '10.11.2026', '14.445');
ok('робот ХТМ принял → ok', ($row['status'] ?? '') === 'ok', $row);
// робот отклонил: энергия меньше прошлой
stand('act=reset'); stand('act=set&scenario=ok&today=2026-11-10&robot_delay=0');
$h = new HtmCab(); $h->login('test@stand.local', 'stand-pass-123');
$bad = ['energy' => '13.100'] + $V; $r = $h->save('1000000061', 'Тестовий', $bad, $C); stand('act=robot');
$h2 = new HtmCab(); $h2->login('test@stand.local', 'stand-pass-123'); $row = HtmCab::find($h2->heat('1000000061', 'Тестовий')['journal'], '10.11.2026', '13.100');
ok('робот ХТМ отклонил → rejected с причиной', ($row['status'] ?? '') === 'rejected' && ($row['reason'] ?? '') !== '', $row);
// окно закрыто
stand('act=reset'); stand('act=set&scenario=ok&today=2026-11-27&robot_delay=0');
$h = new HtmCab(); $h->login('test@stand.local', 'stand-pass-123');
try { $h->save('1000000061', 'Тестовий', ['date' => '27.11.2026'] + $V, $C); ok('27-го форма закрыта → closed', false); } catch (CabErr $e) { ok('27-го форма закрыта → closed', $e->err === 'closed' && str_contains($e->site, 'тимчасово'), [$e->err, $e->site]); }
// разметка изменилась — ничего не шлём
stand('act=reset'); stand('act=set&scenario=markup_changed&today=2026-11-10&robot_delay=0');
$h = new HtmCab(); $h->login('test@stand.local', 'stand-pass-123');
try { $h->save('1000000061', 'Тестовий', $V, $C); ok('другие имена полей → form_changed, без отправки', false); } catch (CabErr $e) { ok('другие имена полей → form_changed, без отправки', $e->err === 'form_changed', $e->site); }
// капча
stand('act=reset'); stand('act=set&scenario=captcha&today=2026-11-10&robot_delay=0');
try { (new HtmCab())->login('test@stand.local', 'stand-pass-123'); ok('капча → captcha (не обходим)', false); } catch (CabErr $e) { ok('капча → captcha (не обходим)', $e->err === 'captcha', $e->err); }
// сайт лёг
stand('act=reset'); stand('act=set&scenario=server_500&today=2026-11-10&robot_delay=0');
try { (new HtmCab())->login('test@stand.local', 'stand-pass-123'); ok('500 → down', false); } catch (CabErr $e) { ok('500 → down', $e->err === 'down', $e->err); }
// постоянные плашки сайта (красный баннер, подсказка help-block у даты) и журнал, который обновляется не сразу:
// после отправки — «на перевірці» (unseen), а не form_error из-за баннера, что был на странице и до отправки
stand('act=reset'); stand('act=set&scenario=banners&today=2026-11-10&robot_delay=1200');
$h = new HtmCab(); $h->login('test@stand.local', 'stand-pass-123');
try { $r = $h->save('1000000061', 'Тестовий', $V, $C); ok('плашки сайта до отправки — не ошибка: pending, unseen, flash — «збережено»', $r['status'] === 'pending' && !empty($r['unseen']) && str_contains($r['flash'], 'збережено'), $r); }
catch (CabErr $e) { ok('плашки сайта до отправки — не ошибка: pending, unseen, flash — «збережено»', false, [$e->err, $e->site]); }
stand('act=reset'); stand('act=set&scenario=banners&today=2026-11-10&robot_delay=0');
$h = new HtmCab(); $h->login('test@stand.local', 'stand-pass-123');
try { $h->save('1000000061', 'Тестовий', $V, ['phone' => ''] + $C); ok('настоящая ошибка при плашках → form_error словами сайта, без баннера', false); }
catch (CabErr $e) { ok('настоящая ошибка при плашках → form_error словами сайта, без баннера', $e->err === 'form_error' && str_contains($e->site, 'телефон') && !str_contains($e->site, 'пароль'), [$e->err, $e->site]); }
stand('act=reset'); stand('act=set&scenario=ok');
// пароли
$e = CabVault::enc('секрет-пароль'); ok('пароль шифруется и расшифровывается', $e !== 'секрет-пароль' && CabVault::dec($e) === 'секрет-пароль' && is_file(CabVault::keyFile()));
ok('испорченный шифр → null', CabVault::dec('g1:' . base64_encode(random_bytes(40))) === null);
// телефон — по подсказке формы (живой кабинет: «(067) ***-**-45»), дата окна — в дд.мм.рррр
ok('телефон по подсказке «(0XX) ***-**-XX» → «(050) 111-22-33»', HtmCab::phoneFor('+380501112233', '(067) ***-**-45') === '(050) 111-22-33' && HtmCab::phoneFor('0501112233', '(___)___-__-__') === '(050)111-22-33');
ok('без подсказки и чужой номер — как есть', HtmCab::phoneFor('+380501112233', '') === '+380501112233' && HtmCab::phoneFor('+48123456789', '(067) ***-**-45') === '+48123456789');
ok('окно дат: «2026-11-05» и «5.11.2026» → 05.11.2026', HtmCab::dmy('2026-11-05') === '05.11.2026' && HtmCab::dmy('5.11.2026') === '05.11.2026');

// осмотр кабинета (как живой 07.11): главная → «Сформувати рахунок» — HTML-страница «Рахунок за вересень 2026 року», PDF нет; без рахунку, прізвища и цифр
stand('act=reset'); stand('act=set&scenario=ok&today=2026-11-10&robot_delay=0&bill_ym=&bill_pay=');
$h = new HtmCab(); $home = $h->login('test@stand.local', 'stand-pass-123'); $acc = $h->accounts($home); $p = $h->heat($acc[0]['acc'], $acc[0]['sur']);
$ex = $h->explore([$h->home['url'] => $h->home['body'], $p['url'] => $p['html']], $acc[0]['acc'], $acc[0]['sur']); unset($ex['billBody'], $ex['billRaw']);
$ej = json_encode($ex, JSON_UNESCAPED_UNICODE); $pp = array_column($ex['pages'], 'p'); $tr = array_column($ex['tried'] ?? [], 'p');
ok('осмотр: главная, тепло, карточка рахунку и «Архів платежів» (+ довідка); «Сформувати рахунок» — HTML, не PDF', in_array('/cabinet/{acc}/{sur}', $pp, true) && in_array('/cabinet/payments/{acc}/{sur}', $pp, true)
  && in_array('/cabinet/spravka/{acc}/{sur}', $pp, true) && in_array('/cabinet/bill/print/{acc}/{sur}', $tr, true) && $ex['bill'] === null, $ex);
$strs = []; array_walk_recursive($ex, function ($v) use (&$strs) { if (is_string($v)) $strs[] = $v; });
ok('…в осмотре нет рахунку, прізвища и цифр', !preg_match('/1000000061|ТЕСТОВИЙ|Тестовий|\d/u', str_replace('windows-1251', '', implode(' ', $strs))), $ej);
$bp = $h->billPage($acc[0]['acc'], $acc[0]['sur']);
ok('рахунок: по ссылке «Сформувати рахунок» (не ?hint=pdf) — месяц из заголовка 2026-09, до сплати 245.30', ($bp['ym'] ?? '') === '2026-09' && ($bp['pay'] ?? '') === '245.30' && str_contains((string)($bp['url'] ?? ''), '/cabinet/bill/print/') && !str_contains((string)$bp['url'], 'hint'), $bp ? array_diff_key($bp, ['html' => 1, 'text' => 1]) : null);
$bd = $h->billDoc($bp);
ok('…копия: стиль и картинка сайта внутри, без скриптов/кнопок/ссылок', $bd['css'] >= 1 && $bd['img'] === 1 && !preg_match('/<script|onclick|<button|href=|Друкувати/iu', $bd['html']) && str_contains($bd['html'], 'Рахунок за послуги за вересень 2026'), [$bd['css'], $bd['img']]);
$sp = $h->sprTeplo($acc[0]['acc'], $acc[0]['sur']); $r1 = $sp['rows'][1] ?? [];
ok('«Довідка по теплу» (как живая: заголовки 07.11): 6 місяців, колонки за текстом; листопад 2025: різниця 0,750, втрати 180,4, витрата 2,042 (+ частка втрат 180,4 × 56,6 / 7902,8), абонплата 29,40',
  count($sp['rows'] ?? []) === 6 && ($r1['ym'] ?? '') === '2025-11' && abs(($r1['diff'] ?? 0) - 0.75) < 1e-9 && abs(($r1['loss'] ?? 0) - 180.4) < 1e-9 && ($r1['sHouse'] ?? 0) == 7902.8 && ($r1['sFlat'] ?? 0) == 56.6
  && abs(($r1['flat'] ?? 0) - 2.042) < 1e-9 && abs(($r1['cost'] ?? 0) - 3143.66) < 0.011 && ($r1['abon'] ?? 0) == 29.4 && array_key_exists('paid', $sp['rows'][5] ?? []) && $sp['rows'][5]['paid'] === null && count($sp['cols']) === 14 && ($sp['fmt']['ym'] ?? '') === '##.####', $sp);
$sp2 = HtmCab::parseSpr('<table><tr><th>Абонентна плата, грн.</th><th>Місяць, рік</th><th>Витрата по квартирі, Гкал</th><th>Нараховано за пп т/е, грн.</th></tr><tr><td>29,40</td><td>Листопад 2025</td><td>0,812</td><td>1 250,07</td></tr><tr><td></td><td>Разом</td><td>9</td><td>9</td></tr></table>');
ok('…колонки в другом порядке, месяц словом, «1 250,07» → 1250.07; строка «Разом» — не месяц', count($sp2['rows']) === 1 && $sp2['rows'][0]['ym'] === '2025-11' && $sp2['rows'][0]['cost'] == 1250.07 && $sp2['rows'][0]['abon'] == 29.4, $sp2);
ok('monthOf: «Рахунок за вересень 2026 року» → 2026-09, «грудень 2025» → 2025-12', HtmCab::monthOf('Рахунок за вересень 2026 року') === '2026-09' && HtmCab::monthOf('за грудень 2025') === '2025-12');
// живой кабинет 08.11: в довідці — будинковий лічильник; витрата квартири = свій лічильник (журнал «Всі записи») + частка будинку
stand('act=set&scenario=ok&today=2026-11-10&robot_delay=0&spr=house');
$h3 = new HtmCab(); $h3->login('test@stand.local', 'stand-pass-123'); $hp = $h3->heat($acc[0]['acc'], $acc[0]['sur']); $own = $h3->ownJournal($hp, $acc[0]['acc'], $acc[0]['sur']);
ok('журнал свого лічильника — «Всі записи»: минулий сезон (7 прийнятих + 1 відхилена) і нові, по даті, Гкал числом', count($own) >= 8 && $own[0]['date'] === '2025-09-26' && $own[0]['energy'] == 8.9
  && count(array_filter($own, fn($r) => $r['status'] === 'rejected')) === 1 && count(array_filter($own, fn($r) => $r['status'] === 'ok')) >= 7, $own);
$sh = $h3->sprTeplo($acc[0]['acc'], $acc[0]['sur']); require_once __DIR__ . '/../app/htmsvc.php';
$fit = HtmSpr::ownFit($sh['rows'], $own); $hj = json_encode($fit, JSON_UNESCAPED_UNICODE);
ok('формула ХТМ із довідки й журналу: найкраще — свій лічильник + втрати × S_кв/S_буд (похибка ~0 %), кінець місяця — показання в цьому місяці; відхилені не беремо; без чисел людей',
  ($fit['best']['hyp'] ?? '') === 'own+loss*s' && ($fit['best']['al'] ?? '') === 'same' && ($fit['best']['err'] ?? 99) < 0.1 && ($fit['al']['same']['months'] ?? 0) === 6
  && ($fit['al']['same']['ratio']['loss*s']['cv'] ?? 99) < 0.5 && ($fit['al']['same']['hyp']['own'] ?? 0) > 5 && !preg_match('/energy|date|3012\.5|512\.1|56\.6|12\.15/', $hj), $fit);
// 60-я: живой журнал — 13 записей, но с пропусками месяцев: сусідніх місяців у довідці лише 1 → сравниваем по проміжках між показаннями (через пропуски до 4 міс.)
$sB = 56.6 / 5700; $hB = ['2025-11' => 40.0, '2025-12' => 46.0, '2026-01' => 49.0, '2026-02' => 28.0, '2026-03' => 11.0]; $eB = ['2025-11' => 0.5, '2025-12' => 1.0, '2026-01' => 1.4, '2026-02' => 1.3, '2026-03' => 0.9];
$mkRows = function (callable $v) use ($sB, $hB, $eB) { $o = [['ym' => '2025-10', 'flat' => 0.05, 'cost' => 77.0, 'abon' => 29.4, 'sFlat' => 56.6]];
  foreach ($hB as $m => $h) { $fl = round($v($eB[$m], $h * $sB), 5); $o[] = ['ym' => $m, 'diff' => $h, 'house' => $h, 'loss' => ['2025-11' => 5.0, '2025-12' => 4.2, '2026-01' => 3.6, '2026-02' => 3.9, '2026-03' => 2.2][$m], 'sHouse' => 5700.0, 'sFlat' => 56.6, 'flat' => $fl, 'cost' => round($fl * 1539.5, 2), 'abon' => 29.4, 'lgota' => null]; } return $o; };
$jB = [['2025-10-20', 10.0], ['2025-12-15', 11.5], ['2026-01-15', 12.9], ['2026-02-02', 50.0, 'rejected'], ['2026-03-14', 15.1], ['2026-04-15', 15.2]];
$jB = array_map(fn($r) => ['date' => $r[0], 'energy' => $r[1], 'status' => $r[2] ?? 'ok'], $jB);
$fB = HtmSpr::ownFit($mkRows(fn($e, $hs) => $e + 1.1 * $hs), $jB); $sm = $fB['al']['same'] ?? [];
ok('журнал с пропусками: проміжки листопад–грудень, січень, лютий–березень (3 проміжки, 5 місяців; квітня в довідці нема) → формула «своє + 1,1 × будинок × S_кв/S_буд» перевіркою без себе (~0 %), гроші так само; «своє × (1 + k)» хуже',
  ($sm['iv'] ?? 0) === 3 && ($sm['months'] ?? 0) === 5 && ($fB['model']['al'] ?? '') === 'same' && ($fB['model']['basis'] ?? '') === 'house*s' && ($fB['model']['err'] ?? 99) < 0.1
  && ($fB['model']['money'] ?? 99) < 0.2 && ($sm['loo']['own'] ?? 0) > 3 && ($sm['ratio']['house*s']['cv'] ?? 99) < 0.1, $fB);
// 66-я: як hsprCalib у браузері — підбір частки понад свій лічильник беремо, лише якщо він схожий на ЗБП (≤ 0,0006 Гкал/м² чи ≤ 5 % свого тепла)
$zA = $fB['zbp'] ?? []; $fZ = HtmSpr::ownFit($mkRows(fn($e, $hs) => $e + 0.00025 * 56.6), $jB); $zZ = $fZ['zbp'] ?? [];
ok('ownFit → zbp: «своє + 1,1 × будинок» — не ЗБП (use m2, далі 0,00025 × площа); «своє + 0,00025 × 56,6» — ЗБП на м² (basis area, perM2 0,00025, use fit)',
  ($zA['ok'] ?? null) === false && ($zA['use'] ?? '') === 'm2' && ($zA['m2'] ?? 0) == 0.00025
  && ($zZ['basis'] ?? '') === 'area' && abs(($zZ['perM2'] ?? 0) - 0.00025) < 0.00001 && ($zZ['ok'] ?? null) === true && ($zZ['use'] ?? '') === 'fit', [$zA, $zZ]);
// 61-я: живая довідка — «Площа будинку» в листопаді й січні двозначна (як квартира): без поправки S ≈ 1 и основа «будинок × S» разваливается
$odd = $mkRows(fn($e, $hs) => $e + 1.1 * $hs); foreach ($odd as &$r0) if (in_array($r0['ym'], ['2025-11', '2026-01'], true)) $r0['sHouse'] = 48.3; unset($r0);
$ck = HtmSpr::check($odd, $jB); $fx = $ck['own']['model'] ?? [];
ok('площа будинку меньше трёх квартир (описка ХТМ, 2 месяца) → медиана остальных: area.fixed = листопад, січень; основа снова «будинок × S» с ошибкой < 0,1 %; toFlat без ×100',
  ($ck['area']['fixed'] ?? []) === ['2025-11', '2026-01'] && ($ck['area']['cv'] ?? 99) < 0.1 && ($fx['basis'] ?? '') === 'house*s' && ($fx['err'] ?? 99) < 0.1
  && ($ck['toFlat']['2025-11']['house*s'] ?? 99) < 2 && isset($ck['own']['al']['same']['ivs'][0]['own%']), [$ck['area'] ?? null, $fx, $ck['toFlat']['2025-11'] ?? null]);
HtmSpr::save(77, 'p1', ['rows' => array_slice($mkRows(fn($e, $hs) => $e), 0, 4), 'cols' => ['ym', 'flat'], 'fmt' => []]);
HtmSpr::save(77, 'p1', ['rows' => [['ym' => '2026-01', 'flat' => 9.9], ['ym' => '2026-10', 'flat' => 0.3]], 'cols' => ['ym', 'flat'], 'fmt' => []]);
$mn = HtmSpr::mine(77)[0]['rows'] ?? [];
ok('довідка копит месяцы между сезонами: старые остаются, свежая строка месяца — поверх', array_column($mn, 'ym') === ['2025-10', '2025-11', '2025-12', '2026-01', '2026-10'] && $mn[3]['flat'] == 9.9, array_column($mn, 'ym'));
$fC = HtmSpr::ownFit($mkRows(fn($e, $hs) => $e * 1.2), $jB);
ok('…а если ХТМ берёт процент от свого тепла — «own» (k = 20 %), без чисел людей', ($fC['model']['basis'] ?? '') === 'own' && ($fC['model']['err'] ?? 99) < 0.1
  && !preg_match('/energy|date|5700|56\.6/', json_encode($fC)), $fC);
stand('act=set&scenario=ok&today=2026-11-10&robot_delay=0&spr=');
// квитанція (копія рахунку, як живий 07.11) против довідки: нараховано, абонплата, «до сплати − борг» = «Разом»; рахунок за інший місяць — видно зсув
$bh = fn($debt, $cost, $ab, $pay) => '<html><body><p>Особовий рахунок 1000000061, ТЕСТОВИЙ</p><table class="t"><tr><td>-ПЕРЕПЛАТА/+БОРГ за послугу з постачання: теплової енергії</td><td>' . $debt . '</td></tr>'
  . '<tr><td>Нараховано за послугу, грн</td><td>' . $cost . '</td></tr><tr><td>Нараховано плати за абонентське обслуговування, грн</td><td>' . $ab . '</td></tr><tr class="sum"><td><b>ДО СПЛАТИ</b></td><td><b>' . $pay . '</b></td></tr>'
  . '<tr><td>Рахунок № 1000000061</td><td>1000000061</td></tr></table></body></html>';
$bl1 = HtmSpr::billLines($bh('100.00', '3 783,51', '29.40', '3912.91')); $bk1 = HtmSpr::billKeys($bl1);
$sr = [['ym' => '2026-01', 'cost' => 3783.51, 'abon' => 29.4, 'lgota' => 0], ['ym' => '2026-02', 'cost' => 3000.0, 'abon' => 29.4]];
$bc = HtmSpr::billCheck($sr, ['2026-01' => $bk1, '2026-03' => HtmSpr::billKeys(HtmSpr::billLines($bh('-50', '3000.00', '29.40', '2979.40')))]);
ok('квитанція → рядки (мітки без цифр) і ключі: борг, нараховано, абонплата, до сплати; против довідки — січень збігся (0 %), березень = довідка лютого (prev), лише відсотки',
  ($bk1['debt'] ?? null) === 100.0 && ($bk1['cost'] ?? null) === 3783.51 && ($bk1['abon'] ?? null) === 29.4 && ($bk1['pay'] ?? null) === 3912.91 && !preg_match('/\d/u', implode(' ', array_column($bl1, 0)))
  && ($bc['err']->{'2026-01'}['same'] ?? null) === ['cost' => 0.0, 'abon' => 0.0, 'pay' => 0.0] && ($bc['err']->{'2026-03'}['prev']['cost'] ?? null) === 0.0 && ($bc['err']->{'2026-03'}['prev']['pay'] ?? null) === 0.0
  && HtmSpr::gw('Іваненко Петро, вул. Сумська, 10') === 'Ж Ж, Ж. Ж, ##' && HtmSpr::gw('-ПЕРЕПЛАТА/+БОРГ за послугу з постачання: теплової енергії') === '-ПЕРЕПЛАТА/+БОРГ за послугу з постачання: теплової енергії'
  && count(HtmSpr::billShape($bh('0', '1', '2', '3'))['rows'] ?? []) === 5 && !preg_match('/ТЕСТОВИЙ|1000|Ж/u', json_encode(HtmSpr::billShape($bh('0', '1', '2', '3')), JSON_UNESCAPED_UNICODE))
  && $bc['ok'] === ['same' => 1, 'prev' => 1, 'next' => 0] && $bc['months'] === ['2026-01', '2026-03'] && !preg_match('/3783|3912|ТЕСТОВИЙ/u', json_encode($bc, JSON_UNESCAPED_UNICODE)), [$bl1, $bk1, $bc]);
// живий формат рахунку (будова з бою 08.11): колонки з colspan/rowspan, рядок «донараховано до кінця поточного місяця», гаряча вода, ДО СПЛАТИ
$lv = '<table><tr><td><table><tr><td>Послуги з постачання</td><td colspan="2">Тариф</td><td>Витрата по ліч/кв</td><td>Кількість к/в</td><td>Нараховано за послугу, грн.</td><td>Пільга (х), грн.</td>'
  . '<td colspan="2">Нараховано плати за абонентське обслуговування</td><td>-Переплата / +борг на 1 вересня 2026, грн.</td><td>Оплачено у вересні 2026, грн.</td><td>Нараховано за місяць, грн.10=5-6+7</td><td>Перерахунки за минулі періоди, грн.</td>'
  . '<td>Нараховано всього, грн.</td><td colspan="2">-Переплата / +борг на 1 жовтня 2026, грн12=8-9+11</td></tr>'
  . '<tr><td rowspan="2">теплової енергії</td><td colspan="2">1539.50 грн/Гкал</td><td>-</td><td>-</td><td>3783.51</td><td>0.00</td><td colspan="2">29.40</td><td>100.00</td><td>100.00</td><td>3812.91</td><td>0.00</td><td rowspan="2">3812.91</td><td rowspan="2">3812.91</td></tr>'
  . '<tr><td colspan="4">донараховано до кінця поточного місяця</td><td>500.00</td><td colspan="6">знято нарахування до кінця попереднього місяця</td><td>400.00</td></tr>'
  . '<tr><td>гарячої води</td><td colspan="2">120.10 грн/м3</td><td>2</td><td></td><td>240.20</td><td>0.00</td><td colspan="2">12.00</td><td>0.00</td><td>0.00</td><td>252.20</td><td>0.00</td><td>252.20</td><td>252.20</td></tr></table></td></tr>'
  . '<tr><td colspan="2">ДО СПЛАТИ</td><td colspan="2">4065.11 грн.</td><td colspan="9">( послуга з постачання теплової енергії 3812.91</td></tr></table>';
$lt = HtmSpr::billTable($lv); $lc = HtmSpr::billCheck([['ym' => '2026-09', 'cost' => 3783.51, 'abon' => 29.4, 'lgota' => 0]], ['2026-09' => ($lt['heat'] ?? []) + ['pre' => $lt['pre'] ?? null, 'unpre' => $lt['unpre'] ?? null]]);
ok('живий рахунок: тепло — нараховано, пільга, абонплата, борг, оплачено, за місяць, всього; донараховано/знято; ГВ; ДО СПЛАТИ; против довідки: нараховано 0 %, «за місяць» = «Разом» 0 %, донарахування +2,6 %',
  ($lt['heat'] ?? null) === ['cost' => 3783.51, 'lgota' => 0.0, 'abon' => 29.4, 'debt' => 100.0, 'paid' => 100.0, 'month' => 3812.91, 'recalc' => 0.0, 'total' => 3812.91, 'end' => 3812.91]
  && ($lt['pre'] ?? null) === 500.0 && ($lt['unpre'] ?? null) === 400.0 && ($lt['hot']['month'] ?? null) === 252.2 && ($lt['pay'] ?? null) === 4065.11
  && ($lc['err']->{'2026-09'}['same'] ?? null) === ['cost' => 0.0, 'abon' => 0.0, 'month' => 0.0, 'pre%' => 2.6], [$lt, $lc]);
// 66-я: у запис квитанції — те, що пояснює «до сплати» (тепло наперед, зняте за попередній, за місяць тепло й ГВ) — рядками з двома знаками
$bpz = HtmSvc::billParts($lt);
ok('billParts живого рахунку: pre 500.00, unpre 400.00, heatM 3812.91, hotM 252.20 (у запис квитанції — для пояснення «з них наперед»)',
  $bpz === ['pre' => '500.00', 'unpre' => '400.00', 'heatM' => '3812.91', 'hotM' => '252.20'] && HtmSvc::billParts([]) === [], $bpz);
$bad = array_filter(array_column(array_slice($h->w->steps, 0), 1), fn($x) => preg_match('~logout|/add|remove|settings~', $x));
ok('…только GET и не трогает add/remove/settings', !array_filter($h->w->steps, fn($s) => $s[0] !== 'GET' && !str_contains($s[1], '/cabinet/login')) && !$bad, $h->w->steps);

// живой кабинет 06.11 22:14: новое соединение на /cabinet/list не установилось за 6 с → «сайт не відповідає», хотя вход прошёл
$n = 0; CabWeb::$http = function ($m, $u, $b, $c, $h) use (&$n) { $n++; return $n === 1 ? ['code' => 0, 'body' => '', 'err' => 'Connection timed out after 6001 milliseconds'] : ['code' => 200, 'body' => 'ok']; };
$w = new CabWeb('/^x\.test$/i'); $r = $w->req('GET', 'https://x.test/a');
ok('GET не соединился — ещё раз; в шагах видно ошибку сети', $r['code'] === 200 && count($w->steps) === 2 && str_contains((string)($w->steps[0][4] ?? ''), 'timed out'), $w->steps);
$n = 0; $w = new CabWeb('/^x\.test$/i'); $r = $w->req('POST', 'https://x.test/a', 'x=1');
ok('POST не соединился — не повторяем (мог сохраниться)', $r['code'] === 0 && count($w->steps) === 1, $w->steps);
CabWeb::$http = fn($m, $u, $b, $c, $h) => str_contains($u, '/cabinet/list') ? ['code' => 0, 'body' => '', 'err' => 'Connection timed out'] : ['code' => 200, 'body' => '<html></html>'];
$acc = (new HtmCab())->accounts(['body' => '<a href="/cabinet/heat/1000000061/%D0%A2%D0%95%D0%A1%D0%A2%D0%9E%D0%92%D0%98%D0%99">Тепло</a>']);
ok('/cabinet/list не ответил, рахунок есть на главной — берём его', ($acc[0]['acc'] ?? '') === '1000000061' && ($acc[0]['sur'] ?? '') === 'ТЕСТОВИЙ', $acc);
try { (new HtmCab())->accounts(['body' => '<html>без рахунків</html>']); ok('…на главной рахунків нет — честно «сайт не відповідає»', false); } catch (CabErr $e) { ok('…на главной рахунків нет — честно «сайт не відповідає»', $e->err === 'down', $e->err); }
CabWeb::$http = null;
echo "\nИтог: $pass OK, $fail FAIL\n"; exit($fail ? 1 : 0);
