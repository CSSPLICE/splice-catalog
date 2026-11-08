import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { LiveUsageBotProtection, protectionOptionsFromEnvironment } from '../src/services/LiveUsageBotProtection.ts';
const ua = 'Mozilla/5.0 UnfamiliarPrivacyBrowser/1.0';
function setup(options = {}) {
  let now = Date.now();
  const service = new LiveUsageBotProtection({ mode: 'enforce', ...options }, () => now);
  const session = service.issueSession(undefined, ua);
  const signal = (extra = {}) => ({
    ip: '192.0.2.1',
    userAgent: ua,
    sameOrigin: true,
    sessionId: session.id,
    csrf: session.csrf,
    eventId: randomBytes(16).toString('hex'),
    kind: 'ENTRY_CLICK',
    identity: 'SLC_ITEM:one',
    ...extra,
  });
  return {
    service,
    signal,
    session,
    advance: (ms) => {
      now += ms;
    },
  };
}
for (const userAgent of [
  'Googlebot/2.1',
  'bingbot',
  'Bytespider',
  'AhrefsBot',
  'curl/8',
  'python-requests/2',
  'HeadlessChrome/140',
  'PhantomJS',
  'sqlmap',
]) {
  test(`recognized automation: ${userAgent}`, () => {
    const { service, signal } = setup();
    assert.deepEqual(service.classifyBrowser(signal({ userAgent })), {
      decision: 'REJECT',
      reason: 'KNOWN_AUTOMATION',
    });
  });
}
test('unknown and privacy User-Agents are accepted; cookie is not human proof', () => {
  const { service, signal } = setup();
  assert.equal(service.classifyBrowser(signal()).decision, 'ACCEPT');
  const other = service.issueSession(undefined, 'Tor Browser Unknown');
  assert.equal(
    service.classifyBrowser(signal({ userAgent: 'Tor Browser Unknown', sessionId: other.id, csrf: other.csrf }))
      .decision,
    'ACCEPT',
  );
});
for (const [extra, reason] of [
  [{ sameOrigin: false }, 'ORIGIN_INVALID'],
  [{ sessionId: undefined }, 'SESSION_MISSING'],
  [{ sessionId: 'forged' }, 'SESSION_INVALID'],
  [{ csrf: undefined }, 'TOKEN_INVALID'],
  [{ csrf: 'forged' }, 'TOKEN_INVALID'],
  [{ eventId: undefined }, 'EVENT_ID_INVALID'],
  [{ eventId: [] }, 'EVENT_ID_INVALID'],
])
  test(reason + JSON.stringify(extra), () => {
    const { service, signal } = setup();
    assert.deepEqual(service.classifyBrowser(signal(extra)), { decision: 'REJECT', reason });
  });
test('session expiration at exact boundary, renewal and network changes', () => {
  const { service, session, signal, advance } = setup();
  assert.equal(service.issueSession(session.id, ua).id, session.id);
  advance(service.options.sessionTtlMs - 1);
  assert.equal(service.classifyBrowser(signal({ ip: '192.0.2.2' })).decision, 'ACCEPT');
  advance(1);
  assert.equal(service.classifyBrowser(signal()).reason, 'SESSION_EXPIRED');
  const replacement = service.issueSession(session.id, ua);
  assert.notEqual(replacement.id, session.id);
  assert.equal(
    service.classifyBrowser(signal({ sessionId: replacement.id, csrf: replacement.csrf })).decision,
    'ACCEPT',
  );
});
test('replay IDs are consumed once, including simultaneous classification', async () => {
  const { service, signal } = setup();
  const request = signal();
  const decisions = await Promise.all(Array.from({ length: 20 }, async () => service.classifyBrowser(request)));
  assert.equal(decisions.filter((d) => d.decision === 'ACCEPT').length, 1);
  assert.equal(decisions.filter((d) => d.reason === 'EVENT_REPLAY').length, 19);
});
test('deliberate repeated clicks count; repetition threshold is strict and expires', () => {
  const { service, signal, advance } = setup({ repeatReview: 3 });
  for (let i = 0; i < 3; i++) assert.equal(service.classifyBrowser(signal()).decision, 'ACCEPT');
  assert.equal(service.classifyBrowser(signal()).reason, 'EVENT_REPETITION');
  advance(service.options.repeatWindowMs);
  assert.equal(service.classifyBrowser(signal()).decision, 'ACCEPT');
});
test('session rate review and abuse rejection boundaries; sliding window recovers', () => {
  const { service, signal, advance } = setup({ sessionReview: 3, sessionReject: 5 });
  for (let i = 0; i < 3; i++) assert.equal(service.classifyBrowser(signal()).decision, 'ACCEPT');
  for (let i = 0; i < 2; i++) assert.equal(service.classifyBrowser(signal()).reason, 'SESSION_RATE');
  assert.deepEqual(service.classifyBrowser(signal()), { decision: 'REJECT', reason: 'SESSION_ABUSE' });
  advance(service.options.windowMs);
  assert.equal(service.classifyBrowser(signal()).decision, 'ACCEPT');
});
test('IP threshold reviews shared NAT and cannot automatically reject it', () => {
  const { service, signal, advance } = setup({ ipReview: 2 });
  for (let i = 0; i < 2; i++) assert.equal(service.classifyBrowser(signal()).decision, 'ACCEPT');
  const human = service.issueSession(undefined, ua);
  assert.deepEqual(service.classifyBrowser(signal({ sessionId: human.id, csrf: human.csrf })), {
    decision: 'REVIEW',
    reason: 'IP_RATE',
  });
  advance(service.options.windowMs);
  assert.equal(service.classifyBrowser(signal()).decision, 'ACCEPT');
});
test('event burst and rapid distinct-entry sweep are review signals', () => {
  for (const [options, expected] of [
    [{ burstReview: 2 }, 'EVENT_BURST'],
    [{ distinctReview: 2 }, 'ENTRY_SWEEP'],
  ]) {
    const { service, signal } = setup(options);
    for (let i = 0; i < 2; i++)
      assert.equal(service.classifyBrowser(signal({ identity: `item:${i}` })).decision, 'ACCEPT');
    assert.equal(service.classifyBrowser(signal({ identity: 'item:3' })).reason, expected);
  }
});
test('User-Agent rotation within a session is reviewed, missing UA is reviewed', () => {
  const { service, signal } = setup();
  assert.equal(service.classifyBrowser(signal({ userAgent: 'another browser' })).reason, 'SESSION_UA_CHANGED');
  const empty = service.issueSession(undefined, '');
  assert.equal(
    service.classifyBrowser(signal({ userAgent: '', sessionId: empty.id, csrf: empty.csrf })).reason,
    'UA_MISSING',
  );
});
test('session, IP and replay capacity are bounded; expired memory is purged', () => {
  const { service, signal, advance } = setup({ maxSessions: 1, maxIps: 1, maxReplayIds: 2 });
  assert.equal(service.issueSession(undefined, ua), null);
  service.classifyBrowser(signal());
  assert.equal(service.classifyBrowser(signal({ ip: 'other' })).reason, 'STATE_CAPACITY');
  assert.equal(service.classifyBrowser(signal()).reason, 'REPLAY_CAPACITY');
  assert.equal(service.snapshot().sessions, 1);
  assert.equal(service.snapshot().ips, 1);
  advance(service.options.sessionTtlMs);
  assert.deepEqual(
    { ...service.snapshot(), decisions: {}, auditStarted: 0 },
    { sessions: 0, ips: 0, decisions: {}, auditStarted: 0 },
  );
  assert.ok(service.issueSession(undefined, ua));
});
test('off preserves metrics; observe reports shadow decisions as ACCEPT explicitly', () => {
  for (const mode of ['off', 'observe']) {
    const { service, signal } = setup({ mode });
    const result = service.classifyBrowser(signal({ userAgent: 'Googlebot' }));
    assert.equal(result.decision, 'ACCEPT');
    if (mode === 'observe') assert.deepEqual(result.shadow, { decision: 'REJECT', reason: 'KNOWN_AUTOMATION' });
    else assert.equal(result.reason, 'MODE_OFF');
  }
});
test('API policy counts legitimate scripted clients but suppresses crawlers and high IP rate', () => {
  const { service } = setup({ ipReview: 2 });
  assert.equal(service.classifyApi('ip', 'curl/8').decision, 'ACCEPT');
  assert.equal(service.classifyApi('ip', 'python-requests/2').decision, 'ACCEPT');
  assert.equal(service.classifyApi('ip', 'axios/1').reason, 'IP_RATE');
  assert.equal(service.classifyApi('other', 'Googlebot').reason, 'KNOWN_AUTOMATION');
});
test('configuration rejects invalid thresholds and supports additional literal indicators', () => {
  for (const options of [{ ipReview: 0 }, { sessionReview: 300 }, { burstWindowMs: 100_000 }, { sessionTtlMs: NaN }])
    assert.throws(() => setup(options));
  const { service, signal } = setup({ extraBotIndicators: ['private-crawler'] });
  assert.equal(service.classifyBrowser(signal({ userAgent: 'private-crawler' })).reason, 'KNOWN_AUTOMATION');
  const saved = process.env.LIVE_USAGE_MODE;
  process.env.LIVE_USAGE_MODE = 'typo';
  assert.throws(protectionOptionsFromEnvironment);
  if (saved === undefined) delete process.env.LIVE_USAGE_MODE;
  else process.env.LIVE_USAGE_MODE = saved;
});
test('aggregate audit contains no IPs, queries or credentials and rotates hourly', () => {
  const { service, signal, advance } = setup();
  service.classifyBrowser(signal({ identity: 'private search query' }));
  const json = JSON.stringify(service.snapshot());
  for (const secret of ['192.0.2.1', 'private search query', signal().csrf]) assert.ok(!json.includes(secret));
  advance(60 * 60_000);
  service.classifyApi('ip', 'curl/8');
  assert.deepEqual(service.snapshot().decisions, { 'ACCEPT:ELIGIBLE_API_SEARCH': 1 });
});
test('distributed low-volume clients with valid credentials remain indistinguishable', () => {
  const { service, signal } = setup();
  const decisions = Array.from({ length: 100 }, (_, i) => {
    const session = service.issueSession(undefined, ua);
    return service.classifyBrowser(signal({ ip: `198.51.100.${i}`, sessionId: session.id, csrf: session.csrf }));
  });
  assert.equal(decisions.filter((d) => d.decision === 'ACCEPT').length, 100);
});
test('known bot attack does not consume a normal session budget; valid-session bot bursts are reviewed', () => {
  const { service, signal } = setup();
  for (let i = 0; i < 1000; i++)
    assert.equal(service.classifyBrowser(signal({ userAgent: 'Bytespider' })).decision, 'REJECT');
  assert.equal(service.classifyBrowser(signal()).decision, 'ACCEPT');
  const bot = service.issueSession(undefined, ua);
  const decisions = Array.from({ length: 20 }, (_, i) =>
    service.classifyBrowser(signal({ ip: 'other', sessionId: bot.id, csrf: bot.csrf, identity: `item:${i}` })),
  );
  assert.equal(decisions.filter((d) => d.decision === 'ACCEPT').length, 12);
  assert.equal(decisions.filter((d) => d.decision === 'REVIEW').length, 8);
});
