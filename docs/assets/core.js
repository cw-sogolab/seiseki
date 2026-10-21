/* 成績ノート 공통 함수 — 브라우저(docs/), Apps Script(apps-script/Core.gs), node 테스트가 같은 파일을 씁니다.
 * 이 파일을 고치면 tools/sync-gas.sh 로 apps-script/Core.gs 에 복사하세요. (tests/logic.test.js 가 두 파일이 같은지 확인)
 */
var Core = (function () {
  var LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I, O 제외 (1, 0과 헷갈림) → 24자

  function S(v) { return v === null || v === undefined ? '' : String(v); }

  /** 입력값 정리: 공백·하이픈 제거, 대문자 */
  function normCode(s) { return S(s).replace(/[\s\-]/g, '').toUpperCase(); }

  /** 번호 = 영문 2자(I·O 제외) + 숫자 6자리, 끝자리는 확인숫자 (예: KM482913)
   *  퇴실퀴즈(kitaku-quiz)와 같은 번호 — 영문은 A=10…Z=35 로 바꿔 Luhn 검사 */
  var CODE_RE = /^[A-HJ-NP-Z]{2}[0-9]{6}$/;
  function luhnOk(s) {
    var ds = s.split('').map(function (c) { return /\d/.test(c) ? c : String(c.charCodeAt(0) - 55); }).join('');
    var t = 0;
    ds.split('').reverse().forEach(function (ch, i) { var d = +ch; if (i % 2) { d *= 2; if (d > 9) d -= 9; } t += d; });
    return t % 10 === 0;
  }
  function isValidCode(c) { return CODE_RE.test(c) && luhnOk(c); }
  /** 앞 7자리에 확인숫자를 붙임 */
  function withCheck(c7) {
    for (var d = 0; d < 10; d++) if (luhnOk(c7 + d)) return c7 + d;
    throw new Error('확인숫자를 만들지 못했어요');
  }
  /** 형식만 맞고 확인숫자가 틀린 경우를 구분해서 안내할 때 */
  function codeProblem(c) {
    if (!CODE_RE.test(c)) return c.length < 8 ? 'short' : 'format';
    return luhnOk(c) ? '' : 'check';
  }

  function fmtCode(c) { return S(c); }

  /** rand32(): 0 이상 2^32 미만 정수, exists(code): 이미 쓰는 번호인지 */
  function genCode(rand32, exists) {
    for (var t = 0; t < 2000; t++) {
      var c = LETTERS.charAt(rand32() % 24) + LETTERS.charAt(rand32() % 24) + ('00000' + (rand32() % 100000)).slice(-5);
      c = withCheck(c);
      if (!exists(c)) return c;
    }
    throw new Error('새 번호를 만들지 못했어요. 다시 시도해 주세요.');
  }

  /** 답안 정리: 숫자 0~9만 남김(0 = 무응답), 문항 수까지 자름. EJU 는 보기가 5~8개인 문항도 있어서 4보다 큰 번호도 받음 */
  function cleanAnswers(s, total) { return S(s).replace(/[^0-9]/g, '').slice(0, total); }

  /** 정답: 1~9 */
  function cleanKey(s) { return S(s).replace(/[^1-9]/g, ''); }

  function padAnswers(a, total) { a = S(a); while (a.length < total) a += '0'; return a.slice(0, total); }

  /** 채점 → { score, wrong:[{n,key,ans}] } */
  function grade(key, ans) {
    key = S(key); ans = padAnswers(ans, key.length);
    var wrong = [], score = 0;
    for (var i = 0; i < key.length; i++) {
      if (ans.charAt(i) === key.charAt(i)) score++;
      else wrong.push({ n: i + 1, key: key.charAt(i), ans: ans.charAt(i) });
    }
    return { score: score, wrong: wrong };
  }

  function mean(arr) {
    if (!arr.length) return null;
    var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function squash(s) { return S(s).replace(/[\s()（）\[\]·.]/g, '').toLowerCase(); }

  /** 이름 비교용: 괄호(지역·학교)와 띄어쓰기 제거 */
  function baseName(n) { return S(n).replace(/\(.*?\)/g, '').replace(/\s+/g, ''); }

  /** 한 칸의 반 이름을 반 목록과 맞춰 봄 → 반코드 또는 '' */
  function matchClass(seg, classes) {
    var q = squash(seg), best = '', bestScore = 0, tie = false;
    if (!q) return '';
    classes.forEach(function (c) {
      var sc = 0;
      if (c.code && q.indexOf(squash(c.code)) >= 0) sc += 3;
      if (c.name && q.indexOf(squash(c.name)) >= 0) sc += 3;
      if (c.time && q.indexOf(squash(c.time)) >= 0) sc += 1;
      if (c.kind && q.indexOf(squash(c.kind)) >= 0) sc += 1;
      if (sc > bestScore) { best = c.code; bestScore = sc; tie = false; }
      else if (sc === bestScore && sc > 0) tie = true;
    });
    return bestScore >= 2 && !tie ? best : '';
  }

  /** aca2000에서 복사한 명단 → { rows:[{name, classes:[반코드]}], unknown:[{line, reason}] }
   *  한 줄 = 이름 + (탭/쉼표/두 칸 이상 공백) + 반. 반이 여러 개면 / 로 구분 */
  function parseRoster(text, classes) {
    var rows = [], unknown = [], byName = {};
    S(text).split(/\r?\n/).forEach(function (line) {
      var raw = line.trim();
      if (!raw) return;
      var parts = raw.split(/\t|,|\s{2,}/).map(function (x) { return x.trim(); }).filter(Boolean);
      var name = parts[0], rest = parts.slice(1).join('/');
      if (!rest) { unknown.push({ line: raw, reason: '반이 적혀 있지 않아요' }); return; }
      var codes = [], bad = [];
      rest.split('/').forEach(function (seg) {
        if (!seg.trim()) return;
        var c = matchClass(seg, classes);
        if (c) { if (codes.indexOf(c) < 0) codes.push(c); } else bad.push(seg.trim());
      });
      if (!codes.length) { unknown.push({ line: raw, reason: '반을 찾지 못했어요: ' + bad.join(', ') }); return; }
      if (bad.length) unknown.push({ line: raw, reason: '일부 반을 찾지 못했어요: ' + bad.join(', ') });
      if (byName[name]) {
        codes.forEach(function (c) { if (byName[name].classes.indexOf(c) < 0) byName[name].classes.push(c); });
      } else {
        byName[name] = { name: name, classes: codes };
        rows.push(byName[name]);
      }
    });
    return { rows: rows, unknown: unknown };
  }

  /* ---------- 수업 달력 (숙제 마감 계산용) ----------
   * cal = { 'YYYY-MM': { start, end, off:['YYYY-MM-DD'] } } — 기록장 「달력」 탭(학원 연간 계획표)에서 읽음 (logic.js calendar()).
   * 달력에 없는 달은 달력상 1일~말일로 계산하고, 강사 화면이 경고함. */
  var WD = '일월화수목금토';
  function ymd(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
  function utc(s) { var p = S(s).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  /** 반의 요일시간(예: 「토일 15:00」) → { days:[0~6], time:'15:00' } */
  function classDays(time) {
    var s = S(time), days = [], m = /(\d{1,2}):(\d{2})/.exec(s);
    for (var i = 0; i < s.length; i++) { var k = WD.indexOf(s.charAt(i)); if (k >= 0 && days.indexOf(k) < 0) days.push(k); }
    return { days: days, time: m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '' };
  }
  /** 그 달(학원 달력 기준) 수업일 목록 ['YYYY-MM-DD'] — 달력에 없는 달은 달력상 1일~말일 */
  function lessons(ym, days, cal) {
    var m = (cal || {})[ym], out = [];
    if (!days || !days.length) return out;
    var s = m ? m.start : ym + '-01', e = m ? m.end : ymd(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)), off = m ? m.off : [];
    for (var t = utc(s); t <= utc(e); t += 86400000) {
      var d = ymd(t);
      if (days.indexOf(new Date(t).getUTCDay()) >= 0 && off.indexOf(d) < 0) out.push(d);
    }
    return out;
  }
  function nextMonth(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5) + 1; if (m > 12) { y++; m = 1; } return y + '-' + ('0' + m).slice(-2); }
  /** 숙제 k 마감 = 그 달 2k+1번째 수업 시작 (2번 수업마다 숙제 하나). 그 달에 그 수업이 없으면 다음 달 첫 수업. → 'YYYY-MM-DD HH:MM' 또는 '' */
  function hwDue(ym, time, k, cal) {
    var cd = classDays(time);
    if (!cd.days.length || !(k >= 1)) return '';
    var l = lessons(ym, cd.days, cal), d = l[2 * k] || lessons(nextMonth(ym), cd.days, cal)[0];
    return d ? d + ' ' + (cd.time || '00:00') : '';
  }
  /** 'YYYY-MM-DD HH:MM' → 「10/24(토) 15:00」 */
  function fmtDue(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/.exec(S(s));
    if (!m) return '';
    return (+m[2]) + '/' + (+m[3]) + '(' + WD.charAt(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()) + ')' + (m[4] && m[4] !== '00:00' ? ' ' + m[4] : '');
  }

  /* ---------- 같은 사진 찾기 ----------
   * 화면이 사진을 17×16 회색으로 줄여 옆 칸과 밝기를 비교한 256비트(16진수 64자) 지문을 보냄.
   * 같은 사진을 다시 보내거나 카톡으로 받아 올리면 거의 같고(몇 비트 차이), 새로 찍은 사진은 수십 비트 넘게 다름. */
  var DUP_BITS = 20;
  function hashDist(a, b) {
    a = S(a); b = S(b);
    if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return 999;
    var n = 0;
    for (var i = 0; i < 64; i++) { var x = parseInt(a.charAt(i), 16) ^ parseInt(b.charAt(i), 16); while (x) { n += x & 1; x >>= 1; } }
    return n;
  }
  function sameHash(a, b) { return hashDist(a, b) <= DUP_BITS; }

  /* ---------- 득점등화 (Rasch) — 실전반 환산점수 ----------
   * 선생님 실전 채점 파일(실전.xlsx 「등화_*」 시트)과 같은 방식:
   * 한 달 안의 모든 회차·모든 학생 응답(문항마다 맞음 1 / 틀림 0 / 안 씀 빈칸)으로 문항 난이도 b 를 함께 추정(학생 능력은 그 달 동안 같다고 봄, 난이도 평균 0).
   * 회차마다 정답 수 r → 능력 θ (그 회차 문항으로 Σσ(θ−b) = r, 0점·만점은 0.3 보정),
   * 환산점수 = 200 × (그 달 모든 문항에서 θ 의 평균 정답 확률) — 「그 달 평균 난이도 시험을 봤다면 받았을 점수」.
   * 같은 회차에서 정답 수가 같으면 환산점수도 같음. 실전.xlsx 7~10월 값과 비교: 84% 같음, 99.5% ±1점 안, 최대 2점 차이.
   * rows: [{ p: 학생, exam: 시험ID, x: [1|0|null, …] (문항 수만큼) }] → { b: {시험ID: [난이도…]}, score(exam, r, mask) } 또는 null(자료 부족) */
  function sig(z) { return 1 / (1 + Math.exp(-z)); }
  function equate(rows) {
    var items = [], idx = {}, persons = [], pi = {}, cells = [];
    rows.forEach(function (r) {
      if (!(r.p in pi)) { pi[r.p] = persons.length; persons.push(r.p); }
      (r.x || []).forEach(function (v, j) {
        if (v === null || v === undefined) return;
        var k = r.exam + '#' + j;
        if (!(k in idx)) { idx[k] = items.length; items.push({ exam: r.exam, j: j }); }
        cells.push([pi[r.p], idx[k], v ? 1 : 0]);
      });
    });
    var P = persons.length, I = items.length;
    if (P < 2 || I < 2) return null;
    var pk = [], ik = [], k, c;
    for (k = 0; k < P; k++) pk.push(true);
    for (k = 0; k < I; k++) ik.push(true);
    for (var pass = 0; pass < 5; pass++) {   // 모두 맞힘·모두 틀림인 학생·문항은 추정에서 빼고 (문항은 아래에서 따로)
      var ps = new Array(P).fill(0), pn = new Array(P).fill(0), is = new Array(I).fill(0), inn = new Array(I).fill(0);
      cells.forEach(function (e) { if (pk[e[0]] && ik[e[1]]) { ps[e[0]] += e[2]; pn[e[0]]++; is[e[1]] += e[2]; inn[e[1]]++; } });
      for (k = 0; k < P; k++) if (pk[k] && (ps[k] === 0 || ps[k] === pn[k])) pk[k] = false;
      for (k = 0; k < I; k++) if (ik[k] && (is[k] === 0 || is[k] === inn[k])) ik[k] = false;
    }
    var live = cells.filter(function (e) { return pk[e[0]] && ik[e[1]]; });
    if (!live.length) return null;
    var th = new Array(P).fill(0), b = new Array(I).fill(0);
    for (var it = 0; it < 500; it++) {
      var gp = new Array(P).fill(0), hp = new Array(P).fill(0);
      live.forEach(function (e) { var q = sig(th[e[0]] - b[e[1]]); gp[e[0]] += e[2] - q; hp[e[0]] += q * (1 - q); });
      for (k = 0; k < P; k++) if (pk[k]) th[k] += Math.max(-1, Math.min(1, gp[k] / Math.max(hp[k], 1e-9)));
      var gi = new Array(I).fill(0), hi = new Array(I).fill(0);
      live.forEach(function (e) { var q = sig(th[e[0]] - b[e[1]]); gi[e[1]] += e[2] - q; hi[e[1]] += q * (1 - q); });
      var mx = 0, sum = 0, cnt = 0;
      for (k = 0; k < I; k++) if (ik[k]) { var db = Math.max(-1, Math.min(1, -gi[k] / Math.max(hi[k], 1e-9))); b[k] += db; mx = Math.max(mx, Math.abs(db)); sum += b[k]; cnt++; }
      for (k = 0; k < I; k++) if (ik[k]) b[k] -= sum / cnt;
      if (mx < 1e-6) break;
    }
    for (k = 0; k < I; k++) if (!ik[k]) {   // 극단 문항: 푼 학생들의 능력으로 0.5 보정해서 난이도 추정
      var tt = [], s = 0;
      cells.forEach(function (e) { if (e[1] === k && pk[e[0]]) { tt.push(th[e[0]]); s += e[2]; } else if (e[1] === k) s += e[2]; });
      var N = cells.filter(function (e) { return e[1] === k; }).length, tgt = Math.min(Math.max(s, 0.5), N - 0.5), bb = 0;
      if (!tt.length) { b[k] = s ? -4 : 4; continue; }
      for (var t2 = 0; t2 < 100; t2++) { var f = 0, h2 = 0; tt.forEach(function (x) { var q = sig(x - bb); f += q; h2 += q * (1 - q); }); bb -= (tgt - f) / Math.max(h2, 1e-9); }
      b[k] = bb;
    }
    var byExam = {};
    items.forEach(function (x, k2) { (byExam[x.exam] || (byExam[x.exam] = []))[x.j] = b[k2]; });
    function score(exam, r, mask) {
      var bs = (byExam[exam] || []).filter(function (v, j) { return v !== undefined && (!mask || mask[j]); });
      if (!bs.length) return null;
      var n = bs.length, rr = Math.min(Math.max(r, 0.3), n - 0.3), t = 0;
      for (var i = 0; i < 100; i++) { var f = 0, h = 0; bs.forEach(function (x) { var q = sig(t - x); f += q; h += q * (1 - q); }); var st = (rr - f) / Math.max(h, 1e-9); t += st; if (Math.abs(st) < 1e-9) break; }
      var m = 0; b.forEach(function (x) { m += sig(t - x); });
      return Math.round(200 * m / b.length);
    }
    return { b: byExam, score: score };
  }

  /** 'YYYY-MM' */
  function monthOf(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function dateOf(d) { return monthOf(d) + '-' + ('0' + d.getDate()).slice(-2); }

  return {
    LETTERS: LETTERS, normCode: normCode, isValidCode: isValidCode, luhnOk: luhnOk, withCheck: withCheck, codeProblem: codeProblem, fmtCode: fmtCode, genCode: genCode,
    cleanAnswers: cleanAnswers, cleanKey: cleanKey, padAnswers: padAnswers,
    grade: grade, mean: mean, parseRoster: parseRoster, matchClass: matchClass, monthOf: monthOf, dateOf: dateOf, baseName: baseName, S: S,
    classDays: classDays, lessons: lessons, nextMonth: nextMonth, hwDue: hwDue, fmtDue: fmtDue, hashDist: hashDist, sameHash: sameHash, DUP_BITS: DUP_BITS, equate: equate
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Core;
