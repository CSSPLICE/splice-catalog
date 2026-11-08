// Disposable arrays only; no database, browser, server or external service.
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { campaignExperiment, observeCampaigns } from '../src/analysis/CampaignObserver.ts';
import { campaignFixtures, campaignRows, requestFor, measureCampaign } from './helpers/phase3c-fixtures.mjs';
import { epoch, keyed } from './helpers/phase3b-fixtures.mjs';

function sample(rows, request, calls) {
  for (let i = 0; i < 3; i++) observeCampaigns(rows, request);
  global.gc?.();
  const before = process.memoryUsage(),
    cpuStart = process.cpuUsage(),
    start = performance.now(),
    times = [];
  let peakSampledHeap = before.heapUsed,
    result;
  for (let i = 0; i < calls; i++) {
    const at = performance.now();
    result = observeCampaigns(rows, request);
    times.push(performance.now() - at);
    peakSampledHeap = Math.max(peakSampledHeap, process.memoryUsage().heapUsed);
  }
  const wallMs = performance.now() - start,
    cpu = process.cpuUsage(cpuStart),
    after = process.memoryUsage();
  global.gc?.();
  const retained = process.memoryUsage();
  times.sort((a, b) => a - b);
  const percentile = (q) => times[Math.ceil(q * calls) - 1];
  return {
    inputRows: rows.length,
    inputSessions: new Set(rows.map((r) => r.sessionKey)).size,
    calls,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: times.at(-1),
    wallMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
    sampledHeapGrowthBytes: peakSampledHeap - before.heapUsed,
    retainedHeapDeltaBytes: retained.heapUsed - before.heapUsed,
    rssBeforeBytes: before.rss,
    rssAfterBytes: after.rss,
    outputBytes: Buffer.byteLength(JSON.stringify(result)),
    windows: result.windows.map((w) => ({
      windowMs: w.windowMs,
      status: w.status,
      issues: w.issues,
      availableRows: w.availableRows,
      metrics: w.metrics,
      observations: w.observations.length,
      work: w.work,
    })),
  };
}
const scenarios = campaignFixtures().map((fixture) => {
  const result = measureCampaign(fixture);
  assert.deepEqual(result.before, result.after);
  return result.summary;
});
const performanceResults = [];
for (const sessions of [100, 500, 1000, 2000]) {
  const rows = campaignRows({ sessions, count: 10, gap: 1000, offset: () => 0 });
  const measured = sample(rows, requestFor(rows), 25);
  assert.ok(measured.windows.every((w) => w.status === 'COMPLETE'));
  performanceResults.push(measured);
}
const active = campaignRows({ sessions: 2000, count: 10, gap: 1000, offset: () => 0 });
const old = campaignRows({ sessions: 8000, count: 10, gap: 1000, offset: () => 0 }).map((row) => ({
  ...row,
  id: row.id + 20_000,
  sessionKey: keyed(`old-session:${row.sessionKey}`),
  receivedAt: new Date(epoch - 2_000_000),
}));
const retainedInput = sample([...old, ...active], requestFor(active), 25);
const saturated = campaignRows({ sessions: 2001, count: 10, gap: 1000, offset: () => 0 });
const saturatedTiming = sample(saturated, requestFor(saturated), 25);
assert.ok(retainedInput.windows.every((w) => w.status === 'COMPLETE'));
assert.ok(saturatedTiming.windows.every((w) => w.status === 'CAPACITY' && w.observations === 0));
const uniqueRows = campaignRows({
  sessions: 100,
  count: 104,
  gap: 1,
  offset: () => 0,
  resource: (s, i) => s * 104 + i,
});
const uniqueMotifTiming = sample(uniqueRows, requestFor(uniqueRows), 25);
assert.ok(uniqueMotifTiming.windows.every((w) => w.status === 'COMPLETE' && w.work.distinctMotifs === 10_000));
const excessMotifs = campaignRows({
  sessions: 100,
  count: 105,
  gap: 1,
  offset: () => 0,
  resource: (s, i) => s * 105 + i,
});
const motifCapacityTiming = sample(excessMotifs, requestFor(excessMotifs), 25);
assert.ok(
  motifCapacityTiming.windows.every(
    (w) => w.status === 'CAPACITY' && w.issues.includes('MOTIF_CAPACITY') && w.observations === 0,
  ),
);
const groups = {};
for (const label of ['bot', 'professor']) {
  const selected = scenarios.filter((s) => s.label === label);
  groups[label] = {
    fixtures: selected.length,
    campaignLikeFixtures: selected.filter((s) => s.campaignLike).length,
    campaignObservations: selected.reduce(
      (sum, s) => sum + s.windows.reduce((n, w) => n + w.observations.length, 0),
      0,
    ),
  };
}
console.log(
  JSON.stringify(
    {
      version: campaignExperiment.version,
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0].model,
        gcExposed: !!global.gc,
      },
      interpretation:
        'Campaign observations are aggregate patterns, never event-level bot detection. Synthetic network keys are not verified addresses. All event times are virtual.',
      parameters: campaignExperiment,
      scenarios,
      groups,
      performance: performanceResults,
      retainedInput,
      saturatedTiming,
      uniqueMotifTiming,
      motifCapacityTiming,
    },
    null,
    2,
  ),
);
