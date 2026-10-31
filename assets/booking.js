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