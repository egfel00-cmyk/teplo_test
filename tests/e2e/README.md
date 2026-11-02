# Проверки в браузере (синтетика, локальный сервер 127.0.0.1:8013)
- `demo.cjs` — демо-состояние для `localStorage['teplo.v1']`: тепло (4 показания) + водомеры h1/c1, вода апрель–октябрь 2026.
- `node shot.cjs '{"full":true}' history 'history|[data-v=hot]' wrec-w20261015` → `/tmp/shot_*.png` (экран 390×844;
  после `|` — что нажать). Опции: `noHeat`, `view`, `lang`, `dark`.
- `node e2e_water.cjs '{"base":{"h1":"500","c1":"130"},"noSerial":true,"save":true}' /tmp/two_meters.jpg` — ввод воды по фото:
  пачка → раскладка → сохранить → карточка записи с фото. Картинки: `node tests/ocr-lab/water.cjs` (→ tests/ocr-lab/out/),
  два водомера на одном кадре — склеить `w_novator.jpg` и `w_cold.jpg` рядом (PIL), сохранить в /tmp/two_meters.jpg.
- `node e2e_bot.cjs /tmp/two_meters.jpg` — фото водомеров «из бота»: регистрация, загрузка, строка в bot_inbox (sqlite
  /tmp/teplo_data/dev.sqlite), `?inbox=1` → ввод воды, после сохранения входящие пусты, фото на сервере `kept=1`.
- Запуск из папки: `cd tests/e2e && NODE_PATH=$(npm root -g) node …`.
- `node narrow.cjs` — узкие телефоны 320/360/390 px (uk/ru, мобильный режим): ни одна страница не шире экрана
  (`ROUTES=home,login,step-1` — свои адреса). 02.11.2026 исправлено: шапка мастера на 320 px, вход (поле распирало
  колонку `.cols`), шаги ввода (`.wiz`, строка «Крок · дата · прогресс»).
- `node e2e_two_devices.cjs ../ocr-lab/out/p_two_far.jpg` — два телефона одним аккаунтом: A вносит воду по фото
  (фото уходит на сервер, id в записи — серверный), B входит и видит это фото в карточке записи и в лайтбоксе.
- `WANT='{"energy":"15.482","errCode":"E---"}' node e2e_heat_photo.cjs ../ocr-lab/out/s774_energy.jpg ../ocr-lab/out/e8_rx.jpg` —
  тепло по фото без входа: #photo → «Розпізнати» → поля результата (`#phv-…`), скриншот /tmp/shot_heat_photo.png.
- `node e2e_gap.cjs` — «лічильник знімали»: форма периода (ошибки, пересечение), новый теплосчётчик → «останні прийняті»,
  новый водомер → № и табло, расход после замены от показаний после установки, строка в истории, удаление, баннер и карточка
  при открытом периоде (15/15). Демо с периодами: `node shot.cjs '{"gaps":true,"openGap":true}' history water-hot`.
