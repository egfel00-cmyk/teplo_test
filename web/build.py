#!/usr/bin/env python3
"""Собирает web/src/* в один файл, два варианта:
  web/dist/index.html — автономный (открыть файлом, опубликовать как артефакт): данные в браузере / через Claude;
  web/dist/site.html  — для сервера: его отдаёт index.php, подставляя адрес API из SITE_BASE
                        (вход через Telegram или email, синхронизация, Telegram Mini App, распознавание фото).
Запуск: python3 web/build.py
"""
import pathlib, re, subprocess

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
SERVER_HEAD = ('<script src="https://telegram.org/js/telegram-web-app.js"></script>\n'
               "<script>window.TEPLO_API = '__TEPLO_API__'; window.TEPLO_BUILD = '__TEPLO_BUILD__';</script>")
# Шрифты: сайт — со своего сервера (web/fonts, IP посетителя не уходит Google); автономный файл (открыть без сервера) — по-прежнему Google Fonts
GOOGLE_FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
                '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
                '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">')


def own_fonts() -> str:
    css = (ROOT / "fonts" / "fonts.css").read_text(encoding="utf-8")
    css = re.sub(r"^/\*.*?\*/\s*", "", css, flags=re.S).replace("url(plex-", "url(web/fonts/plex-")
    pre = "".join(f'<link rel="preload" href="web/fonts/{f}" as="font" type="font/woff2" crossorigin>\n' for f in ("plex-sans-cyr.woff2", "plex-sans-lat.woff2"))
    return pre + "<style>\n" + css.strip() + "\n</style>"


_PROV = None


def prov_counts() -> str:
    global _PROV
    if _PROV is None:
        try:
            r = subprocess.run(["php", str(ROOT.parent / "tools_prov_counts.php")], capture_output=True, text=True, timeout=60)
            _PROV = r.stdout.strip() if r.returncode == 0 and r.stdout.strip().startswith("[") else "null"
        except Exception:
            _PROV = "null"
    return _PROV


def build(server: bool) -> str:
    html = (SRC / "index.html").read_text(encoding="utf-8")
    css = (SRC / "styles.css").read_text(encoding="utf-8")
    html = html.replace("<!--FONTS-->", own_fonts() if server else GOOGLE_FONTS)
    html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")
    html = html.replace("<!--SERVER_HEAD-->", SERVER_HEAD if server else "")

    def inline(m: re.Match) -> str:
        js = (SRC / m.group(1)).read_text(encoding="utf-8")
        if "null/*LP_PROV*/" in js:   # лендинг: громади довідника по областях (tools_prov_counts.php); без php — блок без чисел
            js = js.replace("null/*LP_PROV*/", prov_counts())
        return "<script>\n" + js.replace("</script", "<\\/script") + "\n</script>"

    return re.sub(r'<script src="([a-z0-9]+\.js)"></script>', inline, html)


def main() -> None:
    for server, out in [(False, ROOT / "dist" / "index.html"), (True, ROOT / "dist" / "site.html")]:
        out.parent.mkdir(parents=True, exist_ok=True)
        html = build(server)
        out.write_text(html, encoding="utf-8")
        print(f"{out} — {len(html.encode('utf-8')) // 1024} КБ")


if __name__ == "__main__":
    main()
