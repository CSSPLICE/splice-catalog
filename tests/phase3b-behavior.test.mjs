import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SessionBehaviorObserver, behaviorExperiment } from '../src/analysis/SessionBehaviorObserver.ts';
import { fixtures, measureFixture, trace, snapshot, epoch, keyed } from './helpers/phase3b-fixtures.mjs';

for (const fixture of fixtures())
  test(`${fixture.name}: observations preserve baseline decisions`, () => {
    const { before, after, analyses, summary } = measureFixture(fixture);
    assert.deepEqual(after, before);
    assert.ok(analyses.every((a, i) => a.asOfMs === fixture.rows[i].reviewAfter.getTime()));
    for (const analysis of analyses)
      for (const window of analysis.windows)
        for (const observation of window.observations) {
          assert.equal(observation.sampleCount, window.features.sampleCount);
          assert.equal(observation.windowMs, window.windowMs);
          assert.ok(observation.explanation.length > 50);
        }
    const expected =
      fixture.name === 'rapid-burst-regression'
        ? 'REVIEW'
        : fixture.name === 'explicit-rejection-control'
          ? 'REJECTED'
          : 'ACCEPTED';
    assert.deepEqual(summary.statuses, { [expected]: fixture.rows.length });
    assert.ok(fixture.rows.every((row) => row.receivedAt - row.sessionStartedAt < 30 * 60_000));
    if (fixture.name === 'slow-20-3-to-5s' || fixture.name === 'professor-course-preparation')
      assert.equal(summary.observationCount, 0);
    if (/sustained|randomized|long-script/.test(fixture.name)) assert.ok(summary.observations.SUSTAINED_ACTIVITY > 0);
    if (/long-script|legitimate-repeated/.test(fixture.name)) assert.ok(summary.observations.REPEATED_TRAVERSAL > 0);
    if (fixture.name === 'randomized-slow-seed-7-17') assert.equal(summary.observations.REGULAR_CADENCE ?? 0, 0);
  });

test('identical professor and bot labels cannot change any feature, explanation or decision', () => {
  const cases = fixtures(),
    human = measureFixture(cases.find((f) => f.name === 'professor-intensive-matched')),
    bot = measureFixture(cases.find((f) => f.name === 'bot-intensive-matched'));
  assert.deepEqual(human.analyses, bot.analyses);
  assert.deepEqual(human.before, bot.before);
  assert.ok(human.summary.behavioralWouldFlagEvents > 0);
});

test('closed historical windows use reviewAfter, including their boundaries and no later evidence', () => {
  const target = trace(1, 0)[0],
    end = target.reviewAfter.getTime();
  const at = (id, offset) => ({
    ...target,
    id,
    receivedAt: new Date(end + offset),
    reviewAfter: new Date(end + offset + 120_000),
  });
  const evidence = [target, at(2, -900_001), at(3, -900_000), at(4, -300_001), at(5, -300_000), at(6, 0), at(7, 1)];
  const analysis = new SessionBehaviorObserver(evidence).analyze(target);
  assert.equal(analysis.windows[0].features.sampleCount, 3);
  assert.equal(analysis.windows[1].features.sampleCount, 5);
  assert.deepEqual(analysis, new SessionBehaviorObserver(evidence.slice(0, -1)).analyze(target));
  // Earlier target receipt + later evidence inside its 120s review is intentionally visible.
  assert.equal(analysis.windows[0].features.spanMs, 300_000);
});

test('old traversal expires, unrelated sessions do not contribute, and input order is immaterial', () => {
  const rows = trace(240, 4000),
    target = rows.at(-1);
  const observer = new SessionBehaviorObserver(rows, snapshot());
  const expected = observer.analyze(target);
  assert.equal(expected.windows[0].features.sampleCount, 46); // Review cutoff is 120s after last receipt.
  const foreign = rows.map((row) => ({
    ...row,
    id: row.id + 1000,
    sessionKey: keyed('other'),
  }));
  assert.deepEqual(new SessionBehaviorObserver([...foreign, ...rows].reverse(), snapshot()).analyze(target), expected);
  const muchLater = {
    ...target,
    id: 300,
    receivedAt: new Date(epoch + 4_000_000),
    reviewAfter: new Date(epoch + 4_120_000),
  };
  assert.equal(new SessionBehaviorObserver([...rows, muchLater]).analyze(muchLater).windows[1].features.sampleCount, 1);
});

test('durable row dedup differs from deliberate new same-resource interactions; conflicting IDs fail', () => {
  const rows = trace(3, 4000, () => 0),
    target = rows[0];
  const result = new SessionBehaviorObserver([...rows, structuredClone(rows[0])]).analyze(target);
  assert.equal(result.windows[0].features.sampleCount, 3);
  assert.equal(result.windows[0].features.repeatedEntryEvents, 2);
  assert.throws(
    () => new SessionBehaviorObserver([...rows, { ...target, identityKey: keyed('conflict') }]),
    /CONFLICTING_LEDGER_ID/,
  );
});

test('kind identities stay separate; only entries contribute traversal and catalog coverage', () => {
  const rows = trace(
    3,
    4000,
    () => 0,
    (i) => ['ENTRY_CLICK', 'EXTERNAL_CLICK', 'WEB_SEARCH'][i],
  );
  rows.forEach((r) => {
    r.identityKey = keyed('same-key-for-test');
  });
  const result = new SessionBehaviorObserver(rows, {
    asOf: new Date(epoch),
    entryIdentityKeys: [rows[0].identityKey],
  }).analyze(rows[0]).windows[0];
  assert.equal(result.features.distinctKindIdentities, 3);
  assert.deepEqual(result.features.byKind, {
    ENTRY_CLICK: 1,
    EXTERNAL_CLICK: 1,
    WEB_SEARCH: 1,
  });
  assert.equal(result.features.distinctEntries, 1);
  assert.equal(result.features.coverageFraction, 1);
  assert.equal(result.observations.length, 0); // Minimum 20 covered entries.
});

test('coverage uses a fixed known eligible snapshot as of review, with missing/empty/future denominators unknown', () => {
  const rows = trace(100, 4000),
    target = rows[70];
  const base = new SessionBehaviorObserver(rows, snapshot()).analyze(target).windows[1];
  assert.equal(base.features.coverageFraction, 1);
  assert.ok(base.observations.some((o) => o.pattern === 'BROAD_RESOURCE_COVERAGE'));
  for (const catalog of [
    undefined,
    { ...snapshot(), entryIdentityKeys: [] },
    { ...snapshot(), asOf: new Date(target.reviewAfter.getTime() + 1) },
  ])
    assert.equal(new SessionBehaviorObserver(rows, catalog).analyze(target).windows[1].features.coverageFraction, null);
  const subset = new SessionBehaviorObserver(rows, snapshot(20)).analyze(target).windows[1].features;
  assert.equal(subset.coveredCatalogEntries, 20);
  assert.equal(subset.entriesOutsideCatalog, 80);
});

test('motifs require five distinct entries and three nonoverlapping repeats; tie order uses ledger ID', () => {
  const rows = trace(15, 4000, (i) => i % 5);
  const observer = new SessionBehaviorObserver(rows);
  assert.equal(observer.analyze(rows[0]).windows[0].features.maxNonoverlappingMotifOccurrences, 3);
  const two = rows.slice(0, 10);
  assert.ok(
    !new SessionBehaviorObserver(two)
      .analyze(two[0])
      .windows[0].observations.some((o) => o.pattern === 'REPEATED_TRAVERSAL'),
  );
  const same = trace(30, 4000, () => 0);
  assert.equal(
    new SessionBehaviorObserver(same).analyze(same[0]).windows[0].features.maxNonoverlappingMotifOccurrences,
    0,
  );
  const tied = rows.map((r) => ({
    ...r,
    receivedAt: new Date(epoch),
    reviewAfter: new Date(epoch + 120_000),
  }));
  assert.deepEqual(
    new SessionBehaviorObserver(tied).analyze(tied[0]),
    new SessionBehaviorObserver([...tied].reverse()).analyze(tied[0]),
  );
});

test('window capacity is explicit, does not emit partial patterns, and never crowds out another session', () => {
  const rows = trace(5001, 1),
    result = new SessionBehaviorObserver(rows).analyze(rows[0]);
  for (const window of result.windows) {
    assert.equal(window.status, 'WINDOW_CAPACITY');
    assert.equal(window.availableRows, 5001);
    assert.equal(window.features, null);
    assert.deepEqual(window.observations, []);
  }
  const bystander = { ...rows[0], id: 6000, sessionKey: keyed('bystander') };
  assert.equal(new SessionBehaviorObserver([...rows, bystander]).analyze(bystander).windows[0].features.sampleCount, 1);
  const boundary = rows.slice(0, 5000);
  assert.equal(new SessionBehaviorObserver(boundary).analyze(boundary[0]).windows[0].status, 'COMPLETE_INPUT');
});

test('capacity is independent per historical window and repeated reviews retain no observation state', () => {
  const rows = trace(5001, 100),
    target = rows.at(-1);
  const observer = new SessionBehaviorObserver(rows);
  const result = observer.analyze(target);
  assert.equal(result.windows[0].status, 'COMPLETE_INPUT');
  assert.equal(result.windows[0].features.sampleCount, 1801);
  assert.equal(result.windows[1].status, 'WINDOW_CAPACITY');
  assert.deepEqual(observer.analyze(target), result);
});

test('input, catalog, timestamp and target validation cannot silently truncate or invent evidence', () => {
  const row = trace(1, 0)[0];
  assert.throws(
    () => new SessionBehaviorObserver(Array(behaviorExperiment.maxInputRows + 1).fill(row)),
    /INPUT_CAPACITY/,
  );
  assert.throws(
    () =>
      new SessionBehaviorObserver([row], {
        ...snapshot(),
        entryIdentityKeys: Array(50_001).fill(keyed('item')),
      }),
    /CATALOG_CAPACITY/,
  );
  for (const extra of [
    { receivedAt: new Date(NaN) },
    { reviewAfter: new Date(epoch - 1) },
    { kind: 'UNKNOWN' },
    { sessionKey: '' },
  ])
    assert.throws(() => new SessionBehaviorObserver([{ ...row, ...extra }]));
  assert.throws(
    () =>
      new SessionBehaviorObserver([row]).analyze({
        ...row,
        reviewAfter: new Date(epoch + 1),
      }),
    /TARGET_NOT_IN_EVIDENCE/,
  );
});

test('sustained activity needs historical span and occupied buckets; a long idle session is not sustained', () => {
  const short = trace(60, 4000);
  const observer = new SessionBehaviorObserver(short);
  // At the first review only 124 seconds of receipt history exist, despite a high cadence.
  assert.ok(!observer.analyze(short[0]).windows[0].observations.some((o) => o.pattern === 'SUSTAINED_ACTIVITY'));
  const dense = trace(240, 4000);
  assert.ok(
    new SessionBehaviorObserver(dense)
      .analyze(dense[100])
      .windows[0].observations.some((o) => o.pattern === 'SUSTAINED_ACTIVITY'),
  );
  const idle = trace(100, (i) => (i === 50 ? 300_000 : 4000));
  const result = new SessionBehaviorObserver(idle).analyze(idle[50]);
  assert.ok(result.windows.every((window) => !window.observations.some((o) => o.pattern === 'SUSTAINED_ACTIVITY')));
});

test('source mutation, status changes, labels and sensitive payloads do not affect observations or leak into output', () => {
  const rows = trace(100, 4000),
    original = structuredClone(rows),
    catalog = snapshot();
  const observer = new SessionBehaviorObserver(rows, catalog),
    expected = observer.analyze(rows[0]);
  rows[1].receivedAt.setTime(0);
  catalog.entryIdentityKeys.length = 0;
  assert.deepEqual(observer.analyze(original[0]), expected);
  const decorated = original.map((row) => ({
    ...row,
    status: 'REJECTED',
    label: 'bot',
    payload: 'private-query',
    ip: '192.0.2.1',
    token: 'private-token',
  }));
  assert.deepEqual(new SessionBehaviorObserver(decorated, snapshot()).analyze(decorated[0]), expected);
  const output = JSON.stringify(expected);
  for (const value of ['private-query', '192.0.2.1', 'private-token', original[0].sessionKey, original[0].identityKey])
    assert.ok(!output.includes(value));
});
