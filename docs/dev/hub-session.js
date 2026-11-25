/* 허브 공통 세션 — 번호로 로그인한 학생(또는 관리자 비밀번호로 로그인한 강사)의 서버 호출을 한 곳에서.
 * 각 탭 모듈(성적·커리큘럼·QnA …)은 이걸 받아서 씀. 서버는 Supabase Edge Function 하나({action, payload} POST, 응답 {ok,data,error,needLogin}).
 *
 *   HubSession.init({ code, name, env, apiUrl })   허브가 로그인 직후 한 번 부름
 *   HubSession.call(action, payload)  → Promise<응답>   학생 요청. 로그인 열쇠(tok)를 알아서 받아 payload.tok 에 넣어 보냄(열쇠가 지났으면 다시 받아 한 번 더)
 *   HubSession.adminLogin(password) → Promise<응답>      강사 로그인(성공하면 관리자 열쇠를 가짐)
 *   HubSession.adminCall(action, payload) → Promise<응답> 강사 요청. payload.token 에 관리자 열쇠를 넣어 보냄(만료되면 needLogin:true 를 그대로 돌려줌)
 *   HubSession.code / .name / .env / .apiUrl / .isAdmin()
 *   HubSession.view(refresh?) → Promise<{ok,data}>        로그인 응답(반·테스트·숙제 요약, 홈 화면용)
 *   HubSession.clear()                                    나가기
 * 응답은 항상 {ok:true,data} 또는 {ok:false,error}. 네트워크 실패도 {ok:false,error:'인터넷 연결을 확인해 주세요.'}로 돌려줌(예외를 던지지 않음). */
(function () {
  'use strict';
  var S = { code: '', name: '', env: 'dev', apiUrl: '', tok: '', admin: '', view: null };
  function deviceId() {
    var k = S.env === 'dev' ? 'seiseki-dev.device' : 'seiseki.device', v = '';
    try { v = localStorage.getItem(k) || ''; if (!v) { v = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem(k, v); } } catch (e) { v = v || 'd' + Math.random().toString(36).slice(2, 12); }
    return v;
  }
  function post(action, payload) {
    if (!S.apiUrl) return Promise.resolve({ ok: false, error: '서버 주소가 없어요.' });
    return fetch(S.apiUrl, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ action: action, payload: payload || {} }) })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: '인터넷 연결을 확인해 주세요.' }; });
  }
  function ensureTok() {
    if (S.tok) return Promise.resolve({ ok: true });
    return post('login', { code: S.code, dev: deviceId() }).then(function (r) { if (r.ok && r.data && r.data.tok) { S.tok = r.data.tok; S.view = r.data; return { ok: true }; } return r.ok ? { ok: false, error: '로그인 열쇠를 받지 못했어요.' } : r; });
  }
  function call(action, payload, again) {
    return ensureTok().then(function (t) {
      if (!t.ok) return t;
      return post(action, Object.assign({}, payload || {}, { tok: S.tok })).then(function (r) {
        if (!r.ok && (r.needLogin || /다시 로그인|열쇠/.test(r.error || '')) && !again) { S.tok = ''; return call(action, payload, true); }
        return r;
      });
    });
  }
  window.HubSession = {
    init: function (o) { S.code = String(o.code || ''); S.name = o.name || ''; S.env = o.env === 'prod' ? 'prod' : 'dev'; S.apiUrl = o.apiUrl || ''; S.tok = ''; S.admin = ''; S.view = null; },
    call: function (a, p) { return call(a, p, false); },
    adminLogin: function (pw) { return post('adminLogin', { password: pw, dev: deviceId() }).then(function (r) { if (r.ok && r.data && r.data.token) S.admin = r.data.token; return r; }); },
    adminCall: function (a, p) { return post(a, Object.assign({}, p || {}, { token: S.admin })).then(function (r) { if (!r.ok && r.needLogin) S.admin = ''; return r; }); },
    /** 로그인 응답(반·테스트·숙제 요약) — 홈 화면용. refresh=true 면 서버에서 새로 받음 */
    view: function (refresh) {
      if (S.view && !refresh) return Promise.resolve({ ok: true, data: S.view });
      S.tok = '';
      return ensureTok().then(function (t) { return t.ok ? { ok: true, data: S.view } : t; });
    },
    isAdmin: function () { return !!S.admin; },
    clear: function () { S.code = ''; S.name = ''; S.tok = ''; S.admin = ''; S.view = null; },
    get code() { return S.code; }, get name() { return S.name; }, get env() { return S.env; }, get apiUrl() { return S.apiUrl; }
  };
})();
