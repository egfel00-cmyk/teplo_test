# Лаборатория распознавания (только синтетика)

- `gen.html` + `make.cjs` + `cases.json` — рисуют ЖК-экраны теплосчётчиков (шрифт DSEG7/DSEG14 из npm-пакета `dseg`,
  положить .woff2 рядом) с наклоном, размытием, бликом и «тенями» сегментов → jpg.
- Прогнать движок `web/ocr/engine.js` в Chromium (Playwright, файлы подменять через `page.route`, без локального сервера),
  сохранить строки → `tests/fixtures/ocr_synth.json` → `node tests/ocrparse.test.js`.
- Реальные фото людей в репозиторий не класть.
