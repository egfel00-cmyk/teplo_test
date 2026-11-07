<?php
// Синтетический кабинет Водоканала (Yii2) для тестов VkCab: структура /login — как снято 04.11.2026 в Chrome владельца
// (form#no-login-form → /get-form-send-indications, _csrf-frontend, NoLoginForm[acc|fam]); форма показаний — по js/common.js сайта
// (form#send-counters-form, DynamicModel[newIndication…], DynamicModel[dataIndication…]); таблица и тексты — выдуманы.
// Используют: tests/server.php (VkCab::$http) и tests/vk-mock/router.php (php -S для e2e).
declare(strict_types=1);

const VKM_ACC = '905614', VKM_FAM = 'шевченко', VKM_TOKEN = 'TOKEN-abc123==';
function vkm_meters(): array { return [['id' => '1282444', 'serial' => '0123456', 'svc' => 'Холодна вода', 'prev' => 430, 'date' => '01.10.2026'], ['id' => '1282445', 'serial' => '0654321', 'svc' => 'Гаряча вода', 'prev' => 170, 'date' => '01.10.2026']]; }
function vkm_head(string $t): string { return '<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="csrf-param" content="_csrf-frontend"><meta name="csrf-token" content="' . VKM_TOKEN . '"><title>' . $t . ' | Інформаційна система</title></head><body><div class="wrap"><div class="container">'; }
function vkm_login(?string $err = null, string $acc = '', string $fam = ''): string {
  return vkm_head('Сторінка авторизації') . '<h3>Система прийому показань приладів обліку</h3>' .
    '<form id="no-login-form" class="form-noreg form-padding" action="//' . ($GLOBALS['VKM_HOST'] ?? 'billing.vodokanal.kharkov.ua') . '/get-form-send-indications" method="post"><input type="hidden" name="_csrf-frontend" value="' . VKM_TOKEN . '">' .
    '<h4>Вхід без реєстрації:</h4><div class="form-group field-nologinform-acc required' . ($err ? ' has-error' : '') . '"><label class="control-label" for="nologinform-acc">Особовий рахунок</label><input type="text" id="nologinform-acc" class="form-control" name="NoLoginForm[acc]" value="' . htmlspecialchars($acc) . '"><p class="help-block help-block-error">' . htmlspecialchars((string)$err) . '</p></div>' .
    '<div class="form-group field-nologinform-fam required"><label class="control-label" for="nologinform-fam">Прізвище</label><input type="text" id="nologinform-fam" class="form-control" name="NoLoginForm[fam]" value="' . htmlspecialchars($fam) . '" maxlength="20" placeholder="Як в квитанції, без ініціалів"><p class="help-block help-block-error"></p></div>' .
    '<button type="submit" class="btn btn-primary" name="check-button">Перевірити</button></form>' .
    '<form id="login-form" class="form-reg form-padding" action="//' . ($GLOBALS['VKM_HOST'] ?? 'billing.vodokanal.kharkov.ua') . '/login" method="post"><input type="hidden" name="_csrf-frontend" value="' . VKM_TOKEN . '"><input type="text" name="LoginForm[username]"><input type="password" name="LoginForm[password]"><button type="submit" name="login-button">Увійти</button></form>' .
    '<p>Увага! Дані, прийняті через сайт, передаються в загальну базу КП «Харківводоканал» миттєво, в режимі online.</p><p>Дякуємо за щомісячну передачу показань приладів обліку та своєчасну оплату!</p></div></div></body></html>';
}
function vkm_form(array $ms, ?string $flash = null, array $errs = [], array $vals = []): string {
  $rows = '';
  foreach ($ms as $m) {
    $e = $errs[$m['id']] ?? null;
    $rows .= '<tr><td>' . $m['serial'] . '</td><td>' . $m['svc'] . '</td><td>' . $m['date'] . '</td><td>' . $m['prev'] . '</td>' .
      '<td><div class="form-group field-dynamicmodel-newindication-' . $m['id'] . ($e ? ' has-error' : '') . '"><input type="text" id="dynamicmodel-newindication-' . $m['id'] . '" class="form-control" name="DynamicModel[newIndication][' . $m['id'] . ']" value="' . htmlspecialchars((string)($vals[$m['id']] ?? '')) . '"><p class="help-block help-block-error">' . htmlspecialchars((string)$e) . '</p></div></td>' .
      '<td><select name="DynamicModel[dataIndication][' . $m['id'] . ']"><option value="2026-11-04" selected>04.11.2026</option><option value="2026-11-03">03.11.2026</option></select></td></tr>';
  }
  return vkm_head('Передача показань') . ($flash ? '<div class="alert alert-success alert-dismissible">' . $flash . '</div>' : '') .
    '<p>Особовий рахунок: ' . VKM_ACC . '</p><p>вул. Сумська, 10, кв. 5</p>' .
    '<form id="send-counters-form" action="/send-indications" method="post"><input type="hidden" name="_csrf-frontend" value="' . VKM_TOKEN . '">' .
    '<table class="table table-bordered"><thead><tr><th>№ лічильника</th><th>Послуга</th><th>Дата попередніх показань</th><th>Попередні показання</th><th>Нові показання</th><th>Дата показань</th></tr></thead><tbody>' . $rows . '</tbody></table>' .
    '<button type="submit" class="btn btn-success" name="send-button">Передати показання</button></form></div></div></body></html>';
}
/** Показания периода уже приняты (живой сайт 07.11.2026, скрин владельца): полей ввода нет, у лічильника — блок с «Передані показання за
 *  листопад 2026, м³» (readonly без name), «дата наступної повірки», «ПОКАЗАННЯ … ПРИЙНЯТІ». Вёрстка выдумана, тексты — как на сайте. Рахунок VKM_ACC_DONE. */
const VKM_ACC_DONE = '905616';
function vkm_done(): string {
  $blk = fn($cls, $t, $n, $ver, $v) => '<div class="panel ' . $cls . '"><div class="panel-heading"><h3 class="panel-title"><i>' . $t . ' (№ ' . $n . ')</i></h3></div><div class="panel-body">'
    . '<div class="alert alert-warning">дата наступної повірки - <span class="text-danger">' . $ver . '</span></div>'
    . '<div class="row"><label class="col-sm-8">Передані показання за листопад 2026 , м<sup>3</sup>:</label><div class="col-sm-4"><input type="text" class="form-control" value="' . $v . '" readonly></div></div>'
    . '<div class="ind-ok">ПОКАЗАННЯ ЛІЧИЛЬНИКІВ ЗА ПОТОЧНИЙ ПЕРІОД ПРИЙНЯТІ</div><div class="ind-no">НЕ ПОТРЕБУЮТЬ ДОДАТКОВОЇ ПЕРЕДАЧІ ІНШИМИ СПОСОБАМИ</div></div></div>';
  return vkm_head('Передача показань') . '<h3>Система прийому показань приладів обліку</h3><div class="panel panel-primary"><div class="panel-heading">Стан особового рахунку № ' . VKM_ACC_DONE . '</div>'
    . '<table class="table"><tr><td>Адреса</td><td>:</td><td>пр. Перемоги 1, кв. 2</td></tr><tr><td>Сума поточного боргу</td><td>:</td><td>43.19 грн</td></tr><tr><td>Дата / сума останньої оплати</td><td>:</td><td>21 жовтня 2026 р. / 167.61 грн</td></tr></table></div>'
    . '<form id="send-counters-form" action="/counters#" method="post"><input type="hidden" name="_csrf-frontend" value="' . VKM_TOKEN . '"><input type="hidden" name="DynamicModel[acc]" value="' . VKM_ACC_DONE . '">'
    . $blk('panel-danger', 'Гаряча вода', '8221019', '7 лютого 2026 р.', '132.000') . $blk('panel-info', 'Холодна вода', '8254605', '7 листопада 2026 р.', '179.000') . '</form>'
    . '<div class="alert alert-success">Показання чотирьохтарифного лічильника можна передати в кабінеті теплових мереж. <a href="https://www.hts.kharkov.ua/cabinet">Перейти →</a></div>'
    . '<p>Завантажити квитанцію:</p><iframe src="/tmp/1.123456.checkPDF.pdf"></iframe></div></div></body></html>';
}
/** Один запрос к «кабинету». $s — сессия (cookie PHPSESSID): acc, sent. → [code, body, headers[]] */
function vkm_handle(string $method, string $path, array $post, array &$s): array {
  $ok = ($post['_csrf-frontend'] ?? '') === VKM_TOKEN;
  if ($path === '/login' && $method === 'GET') return [200, vkm_login(), ['Set-Cookie: _csrf-frontend=c00kie; path=/; HttpOnly']];
  if ($path === '/get-form-send-indications' && $method === 'POST') {
    if (!$ok || ($s['cookies']['_csrf-frontend'] ?? '') !== 'c00kie') return [400, vkm_head('Bad Request') . '<div class="alert alert-danger">Не вдалося перевірити ваші дані.</div></body></html>', []];
    $acc = (string)($post['NoLoginForm']['acc'] ?? ''); $fam = mb_strtolower((string)($post['NoLoginForm']['fam'] ?? ''));
    // как живой сайт (проба с сервера 04.11.2026): страница без форм с объяснением; рахунок с «7777» — старый вариант (снова форма входа с ошибкой)
    if ($acc === VKM_ACC_DONE && $fam === VKM_FAM) return [200, vkm_done(), []];   // как живой сайт: страница сразу в ответ на POST
    if (str_contains($acc, '7777')) return [200, vkm_login('Особовий рахунок не знайдено або прізвище не співпадає.', $acc, (string)($post['NoLoginForm']['fam'] ?? '')), []];
    if ($acc !== VKM_ACC || $fam !== VKM_FAM) return [200, vkm_head('Передача показань') . '<div class="alert alert-danger">Не коректні дані: особовий рахунок або Прізвище абонента , або на особовому рахунку не значаться лічильники. Можливо необхідно вказати прізвище українською мовою</div><p><a href="/login">Назад</a></p></div></div></body></html>', []];
    $s['acc'] = $acc; return [302, '', ['Location: /send-indications']];
  }
  if ($path === '/send-indications' && $method === 'GET') {
    if (empty($s['acc'])) return [302, '', ['Location: /login']];
    $flash = $s['flash'] ?? null; unset($s['flash']);
    return [200, vkm_form(vkm_meters_state($s), $flash), []];
  }
  if ($path === '/send-indications' && $method === 'POST') {
    if (!$ok || empty($s['acc'])) return [400, 'bad', []];
    $vals = (array)($post['DynamicModel']['newIndication'] ?? []); $errs = []; $ms = vkm_meters_state($s);
    foreach ($ms as $m) { $v = trim((string)($vals[$m['id']] ?? '')); if ($v === '') continue; if (!preg_match('/^\d+$/', $v)) $errs[$m['id']] = 'Значення має бути цілим числом.'; elseif ((int)$v < $m['prev']) $errs[$m['id']] = 'Показання не можуть бути меншими за попередні.'; }
    if (!array_filter($vals, fn($v) => trim((string)$v) !== '')) $errs[$ms[0]['id']] = 'Необхідно заповнити «Нові показання».';
    if ($errs) return [200, vkm_form($ms, null, $errs, $vals), []];
    foreach ($vals as $id => $v) if (trim((string)$v) !== '') $s['prev'][$id] = (int)$v;
    $s['dates'] = (array)($post['DynamicModel']['dataIndication'] ?? []); $s['flash'] = 'Ваші показання прийнято. Дякуємо!';
    $s['sent'] = ($s['sent'] ?? 0) + 1;
    return [302, '', ['Location: /send-indications']];
  }
  return [404, 'not found', []];
}
function vkm_meters_state(array $s): array { return array_map(fn($m) => ['prev' => $s['prev'][$m['id']] ?? $m['prev']] + $m, vkm_meters()); }
/** Запрос целиком: cookie → сессия в $store (PHPSESSID), тело формы → массив. */
function vkm_request(string $method, string $url, ?string $body, string $cookie, array &$store): array {
  $c = []; foreach (array_filter(array_map('trim', explode(';', $cookie))) as $kv) { [$k, $v] = array_pad(explode('=', $kv, 2), 2, ''); $c[$k] = $v; }
  $hdr = []; $sid = $c['PHPSESSID'] ?? '';
  if ($sid === '' || !isset($store[$sid])) { $sid = 'sess' . (count($store) + 1); $store[$sid] = []; $hdr[] = 'Set-Cookie: PHPSESSID=' . $sid . '; path=/; HttpOnly'; }
  $s = &$store[$sid]; $s['cookies'] = $c; parse_str((string)$body, $post);
  $s['prev'] = $store['_prev'] ?? [];   // последние показания — у рахунку, не у сессии
  [$code, $html, $h] = vkm_handle($method, (string)parse_url($url, PHP_URL_PATH), $post, $s);
  $store['_prev'] = $s['prev'] ?? [];
  $store['_last'] = ['method' => $method, 'path' => parse_url($url, PHP_URL_PATH)];
  if ($method === 'POST') $store['_lastPost'] = ['path' => parse_url($url, PHP_URL_PATH), 'post' => $post];
  return [$code, $html, array_merge($hdr, $h)];
}
