/* 학생 화면: 번호로 들어와 성적 조회 + 숙제 사진 제출 */
(function () {
  var $ = UI.$, esc = UI.esc;
  var view = null, code = '', cur = 0, month = '', busy = false;

  if (Api.demo) $('#demo').hidden = false;

  function setBusy(btn, on, label) { busy = on; btn.disabled = on; if (label) btn.textContent = label; }

  function login(c) {
    var btn = $('#go');
    if (busy) return;
    setBusy(btn, true, '확인하는 중…');
    Api.call('login', { code: c }).then(function (r) {
      setBusy(btn, false, '조회하기');
      if (!r.ok) { $('#loginMsg').textContent = r.error; UI.store.del('seiseki.code'); return; }
      $('#loginMsg').textContent = '';
      code = r.data.code;
      if ($('#remember').checked) UI.store.set('seiseki.code', code);
      show(r.data);
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
    if (cur >= view.classes.length) cur = 0;
    $('#nm').textContent = view.name;
    $('#idshow').textContent = Core.fmtCode(view.code);
    $('#login').hidden = true; $('#app').hidden = false; $('#acts').hidden = false;
    renderTabs();
  }

  /* ---------- 보기: 월별(반·달) / 과목별(개념·단풀 비교) / 전체 ---------- */
  var mode = 'month', subjSel = '';
  var SUBJS = { '경제': '경제', '정치': '정치', '지리': '지리', '현사': '현대사회', '현대사회': '현대사회', '세계사': '세계사', '역사': '세계사', '일본사': '일본사' };
  var KIND_COLOR = { '개념': 'var(--me)', '단풀': 'var(--orange)', '실전': 'var(--green)' };
  /** 과목마다 그래프 색 (학생이 한눈에 과목을 구분하게) */
  var SUBJ_COLOR = { '경제': '#3182F6', '정치': '#8B5CF6', '지리': '#0EA5A4', '현대사회': '#F59E0B', '세계사': '#EC4899', '일본사': '#64748B', '실전 (EJU)': '#10B981', '기타': '#94A3B8' };
  function subjColor(sj) { return SUBJ_COLOR[sj] || '#94A3B8'; }
  function kindOf(c) { return c.kind || ({ GN: '개념', DP: '단풀', SJ: '실전' })[String(c.code).split('-')[0]] || ''; }
  function subjOfT(c, t) { return kindOf(c) === '실전' ? '실전 (EJU)' : (SUBJS[String(t.label).split(' ')[0]] || '기타'); }
  function monthsOf(c) {
    var m = {};
    c.tests.forEach(function (t) { if (t.month) m[t.month] = 1; });
    c.hw.forEach(function (h) { if (h.month) m[h.month] = 1; });
    return Object.keys(m).sort().reverse();
  }
  function subjIn(c, m) {
    var x = c.tests.concat(c.hw).filter(function (t) { return t.month === m && SUBJS[String(t.label).split(' ')[0]]; })[0];
    return x ? SUBJS[String(x.label).split(' ')[0]] : '';
  }
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
  function tile(label, val, unit, cls, note) {
    return '<div class="tile' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + (val === null || val === undefined ? '-' : val + (unit ? '<small>' + unit + '</small>' : '')) + '</b>' + (note ? '<em>' + note + '</em>' : '') + '</div>';
  }
  function gapText(g) { return g === null ? '' : (g > 0 ? '누적 평균보다 ' + g + '%p 높아요' : g < 0 ? '누적 평균보다 ' + (-g) + '%p 낮아요' : '누적 평균과 같아요'); }

  /* ---------- 그래프 + 마우스를 올리면(휴대폰은 누르면) 점수 말풍선 ---------- */
  var TIPS = [];
  function tipHtml(it) {
    return '<b>' + esc(it.title) + '</b>' + (it.m ? '<span class="tm">' + (+it.m.slice(5)) + '월</span>' : '') +
      '<div><i style="background:' + it.col + '"></i>내 점수 <b>' + (it.sc !== undefined ? it.sc + '/' + it.tot + ' · ' : '') + it.p + '%</b></div>' +
      (it.av !== null && it.av !== undefined ? '<div><i class="av"></i>그때 반 평균 ' + (+it.av).toFixed(1) + (it.tot ? '/' + it.tot : '') + '</div>' : '') +
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
    series.forEach(function (key) { var c0 = items.filter(function (it) { return it.s === key; })[0].col; s += '<span><i style="border-top-color:' + c0 + '"></i>' + esc(series.length === 1 ? '내 정답률' + (key && key !== '나' ? ' (' + key + ')' : '') : key) + '</span>'; });
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
    s += '</svg></div><div class="legend">' + subs.map(function (sj) { return '<span><i class="sq" style="background:' + subjColor(sj) + '"></i>' + esc(sj) + '</span>'; }).join('') +
      '<span><i class="a" style="border-top-color:var(--ink2)"></i>누적 평균</span><span class="hint">막대에 마우스를 올리면(휴대폰은 누르면) 점수가 나와요</span></div>';
    return s;
  }
  function itemsOf(list, seriesFn, labFn) {
    return list.map(function (x) {
      var sj = x.subj || subjOfT(x.c, x.t), ser = seriesFn ? seriesFn(x) : sj;
      return { p: pct(x.t.score, x.t.total), s: ser, col: seriesFn && KIND_COLOR[String(ser).replace('반', '')] ? KIND_COLOR[String(ser).replace('반', '')] : subjColor(sj),
        lab: labFn ? labFn(x) : shortLabel(x.t), m: x.t.month, title: (x.kind ? x.kind + '반 ' : '') + x.t.label, sc: x.t.score, tot: x.t.total, av: x.t.avg, cum: x.t.cum };
    });
  }

  function renderModes() {
    var M = [['month', '월별'], ['subj', '과목별'], ['all', '전체']];
    $('#modes').innerHTML = M.map(function (m) { return '<button type="button" role="tab" data-mode="' + m[0] + '" aria-selected="' + (m[0] === mode) + '">' + m[1] + '</button>'; }).join('');
    UI.all('#modes [data-mode]').forEach(function (b) { b.onclick = function () { mode = b.getAttribute('data-mode'); renderTabs(); }; });
  }

  function renderTabs() {
    var tabs = $('#tabs');
    renderModes();
    if (!view.classes.length) { tabs.innerHTML = ''; $('#months').innerHTML = ''; $('#panel').innerHTML = '<div class="card"><p class="empty">아직 등록된 반이 없어요. 선생님께 말씀해 주세요.</p></div>'; return; }
    if (mode === 'subj') return renderSubj();
    if (mode === 'all') return renderAll();
    var ms = monthsOf(view.classes[cur]);
    if (!month || ms.indexOf(month) < 0) month = ms[0] || '';
    // 반 이름 대신 과목이 먼저 보이게: 과목은 달마다 바뀌니 (보고 있는 반은 고른 달, 다른 반은 가장 최근 달) 시험·숙제 이름에서 읽음
    tabs.innerHTML = view.classes.map(function (c, i) {
      var m = i === cur ? month : (monthsOf(c)[0] || ''), kind = kindOf(c);
      var big, small = [];
      if (kind === '실전') big = '실전반 ' + String(c.code).split('-').pop();
      else { big = subjIn(c, m) || c.name; if (kind) small.push(kind + '반'); }
      if (c.time) small.push(c.time);
      if (c.current === false) small.push('지난 반');
      return '<button class="tab" type="button" role="tab" data-i="' + i + '" aria-selected="' + (i === cur) + '">' + esc(big) + (small.length ? '<small>' + esc(small.join(' · ')) + '</small>' : '') + '</button>';
    }).join('');
    UI.all('#tabs .tab').forEach(function (b) { b.onclick = function () { cur = +b.getAttribute('data-i'); month = ''; renderTabs(); }; });
    $('#months').innerHTML = ms.length > 1 ? ms.map(function (m) {
      return '<button class="tab" type="button" data-m="' + m + '" aria-selected="' + (m === month) + '">' + esc(UI.monthLabel(m)) + '</button>';
    }).join('') : '';
    UI.all('#months .tab').forEach(function (b) { b.onclick = function () { month = b.getAttribute('data-m'); renderTabs(); }; });
    renderPanel();
  }

  function testItem(t, extra) {
    var h = '<div class="item"><div class="row"><b>' + esc(t.label) + (extra ? ' <span class="meta">' + esc(extra) + '</span>' : '') + '</b>' +
      (t.score === null ? '<span class="pill wait">아직 입력 전</span>' : '<span class="score">' + t.score + '<small> / ' + t.total + '</small></span>') + '</div>';
    h += '<p class="meta">' + [UI.dateLabel(t.date), t.score !== null ? '정답률 ' + pct(t.score, t.total) + '%' : '', t.avg !== null ? '그때 반 평균 ' + t.avg.toFixed(1) : '', t.cum ? '누적 평균 ' + t.cum.pct + '%' : '',
      t.conv !== null ? '환산점수 ' + t.conv + (t.convAvg !== null ? ' (반 평균 ' + Math.round(t.convAvg) + ')' : '') : ''].filter(Boolean).map(esc).join(' · ') + '</p>';
    if (t.score !== null) {
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

  /* 월별: 한 반의 한 달 */
  function renderPanel() {
    TIPS = [];
    var c = view.classes[cur];
    var tests = c.tests.filter(function (t) { return !month || t.month === month; }).map(function (t) { return { c: c, t: t }; }).sort(order).map(function (x) { return x.t; });
    var hws = c.hw.filter(function (h) { return !month || h.month === month; });
    var taken = tests.filter(function (t) { return t.score !== null; }).map(function (t) { return { t: t }; });
    var done = hws.filter(function (h) { return h.done; }).length, gap = gapPct(taken), mm = month ? (+month.slice(5)) + '월 ' : '';
    var h = '<div class="tiles four">' +
      tile(mm + '평균 정답률', avgPct(taken), '%', 'hi', taken.length ? '테스트 ' + taken.length + '개의 평균' : '') +
      tile('누적 평균과 비교', gap === null ? null : (gap > 0 ? '+' : '') + gap, '%p', gap === null ? '' : gap >= 0 ? 'gpos' : 'gneg', gap === null ? '' : gapText(gap)) +
      tile(mm + '본 테스트', taken.length + ' / ' + tests.length, '', '', '') +
      tile('숙제 제출', hws.length ? done + ' / ' + hws.length : null, '', '', '') + '</div>';
    var all = c.tests.filter(function (t) { return t.score !== null; }).map(function (t) { return { c: c, t: t, kind: kindOf(c), subj: subjOfT(c, t) }; }).sort(order);
    h += '<div class="sgrid"><div class="col1">';
    var monthOnly = kindOf(c) === '단풀';   // 단풀반은 한 달에 월말 한 번 → 막대그래프
    h += '<div class="card"><h2>' + (monthOnly ? '월말 테스트' : '점수 추이') + ' <span class="meta">' + esc(kindOf(c) + '반') + ' 전체 기간 · 정답률 % · 과목마다 색이 달라요</span></h2>' +
      (monthOnly ? barsX(itemsOf(all, null, function (x) { return x.subj; }), true) : chartX(itemsOf(all), true)) + '</div>';
    h += '<div class="card"><h2>' + esc(mm) + '테스트 결과</h2>';
    if (!tests.length) h += '<p class="empty">이 달에 등록된 테스트가 없어요.</p>';
    tests.forEach(function (t) { h += testItem(t); });
    h += '</div></div><div class="col2"><div class="card"><h2>' + esc(mm) + '숙제</h2>';
    if (!hws.length) h += '<p class="empty">이 달에 온라인으로 낼 숙제가 없어요.</p>';
    hws.forEach(function (w) {
      var detail = [w.book ? esc(w.book) : '', w.p0 ? 'p.' + w.p0 + '~' + w.p1 : '', w.total ? w.total + '문' : ''].filter(Boolean).join(' · ');
      if (w.done) detail += (detail ? ' · ' : '') + (w.photos ? '사진 ' + w.photos + '장' : '선생님 입력') + (w.count !== null ? ' · 맞은 개수 ' + w.count : '');
      var due = dueLine(w);
      h += '<div class="item"><div class="row"><div><b>' + esc(w.label) + '</b><p class="meta">' + detail + '</p>' + (due ? '<p class="meta due' + (w.overdue ? ' over' : '') + '">' + due + '</p>' : '') + '</div>' +
        (w.done ? '<span class="pills">' + (w.late ? '<span class="pill late">늦음</span>' : '') + '<span class="pill ' + (w.checked ? 'ok">선생님 확인' : 'ok">제출 완료') + '</span></span>'
          : (w.overdue ? '<span class="pills"><span class="pill no">미제출</span><button class="btn sm" type="button" data-hw="' + esc(w.id) + '">늦게 내기</button></span>' : '<button class="btn sm" type="button" data-hw="' + esc(w.id) + '">제출하기</button>')) + '</div>' +
        (w.done ? '<button class="linkbtn" type="button" data-hw="' + esc(w.id) + '">사진 더 올리기</button>' : '') +
        '<div class="upbox" data-box="' + esc(w.id) + '"></div></div>';
    });
    h += '</div></div></div>';
    $('#panel').innerHTML = h; bindTips($('#panel'));
    UI.all('#panel [data-hw]').forEach(function (b) { b.onclick = function () { openUpload(b.getAttribute('data-hw')); }; });
  }

  /** 달마다 막대 두 개(개념·단풀) 비교 그래프. rows: [{m, vals: {kind: pct|null}}] */
  function barChart(rows, kinds) {
    var pw = ($('#panel') && $('#panel').clientWidth) || window.innerWidth - 32, pad = window.innerWidth <= 480 ? 36 : 44;
    var fs = window.innerWidth > 860 ? 12 : 10, n = rows.length, k = kinds.length;
    var W = Math.max(260, pw - pad, n * (k * 26 + 30)), H = fs === 12 ? 220 : 180, L = 34, R = 10, T = 18, B = fs * 2.6;
    var slot = (W - L - R) / n, bw = Math.min(34, (slot - 18) / k);
    function y(p) { return T + (100 - p) * (H - T - B) / 100; }
    var s = '<div class="chartwrap"><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="달마다 반별 정답률">';
    [0, 50, 100].forEach(function (g) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="var(--line)"/>';
      s += '<text x="' + (L - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end" font-size="' + fs + '" fill="var(--muted)">' + g + '</text>';
    });
    rows.forEach(function (r, i) {
      var cx = L + slot * i + slot / 2, x0 = cx - bw * k / 2 - (k - 1) * 2;
      kinds.forEach(function (kd, j) {
        var v = r.vals[kd]; if (v === null || v === undefined) return;
        var x = x0 + j * (bw + 4), top = y(v);
        s += '<rect x="' + x + '" y="' + top + '" width="' + bw + '" height="' + (y(0) - top) + '" rx="5" fill="' + (KIND_COLOR[kd] || 'var(--me)') + '"/>';
        var lst = r.by[kd], ca = cumAvg(lst);
        s += hit(x - 2, bw + 4, H, { title: kd + '반 ' + subjSel + (lst.length > 1 ? ' (' + lst.length + '개 평균)' : ' ' + shortLabel(lst[0].t)), m: r.m, p: v, col: KIND_COLOR[kd] || 'var(--me)',
          sc: lst.length === 1 ? lst[0].t.score : undefined, tot: lst.length === 1 ? lst[0].t.total : undefined, av: null, cum: ca === null ? null : { pct: ca } });
        s += '<text x="' + (x + bw / 2) + '" y="' + (top - 4) + '" text-anchor="middle" font-size="' + (fs - 1) + '" font-weight="700" fill="var(--ink2)">' + v + '</text>';
      });
      s += '<text x="' + cx + '" y="' + (H - fs * 0.8) + '" text-anchor="middle" font-size="' + fs + '" font-weight="700" fill="var(--ink2)">' + (+r.m.slice(5)) + '월</text>';
    });
    s += '</svg></div><div class="legend">' + kinds.map(function (kd) { return '<span><i class="sq" style="background:' + (KIND_COLOR[kd] || 'var(--me)') + '"></i>' + kd + '반</span>'; }).join('') + '</div>';
    return s;
  }

  /* 과목별: 개념반(주차별 소테스트 + 월말)과 단풀반(달마다 월말 하나)을 달 단위로 나란히 */
  function renderSubj() {
    TIPS = [];
    var tk = allTaken(), subs = [];
    tk.slice().reverse().forEach(function (x) { if (subs.indexOf(x.subj) < 0) subs.push(x.subj); });   // 최근에 본 과목부터
    if (subs.indexOf(subjSel) < 0) subjSel = subs[0] || '';
    $('#tabs').innerHTML = subs.map(function (s) {
      var ks = []; tk.forEach(function (x) { if (x.subj === s && ks.indexOf(x.kind) < 0) ks.push(x.kind); });
      return '<button class="tab" type="button" data-s="' + esc(s) + '" aria-selected="' + (s === subjSel) + '">' + esc(s) + '<small>' + esc(ks.map(function (k) { return k + '반'; }).join(' · ')) + '</small></button>';
    }).join('');
    $('#months').innerHTML = '';
    UI.all('#tabs [data-s]').forEach(function (b) { b.onclick = function () { subjSel = b.getAttribute('data-s'); renderTabs(); }; });
    if (!subs.length) { $('#panel').innerHTML = '<div class="card"><p class="empty">아직 입력된 점수가 없어요.</p></div>'; return; }
    var list = tk.filter(function (x) { return x.subj === subjSel; });
    var kinds = ['개념', '단풀', '실전'].filter(function (k) { return list.some(function (x) { return x.kind === k; }); });
    var months = []; list.forEach(function (x) { if (months.indexOf(x.t.month) < 0) months.push(x.t.month); });
    var rows = months.map(function (m) {
      var r = { m: m, vals: {}, by: {} };
      kinds.forEach(function (k) { var l = list.filter(function (x) { return x.kind === k && x.t.month === m; }); r.by[k] = l; r.vals[k] = l.length ? avgPct(l) : null; });
      return r;
    });
    // 타일: 반마다 평균 정답률 (개념은 소테스트·월말 전부, 단풀은 월말들)
    var h = '<div class="tiles four">';
    kinds.forEach(function (k) {
      var lk = list.filter(function (x) { return x.kind === k; }), g = gapPct(lk), nm = rows.filter(function (r) { return r.by[k].length; }).length;
      h += tile(k + '반 평균 정답률', avgPct(lk), '%', 'hi k-' + k, (k === '개념' ? nm + '달 · 테스트 ' + lk.length + '개' : nm + '달 · 월말 ' + lk.length + '번') + (g === null ? '' : '<br>' + gapText(g)));
    });
    if (kinds.length === 1) {
      var g1 = gapPct(list);
      h += tile('누적 평균과 비교', g1 === null ? null : (g1 > 0 ? '+' : '') + g1, '%p', g1 === null ? '' : g1 >= 0 ? 'gpos' : 'gneg', gapText(g1));
    }
    h += '</div>';
    // 월말테스트는 같은 시험을 지금까지 본 모든 학생의 누적 평균과 비교 (그달 반 평균은 그달 학생 수준에 따라 흔들림)
    kinds.forEach(function (k) {
      var lm = list.filter(function (x) { return x.kind === k && x.t.kind === '월말테스트' && x.t.cum; });
      if (!lm.length) return;
      var me = avgPct(lm), ca = cumAvg(lm), d = me - ca;
      h += '<p class="cmp"><span class="kdot" style="background:' + (KIND_COLOR[k] || 'var(--me)') + '"></span>' + esc(k) + '반 ' + esc(subjSel) + ' 월말 — 내 정답률 <b>' + me + '%</b>, 지금까지 이 월말을 본 학생들 누적 평균 ' + ca + '%보다 <b class="' + (d >= 0 ? 'pos' : 'neg') + '">' + Math.abs(d) + '%p ' + (d >= 0 ? '높아요' : '낮아요') + '</b></p>';
    });
    // 그래프: 반이 둘 이상이면 달마다 막대 비교, 하나면 시험별 꺾은선
    if (kinds.length > 1) h += '<div class="card"><h2>' + esc(subjSel) + ' 달마다 비교 <span class="meta">정답률 % · 개념반은 그달 소테스트·월말 평균, 단풀반은 그달 월말</span></h2>' + barChart(rows, kinds) + '</div>';
    else if (kinds[0] === '단풀') h += '<div class="card"><h2>' + esc(subjSel) + ' 월말 테스트 <span class="meta">정답률 %</span></h2>' + barsX(itemsOf(list, null, function (x) { return '월말'; })) + '</div>';
    else h += '<div class="card"><h2>' + esc(subjSel) + ' 점수 추이 <span class="meta">정답률 %</span></h2>' + chartX(itemsOf(list)) + '</div>';
    // 달마다 모아 보기: 개념은 주차별 칩, 단풀은 월말 하나
    h += '<div class="card"><h2>' + esc(subjSel) + ' 달마다 모아 보기</h2><div class="mrows">';
    rows.slice().reverse().forEach(function (r) {
      h += '<div class="mrow"><div class="mm">' + (+r.m.slice(5)) + '월<small>' + r.m.slice(0, 4) + '</small></div><div class="mcols">';
      kinds.forEach(function (k) {
        var l = r.by[k];
        if (!l.length) return;
        h += '<div class="mcol"><div class="mk"><span class="kdot" style="background:' + (KIND_COLOR[k] || 'var(--me)') + '"></span>' + k + '반' +
          (l.length > 1 ? ' <b>' + r.vals[k] + '%</b>' : '') + '</div><div class="mchips">' + l.map(function (x) {
            var p = pct(x.t.score, x.t.total), av = x.t.cum ? x.t.cum.pct : null;
            return '<span class="mchip' + (av !== null ? (p >= av ? ' gpos' : ' gneg') : '') + '" title="' + esc(x.t.label + (av === null ? '' : ' · 누적 평균 ' + av + '%')) + '"><em>' + esc(shortLabel(x.t)) + '</em><b>' + x.t.score + '<small>/' + x.t.total + '</small></b><i>' + p + '%</i></span>';
          }).join('') + '</div></div>';
      });
      h += '</div></div>';
    });
    h += '</div><p class="meta" style="margin-top:10px">초록 테두리는 그 시험 누적 평균 이상, 빨간 테두리는 누적 평균보다 낮은 시험이에요.</p></div>';
    $('#panel').innerHTML = h; bindTips($('#panel'));
  }

  /* 전체: 들은 과목 전부 한눈에 */
  function renderAll() {
    TIPS = [];
    $('#tabs').innerHTML = ''; $('#months').innerHTML = '';
    var tk = allTaken(), hwAll = [], subs = [];
    view.classes.forEach(function (c) { hwAll = hwAll.concat(c.hw); });
    tk.forEach(function (x) { if (subs.indexOf(x.subj) < 0) subs.push(x.subj); });
    var g = gapPct(tk), hd = hwAll.filter(function (w) { return w.done; }).length;
    var h = '<div class="tiles four">' + tile('전체 평균 정답률', avgPct(tk), '%', 'hi', '테스트 ' + tk.length + '개') +
      tile('누적 평균과 비교', g === null ? null : (g > 0 ? '+' : '') + g, '%p', g === null ? '' : g >= 0 ? 'gpos' : 'gneg', gapText(g)) +
      tile('들은 과목', subs.length, '개', '', '') + tile('숙제 제출', hwAll.length ? hd + ' / ' + hwAll.length : null, '', '', '') + '</div>';
    // 달마다 평균 정답률 (모든 과목)
    var months = []; tk.forEach(function (x) { if (months.indexOf(x.t.month) < 0) months.push(x.t.month); });
    var mItems = months.map(function (m) {
      var l = tk.filter(function (x) { return x.t.month === m; }), la = l.filter(function (x) { return x.t.avg !== null; });
      var ca = cumAvg(l);
      return { p: avgPct(l), s: '전체', col: 'var(--me)', lab: l.length + '개', m: m, title: UI.monthLabel(m) + ' 평균 (' + l.length + '개)', av: null, cum: ca === null ? null : { pct: ca } };
    });
    h += '<div class="card"><h2>달마다 평균 정답률 <span class="meta">모든 과목 · 아래 숫자는 그달 본 테스트 수</span></h2>' + chartX(mItems) + '</div>';
    h += '<div class="card"><h2>과목별 한눈에</h2><div class="tw"><table class="stab"><thead><tr><th>과목</th><th>반</th><th class="num">테스트</th><th class="num">평균 정답률</th><th class="num">누적 평균과</th><th>최근</th></tr></thead><tbody>' +
      subs.map(function (s) {
        var l = tk.filter(function (x) { return x.subj === s; }), ks = [], last = l[l.length - 1], gg = gapPct(l);
        l.forEach(function (x) { if (ks.indexOf(x.kind) < 0) ks.push(x.kind); });
        return '<tr class="click" data-go="' + esc(s) + '"><td><b>' + esc(s) + '</b></td><td>' + esc(ks.map(function (k) { return k + '반'; }).join(' · ')) + '</td><td class="num">' + l.length + '</td><td class="num"><b>' + avgPct(l) + '%</b></td><td class="num ' + (gg === null ? '' : gg >= 0 ? 'gpos' : 'gneg') + '">' + (gg === null ? '-' : (gg > 0 ? '+' : '') + gg + '%p') + '</td><td>' + esc((+last.t.month.slice(5)) + '월 ' + shortLabel(last.t) + ' ' + pct(last.t.score, last.t.total) + '%') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="meta" style="margin-top:8px">과목을 누르면 과목별로 자세히 볼 수 있어요.</p></div>';
    $('#panel').innerHTML = h; bindTips($('#panel'));
    UI.all('#panel [data-go]').forEach(function (r) { r.onclick = function () { mode = 'subj'; subjSel = r.getAttribute('data-go'); renderTabs(); }; });
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
  var FRESH_MS = 30 * 60 * 1000;
  function openUpload(hwId) {
    var c = view.classes[cur], w = c.hw.filter(function (x) { return x.id === hwId; })[0];
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
          return Api.call('hwFinish', { code: code, hw: hwId, count: $('#cnt').value }).then(function (r) {
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
          return Api.call('hwPhoto', { code: code, hw: hwId, order: start + sent, mime: 'image/jpeg', b64: x.b64, hash: x.hash });
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
  $('#out').onclick = function () { UI.store.del('seiseki.code'); view = null; code = ''; cur = 0; month = ''; $('#app').hidden = true; $('#acts').hidden = true; $('#login').hidden = false; $('#sid').value = ''; };
  $('#refresh').onclick = function () { if (code) login(code); };

  var saved = UI.store.get('seiseki.code');
  if (saved) { $('#remember').checked = true; $('#sid').value = Core.fmtCode(saved); login(saved); }
})();
