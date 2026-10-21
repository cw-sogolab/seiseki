// node tests/logic.test.js — 공통 로직 점검 (서버 없이 메모리 저장소로, 개발판 docs/dev/assets 기준)
process.env.TZ = 'Asia/Seoul';   // 서버(Apps Script)와 같은 시간대로
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Core = require('../docs/dev/assets/core.js');
const Logic = require('../docs/dev/assets/logic.js');
const Mock = require('../docs/dev/assets/mock.js');

// 숙제 제출은 로그인 열쇠(tok)로만 → 테스트에서는 번호를 주면 로그인해서 열쇠로 바꿔 보냄
const TOKS = new WeakMap();
function auto(e, a, p) {
  if ((a === 'hwPhoto' || a === 'hwFinish') && p && p.code && !p.tok) {
    const m = TOKS.get(e) || new Map(); TOKS.set(e, m);
    if (!m.has(p.code)) { const r = Logic.handle(e, 'login', { code: p.code, dev: 'tok-' + p.code }); m.set(p.code, r.ok ? r.data.tok : 'x'); }
    p = Object.assign({}, p, { tok: m.get(p.code) }); delete p.code;
  }
  return p;
}
let passed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; } }

console.log('core');
t('번호 형식: 영문 2(I·O 제외) + 숫자 6, 끝자리 확인숫자 — 퇴실퀴즈와 같은 규칙', () => {
  assert.ok(Core.isValidCode('KM482919'));
  assert.strictEqual(Core.codeProblem('KM482912'), 'check', '확인숫자 틀림');
  assert.strictEqual(Core.codeProblem('KO482919'), 'format', 'O 금지');
  assert.strictEqual(Core.codeProblem('KM4829'), 'short');
  assert.strictEqual(Core.normCode(' km-482 919 '), 'KM482919');
  // 퇴실퀴즈 index.html 의 luhnOk 와 같은 계산
  const kitaku = s => { const ds = [...s].map(c => /\d/.test(c) ? c : String(c.charCodeAt(0) - 55)).join(''); let tt = 0; [...ds].reverse().forEach((ch, i) => { let d = +ch; if (i % 2) { d *= 2; if (d > 9) d -= 9; } tt += d; }); return tt % 10 === 0; };
  for (const c of ['KM482919', 'TR520615', 'AB123450']) assert.ok(kitaku(c), c);
});
t('번호 발급: 중복 없음, 형식·확인숫자 맞음', () => {
  const used = {}; let a = 12345;
  const rand = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return (x ^ x >>> 14) >>> 0; };
  for (let i = 0; i < 3000; i++) {
    const c = Core.genCode(rand, x => !!used[x]);
    assert.ok(Core.isValidCode(c), c); assert.ok(!used[c]); used[c] = 1;
  }
  assert.strictEqual(Core.LETTERS.length, 24);
});
t('채점: 무응답·짧은 입력', () => {
  const g = Core.grade('1234', '12');
  assert.strictEqual(g.score, 2); assert.deepStrictEqual(g.wrong.map(w => w.n), [3, 4]); assert.strictEqual(g.wrong[0].ans, '0');
  assert.strictEqual(Core.cleanAnswers('1 2-3x4 05', 10), '123405', '5지 이상 문항(EJU)도 받음');
  assert.strictEqual(Core.cleanKey('1,2 6/0'), '126', '정답에서 0은 버림');
  assert.strictEqual(Core.grade('126', '116').score, 2);
});
t('명단 파싱: 시간·종류로 반 찾기, 여러 반, 모르는 반', () => {
  const classes = [{ code: 'GN-HM', name: '개념반 화목 20:20', kind: '개념', time: '화목 20:20' }, { code: 'SJ-D', name: '실전문풀 D', kind: '실전', time: '토일 10:00' },
    { code: 'DP-SS', name: '단풀반 토일 13:00', kind: '단풀', time: '토일 13:00' }];
  const r = Core.parseRoster('홍길동(동작)\t종합과목 개념(경제)(화목20:20)\n김하나, 실전문풀D(토일10:00)/단풀 토일13:00\n박모름\t영어반\n이름만', classes);
  assert.deepStrictEqual(r.rows.map(x => [x.name, x.classes.join('+')]), [['홍길동(동작)', 'GN-HM'], ['김하나', 'SJ-D+DP-SS']]);
  assert.strictEqual(r.unknown.length, 2);
});
t('Core.gs·Logic.gs가 개발판 파일과 같은지', () => {
  const root = path.join(__dirname, '..');
  for (const [a, b] of [['docs/dev/assets/core.js', 'apps-script/Core.gs'], ['docs/dev/assets/logic.js', 'apps-script/Logic.gs']]) {
    assert.strictEqual(fs.readFileSync(path.join(root, a), 'utf8'), fs.readFileSync(path.join(root, b), 'utf8'), b + ' 가 다릅니다. tools/sync-gas.sh 를 실행하세요.');
  }
});

const CAL26 = (() => { const j = JSON.parse(fs.readFileSync(path.join(__dirname, '../tools/class-plan/calendar_2026.json'), 'utf8')).months, o = {};
  for (const [ym, m] of Object.entries(j)) o[ym] = { start: m.start, end: m.end, off: m.off.map(x => x[0]) }; return [j, o]; })();
t('수업 달력 계산이 연간 계획표 횟수와 같음, 미리보기 「달력」도 계획표와 같음', () => {
  const [j, cal] = CAL26;
  for (const ym of Object.keys(j)) for (const [pat, n] of Object.entries(j[ym].counts)) assert.strictEqual(Core.lessons(ym, Core.classDays(pat).days, cal).length, n, ym + ' ' + pat);
  const mt = Mock.seed(Mock.createEnv())._tables['달력'];
  assert.strictEqual(mt.length, Object.keys(j).length);
  for (const r of mt) { const c = cal[r['월']]; assert.ok(c, r['월']); assert.strictEqual(r['개강'], c.start); assert.strictEqual(r['종강'], c.end); assert.deepStrictEqual(r['휴강'] ? r['휴강'].split(', ') : [], c.off); }
});
t('숙제 마감: 숙제 k = 2k+1번째 수업 시작, 넘치면 다음 달 첫 수업', () => {
  const cal = CAL26[1];
  assert.strictEqual(Core.hwDue('2026-10', '토일 15:00', 1, cal), '2026-10-10 15:00');
  assert.strictEqual(Core.hwDue('2026-10', '토일 15:00', 3, cal), '2026-10-24 15:00');
  assert.strictEqual(Core.hwDue('2026-10', '화목 20:20', 4, cal), '2026-11-03 20:20', '10월 화목은 8번 → 9번째는 11월 첫 수업');
  assert.strictEqual(Core.hwDue('2026-11', '토일 15:00', 1, cal), '2026-11-14 15:00', '11/8 EJU 휴강 빼고');
  assert.strictEqual(Core.hwDue('2027-01', '토일 15:00', 1, cal), '2027-01-09 15:00', '달력에 없는 달은 1일~말일');
  assert.strictEqual(Core.fmtDue('2026-10-24 15:00'), '10/24(토) 15:00');
});
t('같은 사진 지문 비교', () => {
  const a = 'f'.repeat(64), b = 'f'.repeat(60) + '0000', c = '0'.repeat(64);
  assert.strictEqual(Core.hashDist(a, b), 16); assert.ok(Core.sameHash(a, b)); assert.ok(!Core.sameHash(a, c)); assert.ok(!Core.sameHash(a, ''));
});
console.log('logic');
const env = Mock.createEnv({ now: () => new Date('2026-11-03T21:00:00+09:00') });
const H = (a, p) => Logic.handle(env, a, auto(env, a, p));
env._tables['반'] = [{ '반코드': 'GN-HM', '반이름': '개념반 화목 20:20', '종류': '개념', '요일시간': '화목 20:20', '활성': 'Y' },
  { '반코드': 'DP-SS', '반이름': '단풀반 토일 13:00', '종류': '단풀', '요일시간': '토일 13:00', '활성': 'Y' }];
// 원생명단에 이미 있는 학생 (퇴실퀴즈에서 쓰던 번호)
env._tables['원생'] = [{ '일련번호': 'KM482919', '이름': '가학생(동작)', '상태': '', '발급일': '2026-10-17', '메모': '' },
  { '일련번호': 'TR520615', '이름': '나학생', '상태': '', '발급일': '2026-10-17', '메모': '' },
  { '일련번호': 'AB123450', '이름': '막힌학생', '상태': '차단', '발급일': '2026-10-17', '메모': '' }];
let token; const codes = { '가학생(동작)': 'KM482919', '나학생': 'TR520615' };
t('관리자 로그인 실패 5번이면 잠김', () => {
  for (let i = 0; i < 4; i++) assert.ok(!H('adminLogin', { password: 'x', dev: 'd1' }).ok);
  assert.ok(/5번/.test(H('adminLogin', { password: 'x', dev: 'd1' }).error));
  assert.ok(/잠시/.test(H('adminLogin', { password: 'demo', dev: 'd1' }).error), '잠긴 동안 맞는 비번도 거절');
  const okr = H('adminLogin', { password: 'demo', dev: 'd2' }); assert.ok(okr.ok); token = okr.data.token;
});
t('관리자 비밀번호: 기기를 바꿔도 1시간에 20번 틀리면 모두 막힘', () => {
  const e2 = Mock.createEnv({ now: () => new Date('2026-11-03T21:00:00+09:00') });
  for (let i = 0; i < 20; i++) assert.ok(!Logic.handle(e2, 'adminLogin', { password: String(1000 + i), dev: 'bot' + i }).ok);
  const r = Logic.handle(e2, 'adminLogin', { password: 'demo', dev: 'new-device' });
  assert.ok(!r.ok && /1시간/.test(r.error), '맞는 비번이라도 거절');
});
t('토큰 없이 관리 요청 거절', () => { const r = H('bootstrap', {}); assert.ok(!r.ok && r.needLogin); });
t('명단 붙여넣기: 원생명단의 번호를 그대로 쓰고, 없는 이름만 새 번호로 명단에 추가', () => {
  const r = H('importRoster', { token, text: '가학생(동작)\t개념 화목20:20\n나학생\t단풀 토일13:00/개념 화목 20:20\n다학생\t개념반 화목 20:20' });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.data.updated.map(x => x.code), ['KM482919', 'TR520615']);
  assert.strictEqual(r.data.added.length, 1); codes['다학생'] = r.data.added[0].code;
  assert.ok(Core.isValidCode(codes['다학생']));
  assert.strictEqual(env._tables['원생'].length, 4, '원생명단에 1명 추가');
  assert.strictEqual(env._tables['수강'].length, 3);
});
t('괄호(지역)를 빼고 넣으면 자동으로 잇지 않고 확인 요청', () => {
  const r = H('importRoster', { token, text: '가학생\t개념 화목20:20' });
  assert.strictEqual(r.data.added.length, 0); assert.strictEqual(r.data.unknown.length, 1);
  assert.strictEqual(env._tables['원생'].length, 4);
});
t('빠진 학생은 반만 비움(번호·명단은 그대로)', () => {
  const r = H('importRoster', { token, text: '가학생(동작)\t단풀 토일13:00\n나학생\t단풀 토일13:00', deactivateMissing: true });
  assert.deepStrictEqual(r.data.deactivated.map(x => x.name), ['다학생']);
  assert.strictEqual(env._tables['원생'].length, 4);
  H('importRoster', { token, text: '가학생(동작)\t개념 화목20:20/단풀 토일13:00\n나학생\t단풀 토일13:00/개념 화목 20:20\n다학생\t개념 화목20:20' });
});
let exam;
t('시험 등록: 정답 개수 검사', () => {
  assert.ok(!H('addExam', { token, cls: 'GN-HM', label: '1주차', total: 5, key: '1234' }).ok);
  const r = H('addExam', { token, cls: 'GN-HM', label: '1주차 소테스트', total: 5, key: '12341', kind: '소테스트', month: '2026-11', date: '2026-11-03' });
  assert.ok(r.ok, r.error); exam = r.data;
});
t('답안 입력 → 채점, 다시 입력하면 덮어씀', () => {
  let r = H('saveResult', { token, exam: exam.id, code: codes['가학생(동작)'], answers: '1234' });
  assert.strictEqual(r.data.score, 4); assert.deepStrictEqual(r.data.wrong, [5]); assert.strictEqual(r.data.answers, '12340');
  r = H('saveResult', { token, exam: exam.id, code: codes['가학생(동작)'], answers: '12341' }); assert.strictEqual(r.data.score, 5);
  H('saveResult', { token, exam: exam.id, code: codes['나학생'], answers: '21341' });
  assert.strictEqual(env._tables['시험결과'].length, 2);
});
t('학생 로그인 → 본인 점수·반 평균·틀린 번호만', () => {
  const r = H('login', { code: 'tr-520 615', dev: 's1' });
  assert.ok(r.ok, r.error);
  const tt = r.data.classes.filter(c => c.code === 'GN-HM')[0].tests[0];
  assert.strictEqual(tt.score, 3); assert.strictEqual(tt.avg, 4); assert.deepStrictEqual(tt.wrong, [1, 2]);
  assert.ok(!tt.wrongDetail, '정답은 기본으로 숨김');
  assert.ok(!JSON.stringify(r.data).includes('가학생'), '다른 학생 이름 노출 없음');
});
t('차단 학생·확인숫자 틀린 번호는 못 들어옴, 5번이면 잠김', () => {
  assert.ok(!H('login', { code: 'AB123450', dev: 's8' }).ok);
  assert.ok(/다시 확인/.test(H('login', { code: 'KM482912', dev: 's9' }).error));
  for (let i = 0; i < 4; i++) H('login', { code: 'KM482912', dev: 's9' });
  assert.ok(/잠시/.test(H('login', { code: 'KM482919', dev: 's9' }).error));
});
t('반을 비워도 기록이 있는 반은 「지난 반」으로 계속 보임', () => {
  assert.ok(H('setClasses', { token, code: 'TR520615', classes: ['DP-SS'] }).ok);
  const v = H('login', { code: 'TR520615', dev: 's2' }).data;
  const gn = v.classes.filter(c => c.code === 'GN-HM')[0];
  assert.ok(gn && gn.current === false && gn.tests[0].score === 3);
  assert.strictEqual(v.classes[0].code, 'DP-SS', '지금 듣는 반이 먼저');
  H('setClasses', { token, code: 'TR520615', classes: ['GN-HM', 'DP-SS'] });
});
t('지난 달은 본 시험만, 이번 달은 듣는 반 시험 전부 보임', () => {
  const old = H('addExam', { token, cls: 'GN-HM', label: '10월 월말', total: 2, key: '12', kind: '월말테스트', month: '2026-10', date: '2026-10-30' }).data;
  const now = H('addExam', { token, cls: 'GN-HM', label: '2주차', total: 2, key: '12', kind: '소테스트', month: '2026-11', date: '2026-11-10' }).data;
  let v = H('login', { code: 'TR520615', dev: 's3' }).data, ids = v.classes.filter(c => c.code === 'GN-HM')[0].tests.map(x => x.id);
  assert.ok(!ids.includes(old.id), '지난 달·미응시 → 안 보임'); assert.ok(ids.includes(now.id), '이번 달 → 보임');
  H('saveResult', { token, exam: old.id, code: 'TR520615', answers: '11' });
  v = H('login', { code: 'TR520615', dev: 's3' }).data; ids = v.classes.filter(c => c.code === 'GN-HM')[0].tests.map(x => x.id);
  assert.ok(ids.includes(old.id), '지난 달이라도 본 시험은 보임');
  H('deleteResult', { token, exam: old.id, code: 'TR520615' }); H('deleteExam', { token, exam: old.id }); H('deleteExam', { token, exam: now.id });
});
let hw;
t('숙제 등록·사진 제출·마무리·확인', () => {
  hw = H('addHomework', { token, cls: 'GN-HM', label: '1주차 숙제', book: '문제집', p0: 20, p1: 29, total: 51, month: '2026-11' }).data;
  const c = codes['가학생(동작)'];
  assert.ok(!H('hwFinish', { code: c, hw: hw.id, count: 40 }).ok, '사진 없이 마무리 불가');
  assert.ok(H('hwPhoto', { code: c, hw: hw.id, order: 1, mime: 'image/jpeg', b64: '/9j/AAAA' }).ok);
  const p2 = H('hwPhoto', { code: c, hw: hw.id, order: 2, mime: 'image/jpeg', b64: '/9j/AAAA' }); assert.ok(p2.ok); assert.strictEqual(p2.data.check, null, '사진 확인 기능 없음');
  const fin = H('hwFinish', { code: c, hw: hw.id, count: 40 }); assert.ok(fin.ok, fin.error);
  const mine = fin.data.classes.filter(x => x.code === 'GN-HM')[0].hw[0]; assert.ok(mine.done); assert.strictEqual(mine.photos, 2);
  assert.ok(H('setChecked', { token, hw: hw.id, code: c, checked: true }).ok);
  assert.strictEqual(H('hwPhotos', { token, hw: hw.id, code: c }).data.length, 2);
  assert.strictEqual(H('bootstrap', { token }).data.photoWarns.filter(x => x.hw === hw.id).length, 0);
  assert.ok(!H('hwPhoto', { code: codes['다학생'], hw: 'NOPE', b64: '/9j/A' }).ok);
});
t('정답 수정 → 다시 채점', () => {
  const r = H('updateExamKey', { token, exam: exam.id, key: '21341' }); assert.ok(r.ok, r.error);
  assert.strictEqual(r.data.results.filter(x => x.code === codes['나학생'])[0].score, 5);
});
t('숙제는 쪽 범위 없이도 등록 (교재·문항 수만)', () => {
  const r = H('addHomework', { token, cls: 'GN-HM', label: '단어 숙제', total: 30, month: '2026-11' });
  assert.ok(r.ok, r.error); assert.strictEqual(r.data.p0, 0);
  assert.ok(!H('addHomework', { token, cls: 'GN-HM', label: 'x', p0: 30, p1: 20 }).ok, '거꾸로 된 범위는 막음');
  H('deleteHomework', { token, hw: r.data.id });
});
t('결과 있는 시험·제출 있는 숙제는 삭제 불가', () => {
  assert.ok(!H('deleteExam', { token, exam: exam.id }).ok);
  assert.ok(!H('deleteHomework', { token, hw: hw.id }).ok);
});
t('평가 저장(덮어쓰기)·대리 입력', () => {
  H('saveEval', { token, month: '2026-11', code: codes['나학생'], text: '성실함' });
  H('saveEval', { token, month: '2026-11', code: codes['나학생'], text: '매우 성실함' });
  assert.strictEqual(env._tables['평가'].length, 1);
  assert.ok(H('proxyHw', { token, hw: hw.id, code: codes['다학생'], count: 30 }).ok);
});
t('시험지: 강사 bootstrap 에만 오고, 탭이 없어도 동작', () => {
  env._tables['시험지'] = [{ '시험지ID': 'GN-경제-T1', '반종류': '개념', '과목': '경제', '종류': '소테스트', '회차': '1', '이름': '경제 1주차', '문항수': '3', '정답': "'123", '출처': 'x' }];
  const b = H('bootstrap', { token });
  assert.ok(b.ok, b.error); assert.strictEqual(b.data.papers.length, 1); assert.strictEqual(b.data.papers[0].key, '123');
  const s = H('login', { code: codes['나학생'], dev: 'p' });
  assert.ok(!/123"|papers/.test(JSON.stringify(s)), '학생 응답에 시험지 없음');
  const e3 = Mock.createEnv(); delete e3._tables['시험지'];
  const orig = e3.store.all; e3.store.all = (t) => { if (t === '시험지') throw new Error('시트 「시험지」가 없어요'); return orig(t); };
  const tk = Logic.handle(e3, 'adminLogin', { password: 'demo', dev: 'q' }).data.token;
  const r = Logic.handle(e3, 'bootstrap', { token: tk }); assert.ok(r.ok, r.error); assert.deepStrictEqual(r.data.papers, []);
  env._tables['시험지'] = [];
});
t('예시 데이터로 학생 화면 만들기', () => {
  const r = Logic.handle(Mock.seed(Mock.createEnv()), 'login', { code: 'KM482919', dev: 'z' });
  assert.ok(r.ok, r.error); assert.strictEqual(r.data.classes.length, 2);
});
t('숙제 마감·늦음: 처음 낸 시각 기준, 대신 입력은 늦음 아님, 마감 직접 정하기', () => {
  let now = new Date('2026-10-26T10:00:00+09:00');
  const e = Mock.seed(Mock.createEnv({ now: () => now })), X = (a, p) => Logic.handle(e, a, auto(e, a, p));
  const tk = X('adminLogin', { password: 'demo', dev: 'l' }).data.token;
  e._tables['숙제'].forEach(r => { r['월'] = '2026-10'; });
  const b = X('bootstrap', { token: tk }).data, h1 = b.homework.filter(h => /3주차/.test(h.label) && h.cls === 'GN-HM')[0];
  assert.strictEqual(b.homework.filter(h => /1주차/.test(h.label) && h.cls === 'GN-HM')[0].due, '2026-10-13 20:20', '화목 1주차 = 3번째 수업 10/13');
  assert.strictEqual(h1.due, '2026-10-27 20:20');
  const code = 'TR520615';
  assert.ok(X('hwPhoto', { code, hw: h1.id, order: 1, b64: '/9j/AAAA' }).ok);
  let v = X('hwFinish', { code, hw: h1.id, count: 5 }); assert.ok(v.ok, v.error);
  let w = v.data.classes.filter(c => c.code === 'GN-HM')[0].hw.filter(x => x.id === h1.id)[0];
  assert.strictEqual(w.late, false); assert.strictEqual(w.due, '2026-10-27 20:20');
  now = new Date('2026-10-28T09:00:00+09:00');   // 마감 뒤에 사진 더 올려도 처음 낸 시각 그대로 → 늦음 아님
  assert.ok(X('hwPhoto', { code, hw: h1.id, order: 2, b64: '/9j/AAAB' }).ok);
  v = X('hwFinish', { code, hw: h1.id, count: '' }); w = v.data.classes.filter(c => c.code === 'GN-HM')[0].hw.filter(x => x.id === h1.id)[0];
  assert.strictEqual(w.late, false); assert.strictEqual(w.count, 5, '맞은 개수 비우면 그대로');
  const c2 = 'FH109318';
  let w2 = X('login', { code: c2, dev: 'l2' }).data.classes.filter(c => c.code === 'GN-HM')[0].hw.filter(x => x.id === h1.id)[0];
  assert.ok(w2.overdue && !w2.done, '마감 지났는데 안 냄');
  assert.ok(X('hwPhoto', { code: c2, hw: h1.id, order: 1, b64: '/9j/AAAC' }).ok);
  w2 = X('hwFinish', { code: c2, hw: h1.id, count: 3 }).data.classes.filter(c => c.code === 'GN-HM')[0].hw.filter(x => x.id === h1.id)[0];
  assert.ok(w2.late && w2.done, '늦게 냄');
  assert.ok(X('bootstrap', { token: tk }).data.hwSubs.filter(s => s.hw === h1.id && s.code === c2)[0].late);
  assert.ok(X('proxyHw', { token: tk, hw: h1.id, code: 'BD774119', count: 2 }).data.late === false);
  // 마감 직접 정하기 → 늦음 다시 계산, 빈 값이면 자동으로
  const r = X('setHwDue', { token: tk, hw: h1.id, due: '2026.10.29 23:59' }); assert.ok(r.ok, r.error); assert.strictEqual(r.data.due, '2026-10-29 23:59');
  assert.ok(!X('bootstrap', { token: tk }).data.hwSubs.filter(s => s.hw === h1.id && s.code === c2)[0].late);
  assert.ok(!X('setHwDue', { token: tk, hw: h1.id, due: '언젠가' }).ok);
  assert.strictEqual(X('setHwDue', { token: tk, hw: h1.id, due: '' }).data.due, '2026-10-27 20:20');
});
t('같은 사진: 같은 숙제는 다시 저장 안 함, 내 다른 숙제는 거절, 다른 학생 것은 받고 ⚠', () => {
  const e = Mock.seed(Mock.createEnv()), X = (a, p) => Logic.handle(e, a, auto(e, a, p));
  const tk = X('adminLogin', { password: 'demo', dev: 'd' }).data.token;
  const hws = X('bootstrap', { token: tk }).data.homework.filter(h => h.cls === 'GN-HM');
  const A = 'a'.repeat(64), A2 = 'a'.repeat(62) + 'bb', B = '5'.repeat(64);
  assert.ok(X('hwPhoto', { code: 'TR520615', hw: hws[0].id, order: 1, b64: '/9j/AAAA', hash: A }).ok);
  const n0 = e._tables['숙제사진'].length;
  const again = X('hwPhoto', { code: 'TR520615', hw: hws[0].id, order: 2, b64: '/9j/AAAA', hash: A2 });
  assert.ok(again.ok && again.data.dup === 'same'); assert.strictEqual(e._tables['숙제사진'].length, n0, '다시 저장 안 함');
  const other = X('hwPhoto', { code: 'TR520615', hw: hws[1].id, order: 1, b64: '/9j/AAAA', hash: A });
  assert.ok(!other.ok && /새로 찍어/.test(other.error), other.error);
  const copy = X('hwPhoto', { code: 'FH109318', hw: hws[0].id, order: 1, b64: '/9j/AAAA', hash: A2 });
  assert.ok(copy.ok && !copy.data.dup, '받음');
  const warn = X('bootstrap', { token: tk }).data.photoWarns.filter(x => x.code === 'FH109318');
  assert.strictEqual(warn.length, 1); assert.ok(/이샘플\(TR520615\)/.test(warn[0].msg), warn[0].msg);
  assert.ok(X('hwPhoto', { code: 'FH109318', hw: hws[0].id, order: 2, b64: '/9j/AAAA', hash: B }).ok, '다른 사진은 그냥');
  assert.strictEqual(X('bootstrap', { token: tk }).data.photoWarns.filter(x => x.code === 'FH109318').length, 1);
});
t('숙제 제출은 로그인 열쇠로만 (번호만으로는 안 됨), 열쇠가 없으면 다시 로그인 요청', () => {
  const e = Mock.seed(Mock.createEnv()), R = (a, p) => Logic.handle(e, a, p);
  const byCode = R('hwPhoto', { code: 'TR520615', hw: 'H3', order: 1, b64: '/9j/AAAA' });
  assert.ok(!byCode.ok && byCode.needLogin, '번호만 → 거절');
  assert.ok(R('hwPhoto', { tok: 'guess', hw: 'H3', b64: '/9j/AAAA' }).needLogin, '아무 열쇠 → 거절');
  const tok = R('login', { code: 'TR520615', dev: 'k' }).data.tok; assert.ok(tok);
  assert.ok(R('hwPhoto', { tok, hw: 'H3', order: 1, b64: '/9j/AAAA' }).ok);
  assert.ok(!/TR520615/.test(JSON.stringify(R('hwPhoto', { tok: 'nope', hw: 'H3', b64: '/9j/A' }))), '틀린 열쇠 응답에 학생 정보 없음');
});
t('사진: 3MB 넘거나 사진이 아니면 거절, 숙제 하나에 24장까지', () => {
  const e = Mock.seed(Mock.createEnv()), R = (a, p) => Logic.handle(e, a, p);
  const tok = R('login', { code: 'TR520615', dev: 'k' }).data.tok;
  assert.ok(/3MB/.test(R('hwPhoto', { tok, hw: 'H3', b64: '/9j/' + 'A'.repeat(4.2 * 1024 * 1024) }).error));
  assert.ok(/사진 파일만/.test(R('hwPhoto', { tok, hw: 'H3', b64: 'iVBORw0K' }).error));
  for (let i = 0; i < 24; i++) assert.ok(R('hwPhoto', { tok, hw: 'H3', order: i + 1, b64: '/9j/AAAA' }).ok);
  assert.ok(/24장까지/.test(R('hwPhoto', { tok, hw: 'H3', order: 25, b64: '/9j/AAAA' }).error));
});
t('3개월 지난 사진 지우기: 휴지통으로, 시트에는 지운 표시', () => {
  let now = new Date('2026-10-21T10:00:00+09:00');
  const e = Mock.seed(Mock.createEnv({ now: () => now })), R = (a, p) => Logic.handle(e, a, p);
  const trashed = [];
  let r = Logic.cleanupPhotos(e, id => trashed.push(id)); assert.strictEqual(r.removed, 0);
  now = new Date('2027-01-20T10:00:00+09:00');
  r = Logic.cleanupPhotos(e, id => trashed.push(id)); assert.strictEqual(r.removed, 6); assert.strictEqual(trashed.length, 6);
  const tk = R('adminLogin', { password: 'demo', dev: 'c' }).data.token;
  const ph = R('hwPhotos', { token: tk, hw: 'H2', code: 'KM482919' }).data;
  assert.ok(ph[0].gone && /3개월 지나 지움/.test(ph[0].note));
  assert.strictEqual(Logic.cleanupPhotos(e, id => trashed.push(id)).removed, 0, '두 번 지우지 않음');
});
t('강사 경고: 달력에 없는 달, 요일 모르는 반, 시트에 없는 칸 / 로그인과 첫 불러오기 한 번에', () => {
  let now = new Date('2026-12-10T10:00:00+09:00');
  const e = Mock.seed(Mock.createEnv({ now: () => now })), R = (a, p) => Logic.handle(e, a, p);
  const lg = R('adminLogin', { password: 'demo', dev: 'w' }); assert.ok(lg.data.boot && lg.data.boot.classes.length, '로그인 응답에 기록이 같이 옴');
  let w = lg.data.boot.warnings.join('\n');
  assert.ok(/2027년 1월/.test(w) && !/2026년 12월/.test(w), w);
  e._tables['반'][0]['요일시간'] = '시간 미정';
  e.store.head = t => t === '숙제' ? ['숙제ID', '반코드'] : Logic.TABLES[t];
  w = R('bootstrap', { token: lg.data.token }).data.warnings.join('\n');
  assert.ok(/요일을 못 읽었어요/.test(w) && /「숙제」 탭 첫 줄에 「월」/.test(w), w);
});
t('모든 응답에 서버 버전(ver)이 붙고, sync-gas.sh 가 넣은 값과 같음', () => {
  assert.strictEqual(Logic.handle(Mock.createEnv(), 'ping', {}).ver, Logic.VERSION);
  const strip = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/var VERSION = '[^']*';/, "var VERSION = '';");
  const h = require('crypto').createHash('sha1').update(strip('docs/dev/assets/core.js') + strip('docs/dev/assets/logic.js') + strip('apps-script/Code.gs')).digest('hex').slice(0, 10);
  assert.strictEqual(Logic.VERSION, h, 'tools/sync-gas.sh 를 실행하세요');
});
t('관리자 비밀번호를 바꾸면(ADMIN_GEN) 예전 로그인은 무효', () => {
  const e = Mock.seed(Mock.createEnv()), base = e.props.get; let gen = '';
  e.props = { get: k => k === 'ADMIN_GEN' ? gen : base(k) };
  const tk = Logic.handle(e, 'adminLogin', { password: 'demo', dev: 'g' }).data.token;
  assert.ok(Logic.handle(e, 'bootstrap', { token: tk }).ok);
  gen = '1761040000000';
  const r = Logic.handle(e, 'bootstrap', { token: tk }); assert.ok(!r.ok && r.needLogin);
  const tk2 = Logic.handle(e, 'adminLogin', { password: 'demo', dev: 'g' }).data.token;
  assert.ok(Logic.handle(e, 'bootstrap', { token: tk2 }).ok);
});

console.log('plan (강의계획서)');
const Plan = require('../docs/dev/assets/plan.js');
function planBoot() { const e = Mock.seed(Mock.createEnv()); const tk = Logic.handle(e, 'adminLogin', { password: 'demo', dev: 'p' }).data.token; return Logic.handle(e, 'bootstrap', { token: tk }).data; }
t('bootstrap 에 지난 계획서(계획서·계획서머리)와 달력이 실려 감', () => {
  const b = planBoot();
  assert.ok(b.plans.rows.length > 0 && b.plans.heads.length > 0 && b.cal['2026-11'].start === '2026-11-01');
});
t('같은 달을 다시 만들면 그 달 계획서 그대로 (날짜·내용·범위)', () => {
  const b = planBoot();
  const p = Plan.build({ ym: '2026-10', kind: '단풀', subj: '정치', time: '토일 13:00', cal: b.cal, bank: b.plans });
  const src = b.plans.rows.filter(r => r['월'] === '2026-10' && r['반종류'] === '단풀');
  assert.strictEqual(p.rows.length, src.length);
  p.rows.forEach((r, i) => { assert.strictEqual(r.date, src[i]['날짜']); assert.strictEqual(r.content, src[i]['내용']); assert.strictEqual(r.range, src[i]['범위']); });
  assert.strictEqual(p.sheet, '2610정치단풀'); assert.strictEqual(p.title, '2026년10월강의계획'); assert.deepStrictEqual(p.warn, []);
});
t('다음 달: 수업 수가 같은 지난 계획서에서 이어 쓰고, 개념반은 짝수 회차에 주간 숙제, 끝은 월말테스트', () => {
  const b = planBoot();
  const p = Plan.build({ ym: '2026-11', kind: '개념', subj: '경제', time: '화목 20:20', cal: b.cal, bank: b.plans });
  assert.strictEqual(p.rows.length, 8); assert.strictEqual(p.from, '2026-07');
  assert.deepStrictEqual(p.rows.map(r => r.date), ['11월3일', '11월5일', '11월12일', '11월17일', '11월19일', '11월24일', '11월26일', '12월1일'], '11/10 휴강 빼고');
  assert.strictEqual(p.rows[7].content, '월말테스트');
  assert.deepStrictEqual(p.rows.map(r => r.hw), ['', '주간 숙제', '', '주간 숙제', '', '주간 숙제', '', '주간 숙제']);
  assert.strictEqual(p.subtitle, '< 종과개념 개념- 경제 >');
});
t('실전: 모의고사 줄, 지난달 계획서가 이번 달 수업(11/1)까지 잡았으면 그 다음부터', () => {
  const b = planBoot();
  const p = Plan.build({ ym: '2026-11', kind: '실전', ban: 'D', time: '토일 10:00', cal: b.cal, bank: b.plans });
  assert.strictEqual(p.rows[0].date, '11월7일'); assert.ok(p.rows.every(r => r.content === '모의고사 1회 실시 및 해설' && !r.range));
  assert.ok(/11월1일/.test(p.warn.join()), p.warn.join()); assert.strictEqual(p.sheet, '2611실전문제풀이D');
});
t('수업 수가 다르면 줄을 맞춤 (적으면 쪽수 적은 이웃을 합치고, 많으면 두 강이 든 줄을 나눔)', () => {
  const items = [{ content: '1강 A', range: 'p.5-9' }, { content: '2강 B', range: 'p.10-12' }, { content: '3강 C\n4강 D', range: 'p.13-20\np.21-30' }];
  const less = Plan.fit(items, 2, []); assert.strictEqual(less.length, 2); assert.strictEqual(less[0].content, '1강 A\n2강 B'); assert.strictEqual(less[0].range, 'p.5-12');
  const more = Plan.fit(items, 4, []); assert.strictEqual(more.length, 4); assert.strictEqual(more[2].content, '3강 C'); assert.strictEqual(more[3].range, 'p.21-30');
  const w = []; assert.strictEqual(Plan.fit(items, 6, w).length, 6); assert.ok(w.length);
});
t('과목 머리말이 없으면 다른 과목 것을 빌려 오고 과목 이름만 바꿈 + 확인 표시', () => {
  const b = planBoot();
  const p = Plan.build({ ym: '2026-11', kind: '단풀', subj: '지리', time: '토일 13:00', cal: b.cal, bank: b.plans });
  assert.ok(/지리/.test(p.head['부제']) && !/정치/.test(p.head['부제']), p.head['부제']);
  assert.ok(p.warn.some(x => /빌려/.test(x)) && p.warn.some(x => /지난 계획서가 없어서/.test(x)));
});
console.log(`\n${passed} passed` + (process.exitCode ? ', 실패 있음' : ''));
