// 174-я: «Точно?» — своє вікно (askOk у app.js), не window.confirm. Тестам, що погоджувались через page.on('dialog', d => d.accept()),
// — те саме для вікна: щойно воно з'являється, натискаємо «Так». window.__askNo = true — натиснути «Скасувати».
module.exports = async function askAuto(p) {
  const fn = () => { const go = () => { const y = document.querySelector('.ask-ov [data-ask=' + (window.__askNo ? 'no' : 'yes') + ']'); if (y) y.click(); };
    new MutationObserver(go).observe(document, { childList: true, subtree: true }); };
  await p.addInitScript(fn);
  try { await p.evaluate(fn); } catch (e) { /* сторінка ще порожня — спрацює init-скрипт */ }
};
