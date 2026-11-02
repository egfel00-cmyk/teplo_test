# Лаборатория распознавания (только синтетика)

- `gen.html` + `make.cjs` + `cases.json` — рисуют ЖК-экраны теплосчётчиков (шрифт DSEG7/DSEG14 из npm-пакета `dseg`,
  положить .woff2 рядом) с наклоном, размытием, бликом и «тенями» сегментов → jpg.
- Прогнать движок `web/ocr/engine.js` в Chromium (Playwright, файлы подменять через `page.route`, без локального сервера),
  сохранить строки → `tests/fixtures/ocr_synth.json` → `node tests/ocrparse.test.js`.
- Реальные фото людей в репозиторий не класть.

## Водомеры (барабан)
- `water.html` + `water_cases.json` + `water.cjs` — рисуют водомеры в стиле Novator/КСМ: чёрные ролики с белыми цифрами,
  красные дробные (или красные цифры на белом), кольцо красное/синее, тёмные промежутки, тень окна, запотевание, вспышка,
  полуповорот последнего ролика, вверх ногами, 6 чёрных роликов → `out/*.jpg` (не в git).
- `node tests/ocr-lab/run.cjs [cases.json] [фильтр]` — движок + `TeploWater.fromOcr`, итог «N/M», строки → /tmp/ocr_water.json.
  Свои фото: `IMG_DIR=/путь node run.cjs my.local.json` (`[{id, file, truth, prev?}]`, файл `*.local.json` в git не попадает).
- `RAD=2 node tests/ocr-lab/dbg.cjs <папка> a.jpg …` — маска поиска окна (тёмное серым, красное красным, блоки рамками) → /tmp/dbg_*.png.
- На 02.11.2026: рисунки 22/25 (мимо — полуповорот без прошлого и вспышка), фото владельца 4/5 (КСМ 175, MASTER 458,
  UA-TRADE 197 ×2; мимо — снимок двух счётчиков издалека с бликом на «00»).
- `water_pair.json` — несколько водомеров в кадре (`pair`) и блик стекла на ведущих роликах (`lead: N`):
  `node water.cjs water_pair.json && node run.cjs water_pair.json` (случаи с `meters` читаются с `{all:true}` и
  раскладываются `TeploWater.assign`, truth — `{h1, c1}`, прошлые — `prevs`). На 02.11.2026 — 5/5; основной набор 23/25.
