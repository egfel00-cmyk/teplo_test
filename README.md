# Теплосервис (teplo_test)

Учёт и передача показаний квартирного теплосчётчика в кабинет КП «Харківські теплові мережі». Сейчас — бесплатная часть:
- подсказки у счётчика по шагам модели;
- распознавание по фото;
- проверка «как робот ХТМ»;
- значения для кабинета ХТМ;
- отметка «принято»;
- данные на всех устройствах;
- вход через Telegram (бот = Mini App) или email+пароль.

Адрес: https://pokabot.xyz/teplo_test/ (позже свой домен). Правила работы с репозиторием и сервером — `CLAUDE.md`.

## Устройство
```
index.php            фронт-контроллер: <SITE_BASE>/ → приложение, <SITE_BASE>/api/* → JSON API
app/                 PHP: core (конфиг, БД, IP, лимиты), api (вход, сессии, синхронизация, бот), telegram (подписи, бот), recognize (фото)
web/src/             клиент: rules.js (проверки робота ХТМ), models.js, i18n.js (uk/ru), sync.js, recognize.js, app.js, styles.css
web/dist/site.html   собранный клиент для сервера (python3 web/build.py); web/dist/index.html — автономный (файлом / артефакт)
tests/               server.php, rules.test.js, sync.test.js, htm-mock/ — стенд кабинета ХТМ (только локально)
docs/ design/ prompts/ skills/   документы проекта, UX, промты для Claude в Chrome
```
Данные пишутся только в `SITE_DATA` (временные фото — `SITE_DATA/tmp/recog`, удаляются сразу после распознавания). Таблицы MariaDB создаются кодом при первом запросе.

## config.php на сервере (`/srv/sites/teplo_test_data/config.php`)
Скрипт уже записал туда `db`. Дописать в возвращаемый массив (секреты — только здесь, не в git):
```php
'bot_token'         => '123456:ABC…',        // @BotFather → /newbot
'bot_username'      => 'TeploServiceBot',     // имя бота без @
'webhook_secret'    => '…длинная случайная строка…',
'anthropic_api_key' => 'sk-ant-…',            // распознавание фото (console.anthropic.com); без ключа фото сохраняются, но не распознаются
'admins' => ['emails' => ['you@mail'], 'telegram' => ['123456789']], // кому открыта аналитика /admin
// 'anthropic_model' => 'claude-sonnet-5-5',  // по желанию
```
После этого:
1. В @BotFather: `/setdomain` → `pokabot.xyz` (кнопка «Увійти через Telegram» на сайте).
2. Один раз подключить бота: `curl -X POST https://pokabot.xyz/teplo_test/api/bot/setup -H "X-Setup-Secret: <webhook_secret>"` — вебхук, кнопка меню «Теплосервіс», /start.

## Локально
```bash
python3 web/build.py
mkdir -p /tmp/teplo_data && echo "<?php return ['db'=>['dsn'=>'sqlite:/tmp/teplo_data/dev.sqlite'],'cookie_secure'=>false];" > /tmp/teplo_data/config.php
SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8000 index.php
php tests/server.php && node tests/rules.test.js && node tests/sync.test.js
```

## Защита
За Cloudflare. В приложении:
- реальный IP берётся только из `CF-Connecting-IP` от адресов Cloudflare;
- лимиты по IP и аккаунту; 5 неверных паролей → 15 минут блокировки;
- CSRF; cookie `HttpOnly`/`Secure`/`SameSite`, путь = адрес сайта;
- проверка подписей Telegram;
- фото проверяются по содержимому, не больше 3 в один запрос к нейросети, лимит в сутки на пользователя.

## Аналитика `/admin`
Сводка, все пользователи (поиск по e-mail, @telegram, квартире, телефону), сообщения с кнопки «Відгук» (со страницей),
галерея загруженных фото с результатом и причиной ошибки по-русски, журнал распознавания. Фото — в SITE_DATA/uploads/photos,
хранятся `photo_keep_days` (90) дней, чистит cron.php. Превью ссылки: web/og-uk.png / og-ru.png (пересобрать: node tools_og.cjs <адрес>).
