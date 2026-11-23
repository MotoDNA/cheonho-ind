/* 천호산업 — 공통 스크립트 (메뉴 열기, 제작 사례 분류, 문의 양식) */
(function () {
  'use strict';

  /* 1) 모바일 메뉴 열고 닫기 */
  var toggle = document.querySelector('.nav-toggle');
  var gnb = document.getElementById('gnb');
  if (toggle && gnb) {
    toggle.addEventListener('click', function () {
      var open = gnb.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    });
  }

  /* 2) 제작 사례: 품목 버튼을 누르면 해당 품목만 보이기 */
  var filterButtons = document.querySelectorAll('.filters button');
  var tiles = document.querySelectorAll('.gallery figure');
  filterButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var cat = btn.getAttribute('data-cat');
      filterButtons.forEach(function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      tiles.forEach(function (t) {
        t.hidden = !(cat === 'all' || t.getAttribute('data-cat') === cat);
      });
    });
  });

  /* 3) 문의 양식
     아래 ENDPOINT에 Google Apps Script 웹 앱 주소를 넣으면 실제로 접수됩니다.
     비어 있으면 전송하지 않고 전화 안내만 보여줍니다. */
  var ENDPOINT = ''; // TODO: Apps Script URL
  var TEL = '010-5207-2625';

  var form = document.getElementById('inquiry');
  if (form) {
    var msg = document.getElementById('form-msg');
    var show = function (html, isError) {
      msg.innerHTML = html;
      msg.className = 'form-msg show' + (isError ? ' err' : '');
    };
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var missing = [];
      ['name', 'phone', 'message'].forEach(function (id) {
        var el = form.elements[id];
        var empty = !el.value.trim();
        el.setAttribute('aria-invalid', empty ? 'true' : 'false');
        if (empty) missing.push(el);
      });
      if (missing.length) {
        show('이름, 연락처, 문의 내용은 꼭 적어 주세요.', true);
        missing[0].focus();
        return;
      }
      if (!ENDPOINT) {
        show('온라인 접수는 아직 연결 전입니다. 지금은 전화 <a href="tel:' + TEL.replace(/-/g, '') + '">' + TEL + '</a>로 문의해 주세요.', false);
        return;
      }
      var data = new FormData(form);
      fetch(ENDPOINT, { method: 'POST', body: data })
        .then(function () {
          form.reset();
          show('문의가 접수되었습니다. 확인 후 연락드리겠습니다.', false);
        })
        .catch(function () {
          show('전송에 실패했습니다. 전화 <a href="tel:' + TEL.replace(/-/g, '') + '">' + TEL + '</a>로 문의해 주세요.', true);
        });
    });
  }
})();
