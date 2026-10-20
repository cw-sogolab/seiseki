/* 강사 화면: 답안 입력·채점, 시험·숙제 등록, 숙제 확인, 명단·번호, 월말 표 */
(function () {
  var $ = UI.$, all = UI.all, esc = UI.esc;
  var token = UI.store.get('seiseki.token', sessionStorage) || '';
  var D = null, tab = 'entry', month = '', curExam = '', curHw = '', monthCls = '';
  var TABS = [['entry', '답안 입력'], ['exams', '시험'], ['hw', '숙제'], ['stu', '학생·번호'], ['month', '월말 표']];

  if (Api.demo) $('#demo').hidden = false;

  /* ---------- 서버 ---------- */
  function req(action, payload) {
    return Api.call(action, Object.assign({ token: token }, payload || {})).then(function (r) {
      if (!r.ok && r.needLogin) { logout('다시 로그인해 주세요.'); }
      return r;
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
      load(true);
    });
  }
  function logout(msg) {
    token = ''; D = null; UI.store.del('seiseki.token', sessionStorage);
    document.body.classList.add('locked'); busy(false);
    $('#view').hidden = true; $('#nav').hidden = true; $('#topRight').hidden = true; $('#login').hidden = false;
    $('#loginMsg').textContent = msg || '';
  }
  /** 기록을 불러와 화면을 엶. 방금 로그인했으면 토큰이 서버에 막 저장된 참이라, 한 번은 다시 물어봄 */
  function load(justLoggedIn, retried) {
    busy(true, '기록을 불러오는 중…');
    Api.call('bootstrap', { token: token }).then(function (r) {
      if (!r.ok && r.needLogin && justLoggedIn && !retried) { setTimeout(function () { load(true, true); }, 800); return; }
      if (!r.ok) { if (r.needLogin) logout('다시 로그인해 주세요.'); else { busy(false); $('#loginMsg').textContent = r.error; } return; }
      D = r.data; busy(false);
      if (!month) month = D.today.slice(0, 7);
      document.body.classList.remove('locked');
      $('#login').hidden = true; $('#view').hidden = false; $('#nav').hidden = false; $('#topRight').hidden = false;
      renderMonths(); renderNav(); render();
    });
  }

  /* ---------- 데이터 도우미 ---------- */
  function cls(code) { return D.classes.filter(function (c) { return c.code === code; })[0] || { code: code, name: code, kind: '', time: '' }; }
  function stu(code) { return D.students.filter(function (s) { return s.code === code; })[0]; }
  function members(c) { return D.students.filter(function (s) { return s.active && s.classes.indexOf(c) >= 0; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); }); }
  /** 그 반·그 달의 명단: 기록(시험결과·숙제제출)이 있는 학생 + (이번 달이면) 지금 듣는 학생 */
  function rosterFor(c, m) {
    var codes = {};
    D.exams.forEach(function (e) { if (e.cls === c && e.month === m) D.results.forEach(function (r) { if (r.exam === e.id) codes[r.code] = 1; }); });
    D.homework.forEach(function (h) { if (h.cls === c && h.month === m) D.hwSubs.forEach(function (x) { if (x.hw === h.id) codes[x.code] = 1; }); });
    if (m === D.today.slice(0, 7)) members(c).forEach(function (s) { codes[s.code] = 1; });
    return D.students.filter(function (s) { return codes[s.code]; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
  }
  function pages(h) { return (h.book ? esc(h.book) + ' ' : '') + (h.p0 ? 'p.' + h.p0 + '~' + h.p1 : ''); }
  function examsOfMonth() { return D.exams.filter(function (e) { return e.month === month; }).sort(function (a, b) { return (a.cls + a.date).localeCompare(b.cls + b.date); }); }
  function hwOfMonth() { return D.homework.filter(function (h) { return h.month === month; }); }
  function resultOf(exam, code) { return D.results.filter(function (r) { return r.exam === exam && r.code === code; })[0]; }
  function subOf(hw, code) { return D.hwSubs.filter(function (s) { return s.hw === hw && s.code === code; })[0]; }
  function replace(list, pred, item) { var i = list.findIndex(pred); if (i >= 0) list[i] = item; else list.push(item); }
  function classOptions(sel) { return D.classes.filter(function (c) { return c.active; }).map(function (c) { return '<option value="' + esc(c.code) + '"' + (c.code === sel ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join(''); }
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
  function render() { ({ entry: vEntry, exams: vExams, hw: vHw, stu: vStu, month: vMonth })[tab](); }

  /* ---------- 답안 입력 ---------- */
  function vEntry() {
    var exs = examsOfMonth();
    if (!exs.length) { $('#view').innerHTML = '<div class="card"><p class="empty">' + esc(UI.monthLabel(month)) + '에 등록된 시험이 없어요. 「시험」 탭에서 먼저 정답을 등록해 주세요.</p></div>'; return; }
    if (!exs.some(function (e) { return e.id === curExam; })) curExam = exs[exs.length - 1].id;
    var ex = exs.filter(function (e) { return e.id === curExam; })[0], mem = members(ex.cls), cur = null;
    $('#view').innerHTML =
      '<div class="grid2" style="margin-top:12px"><div class="card">' +
      '<label for="exSel">시험</label><select id="exSel">' + exs.map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === curExam ? ' selected' : '') + '>' + esc(cls(e.cls).name) + ' · ' + esc(e.label) + ' (' + esc(UI.dateLabel(e.date)) + ')</option>'; }).join('') + '</select>' +
      '<p class="meta" id="exMeta"></p>' +
      '<label for="stIn">학생 (이름 또는 번호)</label><input id="stIn" type="text" list="stList" autocomplete="off"><datalist id="stList"></datalist>' +
      '<div class="hit" id="hit"></div>' +
      '<label for="ansIn">답안 (고른 번호를 이어서, 무응답은 0)</label><input id="ansIn" class="ans" type="text" inputmode="numeric" autocomplete="off">' +
      '<p class="meta" id="cnt"></p><div id="prev"></div>' +
      '<button type="button" class="btn" id="save">저장하고 다음 학생 (Enter)</button><p id="emsg" class="msg" role="status"></p>' +
      '</div><div class="card"><h2>입력 현황</h2><div id="roster"></div></div></div>';
    $('#exSel').onchange = function () { curExam = this.value; vEntry(); };
    function meta() { $('#exMeta').textContent = ex.total + '문항 · ' + cls(ex.cls).time + ' · 입력 ' + mem.filter(function (s) { return resultOf(ex.id, s.code); }).length + ' / ' + mem.length + '명'; }
    meta();
    $('#stList').innerHTML = mem.map(function (s) { return '<option value="' + esc(s.name) + '" label="' + Core.fmtCode(s.code) + '"></option>'; }).join('');
    $('#ansIn').maxLength = ex.total;
    function resolve() {
      var q = $('#stIn').value.trim(), n = Core.normCode(q), hit = $('#hit'); cur = null;
      if (!q) { hit.className = 'hit'; hit.textContent = ''; return; }
      var exact = mem.filter(function (s) { return s.code === n || s.name === q; });
      var part = exact.length ? exact : mem.filter(function (s) { return s.name.indexOf(q) >= 0; });
      if (part.length === 1) { cur = part[0]; hit.className = 'hit good'; hit.textContent = cur.name + ' · ' + Core.fmtCode(cur.code) + (resultOf(ex.id, cur.code) ? ' · 이미 입력됨 (저장하면 덮어씀)' : ''); }
      else if (part.length > 1) { hit.className = 'hit bad'; hit.textContent = '비슷한 이름이 ' + part.length + '명이에요. 번호로 입력해 주세요.'; }
      else { hit.className = 'hit bad'; hit.textContent = '이 반에서 찾을 수 없어요.'; }
    }
    function preview() {
      var v = Core.cleanAnswers($('#ansIn').value, ex.total); $('#ansIn').value = v;
      $('#cnt').textContent = '입력 ' + v.length + ' / ' + ex.total + (v.length && v.length < ex.total ? ' · 남은 칸은 무응답으로 저장돼요' : '');
      if (!v) { $('#prev').innerHTML = ''; return; }
      var g = Core.grade(ex.key, v);
      $('#prev').innerHTML = '<div class="result"><b>' + g.score + ' / ' + ex.total + '</b><span class="meta">틀린 문항 ' + g.wrong.length + '개</span></div>' +
        '<div class="chips">' + g.wrong.map(function (w) { return '<span class="chip">' + w.n + '번 정답 ' + w.key + ' 학생 ' + (w.ans === '0' ? '무응답' : w.ans) + '</span>'; }).join('') + '</div>';
    }
    function roster() {
      $('#roster').innerHTML = '<div class="tw"><table><thead><tr><th>이름</th><th>번호</th><th class="num">점수</th><th>상태</th></tr></thead><tbody>' +
        mem.map(function (s) { var r = resultOf(ex.id, s.code); return '<tr class="click" data-c="' + esc(s.code) + '"><td>' + esc(s.name) + '</td><td class="code">' + Core.fmtCode(s.code) + '</td><td class="num">' + (r ? r.score + '/' + ex.total : '-') + '</td><td>' + (r ? '<span class="pill ok">입력됨</span>' : '<span class="pill no">미입력</span>') + '</td></tr>'; }).join('') +
        '</tbody></table></div><p class="meta" style="margin-top:8px">줄을 누르면 그 학생을 불러옵니다. 미입력 ' + mem.filter(function (s) { return !resultOf(ex.id, s.code); }).length + '명</p>';
      all('#roster tr.click').forEach(function (tr) {
        tr.onclick = function () { var s = stu(tr.getAttribute('data-c')), r = resultOf(ex.id, s.code); $('#stIn').value = s.name; resolve(); $('#ansIn').value = r ? r.answers.replace(/0+$/, '') : ''; preview(); $('#ansIn').focus(); };
      });
    }
    function save() {
      var m = $('#emsg'), v = $('#ansIn').value, btn = $('#save');
      resolve();
      if (!cur) return msg(m, false, '학생을 먼저 정해 주세요.');
      if (!v) return msg(m, false, '답안을 입력해 주세요.');
      btn.disabled = true;
      var who = cur;
      req('saveResult', { exam: ex.id, code: who.code, answers: v }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) return msg(m, false, r.error);
        replace(D.results, function (x) { return x.exam === ex.id && x.code === who.code; }, r.data);
        msg(m, true, who.name + ' 저장: ' + r.data.score + '/' + ex.total + (r.data.wrong.length ? ' · 틀린 문항 ' + r.data.wrong.join(', ') : ' · 만점'));
        $('#stIn').value = ''; $('#ansIn').value = ''; $('#hit').textContent = ''; $('#prev').innerHTML = ''; $('#cnt').textContent = '';
        meta(); roster(); $('#stIn').focus();
      });
    }
    $('#stIn').oninput = resolve;
    $('#stIn').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#ansIn').focus(); } };
    $('#ansIn').oninput = preview;
    $('#ansIn').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } };
    $('#save').onclick = save;
    roster(); $('#stIn').focus();
  }

  /* ---------- 시험 ---------- */
  function vExams() {
    var exs = examsOfMonth();
    $('#view').innerHTML =
      '<div class="card"><h2>' + esc(UI.monthLabel(month)) + ' 시험 등록</h2><div class="fields">' +
      '<div><label for="nC">반</label><select id="nC">' + classOptions() + '</select></div>' +
      '<div><label for="nK">종류</label><select id="nK"><option>소테스트</option><option>월말테스트</option><option>모의고사</option></select></div>' +
      '<div><label for="nL">시험 이름 <span class="opt">(학생 화면·월말 표 제목)</span></label><input id="nL" type="text" placeholder="비우면 「종류 월/일」"></div>' +
      '<div><label for="nD">시험일</label><input id="nD" type="date" value="' + esc(D.today) + '"></div>' +
      '<div><label for="nT">문항 수</label><input id="nT" type="number" min="1" max="80" value="15"></div></div>' +
      '<label for="nA">정답 (번호를 이어서)</label><input id="nA" class="ans" type="text" inputmode="numeric" autocomplete="off">' +
      '<p class="meta" id="nCnt"></p><button type="button" class="btn" id="nAdd">시험 등록</button><p id="nMsg" class="msg" role="status"></p></div>' +
      '<div class="card"><h2>등록된 시험</h2>' + (exs.length ? '<div class="tw"><table><thead><tr><th>반</th><th>이름</th><th>종류</th><th>시험일</th><th class="num">문항</th><th class="num">입력</th><th>정답</th><th></th></tr></thead><tbody>' +
      exs.map(function (e) {
        var n = D.results.filter(function (r) { return r.exam === e.id; }).length;
        return '<tr><td>' + esc(cls(e.cls).name) + '</td><td>' + esc(e.label) + '</td><td>' + esc(e.kind) + '</td><td>' + esc(UI.dateLabel(e.date)) + '</td><td class="num">' + e.total + '</td><td class="num">' + n + '명</td>' +
          '<td><input type="text" class="ans" style="font-size:13px!important;padding:4px 6px;width:' + Math.max(8, e.total * 0.75) + 'em" data-key="' + esc(e.id) + '" value="' + esc(e.key) + '" aria-label="' + esc(e.label) + ' 정답"> <button class="btn sub sm" type="button" data-savekey="' + esc(e.id) + '">정답 저장</button></td>' +
          '<td>' + (n ? '' : '<button class="btn sub sm danger" type="button" data-del="' + esc(e.id) + '">삭제</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="meta" style="margin-top:8px">정답을 고쳐 저장하면 이미 입력한 답안을 새 정답으로 다시 채점합니다.</p>' : '<p class="empty">아직 없어요.</p>') + '<p id="xMsg" class="msg" role="status"></p></div>';
    function cnt() { var t = +$('#nT').value || 0; $('#nA').value = Core.cleanKey($('#nA').value).slice(0, t); $('#nCnt').textContent = '정답 ' + $('#nA').value.length + ' / ' + t; }
    $('#nA').oninput = cnt; $('#nT').oninput = cnt; cnt();
    $('#nAdd').onclick = function () {
      var b = this; b.disabled = true;
      var label = $('#nL').value.trim() || ($('#nK').value + ' ' + UI.dateLabel($('#nD').value || D.today));
      req('addExam', { cls: $('#nC').value, kind: $('#nK').value, label: label, total: $('#nT').value, key: $('#nA').value, date: $('#nD').value, month: month }).then(function (r) {
        b.disabled = false;
        if (!r.ok) return msg($('#nMsg'), false, r.error);
        D.exams.push(r.data); curExam = r.data.id; vExams(); msg($('#nMsg'), true, '등록했어요. 「답안 입력」에서 바로 입력할 수 있어요.');
      });
    };
    all('#view [data-savekey]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-savekey'), v = $('#view [data-key="' + id + '"]').value;
        req('updateExamKey', { exam: id, key: v }).then(function (r) { if (!r.ok) return msg($('#xMsg'), false, r.error); D = r.data; vExams(); msg($('#xMsg'), true, '정답을 고치고 다시 채점했어요.'); });
      };
    });
    all('#view [data-del]').forEach(function (b) {
      twoStep(b, '삭제', function () {
        var id = b.getAttribute('data-del');
        req('deleteExam', { exam: id }).then(function (r) { if (!r.ok) return msg($('#xMsg'), false, r.error); D.exams = D.exams.filter(function (e) { return e.id !== id; }); vExams(); });
      });
    });
  }

  /* ---------- 숙제 ---------- */
  function vHw() {
    var hws = hwOfMonth();
    var add = '<div class="card"><details' + (hws.length ? '' : ' open') + '><summary>' + esc(UI.monthLabel(month)) + ' 숙제 등록</summary><div class="fields">' +
      '<div><label for="hC">반</label><select id="hC">' + classOptions() + '</select></div>' +
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
    $('#view').innerHTML =
      '<div class="card"><label for="hSel">숙제</label><select id="hSel">' + hws.map(function (h) { return '<option value="' + esc(h.id) + '"' + (h.id === curHw ? ' selected' : '') + '>' + esc(cls(h.cls).name) + ' · ' + esc(h.label) + '</option>'; }).join('') + '</select>' +
      '<p class="meta" style="margin-top:8px">' + pages(hw) + (hw.total ? ' · ' + hw.total + '문' : '') + ' · 제출 ' + done.length + ' / ' + mem.length + '명 · 확인 ' + done.filter(function (s) { return subOf(hw.id, s.code).checked; }).length + '명</p>' +
      '<div class="tw" style="margin-top:10px"><table><thead><tr><th>이름</th><th>번호</th><th>상태</th><th class="num">맞은 개수</th><th class="num">사진</th><th>확인</th><th></th></tr></thead><tbody>' +
      mem.map(function (s) {
        var u = subOf(hw.id, s.code);
        return '<tr><td>' + esc(s.name) + '</td><td class="code">' + Core.fmtCode(s.code) + '</td><td>' + (u ? (u.proxy ? '<span class="pill wait">대신 입력</span>' : '<span class="pill ok">제출</span>') : '<span class="pill no">미제출</span>') + '</td>' +
          '<td class="num">' + (u && u.count !== null ? u.count + (hw.total ? '/' + hw.total : '') : '-') + '</td><td class="num">' + (u ? u.photos + '장' : '-') + '</td>' +
          '<td>' + (u ? '<label class="check" style="margin:0"><input type="checkbox" data-ck="' + esc(s.code) + '"' + (u.checked ? ' checked' : '') + '> 확인</label>' : '') + '</td>' +
          '<td>' + (u && u.photos ? '<button type="button" class="btn sub sm" data-ph="' + esc(s.code) + '">사진 보기</button>' : '') +
          (u ? '' : '<input type="number" min="0" style="width:5.5em;padding:4px 6px;font-size:13px" data-pxv="' + esc(s.code) + '" placeholder="개수" aria-label="' + esc(s.name) + ' 맞은 개수"> <button type="button" class="btn sub sm" data-px="' + esc(s.code) + '">대신 입력</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="meta" style="margin-top:10px">미제출: ' + (mem.filter(function (s) { return !subOf(hw.id, s.code); }).map(function (s) { return esc(s.name); }).join(', ') || '없음') + '</p>' +
      (D.hwSubs.some(function (s) { return s.hw === hw.id; }) ? '' : '<button type="button" class="btn sub sm danger" id="hDel" style="margin-top:10px">이 숙제 삭제</button>') +
      '<p id="hwMsg" class="msg" role="status"></p></div>' + add;
    $('#hSel').onchange = function () { curHw = this.value; vHw(); };
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
        return '<a href="' + esc(Api.photoLink(p.fileId)) + '" target="_blank" rel="noopener"><img src="' + esc(Api.photoUrl(p.fileId, 600)) + '" alt="' + p.order + '번째 사진" loading="lazy"><span>' + p.order + '번째 · ' + esc(p.at) + '</span></a>';
      }).join('') : '<p class="empty">사진이 없어요.</p>';
    });
  }

  /* ---------- 학생·번호 ---------- */
  var stuFilter = 'cur', editing = '';
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
      '<div class="tw" style="margin-top:10px"><table><thead><tr><th>이름</th><th>번호</th><th>반</th><th>상태</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (s) {
        var row = '<tr><td>' + esc(s.name) + '</td><td class="code">' + Core.fmtCode(s.code) + '</td><td>' + (s.classes.map(function (c) { return esc(cls(c).name); }).join(', ') || '<span class="meta">없음</span>') + '</td>' +
          '<td>' + (!s.active ? '<span class="pill no">차단</span>' : s.classes.length ? '<span class="pill ok">수강 중</span>' : '<span class="pill wait">수강 없음</span>') + '</td>' +
          '<td><button type="button" class="btn sub sm" data-ed="' + esc(s.code) + '">반 수정</button></td></tr>';
        if (editing === s.code) {
          row += '<tr><td colspan="5"><div class="fields" style="gap:14px">' + D.classes.filter(function (c) { return c.active; }).map(function (c) {
            return '<label class="check" style="margin:0"><input type="checkbox" data-cc="' + esc(c.code) + '"' + (s.classes.indexOf(c.code) >= 0 ? ' checked' : '') + '> ' + esc(c.name) + '</label>';
          }).join('') + '<button type="button" class="btn sm" id="ccSave">저장</button> <button type="button" class="btn sub sm" id="ccCancel">취소</button></div></td></tr>';
        }
        return row;
      }).join('') : '<tr><td colspan="5" class="empty">' + (stuFilter === 'cur' ? '이번 달 수강생이 없어요. 위에 명단을 붙여넣어 주세요.' : '원생명단이 비어 있어요.') + '</td></tr>') +
      '</tbody></table></div><p class="meta" style="margin-top:8px">번호는 퇴실퀴즈와 같은 원생명단에서 관리합니다. 학생 이용을 막으려면 원생명단 시트의 「상태」 칸에 「차단」이라고 적으세요. 번호를 잊은 학생에게는 이 표의 번호를 다시 알려 주면 됩니다.</p><p id="sMsg" class="msg" role="status"></p></div>' +
      '<div class="card"><h2>반 목록</h2><p class="meta">반 이름·시간은 기록장 구글 시트의 「반」 탭에서 고칩니다. 반코드는 바꾸지 마세요.</p><div class="tw" style="margin-top:8px"><table><thead><tr><th>반코드</th><th>반 이름</th><th>종류</th><th>요일·시간</th><th class="num">학생</th></tr></thead><tbody>' +
      D.classes.map(function (c) { return '<tr><td class="code">' + esc(c.code) + '</td><td>' + esc(c.name) + '</td><td>' + esc(c.kind) + '</td><td>' + esc(c.time) + '</td><td class="num">' + members(c.code).length + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    all('#view [data-f]').forEach(function (b) { b.onclick = function () { stuFilter = b.getAttribute('data-f'); editing = ''; vStu(); }; });
    $('#issue').onclick = function () {
      var b = this; b.disabled = true;
      req('importRoster', { text: $('#paste').value, deactivateMissing: $('#deact').checked }).then(function (r) {
        b.disabled = false;
        if (!r.ok) { $('#iOut').innerHTML = '<p class="msg err">' + esc(r.error) + '</p>'; return; }
        D.students = r.data.students;
        var x = r.data, h = '';
        h += '<div class="okbox">명단에서 찾음 ' + x.updated.length + '명 · 새 번호 ' + x.added.length + '명(원생명단에 추가)' + (x.deactivated.length ? ' · 반 비움 ' + x.deactivated.length + '명' : '') + '</div>';
        if (x.added.length) h += '<div class="tw" style="margin-top:8px"><table><thead><tr><th>새 원생</th><th>번호</th></tr></thead><tbody>' + x.added.map(function (a) { return '<tr><td>' + esc(a.name) + '</td><td class="code">' + Core.fmtCode(a.code) + '</td></tr>'; }).join('') + '</tbody></table></div>';
        if (x.unknown.length) h += '<div class="warnbox">확인이 필요한 줄 ' + x.unknown.length + '개<br>' + x.unknown.map(function (u) { return esc(u.line) + ' → ' + esc(u.reason); }).join('<br>') + '</div>';
        stuFilter = 'cur'; editing = ''; vStu(); $('#iOut').innerHTML = h;
      });
    };
    $('#cp').onclick = function () {
      UI.copy(list.filter(function (s) { return s.active; }).map(function (s) { return [s.name, Core.fmtCode(s.code), s.classes.map(function (c) { return cls(c).name; }).join(', ')].join('\t'); }).join('\n'), $('#cpOut'));
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
    var exs = D.exams.filter(function (e) { return e.cls === cc && e.month === month; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    var hws = D.homework.filter(function (h) { return h.cls === cc && h.month === month; });
    var head = ['이름', '학생평가'].concat(hws.map(function (h) { return h.label + (h.total ? '(' + h.total + '문)' : ''); }),
      exs.map(function (e) { return e.label + (real ? '(개수/환산)' : '(' + e.total + '문)'); }), ['평균', '숙제 제출']);
    var rows = rosterFor(cc, month).map(function (s) {
      var hc = hws.map(function (h) { var u = subOf(h.id, s.code); return u ? (u.count !== null ? String(u.count) : '제출') : '-'; });
      var useConv = real && exs.length && exs.every(function (e) { var r = resultOf(e.id, s.code); return !r || r.conv !== null; });
      var vals = [];
      var ec = exs.map(function (e) {
        var r = resultOf(e.id, s.code); if (!r) return '-';
        vals.push(useConv && r.conv !== null ? r.conv : r.score);
        return real ? r.score + (r.conv !== null ? ' / ' + r.conv : '') : String(r.score);
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
    $('#view').innerHTML = '<div class="card"><div class="fields"><div><label for="mC">반</label><select id="mC">' + opts.map(function (c) { return '<option value="' + esc(c.code) + '"' + (c.code === monthCls ? ' selected' : '') + '>' + esc(c.name) + (used[c.code] ? '' : ' (이 달 기록 없음)') + '</option>'; }).join('') + '</select></div>' +
      '<div style="flex:0 0 auto"><button type="button" class="btn sub" id="mCp">표 복사</button> <button type="button" class="btn sub" id="mX">엑셀 내려받기</button></div></div>' +
      '<p class="meta" style="margin-top:8px">' + esc(UI.monthLabel(month)) + ' · 평균은 테스트(소테스트·월말·모의고사)만으로 계산하고 숙제는 따로 둡니다.' + (T.real ? ' 환산점수가 모두 있으면 평균은 환산점수 기준입니다.' : '') + ' 학생평가는 칸을 벗어나면 저장돼요.</p><div id="mOut"></div>' +
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
      loadXlsx().then(function (X) {
        var data = [['종합과목 ' + T.c.name + ' · ' + UI.monthLabel(month)], []].concat(aoa());
        var ws = X.utils.aoa_to_sheet(data);
        ws['!cols'] = T.head.map(function (h, i) { return { wch: i === 1 ? 40 : Math.max(8, h.length + 4) }; });
        var wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, T.c.name.slice(0, 28).replace(/[\\\/?*\[\]:]/g, ' '));
        X.writeFile(wb, month.replace('-', '').slice(2) + '_' + T.c.name.replace(/[\\\/:*?"<>|]/g, ' ') + '_월말.xlsx');
      }).catch(function () { $('#mOut').innerHTML = '<p class="msg err">엑셀 도구를 불러오지 못했어요. 인터넷 연결을 확인하거나 「표 복사」를 써 주세요.</p>'; });
    };
  }
  var xlsxP = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxP) xlsxP = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = function () { window.XLSX ? res(window.XLSX) : rej(); }; s.onerror = function () { xlsxP = null; rej(); };
      document.head.appendChild(s);
    });
    return xlsxP;
  }

  /* ---------- 시작 ---------- */
  $('#loginForm').onsubmit = function (e) { e.preventDefault(); login(); };
  $('#pwShow').onclick = function () {
    var show = $('#pw').type === 'password'; $('#pw').type = show ? 'text' : 'password';
    this.textContent = show ? '숨기기' : '보기'; this.setAttribute('aria-pressed', String(show)); $('#pw').focus();
  };
  $('#logout').onclick = function () { logout(''); };
  $('#month').onchange = function () { month = this.value; render(); };
  if (token) load(); else $('#pw').focus();
})();
