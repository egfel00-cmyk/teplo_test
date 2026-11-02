// Демо-состояние для скриншотов (синтетика)
module.exports = function demo(opts) {
  opts = opts || {};
  const water = [], mk = (d, h, c, extra) => water.push(Object.assign({ id: 'w' + d.replace(/-/g, ''), place: 'main', date: d, vals: { h1: String(h), c1: String(c) }, createdAt: d + 'T10:00:00Z', updatedAt: 1, sent: { vk: d, htm: d } }, extra || {}));
  mk('2026-04-15', 160, 410, { base: true, sent: {} });
  mk('2026-05-17', 163, 415); mk('2026-06-16', 165, 419); mk('2026-07-18', 167, 422); mk('2026-08-15', 170, 427);
  mk('2026-09-16', 172, 432); mk('2026-10-15', 175, 437, { photos: opts.photos || [] });
  const readings = [['2026-01-12', '10.112'], ['2026-02-11', '11.402'], ['2026-03-12', '12.380'], ['2026-04-10', '12.910']].map(([d, e], i) => ({
    id: 'r' + i, place: 'main', htm: { date: d, energy: e, volume: String(2200 + i * 30), flow: '0.06', power: '1.6', tSupply: '50', tReturn: '30', hours: String(34000 + i * 700), errHours: '153', errCode: 'E---' },
    status: 'accepted', createdAt: d + 'T10:00:00Z', updatedAt: 1, source: 'manual' }));
  const meter = opts.noHeat ? null : { modelId: 'sharky774', unit: 'Gcal' };
  const baseline = opts.noHeat ? null : { date: '2025-12-10', energy: '9.001', volume: '2150', hours: '33300' };
  const out = { v: 1, lang: opts.lang || 'uk', onboarded: true, meter, baseline, contacts: { phone: '', email: '' }, readings: opts.noHeat ? [] : readings, draft: null,
    demoToday: opts.today || '2026-11-02', placeId: 'main', view: opts.view,
    places: [{ id: 'main', name: '', meter, baseline, updatedAt: 1, gaps: (opts.gaps ? [
      { id: 'g1', what: 'heat', from: '2026-02-20', to: '2026-03-05', reason: 'repair', vFrom: '11.650', vTo: '11.650', fresh: false, pay: 'area', amount: '1250', updatedAt: 1 },
      { id: 'g2', what: 'c1', from: '2026-07-20', to: '2026-07-28', reason: 'verify', vFrom: '424', vTo: '424', fresh: false, pay: 'norm', updatedAt: 1 }] : [])
      .concat(opts.openGap ? [{ id: 'g3', what: 'h1', from: '2026-10-25', to: '', reason: 'replace', vFrom: '176', fresh: true, pay: 'norm', updatedAt: 1 }] : []), water: { account: '123456', surname: 'Шевченко', meters: [{ id: 'h1', kind: 'hot', name: '', serial: '20123456', vkId: '555', verifiedUntil: '2029-01-01' }, { id: 'c1', kind: 'cold', name: '', serial: '3204434', vkId: '777', verifiedUntil: '2029-01-01' }] } }].concat(opts.second ? [
      // вторая квартира — только холодная вода (как у владельца: снимает показания у родителей)
      { id: 'p2', v: 2, name: 'Мамина', address: 'вул. Сумська, 10, кв. 5', color: 'violet', meter: null, baseline: null, updatedAt: 1,
        water: { account: '654321', surname: 'Шевченко', meters: [{ id: 'c9', kind: 'cold', name: '', serial: '1100220', vkId: '', verifiedUntil: '2030-05-01' }] } }] : []),
    water: water.concat(opts.second ? [['2026-09-14', 210, true], ['2026-10-14', 214], ['2026-11-01', 215]].map(([d, c, base]) => Object.assign({ id: 'q' + d.replace(/-/g, ''), place: 'p2', date: d, vals: { c9: String(c) }, createdAt: d + 'T10:00:00Z', updatedAt: 1, sent: base ? {} : { vk: d } }, base ? { base: true } : {})) : []) };
  if (opts.second && opts.at2) out.placeId = 'p2';
  return out;
};
