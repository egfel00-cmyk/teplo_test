<?php
// «Робот ХТМ» стенда: асинхронная проверка сохранённых показаний по правилам памятки кабинета.
// Коды и пороги совпадают с web/src/rules.js и документом «кабинет ХТМ (снятие 01.11.2026)», §7.
declare(strict_types=1);

function robot_reason(array $r, array $prev, array $meter): ?string {
  $sn = $meter['sn']; $d = ua_date($r['date']); $pd = ua_date($prev['date']);
  $f = fn($x, $n = 3) => rtrim(rtrim(number_format((float)$x, $n, '.', ''), '0'), '.');
  if (!empty($meter['verified_until']) && $r['date'] > $meter['verified_until'])
    return "Не проведено планову повірку приладу обліку $sn, котра мала бути проведена до " . ua_date($meter['verified_until']);
  foreach (['tSupply' => 'подачі', 'tReturn' => 'повернення'] as $k => $w)
    if ((float)$r[$k] == 0.0 || $r[$k] < 5 || $r[$k] > 95) return "Значення температури $w по приладу обліку $sn на $d = " . $f($r[$k], 2) . ", хоча має бути в діапазоні від 5 до 95 градусів";
  if ($r['hours'] < $prev['hours']) return "Показання часу по приладу обліку $sn на $d 23:00 = {$r['hours']} але маєть бути більше {$prev['hours']}";
  if ($r['volume'] < $prev['volume']) return "Показання накопиченого об'єму теплоносія по приладу обліку $sn на $d 23:00 = " . $f($r['volume']) . ", але мають бути більше " . $f($prev['volume']);
  if ($r['energy'] < $prev['energy']) return "Показання теплоенергії по приладу обліку $sn на $d 23:00 = " . $f($r['energy']) . ", але мають бути більше " . $f($prev['energy']);
  if ($r['errHours'] < $prev['errHours']) return "Показання часу з помилкою по приладу обліку $sn на $d 23:00 = {$r['errHours']}, але мають бути більше {$prev['errHours']}";
  $dE = $r['energy'] - $prev['energy']; $dV = $r['volume'] - $prev['volume'];
  if ($dE >= 15) return "Для приладу обліку $sn показання накопиченої енергії на $d = " . $f($r['energy']) . ", а попередні показання рівні " . $f($prev['energy']) . ". Різниця складає " . $f($dE, 1) . " ГКал, а має бути меньше 15 ГКал";
  if ($dE > 0 && $dV == 0.0) return "Показання теплоенергії по приладу обліку $sn на $d 23:00 = " . $f($r['energy']) . " змінились по відношенню до попередніх показань теплоенергії = " . $f($prev['energy']) . ", проте показання витрати теплоносія = " . $f($r['volume'], 2) . " не змінились";
  $days = (int)((strtotime($r['date']) - strtotime($prev['date'])) / 86400); $cal = $days * 24; $dH = $r['hours'] - $prev['hours'];
  if (abs($dH - $cal) > 24) return "Період часу з $pd (не включаючи) по $d (включаючи) складає $cal годин, а по приладу обліку $sn за цей же період різниця показань часу склала $dH годин. Різниця складає " . abs($dH - $cal) . ", а має бути не більше 24";
  if ($dE > 0 && $dV > 0) {
    $dt = $dE * 1000 / $dV;
    if ($dt < 2.5) return "Розрахункова різниця температур подачі та зворотня по приладу обліку $sn за період з $pd по $d = " . $f($dt, 5) . ", хоча має бути не меньшою 2.5";
    if ($dt > 50) return "Розрахункова різниця температур подачі та зворотня по приладу обліку $sn за період з $pd по $d = " . $f($dt, 4) . ", хоча має бути не більше 50";
  }
  if ($dH > 0 && !empty($meter['qt']) && $dV / $dH < 0.3 * $meter['qt'])
    return "Розрахункова погодинна витрата по приладу обліку $sn за період з $pd по $d = " . $f($dV / $dH, 5) . ", хоча має бути не меньше 0.3-кратної Переходної витрати " . $f($meter['qt']) . " в кожний момент часу";
  return null;
}

/** Проверить все записи, у которых прошло robot_delay() секунд. Вызывается при каждом открытии страниц тепла. */
function robot_tick(bool $force = false): int {
  $s = st(); $n = 0; $now = time();
  foreach ($s['journal'] as $i => &$rec) {
    if ($rec['status'] !== 'pending') continue;
    if (!$force && $now - (int)$rec['saved_ts'] < robot_delay()) continue;
    $prev = $s['baseline'];
    for ($j = $i - 1; $j >= 0; $j--) if ($s['journal'][$j]['status'] === 'accepted') { $prev = $s['journal'][$j]; break; }
    $reason = scenario() === 'robot_reject' ? 'Прибор обліку ' . $s['meter']['sn'] . ' на ' . ua_date($rec['date']) . ' є демонтованим по причині Повірка.' : robot_reason($rec, $prev, $s['meter']);
    $rec['status'] = $reason === null ? 'accepted' : 'rejected';
    $rec['status_text'] = $reason === null ? TX('status_ok') : TX('status_bad_prefix') . $reason;
    $rec['checked_ts'] = $now; $n++;
    log_req('robot', ['date' => $rec['date'], 'status' => $rec['status']]);
  }
  unset($rec);
  if ($n) st_save($s);
  return $n;
}
