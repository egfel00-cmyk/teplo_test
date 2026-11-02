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
  return { v: 1, lang: opts.lang || 'uk', onboarded: true, meter, baseline, contacts: { phone: '', email: '' }, readings: opts.noHeat ? [] : readings, draft: null,
    demoToday: opts.today || '2026-11-02', placeId: 'main', view: opts.view,
    places: [{ id: 'main', name: '', meter, baseline, updatedAt: 1, water: { account: '123456', surname: 'Шевченко', meters: [{ id: 'h1', kind: 'hot', name: '', serial: '20123456', vkId: '555', verifiedUntil: '2029-01-01' }, { id: 'c1', kind: 'cold', name: '', serial: '3204434', vkId: '777', verifiedUntil: '2029-01-01' }] } }],
    water };
};
