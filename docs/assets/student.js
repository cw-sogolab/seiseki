/* 학생 화면: 번호로 들어와 성적 조회 + 숙제 사진 제출 */
(function () {
  var $ = UI.$, esc = UI.esc;
  var view = null, code = '', tok = '', kindSel = '', subjSel = '', wkSel = '', tmSel = '', tmKey = '', busy = false;

  if (Api.demo) $('#demo').hidden = false;

  function setBusy(btn, on, label) { busy = on; btn.disabled = on; if (label) btn.textContent = label; }

  /** quiet: 저장해 둔 화면을 먼저 보여 준 뒤 뒤에서 새로 불러올 때 (버튼·오류를 로그인 화면에 띄우지 않음) */
  function login(c, quiet) {
    var btn = $('#go');
    if (busy && !quiet) return;
    if (!quiet) setBusy(btn, true, '확인하는 중…');
    else $('#refresh').textContent = '새로 불러오는 중…';
    return Api.call('login', { code: c }).then(function (r) {
      if (!quiet) setBusy(btn, false, '조회하기');
      $('#refresh').textContent = '새로고침';
      if (!r.ok) {
        if (quiet && !/번호|없는/.test(r.error)) return r;   // 인터넷이 잠깐 끊긴 것: 저장해 둔 화면을 그대로 둠
        $('#loginMsg').textContent = r.error; UI.store.del('seiseki.code'); UI.store.del('seiseki.view');
        if (quiet) { view = null; $('#app').hidden = true; $('#acts').hidden = true; $('#login').hidden = false; }
        return r;
      }
      $('#loginMsg').textContent = '';
      code = r.data.code; tok = r.data.tok || '';
      if ($('#remember').checked) {
        UI.store.set('seiseki.code', code);
        var keep = Object.assign({}, r.data); delete keep.tok;
        UI.store.set('seiseki.view', JSON.stringify({ at: Date.now(), v: keep }));   // 다음에 열 때 바로 보이게 (내 폰에서 「기억하기」 켰을 때만)
      }
      if (!(quiet && $('#panel .up'))) show(r.data);   // 사진 올리는 중이면 화면을 다시 그리지 않음 (제출하면 새로 그려짐)
      return r;
    });
  }
  /** 숙제 제출 요청: 로그인 열쇠가 없거나 지났으면 다시 로그인하고 한 번 더 보냄 */
  function stuCall(action, payload) {
    function go() { return Api.call(action, Object.assign({ tok: tok }, payload)); }
    return (tok ? go() : Promise.resolve({ ok: false, needLogin: true })).then(function (r) {
      if (!r.needLogin) return r;
      return Api.call('login', { code: code }).then(function (l) {
        if (!l.ok) return l;
        tok = l.data.tok || ''; return go();
      });
    });
  }

  /** 이번 달 (한국 시간). 선생님이 다음 달 시험·숙제를 미리 등록해 둬도 학생에게는 그 달이 시작되기 전까지 안 보이게 */
  function thisMonth() { var d = new Date(Date.now() + 9 * 3600 * 1000); return d.toISOString().slice(0, 7); }
  function show(data) {
    var tm = thisMonth();
    (data.classes || []).forEach(function (c) {
      c.tests = (c.tests || []).filter(function (t) { return !t.month || t.month <= tm; });
      c.hw = (c.hw || []).filter(function (h) { return !h.month || h.month <= tm; });
    });
    view = data;
    $('#nm').textContent = view.name;
    $('#idshow').textContent = Core.fmtCode(view.code);
    $('#login').hidden = true; $('#app').hidden = false; $('#acts').hidden = false;
    renderTabs();
  }

  var SUBJS = { '경제': '경제', '정치': '정치', '지리': '지리', '현사': '현대사회', '현대사회': '현대사회', '세계사': '세계사', '역사': '세계사', '일본사': '일본사' };
  var KIND_COLOR = { '개념': 'var(--me)', '단풀': 'var(--orange)', '실전': 'var(--green)' };
  /** 과목마다 그래프 색 — 수업 자료(개념·단풀 PPT·워드)의 과목색과 같게 (2026-10-21) */
  var SUBJ_COLOR = { '경제': '#5A6FD6', '정치': '#FC5230', '지리': '#5F9467', '현대사회': '#2E9ED8', '세계사': '#D99A00', '일본사': '#64748B', '실전 (EJU)': '#10B981', '기타': '#94A3B8' };
  function subjColor(sj) { return SUBJ_COLOR[sj] || '#94A3B8'; }
  /** 과목 색: 개념반은 진하게·단풀반은 연하게 (과목이 없으면 반 색) */
  function toneOf(k, sj) {
    if (!sj) return KIND_COLOR[k] || 'var(--me)';
    var base = subjColor(sj);
    return k === '단풀' ? 'color-mix(in srgb, ' + base + ' 50%, #fff)' : base;   // 단풀반은 같은 과목색을 연하게 (다크 모드에서도 밝게)
  }
  function kindOf(c) { return c.kind || ({ GN: '개념', DP: '단풀', SJ: '실전' })[String(c.code).split('-')[0]] || ''; }
  function subjOfT(c, t) { return kindOf(c) === '실전' ? '실전 (EJU)' : (SUBJS[String(t.label).split(' ')[0]] || '기타'); }
  /** 반 평균 정답률 — 누적 평균처럼 소수 첫째 자리까지 (%) */
  function pct1(a, t) { return t ? Math.round(a / t * 1000) / 10 : 0; }
  function pct(a, t) { return t ? Math.round(a / t * 100) : 0; }
  /** 같은 달 안에서 1주차 → 2주차 → … → 월말 순서 */
  function rank(t) { var m = /(\d+)\s*주차/.exec(t.label); return m ? +m[1] : (/월말/.test(t.label) ? 90 : 50); }
  function order(a, b) { return (a.t.month || '').localeCompare(b.t.month || '') || (a.t.date || '').localeCompare(b.t.date || '') || rank(a.t) - rank(b.t) || String(a.t.label).localeCompare(String(b.t.label)); }
  /** 그래프 아래에 쓸 짧은 이름: 과목명은 빼고 (「세계사 1주차」 → 「1주차」, 「EJU 2024(2)」 → 「2024(2)」) */
  function shortLabel(t) {
    var s = String(t.label).replace(/^(경제|정치|지리|현사|현대사회|세계사|역사|일본사)\s*/, '');
    var m = /^EJU\s*(\d{4})\s*(?:\((\d)\)|-(\d))?$/.exec(s);
    if (m) return m[1] + (m[2] || m[3] ? '-' + (m[2] || m[3]) : '');           // EJU 2011(2) → 2011-2
    m = /Final\s*\(?\s*(\d+\s*-\s*\d+)/i.exec(s); if (m) return 'Final ' + m[1].replace(/\s/g, '');   // 啓程 Final(7-10회) → Final 7-10
    return s.replace(/^啓程\s*/, '啓程 ');
  }
  /** 점수가 들어간 시험 전부 (반 정보 붙여서) */
  function allTaken() {
    var out = [];
    view.classes.forEach(function (c) { c.tests.forEach(function (t) { if (t.score !== null) out.push({ c: c, t: t, kind: kindOf(c), subj: subjOfT(c, t) }); }); });
    return out.sort(order);
  }
  function avgPct(list) { return list.length ? Math.round(list.reduce(function (s, x) { return s + x.t.score / x.t.total; }, 0) / list.length * 100) : null; }
  /** 같은 시험 누적 평균(지금까지 본 모든 학생·모든 달)보다 몇 %p 위/아래인지. 그달 반 평균은 그달 학생 수준에 흔들려서 안 씀 */
  function gapPct(list) {
    var xs = list.filter(function (x) { return x.t.cum && x.t.total; });
    if (!xs.length) return null;
    return Math.round(xs.reduce(function (s, x) { return s + (x.t.score / x.t.total * 100 - x.t.cum.pct); }, 0) / xs.length);
  }
  function cumAvg(list) { var xs = list.filter(function (x) { return x.t.cum; }); return xs.length ? Math.round(xs.reduce(function (s, x) { return s + x.t.cum.pct; }, 0) / xs.length) : null; }
  function tile(label, val, unit, cls, note, color) {
    return '<div class="tile' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b' + (color ? ' style="color:' + color + '"' : '') + '>' + (val === null || val === undefined ? '-' : val + (unit ? '<small>' + unit + '</small>' : '')) + '</b>' + (note ? '<em>' + note + '</em>' : '') + '</div>';
  }
  function gapText(g) { return g === null ? '' : (g > 0 ? '누적 평균보다 ' + g + '%p 높아요' : g < 0 ? '누적 평균보다 ' + (-g) + '%p 낮아요' : '누적 평균과 같아요'); }

  /* ---------- 그래프 + 마우스를 올리면(휴대폰은 누르면) 점수 말풍선 ---------- */
  var TIPS = [];
  function tipHtml(it) {
    return '<b>' + esc(it.title) + '</b>' + (it.m ? '<span class="tm">' + (+it.m.slice(5)) + '월</span>' : '') +
      '<div><i style="background:' + it.col + '"></i>내 점수 <b>' + (it.sc !== undefined ? it.sc + '/' + it.tot + ' · ' : '') + it.p + '%</b></div>' +
      (it.av !== null && it.av !== undefined && it.tot ? '<div><i class="av"></i>그때 반 평균 ' + pct1(it.av, it.tot) + '%</div>' : '') +
      (it.cum ? '<div><i class="cu"></i>누적 평균 ' + it.cum.pct + '%' + (it.cum.n ? ' <small>(' + it.cum.n + '명)</small>' : '') + '</div>' : '');
  }
  function hit(x, w, H, it) { TIPS.push(it); return '<rect class="hit" x="' + x + '" y="0" width="' + w + '" height="' + H + '" fill="transparent" data-tip="' + (TIPS.length - 1) + '"/>'; }
  function bindTips(root) {
    UI.all('.chartwrap', root).forEach(function (w) {
      var tip = document.createElement('div'); tip.className = 'ctip'; tip.hidden = true; w.appendChild(tip);
      var guide = w.querySelector('.guide');
      function show(r) {
        var it = TIPS[+r.getAttribute('data-tip')]; if (!it) return;
        tip.innerHTML = tipHtml(it); tip.hidden = false;
        var wb = w.getBoundingClientRect(), rb = r.getBoundingClientRect(), cx = rb.left + rb.width / 2 - wb.left + w.scrollLeft;
        var left = Math.max(4 + w.scrollLeft, Math.min(cx - tip.offsetWidth / 2, w.scrollLeft + w.clientWidth - tip.offsetWidth - 4));
        tip.style.left = left + 'px'; tip.style.top = '4px';
        if (guide) { var svg = w.querySelector('svg'), sc = svg.viewBox.baseVal.width / svg.getBoundingClientRect().width; guide.setAttribute('x1', (cx - (svg.getBoundingClientRect().left - wb.left + w.scrollLeft)) * sc); guide.setAttribute('x2', guide.getAttribute('x1')); guide.style.display = ''; }
      }
      UI.all('.hit', w).forEach(function (r) {
        r.addEventListener('mouseenter', function () { show(r); });
        r.addEventListener('click', function () { show(r); });
      });
      w.addEventListener('mouseleave', function () { tip.hidden = true; if (guide) guide.style.display = 'none'; });
    });
  }
  function svgBox(half) {
    var pw = ($('#panel') && $('#panel').clientWidth) || window.innerWidth - 32, pad = window.innerWidth <= 480 ? 36 : 44;
    return Math.max(260, Math.round((half && window.innerWidth > 860 ? (pw - 14) * 1.35 / 2.35 : pw) - pad));
  }

  /** 꺾은선 그래프. items: [{p 내 정답률, cum 누적 평균, s 계열(과목), col 색, lab, m 달, title, sc, tot, av}]
   *  점은 과목 색, 점선은 같은 시험 누적 평균 */
  function chartX(items, half) {
    if (!items.length) return '<p class="empty">아직 입력된 점수가 없어요.</p>';
    var series = []; items.forEach(function (it) { if (series.indexOf(it.s) < 0) series.push(it.s); });
    var n = items.length, fs = window.innerWidth > 860 ? 12 : 10;
    var W = Math.max(svgBox(half), n * 46), H = fs === 12 ? 230 : 190, L = 34, R = 16, T = 14, B = fs * 4;
    function x(i) { return n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1); }
    function y(p) { return T + (100 - Math.min(100, p)) * (H - T - B) / 100; }
    var s = '<div class="chartwrap"><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" style="min-width:' + Math.min(W, n * 40) + 'px" role="img" aria-label="시험별 정답률">';
    [0, 50, 100].forEach(function (g) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="var(--line)"/>';
      s += '<text x="' + (L - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end" font-size="' + fs + '" fill="var(--muted)">' + g + '</text>';
    });
    s += '<line class="guide" x1="0" x2="0" y1="' + T + '" y2="' + y(0) + '" stroke="var(--line)" stroke-width="1.5" style="display:none"/>';
    items.forEach(function (it, i) {
      s += '<text x="' + x(i) + '" y="' + (H - fs * 2.2) + '" text-anchor="middle" font-size="' + fs + '" fill="var(--muted)">' + esc(it.lab) + '</text>';
      if (it.m && (i === 0 || items[i - 1].m !== it.m)) s += '<text x="' + x(i) + '" y="' + (H - fs * 0.6) + '" text-anchor="middle" font-size="' + fs + '" font-weight="700" fill="var(--ink2)">' + (+it.m.slice(5)) + '월</text>';
    });
    var cu = items.map(function (it, i) { return it.cum ? x(i) + ',' + y(it.cum.pct) : null; });
    if (n > 1 && cu.filter(Boolean).length > 1) s += '<polyline points="' + cu.filter(Boolean).join(' ') + '" fill="none" stroke="var(--avg)" stroke-width="2" stroke-dasharray="5 4"/>';
    items.forEach(function (it, i) { if (it.cum) s += '<circle cx="' + x(i) + '" cy="' + y(it.cum.pct) + '" r="3" fill="var(--avg)"/>'; });
    series.forEach(function (key) {
      var pts = []; items.forEach(function (it, i) { if (it.s === key) pts.push([x(i), y(it.p), it, i]); });
      var col = pts[0][2].col;
      // 같은 과목끼리만 잇되, 사이에 다른 과목이 끼면 끊어서 그림
      var seg = [];
      pts.forEach(function (p, k) {
        if (k && p[3] !== pts[k - 1][3] + 1) { if (seg.length > 1) s += '<polyline points="' + seg.join(' ') + '" fill="none" stroke="' + col + '" stroke-width="2.5"/>'; seg = []; }
        seg.push(p[0] + ',' + p[1]);
      });
      if (seg.length > 1) s += '<polyline points="' + seg.join(' ') + '" fill="none" stroke="' + col + '" stroke-width="2.5"/>';
      pts.forEach(function (p) { s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4.5" fill="' + col + '"/>'; });
    });
    var slot = n === 1 ? W - L - R : (W - L - R) / (n - 1);
    items.forEach(function (it, i) { s += hit(Math.max(0, x(i) - slot / 2), slot, H, it); });
    s += '</svg></div><div class="legend">';
    series.forEach(function (key) { var c0 = items.filter(function (it) { return it.s === key; })[0].col; s += '<span><i style="border-top-color:' + c0 + '"></i>' + esc(series.length === 1 ? '내 정답률' : key) + '</span>'; });
    s += '<span><i class="a"></i>누적 평균</span><span class="hint">점에 마우스를 올리면(휴대폰은 누르면) 점수가 나와요</span>';
    return s + '</div>';
  }
  /** 막대그래프 (단풀반: 달마다 월말 하나). 막대는 과목 색, 가로 점선은 누적 평균 */
  function barsX(items, half) {
    if (!items.length) return '<p class="empty">아직 입력된 점수가 없어요.</p>';
    var n = items.length, fs = window.innerWidth > 860 ? 12 : 10;
    var W = Math.max(svgBox(half), n * 64), H = fs === 12 ? 230 : 190, L = 34, R = 10, T = 20, B = fs * 4;
    var slot = (W - L - R) / n, bw = Math.min(46, slot * 0.55);
    function y(p) { return T + (100 - Math.min(100, p)) * (H - T - B) / 100; }
    var s = '<div class="chartwrap"><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="월말 정답률">';
    [0, 50, 100].forEach(function (g) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="var(--line)"/>';
      s += '<text x="' + (L - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end" font-size="' + fs + '" fill="var(--muted)">' + g + '</text>';
    });
    var subs = [];
    items.forEach(function (it, i) {
      var cx = L + slot * i + slot / 2, top = y(it.p);
      if (subs.indexOf(it.s) < 0) subs.push(it.s);
      s += '<rect x="' + (cx - bw / 2) + '" y="' + top + '" width="' + bw + '" height="' + (y(0) - top) + '" rx="6" fill="' + it.col + '"/>';
      s += '<text x="' + cx + '" y="' + (top - 5) + '" text-anchor="middle" font-size="' + fs + '" font-weight="700" fill="var(--ink2)">' + it.p + '</text>';
      if (it.cum) s += '<line x1="' + (cx - bw / 2 - 6) + '" x2="' + (cx + bw / 2 + 6) + '" y1="' + y(it.cum.pct) + '" y2="' + y(it.cum.pct) + '" stroke="var(--ink2)" stroke-width="2" stroke-dasharray="4 3"/>';
      s += '<text x="' + cx + '" y="' + (H - fs * 2.2) + '" text-anchor="middle" font-size="' + fs + '" fill="var(--muted)">' + esc(it.lab) + '</text>';
      s += '<text x="' + cx + '" y="' + (H - fs * 0.6) + '" text-anchor="middle" font-size="' + fs + '" font-weight="700" fill="var(--ink2)">' + (+it.m.slice(5)) + '월</text>';
      s += hit(L + slot * i, slot, H, it);
    });
    s += '</svg></div><div class="legend">' + subs.map(function (sj) { var c0 = items.filter(function (it) { return it.s === sj; })[0].col; return '<span><i class="sq" style="background:' + c0 + '"></i>' + esc(sj) + '</span>'; }).join('') +
      '<span><i class="a" style="border-top-color:var(--ink2)"></i>누적 평균</span><span class="hint">막대에 마우스를 올리면(휴대폰은 누르면) 점수가 나와요</span></div>';
    return s;
  }
  function itemsOf(list, seriesFn, labFn) {
    return list.map(function (x) {
      var sj = x.subj || subjOfT(x.c, x.t), ser = seriesFn ? seriesFn(x) : sj;
      return { p: pct(x.t.score, x.t.total), s: ser, col: x.kind ? toneOf(x.kind, sj) : subjColor(sj),
        lab: labFn ? labFn(x) : shortLabel(x.t), m: x.t.month, title: (x.kind ? x.kind + '반 ' : '') + x.t.label, sc: x.t.score, tot: x.t.total, av: x.t.avg, cum: x.t.cum };
    });
  }

  /* ---------- 보기: 반 종류(개념·단풀·실전) → 과목. 달은 과목 화면 안에서 묶어 보여 줌 ---------- */
  var KINDS = ['개념', '단풀', '실전'];
  /** 묶는 기준: 개념·단풀은 과목(시험·숙제 이름 첫 낱말), 실전은 D·E */
  function grpOf(c, x) { return kindOf(c) === '실전' ? String(c.code).split('-').pop() : (SUBJS[String(x.label).split(' ')[0]] || '기타'); }
  /** 들은 달: 「2·6·8월」 (해가 다르면 「25년 11월 · 2월」, 많으면 「2~9월 · 5달」) */
  function monthsText(ms) {
    ms = ms.slice().sort(); if (!ms.length) return '';
    var y = ms[0].slice(0, 4), same = ms.every(function (m) { return m.slice(0, 4) === y; }) && y === thisMonth().slice(0, 4);
    if (!same) return ms.length > 2 ? monthShort(ms[0]) + '~' + monthShort(ms[ms.length - 1]) + ' · ' + ms.length + '달' : ms.map(monthShort).join(' · ');
    if (ms.length > 4) return (+ms[0].slice(5)) + '~' + (+ms[ms.length - 1].slice(5)) + '월 · ' + ms.length + '달';
    return ms.map(function (m) { return +m.slice(5); }).join('·') + '월';
  }
  function monthShort(m) { return m.slice(0, 4) === thisMonth().slice(0, 4) ? (+m.slice(5)) + '월' : m.slice(2, 4) + '년 ' + (+m.slice(5)) + '월'; }
  /** 반 종류 하나의 과목들: 지금 듣는 과목 먼저, 그다음 최근에 들은 순 */
  function subjList(k) {
    var m = {}, tm = thisMonth(), out = [];
    view.classes.forEach(function (c) {
      if (kindOf(c) !== k) return;
      var items = c.tests.concat(c.hw);
      if (k === '실전' && !items.length && c.current !== false) items = [{ label: '', month: tm }];   // 실전반은 첫 시험 전이어도 보이게
      items.forEach(function (x) {
        var s = grpOf(c, x), mo = x.month || '', e = m[s] || (m[s] = { s: s, last: '', now: false, time: '', ms: [] });
        if (mo && e.ms.indexOf(mo) < 0) e.ms.push(mo);
        if (mo >= e.last) { e.last = mo; e.time = c.time || ''; }
        if (c.current !== false && mo === tm) e.now = true;
      });
    });
    Object.keys(m).forEach(function (s) { out.push(m[s]); });
    return out.sort(function (a, b) { return (b.now - a.now) || b.last.localeCompare(a.last); });
  }
  /** 보기: 「과목」(개념반+단풀반을 과목으로 합침) / 「실전」 / 「요약」 */
  var MODES = [['과목', '과목별'], ['실전', '실전반']];
  function kindsOfMode(m) { return m === '과목' ? ['개념', '단풀'] : [m]; }
  /** 그 보기의 칩: 과목(개념·단풀 합침) 또는 실전 D·E */
  function chips(mode) {
    var m = {}, out = [];
    kindsOfMode(mode).forEach(function (k) {
      subjList(k).forEach(function (e) {
        var x = m[e.s] || (m[e.s] = { s: e.s, last: '', now: false, ms: [], parts: [] });
        if (e.last > x.last) x.last = e.last;
        if (e.now) x.now = true;
        e.ms.forEach(function (mo) { if (x.ms.indexOf(mo) < 0) x.ms.push(mo); });
        x.parts.push({ k: k, now: e.now, time: e.time });
      });
    });
    Object.keys(m).forEach(function (s) { out.push(m[s]); });
    return out.sort(function (a, b) { return (b.now - a.now) || b.last.localeCompare(a.last); });
  }
  function modesHave() { return MODES.map(function (x) { return x[0]; }).filter(function (md) { return chips(md).length; }); }
  /** 처음 열 때: 지금 듣는 과목 (여럿이면 가장 최근 것) */
  function pickDefault(ms) {
    var best = null;
    ms.forEach(function (md) { var e = chips(md)[0]; if (!best || (e.now && !best.e.now) || (e.now === best.e.now && e.last > best.e.last)) best = { k: md, e: e }; });
    return best;
  }

  function renderModes(ms) {
    var M = MODES.filter(function (x) { return ms.indexOf(x[0]) >= 0; }).concat([['요약', '요약']]);
    $('#modes').innerHTML = M.map(function (m) { return '<button type="button" role="tab" data-mode="' + m[0] + '" aria-selected="' + (m[0] === kindSel) + '">' + m[1] + '</button>'; }).join('');
    UI.all('#modes [data-mode]').forEach(function (b) { b.onclick = function () { kindSel = b.getAttribute('data-mode'); subjSel = ''; renderTabs(); }; });
  }

  function renderTabs() {
    var ms = modesHave();
    $('#months').innerHTML = '';
    if (!ms.length) { $('#modes').innerHTML = ''; $('#tabs').innerHTML = ''; $('#panel').innerHTML = '<div class="card blank"><img src="assets/logo-emblem.webp" alt="" width="237" height="200"><p class="empty">아직 등록된 반이 없어요. 선생님께 말씀해 주세요.</p></div>'; return; }
    if (kindSel !== '요약' && ms.indexOf(kindSel) < 0) { var d = pickDefault(ms); kindSel = d.k; subjSel = d.e.s; }
    renderModes(ms);
    if (kindSel === '요약') { $('#tabs').innerHTML = ''; return renderSum(); }
    var subs = chips(kindSel);
    if (!subs.some(function (e) { return e.s === subjSel; })) subjSel = subs[0].s;
    $('#tabs').innerHTML = subs.map(function (e) {
      var big = kindSel === '실전' ? '실전반 ' + e.s : e.s;
      var nowParts = e.parts.filter(function (p) { return p.now; });
      var small = nowParts.length ? nowParts.map(function (p) { return (kindSel === '실전' ? '' : p.k + ' ') + (p.time || ''); }).join(' · ') : monthsText(e.ms);
      return '<button class="tab" type="button" role="tab" data-s="' + esc(e.s) + '" aria-selected="' + (e.s === subjSel) + '">' + esc(big) + (small ? '<small>' + esc(small) + '</small>' : '') + '</button>';
    }).join('');
    UI.all('#tabs [data-s]').forEach(function (b) { b.onclick = function () { subjSel = b.getAttribute('data-s'); renderTabs(); }; });
    renderSubject(kindSel, subjSel);
  }

  function testItem(t, extra, noDate, noWrong) {   // noWrong: 개념·단풀 월말테스트는 틀린 문항을 안 보여 줌 (2026-10-22 사용자)
    var h = '<div class="item"><div class="row"><b>' + esc(t.label) + (extra ? ' <span class="meta">' + esc(extra) + '</span>' : '') + '</b>' +
      (t.score === null ? '<span class="pill wait">아직 입력 전</span>' : '<span class="score">' + t.score + '<small> / ' + t.total + '</small></span>') + '</div>';
    h += '<p class="meta">' + [noDate ? '' : UI.dateLabel(t.date), t.score !== null ? '정답률 ' + pct(t.score, t.total) + '%' : '', t.rank ? t.rank + '등 / ' + t.n + '명' : '', t.avg !== null && t.total ? '그때 반 평균 ' + pct1(t.avg, t.total) + '%' : '', t.cum ? '누적 평균 ' + t.cum.pct + '%' : '',
      t.conv !== null ? '환산점수 ' + t.conv + (t.convAvg !== null ? ' (반 평균 ' + Math.round(t.convAvg) + ')' : '') : ''].filter(Boolean).map(esc).join(' · ') + '</p>';
    if (t.score !== null && !noWrong) {
      if (t.wrongDetail) h += '<div class="chips"><span class="lbl">틀린 문항</span>' + t.wrongDetail.map(function (w) { return '<span class="chip">' + w.n + '번 정답 ' + w.key + ' · 내 답 ' + (w.ans === '0' ? '-' : w.ans) + '</span>'; }).join('') + '</div>';
      else if (t.wrong.length) h += '<div class="chips"><span class="lbl">틀린 문항</span>' + t.wrong.map(function (n) { return '<span class="chip">' + n + '번</span>'; }).join('') + '</div>';
      else if (t.score === t.total) h += '<div class="chips"><span class="pill ok">전부 맞았어요</span></div>';
      // 학원 파일에서 옮겨 온 지난 성적은 점수만 있고 틀린 번호 기록이 없음 → 아무것도 안 붙임
    }
    return h + '</div>';
  }

  /** 숙제 마감 안내: 「마감 10/24(토) 15:00 · 2일 남음」 / 「마감 지남」 */
  function dueLine(w) {
    if (!w.due) return '';
    var t = '마감 ' + Core.fmtDue(w.due);
    if (w.done) return t;
    if (w.overdue) return t + ' · <b>마감 지났어요</b>';
    var today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), d = Math.round((Date.parse(w.due.slice(0, 10)) - Date.parse(today)) / 86400000);
    return t + (d === 0 ? ' · <b>오늘 마감</b>' : d === 1 ? ' · 내일 마감' : d > 1 ? ' · ' + d + '일 남음' : '');
  }

  function hwItem(w) {
    var detail = [w.book ? esc(w.book) : '', w.p0 ? 'p.' + w.p0 + '~' + w.p1 : '', w.total ? w.total + '문' : ''].filter(Boolean).join(' · ');
    if (w.done) detail += (detail ? ' · ' : '') + (w.photos ? '사진 ' + w.photos + '장' : '선생님 입력') + (w.count !== null ? ' · 맞은 개수 ' + w.count : '');
    var due = dueLine(w);
    return '<div class="item"><div class="row"><div><b>' + esc(w.label) + '</b><p class="meta">' + detail + '</p>' + (due ? '<p class="meta due' + (w.overdue ? ' over' : '') + '">' + due + '</p>' : '') + '</div>' +
      (w.done ? '<span class="pills">' + (w.late ? '<span class="pill late">늦음</span>' : '') + '<span class="pill ' + (w.checked ? 'ok">선생님 확인' : 'ok">제출 완료') + '</span></span>'
        : (w.overdue ? '<span class="pills"><span class="pill no">미제출</span><button class="btn sm" type="button" data-hw="' + esc(w.id) + '">늦게 내기</button></span>' : '<button class="btn sm" type="button" data-hw="' + esc(w.id) + '">제출하기</button>')) + '</div>' +
      (w.done ? '<button class="linkbtn" type="button" data-hw="' + esc(w.id) + '">사진 더 올리기</button>' : '') +
      '<div class="upbox" data-box="' + esc(w.id) + '"></div></div>';
  }
  /** 달마다 묶기 (최근 달 먼저) */
  function byMonth(list, getM) {
    var ms = [], g = {};
    list.forEach(function (x) { var m = getM(x) || ''; if (!g[m]) { g[m] = []; ms.push(m); } g[m].push(x); });
    return ms.sort().reverse().map(function (m) { return { m: m, l: g[m] }; });
  }

  /** 달마다 막대 두 개(개념반 월말·단풀반 월말). rows: [{m, vals: {kind: pct|null}, by: {kind: [...]}}] */
  function barChart(rows, kinds, sj, half) {
    if (!rows.length) return '<p class="empty">아직 입력된 월말 점수가 없어요.</p>';
    kinds = kinds.filter(function (kd) { return rows.some(function (r) { return r.vals[kd] !== null && r.vals[kd] !== undefined; }); });   // 점수가 있는 반만 (막대 자리·범례)
    var pw = (($('#panel') && $('#panel').clientWidth) || window.innerWidth - 32) / (half && window.innerWidth > 860 ? 2 : 1), pad = window.innerWidth <= 480 ? 36 : 44;
    var fs = window.innerWidth > 860 ? 12 : 10, n = rows.length, k = kinds.length;
    var W = Math.max(260, pw - pad, n * (k * 26 + 30)), H = fs === 12 ? 230 : 190, L = 34, R = 10, T = 20, B = fs * 2.6;
    var slot = Math.min((W - L - R) / n, 160), bw = Math.min(34, (slot - 18) / k), x0s = L + ((W - L - R) - slot * n) / 2;   // 달이 적어도 막대가 넓게 퍼지지 않게 가운데로
    function y(p) { return T + (100 - Math.min(100, p)) * (H - T - B) / 100; }
    var s = '<div class="chartwrap"><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="달마다 개념반·단풀반 월말 정답률">';
    [0, 50, 100].forEach(function (g) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="var(--line)"/>';
      s += '<text x="' + (L - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end" font-size="' + fs + '" fill="var(--muted)">' + g + '</text>';
    });
    rows.forEach(function (r, i) {
      var cx = x0s + slot * i + slot / 2, x0 = cx - bw * k / 2 - (k - 1) * 2;
      kinds.forEach(function (kd, j) {
        var v = r.vals[kd]; if (v === null || v === undefined) return;
        var x = x0 + j * (bw + 4), top = y(v), lst = r.by[kd], ca = cumAvg(lst);
        s += '<rect x="' + x + '" y="' + top + '" width="' + bw + '" height="' + (y(0) - top) + '" rx="5" fill="' + toneOf(kd, sj) + '"/>';
        if (ca !== null) s += '<line x1="' + (x - 3) + '" x2="' + (x + bw + 3) + '" y1="' + y(ca) + '" y2="' + y(ca) + '" stroke="var(--ink2)" stroke-width="2" stroke-dasharray="4 3"/>';
        s += hit(x - 2, bw + 4, H, { title: kd + '반 ' + lst[0].t.label, m: r.m, p: v, col: toneOf(kd, sj), sc: lst.length === 1 ? lst[0].t.score : undefined, tot: lst.length === 1 ? lst[0].t.total : undefined,
          av: lst.length === 1 ? lst[0].t.avg : null, cum: ca === null ? null : { pct: ca } });
        s += '<text x="' + (x + bw / 2) + '" y="' + (top - 4) + '" text-anchor="middle" font-size="' + (fs - 1) + '" font-weight="700" fill="var(--ink2)">' + v + '</text>';
      });
      s += '<text x="' + cx + '" y="' + (H - fs * 0.8) + '" text-anchor="middle" font-size="' + fs + '" font-weight="700" fill="var(--ink2)">' + (+r.m.slice(5)) + '월</text>';
    });
    s += '</svg></div><div class="legend">' + kinds.map(function (kd) { return '<span><i class="sq" style="background:' + toneOf(kd, sj) + '"></i>' + kd + '반 월말</span>'; }).join('') +
      '<span><i class="a" style="border-top-color:var(--ink2)"></i>누적 평균</span><span class="hint">막대에 마우스를 올리면(휴대폰은 누르면) 점수가 나와요</span></div>';
    return s;
  }

  /* 과목 하나: 모든 달의 테스트·숙제. 「과목」 보기는 개념반·단풀반을 한 화면에 (위에 합친 그래프, 아래에 반마다) */
  function renderSubject(mode, s) {
    TIPS = [];
    var kinds = kindsOfMode(mode), tests = [], hws = [];
    view.classes.forEach(function (c) {
      var k = kindOf(c); if (kinds.indexOf(k) < 0) return;
      c.tests.forEach(function (t) { if (grpOf(c, t) === s) tests.push({ c: c, t: t, kind: k, subj: subjOfT(c, t) }); });
      c.hw.forEach(function (w) { if (grpOf(c, w) === s) hws.push(w); });
    });
    tests.sort(order);
    var real = mode === '실전', taken = tests.filter(function (x) { return x.t.score !== null; }), gap = gapPct(taken), last = taken[taken.length - 1];
    var by = {}; kinds.forEach(function (k) { by[k] = taken.filter(function (x) { return x.kind === k; }); });
    var both = !real && by['개념'].length && by['단풀'].length;
    var done = hws.filter(function (w) { return w.done; }).length, nm = byMonth(taken, function (x) { return x.t.month; }).length;
    var col = subjColor(real ? '실전 (EJU)' : s);
    var conv = taken.filter(function (x) { return x.t.conv !== null && x.t.conv !== undefined; });
    var h = '<div class="tiles four">';
    if (both) h += tile('<i class="kdot" style="background:' + toneOf('개념', s) + '"></i>개념반 평균', avgPct(by['개념']), '%', 'hi', '테스트 ' + by['개념'].length + '개', col) +
      tile('<i class="kdot" style="background:' + toneOf('단풀', s) + '"></i>단풀반 평균', avgPct(by['단풀']), '%', 'hi', '월말 ' + by['단풀'].length + '번', col);
    else h += tile('평균 정답률', avgPct(taken), '%', 'hi', taken.length ? (nm > 1 ? nm + '달 · ' : '') + '테스트 ' + taken.length + '개' : '', col);
    h += tile('누적 평균과 비교', gap === null ? null : (gap > 0 ? '+' : '') + gap, '%p', gap === null ? '' : gap >= 0 ? 'gpos' : 'gneg', gap === null ? '' : gapText(gap));
    if (!both) h += conv.length ? tile('환산점수 평균', Math.round(conv.reduce(function (a, x) { return a + +x.t.conv; }, 0) / conv.length), '', '', '모의고사 ' + conv.length + '개')
      : tile('최근 테스트', last ? pct(last.t.score, last.t.total) : null, '%', '', last ? esc(monthShort(last.t.month) + ' ' + shortLabel(last.t)) : '');
    if (!real) h += tile('숙제 제출', hws.length ? done + ' / ' + hws.length : null, '', '', hws.length ? '개념반 일문일답' : '');
    else {   // 실전반 네 번째 칸: 최근 시험 환산점수 + 등수 (2026-10-22 사용자)
      var lc = last && last.t.conv !== null && last.t.conv !== undefined;
      h += tile('최근 시험', last ? (lc ? last.t.conv : pct(last.t.score, last.t.total)) : null, last ? (lc ? '' : '%') + (last.t.rank ? ' · ' + last.t.rank + '등' : '') : '', '',
        last ? esc(shortLabel(last.t)) + (lc ? ' 환산점수' : ' 정답률') + (last.t.rank ? ' · ' + last.t.n + '명 중' : '') : '');
    }
    h += '</div>';
    // 그래프 두 개: ① 개념반 소테스트·월말 꺾은선  ② 월말 비교 — 개념반 월말과 단풀반 월말을 달마다 나란히 (단풀반을 들었을 때)
    if (real) {
      h += '<div class="card"><h2>점수 추이 <span class="meta">실전반 ' + esc(s) + ' · 모든 달 · 정답률 %</span></h2>' + chartX(itemsOf(taken)) + '</div>';
      if (view.subj) h += '<div class="card" id="wk"></div>';
    }
    else {
      var g2 = by['단풀'].length > 0, gc = '';
      if (by['개념'].length) gc += '<div class="card"><h2><i class="kdot" style="background:' + toneOf('개념', s) + '"></i>개념반 <span class="meta">' + esc(s) + ' · 소테스트·월말 · 정답률 %</span></h2>' + chartX(itemsOf(by['개념']), g2) + '</div>';
      if (g2) {
        var fin = taken.filter(function (x) { return x.t.kind === '월말테스트' || /월말/.test(x.t.label); }), ms2 = [];
        fin.forEach(function (x) { if (ms2.indexOf(x.t.month) < 0) ms2.push(x.t.month); });
        var rows2 = ms2.sort().map(function (m) {
          var r = { m: m, vals: {}, by: {} };
          ['개념', '단풀'].forEach(function (k) { var l = fin.filter(function (x) { return x.kind === k && x.t.month === m; }); r.by[k] = l; r.vals[k] = l.length ? avgPct(l) : null; });
          return r;
        });
        gc += '<div class="card"><h2>월말 비교 <span class="meta">' + esc(s) + ' · 개념반 월말 · 단풀반 월말 · 정답률 %</span></h2>' + barChart(rows2, ['개념', '단풀'], s, by['개념'].length > 0) + '</div>';
      }
      h += by['개념'].length && g2 ? '<div class="sgrid two">' + gc + '</div>' : gc;
    }
    // 테스트 결과는 달마다 한 페이지 (2026-10-21 사용자): 위에 달 고르기, 기본은 가장 최근 달
    var tMonths = []; tests.forEach(function (x) { if (x.t.month && tMonths.indexOf(x.t.month) < 0) tMonths.push(x.t.month); });
    tMonths.sort().reverse();
    if (tmKey !== mode + '|' + s || tMonths.indexOf(tmSel) < 0) { tmKey = mode + '|' + s; tmSel = tMonths[0] || ''; }
    function testsCard(k, ttl) {
      var all = tests.filter(function (x) { return x.kind === k; });
      if (!all.length) return '';
      var list = all.filter(function (x) { return x.t.month === tmSel; });
      var c = '<div class="card"><h2>' + (real ? '' : '<i class="kdot" style="background:' + toneOf(k, s) + '"></i>') + esc(ttl) + ' <span class="meta">' + esc(tmSel ? UI.monthLabel(tmSel) : '') + '</span></h2>';
      c += list.length ? list.map(function (x) { return testItem(x.t, null, real, !real && (x.t.kind === '월말테스트' || /월말/.test(x.t.label))); }).join('') : '<p class="empty">이 달에는 ' + esc(ttl) + ' 기록이 없어요.</p>';
      return c + '</div>';
    }
    var pager = tMonths.length > 1 ? '<div class="card mpg"><span class="lbl">달</span><div class="chiprow">' + tMonths.map(function (m) {
      return '<button type="button" class="tab" data-tm="' + m + '" aria-selected="' + (m === tmSel) + '">' + esc(monthShort(m)) + '</button>';
    }).join('') + '</div></div>' : '';
    var left = real ? testsCard('실전', '테스트 결과') : testsCard('개념', '개념반 소테스트·월말') + testsCard('단풀', '단풀반 월말');
    left = left ? pager + left : '<div class="card"><p class="empty">아직 등록된 테스트가 없어요.</p></div>';
    if (hws.length) {
      var wCard = '<div class="card"><h2><i class="kdot" style="background:' + toneOf('개념', s) + '"></i>개념반 숙제</h2>';
      byMonth(hws, function (w) { return w.month; }).forEach(function (g) { wCard += '<h3 class="mhd">' + esc(g.m ? UI.monthLabel(g.m) : '') + '</h3>' + g.l.map(hwItem).join(''); });
      h += '<div class="sgrid hwfirst"><div class="col1">' + left + '</div><div class="col2">' + wCard + '</div></div></div>';
    } else h += left;
    $('#panel').innerHTML = h; bindTips($('#panel'));
    if ($('#wk')) drawWeak();
    UI.all('#panel [data-tm]').forEach(function (b) { b.onclick = function () { tmSel = b.getAttribute('data-tm'); var y = b.getBoundingClientRect().top; renderSubject(mode, s); var nb = $('#panel [data-tm="' + tmSel + '"]'); if (nb) window.scrollBy(0, nb.getBoundingClientRect().top - y); }; });
    UI.all('#panel [data-hw]').forEach(function (b) { b.onclick = function () { openUpload(b.getAttribute('data-hw')); }; });
  }

  /* 실전반 과목별 정답률 · 취약 과목 (서버 view.subj: 시험지 「문항과목」으로 문항을 과목별로 나눔). 종합 | 달마다 */
  function sjCol(sj) { return subjColor(sj === '역사' ? '세계사' : sj); }
  function gapP(o) { return o.avg === null ? null : Math.round((o.me - o.avg) * 10) / 10; }
  function drawWeak() {
    var S = view.subj, box = $('#wk'); if (!S || !box) return;
    var g = wkSel ? S.months.filter(function (m) { return m.m === wkSel; })[0] : null;
    if (!g) { wkSel = ''; g = S.all; }
    var h = '<h2>과목별 정답률 · 취약 과목 <span class="meta">내 정답률 · 반 평균(같은 시험을 본 학생 전체) · 취약 = 반 평균과 비교해 가장 약한 과목</span></h2>';
    h += '<div class="chiprow" role="tablist"><button type="button" class="tab" role="tab" data-wm="" aria-selected="' + (!wkSel) + '">종합</button>' +
      S.months.map(function (m) { return '<button type="button" class="tab" role="tab" data-wm="' + m.m + '" aria-selected="' + (wkSel === m.m) + '">' + esc(monthShort(m.m)) + '</button>'; }).join('') + '</div>';
    var w = g.weak ? g.subs.filter(function (o) { return o.s === g.weak; })[0] : null, d = w ? gapP(w) : null;
    if (w) h += '<p class="wkline">' + (d < 0
      ? '취약 과목 <b><i class="kdot" style="background:' + sjCol(w.s) + '"></i>' + esc(w.s) + '</b> — 반 평균보다 <b class="neg">' + Math.abs(d) + '%p</b> 낮아요'
      : '취약 과목 <b><i class="kdot" style="background:' + sjCol(w.s) + '"></i>' + esc(w.s) + '</b> — 모든 과목이 반 평균 이상이지만, 반 평균과 차이가 가장 작아요 (+' + d + '%p)') + '</p>';
    h += '<div class="wk">' + g.subs.map(function (o) {
      var dd = gapP(o), weak = o.s === g.weak;
      return '<div class="wkrow' + (weak ? ' weak' : '') + '"><div class="wkn"><i class="kdot" style="background:' + sjCol(o.s) + '"></i>' + esc(o.s) + (weak ? '<span class="wktag">취약</span>' : '') + '</div>' +
        '<div class="wkb"><span class="me" style="width:' + o.me + '%;background:' + sjCol(o.s) + '"></span>' + (o.avg === null ? '' : '<span class="av" style="width:' + o.avg + '%"></span>') + '</div>' +
        '<div class="wkv"><b>' + o.me + '%</b><small>반 평균 ' + (o.avg === null ? '-' : o.avg + '%') + '</small><small>' + (dd === null ? '' : '<em class="' + (dd >= 0 ? 'pos' : 'neg') + '">' + (dd > 0 ? '+' : '') + dd + '%p</em>') + '<span class="ct">' + (dd === null ? '' : ' · ') + o.c + '/' + o.t + '문항</span></small></div></div>';
    }).join('') + '</div>';
    h += '<div class="legend"><span><i class="bm"></i>내 정답률</span><span><i class="ba"></i>반 평균</span><span>시험 ' + g.n + '개</span></div>';
    if (!wkSel && S.months.length > 1) h += '<p class="wkm"><span>달마다 취약 과목</span>' + S.months.map(function (m) {
      var o = m.weak ? m.subs.filter(function (x) { return x.s === m.weak; })[0] : null, dd = o ? gapP(o) : null;
      return '<button type="button" class="sjb" data-wm="' + m.m + '"><b>' + esc(monthShort(m.m)) + '</b> ' + (o ? '<i class="kdot" style="background:' + sjCol(o.s) + '"></i>' + esc(o.s) + ' <small class="' + (dd < 0 ? 'gneg' : 'gpos') + '">' + (dd > 0 ? '+' : '') + dd + '%p</small>' : '<em>-</em>') + '</button>';
    }).join('') + '</p>';
    box.innerHTML = h;
    UI.all('#wk [data-wm]').forEach(function (b) { b.onclick = function () { wkSel = b.getAttribute('data-wm'); drawWeak(); }; });
  }

  /* 요약: 반 종류 × 과목 표 하나 */
  function renderSum() {
    TIPS = [];
    var tk = allTaken(), hwAll = [];
    view.classes.forEach(function (c) { hwAll = hwAll.concat(c.hw); });
    var g = gapPct(tk), hd = hwAll.filter(function (w) { return w.done; }).length;
    var cols = ['경제', '정치', '지리', '현대사회', '세계사', '일본사', '기타'].filter(function (s) { return tk.some(function (x) { return x.kind !== '실전' && x.subj === s; }); });
    var sj = tk.filter(function (x) { return x.kind === '실전'; }), sjG = [];
    sj.forEach(function (x) { var gg = grpOf(x.c, x.t); if (sjG.indexOf(gg) < 0) sjG.push(gg); });
    var h = '<div class="tiles four">' + tile('전체 평균 정답률', avgPct(tk), '%', 'hi', '테스트 ' + tk.length + '개') +
      tile('누적 평균과 비교', g === null ? null : (g > 0 ? '+' : '') + g, '%p', g === null ? '' : g >= 0 ? 'gpos' : 'gneg', gapText(g)) +
      tile('들은 과목', cols.length + sjG.length, '개', '', sjG.length ? '실전반 포함' : '') + tile('숙제 제출', hwAll.length ? hd + ' / ' + hwAll.length : null, '', '', '') + '</div>';
    function gapTag(l) { var gg = gapPct(l); return gg === null ? '' : '<small class="' + (gg >= 0 ? 'gpos' : 'gneg') + '">' + (gg > 0 ? '+' : '') + gg + '%p</small>'; }
    var span = Math.max(cols.length, 1);
    h += '<div class="card"><h2>반 종류 × 과목 <span class="meta">평균 정답률 · 누적 평균과 차이 · 누르면 그 과목으로</span></h2>';
    if (!tk.length) h += '<p class="empty">아직 입력된 점수가 없어요.</p>';
    else {
      h += '<div class="tw"><table class="stab mtx"><thead><tr><th></th>' + (cols.length ? cols.map(function (s) { return '<th><i class="kdot" style="background:' + subjColor(s) + '"></i>' + esc(s) + '</th>'; }).join('') : '<th></th>') + '</tr></thead><tbody>';
      ['개념', '단풀'].forEach(function (k) {
        if (!tk.some(function (x) { return x.kind === k; })) return;
        h += '<tr><th>' + k + '반</th>' + cols.map(function (s) {
          var l = tk.filter(function (x) { return x.kind === k && x.subj === s; });
          return l.length ? '<td class="cell" data-k="' + k + '" data-s="' + esc(s) + '"><b>' + avgPct(l) + '%</b>' + gapTag(l) + '<em>' + l.length + '개</em></td>' : '<td class="nil">-</td>';
        }).join('') + '</tr>';
      });
      if (sjG.length) h += '<tr><th>실전반</th><td colspan="' + span + '" class="sjcell">' + sjG.map(function (gg) {
        var l = sj.filter(function (x) { return grpOf(x.c, x.t) === gg; }), cv = l.filter(function (x) { return x.t.conv !== null && x.t.conv !== undefined; });
        return '<button type="button" class="sjb" data-k="실전" data-s="' + esc(gg) + '"><b>' + esc(gg) + '</b> ' + avgPct(l) + '%' + (cv.length ? ' · 환산 ' + Math.round(cv.reduce(function (a, x) { return a + +x.t.conv; }, 0) / cv.length) : '') + ' ' + gapTag(l) + ' <em>' + l.length + '개</em></button>';
      }).join('') + '</td></tr>';
      h += '</tbody></table></div>';
    }
    h += '</div>';
    $('#panel').innerHTML = h;
    UI.all('#panel [data-k]').forEach(function (r) { r.onclick = function () { kindSel = r.getAttribute('data-k') === '실전' ? '실전' : '과목'; subjSel = r.getAttribute('data-s'); renderTabs(); window.scrollTo(0, 0); }; });
  }

  /** 사진 줄이기(긴 쪽 1600px JPEG) + 같은 사진 찾기용 지문(17×16 회색 → 옆 칸 밝기 비교 256비트, 16진수 64자) */
  function compress(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        var hash = '';
        try { hash = dhash(cv); } catch (e) { hash = ''; }
        res({ b64: cv.toDataURL('image/jpeg', 0.82).split(',')[1], hash: hash });
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('사진을 읽지 못했어요: ' + file.name)); };
      img.src = url;
    });
  }
  function dhash(src) {
    function shrink(from, w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(from, 0, 0, w, h); return c; }
    var c = shrink(shrink(src, 136, 128), 17, 16), d = c.getContext('2d').getImageData(0, 0, 17, 16).data, g = [], out = '', nib = 0, nb = 0;
    for (var i = 0; i < 17 * 16; i++) g.push(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114);
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      nib = (nib << 1) | (g[y * 17 + x] < g[y * 17 + x + 1] ? 1 : 0);
      if (++nb === 4) { out += nib.toString(16); nib = 0; nb = 0; }
    }
    return out;
  }

  // 카메라로 바로 찍은 사진만: 휴대폰은 「사진 찍기」가 카메라를 바로 열고, 앨범의 오래된 사진(찍은 지 30분 넘은 파일)은 받지 않음
  var FRESH_MS = 30 * 60 * 1000, MAX_BATCH = 12;
  function openUpload(hwId) {
    var w = null;
    view.classes.forEach(function (c) { c.hw.forEach(function (x) { if (x.id === hwId) w = x; }); });
    UI.all('#panel .upbox').forEach(function (b) { b.innerHTML = ''; });
    var box = $('#panel [data-box="' + hwId + '"]');
    box.innerHTML = '<div class="up"><p class="uphint">문제집을 <b>한 쪽씩 바로 찍어</b> 올려요. 문항 번호가 보이게 찍어 주세요. 앨범에 있던 사진은 올릴 수 없어요.</p>' +
      '<label class="btn sub block cam" for="ph">📷 사진 찍기</label><input id="ph" class="vh" type="file" accept="image/*" capture="environment">' +
      '<div id="th" class="thumbs"></div><p id="phMsg" class="msg" role="status"></p>' +
      '<label for="cnt">채점해 본 맞은 개수' + (w.total ? ' (' + w.total + '문 중)' : '') + (w.done ? ' <span class="opt">(비우면 그대로)</span>' : '') + '</label><input id="cnt" type="number" inputmode="numeric" min="0"' + (w.total ? ' max="' + w.total + '"' : '') + '>' +
      '<button id="send" class="btn block" type="button">제출하기</button><div class="bar" hidden><i></i></div><p id="upMsg" class="msg" role="status"></p></div>';
    var files = [];
    function drawThumbs() {
      $('#th').innerHTML = files.map(function (f, i) {
        return '<span class="th"><img alt="' + (i + 1) + '번째 사진" src="' + f.url + '"><button type="button" class="x" data-rm="' + i + '" aria-label="' + (i + 1) + '번째 사진 빼기">×</button></span>';
      }).join('');
      UI.all('#th [data-rm]').forEach(function (b) { b.onclick = function () { var k = +b.getAttribute('data-rm'); URL.revokeObjectURL(files[k].url); files.splice(k, 1); drawThumbs(); }; });
      $('#panel label.cam').textContent = files.length ? '📷 한 장 더 찍기 (' + files.length + '장)' : '📷 사진 찍기';
    }
    $('#ph').onchange = function (e) {
      var pm = $('#phMsg'), list = Array.prototype.slice.call(e.target.files);
      pm.className = 'msg'; pm.textContent = '';
      list.forEach(function (f) {
        if (files.length >= MAX_BATCH) { pm.className = 'msg err'; pm.textContent = '한 번에 ' + MAX_BATCH + '장까지 올릴 수 있어요. 먼저 제출하고 「사진 더 올리기」로 이어서 올려 주세요.'; return; }
        if (f.lastModified && Date.now() - f.lastModified > FRESH_MS) { pm.className = 'msg err'; pm.textContent = '방금 찍은 사진만 올릴 수 있어요. 「사진 찍기」를 눌러 문제집을 바로 찍어 주세요.'; return; }
        files.push({ file: f, url: URL.createObjectURL(f) });
      });
      e.target.value = '';   // 같은 버튼으로 계속 찍을 수 있게
      drawThumbs();
    };
    $('#send').onclick = function () {
      var msg = $('#upMsg'), btn = $('#send'), bar = box.querySelector('.bar'), fill = bar.querySelector('i');
      if (!files.length) { msg.className = 'msg err'; msg.textContent = '사진을 찍어 주세요.'; return; }
      if ($('#cnt').value === '' && !w.done) { msg.className = 'msg err'; msg.textContent = '맞은 개수를 적어 주세요.'; return; }
      setBusy(btn, true, '올리는 중…'); bar.hidden = false; msg.className = 'msg'; msg.textContent = '';
      var start = (w.photos || 0) + 1, i = 0, sent = 0, hashes = [], skipped = 0;
      function next() {
        if (i >= files.length) {
          if (!sent && !w.done) { setBusy(btn, false, '제출하기'); msg.className = 'msg err'; msg.textContent = '이미 올린 사진이에요. 다른 쪽을 찍어 주세요.'; return; }
          return stuCall('hwFinish', { hw: hwId, count: $('#cnt').value }).then(function (r) {
            setBusy(btn, false, '제출하기');
            if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error; return; }
            files.forEach(function (f) { URL.revokeObjectURL(f.url); });
            show(r.data);
          });
        }
        msg.textContent = (i + 1) + ' / ' + files.length + '장 올리는 중';
        return compress(files[i].file).then(function (x) {
          // 한 번에 고른 사진 중 같은 사진은 한 장만
          if (x.hash && hashes.some(function (h) { return Core.sameHash(h, x.hash); })) return { ok: true, data: { dup: 'same' } };
          if (x.hash) hashes.push(x.hash);
          return stuCall('hwPhoto', { hw: hwId, order: start + sent, mime: 'image/jpeg', b64: x.b64, hash: x.hash });
        }).then(function (r) {
          if (!r.ok) throw new Error(r.error);
          if (r.data && r.data.dup === 'same') skipped++; else sent++;
          i++; fill.style.width = Math.round(i / files.length * 100) + '%';
          return next();
        });
      }
      next().catch(function (e) {
        setBusy(btn, false, '다시 제출하기');
        msg.className = 'msg err';
        // 실패한 사진부터 다시: 저장된 사진은 목록에서 뺌
        files.splice(0, i + (/새로 찍어/.test(e.message || '') ? 1 : 0)).forEach(function (f) { URL.revokeObjectURL(f.url); });
        w.photos = (w.photos || 0) + sent;
        drawThumbs();
        msg.textContent = (e.message || '올리지 못했어요.') + (sent ? ' (앞의 ' + sent + '장은 저장됐어요.)' : '');
      });
    };
  }

  $('#go').onclick = function () { login($('#sid').value); };
  $('#sid').addEventListener('keydown', function (e) { if (e.key === 'Enter') login($('#sid').value); });
  $('#out').onclick = function () { UI.store.del('seiseki.code'); UI.store.del('seiseki.view'); view = null; code = ''; tok = ''; kindSel = ''; subjSel = ''; $('#app').hidden = true; $('#acts').hidden = true; $('#login').hidden = false; $('#sid').value = ''; };
  $('#refresh').onclick = function () { if (code) login(code, true); };

  var saved = UI.store.get('seiseki.code'), keep = null;
  try { keep = JSON.parse(UI.store.get('seiseki.view') || 'null'); } catch (e) { keep = null; }
  if (saved) {
    $('#remember').checked = true; $('#sid').value = Core.fmtCode(saved);
    // 지난번 화면을 바로 보여 주고(기다리지 않게), 뒤에서 새로 불러와 바꿈
    if (keep && keep.v && keep.v.code === saved) { code = saved; show(keep.v); login(saved, true); }
    else login(saved);
  } else Api.warm();   // 번호를 치는 동안 서버를 미리 깨워 둠
})();
