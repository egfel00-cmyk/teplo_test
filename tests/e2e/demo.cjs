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
  // два отопительных сезона: 2024/25 целиком (октябрь–май, лето) и начало 2025/26 до текущих (seasons: true)
  if (opts.seasons) [['2024-10-10', '2.000'], ['2024-11-12', '2.700'], ['2024-12-11', '3.900'], ['2025-01-13', '5.100'], ['2025-02-12', '6.200'], ['2025-03-12', '7.100'],
    ['2025-04-14', '7.700'], ['2025-05-12', '7.760'], ['2025-09-15', '7.760'], ['2025-10-14', '7.900'], ['2025-11-12', '8.400']].forEach(([d, e], i) => readings.unshift({ id: 's' + i, place: 'main',
    htm: { date: d, energy: e, volume: String(1500 + i * 30), hours: String(30000 + i * 700) }, status: 'accepted', createdAt: d + 'T10:00:00Z', updatedAt: 1, source: 'manual' }));
  const meter = opts.noHeat ? null : { modelId: opts.model || 'sharky774', unit: 'Gcal' };
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
  // світло: двозонний (elec: 1 — однозонний) у першій квартирі; 31.10 внесено, ще не передано (вікно 30.10–3.11 відкрите)
  // вивіз сміття (115-а): 2 людини × 30 грн, оплати за липень і серпень–вересень, жовтень ще не сплачено (до 20.11)
  if (opts.waste) out.places[0].waste = { on: true, at: '2026-08-05', persons: 2, price: 30, account: '700123', pays: [
    { id: 'wp1', ym: '2026-07', n: 1, date: '2026-08-12', amount: 60, updatedAt: 1 }, { id: 'wp2', ym: '2026-08', n: 2, date: '2026-09-15', amount: 120, updatedAt: 1 }] };
  if (opts.elec) {
    out.places[0].meters = [{ id: 'e1', kind: 'elec', name: '', zones: opts.elec === 1 ? 1 : 2, serial: '0123456', account: '9876543' }];
    const z = (a, b) => opts.elec === 1 ? { all: String(a + b) } : { day: String(a), night: String(b) };
    out.mrecs = [['2026-07-31', 10000, 5000, true], ['2026-08-31', 10150, 5080], ['2026-10-01', 10290, 5150], ['2026-10-31', 10420, 5225]].map(([d, a, b, base], i) =>
      ({ id: 'm' + d.replace(/-/g, ''), place: 'main', meter: 'e1', kind: 'elec', date: d, z: z(a, b), base: !!base, sent: base || i === 3 ? {} : { obl: d }, createdAt: d + 'T10:00:00Z', updatedAt: 1 }));
  }
  // газ: лічильник у першій квартирі, жовтень — 30 м³; 1.11 внесено, ще не передано (вікно 1–5.11 відкрите)
  if (opts.gas) {
    out.places[0].meters = (out.places[0].meters || []).concat([{ id: 'g1', kind: 'gas', name: '', serial: '777', account: opts.gasAcc === false ? '' : '123456789' }]);
    out.mrecs = (out.mrecs || []).concat([['2026-09-01', '1180.5', true], ['2026-10-01', '1195.25'], ['2026-11-01', '1225.4']].map(([d, v, base], i) =>
      ({ id: 'n' + d.replace(/-/g, ''), place: 'main', meter: 'g1', kind: 'gas', date: d, z: { all: v }, base: !!base, sent: base || i === 2 ? {} : { grm: d }, createdAt: d + 'T10:00:00Z', updatedAt: 1 })));
  }
  // 144-а: гараж — окрема «квартира» зі світлом без показань (як у власника: платить кооперативу на рахунок); own — свій постачальник
  if (opts.garage) {
    out.places.push({ id: 'gar', v: 2, name: 'Гараж', icon: 'garage', color: 'amber', meter: null, baseline: null, updatedAt: 1,
      meters: [{ id: 'eg', kind: 'elec', name: '', zones: 1, serial: '', account: '' }],
      prov: opts.garage === 'own' ? { elec: { own: 1, name: 'ГК «Мотор»', how: 'iban', iban: 'UA213223130000026007233566001', recip: 'ГК «Мотор»', code: '12345678',
        purpose: 'Гараж № 47: світло {попередні}–{показання}, {набігло}, {сума} грн, за {місяць}', price: 4.32, due: 'none', at: '2026-11-01' } }
        // 145-а: як у власника (скрин «ГК Победа»): одні показання, шаблон типовий, номер гаража — у старій «Примітці»
        : opts.garage === 'own1' ? { elec: { own: 1, name: 'ГК Победа', how: 'iban', recip: 'ГК Победа', note: '141', price: 4.32, due: 'none', at: '2026-11-14' } } : undefined });
    if (opts.garage === 'own1') out.mrecs = (out.mrecs || []).concat([{ id: 'gr1', place: 'gar', meter: 'eg', kind: 'elec', date: '2026-11-10', z: { all: '2263' }, base: false, sent: {}, createdAt: '2026-11-10T10:00:00Z', updatedAt: 1 }]);
    if (opts.garage === 'own' || opts.garageRecs) out.mrecs = (out.mrecs || []).concat([['2026-09-30', '1250', true], ['2026-10-31', '1310']].map(([d, v, base]) =>
      ({ id: 'gr' + d.replace(/-/g, ''), place: 'gar', meter: 'eg', kind: 'elec', date: d, z: { all: v }, base: !!base, sent: base ? {} : {}, createdAt: d + 'T10:00:00Z', updatedAt: 1 })));
    if (opts.atGarage) out.placeId = 'gar';
  }
  return out;
};
