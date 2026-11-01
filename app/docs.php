<?php
// Документы к счётчику (паспорт, свидетельство о поверке): фото или PDF, только своему аккаунту.
// Файлы — SITE_DATA/uploads/docs/<user>/, наружу не отдаются; отдаём через PHP только владельцу.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Docs {
  const KINDS = ['passport', 'verification', 'other'];
  const IMG = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
  const MAX_PER_USER = 60;

  public static function root(): string { return (Cfg::data() ?: sys_get_temp_dir() . '/teplo_data') . '/uploads/docs'; }
  private static function path(array $d): string { return self::root() . '/' . (int)$d['user_id'] . '/' . basename((string)$d['file']); }
  private static function place(string $p): string { return preg_match('/^[A-Za-z0-9_-]{1,40}$/', $p) ? $p : 'main'; }

  public static function upload(int $uid, string $body, string $ctype, array $q): array {
    $ctype = strtolower(trim(explode(';', $ctype)[0])); $kind = in_array($q['kind'] ?? '', self::KINDS, true) ? $q['kind'] : 'other';
    if ($body === '') throw new HttpError(415, 'bad_file');
    if ($ctype === 'application/pdf') { if (!str_starts_with($body, '%PDF-')) throw new HttpError(415, 'bad_file'); $mime = 'application/pdf'; $ext = 'pdf'; }
    else { $info = @getimagesizefromstring($body); if (!$info || !isset(self::IMG[$info['mime'] ?? ''])) throw new HttpError(415, 'bad_file'); $mime = $info['mime']; $ext = self::IMG[$mime]; }
    if ((int)(Db::one('SELECT COUNT(*) n FROM docs WHERE user_id = ?', [$uid])['n'] ?? 0) >= self::MAX_PER_USER) throw new HttpError(429, 'too_many_docs');
    $dir = self::root() . '/' . $uid; if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) throw new HttpError(500, 'storage');
    $id = bin2hex(random_bytes(12)); $file = $id . '.' . $ext;
    if (file_put_contents($dir . '/' . $file, $body) === false) throw new HttpError(500, 'storage');
    $name = mb_substr(trim((string)($q['name'] ?? '')), 0, 120) ?: null;
    Db::q('INSERT INTO docs (id, user_id, place, kind, file, mime, bytes, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [$id, $uid, self::place((string)($q['place'] ?? 'main')), $kind, $file, $mime, strlen($body), $name, Http::iso()]);
    return ['doc' => self::one($uid, $id)];
  }
  private static function pub(array $d): array { return ['id' => $d['id'], 'place' => $d['place'], 'kind' => $d['kind'], 'mime' => $d['mime'], 'bytes' => (int)$d['bytes'], 'name' => $d['name'], 'createdAt' => $d['created_at']]; }
  private static function one(int $uid, string $id): ?array { $d = Db::one('SELECT * FROM docs WHERE id = ? AND user_id = ?', [$id, $uid]); return $d ? self::pub($d) : null; }
  public static function list(int $uid): array { return ['docs' => array_map([self::class, 'pub'], Db::q('SELECT * FROM docs WHERE user_id = ? ORDER BY created_at DESC', [$uid])->fetchAll())]; }
  public static function file(int $uid, string $id): array {
    if (!preg_match('/^[a-f0-9]{24}$/', $id)) throw new HttpError(404, 'not_found');
    $d = Db::one('SELECT * FROM docs WHERE id = ? AND user_id = ?', [$id, $uid]);
    if (!$d || !is_file(self::path($d))) throw new HttpError(404, 'not_found');
    return ['path' => self::path($d), 'mime' => $d['mime']];
  }
  public static function delete(int $uid, string $id): array {
    $d = preg_match('/^[a-f0-9]{24}$/', $id) ? Db::one('SELECT * FROM docs WHERE id = ? AND user_id = ?', [$id, $uid]) : null;
    if (!$d) throw new HttpError(404, 'not_found');
    @unlink(self::path($d)); Db::q('DELETE FROM docs WHERE id = ?', [$id]);
    return ['ok' => true];
  }
}
