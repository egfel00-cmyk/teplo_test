// Экран квартиры с 10.11 — три раскрывашки (лічильники · постачальники, тарифи й рахунки · про квартиру), по умолчанию закрыты.
// Тестам, которые работают с полями внутри, — открывать их сами: await require('./pvopen.cjs')(ctx) после newContext.
// localStorage 'e2e.pvClosed' = '1' — не открывать (проверка «закрыты по умолчанию»).
module.exports = (ctx) => ctx.addInitScript(() => {
  const open = () => { if (localStorage.getItem('e2e.pvClosed') === '1') return; document.querySelectorAll('details.pgroup[id^="pg-pv-"]:not([open])').forEach(d => { d.open = true; }); };
  new MutationObserver(open).observe(document, { childList: true, subtree: true });
});
/** browser.newContext(o) + раскрывашки квартиры открыты: await require('./pvopen.cjs').ctx(b, {...}). */
module.exports.ctx = async (b, o) => { const c = await b.newContext(o); await module.exports(c); return c; };
