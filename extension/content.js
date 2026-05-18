// ◊ FallCall Live — Content Script (Sidebar Overlay)
// Injected into the page — creates a shadow DOM coaching panel
// Receives analysis results from background → offscreen pipeline

(function() {
  'use strict';

  // Prevent double-injection
  if (window.__fallcallLive) return;
  window.__fallcallLive = true;

  // ── State ──
  let sidebar = null;
  let shadow = null;
  let collapsed = false;
  let visible = false;
  let callActive = false;
  let callStartTime = null;
  let timerInterval = null;
  let latestAnalysis = null;
  let transcriptLog = [];
  let coachingHistory = [];
  let registerTimeline = [];

  // ── Message Listener ──
  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.action) {
      case 'showSidebar':
        show();
        break;
      case 'updateSidebar':
        updateAnalysis(msg.data);
        break;
      case 'updateTranscript':
        addTranscriptLine(msg.data);
        break;
      case 'callEnded':
        endCall();
        break;
      case 'hideSidebar':
        hide();
        break;
    }
  });

  // ── Create Sidebar ──
  function createSidebar() {
    if (sidebar) return;

    sidebar = document.createElement('div');
    sidebar.id = 'fallcall-live-root';
    sidebar.style.cssText = 'all:initial;position:fixed;top:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(sidebar);

    shadow = sidebar.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = CSS_CONTENT;
    shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'fc-panel';
    panel.className = 'fc-panel';
    panel.innerHTML = PANEL_HTML;
    shadow.appendChild(panel);

    // Wire up UI events
    wireEvents();
  }

  // ── Show / Hide ──
  function show() {
    createSidebar();
    visible = true;
    callActive = true;
    callStartTime = Date.now();
    collapsed = false;
    const panel = shadow.getElementById('fc-panel');
    panel.classList.add('fc-visible');
    panel.classList.remove('fc-collapsed');
    startTimer();
  }

  function hide() {
    if (!sidebar) return;
    visible = false;
    const panel = shadow.getElementById('fc-panel');
    panel.classList.remove('fc-visible');
    clearInterval(timerInterval);
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    const panel = shadow.getElementById('fc-panel');
    panel.classList.toggle('fc-collapsed', collapsed);
  }

  // ── Timer ──
  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (!callStartTime || !shadow) return;
      const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      const el = shadow.getElementById('fc-timer');
      if (el) el.textContent = m + ':' + String(s).padStart(2, '0');
    }, 1000);
  }

  // ── Update Analysis ──
  function updateAnalysis(data) {
    if (!shadow) return;
    latestAnalysis = data;

    // Register gauge
    const regEl = shadow.getElementById('fc-reg-level');
    const regBar = shadow.getElementById('fc-reg-bar');
    if (regEl && regBar) {
      regEl.textContent = 'REG-' + data.register.level;
      regBar.style.width = ((data.register.level / 4) * 100) + '%';
      regBar.className = 'fc-reg-fill fc-reg-' + data.register.level;
    }

    // Talk ratio
    const talkEl = shadow.getElementById('fc-talk');
    if (talkEl) {
      talkEl.textContent = data.talkRatio.rep + '/' + data.talkRatio.prospect;
      talkEl.className = 'fc-stat-val' + (data.talkRatio.rep > 65 ? ' fc-warn' : '');
    }

    // Ghost risk
    const ghostEl = shadow.getElementById('fc-ghost');
    if (ghostEl) {
      const risk = data.ghostRisk.risk;
      ghostEl.textContent = risk > 50 ? 'HIGH' : risk > 25 ? 'MED' : 'LOW';
      ghostEl.className = 'fc-alert-val' + (risk > 50 ? ' fc-alert-high' : risk > 25 ? ' fc-alert-med' : ' fc-alert-low');
    }

    // False positive (based on ghost risk + energy)
    const fpEl = shadow.getElementById('fc-fp');
    if (fpEl) {
      const fp = Math.min(100, data.ghostRisk.risk + (data.energyTrend.trend === 'falling' ? 20 : 0));
      fpEl.textContent = fp > 50 ? 'HIGH' : fp > 25 ? 'MED' : 'LOW';
      fpEl.className = 'fc-alert-val' + (fp > 50 ? ' fc-alert-high' : fp > 25 ? ' fc-alert-med' : ' fc-alert-low');
    }

    // Signal count
    const sigCountEl = shadow.getElementById('fc-sig-count');
    if (sigCountEl) sigCountEl.textContent = data.signals.length;

    // Objection count
    const objCountEl = shadow.getElementById('fc-obj-count');
    if (objCountEl) objCountEl.textContent = data.objections.length;

    // Coaching tips (main panel)
    const coachEl = shadow.getElementById('fc-coaching');
    if (coachEl && data.coaching.length > 0) {
      coachEl.innerHTML = data.coaching.map(tip =>
        '<div class="fc-tip fc-tip-' + tip.type + '">' +
          '<span class="fc-tip-icon">' + tip.icon + '</span>' +
          '<span class="fc-tip-text">' + escapeHtml(tip.text) + '</span>' +
        '</div>'
      ).join('');
      // Add to history
      data.coaching.forEach(tip => {
        coachingHistory.unshift({ ...tip, time: Date.now() });
      });
      if (coachingHistory.length > 50) coachingHistory.length = 50;
    }

    // Signals list
    const sigEl = shadow.getElementById('fc-signals');
    if (sigEl) {
      if (data.signals.length > 0) {
        sigEl.innerHTML = data.signals.map(s =>
          '<div class="fc-det-item">' +
            '<span class="fc-det-dot fc-dot-green"></span>' +
            '<span class="fc-det-code">' + s.code + '</span>' +
            '<span class="fc-det-time">' + formatTime(s.time) + '</span>' +
            '<span class="fc-det-text">"' + escapeHtml(s.text.substring(0, 40)) + '..."</span>' +
          '</div>'
        ).join('');
      } else {
        sigEl.innerHTML = '<div class="fc-det-empty">No signals detected yet</div>';
      }
    }

    // Objections list
    const objEl = shadow.getElementById('fc-objections');
    if (objEl) {
      if (data.objections.length > 0) {
        objEl.innerHTML = data.objections.map(o =>
          '<div class="fc-det-item">' +
            '<span class="fc-det-dot fc-dot-red"></span>' +
            '<span class="fc-det-code">' + o.code + '</span>' +
            '<span class="fc-det-time">' + formatTime(o.time) + '</span>' +
            '<span class="fc-det-text">"' + escapeHtml(o.text.substring(0, 40)) + '..."</span>' +
          '</div>'
        ).join('');
      } else {
        objEl.innerHTML = '<div class="fc-det-empty">No objections detected</div>';
      }
    }

    // Register timeline sparkline
    if (data.register.trajectory.length > 0) {
      registerTimeline = data.register.trajectory;
      renderSparkline();
    }

    // Collapsed strip values
    const stripReg = shadow.getElementById('fc-strip-reg');
    const stripTalk = shadow.getElementById('fc-strip-talk');
    const stripSig = shadow.getElementById('fc-strip-sig');
    const stripObj = shadow.getElementById('fc-strip-obj');
    if (stripReg) stripReg.textContent = 'REG-' + data.register.level;
    if (stripTalk) stripTalk.textContent = data.talkRatio.rep + '/' + data.talkRatio.prospect;
    if (stripSig) stripSig.textContent = data.signals.length;
    if (stripObj) stripObj.textContent = data.objections.length;
  }

  // ── Add Transcript Line ──
  function addTranscriptLine(utterance) {
    transcriptLog.push(utterance);
  }

  // ── End Call ──
  function endCall() {
    callActive = false;
    clearInterval(timerInterval);
    const badge = shadow.getElementById('fc-badge');
    if (badge) {
      badge.textContent = 'CALL ENDED';
      badge.className = 'fc-badge fc-badge-ended';
    }
  }

  // ── Sparkline Renderer ──
  function renderSparkline() {
    const canvas = shadow.getElementById('fc-sparkline');
    if (!canvas || !registerTimeline.length) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = canvas.offsetHeight * 2;
    ctx.clearRect(0, 0, w, h);

    const colors = ['#5e5b72', '#6c5ce7', '#f0c040', '#00d68f', '#00d68f'];
    const step = w / Math.max(registerTimeline.length - 1, 1);

    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let i = 1; i < registerTimeline.length; i++) {
      const x0 = (i - 1) * step;
      const y0 = h - ((registerTimeline[i - 1] / 4) * (h - 8)) - 4;
      const x1 = i * step;
      const y1 = h - ((registerTimeline[i] / 4) * (h - 8)) - 4;
      ctx.beginPath();
      ctx.strokeStyle = colors[registerTimeline[i]];
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  // ── Wire Events ──
  function wireEvents() {
    const collapseBtn = shadow.getElementById('fc-collapse');
    if (collapseBtn) collapseBtn.addEventListener('click', toggleCollapse);

    const closeBtn = shadow.getElementById('fc-close');
    if (closeBtn) closeBtn.addEventListener('click', hide);

    const expandStrip = shadow.getElementById('fc-strip');
    if (expandStrip) expandStrip.addEventListener('click', () => { collapsed = false; shadow.getElementById('fc-panel').classList.remove('fc-collapsed'); });
  }

  // ── Helpers ──
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function formatTime(seconds) {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PANEL HTML TEMPLATE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const PANEL_HTML = `
    <!-- Collapsed strip -->
    <div class="fc-strip" id="fc-strip">
      <span class="fc-strip-logo">◊</span>
      <span class="fc-strip-item" id="fc-strip-reg">REG-0</span>
      <span class="fc-strip-sep">|</span>
      <span class="fc-strip-item" id="fc-strip-talk">--/--</span>
      <span class="fc-strip-sep">|</span>
      <span class="fc-strip-item fc-strip-sig-icon">⚡<span id="fc-strip-sig">0</span></span>
      <span class="fc-strip-item fc-strip-obj-icon">🛡<span id="fc-strip-obj">0</span></span>
    </div>

    <!-- Full panel -->
    <div class="fc-full">
      <!-- Header -->
      <div class="fc-header">
        <span class="fc-logo">Fall<span class="fc-accent">Call</span> Live</span>
        <div class="fc-header-btns">
          <span class="fc-badge fc-badge-live" id="fc-badge">LIVE</span>
          <button class="fc-btn" id="fc-collapse" title="Collapse">─</button>
          <button class="fc-btn" id="fc-close" title="Close">✕</button>
        </div>
      </div>

      <!-- Status bar -->
      <div class="fc-status">
        <div class="fc-status-item">
          <span class="fc-status-icon">⏱</span>
          <span class="fc-status-val" id="fc-timer">0:00</span>
        </div>
        <div class="fc-status-item">
          <span class="fc-status-label">REG</span>
          <div class="fc-reg-track"><div class="fc-reg-fill fc-reg-0" id="fc-reg-bar"></div></div>
          <span class="fc-status-val" id="fc-reg-level">REG-0</span>
        </div>
        <div class="fc-status-item">
          <span class="fc-status-label">Talk</span>
          <span class="fc-stat-val" id="fc-talk">--/--</span>
        </div>
      </div>

      <!-- Coaching tips (main, most prominent) -->
      <div class="fc-section">
        <div class="fc-section-head">
          <span class="fc-section-icon">💬</span>
          <span class="fc-section-title">COACHING</span>
        </div>
        <div class="fc-coaching" id="fc-coaching">
          <div class="fc-tip fc-tip-info">
            <span class="fc-tip-icon">◊</span>
            <span class="fc-tip-text">Listening... coaching tips will appear here as the call progresses.</span>
          </div>
        </div>
      </div>

      <!-- Signals -->
      <div class="fc-section">
        <div class="fc-section-head">
          <span class="fc-section-icon">⚡</span>
          <span class="fc-section-title">SIGNALS</span>
          <span class="fc-section-count" id="fc-sig-count">0</span>
        </div>
        <div class="fc-det-list" id="fc-signals">
          <div class="fc-det-empty">No signals detected yet</div>
        </div>
      </div>

      <!-- Objections -->
      <div class="fc-section">
        <div class="fc-section-head">
          <span class="fc-section-icon">🛡</span>
          <span class="fc-section-title">OBJECTIONS</span>
          <span class="fc-section-count" id="fc-obj-count">0</span>
        </div>
        <div class="fc-det-list" id="fc-objections">
          <div class="fc-det-empty">No objections detected</div>
        </div>
      </div>

      <!-- Register timeline -->
      <div class="fc-section">
        <div class="fc-section-head">
          <span class="fc-section-icon">📊</span>
          <span class="fc-section-title">REGISTER</span>
        </div>
        <canvas class="fc-sparkline" id="fc-sparkline"></canvas>
        <div class="fc-spark-labels">
          <span>0:00</span><span>now</span>
        </div>
      </div>

      <!-- Alerts -->
      <div class="fc-section fc-alerts">
        <div class="fc-section-head">
          <span class="fc-section-icon">⚠</span>
          <span class="fc-section-title">ALERTS</span>
        </div>
        <div class="fc-alert-row">
          <span class="fc-alert-label">Ghost risk</span>
          <span class="fc-alert-val fc-alert-low" id="fc-ghost">LOW</span>
        </div>
        <div class="fc-alert-row">
          <span class="fc-alert-label">False +ve</span>
          <span class="fc-alert-val fc-alert-low" id="fc-fp">LOW</span>
        </div>
      </div>
    </div>
  `;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CSS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const CSS_CONTENT = `
    :host { all: initial; }

    .fc-panel {
      position: fixed;
      top: 0;
      right: -340px;
      width: 320px;
      height: 100vh;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #b8b5c8;
      background: #06070b;
      border-left: 1px solid #1a1b28;
      box-shadow: -4px 0 24px rgba(0,0,0,.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      pointer-events: auto;
      transition: right .3s cubic-bezier(.16,1,.3,1);
      z-index: 2147483647;
    }
    .fc-panel.fc-visible { right: 0; }
    .fc-panel.fc-collapsed { right: -280px; }
    .fc-panel.fc-collapsed .fc-full { opacity: 0; pointer-events: none; }
    .fc-panel.fc-collapsed .fc-strip { opacity: 1; pointer-events: auto; }

    /* ── Collapsed strip ── */
    .fc-strip {
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 10px 4px;
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition: opacity .2s;
      background: #0c0d14;
      border-radius: 0;
      border-right: 1px solid #1a1b28;
    }
    .fc-strip-logo { font-size: 16px; color: #6c5ce7; }
    .fc-strip-item { font-family: Consolas, monospace; font-size: 8px; color: #5e5b72; writing-mode: vertical-lr; text-orientation: mixed; }
    .fc-strip-sep { color: #1a1b28; font-size: 8px; }
    .fc-strip-sig-icon, .fc-strip-obj-icon { font-size: 10px; }

    /* ── Full panel ── */
    .fc-full {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      overflow-x: hidden;
      transition: opacity .2s;
    }
    .fc-full::-webkit-scrollbar { width: 4px; }
    .fc-full::-webkit-scrollbar-track { background: transparent; }
    .fc-full::-webkit-scrollbar-thumb { background: #252738; border-radius: 2px; }

    /* ── Header ── */
    .fc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #1a1b28;
      flex-shrink: 0;
    }
    .fc-logo { font-weight: 700; font-size: 15px; color: #eae7ff; letter-spacing: -.02em; }
    .fc-accent { color: #6c5ce7; }
    .fc-header-btns { display: flex; align-items: center; gap: 6px; }
    .fc-btn {
      background: none;
      border: 1px solid #1a1b28;
      border-radius: 4px;
      color: #5e5b72;
      font-size: 11px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all .15s;
    }
    .fc-btn:hover { border-color: #6c5ce7; color: #eae7ff; }

    .fc-badge {
      font-family: Consolas, monospace;
      font-size: 9px;
      padding: 2px 8px;
      border-radius: 3px;
      letter-spacing: .06em;
      font-weight: 600;
    }
    .fc-badge-live { background: rgba(0,214,143,.12); color: #00d68f; animation: fc-pulse 2s infinite; }
    .fc-badge-ended { background: rgba(255,71,87,.1); color: #ff4757; animation: none; }
    @keyframes fc-pulse { 0%,100%{ opacity:1; } 50%{ opacity:.5; } }

    /* ── Status bar ── */
    .fc-status {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      border-bottom: 1px solid #1a1b28;
      flex-shrink: 0;
      background: #0c0d14;
    }
    .fc-status-item { display: flex; align-items: center; gap: 5px; }
    .fc-status-icon { font-size: 12px; }
    .fc-status-label { font-family: Consolas, monospace; font-size: 9px; color: #5e5b72; letter-spacing: .04em; }
    .fc-status-val { font-family: Consolas, monospace; font-size: 12px; color: #eae7ff; font-weight: 600; }
    .fc-stat-val { font-family: Consolas, monospace; font-size: 12px; color: #eae7ff; font-weight: 600; }
    .fc-stat-val.fc-warn { color: #ff4757; }

    .fc-reg-track { width: 40px; height: 5px; background: #1a1b28; border-radius: 3px; overflow: hidden; }
    .fc-reg-fill { height: 100%; border-radius: 3px; transition: width .5s cubic-bezier(.16,1,.3,1); }
    .fc-reg-0 { width: 0%; background: #5e5b72; }
    .fc-reg-1 { background: #6c5ce7; }
    .fc-reg-2 { background: #6c5ce7; }
    .fc-reg-3 { background: #f0c040; }
    .fc-reg-4 { background: #00d68f; }

    /* ── Sections ── */
    .fc-section {
      padding: 12px 16px;
      border-bottom: 1px solid #1a1b28;
    }
    .fc-section-head {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .fc-section-icon { font-size: 12px; }
    .fc-section-title {
      font-family: Consolas, monospace;
      font-size: 10px;
      color: #6c5ce7;
      letter-spacing: .08em;
      font-weight: 600;
    }
    .fc-section-count {
      font-family: Consolas, monospace;
      font-size: 10px;
      color: #5e5b72;
      margin-left: auto;
    }

    /* ── Coaching tips ── */
    .fc-coaching { display: flex; flex-direction: column; gap: 8px; }
    .fc-tip {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid #1a1b28;
      background: #0c0d14;
      animation: fc-fadeIn .3s ease;
    }
    @keyframes fc-fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    .fc-tip-critical { border-color: rgba(255,71,87,.3); background: rgba(255,71,87,.06); }
    .fc-tip-warning { border-color: rgba(240,192,64,.3); background: rgba(240,192,64,.06); }
    .fc-tip-coaching { border-color: rgba(108,92,231,.3); background: rgba(108,92,231,.06); }
    .fc-tip-signal { border-color: rgba(0,214,143,.3); background: rgba(0,214,143,.06); }
    .fc-tip-objection { border-color: rgba(255,71,87,.2); background: rgba(255,71,87,.04); }
    .fc-tip-info { border-color: #1a1b28; }

    .fc-tip-icon { font-size: 13px; flex-shrink: 0; }
    .fc-tip-text { font-size: 12px; line-height: 1.6; color: #eae7ff; }

    /* ── Detection lists ── */
    .fc-det-list { display: flex; flex-direction: column; gap: 6px; }
    .fc-det-item {
      display: grid;
      grid-template-columns: 8px auto auto 1fr;
      gap: 6px;
      align-items: start;
      font-size: 11px;
    }
    .fc-det-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 5px; }
    .fc-dot-green { background: #00d68f; }
    .fc-dot-red { background: #ff4757; }
    .fc-det-code { font-family: Consolas, monospace; font-size: 10px; color: #eae7ff; font-weight: 600; white-space: nowrap; }
    .fc-det-time { font-family: Consolas, monospace; font-size: 10px; color: #5e5b72; }
    .fc-det-text { font-size: 11px; color: #5e5b72; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fc-det-empty { font-size: 11px; color: #5e5b72; font-style: italic; }

    /* ── Sparkline ── */
    .fc-sparkline { width: 100%; height: 28px; display: block; }
    .fc-spark-labels {
      display: flex;
      justify-content: space-between;
      font-family: Consolas, monospace;
      font-size: 8px;
      color: #5e5b72;
      margin-top: 2px;
    }

    /* ── Alerts ── */
    .fc-alerts .fc-section { padding: 0; border: none; }
    .fc-alert-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 0;
    }
    .fc-alert-label { font-size: 11px; color: #5e5b72; }
    .fc-alert-val {
      font-family: Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 3px;
      letter-spacing: .04em;
    }
    .fc-alert-low { color: #00d68f; background: rgba(0,214,143,.1); }
    .fc-alert-med { color: #f0c040; background: rgba(240,192,64,.1); }
    .fc-alert-high { color: #ff4757; background: rgba(255,71,87,.1); animation: fc-flash .5s ease; }
    @keyframes fc-flash { 0%,100%{ opacity:1; } 50%{ opacity:.3; } }
  `;

})();
