/* 미리보기 모드: 서버 없이 브라우저 메모리에서 같은 규칙(Logic)으로 동작합니다.
 * config.js 의 API_URL 이 비어 있거나 주소에 ?demo 가 있으면 이 모드로 열립니다.
 * 예시 학생 번호 KM482919, 강사 비밀번호 demo. 새로고침하면 처음 상태로 돌아갑니다.
 */
var SeisekiMock = (function () {
  var L = (typeof Logic !== 'undefined') ? Logic : require('./logic.js');
  var Cr = (typeof Core !== 'undefined') ? Core : require('./core.js');

  function createEnv(opts) {
    opts = opts || {};
    var tables = {}, cache = {}, images = {}, imgSeq = 0, clock = opts.now || function () { return new Date(); };
    Object.keys(L.TABLES).forEach(function (t) { tables[t] = []; });
    function rand32() {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) { var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
      return Math.floor(Math.random() * 4294967296);
    }
    var env = {
      store: {
        all: function (t) { return (tables[t] || []).map(function (r) { return Object.assign({}, r); }); },
        append: function (t, o) { tables[t].push(Object.assign({}, o)); },
        update: function (t, pred, patch) { var n = 0; tables[t].forEach(function (r) { if (pred(r)) { Object.assign(r, patch); n++; } }); return n; },
        remove: function (t, pred) { var before = tables[t].length; tables[t] = tables[t].filter(function (r) { return !pred(r); }); return before - tables[t].length; }
      },
      cache: {
        get: function (k) { var c = cache[k]; if (!c) return null; if (c.exp < Date.now()) { delete cache[k]; return null; } return c.v; },
        put: function (k, v, sec) { cache[k] = { v: v, exp: Date.now() + sec * 1000 }; },
        remove: function (k) { delete cache[k]; }
      },
      props: { get: function (k) { return ({ ADMIN_PASSWORD: 'demo', SHOW_KEY: 'N' })[k] || ''; } },
      now: clock,
      uuid: function () { return 'tok-' + rand32().toString(36) + rand32().toString(36); },
      rand32: rand32,
      saveImage: function (o) { var id = 'mock-' + (++imgSeq); images[id] = 'data:' + o.mime + ';base64,' + o.b64; return id; },
      // 미리보기: AI 사진 확인 흉내 — 2번째 사진은 「이름 칸 비어 있음」으로 걸리게
      checkPhoto: function (o) { return o.order === 2 ? { ok: false, msg: '이름 칸이 비어 있어요' } : { ok: true, msg: '' }; },
      _tables: tables, _images: images
    };
    return env;
  }

  /** 예시 데이터: 가상의 학생 8명, 반 5개, 시험·숙제 몇 개 */
  function seed(env) {
    var T = env._tables;
    T['반'] = [
      { '반코드': 'GN-SS', '반이름': '개념반 토일 15:00', '종류': '개념', '요일시간': '토일 15:00', '활성': 'Y' },
      { '반코드': 'GN-HM', '반이름': '개념반 화목 20:20', '종류': '개념', '요일시간': '화목 20:20', '활성': 'Y' },
      { '반코드': 'DP-SS', '반이름': '단풀반 토일 13:00', '종류': '단풀', '요일시간': '토일 13:00', '활성': 'Y' },
      { '반코드': 'SJ-D', '반이름': '실전문풀 D', '종류': '실전', '요일시간': '토일 10:00', '활성': 'Y' },
      { '반코드': 'SJ-E', '반이름': '실전문풀 E', '종류': '실전', '요일시간': '화목 18:00', '활성': 'Y' }
    ];
    var S = [['KM482919', '김예시', 'GN-HM,DP-SS'], ['TR520615', '이샘플', 'GN-HM'], ['BD774119', '박테스트', 'GN-HM,SJ-D'], ['FH109318', '최더미', 'GN-HM'],
      ['NP882013', '정연습', 'DP-SS'], ['WX446818', '한견본', 'GN-HM,DP-SS'], ['CZ297510', '오모의', 'SJ-D'], ['JS603412', '윤임시', 'SJ-D']];
    T['원생'] = S.map(function (s) { return { '일련번호': s[0], '이름': s[1], '상태': '', '발급일': '2026-10-17', '메모': '' }; })
      .concat([{ '일련번호': 'AB123450', '이름': '강휴원', '상태': '', '발급일': '2026-09-01', '메모': '이번 달 수강 없음' }]);
    T['수강'] = S.map(function (s) { return { '번호': s[0], '반코드': s[2], '수정일': '2026-10-01' }; });
    function key(n, seed) { var s = seed, out = ''; for (var i = 0; i < n; i++) { s = (s * 48271) % 2147483647; out += 1 + (s % 4); } return out; }
    function ans(k, wrongs) { var a = k.split(''); wrongs.forEach(function (i) { a[i - 1] = String((+a[i - 1]) % 4 + 1); }); return a.join(''); }
    var ex = [
      ['E1', 'GN-HM', '2026-10', '소테스트', '경제 1주차', 15, '243123223334213', '2026-10-06'],
      ['E2', 'GN-HM', '2026-10', '소테스트', '경제 2주차', 15, key(15, 7), '2026-10-13'],
      ['E3', 'GN-HM', '2026-10', '소테스트', '경제 3주차', 15, key(15, 9), '2026-10-20'],
      ['E4', 'DP-SS', '2026-10', '월말테스트', '경제 월말', 40, key(40, 19), '2026-10-31'],
      ['E5', 'SJ-D', '2026-10', '모의고사', 'EJU 2024(2)', 40, key(40, 11), '2026-10-04'],
      ['E6', 'SJ-D', '2026-10', '모의고사', 'EJU 2025(2)', 40, key(40, 13), '2026-10-11']
    ];
    T['시험'] = ex.map(function (e) { return { '시험ID': e[0], '반코드': e[1], '월': e[2], '종류': e[3], '이름': e[4], '문항수': e[5], '정답': e[6], '시험일': e[7], '등록일': e[7] + ' 21:00' }; });
    var R = [
      ['E1', 'KM482919', [3, 7, 11]], ['E1', 'TR520615', [5]], ['E1', 'BD774119', [2, 6, 9, 13]], ['E1', 'WX446818', [1, 4]],
      ['E2', 'KM482919', [5]], ['E2', 'TR520615', [3, 8]], ['E2', 'BD774119', [1, 2, 10]], ['E2', 'FH109318', [4, 7, 9, 12, 14]], ['E2', 'WX446818', [6]],
      ['E3', 'KM482919', [2, 6, 9, 13]], ['E3', 'TR520615', [1]], ['E3', 'WX446818', [3, 8, 12]],
      ['E4', 'KM482919', [2, 6, 9, 12, 18, 21, 24, 30, 33, 37, 40]], ['E4', 'NP882013', [4, 8, 15, 22]], ['E4', 'WX446818', [7, 11, 19, 27, 35]],
      ['E5', 'BD774119', [5, 12, 19, 26, 33, 38]], ['E5', 'CZ297510', [3, 8, 17, 22, 31, 36, 40, 29]], ['E5', 'JS603412', [1, 9, 14, 20, 25, 28, 32, 36, 39, 40]],
      ['E6', 'BD774119', [8, 17, 22, 31]], ['E6', 'CZ297510', [2, 5, 11, 19, 27, 33, 38]]
    ];
    var keys = {}; T['시험'].forEach(function (e) { keys[e['시험ID']] = e['정답']; });
    T['시험결과'] = R.map(function (r) {
      var a = ans(keys[r[0]], r[2]), g = Cr.grade(keys[r[0]], a);
      return { '시험ID': r[0], '번호': r[1], '답안': a, '맞은개수': g.score, '틀린번호': g.wrong.map(function (w) { return w.n; }).join(','), '환산점수': '', '입력일': '2026-10-20 22:00' };
    });
    T['숙제'] = [
      { '숙제ID': 'H1', '반코드': 'GN-HM', '월': '2026-10', '이름': '경제 1주차 일문일답', '교재': '경제 개념 문제집', '시작쪽': 20, '끝쪽': 29, '문항수': 51, '등록일': '2026-10-06' },
      { '숙제ID': 'H2', '반코드': 'GN-HM', '월': '2026-10', '이름': '경제 2주차 일문일답', '교재': '경제 개념 문제집', '시작쪽': 30, '끝쪽': 37, '문항수': 42, '등록일': '2026-10-13' },
      { '숙제ID': 'H3', '반코드': 'GN-HM', '월': '2026-10', '이름': '경제 3주차 일문일답', '교재': '경제 개념 문제집', '시작쪽': 38, '끝쪽': 52, '문항수': 77, '등록일': '2026-10-20' }
    ];
    var H = [['H1', 'KM482919', 38, 'Y'], ['H1', 'TR520615', 31, 'Y'], ['H1', 'BD774119', 44, 'N'], ['H1', 'FH109318', 25, 'N'], ['H1', 'WX446818', 47, 'Y'],
      ['H2', 'KM482919', 31, 'Y'], ['H2', 'TR520615', 29, 'N'], ['H2', 'BD774119', 36, 'N'], ['H2', 'WX446818', 39, 'N']];
    T['숙제제출'] = H.map(function (h) { return { '숙제ID': h[0], '번호': h[1], '맞은개수': h[2], '사진수': 0, '확인': h[3], '대리입력': 'N', '최종제출일': '2026-10-15 23:10' }; });
    // 시험지(답지에서 뽑은 정답) 예시 — 정답은 가짜
    T['시험지'] = [['GN-경제-T1', '개념', '경제', '소테스트', 1, '경제 1주차', 15], ['GN-경제-T2', '개념', '경제', '소테스트', 2, '경제 2주차', 15],
      ['GN-경제-T3', '개념', '경제', '소테스트', 3, '경제 3주차', 15], ['GN-경제-M', '개념', '경제', '월말테스트', 0, '경제 월말', 40], ['GN-경제-G', '개념', '경제', '소테스트', 0, '경제 EJU 기출', 16],
      ['GN-정치-T1', '개념', '정치', '소테스트', 1, '정치 1주차', 15], ['GN-정치-M', '개념', '정치', '월말테스트', 0, '정치 월말', 40],
      ['DP-경제-M', '단풀', '경제', '월말테스트', 0, '경제 단풀 월말', 40],
      ['GN-경제-Q1', '개념', '경제', '일문일답', 1, '경제 1주차 일문일답', 51], ['GN-경제-Q2', '개념', '경제', '일문일답', 2, '경제 2주차 일문일답', 42],
      ['GN-경제-Q3', '개념', '경제', '일문일답', 3, '경제 3주차 일문일답', 46],
      ['EJU-2025-1', '실전', '종합과목', '모의고사', 1, 'EJU 2025(1)', 38], ['EJU-2023-2', '실전', '종합과목', '모의고사', 2, 'EJU 2023(2)', 38],
      ['EJU-2024-2', '실전', '종합과목', '모의고사', 2, 'EJU 2024(2)', 40], ['EJU-2025-2', '실전', '종합과목', '모의고사', 2, 'EJU 2025(2)', 40],
      ['EJU-2019-1', '실전', '종합과목', '모의고사', 1, 'EJU 2019(1)', 38], ['EJU-2008-2', '실전', '종합과목', '모의고사', 2, 'EJU 2008(2)', 38]].map(function (p, i) {
      return { '시험지ID': p[0], '반종류': p[1], '과목': p[2], '종류': p[3], '회차': p[4], '이름': p[5], '문항수': p[6],
        '정답': p[3] === '일문일답' ? '' : key(p[6], 31 + i), '출처': '예시' };
    });
    T['평가'] = [{ '월': '2026-10', '번호': 'KM482919', '코멘트': '본인이 잘 하고자 하는 의욕이 넘침', '수정일': '2026-10-15' }];
    return env;
  }

  var env = null;
  function api(action, payload) {
    if (!env) env = seed(createEnv());
    return new Promise(function (res) { setTimeout(function () { res(L.handle(env, action, payload)); }, 120); });
  }
  function imageUrl(id) { return env && env._images[id] ? env._images[id] : ''; }

  return { createEnv: createEnv, seed: seed, api: api, imageUrl: imageUrl };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SeisekiMock;
