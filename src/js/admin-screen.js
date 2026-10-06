// 설정 화면의 "가입 승인" 구역과 설정 메뉴 옆의 "대기 N" 배지. 관리자에게만 보인다. (DESIGN.md 5.14)
//   ctx: { auth }
(function (g) {
  var PN = (g.PN = g.PN || {});
  var $ = function (sel) { return document.querySelector(sel); };

  PN.initAdminScreen = function (ctx) {
    var client = ctx.auth && ctx.auth.client;
    var api = client && PN.createAdminApi(client);
    var els = {
      panel: $('#admin-panel'), list: $('#admin-list'), count: $('#admin-count'), error: $('#admin-error'), result: $('#admin-result'),
      reload: $('#admin-reload'), badge: $('#nav-pending')
    };
    var isAdmin = false;
    var myEmail = '';
    var accountKey = '';
    var rows = [];
    var busy = false;

    function setBadge(n) {
      els.badge.hidden = !isAdmin || !n;
      els.badge.textContent = n ? '대기 ' + n : '';
      els.count.hidden = !n;
      els.count.textContent = n ? '대기 ' + n : '';
    }

    function showError(text) {
      els.error.hidden = !text;
      els.error.textContent = text || '';
    }

    function showResult(text) {
      els.result.hidden = !text;
      els.result.textContent = text || '';
    }

    function cell(role, text, className) {
      var c = document.createElement('div');
      c.setAttribute('role', role);
      c.className = 'admin-cell' + (className ? ' ' + className : '');
      if (text != null) c.textContent = text;
      return c;
    }

    function render() {
      els.list.textContent = '';
      var head = document.createElement('div');
      head.className = 'admin-row admin-head';
      head.setAttribute('role', 'row');
      ['이메일', '신청일', '상태', ''].forEach(function (t) {
        var h = cell('columnheader', t);
        if (!t) { var hint = document.createElement('span'); hint.className = 'sr-only'; hint.textContent = '승인·거절'; h.appendChild(hint); } // 버튼이 있는 열에도 스크린리더용 머리글이 필요하다
        head.appendChild(h);
      });
      els.list.appendChild(head);
      PN.sortProfiles(rows).forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'admin-row';
        row.setAttribute('role', 'row');
        row.appendChild(cell('cell', r.email, 'admin-email'));
        row.appendChild(cell('cell', new Date(r.created_at).toLocaleDateString('ko-KR')));
        var status = cell('cell');
        var chip = document.createElement('span');
        chip.className = 'chip chip-status-' + r.status;
        chip.textContent = PN.profileStatusText(r.status);
        status.appendChild(chip);
        if (r.is_admin) {
          var adm = document.createElement('span');
          adm.className = 'chip chip-neutral';
          adm.textContent = '관리자';
          status.appendChild(adm);
        }
        row.appendChild(status);

        var actions = cell('cell', null, 'admin-actions');
        if (r.is_admin || r.email === myEmail) { // 관리자 계정과 내 계정의 상태는 여기서 바꾸지 않는다
          actions.appendChild(document.createTextNode('—'));
        } else {
          [['approved', '승인', r.status !== 'approved'], ['rejected', '거절', r.status !== 'rejected']].forEach(function (a) {
            if (!a[2]) return;
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn-sm ' + (a[0] === 'approved' ? 'btn-primary' : 'btn-secondary');
            b.textContent = a[1];
            b.setAttribute('aria-label', r.email + ' ' + a[1]);
            b.disabled = busy;
            b.addEventListener('click', function () { change(r, a[0], a[1]); });
            actions.appendChild(b);
          });
        }
        row.appendChild(actions);
        els.list.appendChild(row);
      });
      if (!rows.length) {
        var empty = document.createElement('p');
        empty.className = 'detail-hint';
        empty.textContent = '가입을 신청한 계정이 없습니다.';
        els.list.appendChild(empty);
      }
    }

    async function load() {
      if (!isAdmin) return;
      try {
        rows = await api.listProfiles();
        showError('');
        setBadge(rows.filter(function (r) { return r.status === 'pending'; }).length);
      } catch (e) {
        showError(PN.dbErrorMessage(e, '가입 목록 불러오기'));
      }
      render();
    }

    // 배지만 가볍게 다시 센다 (창으로 돌아왔을 때)
    async function refreshBadge() {
      if (!isAdmin || busy) return;
      try { setBadge(await api.countPending()); } catch (e) { /* 배지는 못 읽어도 화면은 그대로 */ }
    }

    async function change(profile, status, label) {
      if (busy) return;
      busy = true;
      render();
      try {
        var ok = await api.setStatus(profile.id, status);
        showError('');
        showResult(ok ? profile.email + ' 계정을 ' + label + '했습니다.' : '바꾸지 못했습니다. 목록을 새로고침한 뒤 다시 시도하세요.');
      } catch (e) {
        showResult('');
        showError(PN.dbErrorMessage(e, '상태 변경'));
      }
      busy = false;
      await load();
    }

    els.reload.addEventListener('click', function () { showResult(''); load(); });
    g.addEventListener('focus', refreshBadge);

    return {
      onState: function (state) {
        var auth = state.auth;
        isAdmin = auth.state === 'approved' && auth.isAdmin === true;
        myEmail = auth.email || '';
        var key = isAdmin ? 'admin:' + auth.email : auth.state;
        els.panel.hidden = !isAdmin;
        if (!isAdmin) setBadge(0);
        if (key !== accountKey) {
          accountKey = key;
          rows = [];
          showResult('');
          showError('');
          if (isAdmin) load();
        }
      }
    };
  };
})(globalThis);
