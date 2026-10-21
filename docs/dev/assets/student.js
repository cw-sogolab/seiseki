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

  function show(data) {
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
  function shortLabel(t) { var s = String(t.label).replace(/^(경제|정치|지리|현사|현대사회|세계사|역사|일본사)\s*/, '').replace(/^EJU\s*/, ''); return s.length > 7 ? s.slice(0, 7) : s; }
  /** 점수가 들어간 시험 전부 (반 정보 붙여서) */
  function allTaken() {
    var out = [];
    view.classes.forEach(function (c) { c.tests.forEach(function (t) { if (t.score !== null) out.push({ c: c, t: t, kind: kindOf(c), subj: subjOfT(c, t) }); }); });
    return out.sort(order);
  }
  function avgPct(list) { return list.length ? Math.round(list.reduce(function (s, x) { return s + x.t.score / x.t.total; }, 0) / list.length * 100) : null; }
  /** 반 평균보다 몇 %p 위/아래인지 (반 평균이 있는 시험만) */
  function gapPct(list) {
    var xs = list.filter(function (x) { return x.t.avg !== null && x.t.total; });
    if (!xs.length) return null;
    return Math.round(xs.reduce(function (s, x) { return s + (x.t.score - x.t.avg) / x.t.total; }, 0) / xs.length * 100);
  }
  function tile(label, val, unit, cls, note) {
    return '<div class="tile' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + (val === null || val === undefined ? '-' : val + (unit ? '<small>' + unit + '</small>' : '')) + '</b>' + (note ? '<em>' + note + '</em>' : '') + '</div>';
  }
  function gapText(g) { return g === null ? '' : (g > 0 ? '반 평균보다 ' + g + '%p 높아요' : g < 0 ? '반 평균보다 ' + (-g) + '%p 낮아요' : '반 평균과 같아요'); }

  /** 정답률 그래프. items: [{p, a, s, lab, m}] (p 내 정답률, a 반 평균 정답률, s 계열 이름, lab 아래 글자, m 달)
   *  계열이 하나면 반 평균 점선도 같이, 여럿이면 계열(개념·단풀 등)마다 색을 달리 */
  function chartX(items, colors, half) {
    if (!items.length) return '<p class="empty">아직 입력된 점수가 없어요.</p>';
    var series = []; items.forEach(function (it) { if (series.indexOf(it.s) < 0) series.push(it.s); });
    var single = series.length === 1, n = items.length;
    // 화면에 실제로 그려질 폭에 맞춰 그림 크기를 정함 (글자가 너무 커지거나 작아지지 않게)
    var pw = ($('#panel') && $('#panel').clientWidth) || window.innerWidth - 32, pad = window.innerWidth <= 480 ? 36 : 44;
    var box = Math.max(260, Math.round((half && window.innerWidth > 860 ? (pw - 14) * 1.35 / 2.35 : pw) - pad));
    var fs = window.innerWidth > 860 ? 12 : 10;
    var W = Math.max(box, n * 46), H = fs === 12 ? 230 : 190, L = 34, R = 16, T = 14, B = fs * 4;
    function x(i) { return n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1); }
    function y(p) { return T + (100 - p) * (H - T - B) / 100; }
    var s = '<div class="chartwrap"><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" style="min-width:' + Math.min(W, n * 40) + 'px" role="img" aria-label="시험별 정답률">';
    [0, 50, 100].forEach(function (g) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="var(--line)"/>';
      s += '<text x="' + (L - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end" font-size="' + fs + '" fill="var(--muted)">' + g + '</text>';
    });
    items.forEach(function (it, i) {
      s += '<text x="' + x(i) + '" y="' + (H - fs * 2.2) + '" text-anchor="middle" font-size="' + fs + '" fill="var(--muted)">' + esc(it.lab) + '</text>';
      if (it.m && (i === 0 || items[i - 1].m !== it.m)) s += '<text x="' + x(i) + '" y="' + (H - fs * 0.6) + '" text-anchor="middle" font-size="' + fs + '" font-weight="700" fill="var(--ink2)">' + (+it.m.slice(5)) + '월</text>';
    });
    if (single) {
      var av = items.map(function (it, i) { return it.a === null ? null : x(i) + ',' + y(it.a); });
      if (n > 1 && av.every(Boolean)) s += '<polyline points="' + av.join(' ') + '" fill="none" stroke="var(--avg)" stroke-width="2" stroke-dasharray="5 4"/>';
      items.forEach(function (it, i) { if (it.a !== null) s += '<circle cx="' + x(i) + '" cy="' + y(it.a) + '" r="3" fill="var(--avg)"/>'; });
    }
    series.forEach(function (key, si) {
      var col = (colors && colors[key]) || (single ? 'var(--me)' : ['var(--me)', 'var(--orange)', 'var(--green)', 'var(--red)'][si % 4]);
      var pts = []; items.forEach(function (it, i) { if (it.s === key) pts.push([x(i), y(it.p), it]); });
      if (pts.length > 1) s += '<polyline points="' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ') + '" fill="none" stroke="' + col + '" stroke-width="2.5"/>';
      pts.forEach(function (p) { s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4.5" fill="' + col + '"><title>' + esc(p[2].title || '') + ' ' + p[2].p + '%</title></circle>'; });
    });
    s += '</svg></div><div class="legend">';
    series.forEach(function (key, si) {
      var col = (colors && colors[key]) || (single ? 'var(--me)' : ['var(--me)', 'var(--orange)', 'var(--green)', 'var(--red)'][si % 4]);
      s += '<span><i style="border-top-color:' + col + '"></i>' + esc(single ? '내 정답률' : key) + '</span>';
    });
    if (single) s += '<span><i class="a"></i>반 평균</span>';
    return s + '</div>';
  }
  function itemsOf(list, seriesFn) {
    return list.map(function (x) { return { p: pct(x.t.score, x.t.total), a: x.t.avg === null ? null : pct(x.t.avg, x.t.total), s: seriesFn ? seriesFn(x) : '나', lab: shortLabel(x.t), m: x.t.month, title: x.t.label }; });
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
    h += '<p class="meta">' + [UI.dateLabel(t.date), t.score !== null ? '정답률 ' + pct(t.score, t.total) + '%' : '', t.avg !== null ? '반 평균 ' + t.avg.toFixed(1) : '',
      t.conv !== null ? '환산점수 ' + t.conv + (t.convAvg !== null ? ' (반 평균 ' + Math.round(t.convAvg) + ')' : '') : ''].filter(Boolean).map(esc).join(' · ') + '</p>';
    if (t.score !== null) {
      if (t.wrongDetail) h += '<div class="chips"><span class="lbl">틀린 문항</span>' + t.wrongDetail.map(function (w) { return '<span class="chip">' + w.n + '번 정답 ' + w.key + ' · 내 답 ' + (w.ans === '0' ? '-' : w.ans) + '</span>'; }).join('') + '</div>';
      else if (t.wrong.length) h += '<div class="chips"><span class="lbl">틀린 문항</span>' + t.wrong.map(function (n) { return '<span class="chip">' + n + '번</span>'; }).join('') + '</div>';
      else if (t.score === t.total) h += '<div class="chips"><span class="pill ok">전부 맞았어요</span></div>';
      // 학원 파일에서 옮겨 온 지난 성적은 점수만 있고 틀린 번호 기록이 없음 → 아무것도 안 붙임
    }
    return h + '</div>';
  }

  /* 월별: 한 반의 한 달 */
  function renderPanel() {
    var c = view.classes[cur];
    var tests = c.tests.filter(function (t) { return !month || t.month === month; }).map(function (t) { return { c: c, t: t }; }).sort(order).map(function (x) { return x.t; });
    var hws = c.hw.filter(function (h) { return !month || h.month === month; });
    var taken = tests.filter(function (t) { return t.score !== null; }).map(function (t) { return { t: t }; });
    var done = hws.filter(function (h) { return h.done; }).length, gap = gapPct(taken), mm = month ? (+month.slice(5)) + '월 ' : '';
    var h = '<div class="tiles four">' +
      tile(mm + '평균 정답률', avgPct(taken), '%', 'hi', taken.length ? '테스트 ' + taken.length + '개의 평균' : '') +
      tile('반 평균과 비교', gap === null ? null : (gap > 0 ? '+' : '') + gap, '%p', gap === null ? '' : gap >= 0 ? 'up' : 'down', gap === null ? '' : gapText(gap)) +
      tile(mm + '본 테스트', taken.length + ' / ' + tests.length, '', '', '') +
      tile('숙제 제출', hws.length ? done + ' / ' + hws.length : null, '', '', '') + '</div>';
    var all = c.tests.filter(function (t) { return t.score !== null; }).map(function (t) { return { c: c, t: t }; }).sort(order);
    h += '<div class="sgrid"><div class="col1">';
    h += '<div class="card"><h2>점수 추이 <span class="meta">' + esc(kindOf(c) === '실전' ? '실전반' : (subjIn(c, month) || '')) + ' 전체 기간 · 정답률 %</span></h2>' + chartX(itemsOf(all), null, true) + '</div>';
    h += '<div class="card"><h2>' + esc(mm) + '테스트 결과</h2>';
    if (!tests.length) h += '<p class="empty">이 달에 등록된 테스트가 없어요.</p>';
    tests.forEach(function (t) { h += testItem(t); });
    h += '</div></div><div class="col2"><div class="card"><h2>' + esc(mm) + '숙제</h2>';
    if (!hws.length) h += '<p class="empty">이 달에 온라인으로 낼 숙제가 없어요.</p>';
    hws.forEach(function (w) {
      var detail = [w.book ? esc(w.book) : '', w.p0 ? 'p.' + w.p0 + '~' + w.p1 : '', w.total ? w.total + '문' : ''].filter(Boolean).join(' · ');
      if (w.done) detail += (detail ? ' · ' : '') + (w.photos ? '사진 ' + w.photos + '장' : '선생님 입력') + (w.count !== null ? ' · 맞은 개수 ' + w.count : '');
      h += '<div class="item"><div class="row"><div><b>' + esc(w.label) + '</b><p class="meta">' + detail + '</p></div>' +
        (w.done ? '<span class="pill ' + (w.checked ? 'ok">선생님 확인' : 'ok">제출 완료') + '</span>' : '<button class="btn sm" type="button" data-hw="' + esc(w.id) + '">제출하기</button>') + '</div>' +
        (w.done ? '<button class="linkbtn" type="button" data-hw="' + esc(w.id) + '">사진 더 올리기</button>' : '') +
        '<div class="upbox" data-box="' + esc(w.id) + '"></div></div>';
    });
    h += '</div></div></div>';
    $('#panel').innerHTML = h;
    UI.all('#panel [data-hw]').forEach(function (b) { b.onclick = function () { openUpload(b.getAttribute('data-hw')); }; });
  }

  /* 과목별: 개념·단풀에서 같은 과목을 나란히 */
  function renderSubj() {
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
    var kinds = []; list.forEach(function (x) { if (kinds.indexOf(x.kind) < 0) kinds.push(x.kind); });
    var h = '<div class="tiles four">';
    kinds.forEach(function (k) {
      var lk = list.filter(function (x) { return x.kind === k; }), g = gapPct(lk);
      h += tile(k + '반 평균 정답률', avgPct(lk), '%', 'hi k-' + k, '테스트 ' + lk.length + '개' + (g === null ? '' : ' · ' + gapText(g)));
    });
    if (kinds.length === 1) h += tile('본 테스트', list.length, '개', '', '') + tile('반 평균과 비교', gapPct(list) === null ? null : (gapPct(list) > 0 ? '+' : '') + gapPct(list), '%p', '', gapText(gapPct(list)));
    h += '</div>';
    if (kinds.length > 1) {
      var a = avgPct(list.filter(function (x) { return x.kind === kinds[0]; })), b2 = avgPct(list.filter(function (x) { return x.kind === kinds[1]; }));
      h += '<p class="cmp">' + esc(subjSel) + ' — ' + esc(kinds[1]) + '반 정답률이 ' + esc(kinds[0]) + '반보다 <b>' + Math.abs(b2 - a) + '%p ' + (b2 >= a ? '높아요' : '낮아요') + '</b></p>';
    }
    h += '<div class="card"><h2>' + esc(subjSel) + ' 점수 추이 <span class="meta">정답률 %' + (kinds.length > 1 ? ' · 반별 색' : '') + '</span></h2>' + chartX(itemsOf(list, function (x) { return x.kind + '반'; }), { '개념반': KIND_COLOR['개념'], '단풀반': KIND_COLOR['단풀'], '실전반': KIND_COLOR['실전'] }) + '</div>';
    h += '<div class="card"><h2>' + esc(subjSel) + ' 테스트 모아 보기</h2><div class="tw"><table class="stab"><thead><tr><th>달</th><th>반</th><th>테스트</th><th class="num">점수</th><th class="num">정답률</th><th class="num">반 평균</th></tr></thead><tbody>' +
      list.slice().reverse().map(function (x) {
        return '<tr><td>' + (+x.t.month.slice(5)) + '월</td><td><span class="kdot" style="background:' + (KIND_COLOR[x.kind] || 'var(--me)') + '"></span>' + esc(x.kind) + '반</td><td>' + esc(x.t.label) + '</td><td class="num"><b>' + x.t.score + '</b>/' + x.t.total + '</td><td class="num">' + pct(x.t.score, x.t.total) + '%</td><td class="num">' + (x.t.avg === null ? '-' : pct(x.t.avg, x.t.total) + '%') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    $('#panel').innerHTML = h;
  }

  /* 전체: 들은 과목 전부 한눈에 */
  function renderAll() {
    $('#tabs').innerHTML = ''; $('#months').innerHTML = '';
    var tk = allTaken(), hwAll = [], subs = [];
    view.classes.forEach(function (c) { hwAll = hwAll.concat(c.hw); });
    tk.forEach(function (x) { if (subs.indexOf(x.subj) < 0) subs.push(x.subj); });
    var g = gapPct(tk), hd = hwAll.filter(function (w) { return w.done; }).length;
    var h = '<div class="tiles four">' + tile('전체 평균 정답률', avgPct(tk), '%', 'hi', '테스트 ' + tk.length + '개') +
      tile('반 평균과 비교', g === null ? null : (g > 0 ? '+' : '') + g, '%p', g === null ? '' : g >= 0 ? 'up' : 'down', gapText(g)) +
      tile('들은 과목', subs.length, '개', '', '') + tile('숙제 제출', hwAll.length ? hd + ' / ' + hwAll.length : null, '', '', '') + '</div>';
    // 달마다 평균 정답률 (모든 과목)
    var months = []; tk.forEach(function (x) { if (months.indexOf(x.t.month) < 0) months.push(x.t.month); });
    var mItems = months.map(function (m) {
      var l = tk.filter(function (x) { return x.t.month === m; }), la = l.filter(function (x) { return x.t.avg !== null; });
      return { p: avgPct(l), a: la.length === l.length ? Math.round(la.reduce(function (s, x) { return s + x.t.avg / x.t.total; }, 0) / la.length * 100) : null, s: '나', lab: l.length + '개', m: m, title: UI.monthLabel(m) };
    });
    h += '<div class="card"><h2>달마다 평균 정답률 <span class="meta">모든 과목 · 아래 숫자는 그달 본 테스트 수</span></h2>' + chartX(mItems) + '</div>';
    h += '<div class="card"><h2>과목별 한눈에</h2><div class="tw"><table class="stab"><thead><tr><th>과목</th><th>반</th><th class="num">테스트</th><th class="num">평균 정답률</th><th class="num">반 평균과</th><th>최근</th></tr></thead><tbody>' +
      subs.map(function (s) {
        var l = tk.filter(function (x) { return x.subj === s; }), ks = [], last = l[l.length - 1], gg = gapPct(l);
        l.forEach(function (x) { if (ks.indexOf(x.kind) < 0) ks.push(x.kind); });
        return '<tr class="click" data-go="' + esc(s) + '"><td><b>' + esc(s) + '</b></td><td>' + esc(ks.map(function (k) { return k + '반'; }).join(' · ')) + '</td><td class="num">' + l.length + '</td><td class="num"><b>' + avgPct(l) + '%</b></td><td class="num ' + (gg === null ? '' : gg >= 0 ? 'up' : 'down') + '">' + (gg === null ? '-' : (gg > 0 ? '+' : '') + gg + '%p') + '</td><td>' + esc((+last.t.month.slice(5)) + '월 ' + shortLabel(last.t) + ' ' + pct(last.t.score, last.t.total) + '%') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="meta" style="margin-top:8px">과목을 누르면 과목별로 자세히 볼 수 있어요.</p></div>';
    $('#panel').innerHTML = h;
    UI.all('#panel [data-go]').forEach(function (r) { r.onclick = function () { mode = 'subj'; subjSel = r.getAttribute('data-go'); renderTabs(); }; });
  }

  function compress(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        res(cv.toDataURL('image/jpeg', 0.82).split(',')[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('사진을 읽지 못했어요: ' + file.name)); };
      img.src = url;
    });
  }

  function openUpload(hwId) {
    var c = view.classes[cur], w = c.hw.filter(function (x) { return x.id === hwId; })[0];
    UI.all('#panel .upbox').forEach(function (b) { b.innerHTML = ''; });
    var box = $('#panel [data-box="' + hwId + '"]');
    box.innerHTML = '<div class="up"><label for="ph">문제집 쪽 사진 (한 쪽에 한 장씩, 문항 번호가 보이게)</label>' +
      '<input id="ph" type="file" accept="image/*" multiple><div id="th" class="thumbs"></div>' +
      '<label for="cnt">채점해 본 맞은 개수' + (w.total ? ' (' + w.total + '문 중)' : '') + '</label><input id="cnt" type="number" inputmode="numeric" min="0"' + (w.total ? ' max="' + w.total + '"' : '') + '>' +
      '<button id="send" class="btn block" type="button">제출하기</button><div class="bar" hidden><i></i></div><p id="upMsg" class="msg" role="status"></p></div>';
    var files = [];
    $('#ph').onchange = function (e) {
      files = Array.prototype.slice.call(e.target.files);
      $('#th').innerHTML = '';
      files.forEach(function (f) { var im = document.createElement('img'); im.alt = '고른 사진'; im.src = URL.createObjectURL(f); $('#th').appendChild(im); });
    };
    $('#send').onclick = function () {
      var msg = $('#upMsg'), btn = $('#send'), bar = box.querySelector('.bar'), fill = bar.querySelector('i');
      if (!files.length) { msg.className = 'msg err'; msg.textContent = '사진을 골라 주세요.'; return; }
      if ($('#cnt').value === '' && !w.done) { msg.className = 'msg err'; msg.textContent = '맞은 개수를 적어 주세요.'; return; }
      setBusy(btn, true, '올리는 중…'); bar.hidden = false; msg.className = 'msg'; msg.textContent = '';
      var start = (w.photos || 0) + 1, i = 0, warns = [];
      function next() {
        if (i >= files.length) {
          return Api.call('hwFinish', { code: code, hw: hwId, count: $('#cnt').value }).then(function (r) {
            setBusy(btn, false, '제출하기');
            if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error; return; }
            show(r.data);
            if (warns.length) {   // AI 사진 확인에서 걸린 것: 제출은 됐고, 다시 찍어 올리라고 안내
              var b2 = $('#panel [data-box="' + hwId + '"]');
              if (b2) b2.innerHTML = '<div class="warnbox" role="alert"><b>사진을 다시 확인해 주세요</b><ul>' +
                warns.map(function (x) { return '<li>' + x.n + '번째 사진: ' + UI.esc(x.msg) + '</li>'; }).join('') +
                '</ul><p>제출은 됐어요. 고쳐서 다시 찍은 사진을 「사진 더 올리기」로 올려 주세요. 선생님도 확인할 거예요.</p></div>';
            }
          });
        }
        msg.textContent = (i + 1) + ' / ' + files.length + '장 올리는 중';
        return compress(files[i]).then(function (b64) {
          return Api.call('hwPhoto', { code: code, hw: hwId, order: start + i, mime: 'image/jpeg', b64: b64 });
        }).then(function (r) {
          if (!r.ok) throw new Error(r.error);
          if (r.data && r.data.check && !r.data.check.ok) warns.push({ n: i + 1, msg: r.data.check.msg });
          i++; fill.style.width = Math.round(i / files.length * 100) + '%';
          return next();
        });
      }
      next().catch(function (e) {
        setBusy(btn, false, '다시 제출하기');
        msg.className = 'msg err';
        msg.textContent = (e.message || '올리지 못했어요.') + ' ' + i + '장까지는 저장됐어요. 나머지를 다시 골라 제출해 주세요.';
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
