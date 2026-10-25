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
    '시험지': ['시험지ID', '반종류', '과목', '종류', '회차', '이름', '문항수', '정답', '출처', '문항과목'],   // 문항과목: 실전 시험 문항마다 정·경·현·지·역 한 글자 (취약 과목용)
    // 달력: 학원 연간 계획표 (숙제 마감 계산). 월 = 'YYYY-MM', 휴강 = 날짜를 쉼표로 (예: 2026-11-08, 2026-11-09)
    '달력': ['월', '개강', '종강', '휴강', '메모'],
    // 계획서: 지난 월간 강의계획서의 일정 줄 (월초 강의계획서 내려받기가 내용·교재 범위를 이어서 씀). 반 = 실전 D·E
    '계획서': ['월', '반종류', '과목', '반', '회차', '날짜', '내용', '범위', '과제'],
    // 계획서머리: 계획서 위쪽 칸 (반 종류·과목마다 가장 최근 것을 씀)
    '계획서머리': ['월', '반종류', '과목', '반', '부제', '강의명', '강의목표', '담당강사', '연락처', '강의기간', '강의시간', '강의실', '교재', '질문시간', '질문방법', '평가방법']
  };
  /** 서버·화면 코드 버전 — tools/sync-gas.sh 가 core.js·logic.js·Code.gs 내용으로 자동으로 바꿈. 화면이 서버 응답의 ver 와 비교해 다르면 경고 */
  var VERSION = '06caabf220';
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
  /** 실전반 환산점수(득점등화, Core.equate) — 「시험결과」 환산점수 칸이 비어 있는 실전 모의고사·월말에 씀.
   *  칸에 값이 있으면(7~10월 실전.xlsx 에서 옮겨 온 공식 값) 그 값을 그대로 둠. 달마다 그 달 실전 응답 전부로 다시 계산되므로 새 답안이 들어오면 자동 반영.
   *  → { '시험ID|번호': 환산점수 } */
  function equated(env) {
    return memo('equated', function () {
      // 시험결과·시험이 바뀌지 않았으면 캐시 (계산은 수십 ms 지만 학생 로그인마다 하지 않게)
      var rs = results(env), last = '';
      rs.forEach(function (r) { if (r.at > last) last = r.at; });
      var ck = 'eq1:' + rs.length + ':' + last + ':' + exams(env).length;
      var hit = env.cache && env.cache.get(ck);
      if (hit) { try { return JSON.parse(hit); } catch (e) { /* 다시 계산 */ } }
      var kind = {}, out = {}, byMonth = {};
      classes(env).forEach(function (c) { kind[c.code] = c.kind; });
      var ex = {};
      exams(env).forEach(function (e) { if (kind[e.cls] === '실전' && (e.kind === '모의고사' || e.kind === '월말테스트') && e.total) ex[e.id] = e; });
      results(env).forEach(function (r) {
        var e = ex[r.exam]; if (!e || r.score > e.total) return;
        var v = itemVec(r, e), x = v ? v.x : null, mask = v ? v.mask : null;
        (byMonth[e.month] || (byMonth[e.month] = [])).push({ r: r, row: x ? { p: r.code, exam: e.id, x: x } : null, mask: mask });
      });
      Object.keys(byMonth).forEach(function (m) {
        var list = byMonth[m], q = C.equate(list.map(function (o) { return o.row; }).filter(Boolean));
        if (!q) return;
        list.forEach(function (o) { var v = q.score(o.r.exam, o.r.score, o.mask); if (v !== null) out[o.r.exam + '|' + o.r.code] = v; });
      });
      try { if (env.cache) env.cache.put(ck, JSON.stringify(out), 21600); } catch (e) { /* 캐시 크기 넘으면 그냥 둠 */ }
      return out;
    });
  }
  /** 한 응답의 문항별 정오 { x:[1|0|null], mask } — 답안이 있으면 답안으로(안 쓴 문항 = null), 옮겨 온 성적은 틀린 번호로. 알 수 없으면 null */
  function itemVec(r, e) {
    var x = [], mask = null, i;
    if (r.answers && e.key && e.key.length === e.total) {
      var a = C.padAnswers(r.answers, e.total); mask = [];
      for (i = 0; i < e.total; i++) { var ch = a.charAt(i); x.push(ch === '0' ? null : (ch === e.key.charAt(i) ? 1 : 0)); mask.push(ch !== '0'); }
      return { x: x, mask: mask };
    }
    if (r.score === e.total || (r.wrong.length && r.score + r.wrong.length === e.total)) {
      for (i = 1; i <= e.total; i++) x.push(r.wrong.indexOf(i) >= 0 ? 0 : 1);
      return { x: x, mask: null };
    }
    return null;
  }
  var SUBJ_CODE = { '경': '경제', '정': '정치', '현': '현대사회', '지': '지리', '역': '역사' }, SUBJ_ORDER = ['경제', '정치', '현대사회', '지리', '역사'];
  function labelKey(l) { return S(l).replace(/\s+/g, '').replace(/\((\d)\)$/, '-$1'); }   // 「EJU 2011(2)」 = 「EJU 2011-2」
  /** 실전반 과목별 정답률: 학생이 본 실전 시험(시험지 「문항과목」이 있는 것)마다 문항을 과목으로 나눠
   *  내 정답률과 반 평균(같은 시험을 본 학생 전체 합산)을 달별·종합으로. 취약 = (내 정답률 − 반 평균)이 가장 낮은 과목(4문항 이상)
   *  → { all: {subs, weak, n}, months: [{m, subs, weak, n}] } 또는 null */
  /** 실전반 D·E 는 같은 달 같은 이름 시험을 한 묶음으로 (반 평균·등수용). 다른 반 종류는 시험 하나가 한 묶음 */
  function groupKey(e, kindOfCls) { return kindOfCls[e.cls] === '실전' ? '실전|' + e.month + '|' + labelKey(e.label) + '|' + e.total : 'x|' + e.id; }
  function subjStats(env, stu, exById, byExam, kindOfCls, groupOf) {
    var sub = {};
    papers(env).forEach(function (p) { if (p.subjs && p.subjs.length === p.total) sub[labelKey(p.label)] = p.subjs; });
    var groups = {}, any = false;
    function grp(k) { return groups[k] || (groups[k] = { me: {}, all: {}, n: 0 }); }
    Object.keys(byExam).forEach(function (id) {
      var e = exById[id]; if (!e || kindOfCls[e.cls] !== '실전' || !e.total) return;
      var sj = sub[labelKey(e.label)]; if (!sj || sj.length !== e.total) return;
      var rs = groupOf ? groupOf(e) : byExam[id], mine = null;
      byExam[id].forEach(function (r) { if (r.code === stu.code) mine = r; });
      if (!mine) return;
      var mv = itemVec(mine, e); if (!mv) return;
      any = true;
      [grp('all'), grp(e.month)].forEach(function (g) {
        g.n++;
        function add(bag, v) {
          for (var i = 0; i < e.total; i++) {
            if (v.x[i] === null) continue;
            var nm = SUBJ_CODE[sj.charAt(i)]; if (!nm) continue;
            var o = bag[nm] || (bag[nm] = [0, 0]); o[0] += v.x[i]; o[1]++;
          }
        }
        add(g.me, mv);
        rs.forEach(function (r) { if (r.score > e.total) return; var v = itemVec(r, e); if (v) add(g.all, v); });
      });
    });
    if (!any) return null;
    function pack(g) {
      var subs = SUBJ_ORDER.filter(function (nm) { return g.me[nm]; }).map(function (nm) {
        var a = g.me[nm], b = g.all[nm] || [0, 0];
        return { s: nm, c: a[0], t: a[1], me: Math.round(a[0] / a[1] * 1000) / 10, avg: b[1] ? Math.round(b[0] / b[1] * 1000) / 10 : null };
      });
      var weak = null, gap = Infinity;
      subs.forEach(function (o) { if (o.t < 4 || o.avg === null) return; var d = o.me - o.avg; if (d < gap || (d === gap && o.me < weak.me)) { gap = d; weak = o; } });
      return { subs: subs, weak: weak ? weak.s : null, n: g.n };
    }
    return { all: pack(groups.all), months: Object.keys(groups).filter(function (k) { return k !== 'all'; }).sort().map(function (m) { var o = pack(groups[m]); o.m = m; return o; }) };
  }
  /** 문항 분석 (강사 화면 「문항 분석」): 시험 하나의 문항마다 그 반 정답률·고른 답 분포와,
   *  같은 시험의 누적(반 종류 + 시험 이름이 같고 문항 수·정답이 같은 모든 달·모든 반) 정답률·분포.
   *  D = 강사 bootstrap 데이터 { exams, results, classes, papers }. 빈칸('0')은 틀린 것으로 셈(점수와 같게).
   *  답안이 없는 옮겨 온 성적은 틀린 번호로 정답률에만, 점수만 있으면 평균에만 들어감.
   *  flags: low(그 반 정답률 50% 미만) · below(누적보다 15%p 이상 낮음) · cumLow(누적 50% 미만) · trap(한 오답에 30% 이상 몰림)
 *  — 이 반은 4명, 누적은 6명 이상 답했을 때만 */
  var ITEM_LOW = 50, ITEM_BELOW = 15, ITEM_TRAP = 30, ITEM_MIN = 4, ITEM_MIN_CUM = 6;   // 몇 명 안 되는 반에서 한 명 차이로 표시되지 않게
  function itemStats(D, id) {
    loadCore();
    var kindOf = {}, e = null;
    (D.classes || []).forEach(function (c) { kindOf[c.code] = c.kind; });
    (D.exams || []).forEach(function (x) { if (x.id === id) e = x; });
    if (!e || !e.total) return null;
    var n = e.total, kind = kindOf[e.cls], lk = labelKey(e.label), subjs = '';
    (D.papers || []).forEach(function (p) { if (labelKey(p.label) === lk && p.subjs && p.subjs.length === n) subjs = p.subjs; });
    var same = (D.exams || []).filter(function (x) {
      return kindOf[x.cls] === kind && labelKey(x.label) === lk && x.total === n && (!e.key || !x.key || x.key === e.key);   // 정답이 다르면 다른 버전
    });
    var sameId = {}; same.forEach(function (x) { sameId[x.id] = x; });
    function bag() { var it = []; for (var i = 0; i < n; i++) it.push({ c: 0, t: 0, d: 0, blank: 0, dist: {} }); return { n: 0, sum: 0, items: it, months: {} }; }
    var here = bag(), cum = bag();
    function add(b, r, x) {
      if (r.score > n) return;   // 입력 오타
      b.n++; b.sum += r.score / n; b.months[x.month] = 1;
      var key = x.key && x.key.length === n ? x.key : e.key, i, it;
      if (r.answers && key && key.length === n) {
        var a = C.padAnswers(r.answers, n);
        for (i = 0; i < n; i++) {
          it = b.items[i]; var ch = a.charAt(i);
          it.t++; it.d++; if (ch === key.charAt(i)) it.c++;
          if (ch === '0') it.blank++; else it.dist[ch] = (it.dist[ch] || 0) + 1;
        }
      } else if (r.score === n || (r.wrong.length && r.score + r.wrong.length === n)) {
        for (i = 0; i < n; i++) { it = b.items[i]; it.t++; if (r.wrong.indexOf(i + 1) < 0) it.c++; }
      }
    }
    // 실전반은 D·E 를 하나로: 「이 반」 = 그 달 같은 이름 실전 시험 전체 (2026-10-22 사용자)
    function isHere(x) { return x.id === e.id || (kind === '실전' && x.month === e.month); }
    (D.results || []).forEach(function (r) {
      var x = sameId[r.exam]; if (!x) return;
      add(cum, r, x);
      if (isHere(x)) add(here, r, x);
    });
    function pct(a, t) { return t ? Math.round(a / t * 1000) / 10 : null; }
    function one(it, k) {
      var top = null;
      Object.keys(it.dist).forEach(function (ch) { if (ch !== k && (!top || it.dist[ch] > it.dist[top])) top = ch; });
      var dist = {}; Object.keys(it.dist).forEach(function (ch) { dist[ch] = pct(it.dist[ch], it.d); });
      return { rate: pct(it.c, it.t), t: it.t, d: it.d, blank: pct(it.blank, it.d), dist: dist,
        trap: top ? { ch: top, pct: pct(it.dist[top], it.d), cnt: it.dist[top] } : null };
    }
    var items = [];
    for (var i = 0; i < n; i++) {
      var k = e.key ? e.key.charAt(i) : '', h = one(here.items[i], k), c = one(cum.items[i], k), f = [];
      if (h.t >= ITEM_MIN && h.rate < ITEM_LOW) f.push('low');
      if (h.t >= ITEM_MIN && c.t >= ITEM_MIN_CUM && c.t > h.t && h.rate - c.rate <= -ITEM_BELOW) f.push('below');
      if (c.t >= ITEM_MIN_CUM && c.rate < ITEM_LOW) f.push('cumLow');
      // 오답 쏠림: 한 오답을 30% 이상이 고름 (이 반은 2명 이상, 누적은 3명 이상이 같은 오답)
      if ((h.trap && h.d >= ITEM_MIN && h.trap.cnt >= 2 && h.trap.pct >= ITEM_TRAP) || (c.trap && c.d >= ITEM_MIN_CUM && c.trap.cnt >= 3 && c.trap.pct >= ITEM_TRAP)) f.push('trap');
      items.push({ i: i + 1, key: k, subj: subjs ? (SUBJ_CODE[subjs.charAt(i)] || '') : '', here: h, cum: c, flags: f });
    }
    return { id: e.id, label: e.label, month: e.month, cls: e.cls, kind: kind, total: n,
      here: { n: here.n, avg: here.n ? Math.round(here.sum / here.n * 1000) / 10 : null },
      cum: { n: cum.n, avg: cum.n ? Math.round(cum.sum / cum.n * 1000) / 10 : null, exams: same.length, months: Object.keys(cum.months).sort() },
      items: items };
  }
  /** 학생에게 보여 줄 환산점수: 칸에 득점등화 값(7~10월 실전.xlsx)이 있으면 그 값, 비었거나 단순 비례 값(6월처럼 정답 수/문항 수×200)이면 계산한 득점등화 값 */
  function convOf(env, r) {
    var e = memo('exById', function () { var m = {}; exams(env).forEach(function (x) { m[x.id] = x; }); return m; })[r.exam];
    var simple = r.conv !== null && e && e.total && Math.abs(r.conv - r.score / e.total * 200) < 0.06;
    if (r.conv !== null && !simple) return r.conv;
    var v = equated(env)[r.exam + '|' + r.code];
    return v === undefined ? r.conv : v;
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
        label: S(r['이름']), total: num(r['문항수']), key: C.cleanKey(r['정답']), src: S(r['출처']), subjs: S(r['문항과목']).replace(/\s+/g, '') };
    }).filter(function (p) { return p.id && p.label && p.total > 0; });
  }
  /* ---------- 단풀반 EJU 기출: 학생이 직접 입력 (2026-10-25) ----------
   * 단풀반에서만 푸는 과목별 「EJU 기출」(시험지 DP-과목-G, 소테스트)은 선생님이 「답안 입력」으로 넣기도 하고 학생이 직접 넣기도 함 —
   * 같은 시험·같은 시험결과 칸에 저장(둘 중 나중에 넣은 것이 남음). 이번 달 그 시험이 아직 등록 안 됐으면 시험지로 자동 등록. 정답은 학생에게 안 보냄. */
  function practicePapers(env) {
    return papers(env).filter(function (x) { return x.ban === '단풀' && /EJU 기출/.test(x.label) && x.key.length === x.total; });
  }
  function danpulClasses(env, stu) {
    var kind = {}; classes(env).forEach(function (c) { kind[c.code] = c.kind; });
    return stu.classes.filter(function (c) { return kind[c] === '단풀'; });
  }
  /** 학생: 입력할 수 있는 기출 목록(과목·문항 수만, 정답은 안 보냄) */
  function practiceList(env, p) {
    var stu = studentFor(env, p);
    if (!danpulClasses(env, stu).length) return fail('단풀반 학생만 쓸 수 있어요.');
    return ok(practicePapers(env).map(function (x) { return { id: x.id, label: x.label, subj: x.subj, n: x.total }; }));
  }
  /** 학생: 답안 제출 → 서버가 채점해 시험결과에 저장 (정답은 안 알려 주고 틀린 번호만). 다시 넣으면 덮어씀 */
  function practiceSubmit(env, p) {
    var stu = studentFor(env, p), mine = danpulClasses(env, stu);
    if (!mine.length) return fail('단풀반 학생만 쓸 수 있어요.');
    var pp = practicePapers(env).filter(function (x) { return x.id === S(p.paper); })[0];
    if (!pp) return fail('시험지를 찾지 못했어요.');
    var month = C.monthOf(env.now()), ex = exams(env);
    // 이번 달 이 과목 시험이 이미 있는 내 단풀반을 먼저, 없으면 첫 단풀반
    var e = null;
    mine.forEach(function (cc) { if (!e) e = ex.filter(function (x) { return x.cls === cc && x.month === month && x.label === pp.label; })[0] || null; });
    if (!e) {
      var row = { '시험ID': newId(env, 'E'), '반코드': mine[0], '월': month, '종류': pp.kind || '소테스트', '이름': pp.label, '문항수': pp.total, '정답': pp.key,
        '시험일': C.dateOf(env.now()), '등록일': stamp(env) };
      env.store.append('시험', row); M = {};
      e = { id: row['시험ID'], total: pp.total, key: pp.key };
    }
    var ans = S(p.answers).replace(/[^0-9]/g, '');
    if (ans.length > e.total) return fail('답이 문항 수(' + e.total + '개)보다 많아요.');
    ans = C.padAnswers(ans, e.total);
    if (!/[1-9]/.test(ans)) return fail('답을 입력해 주세요.');
    var g = C.grade(e.key, ans), wrong = g.wrong.map(function (w) { return w.n; });
    upsert(env, '시험결과', function (r) { return S(r['시험ID']) === e.id && S(r['번호']) === stu.code; },
      { '시험ID': e.id, '번호': stu.code, '답안': ans, '맞은개수': g.score, '틀린번호': wrong.join(','), '입력일': stamp(env) });
    var v = studentView(env, stu);
    v.last = { label: pp.label, subj: pp.subj, score: g.score, total: e.total, wrong: wrong };
    return ok(v);
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
    // 실전반은 D·E 가 같은 시험을 따로 등록해도 하나로 봄 (2026-10-22 사용자): 반 평균·등수·인원·환산 평균을 그 달 같은 이름 시험 전체로
    var byGroup = {};
    rs.forEach(function (r) { var e = exById[r.exam]; if (e) (byGroup[groupKey(e, kindOfCls)] || (byGroup[groupKey(e, kindOfCls)] = [])).push(r); });
    function groupOf(e) { return byGroup[groupKey(e, kindOfCls)] || []; }
    var exByCls = {}, hwByCls = {};
    ex.forEach(function (e) { (exByCls[e.cls] || (exByCls[e.cls] = [])).push(e); });
    hw.forEach(function (h) { (hwByCls[h.cls] || (hwByCls[h.cls] = [])).push(h); });
    var subjInfo = null;
    try { subjInfo = subjStats(env, stu, exById, byExam, kindOfCls, groupOf); } catch (err) { subjInfo = null; }   // 시험지 탭이 없거나 이상해도 로그인은 되게
    // 실전반 달마다 환산점수 평균·등수 (2026-10-22 사용자): 그 달 실전 시험(D·E 합쳐서)을 하나라도 본 학생마다 환산점수 평균 → 내 평균의 등수(같은 평균은 같은 등수)
    var realMonth = {};
    try {
      var perM = {};
      rs.forEach(function (r) {
        var e = exById[r.exam]; if (!e || kindOfCls[e.cls] !== '실전' || !e.month || (e.total && r.score > e.total)) return;
        var cv = convOf(env, r); if (cv === null || cv === undefined || isNaN(cv)) return;
        var m = perM[e.month] || (perM[e.month] = {}); (m[r.code] || (m[r.code] = [])).push(+cv);
      });
      Object.keys(perM).forEach(function (mo) {
        var codes = Object.keys(perM[mo]), avgs = codes.map(function (c) { return C.mean(perM[mo][c]); });
        var mineL = perM[mo][stu.code]; if (!mineL) return;
        var mine = C.mean(mineL);
        realMonth[mo] = { avg: Math.round(mine * 10) / 10, rank: 1 + avgs.filter(function (v) { return v > mine + 1e-9; }).length, n: codes.length,
          classAvg: Math.round(C.mean(avgs) * 10) / 10, tests: mineL.length };
      });
    } catch (err2) { realMonth = {}; }
    return {
      name: stu.name, code: stu.code, subj: subjInfo, realMonth: realMonth,
      danpul: danpulClasses(env, stu).length > 0,
      classes: cls.filter(function (c) { return mine.indexOf(c.code) >= 0; }).sort(function (a, b) {
        return (stu.classes.indexOf(a.code) < 0) - (stu.classes.indexOf(b.code) < 0); // 지금 듣는 반 먼저
      }).map(function (c) {
        var current = stu.classes.indexOf(c.code) >= 0;
        var tests = (exByCls[c.code] || []).slice().sort(examSort).map(function (e) {
          var me = null, all = [], convs = [];
          (byExam[e.id] || []).forEach(function (r) { if (r.code === stu.code) me = r; });
          groupOf(e).forEach(function (r) {
            if (!(e.total && r.score > e.total)) all.push(r.score);   // 입력 오타(문항 수보다 큰 점수)는 반 평균에서 뺌
            var cv = convOf(env, r); if (cv !== null) convs.push(cv);
          });
          // 등수: 같은 시험(그 반·그 달)에서 나보다 점수가 높은 사람 수 + 1 (같은 점수는 같은 등수). 다른 학생 이름·점수는 안 보냄
          var rank = me && !(e.total && me.score > e.total) ? 1 + all.filter(function (x) { return x > me.score; }).length : null;
          var t = { id: e.id, month: e.month, kind: e.kind, label: e.label, date: e.date, total: e.total,
            score: me ? me.score : null, avg: C.mean(all), n: all.length, rank: rank,
            conv: me ? convOf(env, me) : null, convAvg: C.mean(convs), wrong: me ? me.wrong : [] };
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
    logAccess(env, stu, p);
    // 학생 열쇠: 숙제 제출은 번호 대신 이 열쇠로만 받음 (번호를 넣어 보며 맞히는 길을 막음)
    var tok = env.uuid();
    env.cache.put('stu:' + tok, stu.code, STU_TTL);
    var v = studentView(env, stu); v.tok = tok;
    return ok(v);
  }

  /* ---------- 접속기록 (2026-10-22 사용자) ----------
   * 기록장이 아니라 따로 둔 접속기록 스프레드시트(해마다 파일 하나)에 쌓음. 서버는 로그인 때 캐시에만 적고 10분마다 모아서 붙임(로그인이 느려지지 않게).
   * 구분: 로그인(번호를 넣고 들어옴) / 자동(「기억하기」로 열어 뒤에서 새로 불러옴, 숙제 내다 열쇠가 지나 다시 들어옴). 강사 「학생별」로 본 것은 남기지 않음 */
  var ACCESS_HEAD = ['시각', '번호', '이름', '구분', '기기'];
  function logAccess(env, stu, p) {
    if (!env.logAccess) return;
    var row = { '시각': stamp(env), '번호': stu.code, '이름': stu.name, '구분': S(p.auto) === '1' ? '자동' : '로그인', '기기': S(p.dev).replace(/[^A-Za-z0-9]/g, '').slice(0, 8) };
    try { env.logAccess(row); } catch (e) { /* 기록을 못 해도 로그인은 그대로 */ }
  }
  /** 강사: 학생마다 마지막 접속·최근 30일 중 들어온 날 수·전체 횟수, code 를 주면 그 학생의 최근 기록 100개 */
  function accessLog(env, p) {
    var rows;
    try { rows = env.readLog ? env.readLog() : []; } catch (e) { return fail('접속기록을 읽지 못했어요: ' + (e && e.message || e)); }
    var since = C.dateOf(new Date(env.now().getTime() - 29 * 86400000)), sum = {}, code = C.normCode(p.code || ''), mine = [];
    rows.forEach(function (r) {
      var c = C.normCode(r['번호']), t = S(r['시각']); if (!c || !t) return;
      var o = sum[c] || (sum[c] = { last: '', total: 0, days: {} });
      o.total++; if (t > o.last) o.last = t;
      if (t.slice(0, 10) >= since) o.days[t.slice(0, 10)] = 1;
      if (code && c === code) mine.push({ at: t, kind: S(r['구분']), dev: S(r['기기']) });
    });
    Object.keys(sum).forEach(function (c) { sum[c].days30 = Object.keys(sum[c].days).length; delete sum[c].days; });
    mine.sort(function (a, b) { return b.at.localeCompare(a.at); });
    return ok({ sum: sum, rows: mine.slice(0, 100) });
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
    // 순서는 서버가 정함 (2026-10-23): 화면이 보낸 순서는 다시 낼 때 1부터 다시 세는 일이 있어 「1·1·2·2…」로 겹쳤음 → 이 숙제에 올린 사진 중 가장 큰 순서 + 1
    var order = env.store.all('숙제사진').reduce(function (m, r) { return S(r['숙제ID']) === h.id && S(r['번호']) === stu.code ? Math.max(m, num(r['순서']) || 0) : m; }, 0) + 1;
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
      .map(function (r, i) { return { order: num(r['순서']), fileId: S(r['파일ID']), gone: !S(r['파일ID']), at: S(r['올린시각']), check: S(r['검사']), note: S(r['검사메모']), i: i }; })
      // 올린 순서대로 1, 2, 3… (예전에 다시 내며 순서가 겹친 기록도 겹치지 않게)
      .sort(function (a, b) { return a.at.localeCompare(b.at) || a.order - b.order || a.i - b.i; })
      .map(function (x, k) { delete x.i; x.order = k + 1; return x; }));
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

  /** 강사 화면 「학생별」: 그 학생이 보는 화면 그대로 (학생 열쇠·로그인 잠금 없이, 퇴원생도) */
  function studentAs(env, p) {
    var stu = findStudent(env, C.normCode(p.code));
    if (!stu) return fail('학생을 찾지 못했어요.');
    return ok(studentView(env, stu));
  }

  /** 숙제 사진 한 장을 서버가 읽어 보냄 (2026-10-23) — 브라우저가 구글 드라이브 썸네일을 못 받을 때(구글 로그인 안 됨·다른 구글 계정·쿠키 차단) 강사 화면이 대신 부름.
   *  「숙제사진」 탭에 있는 파일만 (드라이브의 다른 파일은 못 읽게) */
  function photo(env, p) {
    var id = S(p.id);
    if (!id || !env.readImage || !env.store.all('숙제사진').some(function (r) { return S(r['파일ID']) === id; })) return fail('사진을 찾지 못했어요.');
    return ok(env.readImage(id));
  }

  var STUDENT = { login: login, hwPhoto: hwPhoto, hwFinish: hwFinish, practiceList: practiceList, practiceSubmit: practiceSubmit };
  var ADMIN = { bootstrap: bootstrap, saveResult: saveResult, deleteResult: deleteResult, addExam: addExam, updateExamKey: updateExamKey,
    deleteExam: deleteExam, addHomework: addHomework, deleteHomework: deleteHomework, setChecked: setChecked, proxyHw: proxyHw,
    hwPhotos: hwPhotos, importRoster: importRoster, setClasses: setClasses, saveEval: saveEval, setHwDue: setHwDue, studentAs: studentAs, accessLog: accessLog, photo: photo };

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
  var WRITES = ['hwPhoto', 'hwFinish', 'practiceSubmit', 'saveResult', 'deleteResult', 'addExam', 'updateExamKey', 'deleteExam', 'addHomework',
    'deleteHomework', 'setChecked', 'proxyHw', 'importRoster', 'setClasses', 'saveEval', 'setHwDue'];

  return { TABLES: TABLES, ACCESS_HEAD: ACCESS_HEAD, TEXT_COLS: TEXT_COLS, WRITES: WRITES, VERSION: VERSION, handle: handle, cleanupPhotos: cleanupPhotos, itemStats: itemStats };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Logic;
