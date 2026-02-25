import { performance } from "node:perf_hooks";

export async function runLoadTest(config) {
  const {
    name,
    concurrency,
    totalRequests,
    requestFactory,
    onBeforeAll,
    onAfterAll
  } = config;

  if (typeof onBeforeAll === "function") {
    await onBeforeAll();
  }

  const stats = {
    name,
    total: 0,
    ok: 0,
    failed: 0,
    statusCounts: new Map(),
    latenciesMs: [],
    startedAt: new Date().toISOString(),
    finishedAt: null
  };

  let nextIndex = 0;

  async function worker(workerId) {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= totalRequests) return;

      const started = performance.now();
      try {
        const result = await requestFactory({ index: idx, workerId });
        const elapsed = performance.now() - started;
        stats.total += 1;
        stats.latenciesMs.push(elapsed);

        const status = Number(result?.status ?? 0);
        stats.statusCounts.set(status, Number(stats.statusCounts.get(status) ?? 0) + 1);
        if (result?.ok) stats.ok += 1;
        else stats.failed += 1;
      } catch {
        const elapsed = performance.now() - started;
        stats.total += 1;
        stats.failed += 1;
        stats.latenciesMs.push(elapsed);
        stats.statusCounts.set(0, Number(stats.statusCounts.get(0) ?? 0) + 1);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, (_, i) => worker(i));
  await Promise.all(workers);
  stats.finishedAt = new Date().toISOString();

  if (typeof onAfterAll === "function") {
    await onAfterAll(stats);
  }

  return summarizeStats(stats);
}

export function printSummary(summary) {
  const lines = [
    `Load test: ${summary.name}`,
    `Requests: ${summary.total} | OK: ${summary.ok} | Failed: ${summary.failed} | Success rate: ${summary.successRatePct}%`,
    `Latency ms: avg=${summary.latency.avg} p50=${summary.latency.p50} p90=${summary.latency.p90} p95=${summary.latency.p95} p99=${summary.latency.p99} max=${summary.latency.max}`,
    `Throughput: ${summary.rps} req/s`,
    `Statuses: ${summary.statusCounts.map((x) => `${x.status}:${x.count}`).join(", ") || "none"}`,
    `Started: ${summary.startedAt}`,
    `Finished: ${summary.finishedAt}`
  ];
  console.log(lines.join("\n"));
}

function summarizeStats(stats) {
  const lat = [...stats.latenciesMs].sort((a, b) => a - b);
  const durationMs =
    new Date(stats.finishedAt).getTime() - new Date(stats.startedAt).getTime() || 1;

  return {
    name: stats.name,
    total: stats.total,
    ok: stats.ok,
    failed: stats.failed,
    successRatePct: round2(stats.total > 0 ? (stats.ok / stats.total) * 100 : 0),
    rps: round2(stats.total / (durationMs / 1000)),
    latency: {
      avg: round2(avg(lat)),
      p50: round2(percentile(lat, 50)),
      p90: round2(percentile(lat, 90)),
      p95: round2(percentile(lat, 95)),
      p99: round2(percentile(lat, 99)),
      max: round2(lat[lat.length - 1] ?? 0)
    },
    statusCounts: [...stats.statusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => a.status - b.status),
    startedAt: stats.startedAt,
    finishedAt: stats.finishedAt
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function avg(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
