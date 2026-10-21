/* 서버 호출. 미리보기 모드에서는 SeisekiMock(메모리)으로 같은 요청을 처리합니다. */
var Api = (function () {
  var cfg = window.SEISEKI_CONFIG || {};
  // 주소에 /dev/ 가 있으면 개발판: 개발판 웹앱 주소·개발판 저장 공간을 씀
  var env = /\/dev\//.test(location.pathname) ? 'dev' : 'prod';
  var url = typeof cfg.API_URL === 'string' ? cfg.API_URL : ((cfg.API_URL || {})[env] || '');
  var demo = !url || /[?&]demo\b/.test(location.search);

  function dev() {
    try {
      var k = env === 'dev' ? 'seiseki-dev.device' : 'seiseki.device';
      var d = localStorage.getItem(k);
      if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(k, d); }
      return d;
    } catch (e) { return 'nostore'; }
  }

  function call(action, payload) {
    payload = Object.assign({ dev: dev() }, payload || {});
    if (demo) return SeisekiMock.api(action, payload);
    // text/plain 으로 보내야 브라우저가 사전 확인(CORS preflight) 없이 Apps Script 로 보냅니다.
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, payload: payload }) })
      .then(function (r) { return r.ok ? r.json() : { ok: false, error: '서버 응답 오류 (' + r.status + ')' }; })
      .then(function (r) { checkVer(r); return r; })
      .catch(function () { return { ok: false, error: '인터넷 연결을 확인하고 다시 시도해 주세요.' }; });
  }
  /** 화면을 열자마자 서버를 미리 깨움 (번호·비밀번호를 치는 동안). 결과는 버림 */
  function warm() { if (!demo) call('ping', {}); }

  /** 서버(Apps Script)에 붙여넣은 코드가 이 화면과 다르면 경고 — 강사 화면은 빨간 띠, 학생 화면은 콘솔에만 */
  var verWarned = false, verListeners = [];
  function checkVer(r) {
    if (!r || !r.ver || typeof Logic === 'undefined' || !Logic.VERSION || r.ver === Logic.VERSION || verWarned) return;
    verWarned = true;
    var msg = '서버 코드(' + r.ver + ')가 화면 코드(' + Logic.VERSION + ')와 달라요. Apps Script 에 새 코드를 붙여넣고 새 버전으로 배포해야 해요.';
    if (window.console) console.warn('[성적노트] ' + msg);
    verListeners.forEach(function (f) { f(msg); });
  }
  function onVerMismatch(f) { verListeners.push(f); }

  function photoUrl(id, w) {
    if (String(id).indexOf('mock-') === 0) return SeisekiMock.imageUrl(id);
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + (w || 600);
  }
  function photoLink(id) {
    if (String(id).indexOf('mock-') === 0) return SeisekiMock.imageUrl(id);
    return 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view';
  }

  if (env === 'dev') {
    document.title = '[개발판] ' + document.title;
    var ic = document.querySelector('link[rel=icon]'); if (ic) ic.href = ic.getAttribute('href').replace('favicon.svg', 'favicon-dev.svg');
    var bar = document.createElement('div');
    bar.className = 'devbar';
    bar.textContent = '개발판 — 새 기능 확인용입니다. 학생에게는 본판 주소를 알려 주세요.' + (demo ? (url ? ' (?demo — 미리보기 데이터로 열림)' : ' (개발판 웹앱 주소가 없어 미리보기 데이터로 열림)') : '');
    document.body.insertBefore(bar, document.body.firstChild);
  }

  return { call: call, warm: warm, onVerMismatch: onVerMismatch, demo: demo, env: env, photoUrl: photoUrl, photoLink: photoLink };
})();

/* 화면 공통 도우미 */
var UI = {
  $: function (s, r) { return (r || document).querySelector(s); },
  all: function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); },
  esc: function (s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
  // 개발판은 'seiseki-dev.' 로 따로 저장 (본판 로그인·번호 기억과 섞이지 않게)
  store: {
    key: function (k) { return Api.env === 'dev' ? k.replace(/^seiseki\./, 'seiseki-dev.') : k; },
    get: function (k, area) { try { return (area || localStorage).getItem(UI.store.key(k)); } catch (e) { return null; } },
    set: function (k, v, area) { try { (area || localStorage).setItem(UI.store.key(k), v); } catch (e) { /* 저장 안 돼도 동작 */ } },
    del: function (k, area) { try { (area || localStorage).removeItem(UI.store.key(k)); } catch (e) { /* 무시 */ } }
  },
  monthLabel: function (m) { var p = String(m).split('-'); return p.length === 2 ? p[0] + '년 ' + (+p[1]) + '월' : m; },
  dateLabel: function (d) { var p = String(d).split('-'); return p.length >= 3 ? (+p[1]) + '/' + (+p[2]) : d; },
  copy: function (text, out, okText) {
    function fb() {
      out.innerHTML = '<p class="meta">자동 복사가 막혀 있어요. 아래 내용을 선택해 복사해 주세요.</p><textarea readonly class="tsv">' + UI.esc(text) + '</textarea>';
      var t = out.querySelector('textarea'); t.focus(); t.select();
    }
    try { navigator.clipboard.writeText(text).then(function () { out.innerHTML = '<p class="msg ok">' + (okText || '복사했어요. 엑셀에 붙여넣으세요.') + '</p>'; }, fb); } catch (e) { fb(); }
  }
};
