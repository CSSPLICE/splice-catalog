import { createHmac } from 'node:crypto';
import { LiveUsageBotProtection, evaluateProvisionalEvent } from '../../src/services/LiveUsageBotProtection.ts';
import { SessionBehaviorObserver } from '../../src/analysis/SessionBehaviorObserver.ts';

export const epoch = Date.UTC(2026, 10, 8, 12);
export const keyed = (value) => createHmac('sha256', 'phase3b-disposable-fixture-key').update(value).digest('hex');
export const thresholds = new LiveUsageBotProtection({ mode: 'enforce' }).options;
export const coordination = {
  coordinatedSessions: 4,
  sequenceLength: 5,
  synchronyMs: 750,
  freshSessionMs: 30_000,
};
export function random(seed) {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
export function trace(count, gap, resource = (i) => i % 100, kind = () => 'ENTRY_CLICK') {
  let at = epoch;
  return Array.from({ length: count }, (_, i) => {
    if (i) at += typeof gap === 'function' ? gap(i) : gap;
    const eventKind = kind(i);
    return {
      id: i + 1,
      sessionKey: keyed('session'),
      networkKey: keyed('campus'),
      agentKey: keyed('browser'),
      identityKey: keyed(`${eventKind}:${resource(i)}`),
      kind: eventKind,
      receivedAt: new Date(at),
      reviewAfter: new Date(at + 120_000),
      sessionStartedAt: new Date(epoch),
      initialDecision: 'ACCEPT',
      initialReason: 'ELIGIBLE_BROWSER_EVENT',
    };
  });
}
export function snapshot(size = 100) {
  return {
    asOf: new Date(epoch - 1),
    entryIdentityKeys: Array.from({ length: size }, (_, i) => keyed(`ENTRY_CLICK:${i}`)),
  };
}
export function fixtures() {
  const jitter = random(7),
    choices = random(17),
    professor = random(31),
    held = random(71),
    heldItems = random(97);
  const matched = trace(240, 4000);
  return [
    {
      name: 'slow-20-3-to-5s',
      label: 'bot',
      rows: trace(20, (i) => [3000, 4000, 5000][i % 3]),
    },
    {
      name: 'sustained-3-to-5s',
      label: 'bot',
      rows: trace(240, (i) => [3000, 4000, 5000][i % 3]),
    },
    {
      name: 'randomized-slow-seed-7-17',
      label: 'bot',
      rows: trace(
        240,
        () => 3000 + Math.floor(jitter() * 2001),
        () => Math.floor(choices() * 100),
      ),
    },
    {
      name: 'long-script-24m',
      label: 'bot',
      rows: trace(360, 4000, (i) => i % 30),
    },
    {
      name: 'professor-course-preparation',
      label: 'professor',
      rows: trace(
        90,
        () => 8000 + Math.floor(professor() * 20001),
        (i) => Math.floor(i / 3) % 30,
        (i) => ['ENTRY_CLICK', 'EXTERNAL_CLICK', 'WEB_SEARCH'][i % 3],
      ),
    },
    {
      name: 'legitimate-repeated-interactions',
      label: 'professor',
      rows: trace(90, 15_000, (i) => i % 5),
    },
    {
      name: 'professor-intensive-matched',
      label: 'professor',
      rows: structuredClone(matched),
    },
    {
      name: 'bot-intensive-matched',
      label: 'bot',
      rows: structuredClone(matched),
    },
    { name: 'rapid-burst-regression', label: 'bot', rows: trace(20, 50) },
    {
      name: 'explicit-rejection-control',
      label: 'bot',
      rows: trace(1, 0).map((r) => ({
        ...r,
        initialDecision: 'REJECT',
        initialReason: 'KNOWN_AUTOMATION',
      })),
    },
    // Frozen parameters are also evaluated on a new seed, catalog size and interval range.
    {
      name: 'held-out-random-seed-71-97',
      label: 'bot',
      rows: trace(
        200,
        () => 3500 + Math.floor(held() * 2001),
        () => Math.floor(heldItems() * 137),
      ),
      catalogSize: 137,
    },
    {
      name: 'held-out-professor-catalog-audit',
      label: 'professor',
      rows: trace(137, 6000, (i) => i),
      catalogSize: 137,
    },
  ];
}
export function baseline(rows) {
  return rows.map((row) => {
    const decision = evaluateProvisionalEvent(row, rows, thresholds, coordination);
    return {
      status: { ACCEPT: 'ACCEPTED', REVIEW: 'REVIEW', REJECT: 'REJECTED' }[decision.decision],
      reason: decision.reason,
    };
  });
}
export function measureFixture(fixture) {
  const { rows } = fixture,
    before = baseline(rows);
  const observer = new SessionBehaviorObserver(rows, snapshot(fixture.catalogSize ?? 100));
  const analyses = rows.map((row) => observer.analyze(row));
  const observations = {},
    byWindow = {},
    statuses = {},
    flagged = new Set();
  let observedEvents = 0;
  analyses.forEach((analysis, i) => {
    let observed = false;
    for (const window of analysis.windows)
      for (const observation of window.observations) {
        observations[observation.pattern] = (observations[observation.pattern] ?? 0) + 1;
        const key = `${window.windowMs / 60_000}m:${observation.pattern}`;
        byWindow[key] = (byWindow[key] ?? 0) + 1;
        observed = true;
        if (observation.pattern !== 'REGULAR_CADENCE') flagged.add(i);
      }
    observedEvents += Number(observed);
    statuses[before[i].status] = (statuses[before[i].status] ?? 0) + 1;
  });
  return {
    before,
    after: baseline(rows),
    analyses,
    summary: {
      name: fixture.name,
      label: fixture.label,
      events: rows.length,
      spanSeconds: (rows.at(-1).receivedAt - rows[0].receivedAt) / 1000,
      statuses,
      observedEvents,
      behavioralWouldFlagEvents: flagged.size,
      observationCount: Object.values(observations).reduce((sum, n) => sum + n, 0),
      observations,
      byWindow,
    },
  };
}
