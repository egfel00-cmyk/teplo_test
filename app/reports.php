<?php
// Отчёты владельца — готовые статические страницы (без JavaScript, шрифты внутри): app/data/reports/*.html.
//   публично по ссылке: <SITE_BASE>/r/<адрес> (noindex — в поиск не попадают; ссылку знает тот, кому её дали);
//   в /admin → «Отчёты»: GET /api/admin/pages (список), GET /api/admin/page?id=<id> (страница; только админам).
// 148-я сессия: разбор конкурентов (владелец 14.11: «загрузи на сервер, ссылка для всех, у кого она есть, и продублируй в админке»).
// Новый отчёт: страница → tools: prerender (см. docs/конкуренты.md) → файл сюда → строка в LIST.
declare(strict_types=1);
defined('TEPLO') || exit;

final class Reports {
  /** id → [публичный адрес после /r/ (пусто — только в /admin), файл, название, дата] */
  public const LIST = [
    'konkurenty' => ['konkurenty-542de334', 'konkurenty-2026-11.html', 'Разбор конкурентов', '2026-11-14'],
  ];

  public static function file(string $id): ?string {
    $r = self::LIST[$id] ?? null;
    if (!$r) return null;
    $f = __DIR__ . '/data/reports/' . $r[1];
    return is_file($f) ? $f : null;
  }

  /** Отчёт по публичному адресу (/r/<slug>) или null. */
  public static function bySlug(string $slug): ?string {
    foreach (self::LIST as $id => $r) if ($r[0] !== '' && hash_equals($r[0], $slug)) return self::file($id);
    return null;
  }

  /** Для /admin: список без путей к файлам; публичный адрес — `slug` (приложение дописывает к адресу сайта r/). */
  public static function index(): array {
    $out = [];
    foreach (self::LIST as $id => $r) $out[] = ['id' => $id, 'title' => $r[2], 'date' => $r[3], 'slug' => $r[0] !== '' ? $r[0] : null, 'ok' => self::file($id) !== null];
    return $out;
  }

  /** Отдать страницу по публичной ссылке: только статика (нет скриптов), стили и шрифты внутри — CSP закрывает всё остальное.
   *  В /admin та же страница идёт через Res->file (index.php: `sandbox`, тот же набор). */
  public static function send(string $file, bool $pub): void {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: ' . ($pub ? 'public, max-age=600' : 'private, no-cache'));
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: no-referrer');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'" . ($pub ? '' : "; frame-ancestors 'self'"));
    header('Content-Length: ' . filesize($file));
    readfile($file);
  }
}
