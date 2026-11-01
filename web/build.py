#!/usr/bin/env python3
"""Собирает web/src/* в один файл, два варианта:
  web/dist/index.html — автономный (открыть файлом, опубликовать как артефакт): данные в браузере / через Claude;
  web/dist/site.html  — для сервера: его отдаёт index.php, подставляя адрес API из SITE_BASE
                        (вход через Telegram или email, синхронизация, Telegram Mini App, распознавание фото).
Запуск: python3 web/build.py
"""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
SERVER_HEAD = ('<script src="https://telegram.org/js/telegram-web-app.js"></script>\n'
               "<script>window.TEPLO_API = '__TEPLO_API__'; window.TEPLO_BUILD = '__TEPLO_BUILD__';</script>")


def build(server: bool) -> str:
    html = (SRC / "index.html").read_text(encoding="utf-8")
    css = (SRC / "styles.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")
    html = html.replace("<!--SERVER_HEAD-->", SERVER_HEAD if server else "")

    def inline(m: re.Match) -> str:
        js = (SRC / m.group(1)).read_text(encoding="utf-8")
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
