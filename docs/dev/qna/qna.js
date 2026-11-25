/* 허브 안 「QnA」 탭 (2026-11-24) — 학생용 HubQna, 강사용 HubQnaAdmin. 전부 네이티브(iframe 없음), CSS 는 qna.css (전부 .qna 아래).
 *
 *   HubQna.mount(rootEl, { session })        학생: session.call(action, payload) 로 qnaList·qnaAsk·qnaPhoto·qnaDelete
 *   HubQna.unmount()
 *   HubQnaAdmin.mount(rootEl, { session, onPending(n) })   강사: session.adminCall(...) 로 qnaAdminList·qnaAnswer·qnaAdminDelete·qnaAdminPhoto
 *   HubQnaAdmin.unmount()
 *   HubQnaAdmin.pending                      마지막으로 안 대기 건수(숫자, 아직 모르면 null)
 *   HubQnaAdmin.fetchPending(session)        → Promise<number>  탭을 열기 전에 뱃지만 알고 싶을 때(qnaAdminList {status:'대기'})
 *   HubQnaAdmin.refresh()                    목록 새로 불러오기
 *
 * session = HubSession(hub-session.js) 모양. 응답은 {ok:true,data} | {ok:false,error}. 오류 문구는 그대로 보여 줌.
 * 허브가 HubMascots(assets/mascots.js)를 불러 두었으면 3D 캐릭터를 쓰고, 없으면 캐릭터 없이 글자만 보임.
 * 학생에게는 다른 학생의 실제 이름·번호를 절대 안 보임(서버가 가린 who 만 씀). */
(function () {
  'use strict';

  var SUBJECTS = ['정치', '경제', '현대사회', '지리', '역사', '기타'];
  var SJ_COLOR = { '정치': '#FC5230', '경제': '#5A6FD6', '현대사회': '#2E9ED8', '지리': '#5F9467', '역사': '#D99A00', '기타': '#8C87AD' };
  var MAXP = 3, MAXB = 3 * 1024 * 1024, MAX_TITLE = 80, MAX_BODY = 2000, MAX_ANSWER = 3000;
  var uid = 0;

  /* ---------- 작은 도우미 ---------- */
  function $(s, r) { return r.querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call(r.querySelectorAll(s)); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /** 'YYYY-MM-DD HH:MM' → 「11/24 15:30」 */
  function fmtAt(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/.exec(String(s || ''));
    return m ? (+m[2]) + '/' + (+m[3]) + (m[4] ? ' ' + m[4] : '') : '';
  }
  function fmtDay(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? (+m[2]) + '/' + (+m[3]) : ''; }
  function mascot(id, size, cls) { try { return window.HubMascots ? window.HubMascots.svg(id, size, cls) : ''; } catch (e) { return ''; } }
  function ensureMascots() { try { if (window.HubMascots) window.HubMascots.mount(); } catch (e) { /* 캐릭터 없이 */ } }
  function errText(r) { return (r && r.error) || (r && r.needLogin ? '다시 로그인해 주세요.' : '잠시 뒤에 다시 해 주세요.'); }
  /** 서버 호출: 던지거나 이상한 응답이어도 항상 {ok,…} 로 */
  function safeCall(fn, action, payload) {
    var p;
    try { p = fn(action, payload || {}); } catch (e) { return Promise.resolve({ ok: false, error: '인터넷 연결을 확인해 주세요.' }); }
    return Promise.resolve(p).then(function (r) { return r && typeof r === 'object' ? r : { ok: false, error: '서버 응답이 올바르지 않아요.' }; }, function () { return { ok: false, error: '인터넷 연결을 확인해 주세요.' }; });
  }
  function sjChip(s) { return '<span class="q-sj" style="--c:' + (SJ_COLOR[s] || SJ_COLOR['기타']) + '">' + esc(s || '기타') + '</span>'; }
  var CHEV = '<svg class="q-chev" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------- 오버레이(질문 시트·사진 크게 보기): body 에 붙임 — 허브 칸의 스크롤·transform 에 안 갇히게 ---------- */
  var overlays = [];
  function onKey(e) {
    if (e.key !== 'Escape' || !overlays.length) return;
    var t = overlays[overlays.length - 1];
    if (t._esc) t._esc(); else removeOverlay(t);
  }
  function addOverlay(ov) {
    ov._prev = document.activeElement;
    document.body.appendChild(ov); overlays.push(ov);
    if (overlays.length === 1) document.addEventListener('keydown', onKey);
  }
  function removeOverlay(ov) {
    var i = overlays.indexOf(ov); if (i < 0) return;
    overlays.splice(i, 1);
    if (ov._off) ov._off();
    if (ov.parentNode) ov.parentNode.removeChild(ov);
    if (!overlays.length) document.removeEventListener('keydown', onKey);
    try { if (ov._prev && ov._prev.focus && document.contains(ov._prev)) ov._prev.focus(); } catch (e) { /* */ }
  }
  /** 키보드가 올라오면 시트가 보이는 영역 안에 있도록 (visualViewport) */
  function fitOverlay(ov) {
    var vv = window.visualViewport; if (!vv) return;
    var f = function () { ov.style.top = vv.offsetTop + 'px'; ov.style.height = vv.height + 'px'; ov.style.bottom = 'auto'; };
    f(); vv.addEventListener('resize', f); vv.addEventListener('scroll', f);
    ov._off = function () { vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f); };
  }
  function lightbox(src) {
    var o = document.createElement('div');
    o.className = 'qna qna-ov q-lb'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', '사진 크게 보기');
    var im = new Image(); im.alt = '크게 본 사진'; im.src = src;
    var x = document.createElement('button'); x.type = 'button'; x.className = 'q-lbx'; x.textContent = '닫기';
    o.appendChild(im); o.appendChild(x);
    o.addEventListener('click', function () { removeOverlay(o); });
    addOverlay(o); x.focus();
  }

  /* ---------- 사진: 줄이기(긴 변 1600px, JPEG 0.8, 3MB 이하) ---------- */
  function compress(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var w0 = img.naturalWidth, h0 = img.naturalHeight;
        if (!w0 || !h0) { URL.revokeObjectURL(url); rej(new Error('사진을 읽지 못했어요.')); return; }
        var scale = Math.min(1, 1600 / Math.max(w0, h0)), q = 0.8;
        for (var tries = 0; tries < 8; tries++) {
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w0 * scale)); cv.height = Math.max(1, Math.round(h0 * scale));
          var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
          var out = cv.toDataURL('image/jpeg', q), b64 = out.split(',')[1] || '';
          if (b64.indexOf('/9j/') === 0 && b64.length * 0.75 <= MAXB) { URL.revokeObjectURL(url); res({ b64: b64, url: out }); return; }
          if (q > 0.55) q -= 0.1; else scale *= 0.8;
        }
        URL.revokeObjectURL(url); rej(new Error('사진이 너무 커서 줄이지 못했어요.'));
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('이 사진은 읽을 수 없어요. 다른 사진을 골라 주세요.')); };
      img.src = url;
    });
  }

  /** 사진 고르기 칸: 카메라·앨범 두 버튼, 미리보기·삭제, 최대 max 장. 돌려주는 items 는 [{b64,url}] */
  function photoPicker(host, max, onChange) {
    var id = 'qph' + (++uid), items = [], pending = 0, disabled = false, msgT = 0, mx = function () { return typeof max === 'function' ? max() : max; };
    host.innerHTML =
      '<div class="q-thumbs"></div>' +
      '<div class="q-pkb"><label class="q-btn q-soft q-sm" for="' + id + 'c">📷 사진 찍기</label><input id="' + id + 'c" class="q-vh" type="file" accept="image/*" capture="environment">' +
      '<label class="q-btn q-soft q-sm" for="' + id + 'a">🖼 앨범에서 고르기</label><input id="' + id + 'a" class="q-vh" type="file" accept="image/*" multiple>' +
      '<span class="q-cnt"></span></div><p class="q-msg" role="status"></p>';
    var th = $('.q-thumbs', host), cnt = $('.q-cnt', host), msg = $('.q-msg', host), ins = $$('input', host), lbs = $$('label', host);
    function say(t, bad) { msg.textContent = t || ''; msg.className = 'q-msg' + (bad ? ' err' : ''); clearTimeout(msgT); if (t && bad) msgT = setTimeout(function () { say(''); }, 5000); }
    function render() {
      th.innerHTML = items.map(function (it, i) { return '<span class="q-th"><img alt="고른 사진 ' + (i + 1) + '" src="' + it.url + '"><button type="button" class="q-x" data-rm="' + i + '" aria-label="사진 ' + (i + 1) + ' 빼기">×</button></span>'; }).join('') +
        (pending ? '<span class="q-th q-wait" aria-label="사진 줄이는 중"></span>' : '');
      th.hidden = !items.length && !pending;
      cnt.textContent = items.length + '/' + mx();
      var full = items.length + pending >= mx();
      lbs.forEach(function (l) { l.classList.toggle('off', full || disabled); l.setAttribute('aria-disabled', full || disabled ? 'true' : 'false'); });
      ins.forEach(function (i) { i.disabled = full || disabled; });
      $$('[data-rm]', th).forEach(function (b) { b.disabled = disabled; });
    }
    th.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rm]'); if (!b || disabled) return;
      items.splice(+b.getAttribute('data-rm'), 1); say(''); render(); if (onChange) onChange();
    });
    ins.forEach(function (inp) {
      inp.addEventListener('change', function () {
        var files = Array.prototype.slice.call(inp.files || []); inp.value = ''; say('');
        var chain = Promise.resolve();
        files.forEach(function (f) {
          chain = chain.then(function () {
            if (items.length + pending >= mx()) { say('사진은 ' + MAXP + '장까지 올릴 수 있어요.', true); return; }
            pending++; render();
            return compress(f).then(function (c) { pending--; items.push(c); render(); if (onChange) onChange(); }, function (er) { pending--; render(); say(er.message, true); });
          });
        });
      });
    });
    render();
    return {
      items: items,
      clear: function () { items.length = 0; say(''); render(); },
      setDisabled: function (d) { disabled = !!d; render(); },
      refresh: render
    };
  }

  /** 서버에 있는 사진(파일ID)을 필요할 때 불러와 메모리에 둠. 실패는 기억하지 않아 다시 눌러 볼 수 있음 */
  function photoLoader(fetcher) {
    var cache = {};
    return function (id) {
      if (cache[id]) return cache[id];
      var p = fetcher(id).then(function (r) {
        if (!r.ok || !r.data || !r.data.b64) throw new Error(errText(r));
        var mime = /^image\/[a-z0-9.+-]+$/i.test(r.data.mime || '') ? r.data.mime : 'image/jpeg';
        return 'data:' + mime + ';base64,' + r.data.b64;
      });
      cache[id] = p;
      p.catch(function () { delete cache[id]; });
      return p;
    };
  }
  /** 사진 칸(썸네일 줄): load() 를 부르면(펼칠 때) 그때 사진을 가져옴. 눌러서 크게 보기 */
  function photoBox(host, ids, load, onToggle) {   // onToggle(파일ID, 뺄지) 를 주면 사진마다 「×」(빼기) 버튼
    ids = ids || [];
    host.hidden = !ids.length;
    host.innerHTML = ids.map(function (_, i) {
      var b = '<button type="button" class="q-ph" aria-label="사진 ' + (i + 1) + ' 크게 보기"><span class="q-phs"></span></button>';
      return onToggle ? '<span class="q-phw">' + b + '<button type="button" class="q-x" data-rm="' + i + '" aria-pressed="false" aria-label="사진 ' + (i + 1) + ' 빼기">×</button></span>' : b;
    }).join('');
    if (onToggle) $$('[data-rm]', host).forEach(function (x) {
      x.addEventListener('click', function () {
        var on = x.getAttribute('aria-pressed') !== 'true', n = +x.getAttribute('data-rm');
        x.setAttribute('aria-pressed', on ? 'true' : 'false'); x.textContent = on ? '↺' : '×';
        x.setAttribute('aria-label', '사진 ' + (n + 1) + (on ? ' 빼기 취소' : ' 빼기'));
        x.parentNode.classList.toggle('gone', on); onToggle(ids[n], on);
      });
    });
    var btns = $$('.q-ph', host), srcs = [], started = false;
    function one(i) {
      var b = btns[i]; b.classList.remove('err'); b.innerHTML = '<span class="q-phs"></span>';
      load(ids[i]).then(function (src) {
        srcs[i] = src; var im = new Image(); im.alt = '첨부 사진 ' + (i + 1); im.src = src; b.innerHTML = ''; b.appendChild(im);
      }, function () { srcs[i] = ''; b.classList.add('err'); b.innerHTML = '<span class="q-phe">불러오지 못했어요<br>눌러서 다시</span>'; });
    }
    btns.forEach(function (b, i) { b.addEventListener('click', function () { if (srcs[i]) lightbox(srcs[i]); else if (b.classList.contains('err')) one(i); }); });
    return { load: function () { if (started) return; started = true; ids.forEach(function (_, k) { one(k); }); } };
  }

  /** 공개 여부 스위치 */
  function switchHtml(id, on, title, onTxt, offTxt) {
    return '<button type="button" class="q-sw" id="' + id + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" data-on="' + esc(onTxt) + '" data-off="' + esc(offTxt) + '">' +
      '<span class="q-swt"><b>' + esc(title) + '</b><small>' + esc(on ? onTxt : offTxt) + '</small></span><i class="q-knob" aria-hidden="true"></i></button>';
  }
  function bindSwitch(btn, onChange) {
    btn.addEventListener('click', function () {
      var on = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.querySelector('small').textContent = btn.getAttribute(on ? 'data-on' : 'data-off');
      if (onChange) onChange(on);
    });
  }
  function toast(I, text, bad) {
    var t = $('.q-toast', I.root); if (!t) return;
    t.textContent = text; t.className = 'q-toast' + (bad ? ' err' : ''); t.hidden = false;
    clearTimeout(I.toastT); I.toastT = setTimeout(function () { t.hidden = true; }, 4500);
  }
  var SKEL = '<div class="q-skel"><i></i><i></i><i></i></div>';
  function stateBlock(mas, id, title, sub, btn) {
    return '<div class="q-state">' + mascot(id, 84, mas) + '<b>' + esc(title) + '</b>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + (btn || '') + '</div>';
  }

  /* =====================================================================
   *  학생용 — HubQna
   * ===================================================================== */
  var ST = null;

  function stuShell() {
    return '<header class="q-head"><div><h1 class="q-title">QnA</h1><p class="q-subt">궁금한 건 선생님께 물어보세요</p></div><button type="button" class="q-link" data-act="reload">새로고침</button></header>' +
      '<button type="button" class="q-hero" data-act="ask">' + mascot('m-pencil-happy', 76, 'hm-float') + '<span class="q-herot"><b>질문하기</b><small>모르는 문제를 사진으로 찍어 물어봐요</small></span><span class="q-go" aria-hidden="true">›</span></button>' +
      '<div class="q-toast" role="status" aria-live="polite" hidden></div>' +
      '<div class="q-seg" role="tablist" aria-label="질문 보기"><button type="button" role="tab" data-t="mine">내 질문 <em></em></button><button type="button" role="tab" data-t="pub">모두의 질문 <em></em></button></div>' +
      '<div class="q-chips" data-chips hidden></div>' +
      '<div class="q-list" data-list></div>';
  }

  function stuMount(rootEl, o) {
    if (!rootEl) throw new Error('HubQna.mount: rootEl 이 없어요');
    stuUnmount();
    o = o || {};
    ensureMascots();
    var I = { alive: true, root: rootEl, session: o.session, tab: 'mine', filter: '', data: null, loading: true, err: '', open: {}, toastT: 0, boxes: {}, sheet: null };
    ST = I;
    I.loader = photoLoader(function (id) { return safeCall(function (a, p) { return I.session.call(a, p); }, 'qnaPhoto', { id: id }); });
    rootEl.classList.add('qna'); rootEl.innerHTML = stuShell();
    I.onClick = function (e) { stuClick(I, e); };
    rootEl.addEventListener('click', I.onClick);
    stuRender(I); stuLoad(I);
  }
  function stuUnmount() {
    var I = ST; if (!I) return;
    I.alive = false; clearTimeout(I.toastT);
    I.root.removeEventListener('click', I.onClick);
    if (I.sheet) removeOverlay(I.sheet);
    overlays.slice().forEach(removeOverlay);
    I.root.innerHTML = ''; I.root.classList.remove('qna');
    ST = null;
  }

  function stuLoad(I, quiet) {
    if (!quiet || !I.data) { I.loading = !I.data; stuRender(I); }
    return safeCall(function (a, p) { return I.session.call(a, p); }, 'qnaList', {}).then(function (r) {
      if (!I.alive) return;
      I.loading = false;
      if (r.ok && r.data) { I.data = { mine: r.data.mine || [], pub: r.data.pub || [] }; I.err = ''; }
      else if (I.data) toast(I, errText(r), true);   // 이미 그려 둔 화면은 그대로 두고 알림만
      else I.err = errText(r);
      stuRender(I);
    });
  }

  function stuQ(I, key) { var p = key.split(':'); var arr = I.data ? I.data[p[0]] : []; for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === p.slice(1).join(':')) return arr[i]; return null; }
  function delBtn(id) { return '<button type="button" class="q-btn q-soft q-sm q-danger" data-act="del" data-id="' + esc(id) + '">질문 지우기</button>'; }

  function stuCard(I, q, kind) {
    var key = kind + ':' + q.id, open = !!I.open[key], answered = q.status === '답변';
    var top = sjChip(q.subject);
    if (kind === 'mine') top += '<span class="q-pill ' + (answered ? 'ok' : 'wait') + '">' + (answered ? '답변 완료' : '답변 대기') + '</span><span class="q-pill ' + (q.public ? 'pub' : 'priv') + '">' + (q.public ? '공개' : '🔒 비공개') + '</span>';
    else top += '<span class="q-who">' + esc(q.mine ? '내 질문' : (q.who || '친구')) + '</span>';
    var meta = kind === 'mine' ? esc(fmtAt(q.at)) : esc(fmtDay(q.answerAt || q.at)) + ' 답변';
    var ans = answered
      ? '<div class="q-ans"><span class="q-ansl">' + mascot('m-check-happy', 22, '') + ' 선생님 답변' + (q.answerAt ? '<small>' + esc(fmtAt(q.answerAt)) + '</small>' : '') + '</span><p class="q-text">' + esc(q.answer) + '</p><div class="q-phs-row" data-ph="a"></div></div>'
      : '<div class="q-ans wait"><p>' + mascot('m-hourglass', 22, '') + ' 선생님이 확인하는 중이에요. 답변이 달리면 여기에 보여요.</p></div>';
    return '<article class="q-card' + (open ? ' open' : '') + '" data-key="' + esc(key) + '">' +
      '<button type="button" class="q-ch" aria-expanded="' + open + '"><span class="q-top">' + top + '</span><b class="q-t">' + esc(q.title) + '</b><span class="q-m">' + meta + '</span>' + CHEV + '</button>' +
      '<div class="q-cb"' + (open ? '' : ' hidden') + '><p class="q-text">' + esc(q.body) + '</p><div class="q-phs-row" data-ph="q"></div>' + ans +
      (kind === 'mine' && !answered ? '<div class="q-delbox" data-delbox>' + delBtn(q.id) + '</div>' : '') + '</div></article>';
  }

  function stuRender(I) {
    if (!I.alive) return;
    var R = I.root, d = I.data;
    $$('[data-t]', R).forEach(function (b) {
      var on = b.getAttribute('data-t') === I.tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      var n = d ? d[b.getAttribute('data-t')].length : 0; $('em', b).textContent = d && n ? n : '';
    });
    var chips = $('[data-chips]', R);
    chips.hidden = I.tab !== 'pub' || !d;
    if (!chips.hidden) chips.innerHTML = ['전체'].concat(SUBJECTS).map(function (s) { var v = s === '전체' ? '' : s; return '<button type="button" class="q-chip" data-f="' + esc(v) + '" aria-pressed="' + (I.filter === v) + '">' + esc(s) + '</button>'; }).join('');
    var list = $('[data-list]', R), h = '', arr = [];
    if (I.loading) h = SKEL + '<p class="q-loadmsg">' + mascot('m-hourglass', 28, 'hm-wiggle') + ' 불러오는 중…</p>';
    else if (!d) h = stateBlock('', 'm-cloud', '불러오지 못했어요', I.err, '<button type="button" class="q-btn" data-act="reload">다시 불러오기</button>');
    else {
      arr = I.tab === 'mine' ? d.mine : d.pub.filter(function (q) { return !I.filter || q.subject === I.filter; });
      if (!arr.length) h = I.tab === 'mine'
        ? stateBlock('hm-float', 'm-cactus', '아직 질문이 없어요', '모르는 게 생기면 위의 「질문하기」로 물어보세요.')
        : stateBlock('hm-float', 'm-cactus', I.filter ? I.filter + ' 질문이 아직 없어요' : '아직 공개된 질문이 없어요', '선생님이 답한 공개 질문이 여기에 모여요.');
      else h = arr.map(function (q) { return stuCard(I, q, I.tab); }).join('');
    }
    list.innerHTML = h; I.boxes = {};
    $$('.q-card', list).forEach(function (el) {
      var key = el.getAttribute('data-key'), q = stuQ(I, key); if (!q) return;
      var bs = [photoBox($('[data-ph="q"]', el), q.photos, I.loader)], ap = $('[data-ph="a"]', el);
      if (ap) bs.push(photoBox(ap, q.answerPhotos, I.loader));
      I.boxes[key] = bs;
      if (I.open[key]) bs.forEach(function (b) { b.load(); });
    });
  }

  function stuClick(I, e) {
    var t = e.target.closest('[data-act],[data-t],[data-f],.q-ch'); if (!t || !I.root.contains(t)) return;
    var act = t.getAttribute('data-act');
    if (t.hasAttribute('data-t')) { I.tab = t.getAttribute('data-t'); stuRender(I); return; }
    if (t.hasAttribute('data-f')) { I.filter = t.getAttribute('data-f'); stuRender(I); return; }
    if (t.classList.contains('q-ch')) {
      var card = t.closest('.q-card'), key = card.getAttribute('data-key'), on = !I.open[key];
      I.open[key] = on; card.classList.toggle('open', on); t.setAttribute('aria-expanded', on ? 'true' : 'false'); $('.q-cb', card).hidden = !on;
      if (on) (I.boxes[key] || []).forEach(function (b) { b.load(); });
      return;
    }
    if (act === 'reload') { stuLoad(I, true); return; }
    if (act === 'ask') { stuSheet(I); return; }
    var box = t.closest('[data-delbox]'), id = t.getAttribute('data-id') || (box && box.getAttribute('data-id'));
    if (act === 'del' && box) { box.setAttribute('data-id', id); box.innerHTML = '<span class="q-delq">정말 지울까요?</span><button type="button" class="q-btn q-sm q-danger2" data-act="delyes">지우기</button><button type="button" class="q-btn q-soft q-sm" data-act="delno">취소</button>'; return; }
    if (act === 'delno' && box) { box.innerHTML = delBtn(id); return; }
    if (act === 'delyes' && box) {
      $$('button', box).forEach(function (b) { b.disabled = true; });
      safeCall(function (a, p) { return I.session.call(a, p); }, 'qnaDelete', { id: id }).then(function (r) {
        if (!I.alive) return;
        if (r.ok) { toast(I, '질문을 지웠어요.'); stuLoad(I, true); }
        else { box.innerHTML = '<span class="q-delq err">' + esc(errText(r)) + '</span>' + delBtn(id); }
      });
    }
  }

  /** 질문하기 시트 */
  function stuSheet(I) {
    if (I.sheet) return;
    var ov = document.createElement('div'), F = { subject: '', pub: false, mode: 'edit', err: '' }, pk;
    ov.className = 'qna qna-ov q-sheet-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', '질문하기');
    ov.innerHTML =
      '<div class="q-sheet"><div class="q-grip" aria-hidden="true"></div>' +
      '<div class="q-sh"><h2>' + mascot('m-pencil', 34, '') + ' 질문하기</h2><button type="button" class="q-link" data-s="close">닫기</button></div>' +
      '<div class="q-sb">' +
      '<label class="q-lb">과목</label><div class="q-chips tight">' + SUBJECTS.map(function (s) { return '<button type="button" class="q-chip" data-s="sj" data-v="' + esc(s) + '" aria-pressed="false"><i class="q-dot" style="background:' + SJ_COLOR[s] + '"></i>' + esc(s) + '</button>'; }).join('') + '</div>' +
      '<label class="q-lb" for="q-ti">제목</label><input id="q-ti" class="q-in" type="text" maxlength="' + MAX_TITLE + '" placeholder="어떤 게 궁금해요?" autocomplete="off" enterkeyhint="next">' +
      '<label class="q-lb" for="q-bo">내용 <span class="q-opt" data-cnt>0/' + MAX_BODY + '</span></label><textarea id="q-bo" class="q-in" rows="6" maxlength="' + MAX_BODY + '" placeholder="문제 번호, 헷갈리는 부분을 적어 주세요."></textarea>' +
      '<label class="q-lb">사진 <span class="q-opt">(선택, 최대 ' + MAXP + '장)</span></label><div class="q-pk"></div>' +
      '<label class="q-lb">공개 설정</label>' + switchHtml('q-pub', false, '다른 친구도 볼 수 있게 공개', '답변이 달리면 다른 친구도 볼 수 있어요', '선생님만 봐요') +
      '<p class="q-note">공개해도 내 이름은 가려져요. (예: 김○○)</p>' +
      '</div><div class="q-foot"></div></div>';
    addOverlay(ov); fitOverlay(ov); I.sheet = ov;
    var ti = $('#q-ti', ov), bo = $('#q-bo', ov), foot = $('.q-foot', ov), body = $('.q-sb', ov);
    pk = photoPicker($('.q-pk', ov), MAXP);
    bindSwitch($('#q-pub', ov), function (on) { F.pub = on; });
    function clearErr() { if (F.err && F.mode === 'edit') { F.err = ''; drawFoot(); } }
    bo.addEventListener('input', function () { $('[data-cnt]', ov).textContent = bo.value.length + '/' + MAX_BODY; clearErr(); });
    ti.addEventListener('input', clearErr);
    function dirty() { return !!(F.subject || ti.value.trim() || bo.value.trim() || pk.items.length); }
    function close() { removeOverlay(ov); I.sheet = null; }
    function lock(on) { ov.classList.toggle('busy', on); [ti, bo].forEach(function (x) { x.disabled = on; }); $$('.q-chip,.q-sw', ov).forEach(function (x) { x.disabled = on; }); pk.setDisabled(on); }
    function drawFoot() {
      var h = '';
      if (F.err) h += '<p class="q-msg err" role="alert">' + esc(F.err) + '</p>';
      if (F.mode === 'edit') h += '<button type="button" class="q-btn q-block" data-s="send">질문 올리기</button>';
      else if (F.mode === 'confirm') h += '<p class="q-cf"><b>' + (F.pub ? '공개로' : '비공개로') + ' 올릴까요?</b> ' + (F.pub ? '답변이 달리면 다른 친구도 볼 수 있어요 (이름은 가려져요).' : '선생님만 볼 수 있어요.') + ' 올린 뒤에는 고칠 수 없어요.</p><div class="q-two"><button type="button" class="q-btn q-soft" data-s="back">다시 볼래요</button><button type="button" class="q-btn" data-s="go">올리기</button></div>';
      else if (F.mode === 'sending') h += '<p class="q-sending">' + mascot('m-hourglass', 40, 'hm-wiggle') + ' 올리는 중이에요…</p>';
      else if (F.mode === 'discard') h += '<p class="q-cf"><b>쓰던 내용이 사라져요.</b> 그래도 닫을까요?</p><div class="q-two"><button type="button" class="q-btn q-soft" data-s="keep">계속 쓸래요</button><button type="button" class="q-btn q-danger2" data-s="drop">닫기</button></div>';
      foot.innerHTML = h;
    }
    function tryClose() { if (F.mode === 'sending') return; if (dirty()) { F.mode = 'discard'; F.err = ''; drawFoot(); } else close(); }
    ov._esc = tryClose;
    ov.addEventListener('click', function (e) {
      if (e.target === ov) { if (!dirty()) tryClose(); return; }
      var b = e.target.closest('[data-s]'); if (!b) return;
      var s = b.getAttribute('data-s');
      if (s === 'close') tryClose();
      else if (s === 'sj') { F.subject = b.getAttribute('data-v'); clearErr(); $$('[data-s="sj"]', ov).forEach(function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); }); }
      else if (s === 'send') {
        var t = ti.value.trim(), c = bo.value.trim();
        F.err = !F.subject ? '과목을 골라 주세요.' : !t ? '제목을 적어 주세요.' : !c ? '내용을 적어 주세요.' : '';
        if (F.err) { drawFoot(); if (!F.subject) body.scrollTop = 0; else (!t ? ti : bo).focus(); return; }
        F.mode = 'confirm'; drawFoot();
      }
      else if (s === 'back') { F.mode = 'edit'; F.err = ''; drawFoot(); }
      else if (s === 'keep') { F.mode = 'edit'; drawFoot(); }
      else if (s === 'drop') close();
      else if (s === 'go') {
        F.mode = 'sending'; F.err = ''; lock(true); drawFoot();
        safeCall(function (a, p) { return I.session.call(a, p); }, 'qnaAsk', { subject: F.subject, title: ti.value.trim(), body: bo.value.trim(), public: F.pub, photos: pk.items.map(function (x) { return { b64: x.b64 }; }) }).then(function (r) {
          if (!I.alive) return;
          if (!r.ok) { F.mode = 'edit'; F.err = errText(r); lock(false); drawFoot(); return; }
          close();
          I.tab = 'mine'; if (r.data && r.data.id) I.open['mine:' + r.data.id] = true;
          toast(I, '질문을 올렸어요! 선생님 답변이 달리면 여기에서 볼 수 있어요.');
          stuLoad(I, true);
        });
      }
    });
    drawFoot();
    if (window.matchMedia && matchMedia('(pointer:fine)').matches) ti.focus();
  }

  /* =====================================================================
   *  강사용 — HubQnaAdmin
   * ===================================================================== */
  var AD = null, adPending = null, adOnPending = null;

  function pick(q, keys) { for (var i = 0; i < keys.length; i++) if (q[keys[i]] !== undefined && q[keys[i]] !== null && q[keys[i]] !== '') return q[keys[i]]; return ''; }
  function adName(q) { return String(pick(q, ['name', 'realName', 'studentName', '이름'])); }
  function adCode(q) { return String(pick(q, ['code', 'num', 'sid', 'no', '번호'])); }
  function adCls(q) { var c = Array.isArray(q.classes) ? q.classes.join(' · ') : pick(q, ['cls', 'class', 'className']); return String(c || ''); }
  function setPending(n) {
    adPending = n; API_ADMIN.pending = n;
    if (typeof adOnPending === 'function') { try { adOnPending(n); } catch (e) { /* */ } }
  }

  function adShell() {
    return '<header class="q-head"><div><h1 class="q-title">QnA 관리</h1><p class="q-subt" data-sub>질문을 불러오는 중…</p></div><button type="button" class="q-link" data-act="reload">새로고침</button></header>' +
      '<div class="q-toast" role="status" aria-live="polite" hidden></div>' +
      '<div class="q-fbar"><div class="q-seg" role="tablist" aria-label="상태"><button type="button" role="tab" data-st="대기">대기 <em></em></button><button type="button" role="tab" data-st="답변">답변 <em></em></button><button type="button" role="tab" data-st="">전체 <em></em></button></div>' +
      '<div class="q-chips" data-chips></div>' +
      '<input class="q-in q-search" type="search" data-search placeholder="제목·내용·이름·번호 검색" aria-label="검색" autocomplete="off"></div>' +
      '<div class="q-list" data-list></div>';
  }
  function adMount(rootEl, o) {
    if (!rootEl) throw new Error('HubQnaAdmin.mount: rootEl 이 없어요');
    adUnmount();
    o = o || {}; ensureMascots();
    adOnPending = o.onPending || null;
    var I = { alive: true, root: rootEl, session: o.session, st: '대기', sj: '', q: '', list: null, loading: true, err: '', open: {}, drafts: {}, cards: {}, toastT: 0 };
    AD = I;
    I.call = function (a, p) { return safeCall(function (x, y) { return I.session.adminCall(x, y); }, a, p); };
    I.loader = photoLoader(function (id) { return I.call('qnaAdminPhoto', { id: id }); });
    rootEl.classList.add('qna', 'qna-admin'); rootEl.innerHTML = adShell();
    I.onClick = function (e) { adClick(I, e); };
    I.onInput = function (e) { if (e.target.hasAttribute('data-search')) { I.q = e.target.value.trim().toLowerCase(); adDrawList(I); } };
    rootEl.addEventListener('click', I.onClick); rootEl.addEventListener('input', I.onInput);
    adRender(I); adLoad(I);
  }
  function adUnmount() {
    var I = AD; if (!I) return;
    I.alive = false; clearTimeout(I.toastT);
    I.root.removeEventListener('click', I.onClick); I.root.removeEventListener('input', I.onInput);
    overlays.slice().forEach(removeOverlay);
    I.root.innerHTML = ''; I.root.classList.remove('qna', 'qna-admin');
    AD = null; adOnPending = null;
  }
  function adLoad(I, quiet) {
    if (!I.list) { I.loading = true; adRender(I); }
    else if (!quiet) { adRender(I); }
    return I.call('qnaAdminList', {}).then(function (r) {
      if (!I.alive) return;
      I.loading = false;
      if (r.ok && Array.isArray(r.data)) { I.list = r.data; I.err = ''; setPending(r.data.filter(function (q) { return q.status === '대기'; }).length); }
      else if (r.ok && r.data && Array.isArray(r.data.list)) { I.list = r.data.list; I.err = ''; setPending(I.list.filter(function (q) { return q.status === '대기'; }).length); }
      else if (I.list) toast(I, errText(r), true);
      else I.err = r.ok ? '질문 목록 형식이 올바르지 않아요.' : errText(r);
      adBuildCards(I); adRender(I);
    });
  }
  function adById(I, id) { var a = I.list || []; for (var i = 0; i < a.length; i++) if (String(a[i].id) === String(id)) return a[i]; return null; }

  function adCardHtml(q, open) {
    var answered = q.status === '답변', nm = adName(q), cd = adCode(q), cl = adCls(q);
    var who = '<b class="q-nm">' + esc(nm || '(이름 없음)') + '</b>' + (cd ? ' <span class="q-code">번호 ' + esc(cd.slice(-4)) + '</span>' : '') + (cl ? ' · ' + esc(cl) : '') + ' · ' + esc(fmtAt(q.at));
    return '<article class="q-card q-ac' + (open ? ' open' : '') + (answered ? '' : ' pend') + '" data-id="' + esc(q.id) + '">' +
      '<button type="button" class="q-ch" aria-expanded="' + open + '"><span class="q-top">' + sjChip(q.subject) + '<span class="q-pill ' + (answered ? 'ok' : 'wait') + '">' + (answered ? '답변 완료' : '답변 대기') + '</span><span class="q-pill ' + (q.public ? 'pub' : 'priv') + '">' + (q.public ? '공개' : '🔒 비공개') + '</span></span>' +
      '<b class="q-t">' + esc(q.title) + '</b><span class="q-m">' + who + '</span>' + CHEV + '</button>' +
      '<div class="q-cb"' + (open ? '' : ' hidden') + '><p class="q-text">' + esc(q.body) + '</p><div class="q-phs-row" data-ph="q"></div>' +
      '<div class="q-aform"><label class="q-lb" for="q-an-' + esc(q.id) + '">' + (answered ? '선생님 답변 (수정할 수 있어요)' : '선생님 답변') + (q.answerAt ? ' <span class="q-opt">' + esc(fmtAt(q.answerAt)) + '</span>' : '') + '</label>' +
      '<textarea id="q-an-' + esc(q.id) + '" class="q-in" rows="5" maxlength="' + MAX_ANSWER + '" data-an placeholder="학생에게 보일 답변을 적어 주세요."></textarea>' +
      ((q.answerPhotos || []).length ? '<label class="q-lb">등록된 답변 사진 <span class="q-opt">(×로 빼기)</span></label><div class="q-phs-row" data-ph="a"></div>' : '<div hidden data-ph="a"></div>') +
      '<label class="q-lb">답변 사진 추가 <span class="q-opt">(선택, 최대 ' + MAXP + '장)</span></label><div class="q-pk" data-pk></div>' +
      switchHtml('q-ap-' + esc(q.id), !!q.public, '공개로 바꾸기', '공개 — 답변이 다른 학생에게도 보여요 (이름은 가려져요)', '비공개 — 질문한 학생만 봐요') +
      '<p class="q-msg" data-amsg role="status"></p>' +
      '<div class="q-arow"><button type="button" class="q-btn" data-act="save">' + (answered ? '답변 수정' : '답변 등록') + '</button><span class="q-sp"></span><span data-delbox>' + adDelBtn() + '</span></div></div></div></article>';
  }
  function adDelBtn() { return '<button type="button" class="q-btn q-soft q-sm q-danger" data-act="del">질문 삭제</button>'; }

  /** 카드는 목록을 불러올 때 한 번만 만들고, 필터를 바꿔도 그대로 붙였다 뗌 — 쓰던 답변·고른 사진이 안 사라지게 */
  function adBuildCards(I) {
    // 쓰던 글은 draft 에 이미 저장돼 있음(입력할 때마다)
    I.cards = {};
    (I.list || []).forEach(function (q) {
      var el = document.createElement('div'); el.innerHTML = adCardHtml(q, !!I.open[q.id]); el = el.firstChild;
      var removed = {}, pk = null;
      var kept = function () { return Math.max(0, (q.answerPhotos || []).length - Object.keys(removed).length); };
      var boxes = [photoBox($('[data-ph="q"]', el), q.photos, I.loader),
        photoBox($('[data-ph="a"]', el), q.answerPhotos, I.loader, function (fid, on) { if (on) removed[fid] = 1; else delete removed[fid]; if (pk) pk.refresh(); })];
      var an = $('[data-an]', el), dr = I.drafts[q.id], sw = $('.q-sw', el);
      pk = photoPicker($('[data-pk]', el), function () { return Math.max(0, MAXP - kept()); });
      an.value = dr && dr.text !== undefined ? dr.text : (q.answer || '');
      if (dr && dr.pub !== undefined && dr.pub !== !!q.public) { sw.setAttribute('aria-checked', dr.pub ? 'true' : 'false'); sw.querySelector('small').textContent = sw.getAttribute(dr.pub ? 'data-on' : 'data-off'); }
      an.addEventListener('input', function () { (I.drafts[q.id] = I.drafts[q.id] || {}).text = an.value; });
      bindSwitch(sw, function (on) { (I.drafts[q.id] = I.drafts[q.id] || {}).pub = on; });
      I.cards[q.id] = { el: el, boxes: boxes, an: an, sw: sw, pk: pk, removed: removed };
      if (I.open[q.id]) boxes.forEach(function (b) { b.load(); });
    });
  }

  function adFiltered(I) {
    var a = (I.list || []).filter(function (q) {
      if (I.st && q.status !== I.st) return false;
      if (I.sj && q.subject !== I.sj) return false;
      if (I.q) { var hay = [q.title, q.body, q.answer, adName(q), adCode(q), adCls(q)].join(' ').toLowerCase(); if (hay.indexOf(I.q) < 0) return false; }
      return true;
    });
    // 대기는 오래된 것부터, 답변은 최근 것부터. 대기가 위
    return a.sort(function (x, y) {
      var px = x.status === '대기' ? 0 : 1, py = y.status === '대기' ? 0 : 1;
      if (px !== py) return px - py;
      if (px === 0) return String(x.at).localeCompare(String(y.at));
      return String(y.answerAt || y.at).localeCompare(String(x.answerAt || x.at));
    });
  }
  function adRender(I) {
    if (!I.alive) return;
    var R = I.root, L = I.list || [];
    var cnt = { '대기': 0, '답변': 0, '': L.length };
    L.forEach(function (q) { if (cnt[q.status] !== undefined) cnt[q.status]++; });
    $$('[data-st]', R).forEach(function (b) { var v = b.getAttribute('data-st'); b.setAttribute('aria-selected', v === I.st ? 'true' : 'false'); $('em', b).textContent = I.list ? cnt[v] : ''; });
    $('[data-chips]', R).innerHTML = ['전체'].concat(SUBJECTS).map(function (s) { var v = s === '전체' ? '' : s; return '<button type="button" class="q-chip" data-sj="' + esc(v) + '" aria-pressed="' + (I.sj === v) + '">' + esc(s) + '</button>'; }).join('');
    $('[data-sub]', R).textContent = I.list ? (cnt['대기'] ? '답변을 기다리는 질문이 ' + cnt['대기'] + '건 있어요' : '답변을 기다리는 질문이 없어요') : '질문을 불러오는 중…';
    adDrawList(I);
  }
  function adDrawList(I) {
    var list = $('[data-list]', I.root);
    if (I.loading) { list.innerHTML = SKEL + '<p class="q-loadmsg">' + mascot('m-hourglass', 28, 'hm-wiggle') + ' 불러오는 중…</p>'; return; }
    if (!I.list) { list.innerHTML = stateBlock('', 'm-cloud', '불러오지 못했어요', I.err, '<button type="button" class="q-btn" data-act="reload">다시 불러오기</button>'); return; }
    var a = adFiltered(I);
    if (!a.length) { list.innerHTML = stateBlock('hm-float', 'm-cactus', I.q || I.sj || I.st ? '조건에 맞는 질문이 없어요' : '아직 질문이 없어요', I.st === '대기' && !I.q && !I.sj ? '답변을 기다리는 질문이 없어요. 👍' : ''); return; }
    list.innerHTML = '';
    a.forEach(function (q) { list.appendChild(I.cards[q.id].el); });
  }

  function adClick(I, e) {
    var t = e.target.closest('[data-act],[data-st],[data-sj],.q-ch'); if (!t || !I.root.contains(t)) return;
    var act = t.getAttribute('data-act');
    if (t.hasAttribute('data-st')) { I.st = t.getAttribute('data-st'); adRender(I); return; }
    if (t.hasAttribute('data-sj')) { I.sj = t.getAttribute('data-sj'); adRender(I); return; }
    if (act === 'reload') { adLoad(I, false); return; }
    var card = t.closest('.q-card'); if (!card) return;
    var id = card.getAttribute('data-id'), C = I.cards[id], q = adById(I, id); if (!C || !q) return;
    if (t.classList.contains('q-ch')) {
      var on = !I.open[id]; I.open[id] = on; card.classList.toggle('open', on); t.setAttribute('aria-expanded', on ? 'true' : 'false'); $('.q-cb', card).hidden = !on;
      if (on) C.boxes.forEach(function (b) { b.load(); });
      return;
    }
    var box = $('[data-delbox]', card), msg = $('[data-amsg]', card);
    if (act === 'del') { box.innerHTML = '<span class="q-delq">삭제하면 되돌릴 수 없어요.</span> <button type="button" class="q-btn q-sm q-danger2" data-act="delyes">삭제</button> <button type="button" class="q-btn q-soft q-sm" data-act="delno">취소</button>'; return; }
    if (act === 'delno') { box.innerHTML = adDelBtn(); return; }
    if (act === 'delyes') {
      $$('button', box).forEach(function (b) { b.disabled = true; });
      I.call('qnaAdminDelete', { id: id }).then(function (r) {
        if (!I.alive) return;
        if (r.ok) { delete I.drafts[id]; delete I.open[id]; toast(I, '질문을 삭제했어요.'); adLoad(I, true); }
        else { box.innerHTML = adDelBtn(); msg.className = 'q-msg err'; msg.textContent = errText(r); }
      });
      return;
    }
    if (act === 'save') {
      var text = C.an.value.trim();
      if (!text) { msg.className = 'q-msg err'; msg.textContent = '답변을 적어 주세요.'; C.an.focus(); return; }
      t.disabled = true; C.pk.setDisabled(true); msg.className = 'q-msg'; msg.textContent = '저장하는 중…';
      I.call('qnaAnswer', { id: id, answer: text, public: C.sw.getAttribute('aria-checked') === 'true', photos: C.pk.items.map(function (x) { return { b64: x.b64 }; }), removePhotos: Object.keys(C.removed) }).then(function (r) {
        if (!I.alive) return;
        if (r.ok) { delete I.drafts[id]; I.open[id] = true; toast(I, '답변을 저장했어요.'); adLoad(I, true); }
        else { t.disabled = false; C.pk.setDisabled(false); msg.className = 'q-msg err'; msg.textContent = errText(r); }
      });
    }
  }

  /* ---------- 공개 ---------- */
  var API_ADMIN = {
    mount: adMount, unmount: adUnmount, pending: null,
    refresh: function () { return AD ? adLoad(AD, true) : Promise.resolve(); },
    fetchPending: function (session) {
      return safeCall(function (a, p) { return session.adminCall(a, p); }, 'qnaAdminList', { status: '대기' }).then(function (r) {
        var arr = r.ok ? (Array.isArray(r.data) ? r.data : (r.data && r.data.list) || []) : null;
        if (!arr) return null;
        var n = arr.filter(function (q) { return q.status === '대기'; }).length;
        API_ADMIN.pending = n; return n;
      });
    }
  };
  window.HubQna = { mount: stuMount, unmount: stuUnmount, refresh: function () { return ST ? stuLoad(ST, true) : Promise.resolve(); } };
  window.HubQnaAdmin = API_ADMIN;
})();
