// 149-я (план конкурентов, п. 1 — docs/конкуренты.md): сторінки «Як зняти показання <модель>» для пошуку — сервером, без скриптів, uk + ru.
// Генератор: моделі й кроки — з web/src/models.js, підписи полів — rules.js, дії й статуси — i18n.js, слово «передай» — app.js (WM).
// Пише app/data/seo/models.json; сторінки малює app/seo.php (адреси /yak-znyaty-pokaznannya/<модель> і /ru/kak-snyat-pokazaniya/<модель>, sitemap).
// Запуск після зміни моделей: node tools_seo.cjs  (tests/server.php перевіряє, що JSON не відстав від models.js)
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
global.window = {};
require(path.join(ROOT, 'web/src/i18n.js'));
const T = window.TeploI18n.T, M = require(path.join(ROOT, 'web/src/models.js')), R = require(path.join(ROOT, 'web/src/rules.js'));

const t = (lang, k, v) => String(T[lang][k] || T.uk[k] || k).replace(/\{(\w+)\}/g, (_, n) => (v && v[n] !== undefined ? v[n] : ''));
const L = (lang, x) => (x ? (lang === 'ru' ? x.ru || x.uk : x.uk) : '') || '';
const fld = (lang, k) => { const f = R.FIELDS.find(x => x.key === k) || (k === 'flowHours' ? R.FIELD_PD : null); return f ? (lang === 'ru' ? f.ru : f.uk) : k; };
const UNIT = { uk: { Gcal: 'Гкал', MWh: 'МВт·год', kWh: 'кВт·год', GJ: 'ГДж' }, ru: { Gcal: 'Гкал', MWh: 'МВт·ч', kWh: 'кВт·ч', GJ: 'ГДж' } };

/** «2 рази» / «5 разів» (ru: «2 раза» / «5 раз») — на сторінці словами, а не «×2», як у плашці застосунку. */
function times(lang, n) { const a = n % 10, b = n % 100, f = a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 1 : 2; return n + ' ' + (lang === 'ru' ? ['раз', 'раза', 'раз'] : ['раз', 'рази', 'разів'])[f]; }
/** Дія на кроці — як pressText() у app.js, але текстом. */
function act(lang, s) {
  if (s.say) return L(lang, s.say);
  if (s.press === 'long') return t(lang, 's_hold', { s: s.hold || 3 }) + (s.count ? ', ' + t(lang, 's_hold_then', { n: s.count }).replace(/×\{?n?\}?\d*$/, '').replace(/×\d+$/, '').trim() + ' ' + times(lang, s.count) : '');
  if (s.press === null) return t(lang, 's_first');
  return s.count ? t(lang, 's_press') + ' ' + times(lang, s.count) : t(lang, 's_press_find');
}
const STATUS = {
  uk: { verified: 'Перевірено на справжньому лічильнику', manual: t('uk', 'm_manual'), draft: t('uk', 'm_draft') },
  ru: { verified: 'Проверено на настоящем счётчике', manual: t('ru', 'm_manual'), draft: t('ru', 'm_draft') }
};
const slug = id => id.replace(/_/g, '-');

function page(m, lang) {
  const nm = m.name, vd = m.vendor && m.vendor !== '—' ? m.vendor : '';
  const steps = (m.steps || []).map(s => ({
    a: act(lang, s),
    d: s.lcd ? { v: String(s.lcd.digits || ''), u: String(s.lcd.tag || ''), alt: s.lcd.alt ? { v: String(s.lcd.alt.digits || ''), u: String(s.lcd.alt.tag || '') } : null } : null,
    f: (s.fields || []).map(k => fld(lang, k)),
    h: L(lang, s.hint),
    only3: s.only3 ? 1 : 0,
    loop: s.loop || s.press === 'long' ? 1 : 0
  }));
  const units = (m.units || [m.unit]).map(u => UNIT[lang][u] || u).join(', ');
  const ru = lang === 'ru';
  return {
    title: ru ? `Как снять показания теплосчётчика ${nm}${vd ? ' (' + vd + ')' : ''} — по шагам` : `Як зняти показання теплолічильника ${nm}${vd ? ' (' + vd + ')' : ''} — покроково`,
    h1: ru ? `Как снять показания ${nm}` : `Як зняти показання ${nm}`,
    desc: ru ? `Пошагово для теплосчётчика ${nm}: какую кнопку и сколько раз нажимать, где энергия, объём, температуры и часы работы. Для ХТМ и других поставщиков тепла.`
      : `Покроково для теплолічильника ${nm}: яку кнопку й скільки разів натискати, де енергія, обсяг, температури й години роботи. Для ХТМ та інших постачальників тепла.`,
    sub: L(lang, m.sub) || (vd ? (ru ? 'Производитель: ' : 'Виробник: ') + vd : ''),
    where: L(lang, m.where), note: L(lang, m.note), loops: L(lang, (m.loops || {}).tip || M.LOOP_ANY),
    status: STATUS[lang][m.status] || '', units, steps
  };
}

// «передай» — те саме слово, що в шапці сайту (дані tools_logo.py --wordmark у app.js)
const app = fs.readFileSync(path.join(ROOT, 'web/src/app.js'), 'utf8');
const wm = JSON.parse((app.match(/var WM = (\{.*?\}), WMN = 0;/) || [])[1] || "null");
if (!wm) throw new Error('WM не знайдено в app.js');

const models = M.MODELS.filter(m => m.id !== 'other' && m.name).map(m => ({ id: m.id, slug: slug(m.id), name: m.name, vendor: m.vendor && m.vendor !== '—' ? m.vendor : '',
  status: m.status, sticker: m.sticker ? 1 : 0, uk: page(m, 'uk'), ru: page(m, 'ru') }));
const src = ['web/src/models.js', 'web/src/rules.js', 'web/src/i18n.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const out = { v: 1, src: require('crypto').createHash('md5').update(src).digest('hex').slice(0, 12), wm: { d: wm.d, b: wm.b, bw: wm.bw, g: wm.g, vb: wm.vb }, models };
fs.mkdirSync(path.join(ROOT, 'app/data/seo'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'app/data/seo/models.json'), JSON.stringify(out));
console.log('app/data/seo/models.json —', models.length, 'моделей, src', out.src);
