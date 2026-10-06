// 논문 저장(pn_papers): 저장, 저장 취소, 저장 여부 조회. 소유자(user_id)는 DB가 로그인한 사용자로 채우므로 보내지 않는다.
(function (g) {
  var PN = (g.PN = g.PN || {});
  var COLUMNS = 'id,source,source_id,doi';
  var ALL_COLUMNS = 'id,source,source_id,title,authors,year,published_date,citation_count,abstract,doi,pdf_url,landing_url,categories,memo,saved_at,preset_id,pinned,sort_index';
  var PAGE = 1000; // PostgREST가 한 번에 돌려주는 최대 행 수

  // 검색 결과의 공통 형식 → pn_papers 한 행 (id, user_id, memo, saved_at은 DB 기본값)
  // presetId: 이 논문이 나온 검색에 쓴 프리셋(서재의 프리셋별 필터용). 없으면 열 자체를 보내지 않는다.
  PN.paperToRow = function (p, presetId) {
    var row = {
      source: p.source,
      source_id: p.sourceId,
      title: p.title,
      authors: p.authors || [],
      year: p.year == null ? null : p.year,
      published_date: p.publishedDate || null,
      citation_count: p.citationCount == null ? null : p.citationCount,
      abstract: p.abstract || null,
      doi: p.doi || null,
      pdf_url: p.pdfUrl || null,
      landing_url: p.landingUrl || null,
      categories: p.categories || []
    };
    if (presetId) row.preset_id = presetId;
    return row;
  };

  // 저장한 논문의 식별 정보를 모아 두고 "이 검색 결과가 이미 저장되었는가"를 알려 준다.
  // 한 논문이 소스에 따라 다른 ID로 보일 수 있어서(arXiv ID, Semantic Scholar ID, DOI) 여러 열쇠로 찾는다.
  PN.createSavedIndex = function (rows) {
    var byKey = new Map();

    function paperKeys(p) {
      var keys = [p.source + ':' + p.sourceId];
      if (p.arxivId) keys.push('arxiv:' + p.arxivId);
      if (p.s2Id) keys.push('semantic_scholar:' + p.s2Id);
      if (p.doi) keys.push('doi:' + p.doi.toLowerCase());
      return keys;
    }
    function rowKeys(r) {
      var keys = [r.source + ':' + r.source_id];
      if (r.doi) keys.push('doi:' + r.doi.toLowerCase());
      return keys;
    }

    var index = {
      add: function (row) { rowKeys(row).forEach(function (k) { byKey.set(k, row); }); },
      removeById: function (id) {
        byKey.forEach(function (row, k) { if (row.id === id) byKey.delete(k); });
      },
      // 저장된 행({ id, source, source_id, doi }) 또는 undefined
      find: function (paper) {
        var keys = paperKeys(paper);
        for (var i = 0; i < keys.length; i++) if (byKey.has(keys[i])) return byKey.get(keys[i]);
        return undefined;
      },
      has: function (paper) { return index.find(paper) !== undefined; }
    };
    (rows || []).forEach(index.add);
    return index;
  };

  PN.createPapersApi = function (client) {
    return {
      // 저장한 모든 논문의 식별 정보
      listSaved: async function () {
        var rows = [];
        for (var from = 0; ; from += PAGE) {
          var res = await client.from('pn_papers').select(COLUMNS).range(from, from + PAGE - 1);
          if (res.error) throw res.error;
          rows = rows.concat(res.data || []);
          if (!res.data || res.data.length < PAGE) return rows;
        }
      },

      // 내 서재용: 저장한 논문 전체(메타데이터와 메모 포함), 저장일 최신순
      listAll: async function () {
        var rows = [];
        for (var from = 0; ; from += PAGE) {
          var res = await client.from('pn_papers').select(ALL_COLUMNS).order('saved_at', { ascending: false }).range(from, from + PAGE - 1);
          if (res.error) throw res.error;
          rows = rows.concat(res.data || []);
          if (!res.data || res.data.length < PAGE) return rows;
        }
      },

      // { status: 'saved' | 'exists', row }. 같은 논문이 이미 있으면 새로 만들지 않는다.
      // presetId(선택): 어느 프리셋의 검색에서 나왔는지. 그 프리셋이 그 사이 지워졌으면(23503) 프리셋 없이 저장한다.
      save: async function (paper, presetId) {
        var res = await client.from('pn_papers').insert(PN.paperToRow(paper, presetId)).select(COLUMNS).single();
        if (res.error && res.error.code === '23503' && presetId) {
          res = await client.from('pn_papers').insert(PN.paperToRow(paper)).select(COLUMNS).single();
        }
        if (!res.error) return { status: 'saved', row: res.data };
        if (res.error.code === '23505') { // 같은 사용자의 같은 source·source_id
          var existing = await client.from('pn_papers').select(COLUMNS)
            .eq('source', paper.source).eq('source_id', paper.sourceId).maybeSingle();
          if (existing.data) return { status: 'exists', row: existing.data };
        }
        throw res.error;
      },

      // 저장한 논문의 메모. 행이 이미 없으면 null (목록에 안 쓰고 필요할 때만 읽는다)
      getMemo: async function (id) {
        var res = await client.from('pn_papers').select('memo').eq('id', id).maybeSingle();
        if (res.error) throw res.error;
        return res.data ? res.data.memo || '' : null;
      },

      // 메모를 바꾼다. 바뀐 행이 있으면 true, 이미 없었으면 false
      saveMemo: async function (id, memo) {
        var res = await client.from('pn_papers').update({ memo: String(memo) }).eq('id', id).select('id');
        if (res.error) throw res.error;
        return (res.data || []).length > 0;
      },

      // "맨 위에 고정"을 켜거나 끈다. 바뀐 행이 있으면 true, 이미 없었으면 false
      setPinned: async function (id, pinned) {
        var res = await client.from('pn_papers').update({ pinned: !!pinned }).eq('id', id).select('id');
        if (res.error) throw res.error;
        return (res.data || []).length > 0;
      },

      // "내 순서"의 자리 번호를 바꾼다. changes: [{ id, sort_index }]. 번호는 겹쳐도 되는 열이라 한 줄씩 바꾸어도 중간에 충돌하지 않는다.
      setOrder: async function (changes) {
        var results = await Promise.all(changes.map(function (c) {
          return client.from('pn_papers').update({ sort_index: c.sort_index }).eq('id', c.id);
        }));
        results.forEach(function (r) { if (r.error) throw r.error; });
      },

      // 저장을 취소한다. 그 논문의 분석 결과도 함께 지워지므로(DB의 on delete cascade) 화면에서 확인을 받아야 한다.
      // 지운 행이 있으면 true, 이미 없었으면 false
      remove: async function (id) {
        var res = await client.from('pn_papers').delete().eq('id', id).select('id');
        if (res.error) throw res.error;
        return (res.data || []).length > 0;
      }
    };
  };

  // 사용자에게 보일 문장. verb: '저장' | '삭제' 등
  // what: 실패한 일을 가리키는 이름(명사형). 예: '서재 불러오기', '메모 저장'. 문장은 "~에 실패했습니다"로 끝난다.
  PN.dbErrorMessage = function (error, what) {
    what = what || '처리';
    var code = (error && error.code) || '';
    var text = String((error && error.message) || '') + ' ' + String((error && error.name) || '');
    if (code === '42501') return '이 작업은 승인된 계정만 할 수 있습니다.';
    if (/jwt|PGRST30[0-9]|not authenticated/i.test(code + ' ' + text)) return '로그인이 만료되었습니다. 설정에서 다시 로그인하세요.';
    if (/failed to fetch|network/i.test(text)) return '네트워크 오류로 ' + what + '에 실패했습니다.';
    return what + '에 실패했습니다. 잠시 뒤에 다시 시도하세요.';
  };
})(globalThis);
