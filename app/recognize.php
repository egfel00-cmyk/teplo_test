<?php
// Распознавание счётчика и показаний по фото на сервере (vision-API Anthropic, ключ — в SITE_DATA/config.php).
// Фото приходят СЫРЫМ телом (multipart на сервере запрещён), лежат во временной папке SITE_DATA/tmp/recog/<user>/
// и удаляются сразу после ответа (и все старше часа). Промпт строит сервер — клиент передаёт только контекст.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Recognize {
  const TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
  const MODELS = ['sharky774' => 'Diehl SHARKY 774', 'sharky775' => 'Diehl SHARKY 775 / Danfoss SONOMETER 1100', 't330' => 'Landis+Gyr ULTRAHEAT T330 (UH30)',
    't230' => 'Landis+Gyr ULTRAHEAT T230', 'multical302' => 'Kamstrup MULTICAL 302', 'elf' => 'Apator ELF / LQM-III ELF', 'sensostar' => 'Engelmann SensoStar',
    'nik7071' => 'НІК 7071', 'trust' => 'TRUST', 'other' => 'other heat meter'];
  const ORDER = ['sharky774' => '1) energy [Gcal] 2) volume [m³ in the top right corner] 3) flow [m³/h] 4) power [kW] 5) tSupply + tReturn [alternating ht/ct] 6) hours + errHours [alternating On/Eh] 7) errCode'];
  /** Вызов API; в тестах подменяется. fn(array $payload): array */
  public static $call = null;

  private static function dir(int $uid): string {
    $d = (Cfg::data() ?: sys_get_temp_dir()) . '/tmp/recog/' . $uid;
    if (!is_dir($d) && !@mkdir($d, 0700, true) && !is_dir($d)) throw new HttpError(500, 'storage');
    return $d;
  }
  private static function cleanup(string $d): void { foreach (glob($d . '/*') ?: [] as $f) if (filemtime($f) < time() - 3600) @unlink($f); }

  public static function upload(int $uid, string $body, string $ctype): array {
    $ctype = strtolower(trim(explode(';', $ctype)[0]));
    if (!isset(self::TYPES[$ctype]) || $body === '') throw new HttpError(415, 'bad_image');
    $info = @getimagesizefromstring($body);          // проверяем содержимое, а не только заголовок
    if (!$info || !isset(self::TYPES[$info['mime'] ?? ''])) throw new HttpError(415, 'bad_image');
    $d = self::dir($uid); self::cleanup($d);
    if (count(glob($d . '/*') ?: []) >= 40) throw new HttpError(429, 'rate_limited', ['retryAfter' => 600]);
    $id = bin2hex(random_bytes(12));
    if (file_put_contents($d . '/' . $id . '.' . self::TYPES[$info['mime']], $body) === false) throw new HttpError(500, 'storage');
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
      'A photo may be: a close-up of the LCD screen (usually ONE value per photo, the person pressed the button between photos), the nameplate/label, or a wide shot of the meter (possibly with several meters).',
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

  public static function run(int $uid, array $in): array {
    $ids = array_values(array_filter((array)($in['ids'] ?? []), fn($x) => is_string($x) && preg_match('/^[a-f0-9]{24}$/', $x)));
    if (!$ids || count($ids) > 3) throw new HttpError(422, 'bad_ids');
    $offset = max(0, min(100, (int)($in['offset'] ?? 0)));
    $d = self::dir($uid); $content = []; $files = [];
    foreach ($ids as $id) {
      $f = (glob($d . '/' . $id . '.*') ?: [])[0] ?? null;
      if (!$f) throw new HttpError(410, 'photo_expired');
      $mime = array_search(pathinfo($f, PATHINFO_EXTENSION), self::TYPES, true);
      $content[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $mime, 'data' => base64_encode((string)file_get_contents($f))]];
      $files[] = $f;
    }
    $content[] = ['type' => 'text', 'text' => self::prompt((array)($in['ctx'] ?? []), $offset, count($ids))];
    $payload = ['model' => (string)Cfg::get('anthropic_model'), 'max_tokens' => 2000, 'messages' => [['role' => 'user', 'content' => $content]]];
    try { $resp = self::$call ? (self::$call)($payload) : self::callApi($payload); }
    finally { foreach ($files as $f) @unlink($f); }          // фото не храним
    $text = ''; foreach ($resp['content'] ?? [] as $c) if (($c['type'] ?? '') === 'text') $text .= $c['text'];
    $json = self::parseJson($text);
    if (!is_array($json)) throw new HttpError(502, 'bad_answer');
    return ['meter' => $json['meter'] ?? null, 'photos' => array_values(array_filter((array)($json['photos'] ?? []), 'is_array'))];
  }

  public static function parseJson(string $t): ?array {
    $j = json_decode($t, true); if (is_array($j)) return $j;
    if (preg_match('/```(?:json)?\s*(\{.*\})\s*```/s', $t, $m)) { $j = json_decode($m[1], true); if (is_array($j)) return $j; }
    $a = strpos($t, '{'); $b = strrpos($t, '}');
    if ($a !== false && $b > $a) { $j = json_decode(substr($t, $a, $b - $a + 1), true); if (is_array($j)) return $j; }
    return null;
  }

  private static function callApi(array $payload): array {
    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($payload), CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT => 26, CURLOPT_CONNECTTIMEOUT => 5,  // сервер даёт 30 с на запрос — поэтому пачки по 3 фото
      CURLOPT_HTTPHEADER => ['content-type: application/json', 'anthropic-version: 2023-06-01', 'x-api-key: ' . Cfg::get('anthropic_api_key')]]);
    $r = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_errno($ch); curl_close($ch);
    if ($err === CURLE_OPERATION_TIMEDOUT) throw new HttpError(504, 'recognition_timeout');
    if ($code === 429 || $code === 529) throw new HttpError(429, 'rate_limited', ['retryAfter' => 60]);
    if ($code !== 200) throw new HttpError(502, 'recognition_failed');
    return json_decode((string)$r, true) ?: [];
  }
}
