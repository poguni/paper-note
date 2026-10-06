// arXiv 이용 약관: 요청은 3초에 1번, 연결은 1개. 같은 인스턴스에서 들어온 요청을 한 줄로 세워
// 최소 간격을 지킨다. (인스턴스가 여러 개이면 앱 쪽 대기열이 1차로 간격을 지킨다.)
export function createGate(minIntervalMs: number, now: () => number, sleep: (ms: number) => Promise<void>) {
  let tail: Promise<void> = Promise.resolve();
  let last = -Infinity;
  return function wait(): Promise<void> {
    const run = tail.then(async () => {
      const delay = last + minIntervalMs - now();
      if (delay > 0) await sleep(delay);
      last = now();
    });
    tail = run.catch(() => {});
    return run;
  };
}
