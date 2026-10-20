/* 월말 표 엑셀 — 선생님이 학원에 내던 양식(2609 개념·단풀·실전문풀 파일) 그대로.
 * 4행 제목(연두 바탕) · 5~7행 머리글 · 8행부터 학생 한 줄씩 (실전은 5~6행 머리글, 7행부터).
 * 문자 발송 칸은 비워 두고, 문자 발송용 수식은 넣지 않음 (2026-10 사용자 결정).
 * 평균은 테스트 칸만 (숙제 칸은 빼고) — CLAUDE.md 7번 규칙.
 * model = { kind: '개념'|'단풀'|'실전', title, sheet, cols: [...], rows: [...] }
 *   개념·단풀 cols: { type: 'hw'|'test'|'final', head }   rows: { name, eval, vals: [값|null] }
 *   실전 cols: { head }                                    rows: { name, eval, vals: [[개수, 환산]|null] }
 */
var MonthXlsx = (function () {
  var FONT = '맑은 고딕';
  var TITLE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF1DE' } };
  function L(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function bd(l, t, r, b) {
    var o = {};
    if (l) o.left = { style: l }; if (t) o.top = { style: t }; if (r) o.right = { style: r }; if (b) o.bottom = { style: b };
    return o;
  }
  function put(ws, ref, v, o) {
    var c = ws.getCell(ref);
    if (v !== undefined && v !== null && v !== '') c.value = v;
    o = o || {};
    c.font = { name: FONT, size: 12, bold: !!o.bold };
    c.alignment = { horizontal: o.h || 'center', vertical: 'middle', wrapText: o.wrap !== false };
    if (o.border) c.border = o.border;
    if (o.fill) c.fill = o.fill;
    if (o.fmt) c.numFmt = o.fmt;
    return c;
  }

  function build(ExcelJS, m) {
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet(String(m.sheet || '월말').replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31), { views: [{ zoomScale: 85 }] });
    return m.kind === '실전' ? real(ws, m, wb) : plain(ws, m, wb);
  }

  /* ---------- 개념·단풀 ---------- */
  function plain(ws, m, wb) {
    var K = 11;                                     // K열부터 시험·숙제
    var n = m.cols.length, avgCol = K + n, smsCol = avgCol + 1, last = smsCol;
    var widths = { 1: 3.5, 2: 9, 3: 12.8, 4: 9, 5: 9, 6: 9, 7: 9, 8: 9, 9: 9, 10: 45.7 };
    for (var c = 1; c <= last; c++) ws.getColumn(c).width = widths[c] || (c === avgCol ? 10 : c === smsCol ? 9.7 : 12.5);
    [2, 4, 5, 6, 7, 8, 9].forEach(function (x) { ws.getColumn(x).hidden = true; });   // 원본처럼 B열·「내용」(D~I) 숨김
    ws.getRow(3).height = 19; ws.getRow(4).height = 40.5; ws.getRow(5).height = 16.5; ws.getRow(6).height = 17.25; ws.getRow(7).height = 18.75;

    // 4행 제목
    ws.mergeCells('C4:' + L(last) + '4');
    put(ws, 'C4', m.title, { bold: true, fill: TITLE_FILL, border: bd('medium', 'medium', 'medium', null), wrap: false });
    for (c = 4; c <= last; c++) ws.getCell(L(c) + '4').border = bd(null, 'medium', c === last ? 'medium' : null, null);

    // 5~7행 머리글 틀(테두리)
    for (var r = 5; r <= 7; r++) for (c = 3; c <= last; c++) {
      ws.getCell(L(c) + r).border = bd(c === 3 ? 'medium' : 'thin', r === 5 ? 'medium' : 'thin', c === last ? 'medium' : 'thin', 'thin');
      ws.getCell(L(c) + r).font = { name: FONT, size: 12 };
    }
    ws.mergeCells('C5:C7'); put(ws, 'C5', '이름', { border: bd('medium', 'medium', 'thin', 'thin') });
    ws.mergeCells('D5:I7'); put(ws, 'D5', '내용', { border: bd('thin', 'medium', 'thin', 'thin') });
    ws.mergeCells('J5:J6'); put(ws, 'J5', '학생평가', { border: bd('thin', 'medium', 'thin', 'thin') });
    // 5행 묶음 머리글: 숙제·주별 테스트 → 「주별테스트」, 월말 → 「월말테스트」
    var groups = [];
    m.cols.forEach(function (col, i) {
      var g = col.type === 'final' ? '월말테스트' : '주별테스트';
      if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g: g, a: i, b: i }); else groups[groups.length - 1].b = i;
    });
    groups.forEach(function (g) {
      var a = L(K + g.a), b = L(K + g.b);
      if (a !== b) ws.mergeCells(a + '5:' + b + '5');
      put(ws, a + '5', g.g, { bold: true, border: bd('thin', 'medium', 'thin', 'thin') });
    });
    // 6~7행 칸 머리글: 시험은 6~7행을 합침, 숙제·월말은 6행만
    m.cols.forEach(function (col, i) {
      var a = L(K + i);
      if (col.type === 'test') ws.mergeCells(a + '6:' + a + '7');
      put(ws, a + '6', col.head, { border: bd('thin', 'thin', 'thin', 'thin') });
    });
    put(ws, L(avgCol) + '6', '평균', { border: bd('thin', 'thin', 'thin', 'thin') });
    put(ws, L(avgCol) + '7', '가산점', { border: bd('thin', 'thin', 'thin', 'thin') });
    ws.mergeCells(L(smsCol) + '5:' + L(smsCol) + '7');
    put(ws, L(smsCol) + '5', '문자 발송', { border: bd('thin', 'medium', 'medium', 'thin') });

    // 8행부터 학생
    var testIdx = [];
    m.cols.forEach(function (col, i) { if (col.type !== 'hw') testIdx.push(L(K + i)); });
    m.rows.forEach(function (row, k) {
      var r = 8 + k;
      ws.getRow(r).height = 52;
      put(ws, 'A' + r, k + 1, { wrap: false });
      ws.getCell('A' + r).border = {};
      put(ws, 'C' + r, row.name, { bold: true, border: bd('medium', 'thin', 'thin', 'thin') });
      ws.mergeCells('D' + r + ':I' + r);
      for (var c = 4; c <= 9; c++) ws.getCell(L(c) + r).border = bd('thin', 'thin', 'thin', 'thin');
      put(ws, 'D' + r, null, { h: 'left', border: bd('thin', 'thin', 'thin', 'thin') });
      put(ws, 'J' + r, row.eval || null, { border: bd('thin', 'thin', 'thin', 'thin') });
      row.vals.forEach(function (v, i) { put(ws, L(K + i) + r, v, { border: bd('thin', 'thin', 'thin', 'thin') }); });
      var f = testIdx.length ? 'IFERROR(AVERAGE(' + testIdx.map(function (x) { return x + r; }).join(',') + '),"")' : '';
      put(ws, L(avgCol) + r, f ? { formula: f } : null, { border: bd('thin', 'thin', 'thin', 'thin'), fmt: '0.0_ ' });
      put(ws, L(smsCol) + r, null, { border: bd('thin', 'thin', 'medium', 'thin'), fmt: 'mm"월" dd"일"' });
    });
    return wb;
  }

  /* ---------- 실전 (개수/환산점수 두 칸씩) ---------- */
  function real(ws, m, wb) {
    var G = 7, n = m.cols.length, avgCol = G + n * 2, smsCol = avgCol + 2, last = smsCol;
    var widths = { 1: 3.5, 2: 9, 3: 9, 4: 9, 5: 9, 6: 40.7 };
    for (var c = 1; c <= last; c++) ws.getColumn(c).width = widths[c] || (c === avgCol ? 12 : c === avgCol + 1 ? 10 : c === smsCol ? 9.7 : 10.8);
    [4, 5].forEach(function (x) { ws.getColumn(x).hidden = true; });                  // 원본처럼 「내용」(D~E) 숨김
    ws.getRow(3).height = 18; ws.getRow(4).height = 40.5; ws.getRow(5).height = 16.5; ws.getRow(6).height = 34;

    ws.mergeCells('C4:' + L(last) + '4');
    put(ws, 'C4', m.title, { bold: true, fill: TITLE_FILL, border: bd('medium', 'medium', 'medium', null), wrap: false });
    for (c = 4; c <= last; c++) ws.getCell(L(c) + '4').border = bd(null, 'medium', c === last ? 'medium' : null, null);
    for (var r = 5; r <= 6; r++) for (c = 3; c <= last; c++) {
      ws.getCell(L(c) + r).border = bd(c === 3 ? 'medium' : 'thin', r === 5 ? 'medium' : 'thin', c === last ? 'medium' : 'thin', 'thin');
      ws.getCell(L(c) + r).font = { name: FONT, size: 12 };
    }
    ws.mergeCells('C5:C6'); put(ws, 'C5', '이름', { border: bd('medium', 'medium', 'thin', 'thin') });
    ws.mergeCells('D5:E6'); put(ws, 'D5', '내용', { border: bd('thin', 'medium', 'thin', 'thin') });
    ws.mergeCells('F5:F6'); put(ws, 'F5', '학생평가', { border: bd('thin', 'medium', 'thin', 'thin') });
    if (n) {
      ws.mergeCells(L(G) + '5:' + L(G + n * 2 - 1) + '5');
      put(ws, L(G) + '5', '모의고사 테스트', { bold: true, border: bd('thin', 'medium', 'thin', 'thin') });
    }
    m.cols.forEach(function (col, i) {
      var a = L(G + i * 2), b = L(G + i * 2 + 1);
      ws.mergeCells(a + '6:' + b + '6');
      put(ws, a + '6', col.head, { border: bd('thin', 'thin', 'thin', 'thin') });
    });
    ws.mergeCells(L(avgCol) + '6:' + L(avgCol + 1) + '6');
    put(ws, L(avgCol) + '6', '평균(개수/환산점수)', { border: bd('thin', 'thin', 'thin', 'thin') });
    ws.mergeCells(L(smsCol) + '5:' + L(smsCol) + '6');
    put(ws, L(smsCol) + '5', '문자 발송', { border: bd('thin', 'medium', 'medium', 'thin') });

    m.rows.forEach(function (row, k) {
      var r = 7 + k, cnt = [], conv = [];
      ws.getRow(r).height = 57;
      put(ws, 'A' + r, k + 1, { wrap: false });
      ws.getCell('A' + r).border = {};
      put(ws, 'C' + r, row.name, { bold: true, border: bd('medium', 'thin', 'thin', 'thin') });
      ws.mergeCells('D' + r + ':E' + r);
      ws.getCell('E' + r).border = bd('thin', 'thin', 'thin', 'thin');
      put(ws, 'D' + r, null, { border: bd('thin', 'thin', 'thin', 'thin') });
      put(ws, 'F' + r, row.eval || null, { border: bd('thin', 'thin', 'thin', 'thin') });
      m.cols.forEach(function (col, i) {
        var a = L(G + i * 2), b = L(G + i * 2 + 1), v = row.vals[i];
        cnt.push(a + r); conv.push(b + r);
        put(ws, a + r, v ? v[0] : null, { border: bd('thin', 'thin', 'thin', 'thin') });
        put(ws, b + r, v && v[1] !== null && v[1] !== undefined && v[1] !== '' ? v[1] : null, { bold: true, border: bd('thin', 'thin', 'thin', 'thin') });
      });
      put(ws, L(avgCol) + r, cnt.length ? { formula: 'IFERROR(AVERAGE(' + cnt.join(',') + '),"")' } : null, { border: bd('thin', 'thin', 'thin', 'thin'), fmt: '0.0_ ' });
      put(ws, L(avgCol + 1) + r, conv.length ? { formula: 'IFERROR(AVERAGE(' + conv.join(',') + '),"")' } : null, { bold: true, border: bd('thin', 'thin', 'medium', 'thin'), fmt: '0.0_ ' });
      put(ws, L(smsCol) + r, null, { border: bd('thin', 'thin', 'medium', 'thin'), fmt: 'mm"월" dd"일"' });
    });
    return wb;
  }

  return { build: build, col: L };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MonthXlsx;
