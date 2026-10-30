/* 강사 화면: 답안 입력·채점, 시험·숙제 등록, 숙제 확인, 명단·번호, 학생평가(월말 표), 강의계획서 */
(function () {
  var $ = UI.$, all = UI.all, esc = UI.esc;
  var token = UI.store.get('seiseki.token', sessionStorage) || '';
  var D = null, tab = 'entry', month = '', curExam = '', curHw = '', monthCls = '';
  var TABS = [['entry', '답안 입력'], ['item', '문항 분석'], ['hw', '숙제'], ['exams', '시험'], ['stu', '학생·번호'], ['one', '학생별'], ['plan', '강의계획서'], ['month', '학생평가']];

  if (Api.demo) $('#demo').hidden = false;

  /* ---------- 서버 ---------- */
  function req(action, payload) {
    return Api.call(action, Object.assign({ token: token }, payload || {})).then(function (r) {
      if (!r.ok && r.needLogin) { logout('다시 로그인해 주세요.'); }
      return r;
    });
  }
  /* 숙제 사진 (2026-10-23): 드라이브 썸네일이 안 열리면(이 브라우저에 구글 로그인 안 됨·다른 구글 계정이 먼저·쿠키 차단) 서버가 읽어 보낸 사진으로 바꿈 */
  var phCache = {};
  function srvPhoto(id) {
    if (!phCache[id]) phCache[id] = req('photo', { id: id }).then(function (r) {
      if (!r.ok || !r.data || !r.data.b64) { delete phCache[id]; return ''; }
      var bin = atob(r.data.b64), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([u8], { type: r.data.mime || 'image/jpeg' }));
    });
    return phCache[id];
  }
  function photoFix(root) {
    root.querySelectorAll('img[data-fid]').forEach(function (im) {
      var id = im.getAttribute('data-fid'), a = im.closest('a');
      function fb() {
        if (im.dataset.fb) return; im.dataset.fb = '1';
        if (a) a.classList.add('phload');
        srvPhoto(id).then(function (u) {
          if (a) a.classList.remove('phload');
          if (!u) { if (a) a.classList.add('phfail'); return; }
          im.src = u; if (a) a.href = u;
        });
      }
      if (phCache[id]) return fb();   // 이미 서버에서 받은 사진
      im.addEventListener('error', fb);
    });
  }
  function busy(on, text) {
    var btn = $('#go'); btn.disabled = on; btn.textContent = on ? text : '들어가기';
    var ll = $('#loadline'); if (ll) ll.remove();
    if (on) { ll = document.createElement('div'); ll.id = 'loadline'; ll.className = 'loadline'; ll.innerHTML = '<i></i>'; btn.after(ll); }
  }
  function login() {
    if ($('#go').disabled) return;
    var pw = $('#pw').value.trim();
    if (!pw) { $('#loginMsg').textContent = '비밀번호를 넣어 주세요.'; $('#pw').focus(); return; }
    $('#loginMsg').textContent = ''; busy(true, '확인하는 중…');
    Api.call('adminLogin', { password: pw }).then(function (r) {
      if (!r.ok) { busy(false); $('#loginMsg').textContent = r.error; $('#pw').select(); return; }
      token = r.data.token; UI.store.set('seiseki.token', token, sessionStorage); $('#pw').value = '';
      if (r.data.boot) opened(r.data.boot); else load(true);   // 로그인 응답에 기록이 같이 옴 (한 번 덜 기다림)
    });
  }
  function logout(msg) {
    token = ''; D = null; UI.store.del('seiseki.token', sessionStorage);
    document.body.classList.add('locked'); busy(false);
    $('#view').hidden = true; $('#period').hidden = true; $('#nav').hidden = true; $('#topRight').hidden = true; $('#login').hidden = false;
    $('#loginMsg').textContent = msg || '';
  }
  /** 기록을 불러와 화면을 엶. 방금 로그인했으면 토큰이 서버에 막 저장된 참이라, 한 번은 다시 물어봄 */
  function load(justLoggedIn, retried) {
    busy(true, '기록을 불러오는 중…');
    Api.call('bootstrap', { token: token }).then(function (r) {
      if (!r.ok && r.needLogin && justLoggedIn && !retried) { setTimeout(function () { load(true, true); }, 800); return; }
      if (!r.ok) { if (r.needLogin) logout('다시 로그인해 주세요.'); else { busy(false); $('#loginMsg').textContent = r.error; } return; }
      opened(r.data);
    });
  }
  /** 이 사이트에서는 「세계사」를 「역사」로 (2026-10-22): 시험지 과목·이름에 옛 표기가 남아 있어도 역사로 보이고 역사로 등록되게 */
  function normSubj(d) { (d && d.papers || []).forEach(function (p) { if (p.subj === '세계사') p.subj = '역사'; p.label = String(p.label).replace(/^세계사/, '역사'); }); return d; }
  function opened(data) {
    D = normSubj(data); busy(false);
    if (!month) month = D.today.slice(0, 7);
    document.body.classList.remove('locked');
    $('#login').hidden = true; $('#view').hidden = false; $('#period').hidden = false; $('#nav').hidden = false; $('#topRight').hidden = false;
    renderWarns(); renderMonths(); renderNav(); render();
  }
  /* 맨 위 경고: 서버 코드 버전이 다름 / 달력에 없는 달 / 요일 모르는 반 / 시트에 없는 칸 */
  var verMsg = '';
  Api.onVerMismatch(function (m) { verMsg = m; renderWarns(); });
  function renderWarns() {
    var box = $('#warns');
    if (!box) { box = document.createElement('div'); box.id = 'warns'; $('#view').parentNode.insertBefore(box, $('#period') || $('#view')); }
    var list = (verMsg ? [verMsg] : []).concat((D && D.warnings) || []);
    box.innerHTML = list.length ? '<div class="topwarn" role="alert"><b>확인해 주세요</b><ul>' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '';
  }

  /* ---------- 데이터 도우미 ---------- */
  /** 지금 한국 시각 'YYYY-MM-DD HH:MM' (숙제 마감과 비교) */
  function nowStamp() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '); }
  function cls(code) { return D.classes.filter(function (c) { return c.code === code; })[0] || { code: code, name: code, kind: '', time: '' }; }
  function stu(code) { return D.students.filter(function (s) { return s.code === code; })[0]; }
  function members(c) { return D.students.filter(function (s) { return s.active && s.classes.indexOf(c) >= 0; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); }); }
  /** 그 반·그 달의 명단: 이번 달은 지금 듣는 학생만(나간 학생은 기록이 있어도 빼고),
   *  지난달은 그 달 기록(시험결과·숙제제출)이 있는 학생 */
  function rosterFor(c, m) {
    if (m === D.today.slice(0, 7)) return members(c);
    var codes = {};
    D.exams.forEach(function (e) { if (e.cls === c && e.month === m) D.results.forEach(function (r) { if (r.exam === e.id) codes[r.code] = 1; }); });
    D.homework.forEach(function (h) { if (h.cls === c && h.month === m) D.hwSubs.forEach(function (x) { if (x.hw === h.id) codes[x.code] = 1; }); });
    return D.students.filter(function (s) { return codes[s.code]; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
  }
  var SUBJS = ['경제', '정치', '지리', '현사', '현대사회', '세계사', '역사', '일본사'];
  function subjOf(label) { var w = String(label).split(' ')[0]; return SUBJS.indexOf(w) >= 0 ? (w === '현대사회' ? '현사' : w === '세계사' ? '역사' : w) : ''; }   // 이 사이트에서는 「세계사」를 「역사」로 (2026-10-22)
  /** 그 달 그 반의 과목 (시험·숙제 이름에서) */
  function subjIn(code, m) {
    var x = D.exams.concat(D.homework).filter(function (e) { return e.cls === code && e.month === m && subjOf(e.label); })[0];
    return x ? subjOf(x.label) : '';
  }
  /** 반 이름 통일: [요일시간] 과목 — 과목은 달마다 바뀌니 그 달 시험·숙제에서. 실전은 [요일시간] 실전D */
  function clsName(code, m) {
    var c = cls(code); if (!c || !c.code) return String(code);
    var t = c.time ? '[' + c.time + '] ' : '';
    if (c.kind === '실전') return t + '실전' + realSuffix(c.code);
    return t + (subjIn(code, m || month) || '') + (subjIn(code, m || month) ? ' ' + c.kind : c.kind + '반');   // 「[토일 13:00] 정치 단풀」 — 개념·단풀 구분 (2026-10-25 사용자)
  }
  /** 반 고르기 칸: 개념반·단풀반·실전반으로 묶어서 */
  function clsOptions(list, sel, note) {
    function opt(c) { return '<option value="' + esc(c.code) + '"' + (c.code === sel ? ' selected' : '') + '>' + esc(clsName(c.code)) + (note ? note(c) : '') + '</option>'; }
    return KINDS.map(function (k) {
      var g = list.filter(function (c) { return c.kind === k[0]; });
      return g.length ? '<optgroup label="' + k[1] + '">' + g.map(opt).join('') + '</optgroup>' : '';
    }).join('') + list.filter(function (c) { return !KINDS.some(function (k) { return k[0] === c.kind; }); }).map(opt).join('');
  }
  /** 시간대 없이 반 이름: 개념반·단풀반 / 실전반 D·E */
  function clsShort(code) { var c = cls(code); return c.kind === '실전' ? '실전반 ' + String(c.code).split('-').pop() : (c.kind ? c.kind + '반' : c.name); }
  /** 학원 제출·월말 표의 환산점수 = 맞은 개수 / 문항 수 × 200 (득점등화는 학생 개인 성적표에서만) */
  function conv200(score, total) { return total ? Math.round(score / total * 2000) / 10 : null; }
  function pages(h) { return (h.book ? esc(h.book) + ' ' : '') + (h.p0 ? 'p.' + h.p0 + '~' + h.p1 : ''); }
  function examsOfMonth() { return D.exams.filter(function (e) { return e.month === month; }).sort(function (a, b) { return (a.cls + a.date).localeCompare(b.cls + b.date); }); }
  function hwOfMonth() { return D.homework.filter(function (h) { return h.month === month; }); }
  function resultOf(exam, code) { return D.results.filter(function (r) { return r.exam === exam && r.code === code; })[0]; }
  function subOf(hw, code) { return D.hwSubs.filter(function (s) { return s.hw === hw && s.code === code; })[0]; }
  function replace(list, pred, item) { var i = list.findIndex(pred); if (i >= 0) list[i] = item; else list.push(item); }
  function classOptions(sel) { return clsOptions(D.classes.filter(function (c) { return c.active; }), sel); }
  /** 시험지(수업 폴더 답지에서 뽑은 것) 고르기 칸. kinds: 보여 줄 종류, 반 종류(개념·단풀·실전)가 같은 것을 위에 */
  var KIND_ORDER = { '소테스트': 1, '일문일답': 1, '월말테스트': 2, '모의고사': 3 };
  function paperPick(id, clsCode, kinds, used, only) {
    var ps = (D.papers || []).filter(function (p) { return kinds.indexOf(p.kind) >= 0 && (!only || only(p)); });
    if (!ps.length) return '';
    var kind = cls(clsCode).kind;
    ps.sort(function (a, b) { return ((a.ban === kind ? '0' : '1') + a.ban + a.subj).localeCompare((b.ban === kind ? '0' : '1') + b.ban + b.subj, 'ko') || (KIND_ORDER[a.kind] || 9) - (KIND_ORDER[b.kind] || 9) || a.round - b.round; });
    var groups = [], last = '';
    ps.forEach(function (p) {
      var g = p.ban + '반 · ' + p.subj;
      if (g !== last) { groups.push({ g: g, items: [] }); last = g; }
      groups[groups.length - 1].items.push(p);
    });
    return '<div class="pick"><label for="' + id + '">수업 폴더 답지에서 고르기</label><select id="' + id + '"><option value="">직접 입력</option>' +
      groups.map(function (x) {
        return '<optgroup label="' + esc(x.g) + '">' + x.items.map(function (p) {
          return '<option value="' + esc(p.id) + '">' + esc(p.label) + ' · ' + p.total + '문' + (used(p) ? ' · 이 달 등록됨' : '') + '</option>';
        }).join('') + '</optgroup>';
      }).join('') + '</select><p class="meta">고르면 이름·문항 수' + (kinds.indexOf('일문일답') < 0 ? '·정답' : '') + '이 채워져요. 답지가 바뀌면 기록장 「시험지」 탭을 고치면 돼요.</p></div>';
  }
  function paper(id) { return (D.papers || []).filter(function (p) { return p.id === id; })[0]; }
  function msg(el, ok, text) { el.className = 'msg ' + (ok ? 'ok' : 'err'); el.textContent = text; }
  function twoStep(btn, label, fn) {
    btn.onclick = function () {
      if (btn.getAttribute('data-armed')) { btn.removeAttribute('data-armed'); fn(); return; }
      var old = btn.textContent; btn.setAttribute('data-armed', '1'); btn.textContent = '한 번 더 누르면 ' + label;
      setTimeout(function () { if (btn.getAttribute('data-armed')) { btn.removeAttribute('data-armed'); btn.textContent = old; } }, 3000);
    };
  }

  /* ---------- 머리띠 ---------- */
  function renderMonths() {
    var m = {}; m[D.today.slice(0, 7)] = 1;
    var d = new Date(D.today + 'T00:00:00'); d.setMonth(d.getMonth() + 1); m[Core.monthOf(d)] = 1;
    D.exams.forEach(function (e) { m[e.month] = 1; }); D.homework.forEach(function (h) { m[h.month] = 1; }); m[month] = 1;
    $('#month').innerHTML = Object.keys(m).filter(Boolean).sort().reverse().map(function (x) { return '<option value="' + x + '"' + (x === month ? ' selected' : '') + '>' + UI.monthLabel(x) + '</option>'; }).join('');
  }
  function renderNav() {
    $('#nav').innerHTML = TABS.map(function (t) { return '<button type="button" role="tab" data-t="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + t[1] + '</button>'; }).join('');
    all('#nav button').forEach(function (b) { b.onclick = function () { tab = b.getAttribute('data-t'); renderNav(); render(); }; });
  }
  /** 모든 탭 위에 「2026년 10월」 + 앞뒤 달 이동 (계속 쓰는 기록이라 지금 보는 달이 늘 보이게) */
  function renderPeriod() {
    var ms = Array.prototype.map.call($('#month').options, function (o) { return o.value; }).sort();
    var i = ms.indexOf(month);
    $('#period').innerHTML = '<button type="button" class="pv" data-mv="-1" aria-label="이전 달"' + (i <= 0 ? ' disabled' : '') + '>‹</button>' +
      '<b>' + esc(UI.monthLabel(month)) + '</b>' +
      '<button type="button" class="pv" data-mv="1" aria-label="다음 달"' + (i >= ms.length - 1 ? ' disabled' : '') + '>›</button>' +
      (month === D.today.slice(0, 7) ? '<span class="pill blue">이번 달</span>' : '');
    all('#period [data-mv]').forEach(function (b) { b.onclick = function () { var j = i + (+b.getAttribute('data-mv')); if (ms[j]) { month = ms[j]; $('#month').value = month; render(); } }; });
  }
  function render() { if (oneTimer) { clearInterval(oneTimer); oneTimer = 0; } $('#period').hidden = tab === 'plan' || tab === 'one'; renderPeriod(); ({ entry: vEntry, exams: vExams, item: vItem, hw: vHw, stu: vStu, one: vOne, month: vMonth, plan: vPlan })[tab](); }

  /** 채점표: 답지처럼 5문항씩 묶어서 모든 문항을 보여 줌 (한 줄에 10문항 = 5칸 묶음 둘). 맞은 문항은 ○, 틀린 문항은 학생 답을 빨갛게 — 시험지에 바로 체크하기 쉽게 */
  /** 한 줄 문항 수: 월말테스트 답지는 8개씩 끊겨 있어 8개씩 (2026-10-29 사용자), 나머지는 10개씩 */
  function perLine(ex) { return ex && ex.kind === '월말테스트' ? 8 : 10; }
  function gradeTable(key, ans, per) {
    per = per || 10; var n = key.length; ans = Core.padAnswers(ans, n);
    var h = '', cols = [];
    function g5(j) { return (per === 10 && j % 5 === 0 && j % 10 !== 0) ? ' g5' : ''; }   // 5칸마다 띄움
    function row(cls, th, f) { return '<tr class="' + cls + '"><th>' + th + '</th>' + cols.map(f).join('') + '</tr>'; }
    for (var i = 0; i < n; i += per) {
      cols = []; for (var j = i; j < Math.min(i + per, n); j++) cols.push(j);
      h += '<table class="wt all"><tbody>' +
        row('n', '문항', function (j) { return '<td class="' + g5(j) + '">' + (j + 1) + '</td>'; }) +
        row('k', '정답', function (j) { return '<td class="' + g5(j) + '">' + key.charAt(j) + '</td>'; }) +
        row('a', '학생', function (j) {
          var a = ans.charAt(j), ok = a === key.charAt(j);
          return '<td class="' + (ok ? 'o' : 'x') + g5(j) + '">' + (ok ? '○' : (a === '0' ? '–' : a)) + '</td>';
        }) + '</tbody></table>';
    }
    return '<div class="wtw">' + h + '</div>';
  }

  /* ---------- 답안 입력 ---------- */
  var KINDS = [['개념', '개념반'], ['단풀', '단풀반'], ['실전', '실전반']], entryKind = '';
  var entrySub = '', entryRound = '', entryDecade = '', decFor = '', entryPickOpen = false;
  function ejuOf(label) { var m = /EJU\s*(\d{4})\s*(?:\((\d)\)|-(\d))/.exec(label); return m ? { y: m[1], r: m[2] || m[3] } : null; }   // 「EJU 2011-2」(지금), 「EJU 2011(2)」(예전)
  function decadeOf(y) { return String(y).slice(0, 3) + '0'; }
  /** 요청을 하나씩 차례로 (시트 잠금 때문에 동시에 보내지 않음) */
  function seq(tasks, done) {
    var i = 0, okN = 0, err = '';
    (function next() { if (i >= tasks.length) return done(okN, err); tasks[i++]().then(function (r) { if (r.ok) okN++; else err = r.error; next(); }); })();
  }
  /** 실전 기출 고르기: 1회·2회(·그 밖의 시험) → 2020·2010·2000년대 → 연도 내림차순
   *  pre: 'e'(답안 입력) / 'x'(시험 탭), has(p): 이미 등록된 시험, others: EJU 가 아닌 이 달 시험 */
  function realPicker(pre, round, decade, has, curLabel, others, curId) {
    var ps = (D.papers || []).filter(function (p) { return p.ban === '실전' && ejuOf(p.label); });
    var rounds = ['1', '2'].concat(others && others.length ? ['기타'] : []);
    var h = '<div class="chiprow" aria-label="회차">' + rounds.map(function (r) {
      return '<button type="button" class="tab" data-' + pre + 'r="' + r + '" aria-selected="' + (r === round) + '">' + (r === '기타' ? '그 밖의 시험' : r + '회') + '</button>';
    }).join('') + '</div>';
    if (round === '기타') {
      return h + '<div class="chiprow years">' + others.map(function (e) { return '<button type="button" class="tab" data-pick="' + esc(e.id) + '" aria-selected="' + (e.id === curId) + '">' + esc(e.label) + '</button>'; }).join('') + '</div>';
    }
    var decs = ['2020', '2010', '2000'];
    h += '<div class="chiprow decs" aria-label="연대">' + decs.map(function (d) { return '<button type="button" class="tab" data-' + pre + 'd="' + d + '" aria-selected="' + (d === decade) + '">' + d + '년대</button>'; }).join('') + '</div>';
    var list = ps.filter(function (p) { var j = ejuOf(p.label); return j.r === round && decadeOf(j.y) === decade; })
      .sort(function (a, b) { return ejuOf(b.label).y - ejuOf(a.label).y; });
    return h + '<div class="chiprow years" aria-label="연도">' + (list.length ? list.map(function (p) {
      var on = has(p);
      return '<button type="button" class="tab' + (on ? ' has' : '') + '" data-' + pre + 'y="' + esc(p.id) + '" aria-selected="' + (p.label === curLabel) + '" title="' + (on ? '이 달에 등록됨' : '누르면 이 달 시험으로 등록') + '">' + ejuOf(p.label).y + '년</button>';
    }).join('') : '<span class="meta">이 연대의 ' + round + '회 기출이 없어요.</span>') + '</div>';
  }
  function entrySubOf(e) { var c = cls(e.cls); return c.kind === '실전' ? realSuffix(c.code) : c.code; }
  /** 시험지(답지) → 이 달 그 반에 등록하는 요청 (시험·일문일답 숙제) */
  function regExam(code, p) { return function () { return req('addExam', { cls: code, month: month, kind: p.kind, label: p.label, total: p.total, key: p.key }).then(function (r) { if (r.ok) D.exams.push(r.data); return r; }); }; }
  function regHw(code, p) { return function () { return req('addHomework', { cls: code, month: month, label: p.label, total: p.total }).then(function (r) { if (r.ok) D.homework.push(r.data); return r; }); }; }
  /** 반 종류·과목의 정해진 세트: 소테스트(주차순)·월말 (+개념은 일문일답 숙제) */
  function paperSet(kind, subj, withHw) {
    return (D.papers || []).filter(function (p) { return p.ban === kind && p.subj === subj && (p.kind === '소테스트' || p.kind === '월말테스트' || (withHw && kind === '개념' && p.kind === '일문일답')); })
      .sort(function (a, b) { return (KIND_ORDER[a.kind] || 9) - (KIND_ORDER[b.kind] || 9) || (+a.round || 99) - (+b.round || 99) || a.id.localeCompare(b.id); });
  }
  /** 그 반에 이 달 세트 중 빠진 것만 등록 */
  function prepClass(code, subj, done) {
    var kind = cls(code).kind, tasks = [];
    paperSet(kind, subj, true).forEach(function (p) { if (!hasPaper(code, p)) tasks.push(p.kind === '일문일답' ? regHw(code, p) : regExam(code, p)); });
    seq(tasks, done);
  }
  var retryMode = false;   // 답안 입력 탭의 「오답 채점」 (2026-10-27 사용자): 학생이 종이로 다시 풀어 온 틀린 문항의 답을 입력
  /** 오답 채점표: 처음 틀린 문항만 문항 / 정답 / 다시 쓴 답 (맞으면 ○) — 10문항씩 */
  function retryTable(key, wrong, raw, per) {
    var h = ''; per = per || 10;
    for (var i = 0; i < wrong.length; i += per) {
      var cols = wrong.slice(i, i + per).map(function (w, k) { return { n: w.n, key: w.key, a: raw.charAt(i + k) }; });
      function row(cls, th, f) { return '<tr class="' + cls + '"><th>' + th + '</th>' + cols.map(f).join('') + '</tr>'; }
      h += '<table class="wt all"><tbody>' + row('n', '문항', function (c) { return '<td>' + c.n + '</td>'; }) + row('k', '정답', function (c) { return '<td>' + c.key + '</td>'; }) +
        row('a', '다시', function (c) { var ok = c.a === c.key; return '<td class="' + (ok ? 'o' : 'x') + '">' + (ok ? '○' : (!c.a || c.a === '0' ? '–' : c.a)) + '</td>'; }) + '</tbody></table>';
    }
    return '<div class="wtw">' + h + '</div>';
  }
  var entryRender = 0, saving = 0, failed = {};   // failed: 저장 못 한 답안 (시험|번호 → 입력값) — 다시 누르면 채워 줌
  function vEntry() {
    var myRender = ++entryRender;
    var all_ = examsOfMonth();
    function kindOf(e) { return cls(e.cls).kind; }
    var cx = all_.filter(function (e) { return e.id === curExam; })[0];
    if (cx) { entryKind = kindOf(cx); entrySub = entrySubOf(cx); }
    if (!entryKind) entryKind = (KINDS.filter(function (k) { return all_.some(function (e) { return kindOf(e) === k[0]; }); })[0] || ['개념'])[0];
    var ofKind = all_.filter(function (e) { return kindOf(e) === entryKind; });
    var subs = []; ofKind.forEach(function (e) { var x = entrySubOf(e); if (subs.indexOf(x) < 0) subs.push(x); });
    subs.sort();
    var head = '<div class="seg" role="tablist" aria-label="반 종류">' + KINDS.map(function (k) {
        return '<button type="button" role="tab" data-k="' + k[0] + '" aria-selected="' + (k[0] === entryKind) + '">' + k[1] + '</button>';
      }).join('') + '</div>' +
      (subs.length ? '<div class="chiprow" role="tablist" aria-label="' + (entryKind === '실전' ? '반' : '과목') + '">' + subs.map(function (x) {
        return '<button type="button" class="tab" data-sub="' + esc(x) + '" aria-selected="' + (x === entrySub) + '">' + esc(entryKind === '실전' ? '실전반 ' + x : x) + '</button>';
      }).join('') + '</div>' : '');
    function bindHead() {
      all('#view .seg button').forEach(function (b) { b.onclick = function () { entryKind = b.getAttribute('data-k'); entrySub = ''; curExam = ''; vEntry(); }; });
      all('#view [data-sub]').forEach(function (b) { b.onclick = function () { entrySub = b.getAttribute('data-sub'); curExam = ''; entryPickOpen = false; vEntry(); }; });
    }
    var exs, ex, picker = '';
    if (entryKind === '실전') {
      // 실전: D·E → 1회·2회 → 연대 → 연도(내림차순). 이 달에 안 넣은 기출을 고르면 D·E 둘 다에 바로 등록
      var realCls = D.classes.filter(function (c) { return c.active && c.kind === '실전'; });
      var rsubs = realCls.map(function (c) { return realSuffix(c.code); });
      if (rsubs.indexOf(entrySub) < 0) entrySub = rsubs[0] || '';
      head = '<div class="seg" role="tablist" aria-label="반 종류">' + KINDS.map(function (k) {
          return '<button type="button" role="tab" data-k="' + k[0] + '" aria-selected="' + (k[0] === entryKind) + '">' + k[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="chiprow" aria-label="반">' + rsubs.map(function (x) { return '<button type="button" class="tab" data-sub="' + esc(x) + '" aria-selected="' + (x === entrySub) + '">실전반 ' + esc(x) + '</button>'; }).join('') + '</div>';
      var code = (realCls.filter(function (c) { return realSuffix(c.code) === entrySub; })[0] || {}).code;
      exs = all_.filter(function (e) { return e.cls === code; }).sort(function (a, b) { return (a.date || a.created).localeCompare(b.date || b.created); });
      // 이 달 이 반 시험을 먼저 칩으로 보여 주고 (기본은 가장 최근 것), 새 기출 추가는 아래 「다른 기출 고르기」에서 (2026-10-22: 회차를 누르면 빈 화면이 되던 것 고침)
      ex = exs.filter(function (e) { return e.id === curExam; })[0] || exs[exs.length - 1] || null;
      var ej = ex ? ejuOf(ex.label) : null;
      if (ex && !entryPickOpen) { entryRound = ej ? ej.r : '기타'; if (ej && decFor !== ex.id) { entryDecade = decadeOf(ej.y); decFor = ex.id; } }
      if (!entryRound) entryRound = '1';
      if (!entryDecade) entryDecade = '2020';
      var others = exs.filter(function (e) { return !ejuOf(e.label); });
      var monthChips = exs.length ? '<p class="meta" style="margin-top:14px">' + esc(UI.monthLabel(month)) + ' 실전반 ' + esc(entrySub) + ' 시험</p><div class="chiprow years" aria-label="이 달 시험">' + exs.map(function (e) {
        var n = D.results.filter(function (r) { return r.exam === e.id; }).length;
        return '<button type="button" class="tab" data-pick="' + esc(e.id) + '" aria-selected="' + (ex && e.id === ex.id) + '">' + esc(e.label) + (n ? ' <small>' + n + '명</small>' : '') + '</button>';
      }).join('') + '</div>' : '';
      var add = realPicker('e', entryRound, entryDecade, function (p) { return exs.filter(function (e) { return sameLabel(e.label, p.label); })[0]; }, ex ? ex.label : '', others, ex ? ex.id : '');
      picker = monthChips + '<details class="manual"' + (entryPickOpen || !exs.length ? ' open' : '') + ' id="pickMore"><summary>다른 기출 고르기 <span class="meta">(이 달에 처음 고르는 기출은 D·E에 같이 등록돼요)</span></summary>' + add + '</details>';
      if (!ex) {
        $('#view').innerHTML = '<div class="card">' + head + picker + '<p class="empty">이 달 실전반 ' + esc(entrySub) + ' 시험이 아직 없어요. 위에서 회차·연도를 고르면 등록되고 바로 입력할 수 있어요.</p><p id="emsg" class="msg" role="status"></p></div>';
        bindHead(); bindReal(); return;
      }
      picker += '<p class="pickedname">' + esc(ex.label) + ' <span class="meta">' + esc(ex.kind) + '</span></p>';
    } else {
      // 개념·단풀: 반 → (이 달 과목) → 시험. 답지(시험지)에 있는 시험은 고르는 순간 자동 등록 — 「시험」 탭을 거칠 필요 없음
      var kc = D.classes.filter(function (c) { return c.kind === entryKind && (c.active || ofKind.some(function (e) { return e.cls === c.code; })); });
      if (!kc.some(function (c) { return c.code === entrySub; })) entrySub = (kc.filter(function (c) { return subjIn(c.code, month); })[0] || kc[0] || {}).code || '';
      var code2 = entrySub, subj = subjIn(code2, month);
      head = '<div class="seg" role="tablist" aria-label="반 종류">' + KINDS.map(function (k) {
          return '<button type="button" role="tab" data-k="' + k[0] + '" aria-selected="' + (k[0] === entryKind) + '">' + k[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="chiprow" aria-label="반">' + kc.map(function (c) { return '<button type="button" class="tab" data-sub="' + esc(c.code) + '" aria-selected="' + (c.code === code2) + '">' + esc(clsName(c.code)) + '</button>'; }).join('') + '</div>';
      if (!code2) {
        $('#view').innerHTML = '<div class="card">' + head + '<p class="empty">' + kindName(entryKind) + '이 없어요. 기록장 「반」 탭에서 활성을 Y로 해 주세요.</p></div>';
        bindHead(); return;
      }
      if (!subj) {
        var subjects = []; (D.papers || []).forEach(function (p) { if (p.ban === entryKind && p.subj && subjects.indexOf(p.subj) < 0) subjects.push(p.subj); });
        $('#view').innerHTML = '<div class="card">' + head + '<p class="meta" style="margin-top:14px">' + esc(UI.monthLabel(month)) + ' 이 반 과목을 골라 주세요. 그 과목 시험' + (entryKind === '개념' ? '·일문일답 숙제' : '') + '가 정답까지 한 번에 들어가요.</p>' +
          '<div class="chiprow years" aria-label="과목">' + subjects.map(function (x) { return '<button type="button" class="tab" data-es="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div><p id="emsg" class="msg" role="status"></p></div>';
        bindHead();
        all('#view [data-es]').forEach(function (b) {
          b.onclick = function () {
            var x = b.getAttribute('data-es'), other = kc.filter(function (c) { return c.code !== code2 && subjIn(c.code, month) === x; })[0];
            if (other && !b.getAttribute('data-armed')) { b.setAttribute('data-armed', '1'); b.textContent = x + ' (' + clsName(other.code) + '와 같아요 — 한 번 더 누르면 진행)'; return; }
            all('#view [data-es]').forEach(function (y) { y.disabled = true; }); b.textContent = '준비하는 중…';
            prepClass(code2, x, function (okN, err) { curExam = ''; vEntry(); if (err) msg($('#emsg') || document.createElement('p'), false, err); });
          };
        });
        return;
      }
      exs = all_.filter(function (e) { return e.cls === code2; });
      var set = paperSet(entryKind, subj, false);
      var extra = exs.filter(function (e) { return !set.some(function (p) { return p.label === e.label; }); });
      ex = exs.filter(function (e) { return e.id === curExam; })[0] || null;
      if (!ex) {   // 기본: 아직 아무도 입력 안 한 첫 시험, 없으면 마지막
        var firstOpen = set.map(function (p) { return exs.filter(function (e) { return sameLabel(e.label, p.label); })[0]; }).filter(function (e) { return e && !D.results.some(function (r) { return r.exam === e.id; }); })[0];
        ex = firstOpen || exs[exs.length - 1] || null;
      }
      // 1줄: 1주차·2주차·3주차…  2줄: EJU 기출·월말(·그 밖의 시험). 과목은 위에서 골랐으니 이름에서 뺌
      function noSubj(lb) { return String(lb).replace(new RegExp('^' + subj + '\\s*'), '').replace(/^(현대사회|역사|세계사)\s*/, '') || lb; }
      function chip(p) {
        var got = exs.filter(function (e) { return sameLabel(e.label, p.label); })[0];
        var short = p.kind === '월말테스트' ? '월말' : (+p.round ? p.round + '주차' : noSubj(p.label));
        return '<button type="button" class="tab' + (got ? ' has' : '') + '" data-ep="' + esc(p.id) + '" aria-selected="' + (!!(ex && got && got.id === ex.id)) + '">' + esc(short) + '</button>';
      }
      var weekly = set.filter(function (p) { return p.kind === '소테스트' && +p.round; });
      var rest = set.filter(function (p) { return weekly.indexOf(p) < 0; }).sort(function (a, b) { return (a.kind === '월말테스트') - (b.kind === '월말테스트'); });
      picker = '<div class="chiprow years" aria-label="주차별 시험">' + weekly.map(chip).join('') + '</div>' +
        '<div class="chiprow years" aria-label="기출·월말">' + rest.map(chip).join('') +
        extra.map(function (e) { return '<button type="button" class="tab has" data-pick="' + esc(e.id) + '" aria-selected="' + (!!(ex && e.id === ex.id)) + '">' + esc(noSubj(e.label)) + '</button>'; }).join('') + '</div>';
      if (!ex) {
        $('#view').innerHTML = '<div class="card">' + head + picker + '<p class="empty">시험을 고르면 바로 입력할 수 있어요.</p><p id="emsg" class="msg" role="status"></p></div>';
        bindHead(); bindPaper(); return;
      }
      picker += '<p class="pickedname">' + esc(ex.label) + ' <span class="meta">' + esc(ex.kind) + ' · ' + ex.total + '문</span></p>';
    }
    curExam = ex.id;
    var mem = rosterFor(ex.cls, ex.month), cur = null;
    function bindPaper() {
      all('#view [data-ep]').forEach(function (b) {
        b.onclick = function () {
          var p = paper(b.getAttribute('data-ep')); if (!p) return;
          var got = exs.filter(function (e) { return sameLabel(e.label, p.label); })[0];
          if (got) { curExam = got.id; entryPickOpen = false; vEntry(); return; }
          b.disabled = true; b.textContent = '등록 중…';
          seq([regExam(entrySub, p)], function (okN, err) {
            if (err) { b.disabled = false; return msg($('#emsg'), false, err); }
            var g = examsOfMonth().filter(function (e) { return e.cls === entrySub && sameLabel(e.label, p.label); })[0];
            curExam = g ? g.id : ''; vEntry();
          });
        };
      });
      all('#view [data-pick]').forEach(function (b) { b.onclick = function () { curExam = b.getAttribute('data-pick'); entryPickOpen = false; vEntry(); }; });
    }
    function bindReal() {
      all('#view [data-er]').forEach(function (b) { b.onclick = function () { entryRound = b.getAttribute('data-er'); entryPickOpen = true; vEntry(); }; });
      all('#view [data-ed]').forEach(function (b) { b.onclick = function () { entryDecade = b.getAttribute('data-ed'); entryPickOpen = true; vEntry(); }; });
      all('#view [data-pick]').forEach(function (b) { b.onclick = function () { curExam = b.getAttribute('data-pick'); entryPickOpen = false; vEntry(); }; });
      all('#view [data-ey]').forEach(function (b) {
        b.onclick = function () {
          var p = paper(b.getAttribute('data-ey')); if (!p) return;
          var got = exs.filter(function (e) { return sameLabel(e.label, p.label); })[0];
          if (got) { curExam = got.id; entryPickOpen = false; vEntry(); return; }
          b.disabled = true; b.textContent = '등록 중…';
          var targets = D.classes.filter(function (c) { return c.active && c.kind === '실전' && !examsOfMonth().some(function (e) { return e.cls === c.code && sameLabel(e.label, p.label); }); });
          seq(targets.map(function (c) { return function () { return req('addExam', { cls: c.code, month: month, kind: p.kind, label: p.label, total: p.total, key: p.key }).then(function (r) { if (r.ok) D.exams.push(r.data); return r; }); }; }), function (okN, err) {
            if (err) { b.disabled = false; return msg($('#emsg'), false, err); }
            var mineNow = examsOfMonth().filter(function (e) { return e.cls === code && sameLabel(e.label, p.label); })[0];
            curExam = mineNow ? mineNow.id : ''; entryPickOpen = false; vEntry();
          });
        };
      });
    }
    $('#view').innerHTML =
      '<div class="grid2" style="margin-top:12px"><div class="card">' + head + picker +
      '<p class="meta" id="exMeta"></p>' +
      '<div class="seg" id="modeSeg" role="tablist" aria-label="입력 종류" style="margin-top:12px"><button type="button" role="tab" data-mode="0" aria-selected="' + !retryMode + '">답안 입력</button><button type="button" role="tab" data-mode="1" aria-selected="' + retryMode + '">오답 채점</button></div>' +
      '<label for="stIn">학생 (이름 또는 번호)</label><input id="stIn" type="text" list="stList" autocomplete="off"><datalist id="stList"></datalist>' +
      '<div class="hit" id="hit"></div>' +
      '<label for="ansIn" id="ansLb">답안 (고른 번호를 이어서, 무응답은 0)</label><input id="ansIn" class="ans" type="text" inputmode="numeric" autocomplete="off">' +
      '<p class="meta" id="cnt"></p><div id="prev"></div>' +
      '<button type="button" class="btn" id="save">저장하고 다음 학생 (Enter)</button><p id="emsg" class="msg" role="status"></p>' +
      '</div><div class="card"><h2>입력 현황</h2><div id="roster"></div></div></div>';
    if ($('#exSel')) $('#exSel').onchange = function () { curExam = this.value; vEntry(); };
    all('#view [data-pick]').forEach(function (b) { b.onclick = function () { curExam = b.getAttribute('data-pick'); entryPickOpen = false; vEntry(); }; });
    bindHead(); bindReal(); bindPaper();
    function meta() { $('#exMeta').textContent = ex.total + '문항 · 입력 ' + mem.filter(function (s) { return resultOf(ex.id, s.code); }).length + ' / ' + mem.length + '명'; }
    meta();
    $('#stList').innerHTML = mem.map(function (s) { return '<option value="' + esc(s.name) + '" label="' + esc(Core.fmtCode(s.code)) + '"></option>'; }).join('');
    $('#ansIn').maxLength = ex.total;
    function wrongOf(rec) { return rec && rec.answers ? Core.grade(ex.key, rec.answers).wrong : []; }
    /** 아직 다시 맞히지 못한 문항 — 오답 채점은 이것만 입력 */
    function leftOf(rec) { return wrongOf(rec).filter(function (x) { return !(rec.retry && rec.retry.charAt(x.n - 1) === x.key); }); }
    /** 모드에 맞게 입력칸 이름·길이를 바꿈 (오답 채점이면 그 학생의 틀린 문항 수만큼) */
    function syncMode() {
      var rec = retryMode && cur ? resultOf(ex.id, cur.code) : null;
      $('#ansLb').textContent = retryMode ? '다시 쓴 답 (' + (rec && rec.retry ? '아직 틀린' : '틀린') + ' 문항 순서대로 이어서' + (rec && !rec.pending ? ', ' + leftOf(rec).length + '개' : '') + ', 못 풀면 0)' : '답안 (고른 번호를 이어서, 무응답은 0)';
      $('#ansIn').maxLength = retryMode ? (rec ? Math.max(1, leftOf(rec).length) : ex.total) : ex.total;
      $('#save').textContent = retryMode ? '오답 저장하고 다음 학생 (Enter)' : '저장하고 다음 학생 (Enter)';
    }
    all('#modeSeg [data-mode]').forEach(function (b) { b.onclick = function () { retryMode = b.getAttribute('data-mode') === '1'; vEntry(); }; });
    function resolve() {
      var q = $('#stIn').value.trim(), n = Core.normCode(q), hit = $('#hit'); cur = null;
      if (!q) { hit.className = 'hit'; hit.textContent = ''; return; }
      var exact = mem.filter(function (s) { return s.code === n || s.name === q; });
      var part = exact.length ? exact : mem.filter(function (s) { return s.name.indexOf(q) >= 0; });
      if (part.length === 1) { cur = part[0]; hit.className = 'hit good'; hit.textContent = cur.name + ' · ' + Core.fmtCode(cur.code) + (resultOf(ex.id, cur.code) ? ' · 이미 입력됨 (저장하면 덮어씀)' : ''); }
      else if (part.length > 1) { hit.className = 'hit bad'; hit.textContent = '비슷한 이름이 ' + part.length + '명이에요. 번호로 입력해 주세요.'; }
      else { hit.className = 'hit bad'; hit.textContent = '이 반에서 찾을 수 없어요.'; }
      if (retryMode && cur) {
        var rr = resultOf(ex.id, cur.code), nw = wrongOf(rr).length, lf = leftOf(rr);
        if (!rr) { hit.className = 'hit bad'; hit.textContent = cur.name + ' · 아직 이 시험 답안이 없어요. 「답안 입력」에서 먼저 넣어 주세요.'; }
        else if (!nw) { hit.className = 'hit good'; hit.textContent = cur.name + ' · 틀린 문항이 없어요 (만점)'; }
        else if (!lf.length) { hit.className = 'hit good'; hit.textContent = cur.name + ' · 틀린 문항 ' + nw + '개를 전부 고쳤어요'; }
        else hit.textContent = cur.name + ' · ' + (rr.retry ? '아직 틀린 문항 ' + lf.length + '/' + nw + '개' : '틀린 문항 ' + nw + '개') + ' (' + lf.map(function (w) { return w.n; }).join(', ') + ')';
      }
      syncMode();
    }
    function previewRetry() {
      var rec = cur && resultOf(ex.id, cur.code), w = leftOf(rec || {}), v = Core.cleanAnswers($('#ansIn').value, Math.max(1, w.length)); $('#ansIn').value = v;
      if (!rec || !w.length) { $('#cnt').textContent = ''; $('#prev').innerHTML = ''; return; }
      $('#cnt').textContent = '입력 ' + v.length + ' / ' + w.length + (v.length && v.length < w.length ? ' · 남은 칸은 못 푼 것으로 저장돼요' : '');
      if (!v) { $('#prev').innerHTML = ''; return; }
      var fixed = w.filter(function (x, i) { return v.charAt(i) === x.key; }).length;
      $('#prev').innerHTML = '<div class="result"><b>' + fixed + ' / ' + w.length + '</b><span class="meta">오답 다시 맞힘</span></div>' + (fixed === w.length ? '<p class="allok">전부 고쳤어요</p>' : '') + retryTable(ex.key, w, v, perLine(ex));
    }
    function preview() {
      if (retryMode) return previewRetry();
      var v = Core.cleanAnswers($('#ansIn').value, ex.total); $('#ansIn').value = v;
      $('#cnt').textContent = '입력 ' + v.length + ' / ' + ex.total + (v.length && v.length < ex.total ? ' · 남은 칸은 무응답으로 저장돼요' : '');
      if (!v) { $('#prev').innerHTML = ''; return; }
      var g = Core.grade(ex.key, v);
      $('#prev').innerHTML = '<div class="result"><b>' + g.score + ' / ' + ex.total + '</b><span class="meta">틀린 문항 ' + g.wrong.length + '개</span></div>' +
        (g.wrong.length ? '' : '<p class="allok">전부 맞았어요</p>') + gradeTable(ex.key, v, perLine(ex));
    }
    function roster() {
      $('#roster').innerHTML = '<div class="tw"><table><thead><tr><th>이름</th><th>번호</th><th class="num">점수</th><th>' + (retryMode ? '오답' : '상태') + '</th></tr></thead><tbody>' +
        mem.map(function (s) { var r = resultOf(ex.id, s.code), f = failed[ex.id + '|' + s.code];
          if (retryMode) {
            var w = wrongOf(r), fx = r && r.retry ? w.filter(function (x) { return r.retry.charAt(x.n - 1) === x.key; }).length : 0;
            return '<tr class="click" data-c="' + esc(s.code) + '"><td>' + esc(s.name) + '</td><td class="code">' + esc(Core.fmtCode(s.code)) + '</td><td class="num">' + (r ? r.score + '/' + ex.total : '-') + '</td><td>' +
              (!r ? '<span class="pill no">답안 없음</span>' : !w.length ? '<span class="pill ok">만점</span>' : r.retry ? '<span class="pill ' + (fx === w.length ? 'ok' : 'wait') + '">' + fx + '/' + w.length + ' 고침</span>' : '<span class="pill no">오답 ' + w.length + '개 미채점</span>') + '</td></tr>';
          }
          return '<tr class="click" data-c="' + esc(s.code) + '"><td>' + esc(s.name) + '</td><td class="code">' + esc(Core.fmtCode(s.code)) + '</td><td class="num">' + (r ? r.score + '/' + ex.total : '-') + '</td><td>' + (f !== undefined ? '<span class="pill no">저장 실패</span>' : r && r.pending ? '<span class="pill wait">저장 중</span>' : r ? '<span class="pill ok">입력됨</span>' : '<span class="pill no">미입력</span>') + '</td></tr>'; }).join('') +
        '</tbody></table></div><p class="meta" style="margin-top:8px">줄을 누르면 그 학생을 불러옵니다. ' + (retryMode ? '아직 틀린 문항이 남은 학생 ' + mem.filter(function (s) { var r = resultOf(ex.id, s.code); return r && leftOf(r).length; }).length : '미입력 ' + mem.filter(function (s) { return !resultOf(ex.id, s.code); }).length) + '명</p>';
      all('#roster tr.click').forEach(function (tr) {
        tr.onclick = function () { var s = stu(tr.getAttribute('data-c')), r = resultOf(ex.id, s.code), f = failed[ex.id + '|' + s.code]; $('#stIn').value = s.name; resolve(); $('#ansIn').value = retryMode ? '' : f !== undefined ? f : r ? r.answers.replace(/0+$/, '') : ''; preview(); $('#ansIn').focus(); };
      });
    }
    // 저장은 기다리지 않음: 채점 결과를 바로 표에 넣고 다음 학생으로 넘어가며, 서버 저장은 뒤에서 (실패하면 표에 「저장 실패」)
    function saveRetry() {
      var m = $('#emsg'), v = $('#ansIn').value;
      resolve();
      if (!cur) return msg(m, false, '학생을 먼저 정해 주세요.');
      var who = cur, e0 = ex, rec = resultOf(e0.id, who.code), w = leftOf(rec || {});
      if (!rec || rec.pending) return msg(m, false, '이 시험 답안이 먼저 저장돼 있어야 해요.');
      if (!w.length) return msg(m, false, wrongOf(rec).length ? '틀린 문항을 전부 고친 학생이에요.' : '틀린 문항이 없는 학생이에요.');
      if (!v) return msg(m, false, '다시 쓴 답을 입력해 주세요.');
      var raw = Core.cleanAnswers(v, w.length), arr = (rec.retry || Core.padAnswers('', e0.total)).split('');
      w.forEach(function (x, i) { arr[x.n - 1] = raw.charAt(i) || '0'; });
      var before = rec, after = Object.assign({}, rec, { retry: arr.join('') }), fixed = w.filter(function (x, i) { return raw.charAt(i) === x.key; }),
        left = w.filter(function (x, i) { return raw.charAt(i) !== x.key; }).map(function (x) { return x.n; });
      var same = function (x) { return x.exam === e0.id && x.code === who.code; };
      replace(D.results, same, after);
      saving++;
      msg(m, true, who.name + ' 오답 ' + fixed.length + '/' + w.length + ' 고침' + (left.length ? ' · 아직 틀림 ' + left.join(', ') : ' · 전부 고침') + ' — 저장 중…');
      $('#stIn').value = ''; $('#ansIn').value = ''; $('#hit').textContent = ''; $('#prev').innerHTML = ''; $('#cnt').textContent = ''; cur = null; syncMode();
      meta(); roster(); $('#stIn').focus();
      req('saveRetry', { exam: e0.id, code: who.code, answers: v }).then(function (r) {
        saving--;
        var here = myRender === entryRender && $('#emsg');
        if (!r.ok) {
          replace(D.results, same, before);
          if (here) { msg($('#emsg'), false, who.name + ' 오답 저장 못 했어요: ' + r.error + ' — 표에서 이름을 눌러 다시 저장해 주세요.'); roster(); }
          return;
        }
        replace(D.results, same, Object.assign({}, after, { retry: r.data.retry }));
        if (here) { roster(); if (!saving && /저장 중/.test($('#emsg').textContent)) msg($('#emsg'), true, $('#emsg').textContent.replace(' — 저장 중…', ' — 저장했어요')); }
      });
    }
    function save() {
      if (retryMode) return saveRetry();
      var m = $('#emsg'), v = $('#ansIn').value;
      resolve();
      if (!cur) return msg(m, false, '학생을 먼저 정해 주세요.');
      if (!v) return msg(m, false, '답안을 입력해 주세요.');
      var who = cur, e0 = ex, ans = Core.padAnswers(Core.cleanAnswers(v, e0.total), e0.total), g = Core.grade(e0.key, ans);
      var same = function (x) { return x.exam === e0.id && x.code === who.code; }, before = resultOf(e0.id, who.code);
      var prov = { exam: e0.id, code: who.code, answers: ans, score: g.score, wrong: g.wrong.map(function (w) { return w.n; }), conv: null, at: '', pending: true };
      replace(D.results, same, prov);
      saving++;
      msg(m, true, who.name + ' ' + g.score + '/' + e0.total + (g.wrong.length ? ' · 틀린 문항 ' + prov.wrong.join(', ') : ' · 만점') + ' — 저장 중…');
      $('#stIn').value = ''; $('#ansIn').value = ''; $('#hit').textContent = ''; $('#prev').innerHTML = ''; $('#cnt').textContent = '';
      meta(); roster(); $('#stIn').focus();
      req('saveResult', { exam: e0.id, code: who.code, answers: v }).then(function (r) {
        saving--;
        var here = myRender === entryRender && $('#emsg');
        if (!r.ok) {
          if (before) replace(D.results, same, before); else D.results = D.results.filter(function (x) { return x !== prov; });
          failed[e0.id + '|' + who.code] = v;
          if (here) { msg($('#emsg'), false, who.name + ' 저장 못 했어요: ' + r.error + ' — 표에서 이름을 눌러 다시 저장해 주세요.'); roster(); meta(); }
          return;
        }
        delete failed[e0.id + '|' + who.code];
        replace(D.results, same, r.data);
        if (here) { roster(); meta(); if (!saving && /저장 중/.test($('#emsg').textContent)) msg($('#emsg'), true, $('#emsg').textContent.replace(' — 저장 중…', ' — 저장했어요')); }
      });
    }
    $('#stIn').oninput = resolve;
    $('#stIn').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#ansIn').focus(); } };
    $('#ansIn').oninput = preview;
    $('#ansIn').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } };
    $('#save').onclick = save;
    syncMode(); roster(); $('#stIn').focus();
  }

  /* ---------- 시험 ---------- */
  // 반 종류 → (개념·단풀) 과목 / (실전) D·E → 수업 폴더 답지 목록에서 바로 등록. 시험일·시간대는 안 씀 (해마다·달마다 바뀜)
  var examKind = '', examRound = '1', examDecade = '2020';
  function kindName(k) { return k + '반'; }
  function realSuffix(code) { return String(code).split('-').pop(); }
  function examGroup(e) {
    var c = cls(e.cls);
    return { kind: c.kind, sub: c.kind === '실전' ? '실전반 ' + realSuffix(c.code) : (subjOf(e.label) || '기타') };
  }
  function vExams() {
    var exs = examsOfMonth(), papers = D.papers || [];
    if (!KINDS.some(function (k) { return k[0] === examKind; })) examKind = entryKind || '개념';
    var real = examKind === '실전';
    var activeCls = D.classes.filter(function (c) { return c.active && c.kind === examKind; });
    var h = '<div class="card"><h2>' + esc(UI.monthLabel(month)) + ' 시험 준비</h2>' +
      '<div class="seg" role="tablist" aria-label="반 종류">' + KINDS.map(function (k) { return '<button type="button" role="tab" data-ek="' + k[0] + '" aria-selected="' + (k[0] === examKind) + '">' + k[1] + '</button>'; }).join('') + '</div>';
    function subjNow(code) { return subjIn(code, month); }   // 이 달 그 반의 과목 (등록된 시험·숙제 이름에서)
    var subjects = []; papers.forEach(function (p) { if (p.ban === examKind && p.subj && subjects.indexOf(p.subj) < 0) subjects.push(p.subj); });
    if (!real) {
      // 개념·단풀: 과목마다 소테스트·월말(개념은 일문일답 숙제까지)이 정해져 있으니, 반의 이 달 과목만 고르면 한꺼번에 준비
      h += '<p class="meta" style="margin-top:12px">따로 등록하지 않아도 돼요. 「답안 입력」에서 반·과목·시험을 고르면 답지 정답으로 바로 등록돼요. 여기서는 그 달 ' + (examKind === '개념' ? '소테스트·월말·일문일답 숙제' : '시험') + '를 미리 한꺼번에 넣거나 정답을 고칠 때만 쓰면 돼요.</p>' +
        '<div class="plist">' + (activeCls.length ? activeCls.map(function (c) {
          var cur = subjNow(c.code), set = papers.filter(function (p) { return p.ban === examKind && p.subj === cur && (p.kind === '소테스트' || p.kind === '월말테스트' || (examKind === '개념' && p.kind === '일문일답')); });
          var missing = set.filter(function (p) { return !hasPaper(c.code, p); }).length;
          return '<div class="prow"><div><b>' + esc(clsName(c.code)) + '</b><span class="meta">' + (cur ? '이번 달 ' + esc(cur) + ' · 시험 ' + exs.filter(function (e) { return e.cls === c.code; }).length + '개 · 숙제 ' + hwOfMonth().filter(function (x) { return x.cls === c.code; }).length + '개' : '아직 과목을 안 정했어요') + '</span></div>' +
            '<div class="pickrow"><select data-subsel="' + esc(c.code) + '" aria-label="' + esc(clsName(c.code)) + ' 과목"><option value="">과목 고르기</option>' + subjects.map(function (x) { return '<option' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
            (cur && !missing ? '<span class="pill ok">준비됨</span>' : '<button type="button" class="btn soft sm" data-prep="' + esc(c.code) + '">' + (cur && missing ? '빠진 ' + missing + '개 채우기' : '준비하기') + '</button>') + '</div></div>';
        }).join('') : '<p class="empty">이 반 종류의 반이 없어요. 기록장 「반」 탭에서 활성을 Y로 해 주세요.</p>') + '</div>';
    } else {
      // 실전: D·E 는 같은 시험 — 한 번 등록하면 두 반 모두
      // 1회·2회 → 2020·2010·2000년대 → 연도(내림차순)
      var list = papers.filter(function (p) { var j = p.ban === '실전' && ejuOf(p.label); return j && j.r === examRound && decadeOf(j.y) === examDecade; })
        .sort(function (a, b) { return ejuOf(b.label).y - ejuOf(a.label).y; });
      h += '<p class="meta" style="margin-top:12px">답지가 있는 기출 목록이에요. 「이 달 등록됨」만 이번 달에 본 시험이고, 나머지는 아직 이 달 시험이 아니에요. 「답안 입력」에서 회차·연도를 고르면 D·E에 같이 바로 등록돼서 여기서 따로 누를 필요는 없어요.</p>' +
        '<div class="chiprow" aria-label="회차">' + ['1', '2'].map(function (r) { return '<button type="button" class="tab" data-xr="' + r + '" aria-selected="' + (r === examRound) + '">' + r + '회</button>'; }).join('') + '</div>' +
        '<div class="chiprow decs" aria-label="연대">' + ['2020', '2010', '2000'].map(function (d) { return '<button type="button" class="tab" data-xd="' + d + '" aria-selected="' + (d === examDecade) + '">' + d + '년대</button>'; }).join('') + '</div>' +
        (list.length ? '<div class="plist">' + list.map(function (p) {
          var have = activeCls.filter(function (c) { return hasPaper(c.code, p); }), done = activeCls.length && have.length === activeCls.length;
          // 이 달에 본(등록한) 시험만 「이 달 등록됨」. 나머지는 답지 목록에 있는 기출일 뿐 — 버튼을 눌러야 이 달 시험으로 들어감
          return '<div class="prow"><div><b>' + ejuOf(p.label).y + '년 ' + examRound + '회</b><span class="meta">' + esc(p.label) + ' · ' + p.total + '문' +
            (have.length && !done ? ' · ' + have.map(function (c) { return realSuffix(c.code); }).join('·') + '반만 등록됨' : '') + '</span></div>' +
            (done ? '<span class="pill ok">이 달 등록됨</span>' : '<button type="button" class="btn soft sm" data-reg="' + esc(p.id) + '"' + (activeCls.length ? '' : ' disabled') + '>' + (have.length ? '나머지 반도 추가' : '이 달에 추가') + '</button>') + '</div>';
        }).join('') + '</div>' : '<p class="empty">이 연대의 ' + examRound + '회 기출이 없어요.</p>');
    }
    h += '<p id="nMsg" class="msg" role="status"></p>' +
      '<details class="manual"><summary>목록에 없는 시험 직접 등록</summary><div class="fields">' +
      (real ? '' : '<div><label for="nC">반</label><select id="nC">' + activeCls.map(function (c) { return '<option value="' + esc(c.code) + '">' + esc(clsName(c.code)) + '</option>'; }).join('') + '</select></div>') +
      '<div><label for="nK">종류</label><select id="nK">' + (real ? '<option>모의고사</option><option>월말테스트</option>' : '<option>소테스트</option><option>월말테스트</option>') + '</select></div>' +
      '<div><label for="nL">시험 이름 <span class="opt">(학생 화면·월말 표에 나와요)</span></label><input id="nL" type="text" placeholder="' + (real ? '예: 啓程 11회' : '예: 경제 1주차') + '"></div>' +
      '<div><label for="nT">문항 수</label><input id="nT" type="number" min="1" max="80" value="' + (real ? 38 : 15) + '"></div></div>' +
      '<label for="nA">정답 (번호를 이어서)</label><input id="nA" class="ans" type="text" inputmode="numeric" autocomplete="off">' +
      '<p class="meta" id="nCnt"></p><button type="button" class="btn" id="nAdd"' + (activeCls.length ? '' : ' disabled') + '>시험 등록</button></details></div>';

    // 등록된 시험: 개념·단풀은 반(과목)별, 실전은 D·E 를 한 줄로
    h += '<div class="card"><h2>' + esc(UI.monthLabel(month)) + ' 등록된 시험</h2>';
    if (!exs.length) h += '<p class="empty">아직 없어요.</p>';
    function keyCell(ids, e) { return '<td><input type="text" class="ans keyin" style="width:' + Math.max(8, e.total * 0.72) + 'em" data-key="' + esc(ids.join(',')) + '" value="' + esc(e.key) + '" aria-label="' + esc(e.label) + ' 정답"> <button class="btn sub sm" type="button" data-savekey="' + esc(ids.join(',')) + '">정답 저장</button></td>'; }
    KINDS.forEach(function (k) {
      var ofKind = exs.filter(function (e) { return cls(e.cls).kind === k[0]; });
      if (!ofKind.length) return;
      h += '<h3 class="grp">' + k[1] + '</h3>';
      if (k[0] === '실전') {
        var labels = []; ofKind.forEach(function (e) { if (labels.indexOf(e.label) < 0) labels.push(e.label); });
        h += '<div class="tw"><table><thead><tr><th>시험</th><th>종류</th><th class="num">문항</th><th>입력</th><th>정답</th><th></th></tr></thead><tbody>' + labels.map(function (lb) {
          var es = ofKind.filter(function (e) { return e.label === lb; }), ids = es.map(function (e) { return e.id; });
          var cnt = es.map(function (e) { return realSuffix(e.cls) + ' ' + D.results.filter(function (r) { return r.exam === e.id; }).length + '명'; }).join(' · ');
          var any = es.some(function (e) { return D.results.some(function (r) { return r.exam === e.id; }); });
          return '<tr><td><b>' + esc(lb) + '</b></td><td>' + esc(es[0].kind) + '</td><td class="num">' + es[0].total + '</td><td>' + cnt + '</td>' + keyCell(ids, es[0]) +
            '<td>' + (any ? '' : '<button class="btn sm danger" type="button" data-del="' + esc(ids.join(',')) + '">삭제</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
        return;
      }
      var cl = []; ofKind.forEach(function (e) { if (cl.indexOf(e.cls) < 0) cl.push(e.cls); });
      cl.forEach(function (code) {
        h += '<p class="sub">' + esc(clsName(code)) + '</p><div class="tw"><table><thead><tr><th>시험</th><th>종류</th><th class="num">문항</th><th class="num">입력</th><th>정답</th><th></th></tr></thead><tbody>' +
          ofKind.filter(function (e) { return e.cls === code; }).map(function (e) {
            var n = D.results.filter(function (r) { return r.exam === e.id; }).length;
            return '<tr><td><b>' + esc(e.label) + '</b></td><td>' + esc(e.kind) + '</td><td class="num">' + e.total + '</td><td class="num">' + n + '명</td>' + keyCell([e.id], e) +
              '<td>' + (n ? '' : '<button class="btn sm danger" type="button" data-del="' + esc(e.id) + '">삭제</button>') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      });
    });
    if (exs.length) h += '<p class="meta" style="margin-top:10px">정답을 고쳐 저장하면 이미 입력한 답안을 새 정답으로 다시 채점해요.</p>';
    h += '<p id="xMsg" class="msg" role="status"></p></div>';
    $('#view').innerHTML = h;

    all('#view [data-ek]').forEach(function (b) { b.onclick = function () { examKind = b.getAttribute('data-ek'); vExams(); }; });
    all('#view [data-xr]').forEach(function (b) { b.onclick = function () { examRound = b.getAttribute('data-xr'); vExams(); }; });
    all('#view [data-xd]').forEach(function (b) { b.onclick = function () { examDecade = b.getAttribute('data-xd'); vExams(); }; });
    function chain(tasks, done) {   // 요청을 하나씩 (시트 잠금 때문에 동시에 보내지 않음)
      var i = 0, okN = 0, err = '';
      (function next() {
        if (i >= tasks.length) return done(okN, err);
        tasks[i++]().then(function (r) { if (r.ok) okN++; else err = r.error; next(); });
      })();
    }
    function addExamTo(code, p) { return function () { return req('addExam', { cls: code, month: month, kind: p.kind, label: p.label, total: p.total, key: p.key }).then(function (r) { if (r.ok) D.exams.push(r.data); return r; }); }; }
    function addHwTo(code, p) { return function () { return req('addHomework', { cls: code, month: month, label: p.label, total: p.total }).then(function (r) { if (r.ok) D.homework.push(r.data); return r; }); }; }
    function finish(okN, err) { vExams(); msg($('#nMsg'), !err, err ? err : okN + '개 준비했어요. 「답안 입력」에서 바로 입력할 수 있어요.'); }
    all('#view [data-prep]').forEach(function (b) {
      b.onclick = function () {
        var code = b.getAttribute('data-prep'), subj = $('#view [data-subsel="' + code + '"]').value;
        if (!subj) return msg($('#nMsg'), false, '과목을 먼저 골라 주세요.');
        var other = activeCls.filter(function (c) { return c.code !== code && subjNow(c.code) === subj; })[0];
        if (other && !b.getAttribute('data-armed')) { b.setAttribute('data-armed', '1'); b.textContent = other.name + '도 ' + subj + '예요. 그래도 준비'; return; }
        var set = papers.filter(function (p) { return p.ban === examKind && p.subj === subj; });
        var tasks = [];
        set.forEach(function (p) {
          if (hasPaper(code, p)) return;
          if (p.kind === '일문일답') { if (examKind === '개념') tasks.push(addHwTo(code, p)); }
          else if (p.kind === '소테스트' || p.kind === '월말테스트') tasks.push(addExamTo(code, p));
        });
        if (!tasks.length) return msg($('#nMsg'), true, '이미 다 준비돼 있어요.');
        b.disabled = true; b.textContent = '준비하는 중…';
        chain(tasks, finish);
      };
    });
    all('#view [data-subsel]').forEach(function (sel) {
      sel.onchange = function () { var b = $('#view [data-prep="' + sel.getAttribute('data-subsel') + '"]'); if (b) { b.removeAttribute('data-armed'); b.textContent = '준비하기'; } };
    });
    all('#view [data-reg]').forEach(function (b) {
      b.onclick = function () {
        var p = paper(b.getAttribute('data-reg')); if (!p) return;
        b.disabled = true; b.textContent = '등록 중…';
        chain(activeCls.filter(function (c) { return !hasPaper(c.code, p); }).map(function (c) { return addExamTo(c.code, p); }), finish);
      };
    });
    function cnt() { var t = +$('#nT').value || 0; $('#nA').value = Core.cleanKey($('#nA').value).slice(0, t); $('#nCnt').textContent = '정답 ' + $('#nA').value.length + ' / ' + t; }
    $('#nA').oninput = cnt; $('#nT').oninput = cnt; cnt();
    $('#nAdd').onclick = function () {
      var b = this, label = $('#nL').value.trim();
      if (!label) return msg($('#nMsg'), false, '시험 이름을 적어 주세요.');
      var p = { kind: $('#nK').value, label: label, total: $('#nT').value, key: $('#nA').value };
      var targets = real ? activeCls.map(function (c) { return c.code; }) : [$('#nC').value];
      b.disabled = true;
      chain(targets.map(function (code) { return addExamTo(code, p); }), function (okN, err) { b.disabled = false; finish(okN, err); });
    };
    all('#view [data-savekey]').forEach(function (b) {
      b.onclick = function () {
        var ids = b.getAttribute('data-savekey').split(','), v = $('#view [data-key="' + b.getAttribute('data-savekey') + '"]').value, last = null;
        chain(ids.map(function (id) { return function () { return req('updateExamKey', { exam: id, key: v }).then(function (r) { if (r.ok) last = r.data; return r; }); }; }), function (okN, err) {
          if (last) D = normSubj(last); vExams(); msg($('#xMsg'), !err, err || '정답을 고치고 다시 채점했어요.');
        });
      };
    });
    all('#view [data-del]').forEach(function (b) {
      twoStep(b, '삭제', function () {
        var ids = b.getAttribute('data-del').split(',');
        chain(ids.map(function (id) { return function () { return req('deleteExam', { exam: id }).then(function (r) { if (r.ok) D.exams = D.exams.filter(function (e) { return e.id !== id; }); return r; }); }; }), function (okN, err) { vExams(); if (err) msg($('#xMsg'), false, err); });
      });
    });
  }
  /** 그 반·이 달에 이 시험지(이름이 같은 시험 또는 숙제)가 이미 있는지 */
  /** 같은 시험·숙제인지: 과목 별칭(현대사회=현사, 세계사=역사)·띄어쓰기 차이는 같은 것으로 (이름 표기가 달라 두 번 등록되지 않게) */
  function sameLabel(a, b) {
    function n(x) { return String(x).replace(/현대사회/g, '현사').replace(/^세계사/, '역사').replace(/\s+/g, ''); }
    return n(a) === n(b);
  }
  function hasPaper(code, p) {
    var pool = p.kind === '일문일답' ? hwOfMonth() : examsOfMonth();
    return pool.some(function (x) { return x.cls === code && sameLabel(x.label, p.label); });
  }

  /* ---------- 숙제 ---------- */
  var newCls = '';
  function vHw() {
    var hws = hwOfMonth();
    var add = '<div class="card"><details' + (hws.length ? '' : ' open') + '><summary>' + esc(UI.monthLabel(month)) + ' 숙제 등록</summary><div class="fields">' +
      '<div><label for="hC">반</label><select id="hC">' + classOptions(newCls) + '</select></div></div><div id="hPick"></div><div class="fields">' +
      '<div><label for="hL">숙제 이름</label><input id="hL" type="text" placeholder="예: 4주차 숙제"></div>' +
      '<div><label for="hB">교재 <span class="opt">(선택)</span></label><input id="hB" type="text"></div>' +
      '<div><label for="hP0">시작 쪽 <span class="opt">(선택)</span></label><input id="hP0" type="number" min="1"></div>' +
      '<div><label for="hP1">끝 쪽</label><input id="hP1" type="number" min="1"></div>' +
      '<div><label for="hT">문항 수 <span class="opt">(선택)</span></label><input id="hT" type="number" min="1"></div></div>' +
      '<button type="button" class="btn" id="hAdd">숙제 등록</button><p id="hMsg" class="msg" role="status"></p></details></div>';
    if (!hws.length) { $('#view').innerHTML = add + '<div class="card"><p class="empty">이 달에 등록된 숙제가 없어요.</p></div>'; bindAdd(); return; }
    if (!hws.some(function (h) { return h.id === curHw; })) curHw = hws[hws.length - 1].id;
    var hw = hws.filter(function (h) { return h.id === curHw; })[0], mem = rosterFor(hw.cls, hw.month);
    var done = mem.filter(function (s) { return subOf(hw.id, s.code); });
    var toCheck = done.filter(function (s) { var u = subOf(hw.id, s.code); return u.photos && !u.checked; }).length;
    var past = hw.due && nowStamp() > hw.due;
    $('#view').innerHTML =
      '<div class="card"><label for="hSel">숙제</label><select id="hSel">' + hws.map(function (h, i) { return { h: h, i: i }; }).sort(function (a, b) {   // 반별로 묶고, 그 안에서 마감 빠른 순 (등록한 순서가 아니라). 마감이 없으면 등록 순서
        var ca = cls(a.h.cls), cb = cls(b.h.cls), ka = (ca.time || '') + ca.code, kb = (cb.time || '') + cb.code;
        return ka < kb ? -1 : ka > kb ? 1 : ((a.h.due || '9') < (b.h.due || '9') ? -1 : (a.h.due || '9') > (b.h.due || '9') ? 1 : a.i - b.i);
      }).map(function (x) { var h = x.h; return '<option value="' + esc(h.id) + '"' + (h.id === curHw ? ' selected' : '') + '>' + esc(cls(h.cls).time ? '[' + cls(h.cls).time + ']' : clsShort(h.cls)) + ' ' + esc(h.label) + (h.due ? ' · 마감 ' + Core.fmtDue(h.due) : '') + '</option>'; }).join('') + '</select>' +
      '<p class="meta" style="margin-top:8px">' + pages(hw) + (hw.total ? ' · ' + hw.total + '문' : '') + ' · 제출 ' + done.length + ' / ' + mem.length + '명 · 확인 ' + done.filter(function (s) { return subOf(hw.id, s.code).checked; }).length + '명' +
      ' · 늦음 ' + done.filter(function (s) { return subOf(hw.id, s.code).late; }).length + '명</p>' +
      '<div class="duebox"><span>마감 <b>' + (hw.due ? esc(Core.fmtDue(hw.due)) : '없음') + '</b> ' + (hw.dueSet ? '<span class="pill blue">직접 정함</span>' : '<span class="meta">(자동: ' + (hw.week ? hw.week + '번째 숙제 → ' + (2 * hw.week + 1) + '번째 수업 시작' : '수업 요일을 몰라요') + ')</span>') + (past ? ' <span class="pill wait">마감 지남</span>' : '') + '</span>' +
      '<button type="button" class="linkbtn" id="dueEd">마감 바꾸기</button></div>' +
      '<div id="dueForm" hidden class="fields"><div><label for="dueD">날짜</label><input id="dueD" type="date" value="' + esc((hw.due || '').slice(0, 10)) + '"></div>' +
      '<div><label for="dueT">시각</label><input id="dueT" type="time" value="' + esc((hw.due || '').slice(11, 16) || '00:00') + '"></div>' +
      '<div style="align-self:end"><button type="button" class="btn sm" id="dueSave">저장</button> ' + (hw.dueSet ? '<button type="button" class="btn sub sm" id="dueAuto">자동으로 되돌리기</button>' : '') + '</div></div>' +
      (toCheck ? '<button type="button" class="btn block" id="quick" style="margin-top:12px">빠른 검사 — 확인 안 한 ' + toCheck + '명 사진 보기</button>' : '') +
      missBox(hw, mem) +
      '<div class="tw" style="margin-top:10px"><table><thead><tr><th>이름</th><th>번호</th><th>상태</th><th class="num">맞은 개수</th><th class="num">사진</th><th>확인</th><th></th></tr></thead><tbody>' +
      mem.map(function (s) {
        var u = subOf(hw.id, s.code);
        var pw = (D.photoWarns || []).filter(function (x) { return x.hw === hw.id && x.code === s.code; });
        var warn = pw.length && !(u && u.checked) ? ' <span class="pill no" title="' + esc(pw.map(function (x) { return x.order + '번째: ' + x.msg; }).join('\n')) + '">⚠ 사진 확인</span><div class="meta warnline">' + pw.map(function (x) { return x.order + '번째 ' + esc(x.msg); }).join('<br>') + '</div>' : '';
        return '<tr><td>' + esc(s.name) + '</td><td class="code">' + esc(Core.fmtCode(s.code)) + '</td><td>' + (u ? (u.proxy ? '<span class="pill wait">대신 입력</span>' : '<span class="pill ok">제출</span>') + (u.late ? ' <span class="pill late" title="처음 낸 시각 ' + esc(u.first) + '">늦음</span>' : '') : '<span class="pill no">미제출</span>') + warn +
          (u && !u.proxy && u.first ? '<div class="meta">' + esc(u.first.slice(5)) + '</div>' : '') + '</td>' +
          '<td class="num">' + (u && u.count !== null ? u.count + (hw.total ? '/' + hw.total : '') : '-') + '</td><td class="num">' + (u ? u.photos + '장' : '-') + '</td>' +
          '<td>' + (u ? '<label class="check" style="margin:0"><input type="checkbox" data-ck="' + esc(s.code) + '"' + (u.checked ? ' checked' : '') + '> 확인</label>' : '') + '</td>' +
          '<td>' + (u && u.photos ? '<button type="button" class="btn sub sm" data-ph="' + esc(s.code) + '">사진 보기</button>' : '') +
          (u ? '' : '<input type="number" min="0" style="width:5.5em;padding:4px 6px;font-size:13px" data-pxv="' + esc(s.code) + '" placeholder="개수" aria-label="' + esc(s.name) + ' 맞은 개수"> <button type="button" class="btn sub sm" data-px="' + esc(s.code) + '">대신 입력</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (D.hwSubs.some(function (s) { return s.hw === hw.id; }) ? '' : '<button type="button" class="btn sub sm danger" id="hDel" style="margin-top:10px">이 숙제 삭제</button>') +
      '<p id="hwMsg" class="msg" role="status"></p></div>' + add;
    $('#hSel').onchange = function () { curHw = this.value; vHw(); };
    bindMiss(hw, mem);
    $('#dueEd').onclick = function () { $('#dueForm').hidden = !$('#dueForm').hidden; };
    function saveDue(v) {
      req('setHwDue', { hw: hw.id, due: v }).then(function (r) {
        if (!r.ok) return msg($('#hwMsg'), false, r.error);
        replace(D.homework, function (h) { return h.id === hw.id; }, r.data);
        load();   // 늦음 다시 계산
      });
    }
    $('#dueSave').onclick = function () { if (!$('#dueD').value) return msg($('#hwMsg'), false, '날짜를 골라 주세요.'); saveDue($('#dueD').value + ' ' + ($('#dueT').value || '00:00')); };
    if ($('#dueAuto')) $('#dueAuto').onclick = function () { saveDue(''); };
    if ($('#quick')) $('#quick').onclick = function () { quickCheck(hw, mem); };
    all('#view [data-ck]').forEach(function (c) {
      c.onchange = function () {
        var code = c.getAttribute('data-ck');
        req('setChecked', { hw: hw.id, code: code, checked: c.checked }).then(function (r) { if (!r.ok) { c.checked = !c.checked; return msg($('#hwMsg'), false, r.error); } subOf(hw.id, code).checked = c.checked; });
      };
    });
    all('#view [data-px]').forEach(function (b) {
      b.onclick = function () {
        var code = b.getAttribute('data-px'), v = $('#view [data-pxv="' + code + '"]').value;
        req('proxyHw', { hw: hw.id, code: code, count: v }).then(function (r) { if (!r.ok) return msg($('#hwMsg'), false, r.error); D.hwSubs.push(r.data); vHw(); });
      };
    });
    all('#view [data-ph]').forEach(function (b) { b.onclick = function () { photos(hw, stu(b.getAttribute('data-ph'))); }; });
    if ($('#hDel')) twoStep($('#hDel'), '삭제', function () {
      req('deleteHomework', { hw: hw.id }).then(function (r) { if (!r.ok) return msg($('#hwMsg'), false, r.error); D.homework = D.homework.filter(function (h) { return h.id !== hw.id; }); vHw(); });
    });
    bindAdd();
    function bindAdd() {
      function pick() {
        var c = $('#hC').value;
        $('#hPick').innerHTML = paperPick('hP', c, ['일문일답', '소테스트'], function (p) { return hws.some(function (h) { return h.cls === c && sameLabel(h.label, p.label); }); }, function (p) { return p.kind === '일문일답' || (p.ban === '단풀' && /EJU 기출/.test(p.label)); });   // 단풀반 「EJU 기출」도 숙제 (2026-10-25)
        if (!$('#hP')) return;
        $('#hP').onchange = function () { var p = paper(this.value); if (!p) return; $('#hL').value = p.label; $('#hT').value = p.total; };
      }
      $('#hC').onchange = function () { newCls = this.value; pick(); };
      pick();
      $('#hAdd').onclick = function () {
        var b = this; b.disabled = true;
        req('addHomework', { cls: $('#hC').value, label: $('#hL').value, book: $('#hB').value, p0: $('#hP0').value, p1: $('#hP1').value, total: $('#hT').value, month: month }).then(function (r) {
          b.disabled = false;
          if (!r.ok) return msg($('#hMsg'), false, r.error);
          D.homework.push(r.data); curHw = r.data.id; vHw();
        });
      };
    }
  }


  /* 숙제 미제출 안내 문자 — 문구는 이 기기에 저장, {숙제} {이름} {인원} {주소} {마감} 가 바뀜 */
  var HW_TPL = '[성적노트] {숙제} 미제출 안내 (마감 {마감})\n아직 제출하지 않은 학생: {이름} ({인원}명)\n문제집 쪽 사진과 맞은 개수를 성적노트에 올려 주세요.\n{주소}';
  function hwTpl() { return UI.store.get('seiseki.hwTpl') || HW_TPL; }
  function studentUrl() { return location.origin + location.pathname.replace(/admin(\.html)?$/, ''); }
  function missText(hw, miss) {
    return hwTpl().replace(/\{숙제\}/g, clsShort(hw.cls) + ' ' + hw.label).replace(/\{이름\}/g, miss.map(function (s) { return s.name; }).join(', '))
      .replace(/\{인원\}/g, String(miss.length)).replace(/\{주소\}/g, studentUrl()).replace(/\{마감\}/g, hw.due ? Core.fmtDue(hw.due) : '');
  }
  function missBox(hw, mem) {
    var miss = mem.filter(function (s) { return !subOf(hw.id, s.code); });
    if (!miss.length) return '<div class="miss ok"><b>모두 냈어요</b></div>';
    return '<div class="miss"><div class="row"><b>미제출 ' + miss.length + '명</b><button type="button" class="btn sm" id="mCopy">안내 문자 복사</button></div>' +
      '<p class="names">' + miss.map(function (s) { return esc(s.name); }).join(', ') + '</p>' +
      '<textarea class="tsv msgout" id="mText" rows="5" aria-label="안내 문자">' + esc(missText(hw, miss)) + '</textarea>' +
      '<details class="tpl"><summary>문구 고치기</summary><p class="meta">{숙제} {이름} {인원} {주소} {마감} 은 자동으로 바뀌어요. 고친 문구는 이 기기에 저장돼요.</p>' +
      '<textarea class="tsv" id="mTpl" rows="5" aria-label="안내 문자 문구">' + esc(hwTpl()) + '</textarea>' +
      '<button type="button" class="btn sub sm" id="mTplReset">처음 문구로</button></details><div id="mOut2"></div></div>';
  }
  function bindMiss(hw, mem) {
    if (!$('#mCopy')) return;
    var miss = mem.filter(function (s) { return !subOf(hw.id, s.code); });
    $('#mCopy').onclick = function () { UI.copy($('#mText').value, $('#mOut2'), '복사했어요. 카톡·문자에 붙여넣으세요.'); };
    $('#mTpl').oninput = function () { UI.store.set('seiseki.hwTpl', this.value); $('#mText').value = missText(hw, miss); };
    $('#mTplReset').onclick = function () { UI.store.del('seiseki.hwTpl'); $('#mTpl').value = HW_TPL; $('#mText').value = missText(hw, miss); };
  }

  function photos(hw, s) {
    var ov = document.createElement('div'); ov.className = 'ov';
    ov.innerHTML = '<div class="dlg" role="dialog" aria-modal="true" aria-label="제출 사진"><div class="row" style="align-items:center"><div><b>' + esc(s.name) + '</b> · ' + esc(hw.label) +
      '<p class="meta">사진을 누르면 원본이 새 창에서 열려요.' + (Api.demo ? '' : ' 사진이 안 보이면 이 브라우저에서 선생님 구글 계정으로 로그인해 주세요.') + '</p></div>' +
      '<button type="button" class="btn sub sm" id="cls">닫기</button></div><div class="photos" id="phs"><p class="empty">불러오는 중…</p></div></div>';
    document.body.appendChild(ov);
    function close() { ov.remove(); document.removeEventListener('keydown', esk); }
    function esk(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esk);
    ov.onclick = function (e) { if (e.target === ov) close(); };
    $('#cls', ov).onclick = close; $('#cls', ov).focus();
    req('hwPhotos', { hw: hw.id, code: s.code }).then(function (r) {
      if (!r.ok) { $('#phs', ov).innerHTML = '<p class="msg err">' + esc(r.error) + '</p>'; return; }
      $('#phs', ov).innerHTML = r.data.length ? r.data.map(function (p) {
        if (p.gone) return '<div class="gonep"><span>' + p.order + '번째 · ' + esc(p.at) + '<br>3개월 지나 지운 사진</span></div>';
        return '<a href="' + esc(Api.photoLink(p.fileId)) + '" target="_blank" rel="noopener"><img data-fid="' + esc(p.fileId) + '" src="' + esc(Api.photoUrl(p.fileId, 600)) + '" alt="' + p.order + '번째 사진" loading="lazy"><span>' + p.order + '번째 · ' + esc(p.at) + (p.check === '확인필요' ? ' · <b class="bad">⚠ ' + esc(p.note) + '</b>' : p.check === 'OK' ? ' · AI 확인 OK' : '') + '</span></a>';
      }).join('') : '<p class="empty">사진이 없어요.</p>';
      photoFix($('#phs', ov));
    });
  }

  /* 빠른 검사: 확인 안 한 제출을 한 명씩 큰 사진으로 넘겨 보며 「확인하고 다음」 (→·Enter 확인, ← 이전, ↓ 건너뛰기, Esc 닫기) */
  function quickCheck(hw, mem) {
    var list = mem.map(function (s) { return { s: s, u: subOf(hw.id, s.code) }; }).filter(function (x) { return x.u && x.u.photos && !x.u.checked; });
    var warnOf = function (code) { return (D.photoWarns || []).filter(function (x) { return x.hw === hw.id && x.code === code; }); };
    list.sort(function (a, b) { return (warnOf(b.s.code).length > 0) - (warnOf(a.s.code).length > 0) || a.s.name.localeCompare(b.s.name, 'ko'); });   // ⚠ 먼저
    var i = 0, cache = {}, okN = 0, changed = false;
    var ov = document.createElement('div'); ov.className = 'ov rvov';
    ov.innerHTML = '<div class="dlg rv" role="dialog" aria-modal="true" aria-label="빠른 검사"><div id="rvBody"></div></div>';
    document.body.appendChild(ov);
    function photosOf(code) {
      if (!cache[code]) cache[code] = req('hwPhotos', { hw: hw.id, code: code });
      return cache[code];
    }
    function close() { ov.remove(); document.removeEventListener('keydown', key); if (changed) vHw(); }
    function key(e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); confirm(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    }
    document.addEventListener('keydown', key);
    function go(k) { if (k < 0) return; i = Math.min(k, list.length); draw(); }
    function confirm() {
      if (i >= list.length) return close();
      var x = list[i], b = $('#rvOk', ov); if (b) { b.disabled = true; b.textContent = '저장 중…'; }
      if (x.u.checked) return go(i + 1);
      req('setChecked', { hw: hw.id, code: x.s.code, checked: true }).then(function (r) {
        if (!r.ok) { if (b) { b.disabled = false; b.textContent = '✓ 확인하고 다음'; } return msg($('#rvMsg', ov), false, r.error); }
        x.u.checked = true; okN++; changed = true; go(i + 1);
      });
    }
    function draw() {
      var body = $('#rvBody', ov);
      if (i >= list.length) {
        body.innerHTML = '<div class="rvdone"><b>다 봤어요</b><p class="meta">' + esc(clsShort(hw.cls) + ' · ' + hw.label) + ' — 이번에 확인 ' + okN + '명' +
          (list.length - list.filter(function (x) { return x.u.checked; }).length ? ', 건너뛴 ' + (list.length - list.filter(function (x) { return x.u.checked; }).length) + '명' : '') + '</p>' +
          '<div class="rvbtns">' + (list.length ? '<button type="button" class="btn sub" id="rvBack">← 처음부터 다시</button>' : '') + '<button type="button" class="btn" id="rvClose">닫기</button></div></div>';
        $('#rvClose', ov).onclick = close; $('#rvClose', ov).focus();
        if ($('#rvBack', ov)) $('#rvBack', ov).onclick = function () { go(0); };
        return;
      }
      var x = list[i], w = warnOf(x.s.code);
      body.innerHTML = '<div class="rvhead"><div><span class="meta">' + (i + 1) + ' / ' + list.length + ' · ' + esc(clsShort(hw.cls) + ' · ' + hw.label) + '</span>' +
        '<h2>' + esc(x.s.name) + ' <span class="meta">' + (x.u.count !== null ? '맞은 개수 ' + x.u.count + (hw.total ? '/' + hw.total : '') + ' · ' : '') + x.u.photos + '장</span>' +
        (x.u.late ? ' <span class="pill late" title="처음 낸 시각 ' + esc(x.u.first) + '">늦음 · ' + esc(x.u.first.slice(5)) + '</span>' : '') + (x.u.checked ? ' <span class="pill ok">확인함</span>' : '') + '</h2>' +
        (w.length ? '<div class="warnbox"><b>⚠ 사진 확인</b><ul>' + w.map(function (y) { return '<li>' + y.order + '번째: ' + esc(y.msg) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>' +
        '<button type="button" class="btn sub sm" id="rvX" aria-label="닫기">닫기</button></div>' +
        '<div class="rvphotos" id="rvPh"><p class="empty">사진 불러오는 중…</p></div><p id="rvMsg" class="msg" role="status"></p>' +
        '<div class="rvbtns"><button type="button" class="btn sub" id="rvPrev"' + (i ? '' : ' disabled') + '>← 이전</button>' +
        '<button type="button" class="btn sub" id="rvSkip">건너뛰기</button><button type="button" class="btn" id="rvOk">✓ 확인하고 다음</button></div>' +
        '<p class="meta rvkeys">키보드: → 또는 Enter 확인하고 다음 · ← 이전 · ↓ 건너뛰기 · Esc 닫기' + '' + '</p>';
      $('#rvX', ov).onclick = close; $('#rvPrev', ov).onclick = function () { go(i - 1); }; $('#rvSkip', ov).onclick = function () { go(i + 1); };
      $('#rvOk', ov).onclick = confirm; $('#rvOk', ov).focus();
      var at = i;
      photosOf(x.s.code).then(function (r) {
        if (at !== i || !$('#rvPh', ov)) return;
        if (!r.ok) { $('#rvPh', ov).innerHTML = '<p class="msg err">' + esc(r.error) + '</p>'; return; }
        $('#rvPh', ov).innerHTML = r.data.length ? r.data.map(function (p) {
          if (p.gone) return '<div class="gonep"><span>' + p.order + '번째 · 3개월 지나 지운 사진</span></div>';
          return '<a href="' + esc(Api.photoLink(p.fileId)) + '" target="_blank" rel="noopener"' + (p.check === '확인필요' ? ' class="bad"' : '') + '><img data-fid="' + esc(p.fileId) + '" src="' + esc(Api.photoUrl(p.fileId, 1200)) + '" alt="' + p.order + '번째 사진"><span>' + p.order + '번째 · ' + esc(p.at) + (p.check === '확인필요' ? ' · <b>⚠ ' + esc(p.note) + '</b>' : '') + '</span></a>';
        }).join('') : '<p class="empty">사진이 없어요.</p>';
        photoFix($('#rvPh', ov));
      });
      if (list[i + 1]) photosOf(list[i + 1].s.code).then(function (r) {   // 다음 학생 사진 미리 받아 두기
        if (r.ok) r.data.forEach(function (p) { if (!p.gone) { var im = new Image(); im.onerror = function () { srvPhoto(p.fileId); }; im.src = Api.photoUrl(p.fileId, 1200); } });
      });
    }
    draw();
  }

  /* ---------- 학생·번호 ---------- */
  var stuFilter = 'cur', editing = '';
  /* ---------- 학생별: 학생 한 명이 보는 화면 그대로 (학생 화면을 ?as=번호 로 틀 안에 열고, 서버 studentAs 로 불러옴) ---------- */
  var oneCls = '', oneQ = '', oneCode = '', onePast = false, oneTimer = 0;
  /* 접속기록 (따로 둔 시트, 서버 accessLog): 요약은 한 번 불러 두고, 학생별 최근 기록은 학생마다 */
  var acc = { sum: null, rows: {}, loading: false };
  function accShort(t) { return t ? (+t.slice(5, 7)) + '/' + (+t.slice(8, 10)) + ' ' + t.slice(11, 16) : ''; }
  function accLoad(code, done) {
    if (Api.env === 'dev' && !Api.demo) { done('개발판은 접속기록을 남기지 않아요 (본판만)'); return; }
    if (!code && (acc.sum || acc.loading)) { if (acc.sum) done(); return; }
    if (!code) acc.loading = true;
    req('accessLog', code ? { code: code } : {}).then(function (r) {
      if (!code) acc.loading = false;
      if (!r.ok) { done(r.error || '불러오지 못했어요'); return; }
      acc.sum = r.data.sum; if (code) acc.rows[code] = r.data.rows; done();
    });
  }
  function accLine(code) {
    var o = acc.sum && acc.sum[code];
    return !acc.sum ? '' : o ? '마지막 접속 ' + accShort(o.last) + ' · 최근 30일 중 ' + o.days30 + '일 · 전체 ' + o.total + '번' : '아직 접속 기록이 없어요';
  }
  function accDraw(code) {
    var box = $('#oAcc'); if (!box || box.getAttribute('data-code') !== code) return;
    var rows = acc.rows[code];
    box.innerHTML = '<span class="meta">' + esc(accLine(code)) + '</span>' + (rows && rows.length ? '<details class="acc"><summary>접속 기록 보기</summary><div class="tw"><table class="stab"><thead><tr><th>시각</th><th>구분</th><th>기기</th></tr></thead><tbody>' +
      rows.slice(0, 50).map(function (x) { return '<tr><td>' + esc(accShort(x.at)) + '</td><td>' + esc(x.kind) + '</td><td class="code">' + esc(x.dev) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (rows.length > 50 ? '<p class="meta">최근 50개만 보여요. 전체는 「접속기록」 시트에 있어요.</p>' : '') + '</details>' : '');
  }
  function onePool() {
    var pool = D.students.filter(function (s) { return onePast || s.classes.length; });
    if (oneCls) pool = pool.filter(function (s) { return s.classes.indexOf(oneCls) >= 0; });
    var q = oneQ.replace(/\s+/g, '').toUpperCase();
    if (q) pool = pool.filter(function (s) { return s.name.replace(/\s+/g, '').toUpperCase().indexOf(q) >= 0 || s.code.indexOf(q.replace(/-/g, '')) >= 0; });
    return pool.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
  }
  function vOne() {
    var act = D.classes.filter(function (c) { return c.active; });
    $('#view').innerHTML = '<div class="card"><h2>학생별 성적 <span class="meta">학생이 보는 화면 그대로</span></h2>' +
      '<div class="tabsrow" aria-label="반">' + [['', '이번 달 수강생 전체']].concat(act.map(function (c) { return [c.code, clsName(c.code)]; })).map(function (x) {
        return '<button type="button" class="tab" data-oc="' + esc(x[0]) + '" aria-selected="' + (x[0] === oneCls) + '">' + esc(x[1]) + '</button>';
      }).join('') + '</div>' +
      '<div class="stupick"><input id="oQ" type="search" placeholder="이름이나 번호로 찾기" value="' + esc(oneQ) + '" aria-label="학생 찾기">' +
      '<label class="check" style="margin:0"><input type="checkbox" id="oPast"' + (onePast ? ' checked' : '') + '> 지난 학생도</label></div>' +
      '<div class="chiprow" id="oList" style="margin-top:10px"></div></div>' +
      '<div class="card" id="oCard"><div id="oNav"></div></div><div id="oFr" class="stufr"></div>';
    all('#view [data-oc]').forEach(function (b) { b.onclick = function () { oneCls = b.getAttribute('data-oc'); all('#view [data-oc]').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); }); oneDraw(); }; });
    $('#oPast').onchange = function () { onePast = this.checked; oneDraw(); };
    $('#oQ').oninput = function () { oneQ = this.value; oneDraw(); };
    oneDraw();
  }
  /** 학생 목록·앞뒤 버튼은 다시 그리고, 학생 화면 틀은 학생이 바뀔 때만 새로 엶 (검색할 때마다 다시 불러오지 않게) */
  function oneDraw() {
    var pool = onePool(), me = D.students.filter(function (s) { return s.code === oneCode; })[0] || null;
    $('#oList').innerHTML = pool.length ? pool.map(function (s) {
      return '<button type="button" class="tab" data-oo="' + esc(s.code) + '" aria-selected="' + (s.code === oneCode) + '">' + esc(s.name) + '</button>';
    }).join('') : '<span class="meta">해당하는 학생이 없어요.</span>';
    if (!me) { $('#oNav').innerHTML = '<p class="empty">위에서 학생을 고르면 그 학생이 보는 성적 화면이 여기 나와요. (숙제 제출 버튼은 빼고 보여 줘요)</p>'; $('#oFr').innerHTML = ''; }
    else {
      var ix = pool.map(function (s) { return s.code; }).indexOf(me.code), prev = ix > 0 ? pool[ix - 1] : null, next = ix >= 0 && ix < pool.length - 1 ? pool[ix + 1] : null;
      $('#oNav').innerHTML = '<div class="stunav"><button type="button" class="btn sub sm" data-oo="' + (prev ? esc(prev.code) : '') + '"' + (prev ? '' : ' disabled') + '>‹ ' + (prev ? esc(prev.name) : '') + '</button>' +
        '<div style="text-align:center"><b>' + esc(me.name) + '</b><div class="meta">' + esc(Core.fmtCode(me.code)) + (me.classes.length ? ' · ' + me.classes.map(function (c) { return esc(clsName(c)); }).join(', ') : ' · 지금 수강 없음') + '</div></div>' +
        '<button type="button" class="btn sub sm" data-oo="' + (next ? esc(next.code) : '') + '"' + (next ? '' : ' disabled') + '>' + (next ? esc(next.name) : '') + ' ›</button></div>' +
        '<div id="oAcc" class="oacc" data-code="' + esc(me.code) + '"><span class="meta">접속 기록 불러오는 중…</span></div>';
      var src = location.pathname + '?as=' + encodeURIComponent(me.code) + (/[?&]demo\b/.test(location.search) ? '&demo' : ''), f = $('#oF');
      if (acc.rows[me.code]) accDraw(me.code);
      else (function (c) { accLoad(c, function (err) { if (err) { var b = $('#oAcc'); if (b && b.getAttribute('data-code') === c) b.innerHTML = '<span class="meta">접속 기록: ' + esc(err) + '</span>'; return; } accDraw(c); }); })(me.code);
      if (!f || f.getAttribute('data-src') !== src) $('#oFr').innerHTML = '<iframe class="stuframe" id="oF" data-src="' + esc(src) + '" title="' + esc(me.name) + ' 학생 화면" src="' + esc(src) + '"></iframe>';
    }
    all('#view [data-oo]').forEach(function (b) { b.onclick = function () { var c = b.getAttribute('data-oo'); if (!c) return; oneCode = c; oneDraw(); var hb = document.querySelector('header.appbar'); window.scrollTo(0, $('#oCard').getBoundingClientRect().top + window.scrollY - (hb ? hb.offsetHeight : 0) - 8); }; });
    if (!oneTimer) oneTimer = setInterval(function () {   // 틀 높이를 학생 화면 길이에 맞춤 (같은 사이트라 안을 읽을 수 있음)
      var fr = $('#oF'); if (!fr) { if (!$('#oFr')) { clearInterval(oneTimer); oneTimer = 0; } return; }
      try { var d = fr.contentDocument; if (d && d.body) { var hh = Math.max(300, d.body.scrollHeight); if (Math.abs(fr.offsetHeight - hh) > 4) fr.style.height = hh + 'px'; } } catch (e) {}
    }, 300);
  }
  function vStu() {
    var cur = D.students.filter(function (s) { return s.classes.length; });
    var list = (stuFilter === 'cur' ? cur : D.students).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
    $('#view').innerHTML =
      '<div class="card"><h2>월초 명단 붙여넣기</h2><p class="meta">aca2000에서 복사한 이름과 반을 한 줄에 하나씩 붙여넣으세요. 이름과 반은 탭이나 쉼표로 나뉩니다. 반이 여러 개면 / 로 이어 쓰세요. 반은 이름·시간(예: 화목 20:20)으로 찾습니다.<br>' +
      '이름은 <b>원생명단</b>(퇴실퀴즈와 같이 쓰는 명단)에서 찾아 그 번호를 쓰고, 명단에 없는 이름만 새 번호를 만들어 원생명단에 추가합니다.</p>' +
      '<textarea id="paste" class="paste" aria-label="명단" placeholder="홍길동(동작)&#9;개념반 화목 20:20&#10;김하나(분당)&#9;단풀 토일13:00/실전문풀 D"></textarea>' +
      '<label class="check"><input type="checkbox" id="deact"> 이 명단에 없는 학생은 이번 달 반을 비우기 (번호와 지난 기록은 그대로)</label>' +
      '<button type="button" class="btn" id="issue">반영하기</button><div id="iOut"></div></div>' +
      '<div class="card"><div class="row" style="align-items:center"><div class="tabsrow" style="margin:0">' +
      '<button type="button" class="tab" data-f="cur" aria-selected="' + (stuFilter === 'cur') + '">이번 달 수강생 ' + cur.length + '명</button>' +
      '<button type="button" class="tab" data-f="all" aria-selected="' + (stuFilter === 'all') + '">원생명단 전체 ' + D.students.length + '명</button></div>' +
      '<button type="button" class="btn sub sm" id="cp">번호표 복사 (이름·번호·반)</button></div><div id="cpOut"></div>' +
      '<div class="tw" style="margin-top:10px"><table><thead><tr><th>이름</th><th>번호</th><th>반</th><th>상태</th><th>마지막 접속</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (s) {
        var row = '<tr><td>' + esc(s.name) + '</td><td class="code">' + esc(Core.fmtCode(s.code)) + '</td><td>' + (s.classes.map(function (c) { return esc(clsName(c)); }).join(', ') || '<span class="meta">없음</span>') + '</td>' +
          '<td>' + (!s.active ? '<span class="pill no">차단</span>' : s.classes.length ? '<span class="pill ok">수강 중</span>' : '<span class="pill wait">수강 없음</span>') + '</td>' +
          '<td class="meta" data-la="' + esc(s.code) + '">' + (acc.sum ? (acc.sum[s.code] ? esc(accShort(acc.sum[s.code].last)) : '없음') : '…') + '</td>' +
          '<td style="white-space:nowrap"><button type="button" class="btn sub sm" data-ed="' + esc(s.code) + '">반 수정</button> <button type="button" class="btn soft sm" data-see="' + esc(s.code) + '">성적 보기</button></td></tr>';
        if (editing === s.code) {
          row += '<tr><td colspan="6"><div class="fields" style="gap:14px">' + D.classes.filter(function (c) { return c.active; }).map(function (c) {
            return '<label class="check" style="margin:0"><input type="checkbox" data-cc="' + esc(c.code) + '"' + (s.classes.indexOf(c.code) >= 0 ? ' checked' : '') + '> ' + esc(clsName(c.code)) + '</label>';
          }).join('') + '<button type="button" class="btn sm" id="ccSave">저장</button> <button type="button" class="btn sub sm" id="ccCancel">취소</button></div></td></tr>';
        }
        return row;
      }).join('') : '<tr><td colspan="6" class="empty">' + (stuFilter === 'cur' ? '이번 달 수강생이 없어요. 위에 명단을 붙여넣어 주세요.' : '원생명단이 비어 있어요.') + '</td></tr>') +
      '</tbody></table></div><p class="meta" style="margin-top:8px">번호는 퇴실퀴즈와 같은 원생명단에서 관리합니다. 학생 이용을 막으려면 원생명단 시트의 「상태」 칸에 「차단」이라고 적으세요. 번호를 잊은 학생에게는 이 표의 번호를 다시 알려 주면 됩니다.</p><p id="sMsg" class="msg" role="status"></p></div>' +
      '<div class="card"><h2>반 목록</h2><p class="meta">반 이름·시간은 기록장 구글 시트의 「반」 탭에서 고칩니다. 반코드는 바꾸지 마세요.</p><div class="tw" style="margin-top:8px"><table><thead><tr><th>반코드</th><th>반 이름</th><th>종류</th><th>요일·시간</th><th class="num">학생</th></tr></thead><tbody>' +
      D.classes.map(function (c) { return '<tr><td class="code">' + esc(c.code) + '</td><td>' + esc(clsName(c.code)) + '</td><td>' + esc(c.kind) + '</td><td>' + esc(c.time) + '</td><td class="num">' + members(c.code).length + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    all('#view [data-f]').forEach(function (b) { b.onclick = function () { stuFilter = b.getAttribute('data-f'); editing = ''; vStu(); }; });
    if (!acc.sum) accLoad('', function (err) {
      all('#view [data-la]').forEach(function (td) { var c = td.getAttribute('data-la'); td.textContent = err ? '-' : acc.sum[c] ? accShort(acc.sum[c].last) : '없음'; });
    });
    all('#view [data-see]').forEach(function (b) { b.onclick = function () { oneCode = b.getAttribute('data-see'); tab = 'one'; renderNav(); render(); window.scrollTo(0, 0); }; });
    $('#issue').onclick = function () {
      var b = this; b.disabled = true;
      req('importRoster', { text: $('#paste').value, deactivateMissing: $('#deact').checked }).then(function (r) {
        b.disabled = false;
        if (!r.ok) { $('#iOut').innerHTML = '<p class="msg err">' + esc(r.error) + '</p>'; return; }
        D.students = r.data.students;
        var x = r.data, h = '';
        h += '<div class="okbox">명단에서 찾음 ' + x.updated.length + '명 · 새 번호 ' + x.added.length + '명(원생명단에 추가)' + (x.deactivated.length ? ' · 반 비움 ' + x.deactivated.length + '명' : '') + '</div>';
        if (x.added.length) h += '<div class="tw" style="margin-top:8px"><table><thead><tr><th>새 원생</th><th>번호</th></tr></thead><tbody>' + x.added.map(function (a) { return '<tr><td>' + esc(a.name) + '</td><td class="code">' + esc(Core.fmtCode(a.code)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
        if (x.unknown.length) h += '<div class="warnbox">확인이 필요한 줄 ' + x.unknown.length + '개<br>' + x.unknown.map(function (u) { return esc(u.line) + ' → ' + esc(u.reason); }).join('<br>') + '</div>';
        stuFilter = 'cur'; editing = ''; vStu(); $('#iOut').innerHTML = h;
      });
    };
    $('#cp').onclick = function () {
      UI.copy(list.filter(function (s) { return s.active; }).map(function (s) { return [s.name, Core.fmtCode(s.code), s.classes.map(function (c) { return clsName(c); }).join(', ')].join('\t'); }).join('\n'), $('#cpOut'));
    };
    all('#view [data-ed]').forEach(function (b) { b.onclick = function () { editing = editing === b.getAttribute('data-ed') ? '' : b.getAttribute('data-ed'); vStu(); }; });
    if ($('#ccCancel')) $('#ccCancel').onclick = function () { editing = ''; vStu(); };
    if ($('#ccSave')) $('#ccSave').onclick = function () {
      var picked = all('#view [data-cc]').filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-cc'); });
      var code = editing;
      req('setClasses', { code: code, classes: picked }).then(function (r) {
        if (!r.ok) return msg($('#sMsg'), false, r.error);
        stu(code).classes = r.data.classes; editing = ''; vStu();
        msg($('#sMsg'), true, stu(code).name + ' 반을 저장했어요.');
      });
    };
  }

  /* ---------- 월말 표 ---------- */
  function monthTable(cc) {
    var c = cls(cc), real = c.kind === '실전';
    var exs = D.exams.filter(function (e) { return e.cls === cc && e.month === month && !(c.kind !== '실전' && /EJU 기출/.test(e.label)); }).sort(function (a, b) { return a.date.localeCompare(b.date); });   // 개념반·단풀반 EJU 기출은 학생평가·엑셀에 안 나옴 (필수 아님, 2026-10-30 사용자)
    var hws = D.homework.filter(function (h) { return h.cls === cc && h.month === month; });
    var head = ['이름', '학생평가'].concat(hws.map(function (h) { return h.label + (h.total ? '(' + h.total + '문)' : ''); }),
      exs.map(function (e) { return e.label + (real ? '(개수/환산)' : '(' + e.total + '문)'); }), ['평균', '숙제 제출']);
    var rows = rosterFor(cc, month).map(function (s) {
      var hc = hws.map(function (h) { var u = subOf(h.id, s.code); return u ? (u.count !== null ? String(u.count) : '제출') : '-'; });
      var vals = [];
      var ec = exs.map(function (e) {
        var r = resultOf(e.id, s.code); if (!r) return '-';
        vals.push(real ? conv200(r.score, e.total) : r.score);
        return real ? r.score + ' / ' + conv200(r.score, e.total) : String(r.score);
      });
      var avg = vals.length ? (vals.reduce(function (a, b) { return a + b; }, 0) / vals.length).toFixed(1) : '-';
      var sub = hws.length ? hws.filter(function (h) { return subOf(h.id, s.code); }).length + '/' + hws.length : '-';
      var ev = D.evals.filter(function (x) { return x.month === month && x.code === s.code; })[0];
      return { s: s, eval: ev ? ev.text : '', cells: hc.concat(ec, [avg, sub]) };
    });
    return { c: c, head: head, rows: rows, real: real };
  }
  function vMonth() {
    var used = {}; D.exams.concat(D.homework).forEach(function (x) { if (x.month === month) used[x.cls] = 1; });
    var opts = D.classes.filter(function (c) { return c.active || used[c.code]; });
    if (!monthCls || !opts.some(function (c) { return c.code === monthCls; })) monthCls = (opts.filter(function (c) { return used[c.code]; }).sort(function (a, b) { return members(b.code).length - members(a.code).length; })[0] || opts[0] || {}).code;
    var T = monthTable(monthCls);
    $('#view').innerHTML = '<div class="card"><div class="fields"><div><label for="mC">반</label><select id="mC">' + clsOptions(opts, monthCls, function (c) { return used[c.code] ? '' : ' (이 달 기록 없음)'; }) + '</select></div>' +
      '<div style="flex:0 0 auto"><button type="button" class="btn sub" id="mCp">표 복사</button> <button type="button" class="btn sub" id="mX">엑셀 내려받기</button></div></div>' +
      '<p class="meta" style="margin-top:8px">' + esc(UI.monthLabel(month)) + ' · 평균은 테스트(소테스트·월말·모의고사)만으로 계산하고 숙제는 따로 둡니다.' + (T.real ? ' 실전반 환산점수는 맞은 개수 ÷ 문항 수 × 200 (득점등화는 학생 개인 성적표에만), 평균은 환산점수 기준이에요.' : '') + ' 학생평가는 칸을 벗어나면 저장돼요.</p><div id="mOut"></div>' +
      '<div class="tw" style="margin-top:10px"><table><thead><tr>' + T.head.map(function (h, i) { return '<th' + (i > 1 ? ' class="num"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (T.rows.length ? T.rows.map(function (r) {
        return '<tr><td>' + esc(r.s.name) + '</td><td><textarea class="cm" rows="2" data-ev="' + esc(r.s.code) + '" aria-label="' + esc(r.s.name) + ' 학생평가">' + esc(r.eval) + '</textarea></td>' +
          r.cells.map(function (v, i) { return '<td class="num">' + (i === r.cells.length - 2 ? '<b>' + esc(v) + '</b>' : esc(v)) + '</td>'; }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + T.head.length + '" class="empty">이 달 이 반에 기록이 있는 학생이 없어요.</td></tr>') + '</tbody></table></div></div>';
    $('#mC').onchange = function () { monthCls = this.value; vMonth(); };
    all('#view [data-ev]').forEach(function (t) {
      t.onchange = function () {
        var code = t.getAttribute('data-ev'), text = t.value;
        req('saveEval', { month: month, code: code, text: text }).then(function (r) {
          if (!r.ok) return msg($('#mOut'), false, r.error);
          replace(D.evals, function (x) { return x.month === month && x.code === code; }, r.data);
          $('#mOut').innerHTML = '<p class="msg ok">' + esc(stu(code).name) + ' 학생평가 저장</p>';
        });
      };
    });
    function aoa() { return [T.head].concat(T.rows.map(function (r) { return [r.s.name, r.eval.replace(/[\t\r\n]+/g, ' ')].concat(r.cells); })); }
    $('#mCp').onclick = function () { UI.copy(aoa().map(function (row) { return row.join('\t'); }).join('\n'), $('#mOut')); };
    $('#mX').onclick = function () {
      var b = this; b.disabled = true; b.textContent = '만드는 중…';
      loadExcel().then(function (X) {
        var m = monthModel(monthCls);
        return MonthXlsx.build(X, m).xlsx.writeBuffer().then(function (buf) {
          var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = m.file + '.xlsx';
          document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          $('#mOut').innerHTML = '<p class="msg ok">' + esc(m.file) + '.xlsx 를 내려받았어요.</p>';
        });
      }).catch(function () { $('#mOut').innerHTML = '<p class="msg err">엑셀 도구를 불러오지 못했어요. 인터넷 연결을 확인하거나 「표 복사」를 써 주세요.</p>'; })
        .then(function () { b.disabled = false; b.textContent = '엑셀 내려받기'; });
    };
  }

  /** 학원 제출 양식(2609 개념·단풀·실전문풀 파일)에 맞춘 월말 엑셀 내용 */
  function monthModel(cc) {
    var c = cls(cc), kind = c.kind, time = String(c.time || '').replace(/\s+/g, '');
    var yymm = month.slice(2, 4) + month.slice(5, 7);
    var exs = D.exams.filter(function (e) { return e.cls === cc && e.month === month && !(kind !== '실전' && /EJU 기출/.test(e.label)); }).sort(function (a, b) { return (a.date + a.created).localeCompare(b.date + b.created); });   // 개념반·단풀반 EJU 기출은 학생평가·엑셀에 안 나옴 (필수 아님, 2026-10-30 사용자)
    var hws = D.homework.filter(function (h) { return h.cls === cc && h.month === month; });
    var subj = '';
    exs.concat(hws).some(function (x) { subj = subjOf(x.label); return !!subj; });
    var full = subj === '현사' ? '현대사회' : subj;
    var people = rosterFor(cc, month);
    function evalOf(s) { var ev = D.evals.filter(function (x) { return x.month === month && x.code === s.code; })[0]; return ev ? ev.text : ''; }
    if (kind === '실전') {
      var sfx = realSuffix(cc), n = 0;
      var cols = exs.filter(function (e) { return e.kind !== '월말테스트'; }).map(function (e) { n++; return { head: '모의고사' + n + '회(개수/환산점수)', e: e }; })
        .concat(exs.filter(function (e) { return e.kind === '월말테스트'; }).map(function (e) { return { head: '월말테스트(개수/환산점수)', e: e }; }));
      return { kind: '실전', title: '종합과목 실전문풀' + sfx + (time ? '(' + time + ')' : ''), sheet: '실전문풀' + sfx, file: yymm + '실전문풀' + sfx,
        cols: cols, rows: people.map(function (s) {
          return { name: s.name, eval: evalOf(s), vals: cols.map(function (col) { var r = resultOf(col.e.id, s.code); return r ? [r.score, conv200(r.score, col.e.total)] : null; }) };
        }) };
    }
    // 개념·단풀: 숙제·주차 테스트를 주차 순서대로(숙제 먼저), 그 뒤 월말
    function week(label) { var m = /(\d+)\s*주차/.exec(label); return m ? +m[1] : 99; }
    var items = hws.map(function (h, i) { return { type: 'hw', x: h, w: week(h.label), o: i }; })
      .concat(exs.filter(function (e) { return e.kind !== '월말테스트'; }).map(function (e, i) { return { type: 'test', x: e, w: week(e.label), o: 100 + i }; }))
      .sort(function (a, b) { return a.w - b.w || (a.type === b.type ? a.o - b.o : (a.type === 'hw' ? -1 : 1)); })
      .concat(exs.filter(function (e) { return e.kind === '월말테스트'; }).map(function (e) { return { type: 'final', x: e }; }));
    var cols2 = items.map(function (it) {
      var t = it.x.total;
      if (it.type === 'hw') return { type: 'hw', head: '숙제' + (t ? '(' + t + '문)' : ''), it: it };
      if (it.type === 'final') return { type: 'final', head: kind === '개념' ? '(' + t + '문)' : t + '문', it: it };
      var nm = it.w < 99 ? it.w + '주차' : String(it.x.label).replace(new RegExp('^' + subj + '\\s*'), '');
      return { type: 'test', head: nm + '(' + t + '문)', it: it };
    });
    return { kind: kind, sheet: full || kind, file: yymm + subj + kind,
      title: kind === '단풀' ? '종합과목 ' + full + '단풀' + (time ? '(' + time + ')' : '') : '종합과목 ' + kind + (full ? '(' + full + ')' : '') + (time ? '(' + time + ')' : ''),
      cols: cols2, rows: people.map(function (s) {
        return { name: s.name, eval: evalOf(s), vals: cols2.map(function (col) {
          if (col.type === 'hw') { var u = subOf(col.it.x.id, s.code); return u ? (u.count !== null ? u.count : '제출') : null; }
          var r = resultOf(col.it.x.id, s.code); return r ? r.score : null;
        }) };
      }) };
  }
  /* ---------- 월초 강의계획서 ----------
   * 반마다 시트 하나인 엑셀 파일 하나. 날짜 = 「달력」 탭 + 반 요일, 내용·교재 범위 = 「계획서」 탭의 지난 계획서 (Plan.build).
   * 과목은 다음 달 시험·숙제가 아직 없으니 강사가 고름 (고른 것은 이 기기에 기억) */
  var planYm = '', PLAN_SUBJ = ['정치', '경제', '지리', '현사', '역사'];
  function planKey(ym, code) { return 'seiseki.plan.' + ym + '.' + code; }
  function planSubj(ym, code) { return UI.store.get(planKey(ym, code)) || subjIn(code, ym) || ''; }
  function planOn(ym, code) { return UI.store.get(planKey(ym, code) + '.off') !== '1'; }
  function planFor(c, ym) {
    var subj = c.kind === '실전' ? '' : planSubj(ym, c.code);
    if (c.kind !== '실전' && !subj) return null;
    return Plan.build({ ym: ym, kind: c.kind, subj: subj, ban: realSuffix(c.code), time: c.time, cal: D.cal || {}, bank: D.plans || {} });
  }
  /* ---------- 문항 분석: 시험 하나의 문항마다 이 반 정답률 vs 누적 정답률, 많이 고른 오답 (계산은 Logic.itemStats) ---------- */
  var itemKind = '', itemExam = '', itemSort = 'n';
  var CIRC = { '1': '①', '2': '②', '3': '③', '4': '④', '5': '⑤', '6': '⑥' };
  function circ(ch) { return CIRC[ch] || ch; }
  var FLAG = { low: ['이 반 낮음', 'no'], below: ['누적보다 낮음', 'late'], cumLow: ['누적도 낮음', 'wait'], trap: ['오답 쏠림', 'blue'] };
  function vItem() {
    if (!itemKind) itemKind = entryKind || '개념';
    var withRes = {}; D.results.forEach(function (r) { withRes[r.exam] = (withRes[r.exam] || 0) + 1; });
    var exs = examsOfMonth().filter(function (e) { var c = cls(e.cls); return c && c.kind === itemKind && withRes[e.id]; });
    if (itemKind === '실전') {   // 실전반은 D·E 를 하나로: 같은 이름 시험은 한 번만 (분석도 D·E 합쳐서)
      var seen = {}, cnt = {};
      exs.forEach(function (e) { var k = String(e.label).replace(/\s+/g, ''); cnt[k] = (cnt[k] || 0) + withRes[e.id]; });
      exs = exs.filter(function (e) { var k = String(e.label).replace(/\s+/g, ''); if (seen[k]) return false; seen[k] = 1; withRes[e.id] = cnt[k]; return true; });
      if (!exs.some(function (e) { return e.id === itemExam; })) { var cur = examsOfMonth().filter(function (e) { return e.id === itemExam; })[0]; if (cur) { var same = exs.filter(function (e) { return String(e.label).replace(/\s+/g, '') === String(cur.label).replace(/\s+/g, ''); })[0]; if (same) itemExam = same.id; } }
    }
    if (!exs.some(function (e) { return e.id === itemExam; })) itemExam = exs.length ? exs.slice().sort(function (a, b) { return (b.date || b.created).localeCompare(a.date || a.created); })[0].id : '';
    var h = '<div class="card"><h2>' + esc(UI.monthLabel(month)) + ' 문항 분석</h2>' +
      '<div class="seg" role="tablist" aria-label="반 종류">' + KINDS.map(function (k) { return '<button type="button" role="tab" data-ik="' + k[0] + '" aria-selected="' + (k[0] === itemKind) + '">' + k[1] + '</button>'; }).join('') + '</div>';
    if (!exs.length) { $('#view').innerHTML = h + '<p class="empty">이 달 ' + esc(itemKind) + '반에 답안이 들어간 시험이 없어요.</p></div>'; bindItem(); return; }
    h += '<div class="fields" style="margin-top:14px"><div><label for="iE">시험</label><select id="iE">' + exs.map(function (e) {
      return '<option value="' + esc(e.id) + '"' + (e.id === itemExam ? ' selected' : '') + '>' + esc((itemKind === '실전' ? '실전반(D·E)' : (subjOf(e.label) && cls(e.cls) && cls(e.cls).time ? '[' + cls(e.cls).time + '] ' + subjOf(e.label) : clsName(e.cls))) + ' · ' + e.label) + ' (' + withRes[e.id] + '명)</option>';
    }).join('') + '</select></div></div>';
    var A = Logic.itemStats(D, itemExam);
    if (!A) { $('#view').innerHTML = h + '<p class="empty">문항 수가 없는 시험이에요.</p></div>'; bindItem(); return; }
    function cnt(x) { return x.rate === null || !x.t ? '' : Math.round(x.rate * x.t / 100) + '/' + x.t + '명'; }   // 이 문항을 맞힌 사람 / 답안이 있는 사람
    function avgN(a) { return a.avg === null ? '' : (Math.round(a.avg * A.total / 10) / 10) + ' / ' + A.total + '개'; }   // 평균 맞힌 개수 / 문항 수
    var real = A.kind === '실전', noItems = !A.items.some(function (it) { return it.here.t; }), hasCum = A.cum.n > A.here.n;   // 다른 달·반 기록이 있어야 누적이 의미 있음
    h += '<div class="tiles four itiles">' +
      '<div class="tile"><span>' + (real ? '실전반(D·E)' : '이 반') + '</span><b>' + (A.here.avg === null ? '-' : A.here.avg + '<small>%</small>') + '</b><em>' + A.here.n + '명 평균 정답률' + (A.here.avg === null ? '' : ' · 평균 ' + avgN(A.here) + ' 맞힘') + '</em></div>' +
      '<div class="tile"><span>누적 (같은 시험 모든 달·반)</span><b>' + (!hasCum || A.cum.avg === null ? '-' : A.cum.avg + '<small>%</small>') + '</b><em>' + (hasCum ? A.cum.n + '명 · 평균 ' + avgN(A.cum) : '이 시험은 이 반 기록뿐이에요') + '</em></div>' +
      '<div class="tile"><span>이 반 낮은 문항</span><b>' + A.items.filter(function (it) { return it.flags.indexOf('low') >= 0 || it.flags.indexOf('below') >= 0; }).length + '<small>개</small></b><em>정답률 ' + 50 + '% 미만 · 누적보다 15%p↓</em></div>' +
      '<div class="tile"><span>오답 쏠림</span><b>' + A.items.filter(function (it) { return it.flags.indexOf('trap') >= 0; }).length + '<small>개</small></b><em>같은 오답을 30% 이상</em></div></div>';
    if (noItems) h += '<p class="msg">이 시험은 답안·틀린 번호 기록이 없어서(점수만 옮겨 온 성적) 문항별로는 볼 수 없어요.</p>';
    h += '</div>' + rankCard(itemExam);
    if (!noItems) {
      // 눈여겨볼 문항은 10개까지: 이 반 정답률 낮은 순 → 같으면 표시가 많은 순 (나머지는 아래 전체 표에서)
      var flaggedAll = A.items.filter(function (it) { return it.flags.length; }).sort(function (a, b) { return ((a.here.rate === null ? 101 : a.here.rate) - (b.here.rate === null ? 101 : b.here.rate)) || (b.flags.length - a.flags.length); });
      var flagged = flaggedAll.slice(0, 10);
      h += '<div class="card"><h2>눈여겨볼 문항 <span class="meta">정답률 낮은 순 ' + flagged.length + '개' + (flaggedAll.length > 10 ? ' · 표시된 ' + flaggedAll.length + '개 중' : '') + '</span></h2>' + (flagged.length ? '<div class="plist">' + flagged.map(function (it) {
        var g = it.here.rate !== null && it.cum.rate !== null && A.cum.n > A.here.n ? Math.round((it.here.rate - it.cum.rate) * 10) / 10 : null;
        var tr = it.here.trap && it.here.trap.cnt >= 2 && it.here.trap.pct >= 30 ? it.here.trap : (hasCum && it.cum.trap && it.cum.trap.cnt >= 3 && it.cum.trap.pct >= 30 ? it.cum.trap : null), trIsCum = tr && tr !== it.here.trap;
        return '<div class="prow"><div><b>' + it.i + '번</b>' +
          '<span class="meta">' + (it.subj ? esc(it.subj) + ' · ' : '') + '정답 ' + circ(it.key) + ' · 이 반 ' + (it.here.rate === null ? '-' : it.here.rate + '% (' + cnt(it.here) + ')') + (hasCum ? ' · 누적 ' + (it.cum.rate === null ? '-' : it.cum.rate + '% (' + cnt(it.cum) + ')') : '') + (g === null ? '' : ' (' + (g > 0 ? '+' : '') + g + '%p)') +
          (tr ? ' · 많이 고른 오답 ' + circ(tr.ch) + ' ' + tr.pct + '%' + (trIsCum ? '(누적)' : '') : '') + '</span></div>' +
          '<div class="pills">' + it.flags.map(function (f) { return '<span class="pill ' + FLAG[f][1] + '">' + FLAG[f][0] + '</span>'; }).join('') + '</div></div>';
      }).join('') + '</div>' + (flaggedAll.length > 10 ? '<p class="meta" style="margin-top:8px">나머지 ' + (flaggedAll.length - 10) + '개는 아래 전체 문항 표에서 왼쪽 빨간 줄로 보여요.</p>' : '') : '<p class="empty">특별히 낮거나 오답이 몰린 문항이 없어요.</p>') + '</div>';
      var rows = A.items.slice();
      if (itemSort === 'r') rows.sort(function (a, b) { return (a.here.rate === null ? 101 : a.here.rate) - (b.here.rate === null ? 101 : b.here.rate); });
      if (itemSort === 'g') rows.sort(function (a, b) { function d(x) { return x.here.rate === null || x.cum.rate === null ? 999 : x.here.rate - x.cum.rate; } return d(a) - d(b); });
      var chs = ['1', '2', '3', '4'];
      A.items.forEach(function (it) { [it.key].concat(Object.keys(it.here.dist), Object.keys(it.cum.dist)).forEach(function (c) { if (c && c !== '0' && chs.indexOf(c) < 0) chs.push(c); }); });
      chs.sort();
      h += '<div class="card"><h2>전체 문항</h2><div class="chiprow" aria-label="정렬">' + [['n', '번호순'], ['r', '이 반 정답률 낮은 순'], ['g', '누적보다 많이 낮은 순']].map(function (o) { return '<button type="button" class="tab" data-is="' + o[0] + '" aria-selected="' + (o[0] === itemSort) + '">' + o[1] + '</button>'; }).join('') + '</div>' +
        '<p class="meta" style="margin-top:8px">고른 답은 답안이 입력된 학생 기준(이 반). 정답은 초록, 가장 많이 고른 오답은 빨강. 빈칸은 틀린 것으로 셈.</p>' +
        '<div class="tw" style="margin-top:10px"><table class="itab"><thead><tr><th class="num">번호</th><th>정답</th>' + (real ? '<th>과목</th>' : '') + '<th class="num">이 반</th><th class="num">누적</th><th class="num">차이</th>' + chs.map(function (c) { return '<th class="num">' + circ(c) + '</th>'; }).join('') + '<th class="num">빈칸</th><th>누적 많이 고른 오답</th></tr></thead><tbody>' +
        rows.map(function (it) {
          var g = it.here.rate !== null && it.cum.rate !== null && A.cum.n > A.here.n ? Math.round((it.here.rate - it.cum.rate) * 10) / 10 : null;
          return '<tr class="' + (it.flags.length ? 'flag' : '') + '"><td class="num"><b>' + it.i + '</b></td><td>' + circ(it.key) + '</td>' + (real ? '<td>' + esc(it.subj) + '</td>' : '') +
            '<td class="num' + (it.flags.indexOf('low') >= 0 ? ' bad' : '') + '">' + (it.here.rate === null ? '-' : it.here.rate + '%<br><small class="meta">' + cnt(it.here) + '</small>') + '</td><td class="num' + (it.flags.indexOf('cumLow') >= 0 ? ' bad' : '') + '">' + (!hasCum || it.cum.rate === null ? '-' : it.cum.rate + '%<br><small class="meta">' + cnt(it.cum) + '</small>') + '</td>' +
            '<td class="num' + (g !== null && g <= -15 ? ' bad' : g !== null && g >= 0 ? ' good' : '') + '">' + (g === null ? '' : (g > 0 ? '+' : '') + g) + '</td>' +
            chs.map(function (c) { var v = it.here.dist[c]; var cl = c === it.key ? 'ok' : it.here.trap && it.here.trap.ch === c ? 'tr' : ''; return '<td class="num ch ' + cl + '">' + (v ? v + '%' : (it.here.d ? '<span class="z">0</span>' : '')) + '</td>'; }).join('') +
            '<td class="num">' + (it.here.d && it.here.blank ? it.here.blank + '%' : '') + '</td>' +
            '<td>' + (it.cum.trap && it.cum.d > it.here.d ? circ(it.cum.trap.ch) + ' ' + it.cum.trap.pct + '%' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }
    $('#view').innerHTML = h;
    bindItem();
  }
  /** 이 시험 등수 (2026-10-27 사용자): 그 반·그 시험 학생을 점수 높은 순으로, 같은 점수는 같은 등수 (학생 화면 등수와 같은 기준). 실전반은 D·E 합쳐서 */
  function rankCard(examId) {
    var e0 = D.exams.filter(function (e) { return e.id === examId; })[0]; if (!e0) return '';
    var real = cls(e0.cls).kind === '실전', key = function (x) { return String(x.label).replace(/\s+/g, ''); };
    var ids = {}; D.exams.forEach(function (e) { if (e.id === e0.id || (real && e.month === e0.month && cls(e.cls).kind === '실전' && key(e) === key(e0) && e.total === e0.total)) ids[e.id] = e; });
    var rows = D.results.filter(function (r) { return ids[r.exam] && !(ids[r.exam].total && r.score > ids[r.exam].total); }).map(function (r) { var s = stu(r.code); return { name: s ? s.name : r.code, score: r.score, wrong: r.wrong ? r.wrong.length : 0, retry: r.retry ? ids[r.exam] && ids[r.exam].key ? Core.grade(ids[r.exam].key, r.answers).wrong.filter(function (w) { return r.retry.charAt(w.n - 1) === w.key; }).length : 0 : null }; });
    if (!rows.length) return '';
    rows.sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); });
    rows.forEach(function (r) { r.rank = 1 + rows.filter(function (x) { return x.score > r.score; }).length; });
    return '<div class="card"><h2>등수 <span class="meta">' + (real ? '실전반(D·E) ' : '이 반 ') + rows.length + '명 · 점수 높은 순, 같은 점수는 같은 등수 · <span class="pill ok">1~5등</span> <span class="pill mid">중간</span> <span class="pill no">마지막 5명</span></span></h2>' +
      '<div class="tw"><table><thead><tr><th class="num">등수</th><th>이름</th><th class="num">점수</th><th class="num">틀린 문항</th><th class="num">오답 고침</th></tr></thead><tbody>' +
      rows.map(function (r, i) { var tone = r.rank <= 5 ? 'ok' : i >= rows.length - 5 ? 'no' : 'mid'; return '<tr><td class="num"><span class="pill ' + tone + '">' + r.rank + '</span></td><td>' + esc(r.name) + '</td><td class="num">' + r.score + ' / ' + e0.total + '</td><td class="num">' + r.wrong + '</td><td class="num">' + (r.retry === null ? '' : r.retry + ' / ' + r.wrong) + '</td></tr>'; }).join('') +
      '</tbody></table></div></div>';
  }
  function bindItem() {
    all('#view [data-ik]').forEach(function (b) { b.onclick = function () { itemKind = b.getAttribute('data-ik'); itemExam = ''; vItem(); }; });
    all('#view [data-is]').forEach(function (b) { b.onclick = function () { itemSort = b.getAttribute('data-is'); vItem(); }; });
    var sel = $('#iE'); if (sel) sel.onchange = function () { itemExam = sel.value; vItem(); };
  }

  function vPlan() {
    var today = D.today.slice(0, 7);
    if (!planYm) planYm = Core.nextMonth(today);
    var yms = [today, Core.nextMonth(today), Core.nextMonth(Core.nextMonth(today))];
    var list = D.classes.filter(function (c) { return c.active && ['개념', '단풀', '실전'].indexOf(c.kind) >= 0; });
    var bankN = ((D.plans || {}).rows || []).length;
    var h = '<div class="card"><h2>월초 강의계획서</h2><p class="meta">학원 공식 워드 양식에 반마다 파일 하나씩 채워서 내려받아요(여러 반은 zip 하나로). 날짜는 「달력」 탭과 반 요일로, 수업 내용·교재 범위는 「계획서」 탭에 모아 둔 지난 계획서(' + bankN + '줄)에서 이어서 채워요.</p>' +
      '<div class="chiprow" aria-label="달">' + yms.map(function (m) { return '<button type="button" class="tab" data-pym="' + m + '" aria-selected="' + (m === planYm) + '">' + esc(UI.monthLabel(m)) + '</button>'; }).join('') + '</div>';
    if (!bankN) h += '<p class="msg err">기록장에 「계획서」 탭이 없거나 비어 있어요. 내용·교재 범위 없이 날짜만 채워져요.</p>';
    h += '<div class="plist">';
    KINDS.forEach(function (k) {
      var g = list.filter(function (c) { return c.kind === k[0]; });
      if (!g.length) return;
      h += '<h3 class="mhd">' + k[1] + '</h3>';
      g.forEach(function (c) {
        var on = planOn(planYm, c.code), subj = c.kind === '실전' ? '' : planSubj(planYm, c.code), p = on ? planFor(c, planYm) : null;
        var lbl = (c.time ? '[' + c.time + '] ' : '') + (c.kind === '실전' ? '실전' + realSuffix(c.code) : c.kind + '반');
        h += '<div class="prow2"><label class="check"><input type="checkbox" data-pon="' + esc(c.code) + '"' + (on ? ' checked' : '') + '> <b>' + esc(lbl) + '</b></label>';
        if (c.kind !== '실전') h += '<select data-psub="' + esc(c.code) + '" aria-label="' + esc(lbl) + ' 과목"><option value="">과목 고르기</option>' + PLAN_SUBJ.map(function (s) { return '<option' + (s === subj ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>';
        if (!on) h += '<span class="meta">빼기</span>';
        else if (!p) h += '<span class="msg err">과목을 골라 주세요</span>';
        else {
          var d0 = p.rows[0], d1 = p.rows[p.rows.length - 1];
          h += '<button type="button" class="btn soft sm" data-pdoc="' + esc(c.code) + '">' + esc(Plan.docName(p)) + '</button>';
          h += '<span class="meta">수업 ' + p.rows.length + '번' + (d0 ? ' · ' + d0.date + '~' + d1.date : '') + (p.from ? ' · ' + (+p.from.slice(5)) + '월 계획서 바탕' : '') + '</span>';
          h += '<details class="pprev"><summary>미리 보기' + (p.warn.length ? ' <span class="pill late">확인 ' + p.warn.length + '</span>' : '') + '</summary>' +
            (p.warn.length ? '<ul class="pwarn">' + p.warn.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
            '<p class="meta">' + esc(p.title) + ' ' + esc(p.subtitle) + '</p><div class="tw"><table class="stab"><thead><tr><th>No.</th><th>날짜</th><th>수업 내용</th><th>교재 범위</th><th>과제</th></tr></thead><tbody>' +
            p.rows.map(function (r) { return '<tr><td>' + r.no + '</td><td>' + esc(r.date) + '</td><td class="wrap">' + esc(r.content).replace(/\n/g, '<br>') + '</td><td class="wrap">' + esc(r.range).replace(/\n/g, '<br>') + '</td><td>' + esc(r.hw) + '</td></tr>'; }).join('') +
            '</tbody></table></div></details>';
        }
        h += '</div>';
      });
    });
    var yymm = planYm.slice(2, 4) + planYm.slice(5, 7);
    h += '</div><button id="pD" class="btn" type="button">' + yymm + ' 강의계획서 워드 전부 내려받기</button><div id="pOut"></div>' +
      '<p class="meta" style="margin-top:8px"><button id="pX" class="linkbtn" type="button">엑셀 한 파일로 받기(반마다 시트)</button></p>' +
      '<p class="meta" style="margin-top:10px">내려받은 뒤 내용을 확인하고 보내 주세요. 지난 계획서와 수업 수가 다르면 줄을 맞추고 「확인」 표시를 해요. 새 달 계획서를 다 쓰면 「계획서」 탭에 그 달 줄을 넣어 두면 다음 달에 이어서 써요.</p></div>';
    $('#view').innerHTML = h;
    all('#view [data-pym]').forEach(function (b) { b.onclick = function () { planYm = b.getAttribute('data-pym'); vPlan(); }; });
    all('#view [data-psub]').forEach(function (s) { s.onchange = function () { UI.store.set(planKey(planYm, s.getAttribute('data-psub')), s.value); vPlan(); }; });
    all('#view [data-pon]').forEach(function (x) { x.onchange = function () { var k = planKey(planYm, x.getAttribute('data-pon')) + '.off'; if (x.checked) UI.store.del(k); else UI.store.set(k, '1'); vPlan(); }; });
    function save(data, name, type) {
      var blob = new Blob([data], { type: type }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    var DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    function makeDocs(plans) {
      return Promise.all([loadZip(), getBuf('assets/plan-template.docx')]).then(function (x) {
        return Promise.all(plans.map(function (p) { return Plan.docx(x[0], x[1], p).then(function (u8) { return { name: Plan.docName(p), data: u8 }; }); })).then(function (files) { return { JSZip: x[0], files: files }; });
      });
    }
    function getBuf(u) {   // XHR: 미리보기(file://)에서도 읽힘
      return new Promise(function (res, rej) {
        var x = new XMLHttpRequest(); x.open('GET', u); x.responseType = 'arraybuffer';
        x.onload = function () { (x.status === 200 || (x.status === 0 && x.response && x.response.byteLength)) ? res(x.response) : rej(new Error('양식')); };
        x.onerror = function () { rej(new Error('양식')); }; x.send();
      });
    }
    function docErr() { $('#pOut').innerHTML = '<p class="msg err">워드 양식을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>'; }
    all('#view [data-pdoc]').forEach(function (b) {
      b.onclick = function () {
        var c = list.filter(function (x) { return x.code === b.getAttribute('data-pdoc'); })[0], p = c && planFor(c, planYm); if (!p) return;
        b.disabled = true;
        makeDocs([p]).then(function (r) { save(r.files[0].data, r.files[0].name, DOCX); $('#pOut').innerHTML = '<p class="msg ok">' + esc(r.files[0].name) + '를 내려받았어요.</p>'; }, docErr)
          .then(function () { b.disabled = false; });
      };
    });
    $('#pD').onclick = function () {
      var b = this, plans = list.filter(function (c) { return planOn(planYm, c.code); }).map(function (c) { return planFor(c, planYm); }).filter(Boolean);
      var miss = list.filter(function (c) { return planOn(planYm, c.code) && !planFor(c, planYm); });
      if (!plans.length) { $('#pOut').innerHTML = '<p class="msg err">내려받을 반이 없어요. 반을 고르고 과목을 골라 주세요.</p>'; return; }
      var label = b.textContent; b.disabled = true; b.textContent = '만드는 중…';
      makeDocs(plans).then(function (r) {
        var used = {}; r.files.forEach(function (f) { var n = f.name, k = 2; while (used[n]) n = f.name.replace(/\.docx$/, '(' + (k++) + ').docx'); used[n] = 1; f.name = n; });
        var tail = miss.length ? ' 과목을 안 고른 ' + miss.length + '개 반은 빠졌어요.' : '';
        if (r.files.length === 1) { save(r.files[0].data, r.files[0].name, DOCX); $('#pOut').innerHTML = '<p class="msg ok">' + esc(r.files[0].name) + '를 내려받았어요.' + tail + '</p>'; return; }
        var z = new r.JSZip(); r.files.forEach(function (f) { z.file(f.name, f.data); });
        return z.generateAsync({ type: 'uint8array' }).then(function (u8) {
          save(u8, yymm + '강의계획서.zip', 'application/zip');
          $('#pOut').innerHTML = '<p class="msg ok">' + yymm + '강의계획서.zip (워드 ' + r.files.length + '개: ' + r.files.map(function (f) { return esc(f.name); }).join(', ') + ')를 내려받았어요.' + tail + '</p>';
        });
      }, docErr).then(function () { b.disabled = false; b.textContent = label; });
    };
    $('#pX').onclick = function () {
      var b = this, plans = list.filter(function (c) { return planOn(planYm, c.code); }).map(function (c) { return planFor(c, planYm); }).filter(Boolean);
      var miss = list.filter(function (c) { return planOn(planYm, c.code) && !planFor(c, planYm); });
      if (!plans.length) { $('#pOut').innerHTML = '<p class="msg err">내려받을 반이 없어요. 반을 고르고 과목을 골라 주세요.</p>'; return; }
      b.disabled = true; b.textContent = '만드는 중…';
      function img(u) { return fetch(u).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () { return null; }); }
      Promise.all([loadExcel(), img('assets/plan-head.png'), img('assets/plan-foot.png')]).then(function (x) {
        return Plan.xlsx(x[0], plans, x[1] && x[2] ? { head: x[1], foot: x[2] } : null).xlsx.writeBuffer().then(function (buf) {
          var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = yymm + '강의계획서.xlsx';
          document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          $('#pOut').innerHTML = '<p class="msg ok">' + yymm + '강의계획서.xlsx (시트 ' + plans.length + '개)를 내려받았어요.' + (miss.length ? ' 과목을 안 고른 ' + miss.length + '개 반은 빠졌어요.' : '') + '</p>';
        });
      }).catch(function () { $('#pOut').innerHTML = '<p class="msg err">엑셀 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>'; })
        .then(function () { b.disabled = false; b.textContent = '엑셀 한 파일로 받기(반마다 시트)'; });
    };
  }

  var zipP = null;
  function loadZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!zipP) zipP = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = function () { window.JSZip ? res(window.JSZip) : rej(); }; s.onerror = function () { zipP = null; rej(); };
      document.head.appendChild(s);
    });
    return zipP;
  }
  var excelP = null;
  function loadExcel() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (!excelP) excelP = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = function () { window.ExcelJS ? res(window.ExcelJS) : rej(); }; s.onerror = function () { excelP = null; rej(); };
      document.head.appendChild(s);
    });
    return excelP;
  }

  /* ---------- 시작 ---------- */
  $('#loginForm').onsubmit = function (e) { e.preventDefault(); login(); };
  $('#pwShow').onclick = function () {
    var show = $('#pw').type === 'password'; $('#pw').type = show ? 'text' : 'password';
    this.textContent = show ? '숨기기' : '보기'; this.setAttribute('aria-pressed', String(show)); $('#pw').focus();
  };
  $('#logout').onclick = function () { logout(''); };
  /** 로고(머리띠 「성적노트」) 누르면 처음 화면: 이번 달 「답안 입력」 (로그인 전이면 맨 위로만) */
  $('#home').onclick = function (e) {
    e.preventDefault();
    if (D) { tab = TABS[0][0]; month = D.today.slice(0, 7); if ($('#month')) $('#month').value = month; renderNav(); render(); }
    window.scrollTo(0, 0);
  };
  $('#month').onchange = function () { month = this.value; render(); };
  if (token) load(); else { $('#pw').focus(); Api.warm(); }   // 비밀번호를 치는 동안 서버를 미리 깨워 둠
})();
