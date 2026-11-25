/* 허브 홈 화면 — 로그인 직후 첫 화면: 인사 + 바로가기 + 숙제·최근 테스트 요약.
 *   HubHome.mount(rootEl, { session, name, go(tabId) })   go 는 허브가 탭을 바꿔 주는 함수 (id: grades | quiz | curriculum | qna)
 * 숫자·점수는 서버(login 응답)에서 받은 그대로 보여 줌 — 계산하지 않음. CSS 는 home.css (전부 .home 아래). */
(function () {
  'use strict';
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mas(id, size, cls) { return window.HubMascots ? HubMascots.svg(id, size, cls === undefined ? 'hm-float' : cls) : ''; }
  function dow(d) { return '일월화수목금토'.charAt(d.getDay()); }
  function today() { var d = new Date(); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + dow(d) + ')'; }
  function due(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/.exec(String(s || '')); if (!m) return '';
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return (+m[2]) + '/' + (+m[3]) + '(' + dow(d) + ')' + (m[4] && m[4] !== '00:00' ? ' ' + m[4] : '');
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

  var root = null, gen = 0;
  function card(go, icon, title, sub, cls) {
    return '<button class="hm-card ' + (cls || '') + '" data-go="' + go + '" type="button"><span class="hm-ico">' + mas(icon, 64) + '</span><b>' + title + '</b><span>' + sub + '</span></button>';
  }
  function render(view, name) {
    var cls = (view && view.classes || []).filter(function (c) { return c.current; });
    var hw = [], tests = [];
    cls.forEach(function (c) {
      (c.hw || []).forEach(function (h) { if (!h.practice && !h.done) hw.push({ h: h, c: c }); });
      (c.tests || []).forEach(function (t) { tests.push({ t: t, c: c }); });
    });
    hw.sort(function (a, b) { return String(a.h.due || '9').localeCompare(String(b.h.due || '9')); });
    tests.sort(function (a, b) { return String(b.t.date || '').localeCompare(String(a.t.date || '')); });
    var overdue = hw.filter(function (x) { return x.h.overdue; }).length;
    var chips = cls.map(function (c) { return '<span class="hm-chip">' + esc(c.kind) + ' · ' + esc(c.time) + '</span>'; }).join('');

    var hwHtml;
    if (!hw.length) hwHtml = '<div class="hm-empty">' + mas('m-check-happy', 52) + '<span>제출할 숙제가 없어요</span></div>';
    else hwHtml = hw.slice(0, 3).map(function (x) {
      return '<div class="hm-row' + (x.h.overdue ? ' late' : '') + '"><span class="hm-t">' + esc(x.h.label) + '</span><span class="hm-d">' + (x.h.overdue ? '마감 지남' : (x.h.due ? esc(due(x.h.due)) + '까지' : '')) + '</span></div>';
    }).join('') + (hw.length > 3 ? '<div class="hm-more">외 ' + (hw.length - 3) + '개</div>' : '');

    var tHtml;
    if (!tests.length) tHtml = '<div class="hm-empty">' + mas('m-cactus', 52) + '<span>아직 본 테스트가 없어요</span></div>';
    else tHtml = tests.slice(0, 2).map(function (x) {
      var t = x.t, sc = t.score === null || t.score === undefined || t.score === '' ? '—' : t.score + ' / ' + t.total;
      return '<div class="hm-row"><span class="hm-t">' + esc(t.label) + '<small>' + esc(t.date ? due(t.date) : '') + '</small></span><span class="hm-s">' + esc(sc) + (t.total && t.score !== '' && t.score !== null ? '<small>' + pct(+t.score, +t.total) + '%</small>' : '') + '</span></div>';
    }).join('');

    root.innerHTML =
      '<div class="hm-hero"><div class="hm-hi"><small>' + today() + '</small><h1>안녕하세요,<br>' + esc(name || '') + (name ? '님' : '') + '</h1><div class="hm-chips">' + chips + '</div></div>' + mas('m-note-happy', 112) + '</div>' +
      '<div class="hm-grid">' +
        card('quiz', 'm-quiz-happy', '퇴근 미션', '오늘 문제 풀기') +
        card('grades', 'm-note', '내 성적', '점수와 그래프') +
        card('curriculum', 'm-book', '커리큘럼', '수업 계획 보기') +
        card('qna', 'm-pencil', 'QnA', '선생님께 질문') +
      '</div>' +
      '<section class="hm-sec"><div class="hm-h"><h2>숙제</h2>' + (overdue ? '<span class="hm-badge">마감 지남 ' + overdue + '</span>' : '') + '<button class="hm-link" data-go="grades" type="button">더 보기</button></div>' + hwHtml + '</section>' +
      '<section class="hm-sec"><div class="hm-h"><h2>최근 테스트</h2><button class="hm-link" data-go="grades" type="button">더 보기</button></div>' + tHtml + '</section>';
  }
  function mount(rootEl, o) {
    unmount(); root = rootEl; gen++; var g = gen; o = o || {};
    root.classList.add('home');
    root.innerHTML = '<div class="hm-load">' + mas('m-hourglass', 64) + '</div>';
    root.onclick = function (e) { var b = e.target.closest && e.target.closest('[data-go]'); if (b && o.go) o.go(b.getAttribute('data-go')); };
    o.session.view().then(function (r) {
      if (g !== gen) return;
      if (!r.ok) { root.innerHTML = '<div class="hm-err">' + mas('m-cloud', 72) + '<p>' + esc(r.error || '불러오지 못했어요.') + '</p></div>'; return; }
      render(r.data, o.name || r.data.name);
    });
  }
  function unmount() { gen++; if (root) { root.onclick = null; root.innerHTML = ''; root.classList.remove('home'); } root = null; }
  window.HubHome = { mount: mount, unmount: unmount };
})();
