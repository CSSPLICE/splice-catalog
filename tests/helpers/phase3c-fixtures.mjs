import { observeCampaigns } from '../../src/analysis/CampaignObserver.ts';
import { SessionBehaviorObserver } from '../../src/analysis/SessionBehaviorObserver.ts';
import { baseline, trace, snapshot, epoch, keyed, random } from './phase3b-fixtures.mjs';

export function campaignRows({
  sessions = 6,
  count = 12,
  gap = 4000,
  resource = (_s, i) => i,
  offset = (s) => s * 100,
  network = () => 'shared-synthetic-identity',
  agent = () => 'declared-browser',
} = {}) {
  let id = 0;
  return Array.from({ length: sessions }, (_, s) =>
    trace(
      count,
      (i) => (typeof gap === 'function' ? gap(s, i) : gap),
      (i) => resource(s, i),
    ).map((row, i) => ({
      ...row,
      id: ++id,
      sessionKey: keyed(`campaign-session:${s}`),
      networkKey: keyed(`synthetic-network:${network(s, i)}`),
      agentKey: keyed(`declared-agent:${agent(s, i)}`),
      receivedAt: new Date(row.receivedAt.getTime() + offset(s)),
      reviewAfter: new Date(row.reviewAfter.getTime() + offset(s)),
      sessionStartedAt: new Date(epoch + offset(s)),
    })),
  ).flat();
}
export function requestFor(rows, catalogSize = 100) {
  const last = rows.reduce((latest, row) => Math.max(latest, row.receivedAt.getTime()), epoch);
  const asOf = new Date(Math.ceil((last + 120_000) / 60_000) * 60_000);
  return {
    asOf,
    history: { from: new Date(epoch - 900_000), through: asOf, complete: true },
    catalog: snapshot(catalogSize),
  };
}
export function campaignFixtures() {
  const common = campaignRows();
  const addresses = common.map((row, i) => ({
    ...row,
    networkKey: keyed(`synthetic-address:198.51.100.${Math.floor(i / 12) + 1}`),
  }));
  const partition = campaignRows({ sessions: 10, count: 10, gap: 7000, resource: (s, i) => s * 10 + i });
  const shuffled = random(137),
    jitter = random(71);
  const paths = Array.from({ length: 6 }, () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(shuffled() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values.slice(0, 12);
  });
  const randomized = campaignRows({
    resource: (s, i) => paths[s][i],
    gap: () => 3500 + Math.floor(jitter() * 3501),
    offset: (s) => s * 8000,
  });
  return [
    { name: 'scripted-shared-network', label: 'bot', rows: structuredClone(common) },
    { name: 'scripted-synthetic-addresses', label: 'bot', rows: addresses },
    {
      name: 'scripted-distinct-agents',
      label: 'bot',
      rows: addresses.map((r) => ({ ...r, agentKey: keyed(`declared-agent:${r.sessionKey}`) })),
    },
    {
      name: 'scripted-agent-rotation',
      label: 'bot',
      rows: addresses.map((r) => ({ ...r, agentKey: keyed(`rotated-agent:${r.id}`) })),
    },
    { name: 'partitioned-traversal', label: 'bot', rows: structuredClone(partition) },
    { name: 'delayed-identical-sequences', label: 'bot', rows: campaignRows({ offset: (s) => s * 20_000 }) },
    { name: 'randomized-order-and-delay', label: 'bot', rows: structuredClone(randomized) },
    {
      name: 'sparse-rotating-sessions',
      label: 'bot',
      rows: campaignRows({ sessions: 20, count: 1, resource: (s) => s * 3, offset: (s) => s * 2000 }),
    },
    {
      name: 'independent-professors',
      label: 'professor',
      rows: campaignRows({ resource: (s, i) => s * 12 + i, gap: 11_000, offset: (s) => s * 3000 }),
    },
    { name: 'synchronized-professor-demo', label: 'professor', rows: structuredClone(common) },
    {
      name: 'popular-resources',
      label: 'professor',
      rows: campaignRows({ sessions: 12, count: 10, gap: 9000, resource: (s, i) => (s + i) % 3 }),
    },
    { name: 'different-professor-topics', label: 'professor', rows: structuredClone(partition) },
    { name: 'human-matched-randomized', label: 'professor', rows: structuredClone(randomized) },
  ];
}
export function measureCampaign(fixture) {
  const { rows } = fixture,
    request = requestFor(rows),
    before = baseline(rows);
  const analysis = observeCampaigns(rows, request);
  const observer3b = new SessionBehaviorObserver(rows, request.catalog);
  const phase3b = { observedReviews: 0, behavioralReviews: 0, observations: 0, patterns: {} };
  for (const row of rows) {
    const observations = observer3b.analyze(row).windows.flatMap((w) => w.observations);
    phase3b.observedReviews += Number(observations.length > 0);
    phase3b.behavioralReviews += Number(observations.some((o) => o.pattern !== 'REGULAR_CADENCE'));
    phase3b.observations += observations.length;
    for (const o of observations) phase3b.patterns[o.pattern] = (phase3b.patterns[o.pattern] ?? 0) + 1;
  }
  const statuses = {},
    patterns = {};
  for (const row of before) statuses[row.status] = (statuses[row.status] ?? 0) + 1;
  for (const window of analysis.windows)
    for (const o of window.observations) patterns[o.pattern] = (patterns[o.pattern] ?? 0) + 1;
  return {
    before,
    after: baseline(rows),
    analysis,
    summary: {
      name: fixture.name,
      label: fixture.label,
      events: rows.length,
      sessions: new Set(rows.map((r) => r.sessionKey)).size,
      syntheticNetworkIdentities: new Set(rows.map((r) => r.networkKey)).size,
      declaredAgentIdentities: new Set(rows.map((r) => r.agentKey)).size,
      statuses,
      phase3b,
      campaignLike: Object.keys(patterns).length > 0,
      patterns,
      windows: analysis.windows,
    },
  };
}
