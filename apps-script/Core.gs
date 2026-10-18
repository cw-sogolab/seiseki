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

  /** 'YYYY-MM' */
  function monthOf(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function dateOf(d) { return monthOf(d) + '-' + ('0' + d.getDate()).slice(-2); }

  return {
    LETTERS: LETTERS, normCode: normCode, isValidCode: isValidCode, luhnOk: luhnOk, withCheck: withCheck, codeProblem: codeProblem, fmtCode: fmtCode, genCode: genCode,
    cleanAnswers: cleanAnswers, cleanKey: cleanKey, padAnswers: padAnswers,
    grade: grade, mean: mean, parseRoster: parseRoster, matchClass: matchClass, monthOf: monthOf, dateOf: dateOf, baseName: baseName, S: S
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Core;
