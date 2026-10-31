(function () {
  'use strict';

  var DISCLAIMER = '本文為一般衛教資訊，不能取代醫師的面對面診察；實際治療方式需依您的症狀、影像檢查與身體狀況，由醫師評估後決定。';

  var ARTICLES = {
    notice: {
      tag: '門診異動公告',
      meta: '最新公告 • 光明診所 行政處',
      title: '門診時間異動與預約看診提醒公告',
      body: [
        '為維持每位病患的看診品質與充裕的問診時間，建議初診與複診民眾事先預約掛號。',
        '<strong>預約方式</strong><ul class="list-disc pl-5 mt-1 space-y-1"><li>線上預約：直接使用本網站「預約看診」區塊，可預約明日起 7 天內的門診，當日不開放線上掛號。</li><li>預約代碼：預約成功後會取得 6 位數預約代碼，可用代碼與手機號碼查詢或取消。</li><li>電話預約：(02) 2821-0197。</li></ul>',
        '<strong>取消預約</strong>：請於門診時段開始前至網站取消，讓名額開放給其他病患。',
        '<strong>休診公告</strong>：遇國定假日或醫師研討會休診，將提早公告於診所現場與本網站「近期停診」提示。',
        '<strong>看診提醒</strong>：請攜帶健保卡及過往的檢查報告或影像資料，以利醫師評估。'
      ]
    },
    knee: {
      tag: '骨科衛教',
      meta: '醫師衛教 • 張光明 院長',
      title: '膝蓋退化一定要換人工關節嗎？從玻尿酸到 PRP 階梯治療解析',
      body: [
        '膝關節退化性關節炎是漸進式的變化，並不是一確診就需要開刀。多數患者在早期到中期，可以透過保守治療控制疼痛、維持活動能力，並延緩需要手術的時間。',
        '<strong>第一階：生活調整與復健</strong><ul class="list-disc pl-5 mt-1 space-y-1"><li>體重控制：減輕體重可降低膝關節每一步所承受的壓力。</li><li>健保物理復健：加強大腿前側的股四頭肌肌力，有助穩定膝關節。</li><li>避免久蹲、爬樓梯過量等會加重負擔的動作。</li></ul>',
        '<strong>第二階：關節腔玻尿酸注射</strong>：玻尿酸可增加關節腔的潤滑與緩衝，適合疼痛、僵硬但關節結構尚可的患者，通常需要依醫師建議的療程施打。',
        '<strong>第三階：PRP 自體血小板注射</strong>：抽取自身血液濃縮血小板後，於超音波導引下注射至患處，目的是促進組織修復與改善發炎環境。是否適合，需由醫師評估。',
        '<strong>什麼情況需要考慮手術？</strong>：經過完整保守治療後仍嚴重疼痛、影響日常生活，或影像顯示關節嚴重破壞時，才會與您討論手術。',
        '若您有膝蓋疼痛、上下樓梯卡卡或久坐後僵硬，建議儘早就診評估，越早介入，可選擇的方式越多。'
      ]
    },
    eswt: {
      tag: '疼痛治療',
      meta: '疼痛解析 • 張光明 院長',
      title: '早上下床踩地足跟劇痛？德國聚焦型體外震波精準瓦解足底筋膜炎',
      body: [
        '早上起床第一步踩地時，腳跟或足底刺痛，走一會兒後稍微緩解，是足底筋膜炎常見的表現。長時間站立、走路、運動量突然增加或鞋子支撐不足，都可能誘發。',
        '<strong>為什麼會反覆發作？</strong>：足底筋膜長期受到牽拉，容易產生慢性發炎，部分患者會出現鈣化或骨刺。若只休息、不處理原因，常在恢復活動後再次疼痛。',
        '<strong>聚焦型體外震波 (ESWT)</strong>：利用聲波能量傳遞到深層痛點，刺激組織修復與局部血液循環，不需要開刀，也沒有傷口。治療過程中可能有短暫痠痛感，通常一次治療時間不長，需依醫師評估安排療程次數。',
        '<strong>治療之外，也要配合</strong><ul class="list-disc pl-5 mt-1 space-y-1"><li>選擇有足弓支撐、鞋底緩衝良好的鞋子。</li><li>做足底筋膜與小腿肌群的伸展。</li><li>控制體重，避免短時間內大量增加走路或跑步量。</li></ul>',
        '若疼痛超過數週仍未改善，建議就診，由醫師確認是否為足底筋膜炎，並排除其他原因。'
      ]
    }
  };

  var modal = document.getElementById('article-modal');
  if (!modal) return;
  var lastTrigger = null;

  function open(key, trigger) {
    var a = ARTICLES[key];
    if (!a) return;
    lastTrigger = trigger || null;
    document.getElementById('article-tag').textContent = a.tag;
    document.getElementById('article-meta').textContent = a.meta;
    document.getElementById('article-title').textContent = a.title;
    var html = a.body.map(function (p) { return '<p>' + p + '</p>'; }).join('');
    if (key !== 'notice') {
      html += '<p class="text-xs text-slate-400 border-t border-slate-100 pt-4">' + DISCLAIMER + '</p>';
    }
    var body = document.getElementById('article-body');
    body.innerHTML = html;
    body.scrollTop = 0;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    modal.querySelector('button[data-close]').focus();
  }

  function close() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = '';
    if (lastTrigger) lastTrigger.focus();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-article]');
    if (t) { open(t.getAttribute('data-article'), t); return; }
    if (e.target.closest('#article-modal [data-close]')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  if (window.lucide) window.lucide.createIcons();
})();
