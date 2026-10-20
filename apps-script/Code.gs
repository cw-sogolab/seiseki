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
