// Камера з підказками (121-а): видима частина кадру, яскравість/відблиск/різкість/рух, вибір підказки. Лише синтетика.
const C = require('../web/src/camera.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

// кадр w×h із функції яскравості f(x, y) → RGBA
const img = (w, h, f) => { const a = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y), q = (y * w + x) * 4; a[q] = a[q + 1] = a[q + 2] = v; a[q + 3] = 255; } return a; };
// «табло»: світлий фон, темні цифри-смуги з чіткими краями
const sharp = (x, y) => (y > 20 && y < 60 && (x % 14) < 6 ? 30 : 190);
// те саме, розмите ковзним середнім 9×9
const blurred = (() => { const w = 120, h = 80, src = img(w, h, sharp), out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; s += src[(yy * w + xx) * 4]; n++; } const q = (y * w + x) * 4; out[q] = out[q + 1] = out[q + 2] = s / n; out[q + 3] = 255; }
  return out; })();

console.log('Видима частина кадру (object-fit: cover):');
let r = C.mapRect(1080, 1920, 390, 844);
ok('портрет 1080×1920 на 390×844 — обрізано з боків, по висоті весь', r.y === 0 && r.h === 1920 && r.w < 1080 && r.x > 0 && Math.abs(r.x * 2 + r.w - 1080) <= 1, r);
r = C.mapRect(1920, 1080, 1280, 720);
ok('ті самі пропорції — увесь кадр', r.x === 0 && r.y === 0 && r.w === 1920 && r.h === 1080, r);
r = C.mapRect(1080, 1920, 390, 844, { x: 31, y: 186, w: 328, h: 253 });
ok('рамка на екрані → пікселі кадру (масштаб 1920/844)', Math.abs(r.w - 328 * 1920 / 844) <= 1 && Math.abs(r.h - 253 * 1920 / 844) <= 1 && r.x > 0 && r.y > 0, r);
ok('без розмірів — увесь кадр', C.mapRect(0, 0, 390, 844).w === 0);

console.log('Кадр:');
const dark = C.stats(img(120, 80, () => 20), 120, 80, null);
ok('темно — низька яскравість, руху ще нема', dark.lum < 30 && dark.move === null, dark.lum);
const sh = C.stats(img(120, 80, sharp), 120, 80, null), bl = C.stats(blurred, 120, 80, null);
ok('різке табло — лапласіан сильно більший, ніж у розмитого', sh.sharp > 20 * Math.max(1, bl.sharp), [sh.sharp, bl.sharp]);
ok('розмите — є що фокусувати (розкид яскравості), але різкості нема', bl.flat > C.TH.flat && bl.sharp / bl.flat ** 2 < C.TH.blur, [bl.flat, bl.sharp]);
ok('різке — відносна різкість далеко над порогом', sh.sharp / sh.flat ** 2 > 2 * C.TH.blur);
const gl = C.stats(img(120, 80, (x, y) => (x > 40 && x < 70 && y > 20 && y < 50 ? 255 : sharp(x, y))), 120, 80, null);
ok('пляма пересвіту — glare', gl.glare > C.TH.glare, gl.glare);
const mv = C.stats(img(120, 80, (x, y) => sharp(x + 7, y)), 120, 80, sh.gray);
ok('зсунули кадр — move', mv.move > C.TH.move, mv.move);
const still = C.stats(img(120, 80, sharp), 120, 80, sh.gray);
ok('той самий кадр — move 0', still.move === 0);

console.log('Підказка:');
ok('темно, є ліхтарик — «увімкніть ліхтарик»', C.hint(dark, { torch: true }) === 'dark_t');
ok('темно, ліхтарик уже горить — «додайте світла»', C.hint(dark, { torch: true, torchOn: true }) === 'dark');
ok('рухається — «нерухомо» (важливіше за відблиск)', C.hint(Object.assign({}, gl, { move: 30 }), {}) === 'move');
ok('відблиск', C.hint(gl, {}) === 'glare');
ok('розмито', C.hint(bl, {}) === 'blur');
ok('розмито, але щойно прочитали цифри — не заважаємо', C.hint(bl, { ocr: { found: true, lines: 3, digitH: 0.05, age: 1000 } }) === '');
ok('різко, рядок цифр дрібний — «ближче»', C.hint(sh, { ocr: { found: false, lines: 2, digitH: 0.012, age: 1500 } }) === 'far');
ok('різко, тексту не знайдено — «наведіть»', C.hint(sh, { ocr: { found: false, lines: 0, digitH: 0, age: 1500 } }) === 'aim');
ok('давній результат розпізнавання не рахуємо', C.hint(sh, { ocr: { found: false, lines: 0, digitH: 0, age: 9000 } }) === '');
ok('усе гаразд — без підказки', C.hint(sh, {}) === '');

console.log('Висота цифр:');
ok('найбільший рядок із 3+ цифр / менша сторона', Math.abs(C.digitH({ w: 1080, h: 1920, lines: [{ text: 'Gcal', h: 90 }, { text: '15.482', h: 54 }, { text: '12', h: 200 }] }) - 0.05) < 1e-9);
ok('цифр нема — 0', C.digitH({ w: 1080, h: 1920, lines: [{ text: 'SHARKY', h: 40 }] }) === 0);

console.log(`\ncamera: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
