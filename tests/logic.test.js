// node tests/logic.test.js — 공통 로직 점검 (서버 없이 메모리 저장소로, 개발판 docs/dev/assets 기준)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Core = require('../docs/dev/assets/core.js');
const Logic = require('../docs/dev/assets/logic.js');
const Mock = require('../docs/dev/assets/mock.js');

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

console.log('logic');
const env = Mock.createEnv({ now: () => new Date('2026-11-03T21:00:00+09:00') });
const H = (a, p) => Logic.handle(env, a, p);
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
  assert.ok(H('hwPhoto', { code: c, hw: hw.id, order: 1, mime: 'image/jpeg', b64: 'AAAA' }).ok);
  const p2 = H('hwPhoto', { code: c, hw: hw.id, order: 2, mime: 'image/jpeg', b64: 'AAAA' }); assert.ok(p2.ok);
  assert.strictEqual(p2.data.check.ok, false, '미리보기 사진 확인: 2번째는 걸림'); assert.ok(p2.data.check.msg);
  const fin = H('hwFinish', { code: c, hw: hw.id, count: 40 }); assert.ok(fin.ok, fin.error);
  const mine = fin.data.classes.filter(x => x.code === 'GN-HM')[0].hw[0]; assert.ok(mine.done); assert.strictEqual(mine.photos, 2);
  assert.ok(H('setChecked', { token, hw: hw.id, code: c, checked: true }).ok);
  assert.strictEqual(H('hwPhotos', { token, hw: hw.id, code: c }).data.length, 2);
  const ph = H('hwPhotos', { token, hw: hw.id, code: c }).data; assert.strictEqual(ph[0].check, 'OK'); assert.strictEqual(ph[1].check, '확인필요');
  const bw = H('bootstrap', { token }).data.photoWarns.filter(x => x.hw === hw.id); assert.strictEqual(bw.length, 1); assert.strictEqual(bw[0].order, 2);
  assert.ok(!H('hwPhoto', { code: codes['다학생'], hw: 'NOPE', b64: 'A' }).ok);
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
console.log(`\n${passed} passed` + (process.exitCode ? ', 실패 있음' : ''));
