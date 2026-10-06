// 검색 프리셋(pn_presets) 읽기와, 프리셋 한 행 → 검색 조건 변환.
// 기본 프리셋 7개는 가입이 승인될 때 DB가 만들어 준다 (supabase/migrations/…_pn_default_presets.sql).
(function (g) {
  var PN = (g.PN = g.PN || {});

  // 프리셋 행 → PN.createSearcher().search()에 넘기는 조건. 정렬과 필터가 프리셋의 값으로 채워진다.
  PN.presetToSearchOpts = function (preset) {
    return {
      query: preset.query,
      sources: preset.sources.slice(),
      categories: preset.arxiv_categories.slice(),
      dateRange: preset.date_range,
      minCitations: preset.min_citations,
      includeUnknownCitations: false, // 프리셋에 저장하지 않고 검색창에서 고르는 값
      limit: preset.result_limit,
      sort: preset.sort,
      statsMode: !!preset.stats_mode // 검색에는 쓰이지 않고 분석 단계에서 쓴다
    };
  };

  PN.createPresetsApi = function (client) {
    return {
      // 우선순위(position) 순서
      list: async function () {
        var res = await client.from('pn_presets').select('*').order('position', { ascending: true });
        if (res.error) throw res.error;
        return res.data || [];
      },

      // fields: PN.validatePreset().value. 새 프리셋은 맨 뒤(position)에 놓고, 만들어진 행을 돌려준다. (user_id는 DB가 채운다)
      create: async function (fields, position) {
        var res = await client.from('pn_presets').insert(Object.assign({}, fields, { position: position })).select('*').single();
        if (res.error) throw res.error;
        return res.data;
      },

      // 바뀐 칸만 수정한다. 수정된 행이 있으면 그 행, 이미 없었으면 null
      update: async function (id, fields) {
        var res = await client.from('pn_presets').update(fields).eq('id', id).select('*');
        if (res.error) throw res.error;
        return res.data && res.data.length ? res.data[0] : null;
      },

      // 지운 행이 있으면 true. 이 프리셋으로 저장한 논문은 지워지지 않고 연결만 끊어진다(DB의 on delete set null).
      remove: async function (id) {
        var res = await client.from('pn_presets').delete().eq('id', id).select('id');
        if (res.error) throw res.error;
        return (res.data || []).length > 0;
      },

      // changes: [{ id, position }]. 번호는 겹쳐도 되는 열이라 한 줄씩 바꾸어도 중간에 충돌하지 않는다.
      reorder: async function (changes) {
        var results = await Promise.all(changes.map(function (c) {
          return client.from('pn_presets').update({ position: c.position }).eq('id', c.id);
        }));
        results.forEach(function (r) { if (r.error) throw r.error; });
      }
    };
  };
})(globalThis);
