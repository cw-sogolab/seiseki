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
    logAccess: function (row) { if (prop_('ACCESS_LOG') !== 'off') accessBuffer_(row); },   // 개발 서버는 스크립트 속성 ACCESS_LOG=off (접속기록은 본판만, 2026-10-22 사용자)
    readLog: function () { return readAccessLog_(); },
    saveImage: function (o) {
      if (!lock) return saveImage_(o);
      lock.releaseLock();
      try { return saveImage_(o); }
      finally { if (!lock.tryLock(25000)) throw new Error('지금 저장하는 사람이 많아요. 잠시 뒤에 다시 올려 주세요.'); }
    }
  };
}

/* ---------- 접속기록: 기록장이 아닌 따로 둔 스프레드시트 (2026-10-22) ----------
 * 해마다 파일 하나 「<기록장 이름> 접속기록 YYYY」를 기록장과 같은 폴더에 만들고 ID 는 스크립트 속성 ALOG_<YYYY> 에 둠.
 * 학생이 들어오면 캐시(alog:buf)에만 한 줄 적고, 10분마다 warmCache 가(또는 강사가 접속기록을 볼 때) 모아서 시트 끝에 붙임 → 로그인이 느려지지 않음.
 * 캐시가 드물게 비워지면 최근 10분 안의 몇 줄이 빠질 수 있음(성적처럼 꼭 남아야 하는 기록은 아니라서 이렇게 함).
 * 본판만 남김: 개발 서버는 스크립트 속성 ACCESS_LOG = off. */
var ALOG_KEY = 'alog:buf', ALOG_MAX = 150;
function alogLock_() { var l = null; try { l = LockService.getDocumentLock(); } catch (e) { l = null; } return l || LockService.getScriptLock(); }
function accessBuffer_(row) {
  var lock = alogLock_(), spill = null;
  if (!lock.tryLock(2000)) { appendAccess_([row]); return; }   // 잠깐 붐비면 그냥 시트에 바로 붙임
  try {
    var c = CacheService.getScriptCache(), buf;
    try { buf = JSON.parse(c.get(ALOG_KEY) || '[]'); } catch (e) { buf = []; }
    buf.push(row);
    if (buf.length >= ALOG_MAX) { spill = buf; c.remove(ALOG_KEY); } else c.put(ALOG_KEY, JSON.stringify(buf), 21600);
  } finally { lock.releaseLock(); }
  if (spill) appendAccess_(spill);
}
/** 캐시에 모인 접속기록을 시트로 옮김 */
function flushAccessLog_() {
  var lock = alogLock_(), buf = [];
  if (!lock.tryLock(5000)) return 0;
  try {
    var c = CacheService.getScriptCache();
    try { buf = JSON.parse(c.get(ALOG_KEY) || '[]'); } catch (e) { buf = []; }
    if (buf.length) c.remove(ALOG_KEY);
  } finally { lock.releaseLock(); }
  if (buf.length) appendAccess_(buf);
  return buf.length;
}
/** 한 줄씩 appendRow (여러 요청이 같이 붙여도 줄이 섞이거나 덮이지 않음) */
function appendAccess_(rows) {
  var H = Logic.ACCESS_HEAD, by = {};
  rows.forEach(function (r) { var y = String(r['시각'] || '').slice(0, 4) || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy'); (by[y] = by[y] || []).push(r); });
  Object.keys(by).forEach(function (y) {
    var sh = accessSheet_(y, true);
    by[y].forEach(function (r) { sh.appendRow(H.map(function (h) { return r[h] === undefined || r[h] === null ? '' : String(r[h]); })); });
  });
}
/** 그 해 접속기록 시트 (create 이면 없을 때 만듦) */
function accessSheet_(y, create) {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('ALOG_' + y), H = Logic.ACCESS_HEAD;
  if (id) { try { return SpreadsheetApp.openById(id).getSheets()[0]; } catch (e) { if (!create) return null; } }
  if (!create) return null;
  var src = spreadsheet_(), ss = SpreadsheetApp.create(src.getName() + ' 접속기록 ' + y), sh = ss.getSheets()[0];
  sh.setName('접속기록');
  sh.getRange('A:E').setNumberFormat('@');   // 시각이 날짜로 바뀌지 않게 (그래도 바뀐 것은 읽을 때 되돌림)
  sh.getRange(1, 1, 1, H.length).setValues([H]).setFontWeight('bold').setBackground('#12233F').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  try { var par = DriveApp.getFileById(src.getId()).getParents(); if (par.hasNext()) DriveApp.getFileById(ss.getId()).moveTo(par.next()); } catch (e) { /* 폴더를 못 옮겨도 기록은 됨 */ }
  props.setProperty('ALOG_' + y, ss.getId());
  return sh;
}
/** 강사 화면용: 올해·작년 접속기록 (먼저 캐시에 모인 것을 옮김) */
function readAccessLog_() {
  flushAccessLog_();
  var y = Number(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy')), out = [];
  [y - 1, y].forEach(function (yy) {
    var sh = accessSheet_(String(yy), false); if (!sh) return;
    var v = sh.getDataRange().getValues(), head = v[0].map(String);
    v.slice(1).forEach(function (r) { var o = {}; head.forEach(function (h, i) { o[h] = r[i] instanceof Date ? Utilities.formatDate(r[i], 'Asia/Seoul', 'yyyy-MM-dd HH:mm') : String(r[i]); }); out.push(o); });
  });
  return out;
}

/* ---------- 매일·10분마다 도는 일 (트리거: 편집기 「트리거」에서 시간 기반으로 추가) ---------- */
/** 10분마다: 캐시를 미리 채워 둠 (원생명단은 새로 읽음) → 학생·선생님이 시트 읽기를 기다리지 않게 */
function warmCache() {
  try { flushAccessLog_(); } catch (e) { Logger.log('접속기록 옮기기 실패: ' + e); }
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
