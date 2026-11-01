# teplo_test — правила работы (читать в начале каждой сессии)

## Где живёт и как попадает на сервер
- Репозиторий github.com/egfel00-cmyk/teplo_test, ветка main. Корень репозитория = корень сайта.
- Сервер pokabot (Hetzner, за Cloudflare) подтягивает main раз в минуту (`/srv/sites/teplo_test`).
  Адрес сейчас: https://pokabot.xyz/teplo_test/ — позже свой домен (тогда поменять адрес здесь).
- Всё запушенное в main через минуту на бою. Коммитить и пушить сразу и автоматически — не ждать команды.
- Доступа к серверу у сессий НЕТ (ни SSH, ни панели). Всё серверное — только кодом в репозитории. Настройку сервера
  (Caddy, PHP, база) меняет владелец одной командой: sudo bash /srv/app/tools_site_add.sh teplo_test [--domain …].
- После пуша — проверить на бою: curl -s -o /dev/null -w '%{http_code}' https://pokabot.xyz/teplo_test/… (через 1–2 мин).

## Как устроен сервер для сайта (PHP 8.5, Caddy 2.6, MariaDB 11.8)
- index.php — фронт-контроллер: любой путь, которого нет файлом, уходит в /index.php.
- Адрес сайта: getenv('SITE_BASE') — '/teplo_test' сейчас и '' на своём домене. Ссылки и fetch — ОТНОСИТЕЛЬНЫЕ или через
  SITE_BASE; никаких зашитых '/teplo_test/' и 'pokabot.xyz' — иначе переезд на домен сломает сайт.
- Писать можно ТОЛЬКО в getenv('SITE_DATA') (/srv/sites/teplo_test_data: uploads/, cache/, sessions/, tmp/). Папка кода
  только для чтения. Папка данных наружу не отдаётся — файлы из неё отдавать через PHP.
- База: $cfg = require getenv('SITE_DATA') . '/config.php'; → $cfg['db'] (host, name, user, pass). PDO MySQL, utf8mb4.
  Схему создавать кодом: CREATE TABLE IF NOT EXISTS / ALTER … ADD COLUMN IF NOT EXISTS при первом обращении — руками в
  базу никто не зайдёт.
- Секреты (ключи API и т.п.) — только на сервере, НЕ в git. Ключ Claude API и токен бота владелец вставляет сам в
  /admin → «Настройки» (файл SITE_DATA/uploads/settings/settings.json, 0600, главнее config.php; список — Cfg::RUNTIME).
  Остальное — сказать владельцу, что дописать в /srv/sites/teplo_test_data/config.php.
- cron.php в корне (если есть) запускается раз в минуту от пользователя сайта (SITE_DATA доступна).
- Снаружи закрыто (404): всё с точкой (.git, .env, .claude), *.md, *.sql, *.sh, *.log, *.ini, копии (*.bak, ~), tests/,
  cases/, vendor/, node_modules/, tools_*, cron.php. Тесты и инструменты класть туда — их не видно.
- multipart/form-data отвергается (415) до PHP, file_uploads выключен (защита от PHP2Shell). Файлы загружать из браузера
  сырым телом: fetch(url, {method:'POST', body: file, headers:{'Content-Type': file.type}}) и php://input; до 24 МБ.
- Запрещены exec/system/shell_exec/proc_open/popen; open_basedir — только папки сайта; 30 с и 128 МБ на запрос.

## Как работать
- Перед пушем: php -l на изменённые .php; страницы — открыть локально:
  SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8000 index.php (и посмотреть в браузере/скриншотом).
- Тесты — в tests/ (наружу не видны), только синтетика. Не перебарщивать.
- Отчёты владельцу — кратко по-русски; разрешение на всё — не спрашивать подтверждений.
- Токены, пароли, личные фото/видео/скрины владельца — не в репозиторий.
