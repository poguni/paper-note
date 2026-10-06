// 검색 실행기: 두 소스를 부르고, 합치고, 인용수를 보강하고, 필터를 적용해 최종 N개를 만든다.
//   deps: { relay: { call }, queues: { arxiv, s2 }, cache, now: () => Date }
//   opts: { query, sources[], categories[], dateRange, minCitations, includeUnknownCitations, limit, sort }
// 결과: { papers, warnings: [{ source, code, message }], meta: { rounds, requests, shortfall, fetchedAt, fromCache } }
(function (g) {
  var PN = (g.PN = g.PN || {});
  var MAX_ROUNDS = 3; // 필터로 줄어든 개수를 채우려고 다음 쪽을 더 가져오는 최대 횟수(첫 쪽 포함)
  var ARXIV_MAX_START = 2000; // 중계 함수가 받는 start 상한
  var BATCH_SIZE = 500; // s2_batch 한 번에 조회하는 최대 개수
  // 이런 오류는 소스 하나의 문제가 아니라 전체 검색을 막는다. 그 밖의 오류(호출 한도, 서버 오류, 응답 해석 실패 등)는
  // 해당 소스만 건너뛰고 다른 소스의 결과를 살린다.
  var FATAL = { unauthorized: true, not_approved: true, network: true, invalid_category: true, query_too_long: true };

  PN.createSearcher = function (deps) {
    var relay = deps.relay;
    var queues = deps.queues;
    var cache = deps.cache;
    var now = deps.now || function () { return new Date(); };

    async function search(opts) {
      var terms = PN.parseTerms(opts.query);
      if (!terms.length) throw PN.searchError('empty_query', '영문 검색어를 입력하세요.');

      var sources = opts.sources && opts.sources.length ? opts.sources : ['arxiv', 'semantic_scholar'];
      var useArxiv = sources.indexOf('arxiv') >= 0;
      var useS2 = sources.indexOf('semantic_scholar') >= 0;
      var limit = opts.limit || 20;
      var sort = opts.sort || 'relevance';

      var keyed = {
        terms: terms,
        sources: sources.slice().sort(),
        categories: opts.categories || [],
        dateRange: opts.dateRange || 'all',
        minCitations: opts.minCitations || 0,
        includeUnknownCitations: !!opts.includeUnknownCitations,
        limit: limit
      };
      var key = PN.cacheKey(keyed); // 정렬은 키에 넣지 않는다: 정렬만 바꾸면 다시 호출하지 않는다

      var hit = cache.get(key);
      if (hit) return present(hit, sort, true);

      var startedAt = now();
      var fo = Object.assign({}, keyed, { now: startedAt }); // 필터와 요청을 만들 때 쓰는 값
      var arxivState = { items: [], page: 0, done: !useArxiv };
      var s2States = useS2 ? terms.map(function (t) { return { term: t, items: [], page: 0, done: false }; }) : [];
      var stats = { arxiv: 0, s2: 0, batch: 0 };
      var warnings = [];
      var firstError = null;
      var counts = new Map(); // 인용수 보강 결과: ID → 숫자 또는 null(못 찾음)

      function handleError(source, e) {
        if (e && FATAL[e.code]) throw e;
        firstError = firstError || e;
        var code = (e && e.code) || 'error';
        if (!warnings.some(function (w) { return w.source === source && w.code === code; })) {
          warnings.push({ source: source, code: code, message: e && e.name === 'RelayError' ? PN.relayErrorMessage(e) : String((e && e.message) || e) });
        }
      }

      // Semantic Scholar 호출. 호출 한도(429)에 걸리면 대기열 간격을 한 번 더 기다린 뒤 딱 한 번만 다시 부른다.
      // (요청 간격은 지켜도 네트워크 지연 때문에 서버에는 더 촘촘히 도착할 수 있다)
      async function callS2(op, params, counter) {
        for (var attempt = 0; ; attempt++) {
          await queues.s2.wait();
          stats[counter]++;
          try {
            return await relay.call(op, params);
          } catch (e) {
            if (attempt === 0 && e && e.code === 'upstream_rate_limited') continue;
            throw e;
          }
        }
      }

      async function fetchArxivPage() {
        var st = arxivState;
        var start = st.page * limit;
        if (start > ARXIV_MAX_START) { st.done = true; return; }
        try {
          var query = PN.arxiv.buildSearchQuery(fo);
          await queues.arxiv.wait();
          stats.arxiv++;
          var xml = await relay.call('arxiv_search', { search_query: query, start: start, max_results: limit });
          var res = PN.arxiv.parseFeed(xml);
          st.items = st.items.concat(res.papers);
          st.page++;
          if (res.papers.length < limit || start + res.papers.length >= res.total) st.done = true;
        } catch (e) {
          st.done = true;
          handleError('arxiv', e);
        }
      }

      async function fetchS2Page(st) {
        if (!PN.s2.canFetchPage(limit, st.page)) { st.done = true; return; }
        try {
          var json = await callS2('s2_search', PN.s2.buildSearchParams(st.term, fo, st.page), 's2');
          var res = PN.s2.parseSearch(json);
          st.items = st.items.concat(res.papers);
          st.page++;
          if (res.papers.length < limit || st.page * limit >= res.total) st.done = true;
        } catch (e) {
          st.done = true;
          handleError('semantic_scholar', e);
        }
      }

      async function fetchRound() {
        await Promise.all([
          arxivState.done ? null : fetchArxivPage(),
          (async function () {
            for (var i = 0; i < s2States.length; i++) if (!s2States[i].done) await fetchS2Page(s2States[i]);
          })()
        ]);
      }

      // arXiv 결과에는 인용수가 없으므로 Semantic Scholar 일괄 조회로 채운다. 이미 조회한 ID는 다시 부르지 않는다.
      async function enrich(papers) {
        var wanted = [];
        papers.forEach(function (p) {
          var id = p.citationCount == null ? PN.s2.lookupId(p) : null;
          if (id && !counts.has(id) && wanted.indexOf(id) < 0) wanted.push(id);
        });
        for (var i = 0; i < wanted.length; i += BATCH_SIZE) {
          var chunk = wanted.slice(i, i + BATCH_SIZE);
          try {
            var found = PN.s2.parseBatch(await callS2('s2_batch', { ids: chunk }, 'batch'), chunk);
            chunk.forEach(function (id) { counts.set(id, found.has(id) ? found.get(id) : null); });
          } catch (e) {
            chunk.forEach(function (id) { counts.set(id, null); }); // 실패해도 이번 검색에서는 다시 부르지 않는다
            handleError('semantic_scholar', e);
          }
        }
        papers.forEach(function (p) {
          var id = p.citationCount == null ? PN.s2.lookupId(p) : null;
          if (id && counts.get(id) != null) p.citationCount = counts.get(id);
        });
      }

      async function assemble() {
        var lists = [arxivState.items].concat(s2States.map(function (s) { return s.items; }));
        var merged = PN.mergePapers(PN.interleave(lists));
        await enrich(merged);
        return { merged: merged, kept: PN.filterPapers(merged, fo) };
      }

      var round = 0;
      var assembled;
      for (;;) {
        round++;
        await fetchRound();
        assembled = await assemble();
        var more = !arxivState.done || s2States.some(function (s) { return !s.done; });
        if (assembled.kept.length >= limit || !more || round >= MAX_ROUNDS) break;
      }

      // 가져온 것이 하나도 없고 소스가 실패했다면 빈 결과가 아니라 오류로 알린다
      if (!assembled.merged.length && firstError) throw firstError;

      var papers = assembled.kept.slice(0, limit);
      var result = {
        papers: papers,
        warnings: warnings,
        meta: { rounds: round, requests: stats, shortfall: papers.length < limit, fetchedAt: startedAt.toISOString() }
      };
      if (!warnings.length) cache.set(key, result); // 일부 소스가 실패한 결과는 캐시하지 않는다
      return present(result, sort, false);
    }

    // 호출한 쪽이 결과를 바꿔도(예: 논문 객체에 "저장됨" 표시를 붙여도) 캐시가 오염되지 않도록 복사해서 돌려준다
    function present(result, sort, fromCache) {
      return {
        papers: PN.sortPapers(structuredClone(result.papers), sort, now()),
        warnings: structuredClone(result.warnings),
        meta: Object.assign({}, structuredClone(result.meta), { fromCache: fromCache })
      };
    }

    return { search: search };
  };
})(globalThis);
