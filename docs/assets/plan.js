/* 월초 강의계획서 — 반마다 시트 하나, 학원 워드 양식(26MM과목개념.docx 등) 그대로.
 * 수업 내용·교재 범위는 기록장 「계획서」 탭(1~10월에 선생님이 쓴 계획서를 옮겨 둔 것)에서,
 * 날짜는 「달력」 탭 + 「반」 탭 요일시간에서 (Core.lessons — 숙제 마감과 같은 계산).
 *
 * Plan.build(spec) → { sheet, title, subtitle, head, rows, from, warn }   (화면 미리보기·엑셀 공통, 저장은 안 함)
 *   spec = { ym, kind: '개념'|'단풀'|'실전', subj, ban, time, cal, bank: { rows, heads } }
 * Plan.xlsx(ExcelJS, plans, images) → Workbook      images = { head: ArrayBuffer, foot: ArrayBuffer } (없으면 그림 없이)
 */
var Plan = (function () {
  var C = (typeof Core !== 'undefined') ? Core : require('./core.js');
  var SUBJ_NAME = { '현사': '현대사회', '역사': '세계사' };
  var MAX_ROWS = 13;   // 워드 표는 늘 01~13 줄
  var MOCK = '모의고사 1회 실시 및 해설', FINAL = '월말테스트', HW = '주간 숙제';

  function S(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function dateLabel(d) { return (+d.slice(5, 7)) + '월' + (+d.slice(8, 10)) + '일'; }
  function pagesOf(r) { var m = /p\.?\s*(\d+)\s*[-~]\s*(\d+)/.exec(S(r)); return m ? +m[2] - +m[1] + 1 : 0; }
  function splitLines(s) { return S(s).split(/\n|\s*\/\s*(?=\d+강)/).map(S).filter(Boolean); }

  /** 계획서 날짜 「10월3일」·「1월 31일」 → 'YYYY-MM-DD' (계획서 달 기준, 해를 넘긴 것도) */
  function parseDate(label, ym) {
    var m = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(S(label)); if (!m) return '';
    var y = +ym.slice(0, 4), pm = +ym.slice(5), mm = +m[1];
    if (mm - pm > 6) y--; else if (pm - mm > 6) y++;
    return y + '-' + ('0' + mm).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  }
  /** 지난달 계획서가 이번 달 수업까지 잡아 둔 날 (예: 10월 실전D 계획서의 11/1). 실전은 같은 D·E,
   *  개념·단풀은 과목이 달마다 바뀌니 같은 반 종류에 수업 요일이 같은 계획서로 봄 */
  function carriedUntil(bank, ym, kind, ban, days) {
    var prev = ym.slice(0, 4) + '-' + ('0' + (+ym.slice(5) - 1)).slice(-2);
    if (+ym.slice(5) === 1) prev = (+ym.slice(0, 4) - 1) + '-12';
    var g = {}, best = '';
    (bank.rows || []).forEach(function (r) {
      if (S(r['월']) !== prev || S(r['반종류']) !== kind || (kind === '실전' && S(r['반']) !== ban)) return;
      var k = S(r['과목']) + '|' + S(r['반']), d = parseDate(r['날짜'], prev);
      if (d) (g[k] = g[k] || []).push(d);
    });
    Object.keys(g).forEach(function (k) {
      var ds = g[k], wd = {}; ds.forEach(function (d) { wd[new Date(d + 'T00:00:00Z').getUTCDay()] = 1; });
      var same = kind === '실전' || (Object.keys(wd).length === days.length && days.every(function (x) { return wd[x]; }));
      var last = ds.sort().pop();
      if (same && last.slice(0, 7) === ym && last > best) best = last;
    });
    return best;
  }
  /** 같은 반 종류·과목의 지난 계획서들 (달마다 묶음, 회차 순) */
  function groups(bank, kind, subj, ban) {
    var g = {};
    (bank.rows || []).forEach(function (r) {
      if (S(r['반종류']) !== kind) return;
      if (kind === '실전' ? false : S(r['과목']) !== subj) return;
      var key = S(r['월']) + '|' + S(r['반']);
      (g[key] = g[key] || { m: S(r['월']), ban: S(r['반']), rows: [] }).rows.push(r);
    });
    return Object.keys(g).map(function (k) {
      var x = g[k]; x.rows.sort(function (a, b) { return +S(a['회차']) - +S(b['회차']); });
      x.sameBan = kind !== '실전' || x.ban === ban; return x;
    });
  }
  function headFor(bank, kind, subj, ban) {
    var hs = (bank.heads || []).filter(function (h) { return S(h['반종류']) === kind; });
    var exact = hs.filter(function (h) { return kind === '실전' ? S(h['반']) === ban : S(h['과목']) === subj; });
    var pick = (exact.length ? exact : hs).slice().sort(function (a, b) { return S(b['월']).localeCompare(S(a['월'])); })[0];
    if (!pick) return null;
    var h = {}; Object.keys(pick).forEach(function (k) { h[k] = S(pick[k]); });
    if (!exact.length) {   // 다른 과목 머리를 빌려 온 것: 과목 이름만 바꿈
      var from = SUBJ_NAME[h['과목']] || h['과목'], to = kind === '실전' ? '' : (SUBJ_NAME[subj] || subj);
      ['부제', '강의명', '강의목표'].forEach(function (k) { if (from && to) h[k] = h[k].split(from).join(to); if (kind === '실전') h[k] = h[k].replace(/[DE](\s*>?)$/, ban + '$1'); });
      h._borrowed = true;
    }
    return h;
  }
  function merge(a, b) {
    var ra = S(a.range), rb = S(b.range), ma = /^p\.(\d+)-(\d+)$/.exec(ra), mb = /^p\.(\d+)-(\d+)$/.exec(rb);
    var range = ma && mb && +mb[1] >= +ma[2] ? 'p.' + ma[1] + '-' + mb[2] : [ra, rb].filter(Boolean).join('\n');
    return { content: [a.content, b.content].filter(Boolean).join('\n'), range: range };
  }
  /** 내용 줄 수를 n 개로 맞춤: 많으면 쪽수가 가장 적은 이웃 둘을 합치고, 적으면 두 강이 한 줄에 있는 것을 나눔 */
  function fit(items, n, warn) {
    items = items.slice();
    while (items.length > n && items.length > 1) {
      var best = 0, bv = Infinity;
      for (var i = 0; i < items.length - 1; i++) { var v = pagesOf(items[i].range) + pagesOf(items[i + 1].range) || (items[i].content.length + items[i + 1].content.length); if (v < bv) { bv = v; best = i; } }
      items.splice(best, 2, merge(items[best], items[best + 1]));
    }
    var guard = 0;
    while (items.length < n && guard++ < 50) {
      var j = -1, most = 1;
      items.forEach(function (it, k) { var l = splitLines(it.content).length; if (l > most) { most = l; j = k; } });
      if (j < 0) break;
      var ls = splitLines(items[j].content), rs = splitLines(items[j].range), h = Math.ceil(ls.length / 2);
      var r1 = rs.length === ls.length ? rs.slice(0, h).join('\n') : items[j].range, r2 = rs.length === ls.length ? rs.slice(h).join('\n') : items[j].range;
      items.splice(j, 1, { content: ls.slice(0, h).join('\n'), range: r1 }, { content: ls.slice(h).join('\n'), range: r2 });
    }
    if (items.length < n) { warn.push('지난 계획서보다 수업이 ' + (n - items.length) + '번 많아서 「총정리」 줄을 넣었어요. 내용을 확인해 주세요.'); while (items.length < n) items.push({ content: '총정리', range: '' }); }
    return items;
  }

  function build(spec) {
    var warn = [], kind = spec.kind, subj = kind === '실전' ? '실전' : spec.subj, ban = S(spec.ban);
    var y = spec.ym.slice(0, 4), m = +spec.ym.slice(5);
    var cd = C.classDays(spec.time), dates = C.lessons(spec.ym, cd.days, spec.cal || {});
    var carried = carriedUntil(spec.bank || {}, spec.ym, kind, ban, cd.days);
    if (carried && dates.length && dates[0] <= carried) {
      var cut = dates.filter(function (d) { return d <= carried; });
      dates = dates.filter(function (d) { return d > carried; });
      warn.push('지난달 계획서에 ' + cut.map(dateLabel).join('·') + ' 수업이 이미 들어 있어서 그 다음 수업부터 잡았어요.');
    }
    if (!cd.days.length) warn.push('「반」 탭 요일시간에서 수업 요일을 못 읽었어요.');
    if (spec.cal && !spec.cal[spec.ym]) warn.push('「달력」 탭에 ' + m + '월이 없어서 1일~말일로 계산했어요.');
    var n = dates.length, rows = [], from = '';
    if (kind === '실전') {
      rows = dates.map(function () { return { content: MOCK, range: '', hw: '' }; });
      var gs0 = groups(spec.bank || {}, kind, subj, ban); if (gs0.length) from = gs0.sort(function (a, b) { return b.m.localeCompare(a.m); })[0].m;
    } else {
      var gs = groups(spec.bank || {}, kind, subj, ban);
      // 같은 수업 수의 가장 최근 계획서 → 없으면 가장 최근 계획서를 맞춰서
      gs.sort(function (a, b) { return ((b.rows.length === n) - (a.rows.length === n)) || b.m.localeCompare(a.m); });
      var g = gs[0];
      if (!g) warn.push('「계획서」 탭에 ' + kind + ' ' + subj + ' 지난 계획서가 없어서 내용을 비워 뒀어요.');
      else from = g.m;
      var content = g ? g.rows.filter(function (r) { return S(r['내용']) !== FINAL; }).map(function (r) { return { content: S(r['내용']), range: S(r['범위']) }; }) : [];
      var need = Math.max(n - 1, 0);
      if (g && g.rows.length !== n) warn.push(g.m.slice(5).replace(/^0/, '') + '월 계획서는 수업이 ' + g.rows.length + '번, 이번 달은 ' + n + '번이라 줄을 맞췄어요. 내용을 확인해 주세요.');
      content = g ? fit(content, need, warn) : dates.slice(1).map(function () { return { content: '', range: '' }; });
      rows = content.slice(0, need).map(function (x) { return { content: x.content, range: x.range, hw: '' }; });
      if (n) rows.push({ content: FINAL, range: '', hw: '' });
      if (kind === '개념') rows.forEach(function (r, i) { if (i % 2 === 1 && r.content !== FINAL) r.hw = HW; });   // 2번 수업마다 숙제 (숙제 마감 계산과 같은 규칙). 월말테스트 날은 숙제 없음
    }
    rows.forEach(function (r, i) { r.no = ('0' + (i + 1)).slice(-2); r.date = dates[i] ? dateLabel(dates[i]) : ''; });
    if (n > MAX_ROWS) warn.push('수업이 ' + n + '번이라 표 줄을 ' + n + '줄로 늘렸어요.');
    var head = headFor(spec.bank || {}, kind, subj, ban) || {};
    if (head._borrowed) warn.push('「계획서머리」 탭에 이 과목 머리말이 없어서 다른 과목 것을 빌려 왔어요. 강의목표를 확인해 주세요.');
    var subName = SUBJ_NAME[subj] || subj;
    var subtitle = head['부제'] || (kind === '실전' ? '<실전 문제풀이' + ban + '>' : kind === '개념' ? '< 종과개념 개념- ' + subName + ' >' : '< 종합과목 문제풀이(단원별-' + subName + ') >');
    var sheet = String(y).slice(2) + ('0' + m).slice(-2) + (kind === '실전' ? '실전문제풀이' + ban : subj + kind);
    return { sheet: sheet, title: y + '년' + m + '월강의계획', subtitle: subtitle, head: head, rows: rows, from: from, warn: warn, kind: kind, subj: subj, ban: ban };
  }

  /* ---------- 엑셀 (워드 양식 그대로) ----------
   * 워드 표 칸 너비(twip) 569·1052·497·2351·358·1134·84·792·859·1370 → 엑셀 A~J 열.
   * 위 8줄(연분홍 FDE9D9, 안쪽 줄 없음) · 「강 의 세 부 일 정」(FBD4B4) · 머리글(FABF8F) · 01~13 줄. 바깥 테두리 가는 검정. */
  var TW = [569, 1052, 497, 2351, 358, 1134, 84, 792, 859, 1370];
  var F_LABEL = '한컴 윤고딕 230', F_TITLE = 'HY울릉도B', F_HEAD = 'HY울릉도M', F_BODY = 'HY그래픽';
  function fill(argb) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + argb } }; }
  var THIN = { style: 'thin', color: { argb: 'FF000000' } };
  function cellsOf(ws, r, c1, c2) { var out = []; for (var c = c1; c <= c2; c++) out.push(ws.getCell(r, c)); return out; }
  function box(ws, r1, r2, c1, c2, inner) {
    for (var r = r1; r <= r2; r++) for (var c = c1; c <= c2; c++) {
      var b = {};
      if (inner || r === r1) b.top = THIN; if (inner || r === r2) b.bottom = THIN;
      if (inner || c === c1) b.left = THIN; if (inner || c === c2) b.right = THIN;
      ws.getCell(r, c).border = b;
    }
  }
  function put(ws, r, c1, c2, v, o) {
    if (c2 > c1) ws.mergeCells(r, c1, r, c2);
    var cell = ws.getCell(r, c1);
    cell.value = v === undefined || v === null ? '' : v;
    cell.font = { name: o.font, size: o.size, color: { argb: 'FF000000' } };
    cell.alignment = { horizontal: o.h || 'left', vertical: o.v || 'middle', wrapText: true };
    if (o.fill) cellsOf(ws, r, c1, c2).forEach(function (x) { x.fill = o.fill; });
    return cell;
  }
  /** 줄 높이: 워드는 글이 길면 줄이 늘어나니 엑셀도 글 줄 수만큼 (9pt 한 줄 ≈ 12pt) */
  function linesIn(text, perLine) { return S(text).split('\n').reduce(function (s, l) { return s + Math.max(1, Math.ceil(l.length / perLine)); }, 0); }

  function sheet(wb, p, img) {
    var ws = wb.addWorksheet(p.sheet.slice(0, 31), {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
        margins: { left: 1, right: 1, top: 851 / 1440, bottom: 992 / 1440, header: 0.3, footer: 0.3 } },   // 워드 머리글·바닥글 그림까지 본문에 넣으니 여백 = 머리글·바닥글 거리
      views: [{ showGridLines: false }]
    });
    ws.columns = TW.map(function (tw) { return { width: Math.max(0.6, Math.round(((tw / 15) - 5) / 7 * 100) / 100) }; });
    var LIGHT = fill('FDE9D9'), r = 1;
    // 머리 그림 자리 (워드 머리글의 학원 로고 1.95"×0.52"): 제목은 워드처럼 위에서 1701twip(=머리글 851 + 42.5pt)에서 시작
    ws.getRow(1).height = 37; ws.getRow(2).height = 5.5;
    if (img) ws.addImage(img.head, { tl: { col: 0, row: 0.1 }, ext: { width: 187, height: 50 } });
    r = 3;
    put(ws, r, 1, 10, p.title, { font: F_TITLE, size: 23, h: 'center' }); ws.getRow(r).height = 36; r++;
    put(ws, r, 1, 10, p.subtitle, { font: F_TITLE, size: 23, h: 'center' }); ws.getRow(r).height = 36; r++;
    var h = p.head, top = r;
    function lab(row, c1, c2, t) { put(ws, row, c1, c2, t, { font: F_LABEL, size: 11, h: 'right', v: 'top', fill: LIGHT }); }
    function val(row, c1, c2, t, hh) { put(ws, row, c1, c2, t, { font: F_LABEL, size: 10, h: hh || 'left', v: 'top', fill: LIGHT }); }
    var info = [
      [17.25, function (x) { lab(x, 1, 2, '● 강 의 명 : '); val(x, 3, 10, h['강의명']); }],
      [17.25, function (x) { lab(x, 1, 2, '● 강의목표 :'); val(x, 3, 10, h['강의목표']); }],
      [17.25, function (x) { lab(x, 1, 2, '● 담당강사 : '); val(x, 3, 4, h['담당강사']); val(x, 5, 6, '[연락처/톡ID]', 'right'); val(x, 7, 10, h['연락처']); }],
      [17.25, function (x) { lab(x, 1, 2, '● 강의기간 : '); val(x, 3, 5, h['강의기간']); lab(x, 6, 8, '● 강의시간 : '); val(x, 9, 10, h['강의시간']); }],
      [17.25, function (x) { lab(x, 1, 2, '● 강 의 실 : '); val(x, 3, 10, h['강의실']); }],
      [33.3, function (x) { lab(x, 1, 2, '● 교    재 : '); val(x, 3, 10, h['교재']); }],
      [17.8, function (x) { lab(x, 1, 2, '● 질문시간 : '); val(x, 3, 5, h['질문시간']); lab(x, 6, 8, '● 질문방법 :'); val(x, 9, 10, h['질문방법']); }],
      [36, function (x) { lab(x, 1, 2, '● 평가방법 : '); val(x, 3, 10, h['평가방법']); }]
    ];
    var LONG = ['강의명', '강의목표', '', '', '강의실', '교재', '', '평가방법'];   // 길면 줄이 늘어나는 칸 (값 칸 너비 ≈ 한 줄 45자)
    info.forEach(function (it, i) {
      it[1](r);
      var ln = Math.max(LONG[i] ? linesIn(h[LONG[i]], 45) : 1, i === 3 ? linesIn(h['강의시간'], 14) : 1, i === 6 ? linesIn(h['질문방법'], 14) : 1, i === 2 ? linesIn(h['연락처'], 28) : 1);
      ws.getRow(r).height = Math.max(it[0], ln * 13.5 + 4); r++;
    });
    box(ws, top, r - 1, 1, 10, false);
    put(ws, r, 1, 10, '강 의 세 부 일 정', { font: F_HEAD, size: 10, h: 'center', fill: fill('FBD4B4') }); box(ws, r, r, 1, 10, true); ws.getRow(r).height = 17.25; r++;
    var HEADS = [[1, 1, 'No.'], [2, 3, '날 짜 (요일)'], [4, 7, '수 업 내 용'], [8, 9, '주 교재 범위'], [10, 10, '과 제']];
    HEADS.forEach(function (x) { put(ws, r, x[0], x[1], x[2], { font: F_HEAD, size: 10, h: 'center', fill: fill('FABF8F') }); });
    box(ws, r, r, 1, 10, true); ws.getRow(r).height = 17.25; r++;
    var n = Math.max(MAX_ROWS, p.rows.length), first = r;
    for (var i = 0; i < n; i++) {
      var x = p.rows[i] || { no: ('0' + (i + 1)).slice(-2), date: '', content: '', range: '', hw: '' };
      var o = { font: F_BODY, size: 9, h: 'center' };
      put(ws, r, 1, 1, x.no, o); put(ws, r, 2, 3, x.date, o); put(ws, r, 4, 7, x.content, o); put(ws, r, 8, 9, x.range, o); put(ws, r, 10, 10, x.hw, o);
      ws.getRow(r).height = Math.max(17.25, Math.max(linesIn(x.content, 24), linesIn(x.range, 12)) * 12 + 5); r++;
    }
    box(ws, first, r - 1, 1, 10, true);
    // 바닥 그림 (워드 바닥글의 학원 로고, 가운데): 빈 줄로 쪽 맨 아래까지 내림 (A4 높이 − 머리글·바닥글 거리 = 749.75pt)
    var used = 0; for (var k = 1; k < r; k++) used += ws.getRow(k).height || 15;
    ws.getRow(r).height = Math.max(6, Math.min(409, 749.75 - used - 26)); r++;
    if (img) {
      var totalPx = TW.reduce(function (s, t) { return s + t / 15; }, 0), w = 104, hh = 34, left = (totalPx - w) / 2, acc = 0, col = 0;
      while (col < TW.length && acc + TW[col] / 15 <= left) { acc += TW[col] / 15; col++; }
      ws.getRow(r).height = 26;
      ws.addImage(img.foot, { tl: { col: col + (left - acc) / (TW[col] / 15), row: r - 1 }, ext: { width: w, height: hh } });
    }
    ws.pageSetup.printArea = 'A1:J' + r;
    return ws;
  }

  /** plans: build() 결과 여러 개 → 반마다 시트 하나인 통합 문서 */
  function xlsx(ExcelJS, plans, images) {
    var wb = new ExcelJS.Workbook(), img = null, used = {};
    if (images && images.head && images.foot) img = { head: wb.addImage({ buffer: images.head, extension: 'png' }), foot: wb.addImage({ buffer: images.foot, extension: 'png' }) };
    plans.forEach(function (p) {
      var name = p.sheet, k = 2; while (used[name]) name = p.sheet + '(' + (k++) + ')'; used[name] = 1;
      sheet(wb, Object.assign({}, p, { sheet: name }), img);
    });
    return wb;
  }

  return { build: build, xlsx: xlsx, fit: fit, parseDate: parseDate, MAX_ROWS: MAX_ROWS };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Plan;
