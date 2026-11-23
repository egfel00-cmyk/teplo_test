<?php
// Документы к счётчику (паспорт, свидетельство о поверке) и платёжки к записям истории: фото или PDF, только своему аккаунту.
// 186-я: в спільній квартирі документы — общие: лежат у власника квартиры (by_user — кто добавил), видят все, кто её ведёт;
// прибрать — кто добавил или власник. Старые (до 186-й) документы участника в его копии `sh<N>` тоже видны остальным.
// Файлы — SITE_DATA/uploads/docs/<user>/, наружу не отдаются; отдаём через PHP только владельцу.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Docs {
  const KINDS = ['passport', 'verification', 'other', 'bill'];
  const IMG = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
  const MAX_PER_USER = 500;    // платёжки — по файлу-двум на каждое снятие показаний, за годы
  const LINK_TTL = 900;        // подписанная ссылка на файл (Telegram открывает PDF во внешнем браузере — без cookie)

  public static function root(): string { return (Cfg::data() ?: sys_get_temp_dir() . '/teplo_data') . '/uploads/docs'; }
  private static function path(array $d): string { return self::root() . '/' . (int)$d['user_id'] . '/' . basename((string)$d['file']); }
  private static function place(string $p): string { return preg_match('/^[A-Za-z0-9_-]{1,40}$/', $p) ? $p : 'main'; }

  public static function upload(int $uid, string $body, string $ctype, array $q): array {
    $ctype = strtolower(trim(explode(';', $ctype)[0])); $kind = in_array($q['kind'] ?? '', self::KINDS, true) ? $q['kind'] : 'other';
    if ($body === '') throw new HttpError(415, 'bad_file');
    if ($ctype === 'application/pdf') { if (!str_starts_with($body, '%PDF-')) throw new HttpError(415, 'bad_file'); $mime = 'application/pdf'; $ext = 'pdf'; }
    else { $info = @getimagesizefromstring($body); if (!$info || !isset(self::IMG[$info['mime'] ?? ''])) throw new HttpError(415, 'bad_file'); $mime = $info['mime']; $ext = self::IMG[$mime]; }
    if ((int)(Db::one('SELECT COUNT(*) n FROM docs WHERE user_id = ?', [$uid])['n'] ?? 0) >= self::MAX_PER_USER) throw new HttpError(429, 'too_many_docs');
    $meter = preg_match('/^[A-Za-z0-9_-]{1,40}$/', (string)($q['meter'] ?? '')) ? (string)$q['meter'] : null;   // лічильник квартири: heat або id водоміра / світла / газу
    // 186-я: спільна квартира — документ належить квартирі: лежить у власника (його копія квартири), хто додав — by_user
    $place = self::place((string)($q['place'] ?? 'main')); $at = self::home($uid, $place);
    if ($at[0] !== $uid && (int)(Db::one('SELECT COUNT(*) n FROM docs WHERE user_id = ?', [$at[0]])['n'] ?? 0) >= self::MAX_PER_USER) throw new HttpError(429, 'too_many_docs');
    $doc = self::put($at[0], $body, $mime, $ext, $at[1], $kind, mb_substr(trim((string)($q['name'] ?? '')), 0, 120) ?: null, ($meter ? ['meter' => $meter] : []) + ($at[0] !== $uid ? ['by' => $uid] : []));
    return ['doc' => ['place' => $place, 'del' => true] + $doc];
  }
  /** Де лежать документи квартири pid людини uid: спільна — у власника [його uid, його pid], інакше — [uid, pid]. */
  private static function home(int $uid, string $pid): array {
    if (!class_exists('Share', false)) return [$uid, $pid];
    try { $o = Db::one("SELECT o.user_id, o.pid FROM share_members m JOIN share_members o ON o.share_id = m.share_id AND o.role = 'owner' WHERE m.user_id = ? AND m.pid = ?", [$uid, $pid]); }
    catch (Throwable $e) { return [$uid, $pid]; }
    return $o ? [(int)$o['user_id'], (string)$o['pid']] : [$uid, $pid];
  }
  /** Може прибрати: свій (у своєму акаунті чи доданий ним у спільній) або власник спільної квартири, де документ лежить. */
  private static function canDel(int $uid, array $d): bool {
    if ((int)$d['user_id'] === $uid || (int)($d['by_user'] ?? 0) === $uid) return true;
    try { return (bool)Db::one("SELECT 1 AS x FROM share_members m JOIN share_members o ON o.share_id = m.share_id AND o.role = 'owner' WHERE m.user_id = ? AND m.pid = ? AND o.user_id = ?", [(int)$d['user_id'], (string)$d['place'], $uid]); }
    catch (Throwable $e) { return false; }
  }
  /** Сохранить файл и строку docs. meta — для скачанных сервером сами: src (vk), ym (за какой месяц), sha (отпечаток); meter — к какому счётчику. */
  public static function put(int $uid, string $body, string $mime, string $ext, string $place, string $kind, ?string $name, array $meta = []): array {
    $dir = self::root() . '/' . $uid; if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) throw new HttpError(500, 'storage');
    $id = bin2hex(random_bytes(12)); $file = $id . '.' . $ext;
    if (file_put_contents($dir . '/' . $file, $body) === false) throw new HttpError(500, 'storage');
    Db::q('INSERT INTO docs (id, user_id, place, kind, file, mime, bytes, name, created_at, src, ym, sha, meter, by_user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [$id, $uid, self::place($place), $kind, $file, $mime, strlen($body), $name, Http::iso(), $meta['src'] ?? null, $meta['ym'] ?? null, $meta['sha'] ?? null, $meta['meter'] ?? null, isset($meta['by']) ? (int)$meta['by'] : null]);
    return self::one($uid, $id);
  }
  public static function bySha(int $uid, string $sha): ?array { $d = Db::one('SELECT * FROM docs WHERE user_id = ? AND sha = ?', [$uid, $sha]); return $d ? self::pub($d) : null; }
  private static function pub(array $d): array { return ['id' => $d['id'], 'place' => $d['place'], 'meter' => $d['meter'] ?? null, 'kind' => $d['kind'], 'mime' => $d['mime'], 'bytes' => (int)$d['bytes'], 'name' => $d['name'], 'createdAt' => $d['created_at']] + (!empty($d['src']) ? ['src' => $d['src'], 'ym' => $d['ym'] ?? null] : []); }
  private static function one(int $uid, string $id): ?array { $d = Db::one('SELECT * FROM docs WHERE id = ? AND user_id = ?', [$id, $uid]); return $d ? self::pub($d) : null; }
  /** Свої документи + документи спільних квартир від інших її людей (place — копія цієї людини; del — чи може прибрати). */
  public static function list(int $uid): array {
    $out = array_map(fn($d) => self::pub($d) + ['del' => true], Db::q('SELECT * FROM docs WHERE user_id = ? ORDER BY created_at DESC', [$uid])->fetchAll());
    if (class_exists('Share', false)) foreach (Share::pidsOf($uid) as $pid) foreach (Share::mates($uid, $pid) as [$u2, $p2])
      foreach (Db::q("SELECT * FROM docs WHERE user_id = ? AND place = ? AND kind <> 'bill' ORDER BY created_at DESC", [$u2, $p2])->fetchAll() as $d)
        $out[] = ['place' => $pid, 'del' => self::canDel($uid, $d), 'sh' => true] + self::pub($d);
    usort($out, fn($a, $b) => strcmp((string)$b['createdAt'], (string)$a['createdAt']));
    return ['docs' => $out];
  }
  public static function file(int $uid, string $id): array {
    if (!preg_match('/^[a-f0-9]{24}$/', $id)) throw new HttpError(404, 'not_found');
    $d = Db::one('SELECT * FROM docs WHERE id = ?', [$id]);
    // 179-я: платіжка запису спільної квартири — і іншим її учасникам
    if ($d && (int)$d['user_id'] !== $uid && !(class_exists('Share', false) && Share::together($uid, (int)$d['user_id']))) $d = null;
    if (!$d || !is_file(self::path($d))) throw new HttpError(404, 'not_found');
    return ['path' => self::path($d), 'mime' => $d['mime'], 'owner' => (int)$d['user_id']];
  }
  /** Ссылка на файл без входа, на LINK_TTL секунд: ?id=&e=&s= (HMAC от id, владельца и срока). */
  public static function link(int $uid, string $id): array {
    $f = self::file($uid, $id);
    $e = time() + self::LINK_TTL;
    return ['url' => 'docs/open?id=' . $id . '&e=' . $e . '&s=' . self::sig($id, (int)$f['owner'], $e)];
  }
  private static function sig(string $id, int $uid, int $e): string { return substr(hash_hmac('sha256', $id . '|' . $uid . '|' . $e, Cfg::secret()), 0, 32); }
  public static function open(array $q): array {
    $id = (string)($q['id'] ?? ''); $e = (int)($q['e'] ?? 0); $s = (string)($q['s'] ?? '');
    $d = preg_match('/^[a-f0-9]{24}$/', $id) && $e >= time() ? Db::one('SELECT * FROM docs WHERE id = ?', [$id]) : null;
    if (!$d || !hash_equals(self::sig($id, (int)$d['user_id'], $e), $s) || !is_file(self::path($d))) throw new HttpError(404, 'not_found');
    return ['path' => self::path($d), 'mime' => $d['mime']];
  }
  public static function delete(int $uid, string $id): array {
    $d = preg_match('/^[a-f0-9]{24}$/', $id) ? Db::one('SELECT * FROM docs WHERE id = ?', [$id]) : null;
    if (!$d || !self::canDel($uid, $d)) throw new HttpError(404, 'not_found');
    @unlink(self::path($d)); Db::q('DELETE FROM docs WHERE id = ?', [$id]);
    return ['ok' => true];
  }
}
