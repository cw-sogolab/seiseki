// node tests/gas.test.js — Code.gs 를 가짜 구글 서비스(시트·캐시·속성) 위에서 돌려 봄
// 캐시: 읽기 요청은 시트를 다시 읽지 않고, 저장하거나 시트를 손으로 고치면 새로 읽는지 확인
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; } }

/* ---------- 가짜 구글 서비스 ---------- */
const reads = { n: 0 };
function makeSheet(name, rows) {
  const sh = {
    name, data: rows.map(r => r.slice()),
    getDataRange: () => { reads.n++; return { getValues: () => (sh.data.length ? sh.data : [['']]).map(r => r.slice()) }; },
    getLastRow: () => sh.data.length,
    getMaxRows: () => 1000,
    getRange: (r, c, nr, nc) => ({
      setNumberFormat() { return this; },
      setValues(v) { v.forEach((row, i) => { while (sh.data.length < r + i) sh.data.push([]); sh.data[r - 1 + i] = row.slice(); }); return this; },
      getValues: () => sh.data.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)),
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }
    }),
    deleteRow: (r) => { sh.data.splice(r - 1, 1); },
    setFrozenRows() {}
  };
  return sh;
}
function loadGas(world) {
  const sandbox = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: n => world.sheets[n] || null, getId: () => 'SHEET' }),
      openById: () => ({ getSheetByName: n => world.sheets[n] || null, getSheets: () => [world.sheets['원생']], getName: () => '기록장' }),
      getUi: () => { throw new Error('no ui'); }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in world.props ? world.props[k] : null), setProperty: (k, v) => { world.props[k] = String(v); }, deleteProperty: k => { delete world.props[k]; } }) },
    CacheService: { getScriptCache: () => ({
      get: k => (k in world.cache ? world.cache[k] : null),
      getAll: ks => { const o = {}; ks.forEach(k => { if (k in world.cache) o[k] = world.cache[k]; }); return o; },
      put: (k, v) => { assert.ok(String(v).length <= 100000); world.cache[k] = String(v); },
      putAll: (o) => { Object.keys(o).forEach(k => { assert.ok(Buffer.byteLength(o[k]) <= 100 * 1024, '캐시 한 칸 100KB 넘음'); world.cache[k] = o[k]; }); },
      remove: k => { delete world.cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { createTextOutput: s => ({ setMimeType() { return JSON.parse(s); } }), MimeType: { JSON: 'json' } },
    Utilities: { getUuid: () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2) + '-0000-0000-0000-000000000000', base64Decode: s => s, newBlob: () => ({}) },
    DriveApp: {}, Logger: { log() {} }
  };
  vm.createContext(sandbox);
  const root = path.join(__dirname, '..', 'apps-script');
  for (const f of ['Core.gs', 'Logic.gs', 'Code.gs']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
  return sandbox;
}

/* ---------- 데이터 ---------- */
const Logic = require('../docs/dev/assets/logic.js');
function seed(world) {
  const T = Logic.TABLES;
  const add = (name, rows) => { world.sheets[name] = makeSheet(name, [T[name]].concat(rows.map(o => T[name].map(h => o[h] === undefined ? '' : String(o[h]))))); };
  add('반', [{ 반코드: 'GN-HM', 반이름: '개념반 화목', 종류: '개념', 요일시간: '화목 20:20', 활성: 'Y' }]);
  add('원생', [{ 일련번호: 'KM482919', 이름: '가학생', 상태: '재원' }]);
  add('수강', [{ 번호: 'KM482919', 반코드: 'GN-HM' }]);
  add('시험', [{ 시험ID: 'E1', 반코드: 'GN-HM', 월: '2026-10', 종류: '소테스트', 이름: '1주차', 문항수: 3, 정답: '123', 시험일: '2026-10-03' }]);
  // 시험결과를 크게 (캐시가 여러 칸으로 나뉘는지)
  const big = [];
  for (let i = 0; i < 3000; i++) big.push({ 시험ID: 'X' + i, 번호: 'ZZ' + String(100000 + i), 답안: '1234123412341234123412341234123412341234', 맞은개수: 20, 틀린번호: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20', 입력일: '2026-10-18 22:00' });
  big.push({ 시험ID: 'E1', 번호: 'KM482919', 답안: '120', 맞은개수: 2, 틀린번호: '3', 입력일: '' });
  add('시험결과', big);
  add('숙제', []); add('숙제제출', []); add('숙제사진', []); add('평가', []);
  world.props.ADMIN_PASSWORD = '7350';
}
function post(G, action, payload) { return G.doPost({ postData: { contents: JSON.stringify({ action, payload }) } }); }

console.log('gas');
const world = { sheets: {}, props: {}, cache: {} };
seed(world);
const G = loadGas(world);

t('첫 조회는 시트를 읽고, 두 번째 조회는 캐시만 씀', () => {
  reads.n = 0;
  let r = post(G, 'login', { code: 'KM482919', dev: 'a' });
  assert.ok(r.ok, r.error); const first = reads.n; assert.ok(first >= 5, '처음엔 시트를 읽음 ' + first);
  assert.ok(Object.keys(world.cache).some(k => /시험결과:1$/.test(k)), '시험결과가 여러 칸으로 나뉘어 저장');
  reads.n = 0;
  r = post(G, 'login', { code: 'KM482919', dev: 'a' });
  assert.ok(r.ok); assert.strictEqual(reads.n, 0, '두 번째는 시트를 안 읽음');
  assert.strictEqual(r.data.classes[0].tests[0].score, 2);
});
t('저장하면 다음 조회에 바로 보임 (캐시 버전이 바뀜)', () => {
  const tok = post(G, 'adminLogin', { password: '7350', dev: 'b' }).data.token;
  const v0 = world.props.DATA_VER;
  const s = post(G, 'saveResult', { token: tok, exam: 'E1', code: 'KM482919', answers: '123' });
  assert.ok(s.ok, s.error); assert.notStrictEqual(world.props.DATA_VER, v0, '버전 바뀜');
  const r = post(G, 'login', { code: 'KM482919', dev: 'a' });
  assert.strictEqual(r.data.classes[0].tests[0].score, 3, '새 점수');
});
t('쓰기 요청은 캐시가 아니라 시트를 읽어서 올바른 줄을 고침', () => {
  // 시트를 손으로 바꿨는데(onEdit 없이) 캐시가 옛것이어도, 저장은 실제 시트 기준
  world.sheets['시험결과'].data.splice(1, 5);          // 앞쪽 5줄을 지움 → 줄 번호가 달라짐
  const tok = post(G, 'adminLogin', { password: '7350', dev: 'c' }).data.token;
  post(G, 'saveResult', { token: tok, exam: 'E1', code: 'KM482919', answers: '100' });
  const rows = world.sheets['시험결과'].data.filter(r => r[0] === 'E1' && r[1] === 'KM482919');
  assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0][3], '1');
});
t('시트를 손으로 고치면(onEdit) 다음 조회에 반영', () => {
  post(G, 'login', { code: 'KM482919', dev: 'a' });                 // 캐시 채움
  const sh = world.sheets['시험결과'].data; const i = sh.findIndex(r => r[0] === 'E1' && r[1] === 'KM482919'); sh[i][3] = '0';
  G.onEdit();
  const r = post(G, 'login', { code: 'KM482919', dev: 'a' });
  assert.strictEqual(r.data.classes[0].tests[0].score, 0);
});
t('관리자 비밀번호 앞뒤 빈칸은 무시', () => {
  assert.ok(post(G, 'adminLogin', { password: ' 7350 ', dev: 'd' }).ok);
});

console.log('\n' + passed + ' passed');
