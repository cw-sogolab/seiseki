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
   * 학원 연간 계획표의 달별 개강·종강·휴강일. tools/class-plan/calendar_YYYY.json 과 같아야 함 (tests/logic.test.js 가 확인).
   * 새해 계획표가 오면 JSON 을 만들고 여기에도 그 해 달을 넣을 것. */
  var CAL = {
    '2026-01': { start: '2026-01-02', end: '2026-01-29', off: ['2026-01-01'] },
    '2026-02': { start: '2026-01-30', end: '2026-03-03', off: ['2026-02-15','2026-02-16','2026-02-17','2026-02-18'] },
    '2026-03': { start: '2026-03-04', end: '2026-03-31', off: [] },
    '2026-04': { start: '2026-04-01', end: '2026-04-28', off: [] },
    '2026-05': { start: '2026-04-29', end: '2026-05-28', off: [] },
    '2026-06': { start: '2026-05-29', end: '2026-06-28', off: ['2026-06-21'] },
    '2026-07': { start: '2026-06-29', end: '2026-07-28', off: [] },
    '2026-08': { start: '2026-07-29', end: '2026-08-29', off: ['2026-08-02','2026-08-03','2026-08-04'] },
    '2026-09': { start: '2026-08-30', end: '2026-10-01', off: ['2026-09-24','2026-09-25','2026-09-26','2026-09-27'] },
    '2026-10': { start: '2026-10-02', end: '2026-10-31', off: [] },
    '2026-11': { start: '2026-11-01', end: '2026-12-01', off: ['2026-11-08','2026-11-09','2026-11-10'] },
    '2026-12': { start: '2026-12-02', end: '2026-12-30', off: ['2026-12-25'] }
  };
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
  function lessons(ym, days) {
    var m = CAL[ym], out = [];
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
  function hwDue(ym, time, k) {
    var cd = classDays(time);
    if (!cd.days.length || !(k >= 1)) return '';
    var l = lessons(ym, cd.days), d = l[2 * k] || lessons(nextMonth(ym), cd.days)[0];
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

  /** 'YYYY-MM' */
  function monthOf(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function dateOf(d) { return monthOf(d) + '-' + ('0' + d.getDate()).slice(-2); }

  return {
    LETTERS: LETTERS, normCode: normCode, isValidCode: isValidCode, luhnOk: luhnOk, withCheck: withCheck, codeProblem: codeProblem, fmtCode: fmtCode, genCode: genCode,
    cleanAnswers: cleanAnswers, cleanKey: cleanKey, padAnswers: padAnswers,
    grade: grade, mean: mean, parseRoster: parseRoster, matchClass: matchClass, monthOf: monthOf, dateOf: dateOf, baseName: baseName, S: S,
    CAL: CAL, classDays: classDays, lessons: lessons, nextMonth: nextMonth, hwDue: hwDue, fmtDue: fmtDue, hashDist: hashDist, sameHash: sameHash, DUP_BITS: DUP_BITS
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Core;
