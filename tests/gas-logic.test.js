const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../gas/Logic.gs');

// 2026-11-02 (週一) 12:00 台北時間
const NOW = new Date('2026-11-02T04:00:00Z');

function booking(over) {
  return Object.assign({
    code: '100001', date: '2026-11-03', timeSlot: '晚診', sequence: 1,
    name: '王大明', phone: '0912345678', department: '退化性關節炎評估 / 治療',
    doctor: '張光明 院長', notes: '', status: '預約成功',
    createdAt: '2026-11-01 10:00:00', cancelledAt: '', email: ''
  }, over || {});
}

test('taipeiToday 跨午夜依台北時間換日', () => {
  assert.equal(L.taipeiToday(new Date('2026-11-01T17:00:00Z')), '2026-11-02');
  assert.equal(L.taipeiToday(new Date('2026-11-01T15:59:00Z')), '2026-11-01');
});

test('addDays 與 isoDow', () => {
  assert.equal(L.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(L.isoDow('2026-11-02'), 1); // 週一
  assert.equal(L.isoDow('2026-11-08'), 7); // 週日
});

test('buildSchedule 只含 D+1~D+7 且略過週日休診', () => {
  const days = L.buildSchedule(L.DEFAULT_SCHEDULE, [], NOW);
  assert.deepEqual(days.map(d => d.date),
    ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09']);
  const tue = days[0];
  assert.deepEqual(tue.slots.map(s => s.timeSlot), ['晚診']);
  const wed = days[1];
  assert.deepEqual(wed.slots.map(s => s.timeSlot), ['早診', '午診', '晚診']);
});

test('buildSchedule 計算剩餘名額與額滿，取消者不佔名額', () => {
  const rows = L.DEFAULT_SCHEDULE.map(r => Object.assign({}, r, { maxQuota: 2 }));
  const bookings = [
    booking({ phone: '0911111111' }),
    booking({ code: '100002', phone: '0922222222' }),
    booking({ code: '100003', phone: '0933333333', status: '已取消' })
  ];
  const slot = L.buildSchedule(rows, bookings, NOW)[0].slots[0];
  assert.equal(slot.booked, 2);
  assert.equal(slot.remaining, 0);
  assert.equal(slot.isFull, true);
});

test('buildSchedule 排除特殊休診日與名額 0 的時段', () => {
  const rows = L.DEFAULT_SCHEDULE.map(r =>
    r.dayOfWeek === 3 && r.slotKey === 'morning'
      ? Object.assign({}, r, { closedDates: '2026-11-04, 2026-11-11' }) : r)
    .map(r => r.dayOfWeek === 3 && r.slotKey === 'afternoon'
      ? Object.assign({}, r, { maxQuota: 0 }) : r);
  const wed = L.buildSchedule(rows, [], NOW)[1];
  assert.deepEqual(wed.slots.map(s => s.timeSlot), ['晚診']);
});
