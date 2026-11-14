<?php
// 149-я (план конкурентов, п. 1, docs/конкуренты.md): сторінки для пошуку — «Як зняти показання <модель>», сервером, без скриптів, uk + ru.
//   /yak-znyaty-pokaznannya            — усі моделі (uk)     /ru/kak-snyat-pokazaniya            — (ru)
//   /yak-znyaty-pokaznannya/<модель>   — кроки моделі (uk)   /ru/kak-snyat-pokazaniya/<модель>   — (ru)
// Дані — app/data/seo/models.json (node tools_seo.cjs з web/src/models.js). Адреси — у sitemap.xml з hreflang; посилання з лендингу.
declare(strict_types=1);
defined('TEPLO') || exit;

final class Seo {
  public const UK = '/yak-znyaty-pokaznannya', RU = '/ru/kak-snyat-pokazaniya';
  private static ?array $data = null;

  public static function data(): array {
    if (self::$data === null) { $j = json_decode((string)@file_get_contents(__DIR__ . '/data/seo/models.json'), true); self::$data = is_array($j) ? $j : ['models' => []]; }
    return self::$data;
  }
  /** Адреса → [lang, slug|''] або null. */
  public static function match(string $path): ?array {
    $p = rtrim($path, '/');
    foreach (['uk' => self::UK, 'ru' => self::RU] as $l => $pre) {
      if ($p === $pre) return [$l, ''];
      if (preg_match('~^' . preg_quote($pre, '~') . '/([a-z0-9-]{2,40})$~', $p, $m)) return [$l, $m[1]];
    }
    return null;
  }
  public static function model(string $slug): ?array { foreach (self::data()['models'] ?? [] as $m) if ($m['slug'] === $slug) return $m; return null; }
  public static function url(string $lang, string $slug = ''): string { return ($lang === 'ru' ? self::RU : self::UK) . ($slug !== '' ? '/' . $slug : ''); }

  /** Для sitemap.xml: [[uk-адреса, ru-адреса]] (без адреси сайту). */
  public static function pairs(): array {
    $o = [[self::url('uk'), self::url('ru')]];
    foreach (self::data()['models'] ?? [] as $m) $o[] = [self::url('uk', $m['slug']), self::url('ru', $m['slug'])];
    return $o;
  }

  private static function e(string $s): string { return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
  private static function wordmark(): string {
    $w = self::data()['wm'] ?? null; if (!$w) return '<b>передай</b>';
    return '<svg class="wm" viewBox="' . self::e((string)$w['vb']) . '" role="img" aria-label="передай"><defs><linearGradient id="wmg" gradientUnits="userSpaceOnUse" x1="' . (float)$w['g'][0] . '" y1="0" x2="' . (float)$w['g'][1] . '" y2="0">' .
      '<stop offset="0" stop-color="#FF6A1F"/><stop offset=".5" stop-color="#B44DFF"/><stop offset="1" stop-color="#2E86FF"/></linearGradient></defs>' .
      '<path fill="currentColor" d="' . self::e((string)$w['d']) . '"/><path fill="none" stroke="url(#wmg)" stroke-width="' . (float)$w['bw'] . '" stroke-linecap="round" d="' . self::e((string)$w['b']) . '"/></svg>';
  }
  private const CSS = <<<'CSS'
:root{--bg:#E9EEEB;--card:#fff;--ink:#17211E;--ink2:#4A5652;--line:#CFD7D3;--lcd:#BCC8A2;--lcd-ink:#1C2618;--ok:#18693F;--ok-s:#DFF1E7;--warn:#8F5600;--warn-s:#FBEFD5;--info:#173A61;--info-s:#E2ECF8;--btn:#17211E;--on-btn:#fff;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#101614;--card:#18201D;--ink:#E8EEEB;--ink2:#A9B5B0;--line:#2E3935;--lcd:#9FAE80;--ok:#7FD3A2;--ok-s:#173126;--warn:#F2C26B;--warn-s:#33280F;--info:#A9C8F0;--info-s:#172638;--btn:#E8EEEB;--on-btn:#101614;color-scheme:dark}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit;text-underline-offset:3px}.w{max-width:760px;margin:0 auto;padding:0 20px}
header{padding:18px 0}header .w{display:flex;align-items:center;justify-content:space-between;gap:12px}.home{display:flex;align-items:center;gap:10px;text-decoration:none}.home img{width:30px;height:30px;border-radius:8px}
.wm{height:22px;width:auto;display:block}.lng{font-size:15px;color:var(--ink2)}
nav.bc{font-size:15px;color:var(--ink2);margin:8px 0 4px}nav.bc a{color:var(--ink2)}
h1{font-size:30px;line-height:1.2;margin:6px 0 8px;letter-spacing:-.01em}h2{font-size:21px;line-height:1.3;margin:0 0 10px}
.sub{color:var(--ink2);margin:0 0 14px}.pill{display:inline-block;font-size:14px;font-weight:600;padding:3px 12px;border-radius:999px;background:var(--info-s);color:var(--info)}
.pill.verified{background:var(--ok-s);color:var(--ok)}.pill.draft{background:var(--warn-s);color:var(--warn)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:16px 0}
ol.steps{list-style:none;counter-reset:s;margin:0;padding:0}ol.steps>li{counter-increment:s;display:grid;grid-template-columns:34px 1fr;gap:4px 12px;padding:14px 0;border-top:1px solid var(--line)}
ol.steps>li:first-child{border-top:0;padding-top:2px}ol.steps>li::before{content:counter(s);grid-row:span 4;width:34px;height:34px;border-radius:50%;background:var(--ink);color:var(--card);display:grid;place-items:center;font-weight:600;font-size:16px}
.act{font-weight:600;margin:4px 0 0}.lcdrow{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 2px}
.lcd{font:500 20px/1 "IBM Plex Mono",ui-monospace,monospace;background:var(--lcd);color:var(--lcd-ink);border-radius:10px;padding:9px 12px;letter-spacing:.04em;display:inline-flex;align-items:baseline;gap:8px}
.lcd small{font-size:13px;letter-spacing:0}.ex{align-self:center;font-size:13px;color:var(--ink2)}.fl{margin:2px 0 0;color:var(--ink2);font-size:15px}.fl b{color:var(--ink);font-weight:600}.hint{margin:4px 0 0}
.o3{font-size:14px;color:var(--warn)}.cta{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 16px;margin:24px 0}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border-radius:12px;background:var(--btn);color:var(--on-btn);font-weight:600;text-decoration:none;margin-top:6px}
ul.ml{list-style:none;padding:0;margin:0;columns:2 260px;column-gap:24px}ul.ml li{break-inside:avoid;padding:7px 0;border-top:1px solid var(--line)}ul.ml li span{display:block;font-size:14px;color:var(--ink2)}
.muted{color:var(--ink2);font-size:15px}footer{padding:24px 0 40px;color:var(--ink2);font-size:15px}footer .wm{height:18px;margin-bottom:8px}
@media (max-width:520px){h1{font-size:25px}ul.ml{columns:1}}
CSS;

  /** Сторінка: html або null (немає такої моделі). $base — SITE_BASE, $site — абсолютна адреса сайту з / в кінці. */
  public static function render(string $lang, string $slug, string $base, string $site): ?string {
    $ru = $lang === 'ru'; $e = [self::class, 'e'];
    $m = $slug !== '' ? self::model($slug) : null; if ($slug !== '' && !$m) return null;
    $abs = fn(string $l, string $s = '') => rtrim($site, '/') . self::url($l, $s);
    if ($m) { $P = $m[$lang]; $title = $P['title']; $desc = $P['desc']; }
    else {
      $n = count(self::data()['models'] ?? []);
      $title = $ru ? "Как снять показания теплосчётчика — $n моделей по шагам" : "Як зняти показання теплолічильника — $n моделей покроково";
      $desc = $ru ? "Найдите свой теплосчётчик по надписи на вычислителе: Sharky, ULTRAHEAT T330, Multical, SENSOSTAR, QALCOSONIC и другие — какие кнопки нажимать и где нужные цифры."
        : "Знайдіть свій теплолічильник за написом на обчислювачі: Sharky, ULTRAHEAT T330, Multical, SENSOSTAR, QALCOSONIC та інші — які кнопки натискати й де потрібні цифри.";
    }
    $other = $ru ? 'uk' : 'ru';
    $h = '<!DOCTYPE html><html lang="' . $lang . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' .
      '<title>' . $e($title) . '</title><meta name="description" content="' . $e($desc) . '"><meta name="robots" content="index, follow">' .
      '<link rel="canonical" href="' . $e($abs($lang, $slug)) . '"><link rel="alternate" hreflang="uk" href="' . $e($abs('uk', $slug)) . '"><link rel="alternate" hreflang="ru" href="' . $e($abs('ru', $slug)) . '">' .
      '<link rel="alternate" hreflang="x-default" href="' . $e($abs('uk', $slug)) . '"><link rel="icon" href="' . $e($base) . '/web/icon/favicon.svg" type="image/svg+xml">' .
      '<meta property="og:type" content="article"><meta property="og:title" content="' . $e($title) . '"><meta property="og:description" content="' . $e($desc) . '"><meta property="og:url" content="' . $e($abs($lang, $slug)) . '">' .
      '<meta property="og:image" content="' . $e($site . 'web/og-' . $lang . '-5.jpg') . '"><meta property="og:locale" content="' . ($ru ? 'ru_UA' : 'uk_UA') . '">' .
      '<link rel="stylesheet" href="' . $e($base) . '/web/fonts/fonts.css"><style>' . self::CSS . '</style>';
    if ($m) {
      $ld = ['@context' => 'https://schema.org', '@type' => 'HowTo', 'name' => $P['h1'], 'description' => $desc, 'inLanguage' => $lang,
        'step' => array_values(array_map(fn($s, $i) => ['@type' => 'HowToStep', 'position' => $i + 1, 'name' => $s['a'], 'text' => trim(($s['f'] ? implode(', ', $s['f']) . '. ' : '') . $s['h'])], $P['steps'], array_keys($P['steps'])))];
      $h .= '<script type="application/ld+json">' . json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . '</script>';
    }
    $h .= '</head><body><header><div class="w"><a class="home" href="' . $e($base) . '/"><img src="' . $e($base) . '/web/icon/favicon.svg" alt="">' . self::wordmark() . '</a>' .
      '<a class="lng" href="' . $e($base . self::url($other, $slug)) . '" hreflang="' . $other . '" lang="' . $other . '">' . ($ru ? 'Українською' : 'Русский') . '</a></div></header><main class="w">';
    $idx = $base . self::url($lang);
    if ($m) {
      $h .= '<nav class="bc" aria-label="' . ($ru ? 'Навигация' : 'Навігація') . '"><a href="' . $e($base) . '/">передай</a> › <a href="' . $e($idx) . '">' . ($ru ? 'Как снять показания' : 'Як зняти показання') . '</a></nav>' .
        '<h1>' . $e($P['h1']) . '</h1>' . ($P['sub'] !== '' ? '<p class="sub">' . $e($P['sub']) . '</p>' : '') .
        ($P['status'] !== '' ? '<p><span class="pill ' . $e($m['status']) . '">' . $e($P['status']) . '</span></p>' : '');
      if ($P['where'] !== '') $h .= '<p><b>' . ($ru ? 'Как узнать модель. ' : 'Як упізнати модель. ') . '</b>' . $e($P['where']) . '</p>';
      $h .= '<p class="muted">' . ($ru ? 'Энергия на табло — в ' : 'Енергія на табло — в ') . $e($P['units']) . ($P['units'] === 'Гкал' ? '.' : ($ru ? '. ХТМ принимает Гкал — приложение пересчитает само.' : '. ХТМ приймає Гкал — застосунок перерахує сам.')) . '</p>';
      $h .= '<section class="card"><h2>' . ($ru ? 'По шагам' : 'Покроково') . '</h2><ol class="steps">';
      foreach ($P['steps'] as $s) {
        $lcd = ''; if ($s['d'] && $s['d']['v'] !== '') {
          $one = fn($d) => '<span class="lcd" aria-hidden="true">' . $e($d['v']) . ($d['u'] !== '' ? '<small>' . $e($d['u']) . '</small>' : '') . '</span>';
          $lcd = '<div class="lcdrow">' . $one($s['d']) . ($s['d']['alt'] ? $one($s['d']['alt']) : '') . '<span class="ex">' . ($ru ? 'пример экрана' : 'приклад екрана') . '</span></div>';
        }
        $h .= '<li><p class="act">' . $e($s['a']) . '</p>' . $lcd .
          ($s['f'] ? '<p class="fl">' . ($ru ? 'Записать: ' : 'Записати: ') . '<b>' . $e(implode(', ', $s['f'])) . '</b></p>' : '') .
          ($s['h'] !== '' ? '<p class="hint">' . $e($s['h']) . '</p>' : '') .
          ($s['only3'] ? '<p class="o3">' . ($ru ? 'Только если в кабинете ХТМ три колонки времени (Bd, Fd, Pd).' : 'Лише якщо в кабінеті ХТМ три колонки часу (Bd, Fd, Pd).') . '</p>' : '') . '</li>';
      }
      $h .= '</ol></section>';
      if ($P['loops'] !== '') $h .= '<section class="card"><h2>' . ($ru ? 'Не видите нужного экрана?' : 'Не бачите потрібного екрана?') . '</h2><p>' . $e($P['loops']) . '</p></section>';
      if ($P['note'] !== '') $h .= '<p class="muted"><b>' . ($ru ? 'Откуда инструкция. ' : 'Звідки інструкція. ') . '</b>' . $e($P['note']) . '</p>';
    } else {
      $h .= '<nav class="bc"><a href="' . $e($base) . '/">передай</a></nav><h1>' . ($ru ? 'Как снять показания теплосчётчика' : 'Як зняти показання теплолічильника') . '</h1>' .
        '<p class="sub">' . ($ru ? 'Найдите модель по надписи на вычислителе (корпус с экраном и кнопкой). Для каждой — какую кнопку и сколько раз нажимать и что записать: энергию, объём, температуры, часы работы. Список — типы, которые принимают ХТМ и другие поставщики тепла.'
          : 'Знайдіть модель за написом на обчислювачі (корпус з екраном і кнопкою). Для кожної — яку кнопку й скільки разів натискати і що записати: енергію, обсяг, температури, години роботи. Список — типи, які приймають ХТМ та інші постачальники тепла.') . '</p>';
    }
    $cta = '<section class="cta"><h2>' . ($ru ? 'Проще — в приложении «передай»' : 'Простіше — у застосунку «передай»') . '</h2><p>' .
      ($ru ? 'Проведёт по этим шагам с картинкой табло, распознает цифры с фото прямо в телефоне, сверит с прошлыми показаниями и подскажет, куда и до какого числа передать. Бесплатно.'
        : 'Проведе цими кроками з картинкою табло, розпізнає цифри з фото прямо в телефоні, звірить з минулими показаннями й підкаже, куди й до якого числа передати. Безкоштовно.') .
      '</p><a class="btn" href="' . $e($base) . '/">' . ($ru ? 'Внести показания' : 'Внести показання') . '</a></section>';
    if ($m) $h .= $cta;
    $h .= '<section><h2>' . ($m ? ($ru ? 'Другие модели' : 'Інші моделі') : ($ru ? 'Модели' : 'Моделі')) . '</h2><ul class="ml">';
    foreach (self::data()['models'] ?? [] as $x) {
      if ($m && $x['slug'] === $m['slug']) continue;
      $h .= '<li><a href="' . $e($base . self::url($lang, $x['slug'])) . '">' . $e($x['name']) . '</a><span>' . $e(trim($x['vendor'] . ($x['status'] !== 'verified' && !$m ? ' · ' . $x[$lang]['status'] : ''), ' ·')) . '</span></li>';
    }
    $h .= '</ul></section>' . ($m ? '' : $cta) . '</main><footer><div class="w">' . self::wordmark() . '<p>' . ($ru ? 'Показания света, воды, газа и тепла — бесплатно, без рекламы. Сервис независимый, не связан с поставщиками.'
      : 'Показання світла, води, газу й тепла — безкоштовно, без реклами. Сервіс незалежний, не пов’язаний з постачальниками.') . '</p></div></footer></body></html>';
    return $h;
  }

  /** index.php: віддати сторінку з заголовками. */
  public static function send(string $html): void {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: public, max-age=3600');
    header("Content-Security-Policy: default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
    echo $html;
  }
}
