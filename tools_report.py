# Использование: python3 -I tools_report.py <страница.html> app/data/reports/<файл>.html web/fonts — затем строка в Reports::LIST (app/reports.php).
# Статическая копия страницы конкурентов: графики уже нарисованы (без JavaScript), шрифты IBM Plex — внутри (data:), noindex.
import base64, re, sys
from playwright.sync_api import sync_playwright
SRC, OUT, FONTS = sys.argv[1], sys.argv[2], sys.argv[3]
def b64(n): return base64.b64encode(open(f'{FONTS}/{n}', 'rb').read()).decode()
CYR = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'
LAT = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
ff = ''
for fam, w, cyr, lat in [('IBM Plex Sans', '400 600', 'plex-sans-cyr.woff2', 'plex-sans-lat.woff2'), ('IBM Plex Mono', '500 600', 'plex-mono-cyr-500.woff2', 'plex-mono-lat-500.woff2')]:
    for f, r in [(cyr, CYR), (lat, LAT)]:
        ff += '@font-face{font-family:"%s";font-style:normal;font-weight:%s;font-display:swap;src:url(data:font/woff2;base64,%s) format("woff2");unicode-range:%s}\n' % (fam, w, b64(f), r)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900})
    pg.route('**/fonts.*/**', lambda r: r.abort())
    pg.goto('file://' + SRC); pg.wait_for_timeout(300)
    pg.evaluate("document.querySelectorAll('script, link[href*=\"fonts.g\"]').forEach(function (e) { e.remove(); })")
    html = '<!DOCTYPE html>\n' + pg.evaluate('document.documentElement.outerHTML')
    b.close()
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex, nofollow">\n<meta name="referrer" content="no-referrer">', 1)
html = html.replace('<style>', '<style>\n' + ff, 1)
assert '<script' not in html and 'fonts.googleapis' not in html
open(OUT, 'w', encoding='utf-8').write(html)
print(len(html))
