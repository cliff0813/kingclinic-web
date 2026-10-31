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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATUS_OK: STATUS_OK, STATUS_CANCELLED: STATUS_CANCELLED, WINDOW_DAYS: WINDOW_DAYS,
    DEPARTMENTS: DEPARTMENTS, DEFAULT_SCHEDULE: DEFAULT_SCHEDULE,
    taipeiToday: taipeiToday, addDays: addDays, isoDow: isoDow,
    parseClosed: parseClosed, isActive: isActive,     buildSchedule: buildSchedule,
    normalizePhone: normalizePhone, isValidPhone: isValidPhone, isValidEmail: isValidEmail,
    validateBooking: validateBooking, nextSequence: nextSequence, generateCode: generateCode,
    findBooking: findBooking, canCancel: canCancel, findResendTargets: findResendTargets, listClosures: listClosures
  };
}
