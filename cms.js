/* 천호산업 — 관리자 페이지에서 고친 문구·사진·제작 사례를 홈페이지에 그려 넣는 스크립트
   - 내용은 Google Apps Script 서버(API_URL)에서 받습니다. 서버가 안 되면 content.json 을 씁니다.
   - 고칠 수 있는 곳은 HTML 의 data-t(문구), data-img(사진), #works-gallery(제작 사례) 입니다. */
(function () {
  'use strict';
  var API_URL = ''; // Apps Script 웹 앱 주소 (…/exec)
  var CACHE_KEY = 'cheonho_content_v1';
  var html = document.documentElement;
  var PREVIEW = /[?&]preview\b/.test(location.search);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function photoUrl(v, size) {
    if (!v) return '';
    if (/^(data:|https?:|images\/)/.test(v)) return v;          // 연습 모드 사진·직접 주소
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(v) + '&sz=w' + (size || 1600);
  }
  var big = function () { return window.innerWidth > 900 ? 2400 : 1400; };

  /* ---------- 문구 ---------- */
  function applyTexts(C) {
    var T = (C && C.texts) || {};
    document.querySelectorAll('[data-t]').forEach(function (el) {
      if (el._def == null) el._def = el.innerHTML;
      var v = T[el.getAttribute('data-t')];
      el.innerHTML = (v != null && v !== '') ? esc(v).replace(/\n/g, '<br>') : el._def;
    });
  }

  /* ---------- 사진 ---------- */
  function applyImages(C) {
    var I = (C && C.images) || {};
    document.querySelectorAll('[data-img]').forEach(function (el) {
      var v = I[el.getAttribute('data-img')];
      if (el.tagName === 'IMG') {
        if (el._def == null) el._def = el.getAttribute('src');
        el.setAttribute('src', v ? photoUrl(v, big()) : el._def);
        return;
      }
      var old = el.querySelector(':scope > img.ph-img');
      if (v) {
        if (!old) { old = document.createElement('img'); old.className = 'ph-img'; old.alt = el.getAttribute('data-tl') || ''; el.appendChild(old); }
        old.src = photoUrl(v, 1600);
        el.classList.add('has-img');
      } else {
        if (old) old.remove();
        el.classList.remove('has-img');
      }
    });
  }

  /* ---------- 제작 사례 ---------- */
  var COLORS = ['c-navy', 'c-brown', 'c-black', 'c-clear', 'c-grey', 'c-wine', 'c-green', 'c-ochre'];
  function applyWorks(C) {
    var g = document.getElementById('works-gallery');
    if (!g || !C || !Array.isArray(C.works)) return;
    var pressed = document.querySelector('.filters button[aria-pressed="true"]');
    var cat = pressed ? pressed.getAttribute('data-cat') : 'all';
    g.innerHTML = C.works.map(function (w, i) {
      var color = w.color || COLORS[i % COLORS.length];
      var inner = w.img
        ? '<img class="ph-img" src="' + esc(photoUrl(w.img, 1200)) + '" alt="' + esc(w.name || '제작 사례') + '" loading="lazy">'
        : '<span>사진 준비 중</span>';
      return '<figure data-cat="' + esc(w.cat || 'etc') + '"' + (cat !== 'all' && w.cat !== cat ? ' hidden' : '') + '>' +
        '<div class="tile ' + (w.img ? 'has-img' : esc(color)) + '" role="img" aria-label="' + esc(w.name || '') + ' 사례 사진">' + inner + '</div>' +
        '<figcaption><b>' + esc(w.name || '') + '</b><span>' + esc(w.spec || '') + '</span></figcaption></figure>';
    }).join('') || '<p class="small">등록된 제작 사례가 없습니다.</p>';
  }

  function apply(C) {
    try { applyTexts(C); applyImages(C); applyWorks(C); } catch (e) { if (window.console) console.error(e); }
    html.classList.remove('cwait');
  }

  /* ---------- 서버에서 받기 (구글 서버가 가끔 실패해서 몇 번 다시 시도) ---------- */
  function getJSON(url, tries) {
    var wait = 600;
    return new Promise(function (ok, no) {
      (function go(n) {
        fetch(url, { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function (j) {
          if (!j || typeof j !== 'object' || j.ok === false) throw new Error('bad');
          ok(j);
        }).catch(function (e) {
          if (n <= 1) return no(e);
          setTimeout(function () { go(n - 1); }, wait); wait *= 1.6;
        });
      })(tries || 4);
    });
  }

  function load() {
    var done = false;
    function show(C, keep) {
      if (done) return; done = true;
      apply(C);
      if (keep) try { localStorage.setItem(CACHE_KEY, JSON.stringify(C)); } catch (e) {}
    }
    /* 3초 안에 못 받으면 이 브라우저에 기억해 둔 내용으로 (먼저 그리지는 않음 → 예전 내용 깜빡임 방지) */
    var timer = setTimeout(function () {
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) {}
      if (cached) show(cached, false);
    }, 3000);
    var src = API_URL ? getJSON(API_URL + '?action=content') : Promise.reject(new Error('no api'));
    src.catch(function () { return getJSON('content.json?v=' + Date.now(), 2); })
      .then(function (C) { clearTimeout(timer); show(C, true); },
            function () { clearTimeout(timer); done || (html.classList.remove('cwait'), done = true); });
    setTimeout(function () { html.classList.remove('cwait'); }, 6000);   // 무슨 일이 있어도 6초 뒤에는 보이게
  }

  /* ---------- 관리자 미리보기 ---------- */
  window.CH_PREVIEW = function (C, focus) {
    apply(C);
    document.querySelectorAll('.cms-focus').forEach(function (e) { e.classList.remove('cms-focus'); });
    if (!focus) return;
    var el = null;
    if (focus === 'works') el = document.getElementById('works-gallery');
    else if (focus.indexOf('img:') === 0) el = document.querySelector('[data-img="' + focus.slice(4) + '"]');
    else el = document.querySelector('[data-t="' + focus + '"]');
    if (!el) return;
    var box = el.classList.contains('banner-img') ? el.closest('.banner') : el;
    box.classList.add('cms-focus');
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  if (PREVIEW) {
    html.classList.remove('cwait');
    var st = document.createElement('style');
    st.textContent = '.cms-focus{outline:3px solid #ff8a00!important;outline-offset:4px}.draft-strip{display:none}';
    document.head.appendChild(st);
    document.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a'); if (a) e.preventDefault(); }, true);
    return;
  }
  load();
})();
