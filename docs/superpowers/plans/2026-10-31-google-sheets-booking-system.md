# 光明診所線上預約掛號系統 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在現有 GitHub Pages 官網內提供線上預約、查詢、取消與忘記代碼找回功能，資料存放於 Google 試算表。

**Architecture:** 後端為 Google Apps Script Web App（單一 `doPost` 端點）。所有業務規則（日期窗口、名額、防重複、取消截止、代碼產生）寫成**無副作用的純函式**放在 `gas/Logic.gs`，以 Node 內建測試執行器 `node --test` 做單元測試；`gas/Code.gs` 只負責讀寫試算表、加鎖、寄信。前端新增 `assets/booking.js` 處理 UI，`index.html` 只改標記。

**Tech Stack:** Google Apps Script (V8)、Google Sheets、Node 內建 `node:test`（僅測試用，免安裝套件）、Tailwind CDN、原生 JS `fetch`。

**參考規格:** `docs/superpowers/specs/2026-10-31-google-sheets-booking-system-design.md`

---

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `gas/Logic.gs` | 新增 | 純函式：日期、排班名額、驗證、代碼、取消判斷、找回比對；預設排班資料 |
| `gas/Code.gs` | 新增 | `doPost` 路由、試算表讀寫、`LockService`、`MailApp`、找回頻率限制、`setupSheets` |
| `gas/appsscript.json` | 新增 | 時區 `Asia/Taipei`、V8、Web App 設定 |
| `tests/gas-logic.test.js` | 新增 | `Logic.gs` 單元測試 |
| `assets/config.js` | 新增 | 放 Apps Script 部署網址 `BOOKING_API_URL` |
| `assets/booking.js` | 新增 | 前端 API 呼叫、日期/時段選單、頁籤、結果卡、查詢/取消/找回 |
| `index.html` | 修改 | 預約區塊標記（頁籤、日期改下拉、Email 欄、結果卡、停診提示），移除舊 mock 腳本 |
| `docs/booking-setup.md` | 新增 | 試算表建立與 Apps Script 部署步驟 |

約定：
- 日期一律 `YYYY-MM-DD` 字串，以台北時間（UTC+8）計算。
- 預約狀態字串：`預約成功` / `已取消` / `已完成就診`。
- 手機格式 `^09\d{8}$`（輸入時先去除非數字字元）。
- 試算表所有文字欄需設為純文字格式（`@`），避免日期被轉型、手機開頭 0 被吃掉。

---

### Task 1: 日期工具與排班名額矩陣

**Files:**
- Create: `gas/Logic.gs`
- Create: `tests/gas-logic.test.js`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/gas-logic.test.js`：

```js
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
```

- [ ] **Step 2: 執行確認失敗**

Run: `node --test tests/`
Expected: FAIL，錯誤為 `Cannot find module '../gas/Logic.gs'`

- [ ] **Step 3: 實作 `gas/Logic.gs`**

```js
/* 純函式業務邏輯。同時供 Apps Script（全域函式）與 Node 測試（module.exports）使用。 */

var STATUS_OK = '預約成功';
var STATUS_CANCELLED = '已取消';
var WINDOW_DAYS = 7;

var DEPARTMENTS = {
  arthritis: '退化性關節炎評估 / 治療',
  eswt: '體外震波治療 (ESWT)',
  prp: '超音波導引 PRP 自體血小板注射',
  ha: '玻尿酸關節腔注射',
  rehab: '健保物理復健',
  sports: '運動傷害 / 扭拉傷 / 筋膜疼痛',
  family: '家庭醫學科 / 慢箋 / 外科處置'
};

function slotRow_(dow, timeSlot, slotKey, timeRange, startTime, specialty) {
  return {
    dayOfWeek: dow, timeSlot: timeSlot, slotKey: slotKey, timeRange: timeRange,
    doctor: '張光明 院長', specialty: specialty, maxQuota: 20,
    startTime: startTime, closedDates: ''
  };
}

var DEFAULT_SCHEDULE = [
  slotRow_(1, '早診', 'morning', '09:00 - 12:00', '09:00', '骨科 / 復健評估'),
  slotRow_(1, '午診', 'afternoon', '15:00 - 18:00', '15:00', '骨科 / 復健'),
  slotRow_(1, '晚診', 'evening', '18:00 - 20:00', '18:00', '骨科 / 復健'),
  slotRow_(2, '晚診', 'evening', '17:00 - 20:00', '17:00', '骨科 / 復健'),
  slotRow_(3, '早診', 'morning', '09:00 - 12:00', '09:00', '骨科 / 震波 / PRP'),
  slotRow_(3, '午診', 'afternoon', '15:00 - 18:00', '15:00', '骨科 / 復健'),
  slotRow_(3, '晚診', 'evening', '18:00 - 20:00', '18:00', '骨科 / 復健'),
  slotRow_(4, '晚診', 'evening', '17:00 - 20:00', '17:00', '骨科 / 復健'),
  slotRow_(5, '午診', 'afternoon', '15:00 - 18:00', '15:00', '骨科 / 復健'),
  slotRow_(5, '晚診', 'evening', '18:00 - 20:00', '18:00', '骨科 / 復健'),
  slotRow_(6, '早診', 'morning', '09:00 - 12:00', '09:00', '骨科復健專診')
];

function taipeiToday(now) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 週一=1 ... 週日=7
function isoDow(dateStr) {
  var d = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}

function parseClosed(s) {
  return String(s || '').split(/[,，\s]+/).filter(Boolean);
}

function isActive(b) {
  return b.status === STATUS_OK;
}

// 回傳 D+1 ~ D+7 每日可預約時段與即時名額；當日不開放。
function buildSchedule(rows, bookings, now) {
  var today = taipeiToday(now);
  var days = [];
  for (var i = 1; i <= WINDOW_DAYS; i++) {
    var date = addDays(today, i);
    var dow = isoDow(date);
    var slots = [];
    rows.forEach(function (r) {
      if (Number(r.dayOfWeek) !== dow) return;
      var quota = Number(r.maxQuota);
      if (!(quota > 0)) return;
      if (parseClosed(r.closedDates).indexOf(date) >= 0) return;
      var booked = bookings.filter(function (b) {
        return isActive(b) && b.date === date && b.timeSlot === r.timeSlot;
      }).length;
      var remaining = Math.max(quota - booked, 0);
      slots.push({
        slotKey: r.slotKey, timeSlot: r.timeSlot, timeRange: r.timeRange,
        doctor: r.doctor, specialty: r.specialty, startTime: r.startTime,
        maxQuota: quota, booked: booked, remaining: remaining, isFull: remaining <= 0
      });
    });
    if (slots.length) days.push({ date: date, dayOfWeek: dow, slots: slots });
  }
  return days;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATUS_OK: STATUS_OK, STATUS_CANCELLED: STATUS_CANCELLED, WINDOW_DAYS: WINDOW_DAYS,
    DEPARTMENTS: DEPARTMENTS, DEFAULT_SCHEDULE: DEFAULT_SCHEDULE,
    taipeiToday: taipeiToday, addDays: addDays, isoDow: isoDow,
    parseClosed: parseClosed, isActive: isActive, buildSchedule: buildSchedule
  };
}
```

- [ ] **Step 4: 執行確認通過**

Run: `node --test tests/`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add gas/Logic.gs tests/gas-logic.test.js
git commit -m "feat(gas): add date helpers and schedule quota matrix"
```

---

### Task 2: 預約驗證、看診號與預約代碼

**Files:**
- Modify: `gas/Logic.gs`
- Modify: `tests/gas-logic.test.js`

- [ ] **Step 1: 在測試檔末尾追加失敗測試**

```js
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
```

- [ ] **Step 2: 執行確認失敗**

Run: `node --test tests/`
Expected: 新增的測試 FAIL，`L.normalizePhone is not a function`

- [ ] **Step 3: 在 `gas/Logic.gs` 的 `if (typeof module` 之前加入實作，並擴充 exports**

```js
function normalizePhone(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function isValidPhone(p) {
  return /^09\d{8}$/.test(p);
}

function isValidEmail(e) {
  return e === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// 驗證掛號請求；回傳 {ok:true, slot, phone, email, name, departmentLabel} 或 {ok:false, error}
function validateBooking(req, rows, bookings, now) {
  var name = String(req.name || '').trim();
  var phone = normalizePhone(req.phone);
  var email = String(req.email || '').trim().toLowerCase();
  var deptLabel = DEPARTMENTS[req.department];

  if (!name) return { ok: false, error: '請輸入姓名' };
  if (!isValidPhone(phone)) return { ok: false, error: '請輸入正確的手機號碼（10 碼，09 開頭）' };
  if (!isValidEmail(email)) return { ok: false, error: '電子郵件格式不正確' };
  if (!deptLabel) return { ok: false, error: '請選擇預約項目' };

  var today = taipeiToday(now);
  var date = String(req.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= today) {
    return { ok: false, error: '當日不開放線上掛號，請選擇明日起的日期' };
  }
  if (date > addDays(today, WINDOW_DAYS)) {
    return { ok: false, error: '僅開放預約未來 ' + WINDOW_DAYS + ' 天內的門診' };
  }

  var day = buildSchedule(rows, bookings, now).filter(function (d) { return d.date === date; })[0];
  var slot = day && day.slots.filter(function (s) { return s.slotKey === req.slotKey; })[0];
  if (!slot) return { ok: false, error: '該日期此時段不開診' };

  var dup = bookings.some(function (b) {
    return isActive(b) && b.date === date && b.phone === phone;
  });
  if (dup) return { ok: false, error: '您在此日期已有預約掛號紀錄，不可重複預約' };

  if (slot.isFull) return { ok: false, error: '該時段已額滿' };

  return { ok: true, slot: slot, phone: phone, email: email, name: name, departmentLabel: deptLabel };
}

// 同日同時段最大看診號 + 1（含已取消紀錄，確保號碼不重複）
function nextSequence(bookings, date, timeSlot) {
  var max = 0;
  bookings.forEach(function (b) {
    if (b.date === date && b.timeSlot === timeSlot && Number(b.sequence) > max) max = Number(b.sequence);
  });
  return max + 1;
}

// 產生不重複的 6 位數字代碼；rand 預設 Math.random，測試時可注入
function generateCode(existingCodes, rand) {
  rand = rand || Math.random;
  var used = {};
  existingCodes.forEach(function (c) { used[c] = true; });
  for (var i = 0; i < 1000; i++) {
    var code = String(100000 + Math.floor(rand() * 900000));
    if (!used[code]) return code;
  }
  throw new Error('無法產生不重複的預約代碼');
}
```

exports 內新增：`normalizePhone, isValidPhone, isValidEmail, validateBooking, nextSequence, generateCode`。

- [ ] **Step 4: 執行確認通過**

Run: `node --test tests/`
Expected: 全部 PASS（共 14 tests）

- [ ] **Step 5: Commit**

```bash
git add gas/Logic.gs tests/gas-logic.test.js
git commit -m "feat(gas): add booking validation, sequence and code generation"
```

---

### Task 3: 查詢、取消判斷、找回比對與停診清單

**Files:**
- Modify: `gas/Logic.gs`
- Modify: `tests/gas-logic.test.js`

- [ ] **Step 1: 在測試檔末尾追加失敗測試**

```js
test('findBooking 需代碼與手機皆相符', () => {
  const bs = [booking({ code: '123456', phone: '0912345678' })];
  assert.ok(L.findBooking(bs, '123456', '0912-345-678'));
  assert.equal(L.findBooking(bs, '123456', '0900000000'), null);
  assert.equal(L.findBooking(bs, '999999', '0912345678'), null);
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
```

- [ ] **Step 2: 執行確認失敗**

Run: `node --test tests/`
Expected: 新測試 FAIL，`L.findBooking is not a function`

- [ ] **Step 3: 在 `gas/Logic.gs` 加入實作並擴充 exports**

```js
function findBooking(bookings, code, phone) {
  var p = normalizePhone(phone);
  var c = String(code || '').trim();
  for (var i = 0; i < bookings.length; i++) {
    if (bookings[i].code === c && bookings[i].phone === p) return bookings[i];
  }
  return null;
}

// 診次開始前可取消（台北時間）
function canCancel(booking, rows, now) {
  if (!isActive(booking)) return false;
  var dow = isoDow(booking.date);
  var row = rows.filter(function (r) {
    return Number(r.dayOfWeek) === dow && r.timeSlot === booking.timeSlot;
  })[0];
  if (!row) return false;
  var hhmm = String(row.startTime).length === 4 ? '0' + row.startTime : String(row.startTime);
  var start = new Date(booking.date + 'T' + hhmm + ':00+08:00').getTime();
  return now.getTime() < start;
}

function findResendTargets(bookings, phone, email, today) {
  var p = normalizePhone(phone);
  var e = String(email || '').trim().toLowerCase();
  if (!e) return [];
  return bookings.filter(function (b) {
    return isActive(b) && b.phone === p && String(b.email || '').toLowerCase() === e && b.date >= today;
  });
}

function listClosures(rows, now) {
  var today = taipeiToday(now);
  var out = [];
  for (var i = 1; i <= WINDOW_DAYS; i++) {
    var date = addDays(today, i);
    var dow = isoDow(date);
    rows.forEach(function (r) {
      if (Number(r.dayOfWeek) === dow && parseClosed(r.closedDates).indexOf(date) >= 0) {
        out.push({ date: date, timeSlot: r.timeSlot });
      }
    });
  }
  return out;
}
```

exports 內新增：`findBooking, canCancel, findResendTargets, listClosures`。

- [ ] **Step 4: 執行確認通過**

Run: `node --test tests/`
Expected: 全部 PASS（共 18 tests）

- [ ] **Step 5: Commit**

```bash
git add gas/Logic.gs tests/gas-logic.test.js
git commit -m "feat(gas): add lookup, cancel rule, resend matching and closures"
```

---

### Task 4: Apps Script 後端（試算表讀寫、API 路由、寄信）

**Files:**
- Create: `gas/appsscript.json`
- Create: `gas/Code.gs`
- Create: `docs/booking-setup.md`
- Modify: `docs/superpowers/specs/2026-10-31-google-sheets-booking-system-design.md`（找回頻率描述）

`Code.gs` 依賴 Apps Script 全域服務，無法在 Node 單元測試，改以 Task 8 的實機驗證。

- [ ] **Step 1: 建立 `gas/appsscript.json`**

```json
{
  "timeZone": "Asia/Taipei",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.send_mail",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

- [ ] **Step 2: 建立 `gas/Code.gs`**

```js
var SHEET_SCHEDULE = '排班與人數上限';
var SHEET_APPT = '預約紀錄';
var CLINIC_PHONE = '(02) 2821-0197';
var RESEND_LIMIT = 3;
var RESEND_WINDOW_SEC = 21600; // CacheService 上限 6 小時

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// 第一次部署前在編輯器手動執行一次：建立兩個工作表與預設排班
function setupSheets() {
  var ss = ss_();
  var sch = ss.getSheetByName(SHEET_SCHEDULE) || ss.insertSheet(SHEET_SCHEDULE);
  var appt = ss.getSheetByName(SHEET_APPT) || ss.insertSheet(SHEET_APPT);

  sch.getRange('A:I').setNumberFormat('@');
  sch.getRange(1, 1, 1, 9).setValues([['星期', '時段', '診次代碼', '時段起訖', '主治醫師',
    '專科科別', '線上名額上限', '時段開始時間', '特殊休診日期']]);
  if (sch.getLastRow() < 2) {
    var data = DEFAULT_SCHEDULE.map(function (r) {
      return [String(r.dayOfWeek), r.timeSlot, r.slotKey, r.timeRange, r.doctor,
        r.specialty, String(r.maxQuota), r.startTime, r.closedDates];
    });
    sch.getRange(2, 1, data.length, 9).setValues(data);
  }

  appt.getRange('A:M').setNumberFormat('@');
  appt.getRange(1, 1, 1, 13).setValues([['預約代碼', '預約日期', '門診時段', '看診順序號',
    '患者姓名', '聯絡電話', '診療項目', '主治醫師', '症狀備註', '預約狀態',
    '建立時間', '取消時間', '電子郵件']]);
  sch.setFrozenRows(1);
  appt.setFrozenRows(1);
}

function readSchedule_() {
  var sh = ss_().getSheetByName(SHEET_SCHEDULE);
  var vals = sh.getDataRange().getDisplayValues();
  return vals.slice(1).filter(function (r) { return r[0]; }).map(function (r) {
    return {
      dayOfWeek: Number(r[0]), timeSlot: r[1], slotKey: r[2], timeRange: r[3],
      doctor: r[4], specialty: r[5], maxQuota: Number(r[6]),
      startTime: r[7], closedDates: r[8]
    };
  });
}

function readBookings_() {
  var sh = ss_().getSheetByName(SHEET_APPT);
  var vals = sh.getDataRange().getDisplayValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0]) continue;
    out.push({
      row: i + 1, code: r[0], date: r[1], timeSlot: r[2], sequence: Number(r[3]),
      name: r[4], phone: r[5], department: r[6], doctor: r[7], notes: r[8],
      status: r[9], createdAt: r[10], cancelledAt: r[11], email: r[12]
    });
  }
  return out;
}

function stamp_(now) {
  return Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
}

function sendMail_(to, subject, body) {
  if (!to) return;
  try {
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: '光明診所' });
  } catch (err) {
    console.error('sendMail failed: ' + err);
  }
}

function bookingMailBody_(b) {
  return [
    b.name + ' 您好，',
    '',
    '您的預約資料如下：',
    '預約代碼：' + b.code,
    '看診日期：' + b.date,
    '門診時段：' + b.timeSlot,
    '看診順序號：' + b.sequence,
    '主治醫師：' + b.doctor,
    '',
    '如需取消，請於門診時段開始前至官網「查詢／取消預約」，輸入預約代碼與手機號碼。',
    '光明診所 ' + CLINIC_PHONE
  ].join('\n');
}

function publicBooking_(b, rows, now) {
  return {
    appointmentCode: b.code, date: b.date, timeSlot: b.timeSlot, sequenceNumber: b.sequence,
    name: b.name, doctor: b.doctor, department: b.department, status: b.status,
    canCancel: canCancel(b, rows, now)
  };
}

function handleGetSchedule_(now) {
  var rows = readSchedule_();
  var days = buildSchedule(rows, readBookings_(), now);
  return { success: true, days: days, closures: listClosures(rows, now) };
}

function handleCreateBooking_(req, now) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var rows = readSchedule_();
    var bookings = readBookings_();
    var v = validateBooking(req, rows, bookings, now);
    if (!v.ok) return { success: false, error: v.error };

    var code = generateCode(bookings.map(function (b) { return b.code; }));
    var seq = nextSequence(bookings, req.date, v.slot.timeSlot);
    var b = {
      code: code, date: req.date, timeSlot: v.slot.timeSlot, sequence: seq, name: v.name,
      phone: v.phone, department: v.departmentLabel, doctor: v.slot.doctor,
      notes: String(req.notes || '').slice(0, 300), status: STATUS_OK,
      createdAt: stamp_(now), cancelledAt: '', email: v.email
    };
    ss_().getSheetByName(SHEET_APPT).appendRow([b.code, b.date, b.timeSlot, b.sequence, b.name,
      b.phone, b.department, b.doctor, b.notes, b.status, b.createdAt, b.cancelledAt, b.email]);
    SpreadsheetApp.flush();

    sendMail_(b.email, '【光明診所】預約成功通知 ' + b.date + ' ' + b.timeSlot, bookingMailBody_(b));
    return {
      success: true, appointmentCode: code, sequenceNumber: seq, date: b.date,
      timeSlot: b.timeSlot + ' (' + v.slot.timeRange + ')', doctor: b.doctor,
      emailSent: !!b.email
    };
  } finally {
    lock.releaseLock();
  }
}

function handleQueryBooking_(req, now) {
  var b = findBooking(readBookings_(), req.appointmentCode, req.phone);
  if (!b) return { success: false, error: '查無預約，請確認預約代碼與手機號碼' };
  return { success: true, booking: publicBooking_(b, readSchedule_(), now) };
}

function handleCancelBooking_(req, now) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var rows = readSchedule_();
    var b = findBooking(readBookings_(), req.appointmentCode, req.phone);
    if (!b) return { success: false, error: '查無預約，請確認預約代碼與手機號碼' };
    if (b.status !== STATUS_OK) return { success: false, error: '此預約已非有效狀態，無法取消' };
    if (!canCancel(b, rows, now)) {
      return { success: false, error: '門診時段已開始，無法線上取消，請致電 ' + CLINIC_PHONE };
    }
    var sh = ss_().getSheetByName(SHEET_APPT);
    sh.getRange(b.row, 10).setValue(STATUS_CANCELLED);
    sh.getRange(b.row, 12).setValue(stamp_(now));
    SpreadsheetApp.flush();
    sendMail_(b.email, '【光明診所】預約已取消 ' + b.date + ' ' + b.timeSlot,
      b.name + ' 您好，您於 ' + b.date + ' ' + b.timeSlot + ' 的預約（代碼 ' + b.code + '）已取消。');
    return { success: true, message: '預約已成功取消' };
  } finally {
    lock.releaseLock();
  }
}

// 無論是否比對成功都回相同訊息，避免被用來探測他人預約
function handleResendBooking_(req, now) {
  var generic = { success: true, message: '若資料相符，已將預約資料寄至您的信箱，請查收（含垃圾郵件匣）' };
  var phone = normalizePhone(req.phone);
  var email = String(req.email || '').trim().toLowerCase();
  if (!isValidPhone(phone) || !isValidEmail(email) || !email) {
    return { success: false, error: '請輸入正確的手機號碼與預約時填寫的電子郵件' };
  }
  var cache = CacheService.getScriptCache();
  var key = 'resend_' + phone;
  var count = Number(cache.get(key) || 0);
  if (count >= RESEND_LIMIT) {
    return { success: false, error: '查詢次數過多，請稍後再試或致電 ' + CLINIC_PHONE };
  }
  cache.put(key, String(count + 1), RESEND_WINDOW_SEC);

  var targets = findResendTargets(readBookings_(), phone, email, taipeiToday(now));
  if (targets.length) {
    sendMail_(email, '【光明診所】您的預約資料',
      targets.map(bookingMailBody_).join('\n\n----------\n\n'));
  }
  return generic;
}

function route_(req, now) {
  switch (req.action) {
    case 'getSchedule': return handleGetSchedule_(now);
    case 'createBooking': return handleCreateBooking_(req, now);
    case 'queryBooking': return handleQueryBooking_(req, now);
    case 'cancelBooking': return handleCancelBooking_(req, now);
    case 'resendBooking': return handleResendBooking_(req, now);
    default: return { success: false, error: '未知的操作' };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    return json_(route_(JSON.parse(e.postData.contents), new Date()));
  } catch (err) {
    console.error(err);
    return json_({ success: false, error: '系統忙碌中，請稍後再試或致電 ' + CLINIC_PHONE });
  }
}

function doGet() {
  return json_({ success: true, service: 'kingclinic-booking' });
}
```

- [ ] **Step 3: 建立 `docs/booking-setup.md`**

```markdown
# 線上預約系統部署步驟

1. 在 Google 雲端硬碟建立新試算表，命名為「光明診所_預約掛號與門診管理系統」。
2. 試算表選單 **擴充功能 → Apps Script**。
3. 將 `gas/Logic.gs`、`gas/Code.gs` 內容分別貼成同名檔案；在「專案設定」勾選「顯示 appsscript.json」，貼上 `gas/appsscript.json` 內容。
4. 在編輯器選擇函式 `setupSheets` 並執行一次，依提示授權。確認試算表出現兩個工作表，排班表已填入預設資料。
5. **部署 → 新增部署 → 類型：網頁應用程式**；執行身分「我」、存取權「所有人」。複製 `/exec` 結尾的網址。
6. 將網址填入 `assets/config.js` 的 `BOOKING_API_URL`，commit 並推送，GitHub Pages 會自動部署。
7. 之後修改 `Code.gs` / `Logic.gs` 時，需 **部署 → 管理部署 → 編輯 → 新版本** 才會生效，網址不變。

## 日常維運
- 調整名額：修改「排班與人數上限」的「線上名額上限」（0 = 不開放線上掛號）。
- 臨時休診：在該列「特殊休診日期」填入 `2026-11-05, 2026-11-12`（逗號分隔）。
- 「預約紀錄」所有欄位維持純文字格式，請勿手動排序或刪除標題列。
```

- [ ] **Step 4: 更新規格中的找回頻率**

在 `docs/superpowers/specs/2026-10-31-google-sheets-booking-system-design.md` 將
`同一手機每日最多觸發 3 次找回，防止濫發信件。` 改為
`同一手機每 6 小時最多觸發 3 次找回（以 CacheService 計數），防止濫發信件。`

- [ ] **Step 5: 確認純函式測試仍通過並 commit**

Run: `node --test tests/`
Expected: 18 tests PASS

```bash
git add gas docs
git commit -m "feat(gas): add Apps Script web app handlers and setup docs"
```

---

### Task 5: 前端設定與 `booking.js`

**Files:**
- Create: `assets/config.js`
- Create: `assets/booking.js`

- [ ] **Step 1: 建立 `assets/config.js`**

```js
// 部署 Apps Script 後，將 /exec 網址貼在這裡（見 docs/booking-setup.md）
window.BOOKING_API_URL = '';
```

- [ ] **Step 2: 建立 `assets/booking.js`**

```js
(function () {
  'use strict';

  var CLINIC_PHONE = '(02) 2821-0197';
  var DOW = ['', '一', '二', '三', '四', '五', '六', '日'];
  var scheduleDays = [];

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function callApi(payload) {
    if (!window.BOOKING_API_URL) {
      return Promise.reject(new Error('預約系統尚未啟用'));
    }
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 20000);
    // text/plain 可避免瀏覽器 CORS 預檢（Apps Script 不支援 OPTIONS）
    return fetch(window.BOOKING_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    }).then(function (res) {
      if (!res.ok) throw new Error('伺服器回應異常');
      return res.json();
    }).finally(function () { clearTimeout(timer); });
  }

  function showMsg(id, text, ok) {
    var box = $(id);
    box.textContent = text;
    box.className = 'mt-4 p-3 rounded-xl text-sm border ' + (ok
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : 'bg-rose-50 border-rose-200 text-rose-800');
    box.classList.remove('hidden');
  }

  function hideMsg(id) { $(id).classList.add('hidden'); }

  function networkError(id) {
    showMsg(id, '連線逾時或系統忙碌，請稍後再試，或致電 ' + CLINIC_PHONE + ' 預約。', false);
  }

  function setBusy(btn, busy) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = busy;
    btn.classList.toggle('opacity-60', busy);
    btn.textContent = busy ? '處理中…' : btn.dataset.label;
  }

  /* ---------- 頁籤 ---------- */
  function initTabs() {
    var tabs = document.querySelectorAll('[data-tab]');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) {
          var active = x === t;
          x.classList.toggle('bg-brand-600', active);
          x.classList.toggle('text-white', active);
          x.classList.toggle('text-slate-600', !active);
        });
        $('panel-book').classList.toggle('hidden', t.dataset.tab !== 'book');
        $('panel-lookup').classList.toggle('hidden', t.dataset.tab !== 'lookup');
      });
    });
  }

  /* ---------- 日期與時段選單 ---------- */
  function renderDates() {
    var sel = $('date');
    sel.innerHTML = '';
    if (!scheduleDays.length) {
      sel.appendChild(new Option('目前無可預約日期', '', true, true));
      sel.disabled = true;
      renderSlots();
      return;
    }
    sel.disabled = false;
    scheduleDays.forEach(function (d) {
      sel.appendChild(new Option(d.date + '（週' + DOW[d.dayOfWeek] + '）', d.date));
    });
    renderSlots();
  }

  function renderSlots() {
    var sel = $('timeslot');
    sel.innerHTML = '';
    var day = scheduleDays.filter(function (d) { return d.date === $('date').value; })[0];
    if (!day) {
      sel.appendChild(new Option('請先選擇日期', '', true, true));
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    var firstOpen = null;
    day.slots.forEach(function (s) {
      var label = s.timeSlot + ' ' + s.timeRange + (s.isFull ? ' [已額滿]' : ' [剩餘 ' + s.remaining + ' 名額]');
      var opt = new Option(label, s.slotKey);
      opt.disabled = s.isFull;
      sel.appendChild(opt);
      if (!s.isFull && !firstOpen) firstOpen = opt;
    });
    if (firstOpen) sel.value = firstOpen.value;
    else sel.selectedIndex = -1;
  }

  function loadSchedule() {
    return callApi({ action: 'getSchedule' }).then(function (res) {
      if (!res.success) throw new Error(res.error);
      scheduleDays = res.days;
      renderDates();
      renderClosures(res.closures || []);
      hideMsg('book-msg');
    }).catch(function () {
      scheduleDays = [];
      renderDates();
      showMsg('book-msg', '線上預約暫時無法使用，請致電 ' + CLINIC_PHONE + ' 預約。', false);
    });
  }

  function renderClosures(closures) {
    var box = $('timetable-closures');
    if (!box) return;
    if (!closures.length) { box.classList.add('hidden'); return; }
    box.textContent = '近期停診：' + closures.map(function (c) {
      return c.date.slice(5).replace('-', '/') + ' ' + c.timeSlot;
    }).join('、');
    box.classList.remove('hidden');
  }

  /* ---------- 結果卡 ---------- */
  function copyText(text, btn) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { btn.textContent = '已複製'; });
    }
  }

  function renderTicket(container, data, opts) {
    container.innerHTML = '';
    var card = el('div', 'p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900');
    card.appendChild(el('h4', 'font-bold text-base mb-3', opts.title));
    var codeRow = el('div', 'flex items-baseline gap-3 mb-3');
    codeRow.appendChild(el('span', 'text-xs text-emerald-700', '預約代碼'));
    codeRow.appendChild(el('span', 'text-3xl font-extrabold tracking-widest', data.appointmentCode));
    card.appendChild(codeRow);
    [['看診日期', data.date], ['門診時段', data.timeSlot], ['看診順序號', '第 ' + data.sequenceNumber + ' 號'],
      ['主治醫師', data.doctor]].forEach(function (kv) {
      var line = el('p', 'text-sm');
      line.appendChild(el('span', 'text-emerald-700 mr-2', kv[0]));
      line.appendChild(el('span', 'font-semibold', kv[1]));
      card.appendChild(line);
    });
    if (opts.note) card.appendChild(el('p', 'text-xs text-emerald-700 mt-3', opts.note));

    var text = '光明診所預約\n代碼：' + data.appointmentCode + '\n日期：' + data.date +
      '\n時段：' + data.timeSlot + '\n看診號：' + data.sequenceNumber;
    var copyBtn = el('button', 'mt-3 px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-xs font-bold', '複製預約資料');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', function () { copyText(text, copyBtn); });
    card.appendChild(copyBtn);

    if (opts.cancelable) {
      var cancelBtn = el('button', 'mt-3 ml-2 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold', '取消本次預約');
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', function () { opts.onCancel(cancelBtn); });
      card.appendChild(cancelBtn);
    } else if (opts.lockedNote) {
      card.appendChild(el('p', 'text-xs text-slate-500 mt-3', opts.lockedNote));
    }
    container.appendChild(card);
    container.classList.remove('hidden');
  }

  /* ---------- 掛號 ---------- */
  function onBookSubmit(ev) {
    ev.preventDefault();
    var btn = $('submit-btn');
    hideMsg('book-msg');
    $('book-result').classList.add('hidden');
    setBusy(btn, true);
    callApi({
      action: 'createBooking',
      date: $('date').value, slotKey: $('timeslot').value,
      name: $('name').value, phone: $('phone').value, email: $('email').value,
      department: $('department').value, notes: $('notes').value
    }).then(function (res) {
      if (!res.success) { showMsg('book-msg', res.error, false); return loadSchedule(); }
      renderTicket($('book-result'), {
        appointmentCode: res.appointmentCode, date: res.date, timeSlot: res.timeSlot,
        sequenceNumber: res.sequenceNumber, doctor: res.doctor
      }, {
        title: '預約成功！請記下您的預約代碼',
        note: res.emailSent ? '預約確認信已寄至您的信箱。' : '您未填寫電子郵件，請務必記下預約代碼；遺失時需致電 ' + CLINIC_PHONE + '。',
        lockedNote: '如需查詢或取消，請切換至「查詢／取消預約」。'
      });
      $('appointment-form').reset();
      $('book-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return loadSchedule();
    }).catch(function () { networkError('book-msg'); })
      .finally(function () { setBusy(btn, false); });
  }

  /* ---------- 查詢 / 取消 ---------- */
  function onLookupSubmit(ev) {
    ev.preventDefault();
    var btn = $('lookup-btn');
    hideMsg('lookup-msg');
    $('lookup-result').classList.add('hidden');
    setBusy(btn, true);
    var code = $('lookup-code').value;
    var phone = $('lookup-phone').value;
    callApi({ action: 'queryBooking', appointmentCode: code, phone: phone }).then(function (res) {
      if (!res.success) { showMsg('lookup-msg', res.error, false); return; }
      var b = res.booking;
      renderTicket($('lookup-result'), b, {
        title: '預約狀態：' + b.status,
        cancelable: b.canCancel,
        lockedNote: b.status === '預約成功' ? '門診時段已開始，無法線上取消，請致電 ' + CLINIC_PHONE + '。' : '',
        onCancel: function (cancelBtn) {
          if (!window.confirm('確定要取消 ' + b.date + ' ' + b.timeSlot + ' 的預約嗎？')) return;
          setBusy(cancelBtn, true);
          callApi({ action: 'cancelBooking', appointmentCode: code, phone: phone }).then(function (r) {
            $('lookup-result').classList.add('hidden');
            showMsg('lookup-msg', r.success ? r.message : r.error, !!r.success);
            if (r.success) loadSchedule();
          }).catch(function () { networkError('lookup-msg'); })
            .finally(function () { setBusy(cancelBtn, false); });
        }
      });
    }).catch(function () { networkError('lookup-msg'); })
      .finally(function () { setBusy(btn, false); });
  }

  /* ---------- 忘記代碼 ---------- */
  function onResendSubmit(ev) {
    ev.preventDefault();
    var btn = $('resend-btn');
    hideMsg('resend-msg');
    setBusy(btn, true);
    callApi({ action: 'resendBooking', phone: $('resend-phone').value, email: $('resend-email').value })
      .then(function (res) { showMsg('resend-msg', res.success ? res.message : res.error, !!res.success); })
      .catch(function () { networkError('resend-msg'); })
      .finally(function () { setBusy(btn, false); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!$('appointment-form')) return;
    initTabs();
    $('date').addEventListener('change', renderSlots);
    $('appointment-form').addEventListener('submit', onBookSubmit);
    $('lookup-form').addEventListener('submit', onLookupSubmit);
    $('resend-form').addEventListener('submit', onResendSubmit);
    $('resend-toggle').addEventListener('click', function () { $('resend-form').classList.toggle('hidden'); });
    loadSchedule();
  });
})();
```

- [ ] **Step 3: 語法檢查**

Run: `node --check assets/booking.js; node --check assets/config.js`
Expected: 無輸出（通過）

- [ ] **Step 4: Commit**

```bash
git add assets/config.js assets/booking.js
git commit -m "feat(web): add booking frontend client"
```

---

### Task 6: 改寫 `index.html` 預約區塊

**Files:**
- Modify: `index.html`（約 1031–1135 行表單區、1155–1262 行腳本區、約 783 行時間表備註前）

以下每一項都以現有內容定位，行號僅供參考。

- [ ] **Step 1: 標題區下方加入頁籤**

在右欄標題區（含 `<h3 ...>光明診所 線上預約掛號單</h3>` 的 `<div class="flex items-center gap-3 mb-6">` 整塊）之後、`<!-- Form -->` 之前，插入：

```html
<div class="flex gap-2 mb-6 p-1 bg-slate-100 rounded-xl text-sm font-bold">
  <button type="button" data-tab="book" class="flex-1 py-2 rounded-lg bg-brand-600 text-white transition">線上掛號</button>
  <button type="button" data-tab="lookup" class="flex-1 py-2 rounded-lg text-slate-600 transition">查詢／取消預約</button>
</div>
```

並把標題下方說明文字 `送出表單後，門診同仁將於看診時段內與您電話確認預約資訊` 改為 `開放預約未來 7 天內門診（當日不開放），送出後立即取得預約代碼`。

- [ ] **Step 2: 掛號表單包進 `panel-book`，移除 inline handler**

- 把 `<form id="appointment-form" class="space-y-5" onsubmit="handleFormSubmit(event)">` 改為 `<div id="panel-book"><form id="appointment-form" class="space-y-5">`，並在該 `</form>` 之後加上：

```html
<div id="book-msg" class="hidden"></div>
<div id="book-result" class="hidden mt-6"></div>
</div>
```

- 日期欄：把 `<input type="date" id="date" required ...>` 換成：

```html
<select id="date" required class="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none text-sm transition bg-white text-slate-700">
  <option value="">載入中…</option>
</select>
```

並將該欄標籤文字 `希望看診日期` 改為 `看診日期（未來 7 天內）`。

- 時段欄：把 `<select id="timeslot" ...>` 內三個靜態 `<option>` 全部刪除，改放 `<option value="">請先選擇日期</option>`。
- 在「姓名 / 聯絡電話」那個 grid 之後新增 Email 欄：

```html
<div>
  <label for="email" class="block text-xs font-bold text-slate-700 uppercase mb-1.5">
    電子郵件 <span class="text-slate-400 normal-case font-normal">（選填）</span>
  </label>
  <input type="email" id="email" placeholder="填寫後將寄送預約確認信，忘記代碼時可由信箱找回"
         class="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none text-sm transition">
</div>
```

- 聯絡電話 placeholder 改為 `手機號碼，例: 0912345678`，並加上 `inputmode="numeric"`。
- 將送出按鈕文字 `送出預約申請` 改為 `確認預約`。

- [ ] **Step 3: 刪除舊的成功提示，改為查詢面板**

刪除整個 `<!-- Success Alert Notification -->` 的 `<div id="booking-success" ...>...</div>`，在原位置貼上：

```html
<div id="panel-lookup" class="hidden">
  <form id="lookup-form" class="space-y-5">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
      <div>
        <label for="lookup-code" class="block text-xs font-bold text-slate-700 uppercase mb-1.5">預約代碼（6 位數字）</label>
        <input type="text" id="lookup-code" required inputmode="numeric" maxlength="6" pattern="\d{6}"
               class="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none text-sm transition">
      </div>
      <div>
        <label for="lookup-phone" class="block text-xs font-bold text-slate-700 uppercase mb-1.5">手機號碼</label>
        <input type="tel" id="lookup-phone" required inputmode="numeric" placeholder="0912345678"
               class="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none text-sm transition">
      </div>
    </div>
    <button type="submit" id="lookup-btn" class="w-full py-3 rounded-xl font-bold text-white bg-brand-600 hover:bg-brand-700 transition">查詢預約</button>
  </form>
  <div id="lookup-msg" class="hidden"></div>
  <div id="lookup-result" class="hidden mt-6"></div>

  <div class="mt-8 pt-6 border-t border-slate-200">
    <button type="button" id="resend-toggle" class="text-sm font-bold text-brand-600 hover:underline">忘記預約代碼？</button>
    <form id="resend-form" class="hidden mt-4 space-y-4">
      <p class="text-xs text-slate-500">輸入預約時的手機與電子郵件，系統會將預約資料重寄至該信箱。未填寫電子郵件者請致電 (02) 2821-0197。</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <input type="tel" id="resend-phone" required inputmode="numeric" placeholder="手機號碼"
               class="px-4 py-2.5 rounded-xl border border-slate-300 outline-none text-sm focus:border-brand-500">
        <input type="email" id="resend-email" required placeholder="預約時填寫的電子郵件"
               class="px-4 py-2.5 rounded-xl border border-slate-300 outline-none text-sm focus:border-brand-500">
      </div>
      <button type="submit" id="resend-btn" class="px-5 py-2.5 rounded-xl font-bold text-white bg-slate-700 hover:bg-slate-800 transition text-sm">寄送預約資料</button>
      <div id="resend-msg" class="hidden"></div>
    </form>
  </div>
</div>
```

- [ ] **Step 4: 腳本區**

- 刪除 `DOMContentLoaded` 內「Set default minimum date for booking input to today」整段（`const today ...` 到 `if (dateInput) {...}`），保留 `lucide.createIcons();`。
- 刪除整個 `// Handle Appointment Booking Submission` 的 `function handleFormSubmit(event) {...}`。
- 在 `<!-- ==================== 13. JAVASCRIPT LOGIC ==================== -->` 的 `<script>` 之前加入：

```html
<script src="assets/config.js"></script>
<script src="assets/booking.js" defer></script>
```

- [ ] **Step 5: 時間表停診提示容器**

在 `<!-- Schedule Notes -->` 區塊（`<div class="bg-slate-50 p-4 border-t ...">`）**之前**插入：

```html
<div id="timetable-closures" class="hidden px-4 py-2.5 bg-amber-50 border-t border-amber-200 text-xs font-semibold text-amber-800"></div>
```

- [ ] **Step 6: 靜態檢查**

Run: `Select-String -Path index.html -Pattern 'handleFormSubmit|booking-success'`
Expected: 無任何匹配

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(web): replace mock booking form with live booking tabs"
```

---

### Task 7: 以假後端驗證前端行為（尚未部署前）

**Files:**
- 無新增（暫時性驗證，不提交）

- [ ] **Step 1: 啟動本機靜態伺服器**

Run: `python -m http.server 8080`（背景執行）
Expected: `Serving HTTP on ... port 8080`

- [ ] **Step 2: 未設定網址時的降級**

開啟 `http://localhost:8080/#booking`。
Expected: 掛號面板出現「線上預約暫時無法使用，請致電 (02) 2821-0197 預約。」，日期欄顯示「目前無可預約日期」，頁面無 console 錯誤。

- [ ] **Step 3: 以瀏覽器攔截模擬 API**

在瀏覽器 console 貼上，模擬 API 回應：

```js
window.BOOKING_API_URL = 'https://example.invalid/exec';
window.fetch = async (u, o) => {
  const a = JSON.parse(o.body).action;
  const j = x => ({ ok: true, json: async () => x });
  if (a === 'getSchedule') return j({ success: true, closures: [{ date: '2026-11-05', timeSlot: '早診' }],
    days: [{ date: '2026-11-04', dayOfWeek: 3, slots: [
      { slotKey: 'morning', timeSlot: '早診', timeRange: '09:00 - 12:00', remaining: 0, isFull: true },
      { slotKey: 'evening', timeSlot: '晚診', timeRange: '18:00 - 20:00', remaining: 5, isFull: false }] }] });
  if (a === 'createBooking') return j({ success: true, appointmentCode: '839102', sequenceNumber: 3,
    date: '2026-11-04', timeSlot: '晚診 (18:00 - 20:00)', doctor: '張光明 院長', emailSent: false });
  return j({ success: false, error: 'mock' });
};
location.hash = '#booking';
```

因 `booking.js` 在載入時已執行過 `loadSchedule`，貼完後在 console 再執行 `document.dispatchEvent(new Event('DOMContentLoaded'))` 重新載入（事件監聽會重複綁定，僅供此次手動驗證）。

Expected：時段下拉「早診 … [已額滿]」為灰色不可選、「晚診 … [剩餘 5 名額]」預設選中；時間表下方出現「近期停診：11/05 早診」；填單送出後顯示含 `839102` 與「第 3 號」的結果卡，並有未填 Email 的提醒文字。

- [ ] **Step 4: 手機版面檢查**

用開發者工具切換 375px 寬，確認頁籤、表單、結果卡無橫向捲動。

- [ ] **Step 5: 停止伺服器**

停止步驟 1 的 `python` 程序（以其 PID）。

---

### Task 8: 部署與實機端對端驗證

**Files:**
- Modify: `assets/config.js`（填入實際網址）

此任務需要使用者的 Google 帳號操作，無法由代理人代為完成；代理人負責帶步驟與核對結果。

- [ ] **Step 1: 依 `docs/booking-setup.md` 完成試算表建立、`setupSheets`、部署**

Expected: 試算表有兩個工作表，排班表有 11 列預設資料。

- [ ] **Step 2: 直接測 API**

Run（把 URL 換成實際 `/exec` 網址）：

```powershell
curl.exe -L -X POST "<EXEC_URL>" -H "Content-Type: text/plain" -d "{\"action\":\"getSchedule\"}"
```

Expected: 回傳 `{"success":true,"days":[...],"closures":[]}`，`days` 日期為明日起 7 天內有門診的日子。

- [ ] **Step 3: 填入網址、推送、驗證官網**

編輯 `assets/config.js`：`window.BOOKING_API_URL = '<EXEC_URL>';`

```bash
git add assets/config.js
git commit -m "chore: set booking API url"
git push
```

在 GitHub Pages 網址逐項驗證：

| # | 操作 | 預期 |
|---|---|---|
| 1 | 日期下拉 | 僅明日起 7 天內有門診的日子；不含當日、週日 |
| 2 | 預約明日某時段（填 Email） | 顯示 6 位代碼與看診號；試算表新增一列；收到確認信 |
| 3 | 同手機同日再預約 | 顯示「不可重複預約」 |
| 4 | 試算表把某時段名額改 1 並預約滿 | 該時段變灰「已額滿」 |
| 5 | 查詢（代碼＋手機） | 顯示預約卡與「取消本次預約」按鈕 |
| 6 | 手機錯誤的查詢 | 「查無預約」，不洩漏其他資訊 |
| 7 | 取消 | 試算表狀態變「已取消」、取消時間有值、名額釋出、收到取消信 |
| 8 | 忘記代碼（手機＋Email） | 顯示通用訊息並收到含代碼的信；連續第 4 次被限制 |
| 9 | 試算表把明日某診次「特殊休診日期」填明日日期 | 該時段從下拉消失，時間表出現停診提示 |
| 10 | 兩個瀏覽器同時搶最後一個名額 | 只有一人成功，看診號不重複 |

- [ ] **Step 4: 清理測試資料**

刪除「預約紀錄」中的測試列（保留標題列），並還原測試時改過的名額。

---

## Self-Review

**Spec coverage**

| 規格需求 | 對應任務 |
|---|---|
| 排班/名額/休診日資料表、預約紀錄含 Email 欄 | Task 4（`setupSheets`、`readSchedule_`/`readBookings_`） |
| D+1~D+7、當日不開放 | Task 1 `buildSchedule`、Task 2 `validateBooking` |
| 額滿反灰 | Task 1 `isFull`、Task 5 `renderSlots`（`opt.disabled`） |
| 同日同手機防重複 | Task 2 `validateBooking` |
| LockService 防超賣/重號 | Task 4 `handleCreateBooking_`、`handleCancelBooking_` |
| 6 位數字代碼 + 看診號 | Task 2 `generateCode`、`nextSequence` |
| 查詢（代碼＋手機雙條件） | Task 3 `findBooking`、Task 4 `handleQueryBooking_` |
| 開診前可取消、之後鎖定 | Task 3 `canCancel`、Task 4 `handleCancelBooking_`、Task 5 結果卡 |
| 確認信與取消信（寄信失敗不影響預約） | Task 4 `sendMail_` |
| 忘記代碼找回、通用回覆、頻率限制 | Task 3 `findResendTargets`、Task 4 `handleResendBooking_`、Task 5/6 UI |
| 留在 GitHub Pages、頁籤介面 | Task 5、Task 6 |
| 時間表停診提示、降級顯示電話 | Task 3 `listClosures`、Task 5 `renderClosures`/`loadSchedule` catch |
| 午/晚診沿用表單三段 | Task 1 `DEFAULT_SCHEDULE`（週二、四晚診 17:00 起，其餘 18:00 起） |

**Placeholder scan:** 無 TBD/TODO；`BOOKING_API_URL` 為部署後才有的真實值，已在 Task 8 明確填寫步驟。

**Type consistency:** 預約物件欄位（`code/date/timeSlot/sequence/name/phone/department/doctor/notes/status/createdAt/cancelledAt/email/row`）在 `Logic.gs` 測試夾具、`readBookings_`、`appendRow` 欄位順序（A–M）三處一致；API 回傳欄位 `appointmentCode/sequenceNumber/timeSlot/doctor/canCancel` 與 `booking.js` 的讀取一致；`validateBooking` 回傳的 `slot/phone/email/name/departmentLabel` 與 `handleCreateBooking_` 使用處一致。

**已知取捨:** 防重複以手機號碼判斷（換號碼可再掛）；`Code.gs` 無法本機單元測試，以 Task 8 實機驗證。
