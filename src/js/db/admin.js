// 관리자 전용: 가입 승인 목록(pn_profiles)을 읽고 상태를 바꾼다. 관리자가 아니면 RLS가 막아서, 다른 사람의 행은 읽히지도 바뀌지도 않는다.
// 앱은 관리자일 때만 이 구역을 보여 주지만, 실제 권한은 DB가 정한다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var COLUMNS = 'id,email,status,is_admin,created_at,approved_at';
  PN.PROFILE_STATUSES = ['pending', 'approved', 'rejected'];

  // 승인 대기가 맨 위, 그 안에서는 신청이 최근인 순
  PN.sortProfiles = function (rows) {
    var rank = { pending: 0, approved: 1, rejected: 2 };
    return rows.slice().sort(function (a, b) {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
    });
  };

  PN.createAdminApi = function (client) {
    return {
      listProfiles: async function () {
        var res = await client.from('pn_profiles').select(COLUMNS).order('created_at', { ascending: false });
        if (res.error) throw res.error;
        return res.data || [];
      },

      // status: 'pending' | 'approved' | 'rejected'. 바뀐 행이 있으면 true, 대상이 없거나 권한이 없으면 false
      // (승인되면 DB의 트리거가 그 계정의 기본 프리셋 7개를 만든다)
      setStatus: async function (id, status) {
        if (PN.PROFILE_STATUSES.indexOf(status) < 0) throw new Error('알 수 없는 상태: ' + status);
        var res = await client.from('pn_profiles').update({ status: status }).eq('id', id).select('id');
        if (res.error) throw res.error;
        return (res.data || []).length > 0;
      },

      // 승인 대기 건수 (설정 메뉴 옆 배지)
      countPending: async function () {
        var res = await client.from('pn_profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending');
        if (res.error) throw res.error;
        return res.count || 0;
      }
    };
  };

  PN.profileStatusText = function (status) {
    return { pending: '승인 대기', approved: '승인됨', rejected: '승인 거절' }[status] || status;
  };
})(globalThis);
