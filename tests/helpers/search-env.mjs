// 검색 모듈을 로드하고 예시 데이터(fixtures)를 읽는 시험용 도우미. (테스트 파일이 아니다)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

for (const f of ['terms', 'filter', 'arxiv', 's2', 'merge', 'sort', 'cache', 'queue', 'relay', 'search']) {
  await import(`../../src/js/search/${f}.js`);
}

export const PN = globalThis.PN;
export const fixture = (name) => readFileSync(join(root, 'tests', 'fixtures', name), 'utf8');
export const NOW = new Date('2026-10-05T12:00:00Z');
