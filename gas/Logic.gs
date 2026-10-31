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
