/* 허브 3D 느낌 캐릭터 세트 (SVG 스프라이트)
 *
 * 쓰는 법
 *   <script src="assets/mascots.js"></script>
 *   HubMascots.mount();                       // <body> 맨 앞에 스프라이트 + 애니메이션 CSS 넣기 (두 번 불러도 한 번만)
 *   HubMascots.svg('m-note-happy', 96, 'hm-float')   // → <svg …><use href="#m-note-happy"/></svg> 문자열
 *   또는 직접  <svg width="64" height="64"><use href="#m-trophy-gold"/></svg>
 *
 *   허브 틀이 이미 m-note·m-quiz·m-star 를 가지고 있으면
 *   HubMascots.mount({skip:['m-note','m-quiz','m-star']})  — 그 셋만 빼고 넣음.
 *   (그라데이션·필터 id 는 모두 hm- 접두어라 기존 gNote·gShade·fBlur 등과 겹치지 않음)
 *
 * 입체감 3요소: ① 위→아래 그라데이션 ② 좌상단 radial 광택 ③ 아래 그림자 타원(blur). 눈은 흰자+동공+하이라이트.
 * 표정: 같은 id 뒤에 -happy(기쁨) -wow(놀람) -sad(슬픔) -sleep(졸림). 기본 표정은 접미어 없음
 *       (캐릭터마다 기본 표정이 다름: cross=sad, cloud=sad, ufo=wow, sleep=sleep). 목록은 HubMascots.chars.
 */
(function (root) {
  'use strict';
  var INK = '#1E1B3A';
  var PI = Math.PI;
  function r2(n) { return Math.round(n * 100) / 100; }

  /* ───────── 그라데이션 (위→아래 2색) ───────── */
  var G = {
    violet: ['#A89CFF', '#5B4BF0'], pink: ['#FFB3C8', '#FF6F93'], mint: ['#7DF0CF', '#0FA382'],
    sun: ['#FFE38A', '#FFB02E'], gold: ['#FFF1A6', '#F2A21B'], silver: ['#FFFFFF', '#9AA3C8'],
    bronze: ['#FFD3AE', '#C46F2E'], sky: ['#B9E7FF', '#3E9BF2'], red: ['#FF9AA2', '#E5384F'],
    orange: ['#FFCB85', '#FF7A3D'], green: ['#A6F0A0', '#34B05A'], clay: ['#FFC9A8', '#E8805A'],
    wood: ['#FFEBC9', '#F2BE84'], ink: ['#7C6CFF', '#2B2478'], fire: ['#FFC94D', '#FF4D4D'],
    cream: ['#FFFFFF', '#E3DEFF'], lav: ['#F4F1FF', '#DAD3FF'], glass: ['#FFFFFF', '#CFC8FF'],
    belly: ['#FFF6C9', '#FFD768'], night: ['#7C6CFF', '#3A2FB0']
  };
  function defsMarkup() {
    var s = '';
    Object.keys(G).forEach(function (k) {
      s += '<linearGradient id="hm-' + k + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + G[k][0] + '"/><stop offset="1" stop-color="' + G[k][1] + '"/></linearGradient>';
    });
    s += '<linearGradient id="hm-shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#1E1B6A" stop-opacity="0"/><stop offset="1" stop-color="#1E1B6A" stop-opacity=".38"/></linearGradient>';
    s += '<linearGradient id="hm-shadeW" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#8A1F2F" stop-opacity="0"/><stop offset="1" stop-color="#8A1F2F" stop-opacity=".34"/></linearGradient>';
    s += '<radialGradient id="hm-gloss" cx=".3" cy=".18" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>';
    s += '<linearGradient id="hm-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF3A6" stop-opacity=".8"/><stop offset="1" stop-color="#FFF3A6" stop-opacity="0"/></linearGradient>';
    /* 여러 조각을 한 덩어리처럼 칠할 때: userSpaceOnUse */
    s += '<linearGradient id="hm-cloudU" gradientUnits="userSpaceOnUse" x1="0" y1="22" x2="0" y2="92"><stop offset="0" stop-color="#E4E8FF"/><stop offset="1" stop-color="#8E98DD"/></linearGradient>';
    s += '<linearGradient id="hm-mintU" gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="106"><stop offset="0" stop-color="#7DF0CF"/><stop offset="1" stop-color="#0FA382"/></linearGradient>';
    s += '<filter id="hm-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>';
    s += '<clipPath id="hm-cGlobe"><circle cx="60" cy="56" r="40"/></clipPath>';
    s += '<clipPath id="hm-cPopper"><path d="M36 46 L60 106 L84 46Z"/></clipPath>';
    return s;
  }

  /* ───────── 조각 도우미 ───────── */
  function sh(cx, cy, rx, ry, c, o) {
    return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + (c || '#3B2FC9') + '" opacity="' + (o || 0.22) + '" filter="url(#hm-blur)"/>';
  }
  /* 같은 모양을 3겹: 색 그라데이션 / 아래 어둡게 / 좌상단 광택 */
  function body(tag, a, grad, o) {
    o = o || {};
    var s = '<' + tag + ' ' + a, out = s + ' fill="url(#hm-' + grad + ')"/>';
    if (o.shade !== false) out += s + ' fill="url(#hm-' + (o.shade || 'shade') + ')"/>';
    if (o.gloss !== false) out += s + ' fill="url(#hm-gloss)"/>';
    return out;
  }
  function spec(x, y, rx, ry, rot, op) { /* 또렷한 윗면 하이라이트 */
    return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="#fff" opacity="' + (op || 0.55) + '" transform="rotate(' + (rot == null ? -30 : rot) + ' ' + x + ' ' + y + ')"/>';
  }
  function stroke(d, c, w) {
    return '<path d="' + d + '" stroke="' + c + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
  }

  /* ───────── 얼굴 ─────────
   * e: base|happy|wow|sad|sleep   d: 눈 사이 반폭   s: 크기   my: 입 위치(눈 아래)   mouth:false 면 입 없음 */
  function face(cx, cy, o) {
    o = o || {};
    var d = o.d == null ? 12 : o.d, s = o.s || 1, e = o.e || 'base', my = o.my == null ? 15 : o.my;
    var mw = o.mw || 5, mc = o.mc || 4, mouth = o.mouth !== false;
    var st = o.ring ? ' stroke="' + o.ring + '" stroke-width="1.2"' : '';
    var sw = r2(s < 0.9 ? 1.9 : 2.3), eyes = '', out = '', xs = [cx - d, cx + d], i, x, y = cy;
    for (i = 0; i < 2; i++) {
      x = xs[i];
      if (e === 'base') {
        eyes += '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r2(7.6 * s) + '" ry="' + r2(9.6 * s) + '" fill="#fff"' + st + '/>' +
          '<circle cx="' + r2(x + 2 * s) + '" cy="' + r2(y + 2 * s) + '" r="' + r2(4.6 * s) + '" fill="' + INK + '"/>' +
          '<circle cx="' + r2(x + 3.6 * s) + '" cy="' + r2(y - 0.4 * s) + '" r="' + r2(1.6 * s) + '" fill="#fff"/>';
      } else if (e === 'wow') {
        eyes += '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r2(8.6 * s) + '" ry="' + r2(10.8 * s) + '" fill="#fff"' + st + '/>' +
          '<circle cx="' + x + '" cy="' + r2(y + 0.6 * s) + '" r="' + r2(3.6 * s) + '" fill="' + INK + '"/>' +
          '<circle cx="' + r2(x + 1.4 * s) + '" cy="' + r2(y - 1.2 * s) + '" r="' + r2(1.3 * s) + '" fill="#fff"/>';
        out += stroke('M' + r2(x - 6 * s) + ' ' + r2(y - 15 * s) + 'Q' + x + ' ' + r2(y - 20.5 * s) + ' ' + r2(x + 6 * s) + ' ' + r2(y - 15 * s), INK, r2(2 * s));
      } else if (e === 'happy') {
        eyes += stroke('M' + r2(x - 6.5 * s) + ' ' + r2(y + 2.5 * s) + 'Q' + x + ' ' + r2(y - 8.5 * s) + ' ' + r2(x + 6.5 * s) + ' ' + r2(y + 2.5 * s), INK, r2(3 * s));
      } else if (e === 'sad') {
        eyes += '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r2(7.6 * s) + '" ry="' + r2(9.6 * s) + '" fill="#fff"' + st + '/>' +
          '<circle cx="' + x + '" cy="' + r2(y + 3.2 * s) + '" r="' + r2(5 * s) + '" fill="' + INK + '"/>' +
          '<circle cx="' + r2(x + 1.8 * s) + '" cy="' + r2(y + 0.8 * s) + '" r="' + r2(1.9 * s) + '" fill="#fff"/>' +
          '<circle cx="' + r2(x - 1.6 * s) + '" cy="' + r2(y + 5.4 * s) + '" r="' + r2(1 * s) + '" fill="#fff"/>';
        out += i === 0
          ? stroke('M' + r2(x - 7 * s) + ' ' + r2(y - 11 * s) + 'L' + r2(x + 5 * s) + ' ' + r2(y - 16 * s), INK, r2(2.2 * s))
          : stroke('M' + r2(x - 5 * s) + ' ' + r2(y - 16 * s) + 'L' + r2(x + 7 * s) + ' ' + r2(y - 11 * s), INK, r2(2.2 * s));
      } else if (e === 'sleep') {
        eyes += stroke('M' + r2(x - 6.5 * s) + ' ' + r2(y - 0.5 * s) + 'Q' + x + ' ' + r2(y + 7.5 * s) + ' ' + r2(x + 6.5 * s) + ' ' + r2(y - 0.5 * s), INK, r2(3 * s));
      }
    }
    /* 깜빡임: 눈 묶음에 scaleY(var(--hm-eye)) — CSS 에서 --hm-eye 를 애니메이션 */
    out = '<g class="hm-eyes" style="transform-box:fill-box;transform-origin:center;transform:scaleY(var(--hm-eye,1))">' + eyes + '</g>' + out;
    var mx = cx, my0 = cy + my;
    if (e === 'happy' || o.blush) {
      out += '<ellipse cx="' + r2(cx - d - 8.5 * s) + '" cy="' + r2(cy + 9 * s) + '" rx="' + r2(5 * s) + '" ry="' + r2(3.2 * s) + '" fill="#FF7FA6" opacity="' + (e === 'happy' ? '.55' : '.4') + '"/>' +
        '<ellipse cx="' + r2(cx + d + 8.5 * s) + '" cy="' + r2(cy + 9 * s) + '" rx="' + r2(5 * s) + '" ry="' + r2(3.2 * s) + '" fill="#FF7FA6" opacity="' + (e === 'happy' ? '.55' : '.4') + '"/>';
    }
    if (mouth) {
      if (e === 'base') {
        out += '<path d="M' + (mx - mw) + ' ' + my0 + 'q' + mw + ' ' + mc + ' ' + (2 * mw) + ' 0" stroke="' + INK + '" stroke-width="' + sw + '" stroke-linecap="round" fill="none"/>';
      } else if (e === 'happy') {
        var w = mw * 1.45;
        out += '<path d="M' + r2(mx - w) + ' ' + r2(my0 - 1) + 'C' + r2(mx - w + 2) + ' ' + r2(my0 + w * 1.3) + ' ' + r2(mx + w - 2) + ' ' + r2(my0 + w * 1.3) + ' ' + r2(mx + w) + ' ' + r2(my0 - 1) + 'Z" fill="' + INK + '"/>' +
          '<ellipse cx="' + mx + '" cy="' + r2(my0 + w * 0.66) + '" rx="' + r2(w * 0.46) + '" ry="' + r2(w * 0.26) + '" fill="#FF7B9C"/>';
      } else if (e === 'wow') {
        out += '<ellipse cx="' + mx + '" cy="' + r2(my0 + 3 * s) + '" rx="' + r2(3.4 * s) + '" ry="' + r2(4.8 * s) + '" fill="' + INK + '"/>' +
          '<ellipse cx="' + mx + '" cy="' + r2(my0 + 5.4 * s) + '" rx="' + r2(2 * s) + '" ry="' + r2(1.4 * s) + '" fill="#FF7B9C"/>';
      } else if (e === 'sad') {
        out += '<path d="M' + (mx - mw) + ' ' + r2(my0 + 3.5) + 'q' + mw + ' ' + (-mc - 1.5) + ' ' + (2 * mw) + ' 0" stroke="' + INK + '" stroke-width="' + sw + '" stroke-linecap="round" fill="none"/>';
      } else if (e === 'sleep') {
        out += '<ellipse cx="' + mx + '" cy="' + r2(my0 + 1.5) + '" rx="' + r2(2.6 * s) + '" ry="' + r2(3 * s) + '" fill="' + INK + '"/>' +
          '<circle cx="' + r2(mx + 6.5 * s) + '" cy="' + r2(my0 + 3 * s) + '" r="' + r2(4.2 * s) + '" fill="#fff" fill-opacity=".55" stroke="#fff" stroke-opacity=".85" stroke-width="1.1"/>';
      }
    }
    if (e === 'sad') { /* 눈물 */
      var tx = r2(cx + d + 3 * s), ty = r2(cy + 15 * s), k = s;
      out += '<path d="M' + tx + ' ' + r2(ty - 6 * k) + 'C' + r2(tx + 4 * k) + ' ' + r2(ty - 1 * k) + ' ' + r2(tx + 4.6 * k) + ' ' + r2(ty + 3 * k) + ' ' + tx + ' ' + r2(ty + 4.6 * k) + 'C' + r2(tx - 4.6 * k) + ' ' + r2(ty + 3 * k) + ' ' + r2(tx - 4 * k) + ' ' + r2(ty - 1 * k) + ' ' + tx + ' ' + r2(ty - 6 * k) + 'Z" fill="#7FD0FF"/>' +
        '<ellipse cx="' + r2(tx - 1.4 * k) + '" cy="' + r2(ty + 1 * k) + '" rx="' + r2(0.9 * k) + '" ry="' + r2(1.5 * k) + '" fill="#fff" opacity=".85"/>';
    }
    return out;
  }

  /* ───────── 캐릭터들 (각 120×120) ───────── */
  var C = {};

  /* 수첩 — 성적노트 (기존 m-note 와 같은 그림) */
  C.note = function (e) {
    return sh(60, 110, 34, 6.5, '#3B2FC9') +
      body('rect', 'x="22" y="12" width="78" height="94" rx="24"', 'violet') +
      '<g fill="#EEEBFF" stroke="#7466FF" stroke-width="1.4"><rect x="14" y="26" width="20" height="9" rx="4.5"/><rect x="14" y="48" width="20" height="9" rx="4.5"/><rect x="14" y="70" width="20" height="9" rx="4.5"/></g>' +
      '<rect x="44" y="72" width="42" height="24" rx="9" fill="#fff" opacity=".95"/>' +
      stroke('M52 88l5-9 5 9M54 85.5h7', '#5B4BF0', 2.6) + stroke('M70 81h10M70 87h8', '#A89CFF', 2.6) +
      face(67, 45, { e: e, d: 12, my: 15, mw: 5, mc: 4 }) +
      (e === 'happy' ? '<path d="M92 14l2.4 5.6 5.6 2.4-5.6 2.4L92 30l-2.4-5.6L84 22l5.6-2.4z" fill="url(#hm-sun)"/>' : '');
  };

  /* 말풍선 — 퇴실퀴즈 (기존 m-quiz 와 같은 그림, 뱃지만 표정 따라 바뀜) */
  C.quiz = function (e) {
    var P = 'd="M20 40a24 24 0 0 1 24-24h34a24 24 0 0 1 24 24v26a24 24 0 0 1-24 24H58l-22 16 4-17A24 24 0 0 1 20 66z"';
    var badge;
    if (e === 'sad') badge = '<circle cx="93" cy="22" r="14" fill="url(#hm-red)"/><circle cx="93" cy="22" r="14" fill="url(#hm-gloss)"/>' + stroke('M87.5 16.5l11 11M98.5 16.5l-11 11', '#fff', 3.4);
    else if (e === 'wow') badge = '<circle cx="93" cy="22" r="14" fill="url(#hm-sun)"/><circle cx="93" cy="22" r="14" fill="url(#hm-gloss)"/>' + stroke('M93 15v8', '#fff', 3.8) + '<circle cx="93" cy="29.6" r="2.1" fill="#fff"/>';
    else badge = '<circle cx="93" cy="22" r="14" fill="url(#hm-mint)"/><circle cx="93" cy="22" r="14" fill="url(#hm-gloss)"/>' + stroke('M86.5 22.5l5 5 8-9.5', '#fff', 3.4);
    return sh(60, 108, 32, 6, '#C2335F', 0.2) + body('path', P, 'pink') +
      face(63, 48, { e: e, d: 12, my: 16, mw: 6, mc: 6 }) + badge;
  };

  /* 연필 */
  C.pencil = function (e) {
    return sh(62, 112, 26, 4.5, '#B8731A') + '<g transform="rotate(8 60 60)">' +
      body('rect', 'x="38" y="44" width="44" height="49"', 'sun', { shade: 'shadeW' }) +
      '<rect x="38" y="44" width="9" height="49" fill="#fff" opacity=".28"/><rect x="73" y="44" width="9" height="49" fill="#B8731A" opacity=".16"/>' +
      body('path', 'd="M38 46L60 8l22 38Q71 54 60 47Q49 54 38 46z"', 'wood', { shade: 'shadeW' }) +
      body('path', 'd="M52.2 25.5L60 8l7.8 17.5Q60 30 52.2 25.5z"', 'ink') +
      body('rect', 'x="38" y="93" width="44" height="9"', 'silver') + stroke('M38 97.5h44', '#8E97BF', 1.2) +
      body('path', 'd="M38 102h44v3q0 6-6 6H44q-6 0-6-6z"', 'pink', { shade: 'shadeW' }) +
      face(60, 66, { e: e, d: 9.5, s: 0.8, my: 12, mw: 4.2, mc: 3.4 }) + '</g>';
  };

  /* 시계 — 08:30 (퇴실 시각) */
  C.clock = function (e) {
    return sh(60, 112, 34, 5, '#3B2FC9') +
      body('ellipse', 'cx="38" cy="103" rx="8" ry="6"', 'ink', { gloss: false }) + body('ellipse', 'cx="82" cy="103" rx="8" ry="6"', 'ink', { gloss: false }) +
      body('circle', 'cx="31" cy="32" r="13"', 'sun', { shade: 'shadeW' }) + body('circle', 'cx="89" cy="32" r="13"', 'sun', { shade: 'shadeW' }) +
      '<rect x="55" y="11" width="10" height="9" rx="4.5" fill="#A89CFF"/>' +
      body('circle', 'cx="60" cy="66" r="38"', 'violet') +
      '<circle cx="60" cy="66" r="30.5" fill="url(#hm-lav)"/><circle cx="60" cy="66" r="30.5" fill="none" stroke="#5B4BF0" stroke-opacity=".25" stroke-width="1.4"/>' +
      '<g fill="#8F84F5"><circle cx="86.5" cy="66" r="2.2"/><circle cx="33.5" cy="66" r="2.2"/><circle cx="60" cy="92.5" r="2.2"/></g>' +
      face(60, 48, { e: e, d: 10, s: 0.8, my: 10.5, mw: 4, mc: 3.2, ring: '#C9C0FF' }) +
      stroke('M60 66L60 85', INK, 3.4) + stroke('M60 66L47.4 69.4', INK, 4.2) +
      '<circle cx="60" cy="66" r="3.6" fill="#FF6F93"/><circle cx="59" cy="65" r="1.2" fill="#fff" opacity=".8"/>' + spec(44, 38, 7, 3, -35, 0.5);
  };

  /* 트로피 (순위 색 3종) */
  function trophy(e, col, dark, num) {
    var digits = { 1: 'M56.5 97L61 94V106', 2: 'M56 97.5Q56 94 60 94Q64.5 94 64.5 98Q64.5 100.5 56 106H65', 3: 'M56 95H64L59.5 99.5Q65 99.5 65 103Q64 106.5 56 105.5' };
    return sh(60, 112, 32, 5, '#7A4E00') +
      '<g fill="none" stroke="' + dark + '" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M33 26H23Q19 26 19 31Q19 54 41 61"/><path d="M87 26h10q4 0 4 5Q101 54 79 61"/></g>' +
      body('rect', 'x="53" y="78" width="14" height="16"', col, { shade: 'shadeW' }) +
      body('path', 'd="M30 20H90V46Q90 80 60 82Q30 80 30 46z"', col, { shade: 'shadeW' }) +
      body('rect', 'x="25" y="13" width="70" height="12" rx="6"', col, { shade: 'shadeW' }) +
      body('rect', 'x="34" y="91" width="52" height="18" rx="8"', 'violet') +
      stroke(digits[num], '#fff', 2.6) +
      face(60, 45, { e: e, d: 11, s: 0.9, my: 14, mw: 5, mc: 4 }) + spec(40, 33, 8, 3, -60, 0.6);
  }

  /* 퇴실증 티켓 */
  C.ticket = function (e) {
    var P = 'd="M28 30H92A14 14 0 0 1 106 44V54A7 7 0 0 0 106 68V78A14 14 0 0 1 92 92H28A14 14 0 0 1 14 78V68A7 7 0 0 0 14 54V44A14 14 0 0 1 28 30z"';
    return sh(60, 106, 40, 5, '#B8731A') + '<g transform="rotate(-8 60 61)">' +
      body('path', P, 'sun', { shade: 'shadeW' }) +
      '<path d="M84 34V88" stroke="#fff" stroke-opacity=".85" stroke-width="2" stroke-dasharray="3.5 4.5" stroke-linecap="round"/>' +
      face(47, 53, { e: e, d: 10.5, s: 0.85, my: 13, mw: 4.4, mc: 3.6 }) +
      stroke('M32 78h24M32 84h14', '#fff', 3.2).replace('fill="none"', 'fill="none" opacity=".75"') +
      '<circle cx="96" cy="61" r="8.5" fill="url(#hm-mint)"/><circle cx="96" cy="61" r="8.5" fill="url(#hm-gloss)"/>' + stroke('M91.8 61.4l3 3 5.4-6.4', '#fff', 2.5) + '</g>';
  };

  /* 책 / 교재 */
  C.book = function (e) {
    return sh(62, 108, 36, 5.5, '#0A6B52') +
      '<rect x="32" y="16" width="70" height="92" rx="12" fill="#E7E2FF"/><rect x="32" y="16" width="70" height="92" rx="12" fill="url(#hm-shade)"/>' +
      '<path d="M96 24V102M91 24V102" stroke="#CFC8F5" stroke-width="1.4"/>' +
      body('rect', 'x="22" y="10" width="72" height="92" rx="14"', 'mint') +
      '<path d="M22 24a14 14 0 0 1 14-14h0v92h0a14 14 0 0 1-14-14z" fill="#0A6B52" opacity=".22"/><path d="M36 14V98" stroke="#fff" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M70 10h12v26l-6-5-6 5z" fill="url(#hm-pink)"/>' +
      '<rect x="44" y="74" width="42" height="18" rx="7" fill="#fff" opacity=".95"/>' + stroke('M51 80h18M51 86h11', '#0FA382', 2.6) +
      face(62, 46, { e: e, d: 11, s: 0.92, my: 14, mw: 5, mc: 4 }) + spec(32, 22, 7, 2.6, -55, 0.55);
  };

  /* 체크 배지 — 정답 */
  C.check = function (e) {
    var sc = '', i, a;
    for (i = 0; i < 12; i++) { a = i * 30 * PI / 180; sc += '<circle cx="' + r2(60 + 37 * Math.cos(a)) + '" cy="' + r2(59 + 37 * Math.sin(a)) + '" r="10.5"/>'; }
    return sh(60, 112, 32, 5, '#0A6B52') +
      '<g fill="url(#hm-mintU)">' + sc + '</g>' +
      body('circle', 'cx="60" cy="59" r="38"', 'mint', { gloss: false }) +
      '<circle cx="60" cy="59" r="47" fill="url(#hm-gloss)"/>' +
      face(60, 44, { e: e, d: 12, s: 0.85, mouth: false }) +
      '<path d="M44 72L55 83L77 61" stroke="#0A6B52" stroke-opacity=".28" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none" transform="translate(0 2.6)"/>' +
      stroke('M44 72L55 83L77 61', '#fff', 9);
  };

  /* 엑스 배지 — 오답 */
  C.cross = function (e) {
    return sh(60, 111, 32, 5, '#8A1F2F') +
      body('rect', 'x="14" y="12" width="92" height="92" rx="32"', 'red', { shade: 'shadeW' }) +
      face(60, 39, { e: e, d: 12, s: 0.85, mouth: false }) +
      '<path d="M47 66L73 91M73 66L47 91" stroke="#8A1F2F" stroke-opacity=".3" stroke-width="9" stroke-linecap="round" transform="translate(0 2.6)"/>' +
      stroke('M47 66L73 91M73 66L47 91', '#fff', 9);
  };

  /* 불꽃 — 연속 기록 */
  C.flame = function (e) {
    return sh(60, 111, 28, 4.5, '#A8321E') +
      body('path', 'd="M60 6C62 24 90 38 92 72C93 96 78 110 60 110C42 110 27 96 28 72C28 58 36 50 42 42C44 50 48 54 54 52C60 40 54 22 60 6z"', 'fire', { shade: 'shadeW' }) +
      '<path d="M60 52C62 64 82 70 82 88C82 100 72 106 60 106C48 106 38 100 38 88C38 76 52 70 60 52z" fill="url(#hm-belly)"/>' +
      face(60, 83, { e: e, d: 10, s: 0.85, my: 13, mw: 4.4, mc: 3.6 }) + spec(40, 60, 4, 8, 28, 0.55);
  };

  /* 로켓 */
  C.rocket = function (e) {
    return sh(60, 113, 22, 3.8, '#3B2FC9', 0.16) + '<g transform="rotate(32 60 60)">' +
      '<path d="M51 90Q60 120 69 90z" fill="url(#hm-fire)"/><path d="M55 90Q60 109 65 90z" fill="url(#hm-belly)"/>' +
      body('path', 'd="M38 68L25 84V94L38 85z"', 'violet') + body('path', 'd="M82 68L95 84V94L82 85z"', 'violet') +
      '<path d="M47 84H73L69 93H51z" fill="#3A2FB0"/>' +
      body('path', 'd="M60 6C86 22 90 56 84 86H36C30 56 34 22 60 6z"', 'cream', { shade: 'shade' }) +
      body('path', 'd="M60 6C71 14 78 24 81 35Q60 41 39 35C42 24 49 14 60 6z"', 'pink', { shade: 'shadeW' }) +
      face(60, 55, { e: e, d: 10.5, s: 0.85, my: 12.5, mw: 4.4, mc: 3.4, ring: '#D6CFFF' }) +
      '<circle cx="60" cy="77" r="4.6" fill="url(#hm-sky)"/><circle cx="60" cy="77" r="4.6" fill="url(#hm-gloss)"/>' +
      '</g>';
  };

  /* 선인장 — 빈 화면 */
  C.cactus = function (e) {
    var fl = '', i, a;
    for (i = 0; i < 5; i++) { a = (-90 + i * 72) * PI / 180; fl += '<circle cx="' + r2(60 + 5.6 * Math.cos(a)) + '" cy="' + r2(11 + 5.6 * Math.sin(a)) + '" r="4.6"/>'; }
    return sh(60, 113, 30, 4, '#1F6B3A') +
      body('rect', 'x="20" y="36" width="15" height="34" rx="7.5"', 'green') + body('rect', 'x="28" y="56" width="22" height="14" rx="7"', 'green') +
      body('rect', 'x="85" y="26" width="15" height="34" rx="7.5"', 'green') + body('rect', 'x="70" y="48" width="22" height="14" rx="7"', 'green') +
      body('rect', 'x="42" y="14" width="36" height="76" rx="18"', 'green') +
      '<path d="M46 30h4M73 28h4M45 68h4M72 72h4M26 46h3" stroke="#fff" stroke-opacity=".65" stroke-width="2" stroke-linecap="round"/>' +
      '<g fill="url(#hm-pink)">' + fl + '</g><circle cx="60" cy="11" r="3.4" fill="url(#hm-sun)"/>' +
      face(60, 46, { e: e, d: 8.5, s: 0.78, my: 12, mw: 4, mc: 3.2, blush: true }) +
      body('rect', 'x="32" y="82" width="56" height="13" rx="6.5"', 'clay', { shade: 'shadeW' }) +
      body('path', 'd="M37 95H83L79 109Q78.5 112 75 112H45Q41.5 112 41 109z"', 'clay', { shade: 'shadeW' });
  };

  /* 구름 + 번개 — 오류 / 인터넷 끊김 */
  C.cloud = function (e) {
    return sh(60, 113, 32, 3.8, '#3B2FC9', 0.14) +
      '<g fill="url(#hm-cloudU)"><circle cx="34" cy="66" r="22"/><circle cx="58" cy="46" r="26"/><circle cx="86" cy="62" r="24"/><rect x="34" y="62" width="54" height="26" rx="12"/></g>' +
      '<ellipse cx="44" cy="35" rx="11" ry="4.2" fill="#fff" opacity=".6" transform="rotate(-32 44 35)"/>' +
      face(58, 58, { e: e, d: 12, s: 0.95, my: 14, mw: 4.6, mc: 3.6 }) +
      body('path', 'd="M81 80L66 102H76L70 118L93 92H82L89 80z"', 'sun', { shade: 'shadeW' });
  };

  /* UFO — 오류(404)·길 잃음 */
  C.ufo = function (e) {
    return '<path d="M42 74L24 110H96L78 74z" fill="url(#hm-beam)"/>' + sh(60, 112, 30, 4, '#8A6A00', 0.16) +
      body('ellipse', 'cx="60" cy="62" rx="46" ry="16"', 'ink', { gloss: false }) +
      '<path d="M34 56A26 30 0 0 1 86 56z" fill="url(#hm-sky)" opacity=".95"/><path d="M34 56A26 30 0 0 1 86 56z" fill="url(#hm-gloss)"/>' +
      '<path d="M34 56A26 30 0 0 1 86 56z" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.4"/>' +
      face(60, 41, { e: e, d: 9.5, s: 0.74, my: 11.5, mw: 3.8, mc: 3, ring: '#9DB8F5' }) +
      body('path', 'd="M14 62A46 16 0 0 0 106 62Q60 50 14 62z"', 'violet') +
      '<g><circle cx="29" cy="66.5" r="3.2" fill="#FFE38A"/><circle cx="45" cy="71.5" r="3.2" fill="#7DF0CF"/><circle cx="60" cy="73.5" r="3.2" fill="#FFB3C8"/><circle cx="75" cy="71.5" r="3.2" fill="#7DF0CF"/><circle cx="91" cy="66.5" r="3.2" fill="#FFE38A"/></g>';
  };

  /* 자는 얼굴 — 점검 중 / 재오픈 대기 */
  C.sleep = function (e) {
    return sh(60, 110, 34, 5.5, '#3B2FC9') +
      body('path', 'd="M60 34C84 34 98 50 98 72C98 94 82 106 60 106C38 106 22 94 22 72C22 50 36 34 60 34z"', 'violet') +
      face(60, 72, { e: e, d: 13, s: 0.95, my: 14, mw: 5, mc: 4, blush: true }) +
      body('path', 'd="M28 52C30 30 50 16 70 20C92 24 106 40 104 64C96 50 86 44 72 42C56 40 40 44 28 52z"', 'pink', { shade: 'shadeW' }) +
      stroke('M27 53C40 44 58 40 76 42C88 44 98 50 104 62', '#fff', 6.5) +
      body('circle', 'cx="103" cy="68" r="7.5"', 'sun', { shade: 'shadeW' }) +
      '<g stroke="#8F84F5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M10 34h9l-9 11h9" stroke-width="3"/><path d="M20 14h6.5l-6.5 8h6.5" stroke-width="2.4"/></g>';
  };

  /* 파티 폭죽 — 축하 / 퇴실 통과 */
  C.party = function (e) {
    return sh(56, 112, 26, 4, '#B02A5C', 0.18) + '<g transform="rotate(18 60 70)">' +
      '<path d="M63 40C64 28 78 26 80 10" stroke="#FF6F93" stroke-width="3.2" stroke-linecap="round" fill="none"/><path d="M56 40C48 26 62 20 54 6" stroke="#0FA382" stroke-width="3.2" stroke-linecap="round" fill="none"/>' +
      '<path d="M48 42C34 34 32 22 20 24" stroke="#FFB02E" stroke-width="3.2" stroke-linecap="round" fill="none"/><path d="M72 42C86 34 90 20 102 22" stroke="#5B4BF0" stroke-width="3.2" stroke-linecap="round" fill="none"/>' +
      '<circle cx="36" cy="14" r="3.4" fill="#FFB02E"/><circle cx="92" cy="10" r="3" fill="#0FA382"/><circle cx="68" cy="14" r="2.6" fill="#FF6F93"/>' +
      '<rect x="22" y="36" width="6" height="6" rx="1.5" fill="#5B4BF0" transform="rotate(30 25 39)"/><rect x="96" y="34" width="6" height="6" rx="1.5" fill="#FF6F93" transform="rotate(-20 99 37)"/>' +
      '<path d="M44 14l1.8 4.2 4.2 1.8-4.2 1.8L44 26l-1.8-4.2L38 20l4.2-1.8z" fill="#FFB02E"/>' +
      '<ellipse cx="60" cy="46" rx="24" ry="7" fill="#3B2FC9"/>' +
      body('path', 'd="M36 46L60 106L84 46A24 7 0 0 1 36 46z"', 'pink', { shade: 'shadeW' }) +
      '<g clip-path="url(#hm-cPopper)" stroke="#fff" stroke-opacity=".5" stroke-width="3.6" stroke-linecap="round"><path d="M30 56L92 68M30 74L92 86"/></g>' +
      face(60, 66, { e: e, d: 7, s: 0.6, my: 9, mw: 3.2, mc: 2.6, ring: '#E5A0B8' }) + '</g>';
  };

  /* 지도 핀 — 지리 문제 */
  C.pin = function (e) {
    return sh(60, 112, 17, 3.6, '#A8431A', 0.2) +
      body('path', 'd="M60 110C60 110 22 76 22 48A38 38 0 0 1 98 48C98 76 60 110 60 110z"', 'orange', { shade: 'shadeW' }) +
      face(60, 44, { e: e, d: 11, s: 0.88, my: 14, mw: 4.6, mc: 3.8 }) + spec(36, 28, 8, 3, -50, 0.55);
  };

  /* 지구본 — 지리 문제 */
  C.globe = function (e) {
    return sh(60, 112, 28, 4, '#1F4FA8', 0.2) +
      body('rect', 'x="40" y="100" width="40" height="11" rx="5.5"', 'violet') + body('rect', 'x="53" y="90" width="14" height="12"', 'violet', { gloss: false }) +
      '<circle cx="60" cy="56" r="40" fill="url(#hm-sky)"/>' +
      '<g clip-path="url(#hm-cGlobe)"><path d="M32 34C40 24 54 28 56 38C58 48 47 52 41 58C34 62 28 52 26 44z" fill="url(#hm-green)"/><path d="M72 68C84 60 96 66 94 78C92 90 78 94 72 84z" fill="url(#hm-green)"/><circle cx="82" cy="36" r="6" fill="url(#hm-green)"/>' +
      '<g fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1.2"><ellipse cx="60" cy="56" rx="40" ry="11"/><ellipse cx="60" cy="56" rx="15" ry="40"/></g></g>' +
      '<circle cx="60" cy="56" r="40" fill="url(#hm-shade)"/><circle cx="60" cy="56" r="40" fill="url(#hm-gloss)"/>' +
      face(60, 50, { e: e, d: 12, s: 0.92, my: 14.5, mw: 4.8, mc: 3.8, ring: '#7FB8F5' });
  };

  /* 모래시계 — 대기 */
  C.hourglass = function (e) {
    return sh(60, 113, 32, 4, '#3B2FC9') +
      '<path d="M32 20H88C88 42 70 50 66 60C70 70 88 78 88 100H32C32 78 50 70 54 60C50 50 32 42 32 20z" fill="url(#hm-glass)" fill-opacity=".9" stroke="#B6AEFF" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M38 24H82C82 40 68 48 64 56H56C52 48 38 40 38 24z" fill="url(#hm-sun)"/>' +
      '<path d="M35 98C38 84 52 78 60 76C68 78 82 84 85 98z" fill="url(#hm-sun)"/><rect x="58.4" y="56" width="3.2" height="22" fill="#FFB02E"/>' +
      face(60, 36, { e: e, d: 8, s: 0.64, my: 9.5, mw: 3.4, mc: 2.8 }) +
      '<path d="M32 20H88C88 42 70 50 66 60C70 70 88 78 88 100H32C32 78 50 70 54 60C50 50 32 42 32 20z" fill="url(#hm-gloss)"/>' +
      body('rect', 'x="24" y="8" width="72" height="13" rx="6.5"', 'violet') + body('rect', 'x="24" y="99" width="72" height="13" rx="6.5"', 'violet');
  };

  /* 별 — 기존 m-star (viewBox 60) */
  var STAR = 'd="M30 4l7 17 17 7-17 7-7 17-7-17-17-7 17-7z"';
  C.star = function () { return '<path ' + STAR + ' fill="url(#hm-sun)"/><path ' + STAR + ' fill="url(#hm-gloss)"/>'; };

  /* ───────── 목록 ───────── */
  var EX3 = ['base', 'happy', 'wow'], EX4 = ['base', 'happy', 'wow', 'sad'];
  var EX_NAME = { base: '기본', happy: '기쁨', wow: '놀람', sad: '슬픔', sleep: '졸림' };
  var chars = [
    { key: 'note', name: '수첩 (성적노트)', use: '성적 화면 머리·로그인·성적 없음 안내. 기쁨=점수 올랐을 때, 슬픔=불러오기 실패', exprs: EX4, def: 'base', fn: C.note },
    { key: 'quiz', name: '말풍선 (퇴실퀴즈)', use: '퀴즈 입장·문제 풀이 머리. 기쁨=정답, 놀람=새 문제, 슬픔=오답(뱃지가 ✕)', exprs: EX4, def: 'base', fn: C.quiz },
    { key: 'star', name: '반짝이 별', use: '정답·연속 기록·랭킹 장식 (눈 없는 장식, 60×60)', exprs: ['base'], def: 'base', fn: C.star, vb: '0 0 60 60' },
    { key: 'pencil', name: '연필', use: '답안 입력·쓰기 중·설정 화면', exprs: EX3, def: 'base', fn: C.pencil },
    { key: 'clock', name: '시계 08:30', use: '퇴실 시각 안내·시간 제한. 놀람=시간 임박', exprs: EX3, def: 'base', fn: C.clock },
    { key: 'trophy-gold', name: '트로피 · 금', use: '랭킹 1위', exprs: EX3, def: 'base', fn: function (e) { return trophy(e, 'gold', '#E0A21F', 1); } },
    { key: 'trophy-silver', name: '트로피 · 은', use: '랭킹 2위', exprs: EX3, def: 'base', fn: function (e) { return trophy(e, 'silver', '#8E97BF', 2); } },
    { key: 'trophy-bronze', name: '트로피 · 동', use: '랭킹 3위', exprs: EX3, def: 'base', fn: function (e) { return trophy(e, 'bronze', '#B5622A', 3); } },
    { key: 'ticket', name: '퇴실증 티켓', use: '퇴실증 발급·퇴실 통과 카드', exprs: EX3, def: 'base', fn: C.ticket },
    { key: 'book', name: '책 / 교재', use: '교재·문제집·숙제 목록, 수업 자료', exprs: EX3, def: 'base', fn: C.book },
    { key: 'check', name: '체크 배지', use: '정답 결과·제출 완료·통과', exprs: EX3, def: 'base', fn: C.check },
    { key: 'cross', name: '엑스 배지', use: '오답 결과·실패·미제출', exprs: ['sad', 'wow', 'happy'], def: 'sad', fn: C.cross },
    { key: 'flame', name: '불꽃', use: '연속 기록(스트릭)·열심히 하는 중', exprs: EX3, def: 'base', fn: C.flame },
    { key: 'rocket', name: '로켓', use: '시작·입장·첫 방문 환영·업데이트', exprs: EX3, def: 'base', fn: C.rocket },
    { key: 'cactus', name: '선인장', use: '빈 화면(기록 없음·시험 없음)', exprs: EX3, def: 'base', fn: C.cactus },
    { key: 'cloud', name: '구름+번개', use: '오류·인터넷 끊김·서버 응답 없음', exprs: ['sad', 'wow', 'happy'], def: 'sad', fn: C.cloud },
    { key: 'ufo', name: 'UFO', use: '404·찾을 수 없는 화면·길 잃음', exprs: ['wow', 'sad', 'happy'], def: 'wow', fn: C.ufo },
    { key: 'sleep', name: '자는 얼굴', use: '점검 중·재오픈 대기·퇴실퀴즈 시간 외', exprs: ['sleep', 'wow', 'happy'], def: 'sleep', fn: C.sleep },
    { key: 'party', name: '파티 폭죽', use: '축하·퇴실 통과·만점·목표 달성', exprs: EX3, def: 'base', fn: C.party },
    { key: 'pin', name: '지도 핀', use: '지리 문제·학교 위치·진학 상담', exprs: EX3, def: 'base', fn: C.pin },
    { key: 'globe', name: '지구본', use: '지리 과목·세계지도 문제', exprs: EX3, def: 'base', fn: C.globe },
    { key: 'hourglass', name: '모래시계', use: '불러오는 중·채점 중·대기', exprs: EX3, def: 'base', fn: C.hourglass }
  ];
  chars.forEach(function (c) {
    c.ids = c.exprs.map(function (e) { return 'm-' + c.key + (e === c.def ? '' : '-' + e); });
    c.id = c.ids[0];
    c.exprName = c.exprs.map(function (e) { return EX_NAME[e]; });
  });
  var ids = [];
  chars.forEach(function (c) { ids = ids.concat(c.ids); });

  /* ───────── 스프라이트 / 사용 도우미 ───────── */
  function sprite(opts) {
    opts = opts || {};
    var skip = opts.skip || [], only = opts.only || null, s = '';
    chars.forEach(function (c) {
      c.exprs.forEach(function (e, i) {
        var id = c.ids[i];
        if (skip.indexOf(id) >= 0 || (only && only.indexOf(id) < 0)) return;
        s += '<symbol id="' + id + '" viewBox="' + (c.vb || '0 0 120 120') + '">' + c.fn(e) + '</symbol>';
      });
    });
    return '<svg id="hm-sprite" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' + defsMarkup() + s + '</defs></svg>';
  }
  function svg(id, size, extraClass) {
    var z = size == null ? 64 : size;
    return '<svg class="hm' + (extraClass ? ' ' + extraClass : '') + '" width="' + z + '" height="' + z + '" aria-hidden="true" focusable="false"><use href="#' + id + '"/></svg>';
  }
  /* 애니메이션 CSS — svg(id,size,'hm-float hm-blink') 처럼 클래스로 씀 */
  function css() {
    return '@property --hm-eye{syntax:"<number>";inherits:true;initial-value:1}' +
      '.hm{display:inline-block;vertical-align:middle;overflow:visible;flex:none}' +
      '@keyframes hm-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}' +
      '@keyframes hm-bounce{0%,100%{transform:translateY(0) scale(1,1)}12%{transform:translateY(0) scale(1.08,.9)}38%{transform:translateY(-14px) scale(.95,1.06)}62%{transform:translateY(0) scale(1.05,.95)}78%{transform:translateY(-3px) scale(1,1)}}' +
      '@keyframes hm-wiggle{0%,100%{transform:rotate(0)}25%{transform:rotate(-6deg)}75%{transform:rotate(6deg)}}' +
      '@keyframes hm-pop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.12);opacity:1}100%{transform:scale(1)}}' +
      '@keyframes hm-blink{0%,90%,100%{--hm-eye:1}94%{--hm-eye:.08}}' +
      '.hm-float{animation:hm-float 3.2s ease-in-out infinite}' +
      '.hm-bounce{transform-origin:50% 100%;animation:hm-bounce 1.6s ease-in-out infinite}' +
      '.hm-wiggle{animation:hm-wiggle 1.4s ease-in-out infinite}' +
      '.hm-pop{animation:hm-pop .5s cubic-bezier(.3,1.4,.5,1) both}' +
      '.hm-blink{animation:hm-blink 4.4s ease-in-out infinite}' +
      '.hm-float.hm-blink{animation:hm-float 3.2s ease-in-out infinite,hm-blink 4.4s ease-in-out infinite}' +
      '.hm-bounce.hm-blink{animation:hm-bounce 1.6s ease-in-out infinite,hm-blink 4.4s ease-in-out infinite}' +
      '.hm-wiggle.hm-blink{animation:hm-wiggle 1.4s ease-in-out infinite,hm-blink 4.4s ease-in-out infinite}' +
      '@media (prefers-reduced-motion:reduce){.hm-float,.hm-bounce,.hm-wiggle,.hm-pop,.hm-blink{animation:none!important}}';
  }
  /* body 맨 앞에 스프라이트·CSS 넣기 (이미 있으면 건너뜀) */
  function mount(opts) {
    var d = root.document;
    if (!d || d.getElementById('hm-sprite')) return;
    var host = d.body || d.documentElement;
    host.insertAdjacentHTML('afterbegin', sprite(opts));
    if (!d.getElementById('hm-css')) {
      var st = d.createElement('style'); st.id = 'hm-css'; st.textContent = css();
      (d.head || host).appendChild(st);
    }
  }

  root.HubMascots = { sprite: sprite, ids: ids, svg: svg, css: css, mount: mount, chars: chars };
})(window);
