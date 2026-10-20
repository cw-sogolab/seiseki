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
    '숙제': ['숙제ID', '반코드', '월', '이름', '교재', '시작쪽', '끝쪽', '문항수', '등록일'],
    '숙제제출': ['숙제ID', '번호', '맞은개수', '사진수', '확인', '대리입력', '최종제출일'],
    '숙제사진': ['숙제ID', '번호', '순서', '파일ID', '올린시각'],
    '평가': ['월', '번호', '코멘트', '수정일']
  };
  /** 숫자로 바뀌면 안 되는 열(앞자리 0, 긴 숫자열) — Code.gs 가 텍스트 서식으로 고정 */
  var TEXT_COLS = ['일련번호', '번호', '정답', '답안', '틀린번호', '반코드', '시험ID', '숙제ID', '파일ID', '월', '시험일'];

  var LOGIN_FAILS = 5, LOCK_SEC = 60, GLOBAL_FAILS = 40, ADMIN_TTL = 6 * 3600;
  // 관리자 비밀번호는 짧을 수 있어서(4자), 기기를 바꿔 가며 계속 맞혀 보는 것을 막는 전체 한도: 1시간에 20번 틀리면 1시간 막음
  var ADMIN_GLOBAL_FAILS = 20, ADMIN_GLOBAL_SEC = 3600;

  function ok(data) { return { ok: true, data: data }; }
  function fail(msg) { return { ok: false, error: msg }; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function stamp(env) { var d = env.now(); return C.dateOf(d) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  function upsert(env, t, pred, obj) {
    if (env.store.update(t, pred, obj) === 0) env.store.append(t, obj);
  }

  /* ---------- 읽기 ---------- */
  function classes(env) {
    return env.store.all('반').map(function (r) {
      return { code: S(r['반코드']), name: S(r['반이름']), kind: S(r['종류']), time: S(r['요일시간']), active: S(r['활성']) !== 'N' };
    }).filter(function (c) { return c.code; });
  }
  /** 원생명단 + 수강 → [{code, name, classes, active, status, issued}]  (active = 상태가 「차단」이 아님) */
  function students(env) {
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
  function exams(env) {
    return env.store.all('시험').map(function (r) {
      return { id: S(r['시험ID']), cls: S(r['반코드']), month: S(r['월']), kind: S(r['종류']), label: S(r['이름']),
        total: num(r['문항수']), key: C.cleanKey(r['정답']), date: S(r['시험일']), created: S(r['등록일']) };
    }).filter(function (e) { return e.id; });
  }
  function results(env) {
    return env.store.all('시험결과').map(function (r) {
      return { exam: S(r['시험ID']), code: S(r['번호']), answers: S(r['답안']), score: num(r['맞은개수']),
        wrong: S(r['틀린번호']).split(',').filter(Boolean).map(Number), conv: S(r['환산점수']) === '' ? null : num(r['환산점수']), at: S(r['입력일']) };
    }).filter(function (r) { return r.exam; });
  }
  function homework(env) {
    return env.store.all('숙제').map(function (r) {
      return { id: S(r['숙제ID']), cls: S(r['반코드']), month: S(r['월']), label: S(r['이름']), book: S(r['교재']),
        p0: num(r['시작쪽']), p1: num(r['끝쪽']), total: num(r['문항수']), created: S(r['등록일']) };
    }).filter(function (h) { return h.id; });
  }
  function hwSubs(env) {
    return env.store.all('숙제제출').map(function (r) {
      return { hw: S(r['숙제ID']), code: S(r['번호']), count: S(r['맞은개수']) === '' ? null : num(r['맞은개수']), photos: num(r['사진수']),
        checked: S(r['확인']) === 'Y', proxy: S(r['대리입력']) === 'Y', at: S(r['최종제출일']) };
    }).filter(function (r) { return r.hw; });
  }
  function evals(env) {
    return env.store.all('평가').map(function (r) { return { month: S(r['월']), code: S(r['번호']), text: S(r['코멘트']) }; });
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
    // 지금 듣는 반 + 예전에 기록이 있는 반 (반이 매달 바뀌어도 지난 성적이 보이게)
    var curMonth = C.monthOf(env.now());
    var mine = stu.classes.slice();
    function add(c) { if (c && mine.indexOf(c) < 0) mine.push(c); }
    rs.forEach(function (r) { if (r.code === stu.code) ex.forEach(function (e) { if (e.id === r.exam) add(e.cls); }); });
    subs.forEach(function (x) { if (x.code === stu.code) hw.forEach(function (h) { if (h.id === x.hw) add(h.cls); }); });
    return {
      name: stu.name, code: stu.code,
      classes: cls.filter(function (c) { return mine.indexOf(c.code) >= 0; }).sort(function (a, b) {
        return (stu.classes.indexOf(a.code) < 0) - (stu.classes.indexOf(b.code) < 0); // 지금 듣는 반 먼저
      }).map(function (c) {
        var tests = ex.filter(function (e) { return e.cls === c.code; }).sort(examSort).map(function (e) {
          var mine = null, all = [], convs = [];
          rs.forEach(function (r) {
            if (r.exam !== e.id) return;
            all.push(r.score); if (r.conv !== null) convs.push(r.conv);
            if (r.code === stu.code) mine = r;
          });
          var t = { id: e.id, month: e.month, kind: e.kind, label: e.label, date: e.date, total: e.total,
            score: mine ? mine.score : null, avg: C.mean(all), n: all.length,
            conv: mine ? mine.conv : null, convAvg: C.mean(convs), wrong: mine ? mine.wrong : [] };
          if (showKey && mine) t.wrongDetail = C.grade(e.key, mine.answers).wrong;
          return t;
        }).filter(function (t) {
          // 지난 달은 본 시험만, 이번 달은 지금 듣는 반의 시험 전부 (반이 달마다 바뀌어도 남의 달 시험이 「미응시」로 쌓이지 않게)
          return t.score !== null || (t.month >= curMonth && stu.classes.indexOf(c.code) >= 0);
        });
        var hws = hw.filter(function (h) { return h.cls === c.code; }).map(function (h) {
          var s = subs.filter(function (x) { return x.hw === h.id && x.code === stu.code; })[0];
          return { id: h.id, month: h.month, label: h.label, book: h.book, p0: h.p0, p1: h.p1, total: h.total,
            done: !!s, count: s ? s.count : null, photos: s ? s.photos : 0, checked: s ? s.checked : false };
        }).filter(function (w) { return w.done || (w.month >= curMonth && stu.classes.indexOf(c.code) >= 0); });
        return { code: c.code, name: c.name, kind: c.kind, time: c.time, current: stu.classes.indexOf(c.code) >= 0, tests: tests, hw: hws };
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
    return ok(studentView(env, stu));
  }

  function studentFor(env, p) {
    var code = C.normCode(p.code), stu = C.isValidCode(code) ? findStudent(env, code) : null;
    if (!stu || !stu.active) throw new Error('번호를 다시 확인해 주세요.');
    return stu;
  }
  function hwFor(env, stu, id) {
    var h = homework(env).filter(function (x) { return x.id === S(id); })[0];
    if (!h || stu.classes.indexOf(h.cls) < 0) throw new Error('이 숙제를 찾지 못했어요.');
    return h;
  }

  function hwPhoto(env, p) {
    var stu = studentFor(env, p), h = hwFor(env, stu, p.hw);
    var b64 = S(p.b64);
    if (!b64) return fail('사진이 비어 있어요.');
    if (b64.length > 10 * 1024 * 1024) return fail('사진이 너무 커요. 다시 찍어 주세요.');
    var mime = /^image\/(jpeg|png|webp|heic)$/.test(S(p.mime)) ? S(p.mime) : 'image/jpeg';
    var order = num(p.order) || 1;
    var c = classes(env).filter(function (x) { return x.code === h.cls; })[0];
    var fileId = env.saveImage({
      folders: [(c ? c.name : h.cls), h.month, h.label],
      name: stu.code + '_' + h.id + '_' + ('0' + order).slice(-2) + '.' + mime.split('/')[1].replace('jpeg', 'jpg'),
      mime: mime, b64: b64
    });
    env.store.append('숙제사진', { '숙제ID': h.id, '번호': stu.code, '순서': order, '파일ID': fileId, '올린시각': stamp(env) });
    return ok({ fileId: fileId });
  }

  function hwFinish(env, p) {
    var stu = studentFor(env, p), h = hwFor(env, stu, p.hw);
    var count = S(p.count) === '' ? '' : Math.max(0, Math.min(h.total || 9999, Math.round(num(p.count))));
    var photos = env.store.all('숙제사진').filter(function (r) { return S(r['숙제ID']) === h.id && S(r['번호']) === stu.code; }).length;
    if (!photos) return fail('사진을 한 장 이상 올려 주세요.');
    upsert(env, '숙제제출', function (r) { return S(r['숙제ID']) === h.id && S(r['번호']) === stu.code; },
      { '숙제ID': h.id, '번호': stu.code, '맞은개수': count, '사진수': photos, '확인': 'N', '대리입력': 'N', '최종제출일': stamp(env) });
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
    env.cache.put('adm:' + token, '1', ADMIN_TTL);
    return ok({ token: token });
  }
  function isAdmin(env, token) { return !!token && env.cache.get('adm:' + S(token)) === '1'; }

  function bootstrap(env) {
    return ok({ classes: classes(env), students: students(env), exams: exams(env), results: results(env),
      homework: homework(env), hwSubs: hwSubs(env), evals: evals(env), today: C.dateOf(env.now()) });
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
    return ok(hwSubs(env).filter(function (s) { return s.hw === h.id && s.code === S(p.code); })[0]);
  }

  function hwPhotos(env, p) {
    return ok(env.store.all('숙제사진').filter(function (r) { return S(r['숙제ID']) === S(p.hw) && S(r['번호']) === S(p.code); })
      .map(function (r) { return { order: num(r['순서']), fileId: S(r['파일ID']), at: S(r['올린시각']) }; })
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
    hwPhotos: hwPhotos, importRoster: importRoster, setClasses: setClasses, saveEval: saveEval };

  function handle(env, action, p) {
    p = p || {};
    loadCore();
    try {
      if (action === 'ping') return ok({ time: stamp(env) });
      if (action === 'adminLogin') return adminLogin(env, p);
      if (STUDENT[action]) return STUDENT[action](env, p);
      if (ADMIN[action]) {
        if (!isAdmin(env, p.token)) return { ok: false, error: '관리자 로그인이 필요해요.', needLogin: true };
        return ADMIN[action](env, p);
      }
      return fail('알 수 없는 요청이에요: ' + action);
    } catch (e) {
      return fail(e && e.message ? e.message : String(e));
    }
  }

  /** 쓰기 요청인지 (서버에서 잠금 걸 때 사용) */
  var WRITES = ['hwPhoto', 'hwFinish', 'saveResult', 'deleteResult', 'addExam', 'updateExamKey', 'deleteExam', 'addHomework',
    'deleteHomework', 'setChecked', 'proxyHw', 'importRoster', 'setClasses', 'saveEval'];

  return { TABLES: TABLES, TEXT_COLS: TEXT_COLS, WRITES: WRITES, handle: handle };
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

var PHOTO_FOLDER_NAME = '성적노트_숙제사진';

/* ---------- 웹앱 입구 ---------- */
function doGet() {
  return json_({ ok: true, data: { app: '성적노트', time: new Date().toISOString() } });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: '요청을 읽지 못했어요.' }); }
  var action = String(body.action || ''), payload = body.payload || {};
  var lock = null;
  if (Logic.WRITES.indexOf(action) >= 0) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ ok: false, error: '지금 저장하는 사람이 많아요. 잠시 뒤에 다시 눌러 주세요.' });
  }
  var write = !!lock;
  try {
    // 쓰기 요청은 시트를 직접 읽음(행 위치가 정확해야 하므로). 읽기 요청은 캐시를 씀
    return json_(Logic.handle(makeEnv_(!write), action, payload));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    if (write) bumpDataVer_();
    if (lock) lock.releaseLock();
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 캐시: 시트를 매번 다 읽지 않도록 ----------
 * 읽은 표를 CacheService 에 최대 6시간 보관. 키에 「데이터 버전」이 들어가서
 * 화면에서 저장하거나(doPost 쓰기) 시트를 손으로 고치면(onEdit) 버전이 바뀌고, 다음 조회 때 새로 읽음.
 * 원생명단은 퇴실퀴즈도 고치는 시트라 10분만 보관. 메뉴 「캐시 비우기」로 바로 비울 수도 있음. */
var CACHE_SEC = 21600, ROSTER_CACHE_SEC = 600, CACHE_CHUNK = 30000;  // 한 칸 100KB 제한 → 한글 3바이트 고려해 3만 자씩
function dataVer_() {
  var p = PropertiesService.getScriptProperties(), v = p.getProperty('DATA_VER');
  if (!v) { v = String(Date.now()); p.setProperty('DATA_VER', v); }
  return v;
}
function bumpDataVer_() {
  try { PropertiesService.getScriptProperties().setProperty('DATA_VER', String(Date.now()) + String(Math.floor(Math.random() * 1000))); } catch (e) { /* 다음 요청에서 다시 */ }
}
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
/** 시트를 손으로 고치면 캐시를 버림 (단순 트리거 — 따로 설정할 것 없음) */
function onEdit() { bumpDataVer_(); }
function clearCache() { bumpDataVer_(); notify_('캐시 비우기', '다음 조회부터 시트를 새로 읽어요.'); }

/* ---------- 저장소: 구글 시트 ---------- */
function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** getSheet(t) → 시트. 첫 줄이 비어 있으면 Logic.TABLES 의 머리글을 써 넣음 */
function sheetStore_(getSheet, cacheOpt) {
  var mem = {};
  /** fresh=true 이면 캐시를 쓰지 않고 시트에서 읽음 (쓰기 직전) */
  function load(t, fresh) {
    if (mem[t] && !(fresh && mem[t].cached)) return mem[t];
    var key = cacheOpt ? cacheOpt.prefix + t : '';
    if (key && !fresh) {
      var hit = null;
      try { hit = JSON.parse(cacheGetBig_(key) || 'null'); } catch (e) { hit = null; }
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
    var rows = values.slice(1).map(function (r) {
      var o = {}; head.forEach(function (h, i) { o[h] = r[i] === null ? '' : String(r[i]); }); return o;
    });
    mem[t] = { sh: sh, head: head, rows: rows };
    if (key) cachePutBig_(key, JSON.stringify({ h: head, d: rows.map(function (o) { return head.map(function (h) { return o[h]; }); }) }), cacheOpt.sec);
    return mem[t];
  }
  function toRow(c, o) { return c.head.map(function (h) { return o[h] === undefined || o[h] === null ? '' : String(o[h]); }); }
  return {
    all: function (t) { return load(t).rows.map(function (r) { return Object.assign({}, r); }); },
    append: function (t, o) {
      var c = load(t, true), row = toRow(c, o), r = c.sh.getLastRow() + 1;
      var range = c.sh.getRange(r, 1, 1, c.head.length);
      range.setNumberFormat('@');           // 0으로 시작하는 답안·번호가 숫자로 바뀌지 않게
      range.setValues([row]);
      var copy = {}; c.head.forEach(function (h, i) { copy[h] = row[i]; });
      c.rows.push(copy);
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
      return n;
    },
    remove: function (t, pred) {
      var c = load(t, true), idx = [];
      c.rows.forEach(function (r, i) { if (pred(r)) idx.push(i); });
      for (var k = idx.length - 1; k >= 0; k--) { c.sh.deleteRow(idx[k] + 2); c.rows.splice(idx[k], 1); }
      return idx.length;
    }
  };
}

/** 원생명단(퇴실퀴즈와 같이 쓰는 시트)이 연결돼 있으면 「원생」은 그 시트의 첫 탭, 아니면 기록장 안의 「원생」 탭 */
function rosterId_() { return PropertiesService.getScriptProperties().getProperty('ROSTER_ID') || ''; }
function makeStore_(useCache) {
  var ss = null, rid = rosterId_(), ver = useCache ? dataVer_() : '';
  function book() { return ss || (ss = spreadsheet_()); }   // 캐시로 다 되면 시트 파일을 열지도 않음
  var main = sheetStore_(function (t) { return book().getSheetByName(t); }, useCache ? { prefix: 'tbl:' + ver + ':', sec: CACHE_SEC } : null);
  var roster = rid ? sheetStore_(function () { return SpreadsheetApp.openById(rid).getSheets()[0]; }, useCache ? { prefix: 'ros:' + ver + ':', sec: ROSTER_CACHE_SEC } : null) : null;
  function pick(t) { return t === '원생' && roster ? roster : main; }
  return {
    all: function (t) { return pick(t).all(t); },
    append: function (t, o) { return pick(t).append(t, o); },
    update: function (t, f, o) { return pick(t).update(t, f, o); },
    remove: function (t, f) { return pick(t).remove(t, f); }
  };
}

/* ---------- 사진: 구글 드라이브 ---------- */
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
function makeEnv_(useCache) {
  var cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties();
  return {
    store: makeStore_(!!useCache),
    cache: {
      get: function (k) { return cache.get(k); },
      put: function (k, v, sec) { cache.put(k, String(v), Math.min(21600, Math.max(1, sec))); },
      remove: function (k) { cache.remove(k); }
    },
    props: { get: function (k) { return props.getProperty(k) || ''; } },
    now: function () { return new Date(); },
    uuid: function () { return Utilities.getUuid(); },
    rand32: function () { return parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16); },
    saveImage: saveImage_
  };
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
    if (cur.join('') === '') sh.getRange(1, 1, 1, head.length).setValues([head]);
    else if (cur.join('|') !== head.join('|')) throw new Error('「' + name + '」 시트의 첫 줄이 예상과 달라요: ' + head.join(', '));
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

function setAdminPassword() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('관리자 비밀번호', '강사 화면에 들어갈 때 쓸 비밀번호 (4자 이상)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var pw = r.getResponseText().trim();
  if (pw.length < 4) { ui.alert('4자 이상으로 정해 주세요.'); return; }
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', pw);
  ui.alert('저장했어요. 이미 로그인한 강사 화면은 6시간 안에 자동으로 다시 로그인을 요청해요.');
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
