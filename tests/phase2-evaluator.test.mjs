import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as flushAsync } from 'node:timers/promises';
import { LiveUsageBotProtection, evaluateProvisionalEvent, liveUsageBotProtection } from '../src/services/LiveUsageBotProtection.ts';
import { ProvisionalUsageService, provisionalDefaults, startProvisionalWorker } from '../src/services/ProvisionalUsageService.ts';

function startTestWorker(tick) {
  const previousMode = liveUsageBotProtection.options.mode;
  liveUsageBotProtection.options.mode = 'enforce';
  try {
    return startProvisionalWorker({ tick, options: { pollMs: 100 } });
  } finally {
    liveUsageBotProtection.options.mode = previousMode;
  }
}

test('stopping an idle provisional worker is repeatable and clears its polling timer', { timeout: 2000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0;
  const stop = startTestWorker(async () => { calls++; });
  await flushAsync();
  assert.equal(calls, 1);
  await stop();
  await stop();
  t.mock.timers.tick(1000);
  await flushAsync();
  assert.equal(calls, 1);
});

test('stopping the provisional worker waits for its active tick and prevents new ticks', { timeout: 2000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const tick = Promise.withResolvers();
  let calls = 0;
  const stop = startTestWorker(() => {
    calls++;
    return tick.promise;
  });
  try {
    assert.equal(calls, 1);
    let stopped = false;
    const drained = Promise.all([stop(), stop()]).then(() => { stopped = true; });
    t.mock.timers.tick(1000);
    await flushAsync();
    assert.equal(stopped, false);
    assert.equal(calls, 1);
    tick.resolve();
    await drained;
    t.mock.timers.tick(1000);
    await flushAsync();
    assert.equal(calls, 1);
  } finally {
    tick.resolve();
    await stop();
  }
});

const thresholds = new LiveUsageBotProtection({ mode: 'enforce' }).options;
const start = Date.now();
function observation(id, extra = {}) {
  return {
    id,
    sessionKey: 'session',
    networkKey: 'shared-campus',
    agentKey: 'privacy-browser',
    identityKey: `item-${id}`,
    kind: 'ENTRY_CLICK',
    initialDecision: 'ACCEPT',
    initialReason: 'ELIGIBLE_BROWSER_EVENT',
    sessionStartedAt: new Date(start),
    receivedAt: new Date(start + id * 50),
    reviewAfter: new Date(start + 120000),
    ...extra,
  };
}
const evaluate = (row, evidence, policy = {}) =>
  evaluateProvisionalEvent(row, evidence, thresholds, { ...provisionalDefaults, ...policy });
test('early events in a later demonstrated burst are all reviewed', () => {
  const rows = Array.from({ length: 20 }, (_, i) => observation(i));
  assert.ok(rows.every((row) => evaluate(row, rows).reason === 'RETROSPECTIVE_EVENT_BURST'));
});
test('slow 3–5 second browsing remains eligible; regularity alone is insufficient', () => {
  const rows = Array.from({ length: 20 }, (_, i) => observation(i, { receivedAt: new Date(start + i * 4000) }));
  assert.ok(rows.every((row) => evaluate(row, rows).decision === 'ACCEPT'));
});
test('20 newly issued sessions at one IP do not prove coordination', () => {
  const rows = Array.from({ length: 20 }, (_, i) => observation(i, { sessionKey: `student-${i}` }));
  assert.ok(rows.every((row) => evaluate(row, rows).decision === 'ACCEPT'));
});
test('legitimate repeat/external/search interactions preserve distinct semantics', () => {
  const rows = ['ENTRY_CLICK', 'EXTERNAL_CLICK', 'WEB_SEARCH', 'ENTRY_CLICK'].map((kind, i) =>
    observation(i, { kind, identityKey: 'same' }),
  );
  assert.ok(rows.every((row) => evaluate(row, rows).decision === 'ACCEPT'));
});
test('burst boundary: 12 are eligible in isolation, the 13th supplies evidence', () => {
  const rows = Array.from({ length: 13 }, (_, i) => observation(i));
  assert.equal(evaluate(rows[0], rows.slice(0, 12)).decision, 'ACCEPT');
  assert.equal(evaluate(rows[0], rows).decision, 'REVIEW');
});
test('late evidence beyond a row review horizon cannot alter its classification', () => {
  const target = observation(0, { reviewAfter: new Date(start + 10) });
  const rows = [target, ...Array.from({ length: 20 }, (_, i) => observation(i + 1))];
  assert.equal(evaluate(target, rows).decision, 'ACCEPT');
});
function coordinated() {
  return Array.from({ length: 5 }, (_, s) =>
    Array.from({ length: 5 }, (_, i) =>
      observation(s * 5 + i, {
        sessionKey: `s-${s}`,
        identityKey: `shared-${i}`,
        receivedAt: new Date(start + i * 2000 + s * 50),
      }),
    ),
  ).flat();
}
test('matching sequences record nonblocking coordination only for participating entries', () => {
  const rows = coordinated();
  const bystander = observation(100, { sessionKey: 'bystander', identityKey: 'different' });
  assert.ok(rows.every((row) => evaluate(row, [...rows, bystander]).reason === 'COORDINATION_OBSERVED'));
  assert.ok(rows.every((row) => evaluate(row, rows).decision === 'ACCEPT'));
  assert.equal(evaluate(bystander, [...rows, bystander]).reason, 'REVIEW_WINDOW_ELIGIBLE');
});
test('shared items without timing correlation, or with different order, stay eligible', () => {
  const rows = coordinated();
  const shifted = rows.map((row) => ({
    ...row,
    receivedAt: new Date(row.receivedAt.getTime() + Number(row.sessionKey.slice(2)) * 3000),
  }));
  assert.ok(shifted.every((row) => evaluate(row, shifted).decision === 'ACCEPT'));
  const differentOrder = rows.map((row) => ({ ...row, identityKey: `${row.sessionKey}-${row.identityKey}` }));
  assert.ok(differentOrder.every((row) => evaluate(row, differentOrder).decision === 'ACCEPT'));
});
test('identical synchronized professor and automated traces are intentionally both accepted', () => {
  const humanGroundTruth = coordinated();
  // These humans and the previous automated fixture expose identical evidence.
  for (const trace of [humanGroundTruth, structuredClone(humanGroundTruth)]) {
    assert.equal(trace.filter((row) => evaluate(row, trace).decision === 'ACCEPT').length, 25);
    assert.ok(trace.every((row) => evaluate(row, trace).reason === 'COORDINATION_OBSERVED'));
  }
});
test('an IP-only review never taints other students or all previous events', () => {
  const student = observation(0);
  const ipReview = observation(1, { sessionKey: 'other', initialDecision: 'REVIEW', initialReason: 'IP_RATE' });
  assert.equal(evaluate(student, [student, ipReview]).decision, 'ACCEPT');
  assert.deepEqual(evaluate(ipReview, [student, ipReview]), { decision: 'REVIEW', reason: 'IP_RATE' });
});
test('User-Agent changes and high-confidence automation taint pending session only', () => {
  for (const reason of ['KNOWN_AUTOMATION', 'SESSION_UA_CHANGED', 'SESSION_ABUSE']) {
    const early = observation(0),
      later = observation(1, { initialReason: reason, initialDecision: 'REJECT' });
    assert.equal(evaluate(early, [early, later]).reason, `RETROSPECTIVE_${reason}`);
  }
  const early = observation(0);
  assert.equal(
    evaluate(early, [early, observation(1, { agentKey: 'rotated' })]).reason,
    'RETROSPECTIVE_SESSION_UA_CHANGED',
  );
});
test('explicit rejection is never upgraded, including before delayed assessment', () => {
  const row = observation(0, { initialDecision: 'REJECT', initialReason: 'KNOWN_AUTOMATION' });
  assert.equal(evaluate(row, [row]).decision, 'REJECT');
});
test('provisional configuration requires stable secret and coherent retention/deadlines', () => {
  const secret = 'phase2-test-key-with-at-least-32-bytes';
  assert.throws(() => new ProvisionalUsageService({}, 'short', thresholds));
  for (const options of [
    { reviewWindowMs: 0 },
    { deadlineMs: 100 },
    { retentionMs: 100 },
    { retentionMs: 120000 }, // Tombstones must outlive valid credentials.

    { coordinatedSessions: 1 },
    { sequenceLength: 1 },
  ])
    assert.throws(() => new ProvisionalUsageService({}, secret, thresholds, options));
});
test('stage sends only keyed identifiers and erases payloads for withheld evidence', async () => {
  let stored;
  const store = {
    stage: async (row) => {
      stored = row;
      return { row, duplicate: false };
    },
  };
  const service = new ProvisionalUsageService(
    {},
    'phase2-test-key-with-at-least-32-bytes',
    thresholds,
    {},
    () => start,
    store,
  );
  const input = {
    sessionId: 'private-cookie',
    sessionStartedAt: start,
    eventId: 'validEventId123456',
    ip: '192.0.2.1',
    userAgent: 'private-ua',
    identity: 'private-query',
    kind: 'WEB_SEARCH',
    decision: { decision: 'REVIEW', reason: 'IP_RATE' },
    payload: { kind: 'WEB_SEARCH', query: 'private-query', catalogType: 'SLC_ITEM' },
  };
  assert.equal((await service.stage(input)).counted, false);
  for (const secret of ['private-cookie', '192.0.2.1', 'private-ua', 'private-query', input.eventId])
    assert.ok(!JSON.stringify(stored).includes(secret));
  assert.equal(stored.payload, null);
  assert.equal(stored.status, 'REVIEW');
});

test('cohort navigation does not propagate to external clicks or WEB searches; independent bursts still apply', () => {
  const rows = coordinated();
  const actions = ['EXTERNAL_CLICK', 'WEB_SEARCH'].map((kind, i) => observation(100 + i, { kind, sessionKey: 's-0' }));
  for (const row of actions)
    assert.deepEqual(evaluate(row, [...rows, ...actions]), { decision: 'ACCEPT', reason: 'REVIEW_WINDOW_ELIGIBLE' });
  const burst = Array.from({ length: 20 }, (_, i) => observation(200 + i, { sessionKey: 's-0' }));
  for (const row of [...rows.filter((r) => r.sessionKey === 's-0'), ...actions])
    assert.equal(evaluate(row, [...rows, ...actions, ...burst]).decision, 'REVIEW');
});
