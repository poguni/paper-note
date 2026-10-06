// 분석 결과 저장(pn_analyses). 한 논문에 단계·모델별로 여러 건을 쌓는다. 소유자(user_id)는 DB가 채우고, 남의 논문에는 RLS가 막는다.
// result_json에는 AI 결과(PN.validateAnalysis의 value)만 넣는다. 비용 같은 부가 정보는 저장하지 않는다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var COLUMNS = 'id,stage,model,result_json,created_at';

  PN.createAnalysesApi = function (client) {
    return {
      // paperId: pn_papers.id. 저장된 행 { id, created_at }
      save: async function (paperId, stage, modelId, resultJson) {
        var res = await client.from('pn_analyses')
          .insert({ paper_id: paperId, stage: stage, model: modelId, result_json: resultJson })
          .select('id,created_at').single();
        if (res.error) throw res.error;
        return res.data;
      },

      // 어느 논문에 어떤 단계의 분석이 있는지(서재의 "분석 여부" 표시용). 결과 본문은 가져오지 않는다.
      listIndex: async function () {
        var rows = [];
        for (var from = 0; ; from += 1000) {
          var res = await client.from('pn_analyses').select('paper_id,stage').range(from, from + 999);
          if (res.error) throw res.error;
          rows = rows.concat(res.data || []);
          if (!res.data || res.data.length < 1000) return rows;
        }
      },

      // 그 논문의 분석 결과 전체, 새것부터
      listForPaper: async function (paperId) {
        var res = await client.from('pn_analyses').select(COLUMNS).eq('paper_id', paperId).order('created_at', { ascending: false });
        if (res.error) throw res.error;
        return res.data || [];
      }
    };
  };
})(globalThis);
