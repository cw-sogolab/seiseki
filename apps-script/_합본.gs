/* 성적노트 서버 — Core.gs + Logic.gs + Code.gs 를 한 파일로 합친 것 (편집기에 한 번에 붙여넣기용). 원본은 GitHub cw-sogolab/seiseki 의 apps-script/ */

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

  /** 'YYYY-MM' */
  function monthOf(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function dateOf(d) { return monthOf(d) + '-' + ('0' + d.getDate()).slice(-2); }

  return {
    LETTERS: LETTERS, normCode: normCode, isValidCode: isValidCode, luhnOk: luhnOk, withCheck: withCheck, codeProblem: codeProblem, fmtCode: fmtCode, genCode: genCode,
    cleanAnswers: cleanAnswers, cleanKey: cleanKey, padAnswers: padAnswers,
    grade: grade, mean: mean, parseRoster: parseRoster, matchClass: matchClass, monthOf: monthOf, dateOf: dateOf, baseName: baseName, S: S,
    classDays: classDays, lessons: lessons, nextMonth: nextMonth, hwDue: hwDue, fmtDue: fmtDue, hashDist: hashDist, sameHash: sameHash, DUP_BITS: DUP_BITS
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Core;


/* 成績ノート 요청 처리 — 저장소에 상관없이 같은 규칙으로 동작합니다.
 * 실제 서버: apps-script/Code.gs 가 구글 시트·드라이브로 env 를 만들어 Logic.handle 을 부릅니다.
 * 미리보기:  docs/assets/mock.js 가 메모리로 env 를 만들어 같은 함수를 부릅니다.
 * 이 파일을 고치면 tools/sync-gas.sh 로 apps-script/Logic.gs 에 복사하세요.
 *
 * env = {
 *   store: { all(t), append(t,obj), update(t,pred,patch) -> n, remove(t,pred) -> n },
 *   cache: { get(k), put(k,v,sec), remove(k) },
 *   props: { get(k) },
 *   now(): Date, uuid(): string, rand32(): int,
 *   saveImage({ folders:[...], name, mime, b64 }) -> fileId
 * }
 */
var Logic = (function () {
  // Apps Script는 파일을 읽는 순서가 정해져 있지 않아서 Core 는 처음 요청 때 찾습니다.
  var C = null;
  function S(v) { return v === null || v === undefined ? '' : String(v); }
  function loadCore() { if (!C) C = (typeof Core !== 'undefined') ? Core : require('./core.js'); }

  /** 시트(탭) 이름과 열 — Code.gs 초기 설정이 이대로 만듭니다. 열 이름을 바꾸면 기존 시트도 같이 바꿔야 합니다. */
  var TABLES = {
    '반': ['반코드', '반이름', '종류', '요일시간', '활성'],
    // 원생: 퇴실퀴즈와 같이 쓰는 「원생명단」 시트 (Code.gs 가 ROSTER_ID 시트로 연결). 연결 전에는 기록장 안의 「원생」 탭.
    '원생': ['일련번호', '이름', '상태', '발급일', '메모'],
    // 수강: 성적노트에서만 쓰는 반 정보 (원생명단에는 반을 넣지 않음 — 2026-10-17 사용자 결정)
    '수강': ['번호', '반코드', '수정일'],
    '시험': ['시험ID', '반코드', '월', '종류', '이름', '문항수', '정답', '시험일', '등록일'],
    '시험결과': ['시험ID', '번호', '답안', '맞은개수', '틀린번호', '환산점수', '입력일'],
    // 마감: 비워 두면 자동(숙제 k = 그 달 2k+1번째 수업 시작). 「YYYY-MM-DD HH:MM」을 넣으면 그걸 씀
    '숙제': ['숙제ID', '반코드', '월', '이름', '교재', '시작쪽', '끝쪽', '문항수', '등록일', '마감'],
    // 처음제출일: 늦음 판단용 (사진을 더 올려도 바뀌지 않음). 비어 있으면 최종제출일
    '숙제제출': ['숙제ID', '번호', '맞은개수', '사진수', '확인', '대리입력', '최종제출일', '처음제출일'],
    // 해시: 같은 사진 찾기용 지문(16진수 64자). 검사 「확인필요」 + 검사메모 = 강사 화면 ⚠
    '숙제사진': ['숙제ID', '번호', '순서', '파일ID', '올린시각', '검사', '검사메모', '해시'],
    '평가': ['월', '번호', '코멘트', '수정일'],
    // 시험지: 수업 폴더 답지에서 뽑은 정답·문항 수 (강사 화면에서 시험·숙제 등록 때 골라 씀). 학생에게는 보내지 않음
    '시험지': ['시험지ID', '반종류', '과목', '종류', '회차', '이름', '문항수', '정답', '출처'],
    // 달력: 학원 연간 계획표 (숙제 마감 계산). 월 = 'YYYY-MM', 휴강 = 날짜를 쉼표로 (예: 2026-11-08, 2026-11-09)
    '달력': ['월', '개강', '종강', '휴강', '메모'],
    // 계획서: 지난 월간 강의계획서의 일정 줄 (월초 강의계획서 내려받기가 내용·교재 범위를 이어서 씀). 반 = 실전 D·E
    '계획서': ['월', '반종류', '과목', '반', '회차', '날짜', '내용', '범위', '과제'],
    // 계획서머리: 계획서 위쪽 칸 (반 종류·과목마다 가장 최근 것을 씀)
    '계획서머리': ['월', '반종류', '과목', '반', '부제', '강의명', '강의목표', '담당강사', '연락처', '강의기간', '강의시간', '강의실', '교재', '질문시간', '질문방법', '평가방법']
  };
  /** 서버·화면 코드 버전 — tools/sync-gas.sh 가 core.js·logic.js·Code.gs 내용으로 자동으로 바꿈. 화면이 서버 응답의 ver 와 비교해 다르면 경고 */
  var VERSION = '53c7985898';
  /** 숫자로 바뀌면 안 되는 열(앞자리 0, 긴 숫자열) — Code.gs 가 텍스트 서식으로 고정 */
  var TEXT_COLS = ['시험지ID', '일련번호', '번호', '정답', '답안', '틀린번호', '반코드', '시험ID', '숙제ID', '파일ID', '월', '시험일', '개강', '종강', '휴강', '마감'];
  var STU_TTL = 6 * 3600;            // 학생 로그인 열쇠 유효 시간
  var PHOTO_MAX_B64 = 4 * 1024 * 1024; // 사진 한 장 3MB (base64 로는 약 4MB)
  var PHOTO_MAX_PER_HW = 24;         // 숙제 하나에 한 학생 사진 최대 (화면은 한 번에 12장)
  var DUP_DAYS = 120;                // 같은 사진 찾기는 최근 넉 달 사진과만 비교
  var PHOTO_KEEP_DAYS = 90;          // 3개월 지난 사진은 드라이브에서 지움 (Code.gs cleanupPhotos)

  var LOGIN_FAILS = 5, LOCK_SEC = 60, GLOBAL_FAILS = 40, ADMIN_TTL = 6 * 3600;
  // 관리자 비밀번호는 짧을 수 있어서(4자), 기기를 바꿔 가며 계속 맞혀 보는 것을 막는 전체 한도: 1시간에 20번 틀리면 1시간 막음
  var ADMIN_GLOBAL_FAILS = 20, ADMIN_GLOBAL_SEC = 3600;

  function ok(data) { return { ok: true, data: data }; }
  function fail(msg) { return { ok: false, error: msg }; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function stamp(env) { return stampOf(env.now()); }
  function stampOf(d) { return C.dateOf(d) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  /* 한 요청 안에서 같은 표를 여러 번 계산하지 않게 (저장하면 비움) */
  var M = {};
  function memo(k, fn) { return Object.prototype.hasOwnProperty.call(M, k) ? M[k] : (M[k] = fn()); }

  function upsert(env, t, pred, obj) {
    if (env.store.update(t, pred, obj) === 0) env.store.append(t, obj);
  }

  /* ---------- 읽기 ---------- */
  function classes(env) {
    return memo('classes', function () {
      return env.store.all('반').map(function (r) {
        return { code: S(r['반코드']), name: S(r['반이름']), kind: S(r['종류']), time: S(r['요일시간']), active: S(r['활성']) !== 'N' };
      }).filter(function (c) { return c.code; });
    });
  }
  /** 「달력」 탭 → { 'YYYY-MM': {start, end, off:[...]} }. 탭이 없으면 {} (강사 화면 경고) */
  function calendar(env) {
    return memo('cal', function () {
      var rows, out = {};
      try { rows = env.store.all('달력'); } catch (e) { out._missing = true; return out; }
      rows.forEach(function (r) {
        var m = /^(\d{4})[-.\/](\d{1,2})/.exec(S(r['월']).trim()), a = normDate(r['개강']), b = normDate(r['종강']);
        if (!m || !a || !b) return;
        out[m[1] + '-' + ('0' + m[2]).slice(-2)] = { start: a, end: b, off: S(r['휴강']).split(/[,\s]+/).map(normDate).filter(Boolean) };
      });
      return out;
    });
  }
  function normDate(v) { var m = /(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/.exec(S(v)); return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : ''; }
  /** 원생명단 + 수강 → [{code, name, classes, active, status, issued}]  (active = 상태가 「차단」이 아님) */
  function students(env) { return memo('students', function () { return students_(env); }); }
  function students_(env) {
    var cls = {};
    env.store.all('수강').forEach(function (r) {
      var c = C.normCode(r['번호']);
      if (c) cls[c] = S(r['반코드']).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    });
    var seen = {};
    return env.store.all('원생').map(function (r) {
      var code = C.normCode(r['일련번호']), st = S(r['상태']).trim();
      return { code: code, name: S(r['이름']).trim(), classes: cls[code] || [], active: st !== '차단', status: st, issued: S(r['발급일']) };
    }).filter(function (s) {
      if (!s.code || !s.name || seen[s.code]) return false;
      seen[s.code] = 1; return true;
    });
  }
  function exams(env) { return memo('exams', function () { return exams_(env); }); }
  function exams_(env) {
    return env.store.all('시험').map(function (r) {
      return { id: S(r['시험ID']), cls: S(r['반코드']), month: S(r['월']), kind: S(r['종류']), label: S(r['이름']),
        total: num(r['문항수']), key: C.cleanKey(r['정답']), date: S(r['시험일']), created: S(r['등록일']) };
    }).filter(function (e) { return e.id; });
  }
  function results(env) { return memo('results', function () { return results_(env); }); }
  function results_(env) {
    return env.store.all('시험결과').map(function (r) {
      return { exam: S(r['시험ID']), code: S(r['번호']), answers: S(r['답안']), score: num(r['맞은개수']),
        wrong: S(r['틀린번호']).split(',').filter(Boolean).map(Number), conv: S(r['환산점수']) === '' ? null : num(r['환산점수']), at: S(r['입력일']) };
    }).filter(function (r) { return r.exam; });
  }
  /** 숙제 목록 + 마감(due). 마감 칸이 비면 숙제 k(이름의 「N주차」, 없으면 그 반·그 달 등록 순서) = 2k+1번째 수업 시작 */
  function homework(env) { return memo('homework', function () { return homework_(env); }); }
  function homework_(env) {
    var cal = calendar(env);
    var list = env.store.all('숙제').map(function (r) {
      return { id: S(r['숙제ID']), cls: S(r['반코드']), month: S(r['월']), label: S(r['이름']), book: S(r['교재']),
        p0: num(r['시작쪽']), p1: num(r['끝쪽']), total: num(r['문항수']), created: S(r['등록일']), dueSet: normDue(r['마감']) };
    }).filter(function (h) { return h.id; });
    var time = {};
    classes(env).forEach(function (c) { time[c.code] = c.time; });
    list.forEach(function (h) {
      var k = 0, m = /(\d+)\s*주차/.exec(h.label);
      if (m) k = +m[1];
      else {
        var same = list.filter(function (x) { return x.cls === h.cls && x.month === h.month && !/\d+\s*주차/.test(x.label); })
          .sort(function (a, b) { return a.created.localeCompare(b.created) || a.id.localeCompare(b.id); });
        k = same.indexOf(h) + 1;
      }
      h.week = k;
      h.due = h.dueSet || C.hwDue(h.month, time[h.cls], k, cal);
    });
    return list;
  }
  /** 마감 입력 정리: 「2026-10-24」「2026-10-24 15:00」「2026.10.24 15:00」 → 'YYYY-MM-DD HH:MM' (날짜만이면 00:00), 못 읽으면 '' */
  function normDue(v) {
    var m = /^\s*(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/.exec(S(v));
    if (!m) return '';
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) + ' ' + ('0' + (m[4] || '0')).slice(-2) + ':' + (m[5] || '00');
  }
  /** 늦게 냈는지: 학생이 직접 낸 것만 (선생님 대신 입력은 늦음 아님), 처음 낸 시각 > 마감 */
  function isLate(h, s) { return !!(h && s && !s.proxy && h.due && s.first && s.first > h.due); }
  function hwSubs(env) { return memo('hwSubs', function () { return hwSubs_(env); }); }
  function hwSubs_(env) {
    return env.store.all('숙제제출').map(function (r) {
      return { hw: S(r['숙제ID']), code: S(r['번호']), count: S(r['맞은개수']) === '' ? null : num(r['맞은개수']), photos: num(r['사진수']),
        checked: S(r['확인']) === 'Y', proxy: S(r['대리입력']) === 'Y', at: S(r['최종제출일']), first: S(r['처음제출일']) || S(r['최종제출일']) };
    }).filter(function (r) { return r.hw; });
  }
  /** AI 사진 확인에서 걸린 사진 (강사 화면 ⚠ 표시용) */
  function photoWarns(env) {
    return env.store.all('숙제사진').filter(function (r) { return S(r['검사']) === '확인필요'; })
      .map(function (r) { return { hw: S(r['숙제ID']), code: S(r['번호']), order: num(r['순서']), msg: S(r['검사메모']) }; });
  }
  function evals(env) {
    return env.store.all('평가').map(function (r) { return { month: S(r['월']), code: S(r['번호']), text: S(r['코멘트']) }; });
  }
  /** 지난 강의계획서 (탭이 아직 없는 기록장이면 빈 목록) — 강사 화면 「강의계획서」 내려받기용 */
  function planBank(env) {
    function rows(t) {
      var out; try { out = env.store.all(t); } catch (e) { return []; }
      return out.map(function (r) { var o = {}; TABLES[t].forEach(function (k) { o[k] = S(r[k]); }); return o; }).filter(function (o) { return o['월'] && o['반종류']; });
    }
    return { rows: rows('계획서'), heads: rows('계획서머리') };
  }
  /** 시험지 목록 (탭이 아직 없는 기록장이면 빈 목록) */
  function papers(env) {
    var rows;
    try { rows = env.store.all('시험지'); } catch (e) { return []; }
    return rows.map(function (r) {
      return { id: S(r['시험지ID']), ban: S(r['반종류']), subj: S(r['과목']), kind: S(r['종류']), round: num(r['회차']),
        label: S(r['이름']), total: num(r['문항수']), key: C.cleanKey(r['정답']), src: S(r['출처']) };
    }).filter(function (p) { return p.id && p.label && p.total > 0; });
  }
  function findStudent(env, code) {
    return students(env).filter(function (s) { return s.code === code; })[0] || null;
  }
  function examSort(a, b) { return (a.date || a.created).localeCompare(b.date || b.created); }

  /* ---------- 로그인 잠금 ---------- */
  function lockCheck(env, key) {
    if (env.cache.get('lock:' + key)) return '여러 번 틀려서 잠시 막혔어요. 1분 뒤에 다시 해 주세요.';
    if (num(env.cache.get('gfail')) >= GLOBAL_FAILS) return '지금은 접속이 많아요. 1분 뒤에 다시 해 주세요.';
    return '';
  }
  function lockFail(env, key) {
    var n = num(env.cache.get('fail:' + key)) + 1;
    env.cache.put('fail:' + key, String(n), LOCK_SEC * 5);
    env.cache.put('gfail', String(num(env.cache.get('gfail')) + 1), LOCK_SEC);
    if (n >= LOGIN_FAILS) { env.cache.put('lock:' + key, '1', LOCK_SEC); env.cache.remove('fail:' + key); return 0; }
    return LOGIN_FAILS - n;
  }

  /* ---------- 학생 ---------- */
  function studentView(env, stu) {
    var showKey = S(env.props.get('SHOW_KEY')) === 'Y';
    var cls = classes(env), ex = exams(env), rs = results(env), hw = homework(env), subs = hwSubs(env);
    var curMonth = C.monthOf(env.now()), nowStamp = stamp(env);
    // 한 번 훑어서 색인을 만들어 둠 (시험마다 결과 전체를 다시 훑지 않게)
    var kindOfCls = {}, exById = {}, hwById = {}, byExam = {}, cum = {}, mySub = {};
    cls.forEach(function (c) { kindOfCls[c.code] = c.kind; });
    ex.forEach(function (e) { exById[e.id] = e; });
    hw.forEach(function (h) { hwById[h.id] = h; });
    // 지금 듣는 반 + 예전에 기록이 있는 반 (반이 매달 바뀌어도 지난 성적이 보이게)
    var mine = stu.classes.slice();
    function add(c) { if (c && mine.indexOf(c) < 0) mine.push(c); }
    rs.forEach(function (r) {
      var e = exById[r.exam];
      (byExam[r.exam] || (byExam[r.exam] = [])).push(r);
      if (r.code === stu.code && e) add(e.cls);
      // 같은 시험의 누적 평균 (반 종류 + 시험 이름이 같으면 같은 시험 — 달·반이 달라도 모두 모아서). 그달 학생 수준에 덜 흔들리게
      if (!e || !e.total || r.score > e.total) return;   // 문항 수보다 큰 점수(입력 오타)는 빼고
      var k = (kindOfCls[e.cls] || '') + '|' + e.label, o = cum[k] || (cum[k] = { s: 0, n: 0 });
      o.s += r.score / e.total; o.n++;
    });
    subs.forEach(function (x) { if (x.code === stu.code) { mySub[x.hw] = x; if (hwById[x.hw]) add(hwById[x.hw].cls); } });
    var exByCls = {}, hwByCls = {};
    ex.forEach(function (e) { (exByCls[e.cls] || (exByCls[e.cls] = [])).push(e); });
    hw.forEach(function (h) { (hwByCls[h.cls] || (hwByCls[h.cls] = [])).push(h); });
    return {
      name: stu.name, code: stu.code,
      classes: cls.filter(function (c) { return mine.indexOf(c.code) >= 0; }).sort(function (a, b) {
        return (stu.classes.indexOf(a.code) < 0) - (stu.classes.indexOf(b.code) < 0); // 지금 듣는 반 먼저
      }).map(function (c) {
        var current = stu.classes.indexOf(c.code) >= 0;
        var tests = (exByCls[c.code] || []).slice().sort(examSort).map(function (e) {
          var me = null, all = [], convs = [];
          (byExam[e.id] || []).forEach(function (r) {
            if (!(e.total && r.score > e.total)) all.push(r.score);   // 입력 오타(문항 수보다 큰 점수)는 반 평균에서 뺌
            if (r.conv !== null) convs.push(r.conv);
            if (r.code === stu.code) me = r;
          });
          var t = { id: e.id, month: e.month, kind: e.kind, label: e.label, date: e.date, total: e.total,
            score: me ? me.score : null, avg: C.mean(all), n: all.length,
            conv: me ? me.conv : null, convAvg: C.mean(convs), wrong: me ? me.wrong : [] };
          var ck = cum[c.kind + '|' + e.label];
          t.cum = ck ? { pct: Math.round(ck.s / ck.n * 1000) / 10, n: ck.n } : null;   // 같은 시험 누적 평균 정답률(%)·인원
          if (showKey && me && me.answers) t.wrongDetail = C.grade(e.key, me.answers).wrong;   // 답안 기록이 없는(옮겨 온) 성적은 제외
          return t;
        }).filter(function (t) {
          // 지난 달은 본 시험만, 이번 달은 지금 듣는 반의 시험 전부 (반이 달마다 바뀌어도 남의 달 시험이 「미응시」로 쌓이지 않게)
          return t.score !== null || (t.month >= curMonth && current);
        });
        var hws = (hwByCls[c.code] || []).map(function (h) {
          var x = mySub[h.id];
          return { id: h.id, month: h.month, label: h.label, book: h.book, p0: h.p0, p1: h.p1, total: h.total,
            done: !!x, count: x ? x.count : null, photos: x ? x.photos : 0, checked: x ? x.checked : false,
            due: h.due, late: isLate(h, x), overdue: !x && !!h.due && nowStamp > h.due };
        }).filter(function (w) { return w.done || (w.month >= curMonth && current); });
        return { code: c.code, name: c.name, kind: c.kind, time: c.time, current: current, tests: tests, hw: hws };
      })
    };
  }

  function login(env, p) {
    var dev = S(p.dev).slice(0, 40) || 'anon';
    var locked = lockCheck(env, 's:' + dev);
    if (locked) return fail(locked);
    var code = C.normCode(p.code), prob = C.codeProblem(code);
    if (prob === 'short' || prob === 'format') return fail('영문 2자 + 숫자 6자리를 모두 넣어 주세요. (예: KM482919, I와 O는 쓰지 않아요)');
    if (prob === 'check') { var l2 = lockFail(env, 's:' + dev); return fail(l2 ? '번호를 다시 확인해 주세요. (남은 기회 ' + l2 + '번)' : '5번 틀렸어요. 1분 뒤에 다시 해 주세요.'); }
    var stu = findStudent(env, code);
    if (!stu || !stu.active) {
      var left = lockFail(env, 's:' + dev);
      return fail(left ? '없는 번호예요. 선생님께 받은 번호를 다시 확인해 주세요. (남은 기회 ' + left + '번)' : '5번 틀렸어요. 1분 뒤에 다시 해 주세요.');
    }
    env.cache.remove('fail:s:' + dev);
    // 학생 열쇠: 숙제 제출은 번호 대신 이 열쇠로만 받음 (번호를 넣어 보며 맞히는 길을 막음)
    var tok = env.uuid();
    env.cache.put('stu:' + tok, stu.code, STU_TTL);
    var v = studentView(env, stu); v.tok = tok;
    return ok(v);
  }

  /** 숙제 제출하는 학생: 로그인 때 받은 열쇠(tok)로만 찾음. 열쇠가 없거나 지났으면 화면이 다시 로그인하고 한 번 더 보냄 */
  function studentFor(env, p) {
    var code = S(p.tok) ? S(env.cache.get('stu:' + S(p.tok))) : '';
    var stu = code ? findStudent(env, code) : null;
    if (!stu || !stu.active) { var e = new Error('다시 로그인해 주세요.'); e.needLogin = true; throw e; }
    return stu;
  }
  function hwFor(env, stu, id) {
    var h = homework(env).filter(function (x) { return x.id === S(id); })[0];
    if (!h || stu.classes.indexOf(h.cls) < 0) throw new Error('이 숙제를 찾지 못했어요.');
    return h;
  }

  function hwPhoto(env, p) {
    var stu = studentFor(env, p), h = hwFor(env, stu, p.hw);
    var b64 = S(p.b64), hash = S(p.hash).toLowerCase();
    if (!b64) return fail('사진이 비어 있어요.');
    if (b64.length > PHOTO_MAX_B64) return fail('사진이 너무 커요 (한 장 3MB까지). 다시 찍어 주세요.');
    if (b64.slice(0, 4) !== '/9j/') return fail('사진 파일만 올릴 수 있어요.');   // JPEG (화면이 항상 JPEG로 줄여 보냄)
    if (!/^[0-9a-f]{64}$/.test(hash)) hash = '';
    var since = stampOf(new Date(env.now().getTime() - DUP_DAYS * 86400000));
    var mineN = 0;
    // 같은 사진 찾기: 같은 숙제에 이미 올린 사진이면 다시 저장하지 않음, 내 다른 숙제 사진이면 거절, 다른 학생 사진과 같으면 받되 선생님 화면에 ⚠
    var dupMsg = '';
    if (hash) {
      var rows = env.store.all('숙제사진'), hwAll = null, stAll = null;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (S(r['숙제ID']) === h.id && S(r['번호']) === stu.code) mineN++;
        if (S(r['올린시각']) < since || !C.sameHash(hash, r['해시'])) continue;
        var rc = S(r['번호']), rh = S(r['숙제ID']);
        if (rc === stu.code && rh === h.id) return ok({ fileId: S(r['파일ID']), check: null, dup: 'same' });
        hwAll = hwAll || homework(env);
        var oh = hwAll.filter(function (x) { return x.id === rh; })[0], olabel = oh ? oh.label + (oh.month !== h.month ? ' (' + (+oh.month.slice(5)) + '월)' : '') : '다른 숙제';
        if (rc === stu.code) return fail('「' + olabel + '」에 올린 사진과 같아요. 이번 숙제 쪽을 새로 찍어 주세요.');
        if (!dupMsg) {
          stAll = stAll || students(env);
          var os = stAll.filter(function (x) { return x.code === rc; })[0];
          dupMsg = (os ? os.name : rc) + '(' + rc + ')이 「' + olabel + '」에 올린 사진과 같아요';
        }
      }
    }
    if (b64.length > 10 * 1024 * 1024) return fail('사진이 너무 커요. 다시 찍어 주세요.');
    if (!hash) mineN = env.store.all('숙제사진').filter(function (r) { return S(r['숙제ID']) === h.id && S(r['번호']) === stu.code; }).length;
    if (mineN >= PHOTO_MAX_PER_HW) return fail('숙제 하나에 사진은 ' + PHOTO_MAX_PER_HW + '장까지 올릴 수 있어요.');
    var mime = 'image/jpeg';
    var order = num(p.order) || 1;
    var c = classes(env).filter(function (x) { return x.code === h.cls; })[0];
    var fileId = env.saveImage({
      folders: [(c ? c.name : h.cls), h.month, h.label],
      name: stu.code + '_' + h.id + '_' + ('0' + order).slice(-2) + '.' + mime.split('/')[1].replace('jpeg', 'jpg'),
      mime: mime, b64: b64
    });
    // AI 사진 확인 (서버에 API 키가 있을 때만): 맞는 숙제인지, 이름 칸에 자기 이름을 썼는지. 실패해도 제출은 받음
    var chk = null;
    if (env.checkPhoto) {
      try { chk = env.checkPhoto({ b64: b64, mime: mime, name: S(stu.name).replace(/\(.*\)$/, '').trim(), label: h.label, order: order }); }
      catch (e) { chk = null; }
    }
    var flag = dupMsg ? '확인필요' : chk ? (chk.ok ? 'OK' : '확인필요') : '';
    var note = [dupMsg, chk && !chk.ok ? S(chk.msg) : ''].filter(Boolean).join(' / ');
    env.store.append('숙제사진', { '숙제ID': h.id, '번호': stu.code, '순서': order, '파일ID': fileId, '올린시각': stamp(env),
      '검사': flag, '검사메모': note, '해시': hash });
    // 다른 학생 사진과 같은 것은 학생에게 알리지 않음 (선생님이 보고 판단)
    return ok({ fileId: fileId, check: chk ? { ok: !!chk.ok, msg: S(chk.msg) } : null });
  }

  function hwFinish(env, p) {
    var stu = studentFor(env, p), h = hwFor(env, stu, p.hw);
    var count = S(p.count) === '' ? '' : Math.max(0, Math.min(h.total || 9999, Math.round(num(p.count))));
    var photos = env.store.all('숙제사진').filter(function (r) { return S(r['숙제ID']) === h.id && S(r['번호']) === stu.code; }).length;
    if (!photos) return fail('사진을 한 장 이상 올려 주세요.');
    var prev = hwSubs(env).filter(function (x) { return x.hw === h.id && x.code === stu.code; })[0], now = stamp(env);
    if (count === '' && prev && prev.count !== null) count = prev.count;   // 사진만 더 올릴 때는 맞은 개수 그대로
    upsert(env, '숙제제출', function (r) { return S(r['숙제ID']) === h.id && S(r['번호']) === stu.code; },
      { '숙제ID': h.id, '번호': stu.code, '맞은개수': count, '사진수': photos, '확인': 'N', '대리입력': 'N', '최종제출일': now,
        '처음제출일': prev && !prev.proxy && prev.first ? prev.first : now });
    return ok(studentView(env, stu));
  }

  /* ---------- 강사 ---------- */
  function adminLogin(env, p) {
    var dev = S(p.dev).slice(0, 40) || 'anon';
    var locked = lockCheck(env, 'a:' + dev);
    if (locked) return fail(locked);
    if (num(env.cache.get('agfail')) >= ADMIN_GLOBAL_FAILS) return fail('관리자 비밀번호가 여러 번 틀려서 1시간 동안 막혔어요. 그 뒤에 다시 해 주세요.');
    var pw = S(env.props.get('ADMIN_PASSWORD')).trim();
    if (!pw) return fail('관리자 비밀번호가 아직 없어요. 구글 시트 메뉴 「성적노트 → 관리자 비밀번호 설정」에서 정해 주세요.');
    if (S(p.password).trim() !== pw) {   // 휴대폰 자동완성이 붙이는 앞뒤 빈칸은 무시
      env.cache.put('agfail', String(num(env.cache.get('agfail')) + 1), ADMIN_GLOBAL_SEC);
      var left = lockFail(env, 'a:' + dev);
      return fail(left ? '비밀번호가 달라요. (남은 기회 ' + left + '번)' : '5번 틀렸어요. 1분 뒤에 다시 해 주세요.');
    }
    var token = env.uuid();
    env.cache.put('adm:' + token, adminGen(env), ADMIN_TTL);
    return ok({ token: token, boot: bootstrap(env).data });   // 로그인과 첫 불러오기를 한 번에 (왕복 한 번 줄임)
  }
  /** 비밀번호를 바꾸면 ADMIN_GEN 이 바뀌어, 그 전에 받은 로그인은 더 쓸 수 없음 */
  function adminGen(env) { return S(env.props.get('ADMIN_GEN')) || '1'; }
  function isAdmin(env, token) { return !!token && env.cache.get('adm:' + S(token)) === adminGen(env); }

  function bootstrap(env) {
    var hw = homework(env), byId = {};
    hw.forEach(function (h) { byId[h.id] = h; });
    var subs = hwSubs(env);
    subs.forEach(function (s) { s.late = isLate(byId[s.hw], s); });
    return ok({ classes: classes(env), students: students(env), exams: exams(env), results: results(env),
      homework: hw, hwSubs: subs, photoWarns: photoWarns(env), evals: evals(env), papers: papers(env), plans: planBank(env), cal: calendar(env), today: C.dateOf(env.now()), now: stamp(env),
      warnings: warnings(env) });
  }

  /** 강사 화면 맨 위 경고: 달력에 없는 달, 수업 요일을 모르는 반, 시트에 없는 칸 */
  function warnings(env) {
    var out = [], cal = calendar(env), cur = C.monthOf(env.now());
    if (cal._missing) out.push('기록장에 「달력」 탭이 없어요. 숙제 마감을 달력상 1일~말일로 계산하고 있어요. 「달력」 탭(월·개강·종강·휴강·메모)을 만들어 주세요.');
    else {
      var need = [cur, C.nextMonth(cur)];
      homework(env).forEach(function (h) { if (h.month >= cur && need.indexOf(h.month) < 0) need.push(h.month); });
      var miss = need.filter(function (m) { return !cal[m]; }).sort();
      if (miss.length) out.push('「달력」 탭에 ' + miss.map(function (m) { return (+m.slice(0, 4)) + '년 ' + (+m.slice(5)) + '월'; }).join(', ') + '이 없어요. 학원 계획표의 개강·종강·휴강을 넣어 주세요. (없으면 숙제 마감을 1일~말일로 계산)');
    }
    classes(env).forEach(function (c) {
      if (c.active && !C.classDays(c.time).days.length) out.push('「반」 탭의 ' + c.name + ' 요일시간(「' + c.time + '」)에서 수업 요일을 못 읽었어요. 「화목 20:20」처럼 적어 주세요. (숙제 마감 계산에 씀)');
    });
    if (env.store.head) Object.keys(TABLES).forEach(function (t) {
      var head; try { head = env.store.head(t); } catch (e) { return; }
      if (!head) return;
      var lack = TABLES[t].filter(function (h) { return head.indexOf(h) < 0; });
      if (lack.length) out.push('「' + t + '」 탭 첫 줄에 ' + lack.map(function (h) { return '「' + h + '」'; }).join('') + ' 칸이 없어요. 이 칸에 저장할 내용이 빠져요. 첫 줄 오른쪽 끝에 칸 이름을 적어 주세요.');
    });
    return out;
  }

  /** 3개월 지난 숙제 사진 지우기 (Code.gs 의 매일 트리거가 부름). trash(fileId) 는 드라이브 휴지통으로 옮김. 한 번에 max 장까지 */
  function cleanupPhotos(env, trash, max) {
    loadCore(); M = {};
    var before = stampOf(new Date(env.now().getTime() - PHOTO_KEEP_DAYS * 86400000)), done = 0, failed = 0;
    var old = env.store.all('숙제사진').filter(function (r) { return S(r['파일ID']) && S(r['올린시각']) && S(r['올린시각']) < before; }).slice(0, max || 200);
    old.forEach(function (r) {
      var id = S(r['파일ID']);
      try { trash(id); } catch (e) { failed++; }
      env.store.update('숙제사진', function (x) { return S(x['파일ID']) === id; },
        { '파일ID': '', '검사메모': (S(r['검사메모']) ? S(r['검사메모']) + ' · ' : '') + '3개월 지나 지움 (' + C.dateOf(env.now()) + ')' });
      done++;
    });
    return { removed: done, failed: failed, left: Math.max(0, env.store.all('숙제사진').filter(function (r) { return S(r['파일ID']) && S(r['올린시각']) < before; }).length) };
  }

  /** 숙제 마감 직접 정하기 (빈 값이면 자동 계산으로 되돌림) */
  function setHwDue(env, p) {
    var id = S(p.hw), due = S(p.due).trim() ? normDue(p.due) : '';
    if (S(p.due).trim() && !due) return fail('마감을 「2026-10-24 15:00」처럼 적어 주세요.');
    var n = env.store.update('숙제', function (r) { return S(r['숙제ID']) === id; }, { '마감': due });
    if (!n) return fail('숙제를 찾지 못했어요.');
    return ok(homework(env).filter(function (x) { return x.id === id; })[0]);
  }

  function saveResult(env, p) {
    var e = exams(env).filter(function (x) { return x.id === S(p.exam); })[0];
    if (!e) return fail('시험을 찾지 못했어요.');
    var stu = findStudent(env, C.normCode(p.code));
    if (!stu) return fail('학생을 찾지 못했어요.');
    var raw = C.cleanAnswers(p.answers, e.total);
    if (!raw) return fail('답안을 입력해 주세요.');
    var ans = C.padAnswers(raw, e.total), g = C.grade(e.key, ans);
    var row = { '시험ID': e.id, '번호': stu.code, '답안': ans, '맞은개수': g.score,
      '틀린번호': g.wrong.map(function (w) { return w.n; }).join(','), '입력일': stamp(env) };
    upsert(env, '시험결과', function (r) { return S(r['시험ID']) === e.id && S(r['번호']) === stu.code; }, row);
    return ok({ exam: e.id, code: stu.code, answers: ans, score: g.score, wrong: g.wrong.map(function (w) { return w.n; }), conv: null, at: row['입력일'] });
  }

  function deleteResult(env, p) {
    var n = env.store.remove('시험결과', function (r) { return S(r['시험ID']) === S(p.exam) && S(r['번호']) === S(p.code); });
    return ok({ removed: n });
  }

  function newId(env, prefix) { return prefix + env.now().getTime().toString(36).toUpperCase() + (env.rand32() % 1296).toString(36).toUpperCase(); }

  function addExam(env, p) {
    var total = Math.round(num(p.total)), key = C.cleanKey(p.key);
    if (!S(p.label).trim()) return fail('시험 이름을 적어 주세요.');
    if (!classes(env).some(function (c) { return c.code === S(p.cls); })) return fail('반을 골라 주세요.');
    if (total < 1 || total > 80) return fail('문항 수를 확인해 주세요.');
    if (key.length !== total) return fail('정답 개수가 문항 수와 달라요. (' + key.length + '/' + total + ')');
    var e = { '시험ID': newId(env, 'E'), '반코드': S(p.cls), '월': S(p.month) || C.monthOf(env.now()), '종류': S(p.kind) || '소테스트',
      '이름': S(p.label).trim(), '문항수': total, '정답': key, '시험일': S(p.date) || C.dateOf(env.now()), '등록일': stamp(env) };
    env.store.append('시험', e);
    return ok(exams(env).filter(function (x) { return x.id === e['시험ID']; })[0]);
  }

  function updateExamKey(env, p) {
    var e = exams(env).filter(function (x) { return x.id === S(p.exam); })[0];
    if (!e) return fail('시험을 찾지 못했어요.');
    var key = C.cleanKey(p.key);
    if (key.length !== e.total) return fail('정답 개수가 문항 수와 달라요.');
    env.store.update('시험', function (r) { return S(r['시험ID']) === e.id; }, { '정답': key });
    // 정답을 고치면 이미 입력한 결과를 다시 채점
    results(env).filter(function (r) { return r.exam === e.id; }).forEach(function (r) {
      var g = C.grade(key, r.answers);
      env.store.update('시험결과', function (x) { return S(x['시험ID']) === e.id && S(x['번호']) === r.code; },
        { '맞은개수': g.score, '틀린번호': g.wrong.map(function (w) { return w.n; }).join(',') });
    });
    return bootstrap(env);
  }

  function deleteExam(env, p) {
    var id = S(p.exam);
    if (results(env).some(function (r) { return r.exam === id; })) return fail('입력된 결과가 있는 시험은 지울 수 없어요.');
    env.store.remove('시험', function (r) { return S(r['시험ID']) === id; });
    return ok({ removed: id });
  }

  function addHomework(env, p) {
    if (!S(p.label).trim()) return fail('숙제 이름을 적어 주세요.');
    if (!classes(env).some(function (c) { return c.code === S(p.cls); })) return fail('반을 골라 주세요.');
    var p0 = num(p.p0), p1 = num(p.p1) || num(p.p0), total = num(p.total);
    if ((p0 || num(p.p1)) && (!p0 || p1 < p0)) return fail('쪽 범위를 확인해 주세요. (쓰지 않아도 돼요)');
    var h = { '숙제ID': newId(env, 'H'), '반코드': S(p.cls), '월': S(p.month) || C.monthOf(env.now()), '이름': S(p.label).trim(),
      '교재': S(p.book).trim(), '시작쪽': p0 || '', '끝쪽': p0 ? p1 : '', '문항수': total || '', '등록일': stamp(env) };
    env.store.append('숙제', h);
    return ok(homework(env).filter(function (x) { return x.id === h['숙제ID']; })[0]);
  }

  function deleteHomework(env, p) {
    var id = S(p.hw);
    if (hwSubs(env).some(function (s) { return s.hw === id; })) return fail('제출이 있는 숙제는 지울 수 없어요.');
    env.store.remove('숙제', function (r) { return S(r['숙제ID']) === id; });
    return ok({ removed: id });
  }

  function setChecked(env, p) {
    var n = env.store.update('숙제제출', function (r) { return S(r['숙제ID']) === S(p.hw) && S(r['번호']) === S(p.code); }, { '확인': p.checked ? 'Y' : 'N' });
    return n ? ok({ hw: S(p.hw), code: S(p.code), checked: !!p.checked }) : fail('제출 기록이 없어요.');
  }

  function proxyHw(env, p) {
    var h = homework(env).filter(function (x) { return x.id === S(p.hw); })[0];
    if (!h) return fail('숙제를 찾지 못했어요.');
    upsert(env, '숙제제출', function (r) { return S(r['숙제ID']) === h.id && S(r['번호']) === S(p.code); },
      { '숙제ID': h.id, '번호': S(p.code), '맞은개수': S(p.count) === '' ? '' : num(p.count), '사진수': 0, '확인': 'Y', '대리입력': 'Y', '최종제출일': stamp(env) });
    var sub = hwSubs(env).filter(function (s) { return s.hw === h.id && s.code === S(p.code); })[0];
    sub.late = false;
    return ok(sub);
  }

  function hwPhotos(env, p) {
    return ok(env.store.all('숙제사진').filter(function (r) { return S(r['숙제ID']) === S(p.hw) && S(r['번호']) === S(p.code); })
      .map(function (r) { return { order: num(r['순서']), fileId: S(r['파일ID']), gone: !S(r['파일ID']), at: S(r['올린시각']), check: S(r['검사']), note: S(r['검사메모']) }; })
      .sort(function (a, b) { return a.order - b.order; }));
  }

  /** 월초 명단 붙여넣기: 원생명단에서 이름을 찾아 번호를 쓰고, 없는 이름만 새 번호로 원생명단에 추가. 반은 수강 탭에 */
  function importRoster(env, p) {
    var cls = classes(env), parsed = C.parseRoster(p.text, cls), all = students(env);
    var used = {}; all.forEach(function (s) { used[s.code] = 1; });
    var byName = {}, byBase = {};
    all.forEach(function (s) { byName[s.name] = s; var b = C.baseName(s.name); (byBase[b] = byBase[b] || []).push(s); });
    var added = [], updated = [], cleared = [], seen = {}, ambiguous = [];
    parsed.rows.forEach(function (r) {
      var same = byName[r.name];
      if (!same) {
        var cand = byBase[C.baseName(r.name)] || [];
        if (cand.length === 1 && C.baseName(cand[0].name) === cand[0].name) same = cand[0];  // 명단에 괄호 없이 한 명뿐일 때만
        else if (cand.length) { ambiguous.push({ line: r.name, reason: '원생명단에 비슷한 이름이 있어요: ' + cand.map(function (x) { return x.name; }).join(', ') + ' — 명단과 같은 표기로 다시 넣어 주세요' }); return; }
      }
      var code;
      if (same) { code = same.code; updated.push({ name: same.name, code: code, classes: r.classes }); }
      else {
        code = C.genCode(env.rand32, function (c) { return !!used[c]; });
        used[code] = 1;
        env.store.append('원생', { '일련번호': code, '이름': r.name, '상태': '', '발급일': C.dateOf(env.now()), '메모': '성적노트에서 추가' });
        added.push({ name: r.name, code: code, classes: r.classes });
      }
      seen[code] = 1;
      upsert(env, '수강', function (x) { return C.normCode(x['번호']) === code; }, { '번호': code, '반코드': r.classes.join(','), '수정일': C.dateOf(env.now()) });
    });
    if (p.deactivateMissing && parsed.rows.length) {
      all.forEach(function (s) {
        if (!seen[s.code] && s.classes.length) {
          env.store.update('수강', function (x) { return C.normCode(x['번호']) === s.code; }, { '반코드': '', '수정일': C.dateOf(env.now()) });
          cleared.push({ name: s.name, code: s.code });
        }
      });
    }
    return ok({ added: added, updated: updated, deactivated: cleared, unknown: parsed.unknown.concat(ambiguous), students: students(env) });
  }

  /** 한 학생의 반 바꾸기 (빈 배열이면 이번 달 수강 없음) */
  function setClasses(env, p) {
    var code = C.normCode(p.code);
    if (!students(env).some(function (s) { return s.code === code; })) return fail('원생명단에 없는 번호예요.');
    var valid = classes(env).map(function (c) { return c.code; });
    var list = (p.classes || []).map(S).filter(function (c) { return valid.indexOf(c) >= 0; });
    upsert(env, '수강', function (x) { return C.normCode(x['번호']) === code; }, { '번호': code, '반코드': list.join(','), '수정일': C.dateOf(env.now()) });
    return ok({ code: code, classes: list });
  }

  function saveEval(env, p) {
    upsert(env, '평가', function (r) { return S(r['월']) === S(p.month) && S(r['번호']) === S(p.code); },
      { '월': S(p.month), '번호': S(p.code), '코멘트': S(p.text), '수정일': stamp(env) });
    return ok({ month: S(p.month), code: S(p.code), text: S(p.text) });
  }

  var STUDENT = { login: login, hwPhoto: hwPhoto, hwFinish: hwFinish };
  var ADMIN = { bootstrap: bootstrap, saveResult: saveResult, deleteResult: deleteResult, addExam: addExam, updateExamKey: updateExamKey,
    deleteExam: deleteExam, addHomework: addHomework, deleteHomework: deleteHomework, setChecked: setChecked, proxyHw: proxyHw,
    hwPhotos: hwPhotos, importRoster: importRoster, setClasses: setClasses, saveEval: saveEval, setHwDue: setHwDue };

  function handle(env, action, p) {
    p = p || {};
    loadCore();
    M = {};
    // 저장할 때마다 계산해 둔 표를 비움
    var st = env.store, env2 = Object.assign({}, env, { store: Object.assign({}, st, {
      append: function (t, o) { M = {}; return st.append(t, o); },
      update: function (t, f, o) { M = {}; return st.update(t, f, o); },
      remove: function (t, f) { M = {}; return st.remove(t, f); }
    }) });
    var res;
    try {
      if (action === 'ping') res = ok({ time: stamp(env2) });
      else if (action === 'adminLogin') res = adminLogin(env2, p);
      else if (STUDENT[action]) res = STUDENT[action](env2, p);
      else if (ADMIN[action]) res = isAdmin(env2, p.token) ? ADMIN[action](env2, p) : { ok: false, error: '관리자 로그인이 필요해요.', needLogin: true };
      else res = fail('알 수 없는 요청이에요: ' + action);
    } catch (e) {
      res = fail(e && e.message ? e.message : String(e));
      if (e && e.needLogin) res.needLogin = true;
    }
    M = {};
    res.ver = VERSION;
    return res;
  }

  /** 쓰기 요청인지 (서버에서 잠금 걸 때 사용) */
  var WRITES = ['hwPhoto', 'hwFinish', 'saveResult', 'deleteResult', 'addExam', 'updateExamKey', 'deleteExam', 'addHomework',
    'deleteHomework', 'setChecked', 'proxyHw', 'importRoster', 'setClasses', 'saveEval', 'setHwDue'];

  return { TABLES: TABLES, TEXT_COLS: TEXT_COLS, WRITES: WRITES, VERSION: VERSION, handle: handle, cleanupPhotos: cleanupPhotos };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Logic;


/**
 * 成績ノート — 구글 쪽 서버 (Apps Script 웹앱)
 *
 * 이 폴더의 파일 4개(Code.gs, Core.gs, Logic.gs, appsscript.json)를
 * 기록장 구글 시트의 「확장 프로그램 → Apps Script」에 붙여넣어 씁니다. 설치 순서는 README.md.
 *
 * - 화면(GitHub Pages)은 이 웹앱 주소로 {action, payload} 를 POST 합니다.
 * - 규칙(채점, 번호, 조회 범위)은 전부 Logic.gs 에 있고, 이 파일은 시트·드라이브·캐시를 연결만 합니다.
 * - Core.gs, Logic.gs 는 docs/assets 의 core.js, logic.js 를 복사한 것입니다. 여기서 직접 고치지 마세요.
 */


/* ---------- 웹앱 입구 ---------- */
function doGet() {
  return json_({ ok: true, data: { app: '성적노트', time: new Date().toISOString() }, ver: Logic.VERSION });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: '요청을 읽지 못했어요.' }); }
  var action = String(body.action || ''), payload = body.payload || {};
  if (action === 'ping') return json_({ ok: true, data: { time: new Date().toISOString() }, ver: Logic.VERSION });   // 시트를 열지 않음 (화면을 열 때 서버를 미리 깨우는 용도)
  var lock = null, write = Logic.WRITES.indexOf(action) >= 0;
  if (write) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return json_({ ok: false, error: '지금 저장하는 사람이 많아요. 잠시 뒤에 다시 눌러 주세요.' });
  }
  var env = makeEnv_(lock);
  try {
    return json_(Logic.handle(env, action, payload));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { env.store.flush(); } catch (err2) { bumpTables_(Object.keys(Logic.TABLES)); }   // 바뀐 표만 버전을 올리고 캐시에 바로 넣음
    if (lock) { try { lock.releaseLock(); } catch (err3) { /* 이미 풀림 */ } }
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 캐시: 시트를 매번 다 읽지 않도록 ----------
 * 읽은 표를 CacheService 에 최대 6시간 보관. 키에 「표 버전」(스크립트 속성 DV_<표이름>)이 들어감.
 * 저장하면 그 표만 버전이 바뀌고, 바뀐 내용을 곧바로 캐시에 넣어 둠 → 다른 표·다음 요청은 계속 캐시로 빠르게.
 * 시트를 손으로 고치면 onEdit 이 그 표 버전만 올림. 원생명단은 퇴실퀴즈도 고치는 시트라 20분 보관 + 10분마다 트리거가 새로 읽음(warmCache).
 * 메뉴 「캐시 비우기」로 전부 비울 수도 있음. */
var CACHE_SEC = 21600, ROSTER_CACHE_SEC = 1200, CACHE_CHUNK = 30000;  // 한 칸 100KB 제한 → 한글 3바이트 고려해 3만 자씩
var PROPS_ = null;
function props_() { if (!PROPS_) PROPS_ = PropertiesService.getScriptProperties().getProperties(); return PROPS_; }   // 한 요청에 한 번만 읽음
function prop_(k) { return props_()[k] || ''; }
function tableVer_(t) { return prop_('DV_' + t) || prop_('DATA_VER') || '0'; }
function bumpTables_(names) {
  if (!names.length) return '';
  var v = String(Date.now()) + String(Math.floor(Math.random() * 1000)), o = {};
  names.forEach(function (t) { o['DV_' + t] = v; });
  try { PropertiesService.getScriptProperties().setProperties(o); } catch (e) { return ''; }
  if (PROPS_) Object.keys(o).forEach(function (k) { PROPS_[k] = o[k]; });
  return v;
}
function bumpDataVer_() { bumpTables_(Object.keys(Logic.TABLES)); }
function cachePutBig_(key, str, sec) {
  var n = Math.max(1, Math.ceil(str.length / CACHE_CHUNK)), o = {};
  for (var i = 0; i < n; i++) o[key + ':' + i] = str.substr(i * CACHE_CHUNK, CACHE_CHUNK);
  o[key + ':n'] = String(n);
  try { CacheService.getScriptCache().putAll(o, sec); } catch (e) { /* 캐시에 못 넣어도 동작은 함 */ }
}
function cacheGetBig_(key) {
  var c = CacheService.getScriptCache(), n = Number(c.get(key + ':n'));
  if (!n) return null;
  var ks = []; for (var i = 0; i < n; i++) ks.push(key + ':' + i);
  var m = c.getAll(ks), s = '';
  for (i = 0; i < n; i++) { if (m[ks[i]] === undefined || m[ks[i]] === null) return null; s += m[ks[i]]; }
  return s;
}
/** 시트를 손으로 고치면 그 표의 캐시만 버림 (단순 트리거 — 따로 설정할 것 없음) */
function onEdit(e) {
  var name = '';
  try { name = e.range.getSheet().getName(); } catch (err) { name = ''; }
  if (Logic.TABLES[name]) bumpTables_([name]); else bumpDataVer_();
}
function clearCache() { bumpDataVer_(); notify_('캐시 비우기', '다음 조회부터 시트를 새로 읽어요.'); }

/* ---------- 저장소: 구글 시트 ---------- */
function spreadsheet_() {
  var id = prop_('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** getSheet(t) → 시트. opt = { prefix, sec, fixHead }.
 *  첫 줄이 비어 있으면 머리글을 써 넣고, Logic.TABLES 에 새로 생긴 칸이 첫 줄에 없으면 오른쪽 끝에 칸 이름을 붙임(fixHead) */
function sheetStore_(getSheet, opt) {
  var mem = {}, dirty = {};
  function key(t) { return opt.prefix + t + ':' + tableVer_(t); }
  function pack(c) { return JSON.stringify({ h: c.head, d: c.rows.map(function (o) { return c.head.map(function (h) { return o[h]; }); }) }); }
  /** fresh=true 이면 캐시를 쓰지 않고 시트에서 읽음 (쓰기 직전) */
  function load(t, fresh) {
    if (mem[t] && !(fresh && mem[t].cached)) return mem[t];
    if (!fresh) {
      var hit = null;
      try { hit = JSON.parse(cacheGetBig_(key(t)) || 'null'); } catch (e) { hit = null; }
      if (hit) {
        var rowsC = hit.d.map(function (r) { var o = {}; hit.h.forEach(function (h, i) { o[h] = r[i]; }); return o; });
        mem[t] = { sh: null, head: hit.h, rows: rowsC, cached: true };
        return mem[t];
      }
    }
    var sh = getSheet(t);
    if (!sh) throw new Error('시트 「' + t + '」가 없어요. 시트 메뉴 「성적노트 → 1. 초기 설정」을 먼저 실행해 주세요.');
    var values = sh.getDataRange().getValues();
    if (values[0].join('') === '' && Logic.TABLES[t]) {
      sh.getRange(1, 1, 1, Logic.TABLES[t].length).setValues([Logic.TABLES[t]]);
      values = [Logic.TABLES[t].slice()];
    }
    var head = values[0].map(function (h) { return String(h).trim(); });
    while (head.length && head[head.length - 1] === '') head.pop();
    if (opt.fixHead && Logic.TABLES[t]) {
      var lack = Logic.TABLES[t].filter(function (h) { return head.indexOf(h) < 0; });
      if (lack.length) {
        sh.getRange(1, head.length + 1, 1, lack.length).setNumberFormat('@').setValues([lack]);
        head = head.concat(lack);
      }
    }
    var rows = values.slice(1).map(function (r) {
      var o = {}; head.forEach(function (h, i) { o[h] = r[i] === null || r[i] === undefined ? '' : String(r[i]); }); return o;
    });
    mem[t] = { sh: sh, head: head, rows: rows };
    cachePutBig_(key(t), pack(mem[t]), opt.sec);
    return mem[t];
  }
  function toRow(c, o) { return c.head.map(function (h) { return o[h] === undefined || o[h] === null ? '' : String(o[h]); }); }
  return {
    all: function (t) { return load(t).rows.map(function (r) { return Object.assign({}, r); }); },
    head: function (t) { return load(t).head.slice(); },
    append: function (t, o) {
      var c = load(t, true), row = toRow(c, o), r = c.sh.getLastRow() + 1;
      var range = c.sh.getRange(r, 1, 1, c.head.length);
      range.setNumberFormat('@');           // 0으로 시작하는 답안·번호가 숫자로 바뀌지 않게
      range.setValues([row]);
      var copy = {}; c.head.forEach(function (h, i) { copy[h] = row[i]; });
      c.rows.push(copy); dirty[t] = 1;
    },
    update: function (t, pred, patch) {
      var c = load(t, true), n = 0;
      c.rows.forEach(function (r, i) {
        if (!pred(r)) return;
        Object.keys(patch).forEach(function (k) { if (c.head.indexOf(k) >= 0) r[k] = String(patch[k] === null ? '' : patch[k]); });
        var range = c.sh.getRange(i + 2, 1, 1, c.head.length);
        range.setNumberFormat('@');
        range.setValues([toRow(c, r)]);
        n++;
      });
      if (n) dirty[t] = 1;
      return n;
    },
    remove: function (t, pred) {
      var c = load(t, true), idx = [];
      c.rows.forEach(function (r, i) { if (pred(r)) idx.push(i); });
      for (var k = idx.length - 1; k >= 0; k--) { c.sh.deleteRow(idx[k] + 2); c.rows.splice(idx[k], 1); }
      if (idx.length) dirty[t] = 1;
      return idx.length;
    },
    /** 바뀐 표: 버전을 올리고 지금 내용을 새 버전 캐시에 바로 넣음 (다음 사람이 시트를 다시 읽지 않게) */
    flush: function () {
      var ts = Object.keys(dirty); dirty = {};
      if (!ts.length) return;
      bumpTables_(ts);
      ts.forEach(function (t) { if (mem[t]) cachePutBig_(key(t), pack(mem[t]), opt.sec); });
    },
    /** 캐시에 없으면 읽어 둠 (fresh=true 면 시트에서 새로) */
    warm: function (t, fresh) { load(t, !!fresh); }
  };
}

/** 원생명단(퇴실퀴즈와 같이 쓰는 시트)이 연결돼 있으면 「원생」은 그 시트의 첫 탭, 아니면 기록장 안의 「원생」 탭 */
function rosterId_() { return prop_('ROSTER_ID'); }
function makeStore_() {
  var ss = null, rid = rosterId_();
  function book() { return ss || (ss = spreadsheet_()); }   // 캐시로 다 되면 시트 파일을 열지도 않음
  var main = sheetStore_(function (t) { return book().getSheetByName(t); }, { prefix: 'tb:', sec: CACHE_SEC, fixHead: true });
  var roster = rid ? sheetStore_(function () { return SpreadsheetApp.openById(rid).getSheets()[0]; }, { prefix: 'ro:', sec: ROSTER_CACHE_SEC, fixHead: false }) : null;
  function pick(t) { return t === '원생' && roster ? roster : main; }
  return {
    all: function (t) { return pick(t).all(t); },
    head: function (t) { return pick(t).head(t); },
    append: function (t, o) { return pick(t).append(t, o); },
    update: function (t, f, o) { return pick(t).update(t, f, o); },
    remove: function (t, f) { return pick(t).remove(t, f); },
    flush: function () { main.flush(); if (roster) roster.flush(); },
    warm: function (t, fresh) { return pick(t).warm(t, fresh); }
  };
}

/* ---------- 사진: 구글 드라이브 ---------- */
var PHOTO_FOLDER_NAME = '성적노트_숙제사진', BACKUP_FOLDER_NAME = '성적노트_백업', BACKUP_KEEP = 30;
function photoRoot_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 지워졌으면 새로 만듦 */ } }
  var f = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', f.getId());
  return f;
}
function subFolder_(parent, name) {
  name = String(name || '기타').replace(/[\/\\]/g, '_');
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function saveImage_(o) {
  var folder = photoRoot_();
  (o.folders || []).forEach(function (n) { folder = subFolder_(folder, n); });
  var blob = Utilities.newBlob(Utilities.base64Decode(o.b64), o.mime, o.name);
  return folder.createFile(blob).getId();
}

/* ---------- env 조립 ---------- */
/** lock: 쓰기 요청이면 잡은 잠금. 사진을 드라이브에 저장하는 동안은 잠금을 잠깐 풀어 다른 학생 저장이 줄 서지 않게 함 */
function makeEnv_(lock) {
  var cache = CacheService.getScriptCache();
  return {
    store: makeStore_(),
    cache: {
      get: function (k) { return cache.get(k); },
      put: function (k, v, sec) { cache.put(k, String(v), Math.min(21600, Math.max(1, sec))); },
      remove: function (k) { cache.remove(k); }
    },
    props: { get: function (k) { return prop_(k); } },
    now: function () { return new Date(); },
    uuid: function () { return Utilities.getUuid(); },
    rand32: function () { return parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16); },
    saveImage: function (o) {
      if (!lock) return saveImage_(o);
      lock.releaseLock();
      try { return saveImage_(o); }
      finally { if (!lock.tryLock(25000)) throw new Error('지금 저장하는 사람이 많아요. 잠시 뒤에 다시 올려 주세요.'); }
    }
  };
}

/* ---------- 매일·10분마다 도는 일 (트리거: 편집기 「트리거」에서 시간 기반으로 추가) ---------- */
/** 10분마다: 캐시를 미리 채워 둠 (원생명단은 새로 읽음) → 학생·선생님이 시트 읽기를 기다리지 않게 */
function warmCache() {
  var st = makeStore_();
  Object.keys(Logic.TABLES).forEach(function (t) { try { st.warm(t, t === '원생'); } catch (e) { /* 없는 탭은 건너뜀 */ } });
}

/** 매일: 3개월 지난 숙제 사진을 드라이브 휴지통으로 (휴지통에서 30일 뒤 완전히 지워짐). 시트에는 「3개월 지나 지움」 표시 */
function cleanupPhotos() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return;
  var env = makeEnv_(null), r;
  try {
    r = Logic.cleanupPhotos(env, function (id) { DriveApp.getFileById(id).setTrashed(true); }, 300);
  } finally { env.store.flush(); lock.releaseLock(); }
  Logger.log('사진 정리: ' + r.removed + '장 지움' + (r.failed ? ', ' + r.failed + '장은 이미 없음' : '') + (r.left ? ', 남은 ' + r.left + '장은 다음에' : ''));
}

/** 매일(또는 메뉴에서): 기록장 모든 탭 + 원생명단을 값 그대로 새 스프레드시트로 복사해 「성적노트_백업」 폴더에. 최근 30개만 남김 */
function backupNow() {
  var src = spreadsheet_(), stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HHmm');
  var dst = SpreadsheetApp.create('성적노트 백업 ' + stamp + ' (' + src.getName() + ')');
  src.getSheets().forEach(function (sh) { sh.copyTo(dst).setName(sh.getName()); });
  var rid = rosterId_();
  if (rid) { try { SpreadsheetApp.openById(rid).getSheets()[0].copyTo(dst).setName('원생명단(퇴실퀴즈)'); } catch (e) { /* 못 열면 건너뜀 */ } }
  var first = dst.getSheets()[0]; if (dst.getSheets().length > 1 && /^(시트|Sheet)\s*1$/.test(first.getName())) dst.deleteSheet(first);
  var props = PropertiesService.getScriptProperties(), fid = props.getProperty('BACKUP_FOLDER_ID'), folder = null;
  if (fid) { try { folder = DriveApp.getFolderById(fid); } catch (e) { folder = null; } }
  if (!folder) { folder = DriveApp.createFolder(BACKUP_FOLDER_NAME); props.setProperty('BACKUP_FOLDER_ID', folder.getId()); }
  DriveApp.getFileById(dst.getId()).moveTo(folder);
  var files = [], it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (/^성적노트 백업 /.test(f.getName())) files.push(f); }
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });
  notify_('백업', '「' + BACKUP_FOLDER_NAME + '」 폴더에 저장했어요: ' + dst.getName() + ' (최근 ' + BACKUP_KEEP + '개 보관)');
}

/* ---------- 시트 메뉴 ---------- */
/** 시트에서 메뉴로 실행하면 알림창, Apps Script 편집기에서 실행하면 실행 로그에 남김 */
function notify_(title, msg) {
  try { var ui = SpreadsheetApp.getUi(); ui.alert(title, msg, ui.ButtonSet.OK); }
  catch (e) { Logger.log(title + ': ' + msg); }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('성적노트')
    .addItem('1. 초기 설정 (시트·사진 폴더 만들기)', 'setup')
    .addItem('2. 관리자 비밀번호 설정', 'setAdminPassword')
    .addItem('3. 원생명단 시트 연결', 'connectRoster')
    .addSeparator()
    .addItem('학생 화면에 정답 보이기 켜기/끄기', 'toggleShowKey')
    .addItem('캐시 비우기 (시트를 고쳤는데 화면에 안 보일 때)', 'clearCache')
    .addItem('지금 백업하기', 'backupNow')
    .addItem('설정 상태 보기', 'showStatus')
    .addToUi();
}

var SEED_CLASSES = [
  ['GN-SS', '개념반 토일 15:00', '개념', '토일 15:00', 'Y'],
  ['GN-HM', '개념반 화목 20:20', '개념', '화목 20:20', 'Y'],
  ['DP-SS', '단풀반 토일 13:00', '단풀', '토일 13:00', 'Y'],
  ['SJ-D', '실전문풀 D', '실전', '토일 10:00', 'Y'],
  ['SJ-E', '실전문풀 E', '실전', '화목 18:00', 'Y']
];

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  Object.keys(Logic.TABLES).forEach(function (name) {
    if (name === '원생' && rosterId_()) return;   // 원생명단 시트를 쓰면 기록장에는 원생 탭을 만들지 않음
    var head = Logic.TABLES[name], sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(head.length, 1)).setNumberFormat('@');
    var cur = sh.getRange(1, 1, 1, head.length).getValues()[0].map(String);
    // 새로 생긴 칸(뒤에 붙는 칸)은 머리글만 채움 — 앞의 칸은 이미 있는 것과 같아야 함
    var bad = cur.some(function (h, i) { return h !== '' && h !== head[i]; }) || cur.some(function (h, i) { return h === '' && cur.slice(i).join('') !== ''; });
    if (bad) throw new Error('「' + name + '」 시트의 첫 줄이 예상과 달라요: ' + head.join(', '));
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#12233F').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  });
  var cls = ss.getSheetByName('반');
  if (cls.getLastRow() < 2) cls.getRange(2, 1, SEED_CLASSES.length, 5).setValues(SEED_CLASSES);
  var first = ss.getSheets()[0];
  if (first.getName() !== '반' && first.getLastRow() === 0) ss.deleteSheet(first); // 빈 「시트1」 정리
  var folder = photoRoot_();
  bumpDataVer_();
  notify_('초기 설정 완료',
    '시트 ' + Object.keys(Logic.TABLES).length + '개와 사진 폴더 「' + folder.getName() + '」를 준비했어요.\n' +
    '「반」 시트의 반 이름·시간을 확인하고, 다음으로 「관리자 비밀번호 설정」을 해 주세요.\n' +
    '(본판은 이어서 「3. 원생명단 시트 연결」까지. 개발판은 연결하지 않고 이 기록장 안의 「원생」 탭을 씁니다.)');
}

/** 관리자 비밀번호: 입력 칸이 ●●● 로 가려지는 창 (ui.prompt 는 글자가 그대로 보여서 안 씀) */
function setAdminPassword() {
  var html = HtmlService.createHtmlOutput(
    '<style>body{font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:14px;margin:0;padding:4px 2px;color:#191F28}' +
    'label{display:block;margin:12px 0 6px;font-weight:600;color:#6B7684}input{width:100%;box-sizing:border-box;padding:10px 12px;font-size:15px;border:1px solid #D1D6DB;border-radius:10px}' +
    'p{margin:6px 0;color:#6B7684;font-size:13px}#msg{color:#F04452;min-height:18px}button{margin-top:14px;padding:10px 18px;border:0;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}' +
    '#ok{background:#3182F6;color:#fff}#no{background:#F2F4F6;color:#333D4B;margin-right:6px}.row{text-align:right}</style>' +
    '<p>영문·숫자·특수문자를 모두 섞어 8자 이상으로 정해 주세요. 입력한 글자는 화면에 보이지 않아요.</p>' +
    '<label for="a">새 비밀번호</label><input id="a" type="password" autocomplete="new-password" autofocus>' +
    '<label for="b">한 번 더</label><input id="b" type="password" autocomplete="new-password">' +
    '<p><label style="display:inline;font-weight:400"><input type="checkbox" id="s" style="width:auto"> 입력한 글자 보기</label></p>' +
    '<p id="msg" role="alert"></p><div class="row"><button id="no" type="button">취소</button><button id="ok" type="button">저장</button></div>' +
    '<script>' +
    'var A=document.getElementById("a"),B=document.getElementById("b"),M=document.getElementById("msg"),K=document.getElementById("ok");' +
    'document.getElementById("s").onchange=function(){A.type=B.type=this.checked?"text":"password";};' +
    'document.getElementById("no").onclick=function(){google.script.host.close();};' +
    'function go(){if(A.value!==B.value){M.textContent="두 칸이 달라요.";return;}K.disabled=true;M.textContent="";' +
    'google.script.run.withSuccessHandler(function(r){if(r){M.textContent=r;K.disabled=false;}else{M.style.color="#0B9E5E";M.textContent="저장했어요.";setTimeout(function(){google.script.host.close();},900);}})' +
    '.withFailureHandler(function(e){M.textContent=String(e&&e.message||e);K.disabled=false;}).saveAdminPassword(A.value);}' +
    'K.onclick=go;B.onkeydown=function(e){if(e.key==="Enter")go();};' +
    '</script>').setWidth(380).setHeight(330);
  SpreadsheetApp.getUi().showModalDialog(html, '관리자 비밀번호 설정');
}
/** 위 창에서 부름. 문제가 있으면 안내 문장을, 저장했으면 '' 를 돌려줌. 저장하면 이미 로그인한 강사 화면은 모두 다시 로그인해야 함 */
function saveAdminPassword(pw) {
  pw = String(pw || '').trim();
  if (pw.length < 8) return '8자 이상으로 정해 주세요.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) return '영문·숫자·특수문자를 모두 넣어 주세요.';
  var p = PropertiesService.getScriptProperties();
  p.setProperties({ ADMIN_PASSWORD: pw, ADMIN_GEN: String(Date.now()) });   // ADMIN_GEN 이 바뀌면 예전 로그인은 무효
  return '';
}

function connectRoster() {
  var ui = SpreadsheetApp.getUi(), p = PropertiesService.getScriptProperties();
  var r = ui.prompt('원생명단 시트 연결',
    '퇴실퀴즈와 같이 쓰는 「원생명단」 시트 주소를 붙여넣으세요.\n비우고 확인을 누르면 연결을 끊고 이 기록장의 「원생」 탭을 씁니다.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var txt = r.getResponseText().trim();
  if (!txt) { p.deleteProperty('ROSTER_ID'); ui.alert('연결을 끊었어요. 이제 이 기록장의 「원생」 탭을 씁니다. (없으면 「1. 초기 설정」을 다시 실행)'); return; }
  var m = txt.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  ui.alert(connectRosterById_(m ? m[1] : txt));
}

/** 원생명단 시트를 연결 (첫 줄이 비어 있으면 머리글을 써 넣음). 결과 문장을 돌려줌 */
function connectRosterById_(id) {
  var sh;
  try { sh = SpreadsheetApp.openById(id).getSheets()[0]; } catch (e) { return '그 시트를 열지 못했어요. 주소를 확인해 주세요.'; }
  var head = sh.getRange(1, 1, 1, Math.max(5, sh.getLastColumn())).getValues()[0].map(function (h) { return String(h).trim(); });
  if (head.join('') === '') {
    sh.getRange(1, 1, sh.getMaxRows(), 5).setNumberFormat('@');
    sh.getRange(1, 1, 1, 5).setValues([Logic.TABLES['원생']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (head.indexOf('일련번호') < 0 || head.indexOf('이름') < 0) {
    return '첫 줄에 「일련번호」「이름」 칸이 있어야 해요. 지금 첫 줄: ' + head.filter(String).join(', ');
  }
  PropertiesService.getScriptProperties().setProperty('ROSTER_ID', id);
  bumpDataVer_();
  return '연결했어요: ' + SpreadsheetApp.openById(id).getName() + '\n이제 학생 이름·번호는 이 명단에서 읽고, 새 원생은 이 명단에 추가합니다.';
}

function toggleShowKey() {
  var p = PropertiesService.getScriptProperties(), on = p.getProperty('SHOW_KEY') === 'Y';
  p.setProperty('SHOW_KEY', on ? 'N' : 'Y');
  notify_('정답 공개', on ? '학생 화면에서 정답을 숨겼어요. (틀린 번호만 보임)' : '학생 화면에 틀린 문항의 정답과 내 답이 보여요.');
}

function showStatus() {
  var p = PropertiesService.getScriptProperties();
  notify_('설정 상태',
    '기록장 시트: ' + (p.getProperty('SHEET_ID') ? '연결됨' : '초기 설정 필요') + '\n' +
    '사진 폴더: ' + (p.getProperty('PHOTO_FOLDER_ID') ? '있음' : '초기 설정 필요') + '\n' +
    '관리자 비밀번호: ' + (p.getProperty('ADMIN_PASSWORD') ? '설정됨' : '없음') + '\n' +
    '원생명단: ' + (p.getProperty('ROSTER_ID') ? '연결됨 (' + SpreadsheetApp.openById(p.getProperty('ROSTER_ID')).getName() + ')' : '연결 안 함 — 기록장의 「원생」 탭 사용') + '\n' +
    '학생 화면 정답 공개: ' + (p.getProperty('SHOW_KEY') === 'Y' ? '켜짐' : '꺼짐'));
}
