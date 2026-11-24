import assert from 'node:assert/strict';
import { test } from 'node:test';
import { campaignExperiment as p, observeCampaigns } from '../src/analysis/CampaignObserver.ts';
import { campaignFixtures, campaignRows, requestFor, measureCampaign } from './helpers/phase3c-fixtures.mjs';
import { epoch, keyed, snapshot } from './helpers/phase3b-fixtures.mjs';

const synchronized = ['SHARED_ENTRY_SEQUENCES', 'SYNCHRONIZED_TRAVERSAL'];
for (const fixture of campaignFixtures())
  test(`${fixture.name}: campaign evidence preserves existing decisions`, () => {
    const { before, after, analysis, summary } = measureCampaign(fixture);
    assert.deepEqual(after, before);
    assert.equal(summary.phase3b.behavioralReviews, 0);
    const expected = /scripted|synchronized-professor/.test(fixture.name)
      ? synchronized
      : /partitioned|different-professor-topics/.test(fixture.name)
        ? ['DISTRIBUTED_CATALOG_COVERAGE']
        : fixture.name === 'delayed-identical-sequences'
          ? ['SHARED_ENTRY_SEQUENCES']
          : [];
    assert.deepEqual(Object.keys(summary.patterns).sort(), [...expected].sort());
    for (const window of analysis.windows) {
      assert.equal(window.status, 'COMPLETE');
      assert.ok(window.observations.length <= 3);
      assert.equal(window.work.pairwiseComparisons, 0);
      for (const observation of window.observations) {
        assert.equal(observation.entryEvents, window.metrics.entryEvents);
        assert.equal(observation.entrySessions, window.metrics.entrySessions);
        assert.ok(observation.explanation.length > 90);
        assert.ok(observation.limitations.length >= 3);
      }
    }
  });

test('identical professor and bot evidence yields identical complete output, including explanations and keys', () => {
  const cases = campaignFixtures();
  for (const [bot, professor] of [
    ['scripted-shared-network', 'synchronized-professor-demo'],
    ['partitioned-traversal', 'different-professor-topics'],
    ['randomized-order-and-delay', 'human-matched-randomized'],
  ]) {
    const a = cases.find((f) => f.name === bot),
      b = cases.find((f) => f.name === professor);
    assert.deepEqual(a.rows, b.rows);
    assert.deepEqual(observeCampaigns(a.rows, requestFor(a.rows)), observeCampaigns(b.rows, requestFor(b.rows)));
  }
});

test('synthetic address and declared UA changes or absence have no influence on campaign comparisons', () => {
  const cases = campaignFixtures(),
    expected = observeCampaigns(cases[0].rows, requestFor(cases[0].rows));
  for (const fixture of cases.slice(1, 4))
    assert.deepEqual(observeCampaigns(fixture.rows, requestFor(fixture.rows)), expected);
  const bare = cases[0].rows.map(({ networkKey, agentKey, ...row }) => row);
  assert.deepEqual(observeCampaigns(bare, requestFor(bare)), expected);
});

test('missing, partial or untrusted history is explicitly incomplete and emits no campaign observations', () => {
  const rows = campaignRows(),
    request = requestFor(rows);
  for (const history of [
    undefined,
    { ...request.history, complete: false },
    { ...request.history, through: new Date(request.asOf.getTime() - 1) },
  ]) {
    const result = observeCampaigns(rows, { ...request, history });
    for (const window of result.windows) {
      assert.equal(window.status, 'INCOMPLETE_HISTORY');
      assert.deepEqual(window.observations, []);
      assert.equal(window.metrics, null);
    }
  }
  const partial = observeCampaigns(rows, {
    ...request,
    history: { ...request.history, from: new Date(request.asOf.getTime() - 300_000) },
  });
  assert.equal(partial.windows[0].status, 'COMPLETE');
  assert.equal(partial.windows[1].status, 'INCOMPLETE_HISTORY');
});

test('known empty history and sparse samples are insufficient evidence, never a human or bot verdict', () => {
  const request = requestFor(campaignRows());
  for (const rows of [[], campaignRows({ sessions: 3 }), campaignRows({ sessions: 4, count: 4 })]) {
    for (const window of observeCampaigns(rows, request).windows) {
      assert.equal(window.status, 'INSUFFICIENT_EVIDENCE');
      assert.equal(window.observations.length, 0);
      assert.ok(window.issues.includes('NEED_AT_LEAST_4_ENTRY_SESSIONS_AND_20_ENTRY_EVENTS'));
    }
  }
  const sparse = campaignRows({ sessions: 20, count: 1 });
  const window = observeCampaigns(sparse, requestFor(sparse)).windows[0];
  assert.equal(window.sequenceStatus, 'INSUFFICIENT_SEQUENCE_HISTORY');
  assert.ok(window.issues.includes('FEWER_THAN_4_SESSIONS_HAVE_FIVE_ENTRY_EVENTS'));
});

test('windows are closed and use the completed minute bucket, excluding newer rows', () => {
  const base = campaignRows({ sessions: 4, count: 5 });
  const end = epoch + 900_000;
  const row = base[0],
    at = (id, offset) => ({ ...row, id, receivedAt: new Date(end + offset) });
  const rows = [at(100, -900_001), at(101, -900_000), at(102, -300_001), at(103, -300_000), at(104, 0), at(105, 1)];
  const request = {
    asOf: new Date(end + 59_999),
    history: { from: new Date(epoch - 1), through: new Date(end), complete: true },
  };
  const result = observeCampaigns(rows, request);
  assert.equal(result.bucketEndMs, end);
  assert.equal(result.windows[0].availableRows, 2);
  assert.equal(result.windows[1].availableRows, 4);
  assert.deepEqual(result, observeCampaigns(rows.slice(0, -1), request));
});

test('catalog denominator is fixed, kind-specific, known by the cutoff and independent of visited entries', () => {
  const rows = campaignRows({ sessions: 10, count: 10, resource: (s, i) => s * 10 + i }),
    request = requestFor(rows);
  for (const catalog of [
    undefined,
    { ...snapshot(), entryIdentityKeys: [] },
    { ...snapshot(), asOf: new Date(request.asOf.getTime() + 1) },
  ]) {
    const result = observeCampaigns(rows, { ...request, catalog });
    assert.ok(
      result.windows.every(
        (w) =>
          w.coverageStatus === 'UNKNOWN_CATALOG' && w.metrics.coverageFraction === null && w.observations.length === 0,
      ),
    );
  }
  const small = observeCampaigns(rows, { ...request, catalog: snapshot(20) }).windows[0];
  assert.equal(small.metrics.outsideCatalogEntries, 80);
  assert.equal(small.metrics.coverageFraction, 1);
  assert.equal(small.observations.length, 0); // Only two sessions contribute to this 20-item snapshot.
});

test('coverage alone does not create per-participant labels or attribute one session broad activity to a campaign', () => {
  const rows = campaignRows({ sessions: 4, count: 100, resource: (s, i) => (s ? 0 : i) }),
    request = requestFor(rows);
  const window = observeCampaigns(rows, request).windows[1];
  assert.equal(window.metrics.coverageFraction, 1);
  assert.equal(window.metrics.maxSingleSessionCoverage, 1);
  assert.ok(!window.observations.some((o) => o.pattern === 'DISTRIBUTED_CATALOG_COVERAGE'));
});

test('EXTERNAL and WEB evidence cannot supply entry sequences, participants or coverage', () => {
  const rows = campaignRows().map((row, i) => ({ ...row, kind: i % 2 ? 'EXTERNAL_CLICK' : 'WEB_SEARCH' }));
  const window = observeCampaigns(rows, requestFor(rows)).windows[0];
  assert.equal(window.metrics.entryEvents, 0);
  assert.equal(window.metrics.entrySessions, 0);
  assert.equal(window.metrics.coverageFraction, 0);
  assert.equal(window.status, 'INSUFFICIENT_EVIDENCE');
});

test('shared sequence support counts sessions once despite loops and overlapping motifs', () => {
  const rows = campaignRows({ count: 100, resource: (_s, i) => i % 12 }),
    request = requestFor(rows);
  const window = observeCampaigns(rows, request).windows[1];
  assert.equal(window.metrics.maxMotifSessionSupport, 6);
  assert.equal(window.metrics.sharedMotifs, 12);
  assert.equal(window.work.motifCandidates, 6 * 96);
  assert.equal(window.observations.length, 2);
});

test('all steps must align for synchronized traversal; one delayed cohort member conservatively removes synchrony', () => {
  const rows = campaignRows({ gap: (s) => (s === 5 ? 7000 : 4000) }),
    window = observeCampaigns(rows, requestFor(rows)).windows[1];
  assert.equal(window.metrics.sharedMotifs, 8);
  assert.equal(window.metrics.synchronizedMotifs, 0);
  assert.deepEqual(
    window.observations.map((o) => o.pattern),
    ['SHARED_ENTRY_SEQUENCES'],
  );
});

test('unrelated bystanders do not increase motif support or receive participant outputs', () => {
  const coordinated = campaignRows();
  const bystanders = campaignRows({ sessions: 4, resource: (s, i) => 1000 + s * 12 + i }).map((r) => ({
    ...r,
    id: r.id + 1000,
    sessionKey: keyed(`bystander:${r.sessionKey}`),
  }));
  const rows = [...coordinated, ...bystanders];
  const window = observeCampaigns(rows, requestFor(rows)).windows[0];
  assert.equal(window.metrics.entrySessions, 10);
  assert.equal(window.metrics.maxMotifSessionSupport, 6);
  assert.equal(window.metrics.sharedMotifs, 8);
  assert.equal(window.observations.length, 2);
  assert.ok(window.observations.every((o) => o.limitations.some((text) => text.includes('unrelated groups'))));
  for (const row of bystanders) assert.ok(!JSON.stringify(window).includes(row.sessionKey));
});

test('shuffled rows, timestamp ties and repeated batch calls are deterministic without mutating evidence', () => {
  const rows = campaignRows({ gap: 0, offset: () => 0 }),
    original = structuredClone(rows),
    request = requestFor(rows);
  const expected = observeCampaigns(rows, request);
  assert.deepEqual(observeCampaigns([...rows].reverse(), request), expected);
  assert.deepEqual(observeCampaigns(rows, request), expected);
  assert.deepEqual(rows, original);
});

test('ledger extraction duplicates are deduplicated; conflicting IDs explicitly invalidate all output', () => {
  const rows = campaignRows(),
    request = requestFor(rows),
    expected = observeCampaigns(rows, request);
  assert.deepEqual(observeCampaigns([...rows, structuredClone(rows[0])], request), expected);
  const result = observeCampaigns([...rows, { ...rows[0], identityKey: keyed('conflict') }], request);
  assert.ok(result.windows.every((w) => w.status === 'INVALID_INPUT' && w.observations.length === 0));
});

test('row, per-window, session, per-session, motif and catalog budgets return explicit capacity outcomes', () => {
  const base = campaignRows(),
    request = requestFor(base);
  const cases = [
    [Array(p.maxInputRows + 1).fill(base[0]), request, 'INPUT_ROW_CAPACITY'],
    [campaignRows({ sessions: 201, count: 100, gap: 1, offset: () => 0 }), request, 'WINDOW_ROW_CAPACITY'],
    [campaignRows({ sessions: 2001, count: 1, offset: () => 0 }), request, 'SESSION_CAPACITY'],
    [campaignRows({ sessions: 1, count: 2001, gap: 1 }), request, 'SESSION_ROW_CAPACITY'],
    [campaignRows({ sessions: 100, count: 105, gap: 1, resource: (s, i) => s * 105 + i }), request, 'MOTIF_CAPACITY'],
    [
      base,
      { ...request, catalog: { ...snapshot(), entryIdentityKeys: Array(50_001).fill(keyed('entry')) } },
      'CATALOG_CAPACITY',
    ],
  ];
  for (const [rows, req, issue] of cases) {
    const result = observeCampaigns(rows, req);
    assert.ok(
      result.windows.some((w) => w.status === 'CAPACITY' && w.issues.includes(issue)),
      issue,
    );
    for (const window of result.windows.filter((w) => w.status === 'CAPACITY')) {
      assert.deepEqual(window.observations, []);
      assert.equal(window.metrics, null);
      assert.ok(window.work.distinctMotifs <= p.maxMotifs);
    }
  }
});

test('the exact motif budget is usable and is not confused with truncation', () => {
  const rows = campaignRows({ sessions: 100, count: 104, gap: 1, offset: () => 0, resource: (s, i) => s * 104 + i });
  for (const window of observeCampaigns(rows, requestFor(rows)).windows) {
    assert.equal(window.status, 'COMPLETE');
    assert.equal(window.work.distinctMotifs, 10_000);
    assert.equal(window.metrics.sharedMotifs, 0);
  }
});

test('a saturated long window cannot remove a usable short window', () => {
  const recent = campaignRows(),
    old = campaignRows({ sessions: 201, count: 100, gap: 1 }).map((r) => ({
      ...r,
      id: r.id + 1000,
      receivedAt: new Date(epoch - 500_000),
    }));
  const result = observeCampaigns([...recent, ...old], requestFor(recent));
  assert.equal(result.windows[0].status, 'COMPLETE');
  assert.equal(result.windows[0].observations.length, 2);
  assert.equal(result.windows[1].status, 'CAPACITY');
});

test('maximum valid volume has bounded motif work, zero pairwise comparisons and fixed output cardinality', () => {
  const rows = campaignRows({ sessions: 2000, count: 10, gap: 1, offset: () => 0 }),
    request = requestFor(rows);
  const result = observeCampaigns(rows, request);
  for (const window of result.windows) {
    assert.equal(window.status, 'COMPLETE');
    assert.equal(window.metrics.entrySessions, 2000);
    assert.equal(window.metrics.entryEvents, 20_000);
    assert.equal(window.work.motifCandidates, 12_000);
    assert.equal(window.work.pairwiseComparisons, 0);
    assert.ok(window.observations.length <= 3);
  }
});

test('minute/window/pattern upsert keys prevent per-row and same-minute observation amplification', () => {
  const rows = campaignRows(),
    request = requestFor(rows),
    first = observeCampaigns(rows, request);
  const again = observeCampaigns(rows, { ...request, asOf: new Date(request.asOf.getTime() + 59_999) });
  const keys = (r) => r.windows.flatMap((w) => w.observations.map((o) => o.key));
  assert.deepEqual(again, first);
  assert.equal(new Set([...keys(first), ...keys(again)]).size, keys(first).length);
  assert.ok(keys(first).length <= 6);
});

test('bad evidence returns explicit invalid input, and sensitive metadata and labels are ignored', () => {
  const rows = campaignRows(),
    request = requestFor(rows),
    expected = observeCampaigns(rows, request);
  for (const extra of [{ receivedAt: new Date(NaN) }, { kind: 'UNKNOWN' }, { sessionKey: '' }, { id: 1.5 }])
    assert.ok(observeCampaigns([{ ...rows[0], ...extra }], request).windows.every((w) => w.status === 'INVALID_INPUT'));
  const decorated = rows.map((r) => ({
    ...r,
    label: 'private-label',
    payload: 'private-query',
    token: 'private-token',
    ip: '198.51.100.1',
    status: 'REJECTED',
  }));
  assert.deepEqual(observeCampaigns(decorated, request), expected);
  const json = JSON.stringify(expected);
  for (const value of [
    'private-label',
    'private-query',
    'private-token',
    '198.51.100.1',
    rows[0].sessionKey,
    rows[0].identityKey,
  ])
    assert.ok(!json.includes(value));
});
