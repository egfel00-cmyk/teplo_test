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
