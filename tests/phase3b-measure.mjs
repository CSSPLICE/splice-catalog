// Run only through measure:phase3b: synthetic arrays, no server, DB or network.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { SessionBehaviorObserver, behaviorExperiment } from '../src/analysis/SessionBehaviorObserver.ts';
import { evaluateProvisionalEvent } from '../src/services/LiveUsageBotProtection.ts';
import {
  fixtures,
  measureFixture,
  trace,
  snapshot,
  keyed,
  thresholds,
  coordination,
} from './helpers/phase3b-fixtures.mjs';

function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (q) => sorted[Math.ceil(q * sorted.length) - 1];
  return {
    n: sorted.length,
    p50Ms: p(0.5),
    p95Ms: p(0.95),
    p99Ms: p(0.99),
    maxMs: sorted.at(-1),
  };
}
function timedCalls(targets, fn) {
  const cpu = process.cpuUsage(),
    start = performance.now(),
    samples = [];
  for (const target of targets) {
    const before = performance.now();
    fn(target);
    samples.push(performance.now() - before);
  }
  const elapsedMs = performance.now() - start,
    used = process.cpuUsage(cpu);
  return {
    ...percentiles(samples),
    elapsedMs,
    callsPerSecond: (targets.length * 1000) / elapsedMs,
    cpuMs: (used.user + used.system) / 1000,
  };
}
function benchmark(size) {
  const groups = new Map(),
    rows = [];
  for (let s = 0; s < size / 100; s++) {
    const session = trace(100, 4000).map((row) => ({
      ...row,
      id: s * 100 + row.id,
      sessionKey: keyed(`session-${s}`),
    }));
    groups.set(session[0].sessionKey, session);
    rows.push(...session);
  }
  const catalog = snapshot();
  global.gc?.();
  const memoryBefore = process.memoryUsage(),
    cpuBefore = process.cpuUsage(),
    indexStart = performance.now();
  const observer = new SessionBehaviorObserver(rows, catalog);
  const indexMs = performance.now() - indexStart,
    indexCpu = process.cpuUsage(cpuBefore);
  global.gc?.();
  const memoryIndexed = process.memoryUsage();
  const targets = Array.from({ length: 1000 }, (_, i) => rows[(i * 97) % rows.length]);
  for (const target of targets.slice(0, 100)) observer.analyze(target);
  const baseline = timedCalls(targets, (target) =>
    evaluateProvisionalEvent(target, groups.get(target.sessionKey), thresholds, coordination),
  );
  const extraction = timedCalls(targets, (target) => observer.analyze(target));
  global.gc?.();
  const memoryAfter = process.memoryUsage();
  return {
    inputRows: size,
    sessions: groups.size,
    indexMs,
    indexCpuMs: (indexCpu.user + indexCpu.system) / 1000,
    indexedHeapDeltaBytes: memoryIndexed.heapUsed - memoryBefore.heapUsed,
    heapAfterQueriesDeltaBytes: memoryAfter.heapUsed - memoryIndexed.heapUsed,
    rssBeforeBytes: memoryBefore.rss,
    rssIndexedBytes: memoryIndexed.rss,
    rssAfterQueriesBytes: memoryAfter.rss,
    baseline,
    extraction,
  };
}
const scenarios = fixtures().map((fixture) => {
  const result = measureFixture(fixture);
  assert.deepEqual(result.before, result.after);
  return result.summary;
});
const metrics = {};
for (const label of ['professor', 'bot']) {
  const selected = scenarios.filter((s) => s.label === label);
  metrics[label] = {
    events: selected.reduce((sum, s) => sum + s.events, 0),
    accepted: selected.reduce((sum, s) => sum + (s.statuses.ACCEPTED ?? 0), 0),
    review: selected.reduce((sum, s) => sum + (s.statuses.REVIEW ?? 0), 0),
    rejected: selected.reduce((sum, s) => sum + (s.statuses.REJECTED ?? 0), 0),
    behavioralWouldFlagEvents: selected.reduce((sum, s) => sum + s.behavioralWouldFlagEvents, 0),
  };
}
const capacity = trace(5001, 1),
  capacityObserver = new SessionBehaviorObserver(capacity);
const fullWindow = trace(5000, 1),
  fullWindowObserver = new SessionBehaviorObserver(fullWindow, snapshot());
const fullWindowTiming = timedCalls(Array(100).fill(fullWindow[0]), (target) => {
  assert.ok(fullWindowObserver.analyze(target).windows.every((w) => w.features.sampleCount === 5000));
});
const capacityTiming = timedCalls(Array(1000).fill(capacity[0]), (target) => {
  assert.ok(capacityObserver.analyze(target).windows.every((w) => w.status === 'WINDOW_CAPACITY'));
});
console.log(
  JSON.stringify(
    {
      version: behaviorExperiment.version,
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0].model,
        gcExposed: !!global.gc,
      },
      measurement:
        'virtual event times; offline baseline statuses, no official writes; per-review observations may repeat across overlapping windows',
      parameters: behaviorExperiment,
      scenarios,
      metrics,
      performance: [benchmark(10_000), benchmark(100_000)],
      fullWindowTiming,
      capacityTiming,
    },
    null,
    2,
  ),
);
