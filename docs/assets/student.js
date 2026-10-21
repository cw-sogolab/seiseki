/* 학생 화면: 번호로 들어와 성적 조회 + 숙제 사진 제출 */
(function () {
  var $ = UI.$, esc = UI.esc;
  var view = null, code = '', cur = 0, month = '', busy = false;

  if (Api.demo) $('#demo').hidden = false;

  function setBusy(btn, on, label) { busy = on; btn.disabled = on; if (label) btn.textContent = label; }

  function login(c) {
    var btn = $('#go');
    if (busy) return;
    setBusy(btn, true, '확인하는 중…');
    Api.call('login', { code: c }).then(function (r) {
      setBusy(btn, false, '조회하기');
      if (!r.ok) { $('#loginMsg').textContent = r.error; UI.store.del('seiseki.code'); return; }
      $('#loginMsg').textContent = '';
      code = r.data.code;
      if ($('#remember').checked) UI.store.set('seiseki.code', code);
      show(r.data);
    });
  }

  function show(data) {
    view = data;
    if (cur >= view.classes.length) cur = 0;
    $('#nm').textContent = view.name;
    $('#idshow').textContent = Core.fmtCode(view.code);
    $('#login').hidden = true; $('#app').hidden = false; $('#acts').hidden = false;
    renderTabs();
  }

  function monthsOf(c) {
    var m = {};
    c.tests.forEach(function (t) { if (t.month) m[t.month] = 1; });
    c.hw.forEach(function (h) { if (h.month) m[h.month] = 1; });
    return Object.keys(m).sort().reverse();
  }

  function renderTabs() {
    var tabs = $('#tabs');
    if (!view.classes.length) { tabs.innerHTML = ''; $('#months').innerHTML = ''; $('#panel').innerHTML = '<div class="card"><p class="empty">아직 등록된 반이 없어요. 선생님께 말씀해 주세요.</p></div>'; return; }
    tabs.innerHTML = view.classes.map(function (c, i) {
      return '<button class="tab" type="button" role="tab" data-i="' + i + '" aria-selected="' + (i === cur) + '">' + esc(c.name) + (c.name.indexOf(c.time) >= 0 ? (c.current === false ? '<small>지난 반</small>' : '') : '<small>' + esc(c.time) + (c.current === false ? ' · 지난 반' : '') + '</small>') + '</button>';
    }).join('');
    UI.all('#tabs .tab').forEach(function (b) { b.onclick = function () { cur = +b.getAttribute('data-i'); month = ''; renderTabs(); }; });
    var ms = monthsOf(view.classes[cur]);
    if (!month || ms.indexOf(month) < 0) month = ms[0] || '';
    $('#months').innerHTML = ms.length > 1 ? ms.map(function (m) {
      return '<button class="tab" type="button" data-m="' + m + '" aria-selected="' + (m === month) + '">' + esc(UI.monthLabel(m)) + '</button>';
    }).join('') : '';
    UI.all('#months .tab').forEach(function (b) { b.onclick = function () { month = b.getAttribute('data-m'); renderTabs(); }; });
    renderPanel();
  }

  function pct(a, t) { return t ? Math.round(a / t * 100) : 0; }

  function chart(tests) {
    var pts = tests.filter(function (t) { return t.score !== null; });
    if (!pts.length) return '<p class="empty">아직 입력된 점수가 없어요.</p>';
    var W = 300, H = 130, L = 28, R = 18, T = 10, B = 22, n = pts.length;
    function x(i) { return n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1); }
    function y(p) { return T + (100 - p) * (H - T - B) / 100; }
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="시험별 내 정답률과 반 평균">';
    [0, 50, 100].forEach(function (g) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="var(--line)"/>';
      s += '<text x="' + (L - 5) + '" y="' + (y(g) + 4) + '" text-anchor="end" font-size="10" fill="var(--muted)">' + g + '</text>';
    });
    var me = [], av = [];
    pts.forEach(function (t, i) {
      me.push(x(i) + ',' + y(pct(t.score, t.total)));
      if (t.avg !== null) av.push(x(i) + ',' + y(pct(t.avg, t.total)));
      if (n <= 8 || i % Math.ceil(n / 8) === 0) s += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + esc(UI.dateLabel(t.date)) + '</text>';
    });
    if (n > 1) {
      if (av.length === n) s += '<polyline points="' + av.join(' ') + '" fill="none" stroke="var(--avg)" stroke-width="2" stroke-dasharray="5 4"/>';
      s += '<polyline points="' + me.join(' ') + '" fill="none" stroke="var(--me)" stroke-width="2.5"/>';
    }
    pts.forEach(function (t, i) {
      if (t.avg !== null) s += '<circle cx="' + x(i) + '" cy="' + y(pct(t.avg, t.total)) + '" r="3" fill="var(--avg)"/>';
      s += '<circle cx="' + x(i) + '" cy="' + y(pct(t.score, t.total)) + '" r="4.5" fill="var(--me)"/>';
    });
    return s + '</svg><div class="legend"><span><i></i>내 정답률</span><span><i class="a"></i>반 평균</span></div>';
  }

  function renderPanel() {
    var c = view.classes[cur];
    var tests = c.tests.filter(function (t) { return !month || t.month === month; });
    var hws = c.hw.filter(function (h) { return !month || h.month === month; });
    var taken = tests.filter(function (t) { return t.score !== null; });
    var avg = taken.length ? Math.round(taken.reduce(function (s, t) { return s + t.score / t.total; }, 0) / taken.length * 100) : null;
    var done = hws.filter(function (h) { return h.done; }).length;
    var h = '<div class="tiles"><div class="tile hi"><span>' + (month ? (+month.slice(5)) + '월 ' : '') + '테스트 평균</span><b>' + (avg === null ? '-' : avg + '<small style="font-size:14px;font-family:var(--f-body)">%</small>') + '</b></div>' +
      '<div class="tile"><span>숙제 제출</span><b>' + (hws.length ? done + ' / ' + hws.length : '-') + '</b></div></div>';
    h += '<div class="card"><h2>점수 추이 (정답률 %)</h2>' + chart(c.tests) + '</div>';
    h += '<div class="card"><h2>테스트 결과</h2>';
    if (!tests.length) h += '<p class="empty">이 달에 등록된 테스트가 없어요.</p>';
    tests.forEach(function (t) {
      h += '<div class="item"><div class="row"><b>' + esc(t.label) + '</b>' +
        (t.score === null ? '<span class="pill wait">아직 입력 전</span>' : '<span class="score">' + t.score + '<small> / ' + t.total + '</small></span>') + '</div>';
      h += '<p class="meta">' + esc(UI.dateLabel(t.date)) + (t.avg !== null ? ' · 반 평균 ' + t.avg.toFixed(1) : '') +
        (t.conv !== null ? ' · 환산점수 ' + t.conv + (t.convAvg !== null ? ' (반 평균 ' + Math.round(t.convAvg) + ')' : '') : '') + '</p>';
      if (t.score !== null) {
        if (t.wrongDetail) h += '<div class="chips"><span class="lbl">틀린 문항</span>' + t.wrongDetail.map(function (w) { return '<span class="chip">' + w.n + '번 정답 ' + w.key + ' · 내 답 ' + (w.ans === '0' ? '-' : w.ans) + '</span>'; }).join('') + '</div>';
        else if (t.wrong.length) h += '<div class="chips"><span class="lbl">틀린 문항</span>' + t.wrong.map(function (n) { return '<span class="chip">' + n + '번</span>'; }).join('') + '</div>';
        else h += '<div class="chips"><span class="pill ok">전부 맞았어요</span></div>';
      }
      h += '</div>';
    });
    h += '</div><div class="card"><h2>숙제</h2>';
    if (!hws.length) h += '<p class="empty">이 달에 온라인으로 낼 숙제가 없어요.</p>';
    hws.forEach(function (w) {
      var detail = [w.book ? esc(w.book) : '', w.p0 ? 'p.' + w.p0 + '~' + w.p1 : '', w.total ? w.total + '문' : ''].filter(Boolean).join(' · ');
      if (w.done) detail += (detail ? ' · ' : '') + (w.photos ? '사진 ' + w.photos + '장' : '선생님 입력') + (w.count !== null ? ' · 맞은 개수 ' + w.count : '');
      h += '<div class="item"><div class="row"><div><b>' + esc(w.label) + '</b><p class="meta">' + detail + '</p></div>' +
        (w.done ? '<span class="pill ' + (w.checked ? 'ok">선생님 확인' : 'ok">제출 완료') + '</span>' : '<button class="btn sm" type="button" data-hw="' + esc(w.id) + '">제출하기</button>') + '</div>' +
        (w.done ? '<button class="linkbtn" type="button" data-hw="' + esc(w.id) + '">사진 더 올리기</button>' : '') +
        '<div class="upbox" data-box="' + esc(w.id) + '"></div></div>';
    });
    h += '</div>';
    $('#panel').innerHTML = h;
    UI.all('#panel [data-hw]').forEach(function (b) { b.onclick = function () { openUpload(b.getAttribute('data-hw')); }; });
  }

  function compress(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        res(cv.toDataURL('image/jpeg', 0.82).split(',')[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('사진을 읽지 못했어요: ' + file.name)); };
      img.src = url;
    });
  }

  function openUpload(hwId) {
    var c = view.classes[cur], w = c.hw.filter(function (x) { return x.id === hwId; })[0];
    UI.all('#panel .upbox').forEach(function (b) { b.innerHTML = ''; });
    var box = $('#panel [data-box="' + hwId + '"]');
    box.innerHTML = '<div class="up"><label for="ph">문제집 쪽 사진 (한 쪽에 한 장씩, 문항 번호가 보이게)</label>' +
      '<input id="ph" type="file" accept="image/*" multiple><div id="th" class="thumbs"></div>' +
      '<label for="cnt">채점해 본 맞은 개수' + (w.total ? ' (' + w.total + '문 중)' : '') + '</label><input id="cnt" type="number" inputmode="numeric" min="0"' + (w.total ? ' max="' + w.total + '"' : '') + '>' +
      '<button id="send" class="btn block" type="button">제출하기</button><div class="bar" hidden><i></i></div><p id="upMsg" class="msg" role="status"></p></div>';
    var files = [];
    $('#ph').onchange = function (e) {
      files = Array.prototype.slice.call(e.target.files);
      $('#th').innerHTML = '';
      files.forEach(function (f) { var im = document.createElement('img'); im.alt = '고른 사진'; im.src = URL.createObjectURL(f); $('#th').appendChild(im); });
    };
    $('#send').onclick = function () {
      var msg = $('#upMsg'), btn = $('#send'), bar = box.querySelector('.bar'), fill = bar.querySelector('i');
      if (!files.length) { msg.className = 'msg err'; msg.textContent = '사진을 골라 주세요.'; return; }
      if ($('#cnt').value === '' && !w.done) { msg.className = 'msg err'; msg.textContent = '맞은 개수를 적어 주세요.'; return; }
      setBusy(btn, true, '올리는 중…'); bar.hidden = false; msg.className = 'msg'; msg.textContent = '';
      var start = (w.photos || 0) + 1, i = 0, warns = [];
      function next() {
        if (i >= files.length) {
          return Api.call('hwFinish', { code: code, hw: hwId, count: $('#cnt').value }).then(function (r) {
            setBusy(btn, false, '제출하기');
            if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error; return; }
            show(r.data);
            if (warns.length) {   // AI 사진 확인에서 걸린 것: 제출은 됐고, 다시 찍어 올리라고 안내
              var b2 = $('#panel [data-box="' + hwId + '"]');
              if (b2) b2.innerHTML = '<div class="warnbox" role="alert"><b>사진을 다시 확인해 주세요</b><ul>' +
                warns.map(function (x) { return '<li>' + x.n + '번째 사진: ' + UI.esc(x.msg) + '</li>'; }).join('') +
                '</ul><p>제출은 됐어요. 고쳐서 다시 찍은 사진을 「사진 더 올리기」로 올려 주세요. 선생님도 확인할 거예요.</p></div>';
            }
          });
        }
        msg.textContent = (i + 1) + ' / ' + files.length + '장 올리는 중';
        return compress(files[i]).then(function (b64) {
          return Api.call('hwPhoto', { code: code, hw: hwId, order: start + i, mime: 'image/jpeg', b64: b64 });
        }).then(function (r) {
          if (!r.ok) throw new Error(r.error);
          if (r.data && r.data.check && !r.data.check.ok) warns.push({ n: i + 1, msg: r.data.check.msg });
          i++; fill.style.width = Math.round(i / files.length * 100) + '%';
          return next();
        });
      }
      next().catch(function (e) {
        setBusy(btn, false, '다시 제출하기');
        msg.className = 'msg err';
        msg.textContent = (e.message || '올리지 못했어요.') + ' ' + i + '장까지는 저장됐어요. 나머지를 다시 골라 제출해 주세요.';
      });
    };
  }

  $('#go').onclick = function () { login($('#sid').value); };
  $('#sid').addEventListener('keydown', function (e) { if (e.key === 'Enter') login($('#sid').value); });
  $('#out').onclick = function () { UI.store.del('seiseki.code'); view = null; code = ''; cur = 0; month = ''; $('#app').hidden = true; $('#acts').hidden = true; $('#login').hidden = false; $('#sid').value = ''; };
  $('#refresh').onclick = function () { if (code) login(code); };

  var saved = UI.store.get('seiseki.code');
  if (saved) { $('#remember').checked = true; $('#sid').value = Core.fmtCode(saved); login(saved); }
})();
