<?php
// Распознавание счётчика и показаний по фото на сервере (vision-API Anthropic, ключ — в SITE_DATA/config.php).
// Фото приходят СЫРЫМ телом (multipart на сервере запрещён) и хранятся photo_keep_days дней
// в SITE_DATA/uploads/photos/<user>/ — их видит владелец в аналитике (/admin); чистит cron.php.
// Каждая проблема записывается человеческим языком: в photos.problem и в журнал recog_reports.
// Промпт строит сервер — клиент передаёт только контекст.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Recognize {
  const TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
  const MODELS = ['sharky774' => 'Diehl SHARKY 774', 'sharky775' => 'Diehl SHARKY 775 / Danfoss SONOMETER 1100', 't330' => 'Landis+Gyr ULTRAHEAT T330 (UH30)',
    't230' => 'Landis+Gyr ULTRAHEAT T230', 'multical302' => 'Kamstrup MULTICAL 302', 'elf' => 'Apator ELF / LQM-III ELF', 'sensostar' => 'Engelmann SensoStar',
    'nik7071' => 'НІК 7071', 'trust' => 'TRUST', 'other' => 'other heat meter'];
  const ORDER = ['sharky774' => '1) energy [Gcal] 2) volume [m³ in the top right corner] 3) flow [m³/h] 4) power [kW] 5) tSupply + tReturn [alternating ht/ct] 6) hours + errHours [alternating On/Eh] 7) errCode'];
  const FIELD_RU = ['energy' => 'энергия', 'volume' => 'объём', 'flow' => 'расход', 'power' => 'мощность', 'tSupply' => 'подача', 'tReturn' => 'обратка',
    'hours' => 'часы работы', 'errHours' => 'часы с ошибкой', 'errCode' => 'код ошибки'];
  const QUALITY_RU = ['blurry' => 'размыто', 'glare' => 'блик на экране', 'too_far' => 'снято издалека', 'cut_off' => 'экран обрезан', 'dark' => 'темно'];
  /** Вызов API; в тестах подменяется. fn(array $payload): array */
  public static $call = null;

  public static function root(): string { return (Cfg::data() ?: sys_get_temp_dir() . '/teplo_data') . '/uploads/photos'; }
  private static function dir(int $uid): string {
    $d = self::root() . '/' . $uid;
    if (!is_dir($d) && !@mkdir($d, 0700, true) && !is_dir($d)) throw new HttpError(500, 'storage');
    return $d;
  }
  public static function path(array $p): string { return self::root() . '/' . (int)$p['user_id'] . '/' . basename((string)$p['file']); }

  public static function upload(int $uid, string $body, string $ctype): array {
    $ctype = strtolower(trim(explode(';', $ctype)[0]));
    if (!isset(self::TYPES[$ctype]) || $body === '') throw new HttpError(415, 'bad_image');
    $info = @getimagesizefromstring($body);          // проверяем содержимое, а не только заголовок
    if (!$info || !isset(self::TYPES[$info['mime'] ?? ''])) throw new HttpError(415, 'bad_image');
    $id = bin2hex(random_bytes(12)); $file = $id . '.' . self::TYPES[$info['mime']];
    if (file_put_contents(self::dir($uid) . '/' . $file, $body) === false) throw new HttpError(500, 'storage');
    Db::q('INSERT INTO photos (id, user_id, file, mime, bytes, w, h, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [$id, $uid, $file, $info['mime'], strlen($body), (int)$info[0], (int)$info[1], 'uploaded', Http::iso()]);
    return ['id' => $id];
  }

  public static function prompt(array $ctx, int $offset, int $count): string {
    $cat = implode('; ', array_map(fn($k, $v) => "$k — $v", array_keys(self::MODELS), self::MODELS));
    $exp = (string)($ctx['expectedModel'] ?? ''); $exp = isset(self::MODELS[$exp]) ? $exp : '';
    $apt = preg_replace('/[^0-9A-Za-zА-Яа-яІіЇїЄє-]/u', '', (string)($ctx['apartment'] ?? ''));
    $prev = [];
    foreach (['energy', 'volume', 'hours'] as $k) if (isset($ctx['prev'][$k]) && is_numeric($ctx['prev'][$k])) $prev[$k] = 0 + $ctx['prev'][$k];
    $lang = ($ctx['lang'] ?? '') === 'ru' ? 'Russian' : 'Ukrainian';
    return implode("\n", array_filter([
      'You read photos of an apartment heat meter in Kharkiv, Ukraine, to fill a form for the city heating company. Accuracy matters more than completeness.',
      "There are $count photo(s), in the order given; report \"index\" counting from $offset.",
      'A photo may be: a close-up of the LCD screen (usually ONE value per photo, the person pressed the button between photos), the nameplate/label, or a wide shot of the meter (possibly with several meters). It may also be a screenshot of the heating company web cabinet showing previously accepted values in a table — read those values the same way (kind "other").',
      "Known models (id — name): $cat. Use \"other\" if it is a heat meter not in the list, null if you cannot tell.",
      $exp ? 'The person says their meter is: ' . self::MODELS[$exp] . '. If a photo shows several meters, read the one matching this model' . ($apt ? " (or the apartment sticker $apt)" : '') . ' and say so in "note".' : 'The model is not known yet — identify it from the nameplate or the look of the meter.',
      $exp && isset(self::ORDER[$exp]) ? 'For this model the screens usually come in this order: ' . self::ORDER[$exp] . '. Use it only to tell unlabeled screens apart.' : '',
      'Fields: energy = accumulated heat energy (unit Gcal / MWh / GJ / kWh as shown); volume = accumulated water volume, m³; flow = instantaneous flow, m³/h; power = instantaneous power, kW; tSupply = supply temperature °C (labels "ht", "T1", arrow up — the hotter one); tReturn = return temperature °C ("ct", "T2", arrow down); hours = operating hours ("On", "h"); errHours = hours with error ("Eh", "Err h"); errCode = error code ("E-" or "E---" with no digits means no error → "E---").',
      'Rules: copy the digits EXACTLY as displayed, with "." as the decimal separator and leading zeros removed ("00015.482" → "15.482"). Never invent, estimate or calculate a value, never copy it from anywhere but the photo. If a digit is unclear, give your best reading with confidence below 0.6 and explain in "note". Report every field you can see on each photo.',
      $prev ? 'For sanity only (do NOT copy): the previous accepted values were ' . json_encode($prev) . ' — accumulated values should be equal or higher.' : '',
      "Write \"note\" in $lang, at most one short sentence, only when there is a problem.",
      'Reply with only JSON of this shape:',
      '{"meter":{"modelId":"sharky774"|null,"modelText":"as printed"|null,"serial":"…"|null,"apartment":"61"|null,"energyUnit":"Gcal"|"MWh"|"GJ"|"kWh"|null,"confidence":0.0},',
      ' "photos":[{"index":' . $offset . ',"kind":"screen"|"nameplate"|"overview"|"other","readings":[{"field":"energy","value":"15.482","unit":"Gcal","label":"Gcal","confidence":0.95}],"quality":"ok"|"blurry"|"glare"|"too_far"|"cut_off"|"dark","note":""}]}',
    ]));
  }

  /** Ошибка запроса к нейросети: записать во все фото пачки и в журнал, пробросить клиенту. */
  private static function failRun(int $uid, array $ids, HttpError $e, string $human): HttpError {
    foreach ($ids as $id) Db::q("UPDATE photos SET status = 'failed', problem = ? WHERE id = ? AND user_id = ?", [$human, $id, $uid]);
    Db::q('INSERT INTO recog_reports (user_id, photo_ids, kind, ok, text, data, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
      [$uid, implode(',', $ids), 'run_error', $human, json_encode(['code' => $e->err] + $e->extra, JSON_UNESCAPED_UNICODE), Http::iso()]);
    return $e;
  }

  public static function run(int $uid, array $in): array {
    $ids = array_values(array_filter((array)($in['ids'] ?? []), fn($x) => is_string($x) && preg_match('/^[a-f0-9]{24}$/', $x)));
    if (!$ids || count($ids) > 3) throw new HttpError(422, 'bad_ids');
    $offset = max(0, min(100, (int)($in['offset'] ?? 0)));
    $content = []; $rows = [];
    foreach ($ids as $id) {
      $p = Db::one('SELECT * FROM photos WHERE id = ? AND user_id = ?', [$id, $uid]);
      if (!$p || !is_file(self::path($p))) throw new HttpError(410, 'photo_expired');
      $content[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $p['mime'], 'data' => base64_encode((string)file_get_contents(self::path($p)))]];
      $rows[] = $p;
    }
    if (!Cfg::get('anthropic_api_key') && !self::$call)
      throw self::failRun($uid, $ids, new HttpError(503, 'recognition_off'), 'Распознавание выключено: на сервере не задан ключ API (/admin → «Настройки»). Фото сохранены.');
    $content[] = ['type' => 'text', 'text' => self::prompt((array)($in['ctx'] ?? []), $offset, count($ids))];
    $payload = ['model' => (string)Cfg::get('anthropic_model'), 'max_tokens' => 2000, 'messages' => [['role' => 'user', 'content' => $content]]];
    $t0 = microtime(true);
    try { $resp = self::$call ? (self::$call)($payload) : self::callApi($payload); }
    catch (HttpError $e) { throw self::failRun($uid, $ids, $e, $e->extra['human'] ?? ('Ошибка запроса к нейросети: ' . $e->err)); }
    $ms = (int)round((microtime(true) - $t0) * 1000);
    $text = ''; foreach ($resp['content'] ?? [] as $c) if (($c['type'] ?? '') === 'text') $text .= $c['text'];
    $json = self::parseJson($text);
    if (!is_array($json)) throw self::failRun($uid, $ids, new HttpError(502, 'bad_answer'), 'Нейросеть ответила не в формате JSON. Начало ответа: «' . mb_substr(trim($text), 0, 160) . '»');
    $photos = array_values(array_filter((array)($json['photos'] ?? []), 'is_array'));
    // результат и проблема — по каждому фото
    foreach ($rows as $k => $p) {
      $mine = array_values(array_filter($photos, fn($x) => (int)($x['index'] ?? -1) === $offset + $k));
      $ph = $mine[0] ?? null; $problems = [];
      if (!$ph) $problems[] = 'нейросеть ничего не сказала про это фото';
      else {
        $readings = array_filter((array)($ph['readings'] ?? []), 'is_array');
        if (!$readings && ($ph['kind'] ?? '') === 'screen') $problems[] = 'на экране не найдено показаний';
        if (($ph['quality'] ?? 'ok') !== 'ok') $problems[] = 'качество: ' . (self::QUALITY_RU[$ph['quality']] ?? $ph['quality']);
        foreach ($readings as $r) if (isset($r['confidence']) && $r['confidence'] < 0.75) $problems[] = (self::FIELD_RU[$r['field'] ?? ''] ?? ($r['field'] ?? '?')) . ' прочитано неуверенно (' . round($r['confidence'] * 100) . '%)';
        if (!empty($ph['note'])) $problems[] = 'нейросеть: ' . mb_substr((string)$ph['note'], 0, 200);
      }
      Db::q('UPDATE photos SET status = ?, result = ?, problem = ? WHERE id = ?', [$ph ? 'recognized' : 'failed', json_encode(['photo' => $ph, 'meter' => $json['meter'] ?? null, 'ms' => $ms], JSON_UNESCAPED_UNICODE), $problems ? implode('; ', $problems) : null, $p['id']]);
    }
    return ['meter' => $json['meter'] ?? null, 'photos' => $photos];
  }

  const OTHER_RU = ['water' => 'воды', 'electric' => 'электроэнергии', 'gas' => 'газа'];
  /** Результат распознавания в браузере (свой движок PaddleOCR, без нейросети): записать в фото для аналитики. */
  public static function local(int $uid, array $in): array {
    $res = array_values(array_filter((array)($in['results'] ?? []), 'is_array'));
    $ids = array_values(array_filter((array)($in['ids'] ?? []), fn($x) => is_string($x) && preg_match('/^[a-f0-9]{24}$/', $x)));
    if (!$ids || count($ids) > 20) throw new HttpError(422, 'bad_ids');
    $n = 0;
    foreach ($ids as $k => $id) {
      $p = Db::one('SELECT id FROM photos WHERE id = ? AND user_id = ?', [$id, $uid]); if (!$p) continue;
      $r = $res[$k] ?? null; $ph = is_array($r['photo'] ?? null) ? $r['photo'] : null; $problems = [];
      if (!$ph) $problems[] = 'распознаватель ничего не вернул по этому фото';
      else {
        $mt = (string)($ph['meterType'] ?? '');
        if (isset(self::OTHER_RU[$mt])) $problems[] = 'на фото счётчик ' . self::OTHER_RU[$mt] . ', а не тепла';
        $readings = array_filter((array)($ph['readings'] ?? []), 'is_array');
        if (!$readings && !isset(self::OTHER_RU[$mt]) && ($ph['kind'] ?? '') !== 'nameplate') $problems[] = 'показаний не найдено';
        if (($ph['quality'] ?? 'ok') !== 'ok') $problems[] = 'качество: ' . (self::QUALITY_RU[$ph['quality']] ?? $ph['quality']);
        foreach ($readings as $x) if (isset($x['confidence']) && $x['confidence'] < 0.75) $problems[] = (self::FIELD_RU[$x['field'] ?? ''] ?? '?') . ' прочитано неуверенно (' . round($x['confidence'] * 100) . '%)';
        $note = (string)($ph['note'] ?? '');
        if ($note === 'unlabeled') $problems[] = 'есть число без подписи (Gcal, m³, °C) — непонятно, какое это поле';
        elseif ($note === 'no_dot') $problems[] = 'не видно десятичной точки';
        elseif ($note === 'unit_guess') $problems[] = 'единица на экране не прочиталась — взята типичная для модели';
      }
      $json = json_encode(['photo' => $ph, 'meter' => $r['meter'] ?? null, 'ms' => (int)($r['ms'] ?? 0), 'engine' => 'local', 'ocr' => array_slice((array)($r['ocr'] ?? []), 0, 80)], JSON_UNESCAPED_UNICODE);
      if (strlen((string)$json) > 60000) $json = json_encode(['photo' => $ph, 'meter' => $r['meter'] ?? null, 'engine' => 'local'], JSON_UNESCAPED_UNICODE);
      Db::q('UPDATE photos SET status = ?, result = ?, problem = ? WHERE id = ?', [$ph ? 'recognized' : 'failed', $json, $problems ? implode('; ', $problems) : null, $id]);
      $n++;
    }
    return ['ok' => true, 'saved' => $n];
  }

  /** Итог распознавания с экрана «Розпізнати з фото»: что не нашлось, что неуверенно, что человек исправил. */
  public static function report(int $uid, array $in): array {
    $ids = array_values(array_filter((array)($in['ids'] ?? []), fn($x) => is_string($x) && preg_match('/^[a-f0-9]{24}$/', $x)));
    $f = fn($k) => self::FIELD_RU[$k] ?? preg_replace('/[^a-zA-Z]/', '', (string)$k);
    $parts = [];
    $missing = array_values(array_filter((array)($in['missing'] ?? []), fn($k) => isset(self::FIELD_RU[$k])));
    if ($missing) $parts[] = 'не найдено на фото: ' . implode(', ', array_map($f, $missing));
    $conf = array_values(array_filter((array)($in['conflicts'] ?? []), fn($k) => isset(self::FIELD_RU[$k])));
    if ($conf) $parts[] = 'на разных фото разные цифры: ' . implode(', ', array_map($f, $conf));
    $fix = [];
    foreach ((array)($in['corrections'] ?? []) as $c) {
      if (!is_array($c) || !isset(self::FIELD_RU[$c['field'] ?? ''])) continue;
      $fix[] = $f($c['field']) . ': распознано «' . mb_substr((string)($c['recognized'] ?? ''), 0, 20) . '», человек исправил на «' . mb_substr((string)($c['final'] ?? ''), 0, 20) . '»';
    }
    if ($fix) $parts[] = 'исправлено вручную — ' . implode('; ', $fix);
    $ok = !$parts;
    $text = $ok ? 'Распознано без замечаний: все поля найдены, человек ничего не исправлял.' : ucfirst(implode('. ', $parts)) . '.';
    Db::q('INSERT INTO recog_reports (user_id, photo_ids, kind, ok, text, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [$uid, implode(',', $ids), 'summary', $ok ? 1 : 0, $text, json_encode(['missing' => $missing, 'conflicts' => $conf, 'corrections' => $in['corrections'] ?? [], 'model' => $in['model'] ?? null], JSON_UNESCAPED_UNICODE), Http::iso()]);
    return ['ok' => true];
  }

  public static function parseJson(string $t): ?array {
    $j = json_decode($t, true); if (is_array($j)) return $j;
    if (preg_match('/```(?:json)?\s*(\{.*\})\s*```/s', $t, $m)) { $j = json_decode($m[1], true); if (is_array($j)) return $j; }
    $a = strpos($t, '{'); $b = strrpos($t, '}');
    if ($a !== false && $b > $a) { $j = json_decode(substr($t, $a, $b - $a + 1), true); if (is_array($j)) return $j; }
    return null;
  }

  /** Проверка ключа и модели одним крошечным запросом (из /admin → «Настройки»). В тестах подменяется. */
  public static $check = null;
  public static function checkKey(string $key, string $model): array {
    $payload = ['model' => $model, 'max_tokens' => 1, 'messages' => [['role' => 'user', 'content' => 'ping']]];
    if (self::$check) return (self::$check)($key, $payload);
    $r = self::callApi($payload, $key);
    return ['ok' => true, 'model' => $r['model'] ?? $model];
  }

  private static function callApi(array $payload, ?string $key = null): array {
    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($payload), CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT => 26, CURLOPT_CONNECTTIMEOUT => 5,  // сервер даёт 30 с на запрос — поэтому пачки по 3 фото
      CURLOPT_HTTPHEADER => ['content-type: application/json', 'anthropic-version: 2023-06-01', 'x-api-key: ' . ($key ?? Cfg::get('anthropic_api_key'))]]);
    $r = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_errno($ch); $errs = curl_error($ch); curl_close($ch);
    $msg = mb_substr((string)(json_decode((string)$r, true)['error']['message'] ?? ''), 0, 200);
    if ($err === CURLE_OPERATION_TIMEDOUT) throw new HttpError(504, 'timeout', ['human' => 'Нейросеть не ответила за 26 с (сервер ограничивает запрос 30 с). Попробовать меньше фото за раз.']);
    if ($err) throw new HttpError(502, 'network', ['human' => 'Сервер не смог связаться с API нейросети: ' . $errs]);
    if ($code === 401 || $code === 403) throw new HttpError(503, 'recognition_off', ['human' => "Ключ API отклонён (HTTP $code) — проверить ключ в /admin → «Настройки». $msg"]);
    if ($code === 429 || $code === 529) throw new HttpError(429, 'rate_limited', ['retryAfter' => 60, 'human' => "Нейросеть перегружена или исчерпан лимит API (HTTP $code). $msg"]);
    if ($code === 400 || $code === 404) throw new HttpError(502, 'recognition_failed', ['human' => "API отклонил запрос (HTTP $code) — возможно, неверное имя модели (/admin → «Настройки»). $msg"]);
    if ($code !== 200) throw new HttpError(502, 'recognition_failed', ['human' => "Ошибка API нейросети (HTTP $code). $msg"]);
    return json_decode((string)$r, true) ?: [];
  }
}
