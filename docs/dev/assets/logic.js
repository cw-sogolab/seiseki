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
        });
        var hws = hw.filter(function (h) { return h.cls === c.code; }).map(function (h) {
          var s = subs.filter(function (x) { return x.hw === h.id && x.code === stu.code; })[0];
          return { id: h.id, month: h.month, label: h.label, book: h.book, p0: h.p0, p1: h.p1, total: h.total,
            done: !!s, count: s ? s.count : null, photos: s ? s.photos : 0, checked: s ? s.checked : false };
        });
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
    var pw = S(env.props.get('ADMIN_PASSWORD'));
    if (!pw) return fail('관리자 비밀번호가 아직 없어요. 구글 시트 메뉴 「성적노트 → 관리자 비밀번호 설정」에서 정해 주세요.');
    if (S(p.password) !== pw) {
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
    var p0 = num(p.p0), p1 = num(p.p1), total = num(p.total);
    if (!p0 || !p1 || p1 < p0) return fail('쪽 범위를 확인해 주세요.');
    var h = { '숙제ID': newId(env, 'H'), '반코드': S(p.cls), '월': S(p.month) || C.monthOf(env.now()), '이름': S(p.label).trim(),
      '교재': S(p.book).trim(), '시작쪽': p0, '끝쪽': p1, '문항수': total || '', '등록일': stamp(env) };
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
