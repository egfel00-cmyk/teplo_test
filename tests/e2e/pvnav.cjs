// 180-я: постачальники квартири — рядками, дані кожного — на його екрані (#pvp-<вид>-<квартира>). Тестам, що звертаються до блоку постачальника
// ([data-key=prov-<вид>], prov-yes-/other-/save-/doc-/next-, pv-bills-<вид>, поля рахунків), — require('./pvnav.cjs')(p, U): перед дією сам переходить на потрібний екран
// (і назад на екран квартири для prov-lead / вибору пункту).
module.exports = (p, U) => {
  let PID = 'main';
  const KEY = /data-key="?(?:prov-(?:yes-|other-|save-|doc-|next-|form-|bare-|my-set-|my-|hot-)?|pv-bills-)(elec|gas|water|heat|hot|waste)\b/;
  const FLD = { '#prv-s': 'water', '#prv-d': 'water', '#prv-h': 'heat', '#prv-a': 'heat', '#prv-g': 'gas', '#p-abon': 'heat', '#pv-acc': 'heat', '#ph-hacc': 'hot', '#w-acc': 'water', '#w-sur': 'water', '#p-mzk': 'heat' };
  const go = async sel => {
    sel = String(sel); const m = sel.match(KEY), f = Object.keys(FLD).find(k => sel.startsWith(k)), k = m ? m[1] : f ? FLD[f] : '';
    const top = /data-key="?(prov-lead|prov-pick|prov-unsettle|prov-alts|pv-prov|pvp-row|pv-m-|pg-pv-|pv-remove-|pv-restore-|pv-add-meter)|prv-pick|#pg-pv-|#mbs-/.test(sel);
    if (!k && !top) return;
    const h = await p.evaluate(() => location.hash), hm = h.match(/^#(?:place|pvp-[a-z]+)-([\w-]+)$/); if (hm) PID = hm[1];
    if (top) { if (/^#pvp-/.test(h)) { await p.goto(U + '#place-' + PID); await p.waitForTimeout(700); } return; }
    if (h !== '#pvp-' + k + '-' + PID) { await p.goto(U + '#pvp-' + k + '-' + PID); await p.waitForTimeout(700); }
  };
  for (const fn of ['textContent', 'click', '$', '$eval', '$$eval', 'inputValue', 'fill', 'waitForSelector']) { const o = p[fn].bind(p); p[fn] = async (sel, ...a) => { await go(sel); return o(sel, ...a); }; }
  return p;
};
