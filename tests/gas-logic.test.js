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

function req(over) {
  return Object.assign({
    date: '2026-11-03', slotKey: 'evening', name: '王大明',
    phone: '0912-345-678', email: '', department: 'arthritis', notes: ''
  }, over || {});
}

test('normalizePhone / isValidPhone / isValidEmail', () => {
  assert.equal(L.normalizePhone('0912-345-678'), '0912345678');
  assert.equal(L.isValidPhone('0912345678'), true);
  assert.equal(L.isValidPhone('0212345678'), false);
  assert.equal(L.isValidEmail(''), true);
  assert.equal(L.isValidEmail('a@b.co'), true);
  assert.equal(L.isValidEmail('abc'), false);
});

test('validateBooking 通過時回傳時段與項目名稱', () => {
  const r = L.validateBooking(req(), L.DEFAULT_SCHEDULE, [], NOW);
  assert.equal(r.ok, true);
  assert.equal(r.slot.timeSlot, '晚診');
  assert.equal(r.phone, '0912345678');
  assert.equal(r.departmentLabel, '退化性關節炎評估 / 治療');
});

test('validateBooking 拒絕當日與超過 7 天', () => {
  const today = L.validateBooking(req({ date: '2026-11-02' }), L.DEFAULT_SCHEDULE, [], NOW);
  assert.equal(today.ok, false);
  assert.match(today.error, /不開放/);
  const far = L.validateBooking(req({ date: '2026-11-10' }), L.DEFAULT_SCHEDULE, [], NOW);
  assert.equal(far.ok, false);
});

test('validateBooking 拒絕不開診時段（週二無早診）', () => {
  const r = L.validateBooking(req({ slotKey: 'morning' }), L.DEFAULT_SCHEDULE, [], NOW);
  assert.equal(r.ok, false);
  assert.match(r.error, /不開診/);
});

test('validateBooking 同日同手機不可重複，已取消者不算', () => {
  const dup = L.validateBooking(req(), L.DEFAULT_SCHEDULE,
    [booking({ phone: '0912345678', timeSlot: '晚診' })], NOW);
  assert.equal(dup.ok, false);
  assert.match(dup.error, /不可重複預約/);
  const ok = L.validateBooking(req(), L.DEFAULT_SCHEDULE,
    [booking({ phone: '0912345678', status: '已取消' })], NOW);
  assert.equal(ok.ok, true);
});

test('validateBooking 額滿時拒絕', () => {
  const rows = L.DEFAULT_SCHEDULE.map(r => Object.assign({}, r, { maxQuota: 1 }));
  const r = L.validateBooking(req(), rows, [booking({ phone: '0999999999' })], NOW);
  assert.equal(r.ok, false);
  assert.match(r.error, /額滿/);
});

test('validateBooking 拒絕錯誤輸入', () => {
  assert.equal(L.validateBooking(req({ name: ' ' }), L.DEFAULT_SCHEDULE, [], NOW).ok, false);
  assert.equal(L.validateBooking(req({ phone: '123' }), L.DEFAULT_SCHEDULE, [], NOW).ok, false);
  assert.equal(L.validateBooking(req({ email: 'x' }), L.DEFAULT_SCHEDULE, [], NOW).ok, false);
  assert.equal(L.validateBooking(req({ department: 'nope' }), L.DEFAULT_SCHEDULE, [], NOW).ok, false);
});

test('nextSequence 含已取消紀錄，避免號碼重複', () => {
  const bs = [
    booking({ sequence: 1 }),
    booking({ code: '100002', sequence: 2, status: '已取消' }),
    booking({ code: '100003', sequence: 5, date: '2026-11-04' })
  ];
  assert.equal(L.nextSequence(bs, '2026-11-03', '晚診'), 3);
  assert.equal(L.nextSequence([], '2026-11-03', '晚診'), 1);
});

test('generateCode 為 6 位數字且避開已存在代碼', () => {
  const seq = [0, 0, 0.5];
  let i = 0;
  const code = L.generateCode(['100000'], () => seq[i++]);
  assert.match(code, /^\d{6}$/);
  assert.equal(code, String(100000 + Math.floor(0.5 * 900000)));
});

test('findBooking 需代碼與手機皆相符', () => {
  const bs = [booking({ code: '123456', phone: '0912345678' })];
  assert.ok(L.findBooking(bs, '123456', '0912-345-678'));
  assert.equal(L.findBooking(bs, '123456', '0900000000'), null);
  assert.equal(L.findBooking(bs, '999999', '0912345678'), null);
});

test('findBooking 容忍試算表吃掉前導 0 的電話', () => {
  const bs = [booking({ code: '123456', phone: '912345678' })];
  assert.ok(L.findBooking(bs, '123456', '0912345678'));
  assert.equal(L.findBooking(bs, '123456', '0900000000'), null);
});

test('canCancel 僅在時段開始前且狀態為預約成功', () => {
  const b = booking({ date: '2026-11-03', timeSlot: '晚診' }); // 週二 17:00 開始
  const before = new Date('2026-11-03T08:59:00Z'); // 16:59 台北
  const after = new Date('2026-11-03T09:00:00Z');  // 17:00 台北
  assert.equal(L.canCancel(b, L.DEFAULT_SCHEDULE, before), true);
  assert.equal(L.canCancel(b, L.DEFAULT_SCHEDULE, after), false);
  assert.equal(L.canCancel(booking({ status: '已取消' }), L.DEFAULT_SCHEDULE, before), false);
});

test('findResendTargets 依手機與 Email 比對未過期的有效預約', () => {
  const bs = [
    booking({ phone: '0912345678', email: 'wang@example.com', date: '2026-11-03' }),
    booking({ code: '100002', phone: '0912345678', email: 'wang@example.com', date: '2026-10-30' }),
    booking({ code: '100003', phone: '0912345678', email: 'wang@example.com', status: '已取消' }),
    booking({ code: '100004', phone: '0912345678', email: 'other@example.com' })
  ];
  const r = L.findResendTargets(bs, '0912-345-678', 'WANG@example.com', '2026-11-02');
  assert.deepEqual(r.map(b => b.code), ['100001']);
  assert.deepEqual(L.findResendTargets(bs, '0912345678', '', '2026-11-02'), []);
});

test('listClosures 列出 D+1~D+7 內被特殊休診的時段', () => {
  const rows = L.DEFAULT_SCHEDULE.map(r =>
    r.dayOfWeek === 3 && r.slotKey === 'morning'
      ? Object.assign({}, r, { closedDates: '2026-11-04, 2026-11-11' }) : r);
  assert.deepEqual(L.listClosures(rows, NOW), [{ date: '2026-11-04', timeSlot: '早診' }]);
});
