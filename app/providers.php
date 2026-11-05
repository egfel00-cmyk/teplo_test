<?php
declare(strict_types=1);

/** Постачальники й тарифи за адресою квартири (Харківська область): довідник app/data/providers.json.
 *  GET /api/providers?q=адреса → населений пункт і по видах (світло, газ, вода, тепло): хто постачає, тариф із джерелом і датою.
 *  Адресу не зберігаємо. Невідоме (null) людина вписує з платіжки в застосунку. */
final class Providers {
  public static function file(): string { return (string)Cfg::get('providers_file', __DIR__ . '/data/providers.json'); }
  private static ?array $d = null;
  public static function data(): array {
    if (self::$d === null) { $j = json_decode((string)@file_get_contents(self::file()), true); self::$d = is_array($j) ? $j : ['places' => [], 'national' => []]; }
    return self::$d;
  }
  public static function reset(): void { self::$d = null; }
  const STREET = '/\d|(^|\s)(вул|вулиця|ул|улица|пр|просп|проспект|пров|провулок|пер|переулок|пл|площа|площадь|бул|бульвар|узвіз|шосе|шоссе|майдан|тупик|набережна|набережная|мкр|мікрорайон|микрорайон)(\.|\s|$)/u';
  /** Шматок адреси без «смт», «с-ще», «с.», «м.» тощо → скелет (той самий, що для черг відключень). */
  public static function skelPart(string $s): string {
    $s = preg_replace('/^\s*(с\s*-\s*ще|с-ще|пгт|смт|сел|селище|село|с|м|г|місто|город|пос|поселок|п)\.?\s+/u', '', mb_strtolower(trim($s)));
    return Gpv::skel((string)$s);
  }
  /** Адреса → пункт довідника. how: 'name' — назву знайшли в адресі; 'default' — адреса починається з вулиці (без пункту) → Харків. */
  public static function match(string $addr): ?array {
    $segs = array_values(array_filter(array_map('trim', preg_split('/[,;]/u', mb_strtolower($addr))), fn($x) => $x !== ''));
    if (!$segs) return null;
    $parts = array_map([self::class, 'skelPart'], $segs);
    foreach ((array)(self::data()['places'] ?? []) as $p) {
      foreach ((array)$p['names'] as $n) {
        $k = self::skelPart((string)$n);
        foreach ($parts as $s) if ($s !== '' && (Gpv::cityLike($s, $k) || str_contains(' ' . $s . ' ', ' ' . $k . ' '))) return ['p' => $p, 'how' => 'name'];
      }
    }
    // пункту в адресі немає, а починається вона з вулиці / номера — це Харків (так пишуть харків'яни)
    if (preg_match(self::STREET, $segs[0])) foreach ((array)(self::data()['places'] ?? []) as $p) if ($p['id'] === 'kharkiv') return ['p' => $p, 'how' => 'default'];
    return null;
  }
  /** Відповідь застосунку: пункт, по видах — хто й тариф (з джерелом), загальнодержавне для світла й газу. */
  public static function lookup(string $addr): array {
    $addr = trim(mb_substr($addr, 0, 160)); $d = self::data(); $nat = (array)($d['national'] ?? []);
    if ($addr === '') return ['found' => false, 'reason' => 'empty', 'national' => $nat, 'updated' => $d['updated'] ?? null];
    $m = self::match($addr);
    if (!$m) return ['found' => false, 'reason' => 'place', 'national' => $nat, 'updated' => $d['updated'] ?? null];
    $p = $m['p']; $kinds = [];
    foreach (['elec', 'gas', 'water', 'heat'] as $k) if (isset($p[$k])) $kinds[$k] = $p[$k];
    return ['found' => true, 'how' => $m['how'], 'place' => ['id' => $p['id'], 'name' => $p['names'][0], 'kind' => $p['kind'] ?? '', 'hromada' => $p['hromada'] ?? '', 'district' => $p['district'] ?? ''],
      'kinds' => $kinds, 'national' => $nat, 'updated' => $d['updated'] ?? null];
  }
}
