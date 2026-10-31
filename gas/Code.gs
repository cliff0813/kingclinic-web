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
