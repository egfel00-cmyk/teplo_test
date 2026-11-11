<?php
// Стенд «Кабінет споживача» КП на ASP.NET WebForms — як debt.crewingcrm.com/brovk (Бровари, 105-а): списки «населений пункт → вулиця → будинок»
// з автопостбеком (__doPostBack у onchange), квартира, особовий рахунок → «Пошук» → таблиця показань (GridView, без підписів у полях) → «Зберегти показники».
// Без __VIEWSTATE / __EVENTVALIDATION або зі значенням не зі списку — 500, як справжній ASP.NET. Дві кнопки разом — теж 500 (так ловимо зайву кнопку).
// lb_aspx(метод, POST, &стан) → [код, html]. Стан: hop — після пошуку спершу сторінка абонента з посиланням-postback «Передати показники»;
// last — що прийшло зі «Зберегти». Рахунок 1234567: Бровари, вул. Київська, 11-А, кв. 12 (лічильники № 1234567 холодна, № 7654321 гаряча).
function lb_aspx(string $m, array $P, array &$st): array {
  $N = 'ctl00$MainContent$';
  $SET = ['0' => 'БРОВАРИ', '1' => 'КВІТНЕВЕ'];
  $STR = ['0' => ['33' => 'БАНДЕРИ СТЕПАНА', '56' => 'КИЇВСЬКА', '157' => 'ПРОВ.ВІДРОДЖЕННЯ', '124' => 'ВІДРОДЖЕННЯ', '208' => 'ВУЛ 999,'], '1' => ['4' => 'АВIАЦIЙНА']];
  $DOM = ['56' => ['23080' => '6', '23953' => '11-А', '23999' => '16/2'], '33' => ['100' => '1'], '157' => ['101' => '6'], '124' => ['102' => '6'], '4' => ['103' => '6'], '208' => ['104' => '1']];
  $KV = ['23953' => array_combine(array_map(fn($i) => (string)(5000 + $i), range(1, 40)), array_map('strval', range(1, 40)))];
  $r = $u = $d = $k = $ls = ''; $view = 'search';
  if ($m === 'POST') {
    if (($P['__VIEWSTATE'] ?? '') !== 'VS1' || ($P['__EVENTVALIDATION'] ?? '') !== 'EV1') return [500, '<h1>Validation of viewstate MAC failed.</h1>'];
    $g = fn(string $n) => trim((string)($P[$N . $n] ?? ''));
    $r = $g('DropDownListRAYON'); $u = $g('DropDownListULITSA'); $d = $g('DropDownListDOM'); $k = $g('DropDownListKVART'); $ls = $g('TextBoxLS');
    $et = (string)($P['__EVENTTARGET'] ?? '');
    if ($et === $N . 'DropDownListRAYON') $u = $d = $k = ''; elseif ($et === $N . 'DropDownListULITSA') $d = $k = ''; elseif ($et === $N . 'DropDownListDOM') $k = '';
    if (($r !== '' && !isset($SET[$r])) || ($u !== '' && !isset($STR[$r][$u])) || ($d !== '' && !isset($DOM[$u][$d])) || ($k !== '' && !isset($KV[$d][$k])))
      return [500, '<h1>Invalid postback or callback argument.</h1>'];
    if (isset($P[$N . 'ButtonSave'])) {
      if (isset($P[$N . 'ButtonSearch'])) return [500, '<h1>Дві кнопки в одному запиті</h1>'];
      $st['last'] = ['ls' => $ls, 'r' => $r, 'u' => $u, 'd' => $d, 'k' => $k] + array_filter($P, fn($n) => str_contains((string)$n, 'TextBoxPOK'), ARRAY_FILTER_USE_KEY);
      $view = 'ok';
    } elseif (isset($P[$N . 'ButtonSearch'])) {
      $view = $r === '0' && $u === '56' && $d === '23953' && $k === '5012' && $ls === '1234567' ? (!empty($st['hop']) ? 'abon' : 'pok') : 'nf';
    } elseif ($et === $N . 'LinkButtonPOK') $view = 'pok';
  }
  $o = function (array $list, string $sel): string { $h = '<option value=""></option>'; foreach ($list as $v => $t) $h .= '<option' . ((string)$v === $sel ? ' selected="selected"' : '') . ' value="' . $v . '">' . htmlspecialchars((string)$t) . '</option>'; return $h; };
  $auto = fn(string $n) => ' onchange="javascript:setTimeout(&#39;__doPostBack(\&#39;' . $N . $n . '\&#39;,\&#39;\&#39;)&#39;, 0)"';
  $h = '<!DOCTYPE html><html><head><title>КП "Броваритепловодоенергія"</title></head><body><form method="post" action="./" id="form1">'
    . '<input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value=""><input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value=""><input type="hidden" name="__LASTFOCUS" value="">'
    . '<input type="hidden" name="__VIEWSTATE" value="VS1"><input type="hidden" name="__VIEWSTATEGENERATOR" value="CA0B0334"><input type="hidden" name="__EVENTVALIDATION" value="EV1"><input type="hidden" name="ctl00$HiddenFieldMES" value="">'
    . '<script>function __doPostBack(t, a) { var f = document.forms[0]; f.__EVENTTARGET.value = t; f.__EVENTARGUMENT.value = a; f.submit(); }</script>'
    . '<div class="head">КП "БРОВАРИТЕПЛОВОДОЕНЕРГІЯ" розрахунковий період: Листопад 2026 р.</div><div>Кабінет споживача</div><div>Введіть адресу і особовий рахунок (усі поля обов\'язкові):</div>'
    . '<table><tr><td><label for="MainContent_DropDownListRAYON">Населений пункт:</label><br><select name="' . $N . 'DropDownListRAYON" id="MainContent_DropDownListRAYON"' . $auto('DropDownListRAYON') . '>' . $o($SET, $r) . '</select></td>'
    . '<td><label for="MainContent_DropDownListULITSA">Вулиця:</label><br><select name="' . $N . 'DropDownListULITSA" id="MainContent_DropDownListULITSA"' . $auto('DropDownListULITSA') . '>' . $o($STR[$r] ?? [], $u) . '</select></td>'
    . '<td><label for="MainContent_DropDownListDOM">Будинок:</label><br><select name="' . $N . 'DropDownListDOM" id="MainContent_DropDownListDOM"' . $auto('DropDownListDOM') . '>' . $o($DOM[$u] ?? [], $d) . '</select></td>'
    . '<td><label for="MainContent_DropDownListKVART">Квартира:</label><br><select name="' . $N . 'DropDownListKVART" id="MainContent_DropDownListKVART">' . $o($KV[$d] ?? [], $k) . '</select></td>'
    . '<td><label for="MainContent_TextBoxLS">Особовий рахунок:</label><br><input name="' . $N . 'TextBoxLS" type="text" value="' . htmlspecialchars($ls) . '" maxlength="15" id="MainContent_TextBoxLS"></td>'
    . '<td><input type="submit" name="' . $N . 'ButtonSearch" value="Пошук" onclick="javascript:WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(&quot;' . $N . 'ButtonSearch&quot;, &quot;&quot;, true, &quot;&quot;, &quot;&quot;, false, false))"></td></tr></table>';
  if ($view === 'nf') $h .= '<span id="MainContent_LabelERR" style="color:Red;">Особовий рахунок не знайдено!</span>';
  if ($view === 'abon') $h .= '<p>Абонент: о/р ' . htmlspecialchars($ls) . '. Борг на 01.11.2026: 12,50 грн</p><a id="MainContent_LinkButtonPOK" href="javascript:__doPostBack(&#39;' . $N . 'LinkButtonPOK&#39;,&#39;&#39;)">Передати показники</a>';
  if ($view === 'pok') $h .= '<p>Абонент: о/р ' . htmlspecialchars($ls) . '</p><table id="MainContent_GridViewPOK"><tr><th>Послуга</th><th>Лічильник</th><th>Попередні</th><th>Поточні показники</th></tr>'
    . '<tr><td>Холодна вода</td><td>1234567</td><td>400</td><td><input name="' . $N . 'GridViewPOK$ctl02$TextBoxPOK" type="text" id="MainContent_GridViewPOK_TextBoxPOK_0"></td></tr>'
    . '<tr><td>Гаряча вода</td><td>7654321</td><td>150</td><td><input name="' . $N . 'GridViewPOK$ctl03$TextBoxPOK" type="text" id="MainContent_GridViewPOK_TextBoxPOK_1"></td></tr></table>'
    . '<input type="submit" name="' . $N . 'ButtonSave" value="Зберегти показники">';
  if ($view === 'ok') $h .= '<span id="MainContent_LabelMES" style="color:Green;">Показники прийнято. Дякуємо!</span>';
  return [200, $h . '<div>Наш Viber bot</div></form></body></html>'];
}
