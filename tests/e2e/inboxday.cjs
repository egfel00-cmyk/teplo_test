// День «фото з бота» для e2e (183-я): сервер віддає у «Вхідні» лише фото за 7 днів (bot_inbox.taken_at — коли надіслали боту),
// а ХТМ приймає показання 5–25 числа. Тести з датою, зашитою в код (16.11.2026), з 23.11 перестали бачити фото —
// беремо найпізніший день у межах останніх 6 днів, що потрапляє у вікно ХТМ. Немає такого (1–4 число) — null: тест пропускає.
const ymd = d => d.toISOString().slice(0, 10);
const shift = (s, n) => ymd(new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5));
// from/to — вікно постачальника (ХТМ 5–25, Водоканал 1–20: inboxDay(20, 1)).
module.exports = function inboxDay(to = 25, from = 5) {
  const now = Date.now();
  for (let k = 1; k <= 6; k++) {
    const d = new Date(now - k * 864e5), day = d.getUTCDate();
    if (day >= from && day <= to) {
      const B = ymd(d), at = Math.floor(Date.parse(B + 'T10:00:00Z') / 1000);
      return { B, at, dmy: B.slice(8, 10) + '.' + B.slice(5, 7) + '.' + B.slice(0, 4), shift: n => shift(B, n), atOf: n => at + n * 86400 };
    }
  }
  return null;
};
