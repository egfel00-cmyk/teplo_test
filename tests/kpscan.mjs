// Пошук вікна прийому показань на сайті КП (139-а): запускати в Chrome на сторінці сайту КП (той самий origin — без CORS):
//   const m = await import('https://cdn.jsdelivr.net/gh/egfel00-cmyk/teplo_test@<commit>/tests/kpscan.mjs'); await m.scan()
// Обходить головну й сторінки з «договір / оферта / документи / споживачам / показання» (до 30), читає HTML, PDF з текстом (pdf.js), .docx (zip у JS),
// шукає «щомісяця з A по B» (і «з 25-го по 30-те»), «з A по B число», «до N числа» поруч зі словами «показ / облік / обсяг» (140-а: Деражня — «надає інформацію про обсяги»). Повертає короткі рядки: джерело → уривок.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/';
const FOLLOW = /догов|оферт|документ|споживач|абонент|показ|лічильн|облік|інформ|публічн|нормат|послуг|правил/i;
const WIN = [/щомісяця\s+з\s*_*\s*(\d{1,2})(?:\s*-\s*[а-яі]{1,3})?\s*_*\s*(?:по|до)\s*_*\s*(\d{1,2})/i, /з\s+(\d{1,2})[\s-]*(?:го)?\s+(?:по|до)\s+(\d{1,2})[\s-]*(?:го)?\s+числ/i,
  /(?:до|не пізніше)\s+(\d{1,2})[\s-]*(?:го)?\s+числ/i, /з\s+(\d{1,2})\s+по\s+(\d{1,2})\s+(?:число|числа)/i];
const clip = (t, i, a = 90, b = 130) => t.slice(Math.max(0, i - a), i + b).replace(/\s+/g, ' ').trim();
function hits(t, src, out) {
  t = t.replace(/\s+/g, ' ');
  for (const re of WIN) {
    const g = new RegExp(re.source, 'gi'); let m, n = 0;
    while ((m = g.exec(t)) && n < 4) {
      const ctx = clip(t, m.index, 160, 160);
      if (/показ|лічильник|облік|обсяг/i.test(ctx)) { out.push(src.slice(0, 60) + ' → ' + clip(t, m.index, 25, 75)); n++; }
    }
  }
}
async function get(u, bin) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 15000);
  try { const r = await fetch(u, { signal: ac.signal }); if (!r.ok) return null; return bin ? new Uint8Array(await r.arrayBuffer()) : await r.text(); } catch (e) { return null; } finally { clearTimeout(tm); }
}
async function docx(b) {
  const dv = new DataView(b.buffer); let p = 0;
  while (p < b.length - 30 && dv.getUint32(p, true) === 0x04034b50) {
    const m = dv.getUint16(p + 8, true), cs = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), el = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(b.slice(p + 30, p + 30 + nl)), st = p + 30 + nl + el;
    if (name === 'word/document.xml') { const d = b.slice(st, st + cs); const x = m === 8 ? await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text() : new TextDecoder().decode(d); return x.replace(/<w:p[ >]/g, ' <w:p ').replace(/<[^>]+>/g, ''); }
    p = st + cs;
  }
  return '';
}
let PJ = null;
async function pdf(u) {
  if (!PJ) { PJ = await import(PDFJS + 'pdf.min.mjs'); PJ.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs'; }
  const d = await PJ.getDocument(u).promise; let t = '';
  for (let i = 1; i <= Math.min(d.numPages, 25); i++) { const tc = await (await d.getPage(i)).getTextContent(); t += ' ' + tc.items.map(x => x.str).join(' '); }
  return t;
}
export async function scan(o = {}) {
  const base = location.origin, out = [], seen = new Set(), files = new Map(), q = [o.start || location.href];
  const maxPages = o.pages || 30;
  while (q.length && seen.size < maxPages) {
    const u = q.shift(); if (seen.has(u)) continue; seen.add(u);
    const h = await get(u); if (!h) continue;
    const d = new DOMParser().parseFromString(h, 'text/html');
    hits(d.body ? d.body.textContent : '', 'HTML ' + u.replace(base, ''), out);
    d.querySelectorAll('a[href]').forEach(a => {
      let x; try { x = new URL(a.getAttribute('href'), u); } catch (e) { return; }
      x.hash = ''; const s = x.href, tx = (a.textContent || '').trim();
      if (/\.(pdf|docx?|rtf)(\?|$)/i.test(x.pathname)) { if (x.origin === base) files.set(s, tx.slice(0, 50)); else if (!files.has(s)) files.set(s, '[чужий] ' + tx.slice(0, 40)); return; }
      if (x.origin === base && !seen.has(s) && (FOLLOW.test(tx) || FOLLOW.test(decodeURIComponent(x.pathname)))) q.push(s);
    });
  }
  const fl = [];
  for (const [u, tx] of files) {
    if (tx.startsWith('[чужий]')) { fl.push(tx + ' ' + u); continue; }
    if (!/догов|оферт|dog|ofert|indiv|публ|умов|правил/i.test(u + ' ' + tx) && files.size > 12) continue;
    try {
      const n0 = out.length;
      if (/\.pdf/i.test(u)) { const t = await pdf(u); if (t.replace(/\s/g, '').length < 300) { fl.push('СКАН ' + tx + ' ' + u.replace(base, '')); continue; } hits(t, 'PDF ' + tx + ' ' + u.split('/').pop(), out); }
      else if (/\.docx/i.test(u)) { const b = await get(u, true); if (b) hits(await docx(b), 'DOCX ' + tx + ' ' + u.split('/').pop(), out); }
      else { fl.push('DOC/RTF ' + tx + ' ' + u.replace(base, '')); continue; }
      if (out.length === n0) fl.push('без строку: ' + tx + ' ' + u.split('/').pop());
    } catch (e) { fl.push('ERR ' + u.split('/').pop() + ' ' + e.message); }
  }
  // коротко (вивід javascript_tool обрізається ~1000 знаків): збіги без повторів одного джерела, далі — лише лічильники файлів без строку / сканів
  const one = new Map(); out.forEach(x => { const k = x.split(' → ')[0]; if (!one.has(k)) one.set(k, x); });
  const cnt = k => fl.filter(x => x.startsWith(k)).length;
  return [location.host + ': стор. ' + seen.size + ', файлів ' + files.size + ' (без строку ' + cnt('без строку') + ', скан ' + cnt('СКАН') + ', doc ' + cnt('DOC/RTF') + ', чужих ' + cnt('[чужий]') + ')',
    ...[...one.values()].slice(0, 5)].join('\n') + (o.files ? '\n' + fl.slice(0, 8).join('\n') : '');
}
