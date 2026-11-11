import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';
import { AppDataSource } from '../src/db/data-source.ts';
import { UsageEventAudit } from '../src/db/entities/UsageEventAudit.ts';
import { ProvisionalUsageEvent, LiveUsagePipelineLock } from '../src/db/entities/ProvisionalUsageEvent.ts';
import { UsageEvent } from '../src/db/entities/UsageEvent.ts';
import { SearchEvent } from '../src/db/entities/SearchEvent.ts';
import { slc_item_catalog } from '../src/db/entities/SLCItemCatalog.ts';
import { LiveUsageBotProtection } from '../src/services/LiveUsageBotProtection.ts';
import { ProvisionalUsageService, currentUsagePolicy } from '../src/services/ProvisionalUsageService.ts';
import { readLiveUsageAuditConfiguration } from '../src/services/LiveUsageAuditConfiguration.ts';
import { createUsageRouter } from '../src/routes/usage.ts';
import { optionalMysql } from './helpers/live-usage-mysql.mjs';

const secret = 'audit-pipeline-fixture-secret-at-least-32-bytes';
const userAgent = 'Mozilla/5.0 AuditFixtureBrowser';
const payload = {
  kind: 'ENTRY_CLICK', itemPersistentID: 'urn:audit:1', itemTitle: 'Canonical catalog title',
  catalogType: 'SLC_ITEM', catalogPath: '/catalog/item/1',
};

test('transactional browser audit pipeline on disposable MySQL', {
  skip: process.env.LIVE_USAGE_TEST_MYSQL !== 'disposable' ? 'Opt in to a disposable localhost MySQL schema' : false,
  timeout: 120000,
}, async (t) => {
  const mysql = await optionalMysql({ phase2: true, audit: true });
  const originalRepository = AppDataSource.getRepository;
  const originalOrigin = process.env.LIVE_USAGE_ORIGIN;
  let server;
  try {
    AppDataSource.getRepository = (entity) => mysql.db.getRepository(entity);
    await mysql.db.getRepository(slc_item_catalog).createQueryBuilder().insert().values({
      id: 1, catalog_type: 'SLC_ITEM', persistentID: payload.itemPersistentID,
      title: payload.itemTitle, iframe_url: 'https://example.test/resource', keywords: [],
    }).callListeners(false).execute();
    let now, protection, service;
    const auditConfiguration = (enabled) => readLiveUsageAuditConfiguration({ LIVE_USAGE_AUDIT_ENABLED: String(enabled) });
    const newService = (enabled = true) => new ProvisionalUsageService(
      mysql.db, secret, protection.options, {}, () => now, undefined, auditConfiguration(enabled),
    );
    async function reset(enabled = true) {
      await mysql.clear();
      now = Date.now();
      protection = new LiveUsageBotProtection({ mode: 'enforce' }, () => now);
      service = newService(enabled);
    }
    const rows = () => mysql.db.getRepository(ProvisionalUsageEvent).find({ order: { id: 'ASC' } });
    const audits = () => mysql.db.getRepository(UsageEventAudit).find({ order: { provisionalEventId: 'ASC' } });
    const input = (extra = {}) => ({
      sessionId: 'private-session-credential', sessionStartedAt: now - 1000, ip: '192.0.2.123', userAgent,
      eventId: randomBytes(16).toString('hex'), kind: 'ENTRY_CLICK', identity: 'SLC_ITEM:urn:audit:1',
      decision: { decision: 'ACCEPT', reason: 'ELIGIBLE_BROWSER_EVENT' }, payload, ...extra,
    });
    await reset();
    const app = express();
    app.use('/usage', (req, res, next) => createUsageRouter(protection, service)(req, res, next));
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    process.env.LIVE_USAGE_ORIGIN = base;
    async function credentials() {
      const response = await fetch(base + '/usage/session', {
        method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'User-Agent': userAgent }, body: '{}',
      });
      assert.equal(response.status, 200);
      return { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-Usage-Token': (await response.json()).csrf };
    }
    async function post(path, body, auth = {}, headers = {}) {
      const response = await fetch(base + '/usage/' + path, {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json', 'User-Agent': userAgent, ...auth, ...headers },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    const clickBody = (extra = {}) => ({
      eventId: randomBytes(16).toString('hex'), catalogType: 'SLC_ITEM', itemIdentifier: payload.itemPersistentID,
      itemTitle: 'untrusted-client-title', catalogPath: '/untrusted-path', ...extra,
    });
    async function failAudit(work) {
      await mysql.db.query("CREATE TRIGGER audit_fail BEFORE INSERT ON usage_event_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected audit failure'");
      try { await work(); }
      finally { await mysql.db.query('DROP TRIGGER audit_fail'); }
    }

    await t.test('both real migrations are applied and match entity metadata', async () => {
      assert.equal(await mysql.db.showMigrations(), false);
      assert.deepEqual((await mysql.db.query('SELECT name FROM migrations ORDER BY timestamp')).map((row) => row.name),
        ['CreateProvisionalUsageEvents1794000000000', 'CreateUsageEventAudit1794100000000']);
      assert.deepEqual((await mysql.db.driver.createSchemaBuilder().log()).upQueries, []);
    });

    for (const [kind, route, extra] of [
      ['ENTRY_CLICK', 'entry-click', {}],
      ['EXTERNAL_CLICK', 'external-click', { linkType: 'iframe_url' }],
    ]) {
      await t.test(`${kind} audits canonical metadata with exactly one official record after the unchanged review window`, async () => {
        await reset();
        const auth = await credentials();
        const body = clickBody(extra);
        assert.equal((await post(route, body, auth)).body.status, 'PENDING');
        assert.equal((await audits()).length, 0);
        const staged = (await rows())[0];
        assert.equal(staged.reviewAfter.getTime() - staged.receivedAt.getTime(), 120000);
        now += 119999;
        await service.tick();
        assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
        assert.equal((await audits()).length, 0);
        now += 1;
        await service.tick();
        const [audit] = await audits();
        const [official] = await mysql.db.getRepository(UsageEvent).find();
        const [terminal] = await rows();
        assert.deepEqual(await mysql.counts(), { usage: 1, searches: 0 });
        assert.equal(audit.provisionalEventId, staged.id);
        for (const key of ['eventKey', 'sessionKey', 'networkKey', 'agentKey', 'identityKey']) {
          assert.equal(audit[key], staged[key]);
          assert.match(audit[key], /^[a-f0-9]{64}$/);
        }
        assert.equal(audit.kind, kind);
        assert.equal(audit.initialDecision, 'ACCEPT');
        assert.equal(audit.initialReason, 'ELIGIBLE_BROWSER_EVENT');
        assert.equal(audit.status, 'ACCEPTED');
        assert.equal(audit.reason, terminal.reason);
        assert.equal(audit.policyVersion, currentUsagePolicy);
        assert.notEqual(audit.policyVersion, service.configurationId);
        assert.equal(audit.officialEventId, official.id);
        assert.equal(audit.officialEventId, terminal.officialEventId);
        assert.equal(audit.itemPersistentID, payload.itemPersistentID);
        assert.equal(audit.itemTitle, payload.itemTitle);
        assert.equal(audit.catalogType, 'SLC_ITEM');
        assert.equal(audit.linkType, extra.linkType ?? null);
        assert.equal(audit.receivedAt.getTime(), staged.receivedAt.getTime());
        assert.equal(audit.sessionStartedAt.getTime(), staged.sessionStartedAt.getTime());
        assert.equal(audit.finalizedAt.getTime(), now);
        assert.equal(official.createdAt.getTime(), staged.receivedAt.getTime());
        assert.equal(terminal.payload, null);
        for (const value of [secret, service.configurationId, auth.Cookie, auth['X-Usage-Token'], userAgent, 'untrusted-client-title', '/untrusted-path'])
          assert.ok(!JSON.stringify(audit).includes(value));
        assert.equal((await post(route, body, auth)).body.reason, 'DUPLICATE_EVENT');
        await service.tick();
        assert.equal((await audits()).length, 1);
        assert.equal((await mysql.counts()).usage, 1);
      });
    }

    await t.test('WEB_SEARCH preserves official behavior while auditing only hashes and no item fields', async () => {
      await reset();
      const auth = await credentials();
      const query = 'private search query never in audit';
      const body = { eventId: randomBytes(16).toString('hex'), query, itemPersistentID: 'spoof', itemTitle: query };
      await post('web-search', body, auth);
      assert.equal((await audits()).length, 0);
      now += 120000;
      await service.tick();
      const [audit] = await audits();
      const [official] = await mysql.db.getRepository(SearchEvent).find();
      assert.deepEqual(await mysql.counts(), { usage: 0, searches: 1 });
      assert.equal(official.query, query);
      assert.equal(official.source, 'WEB');
      assert.equal(audit.kind, 'WEB_SEARCH');
      assert.equal(audit.officialEventId, official.id);
      assert.equal(audit.itemPersistentID, null);
      assert.equal(audit.itemTitle, null);
      assert.equal(audit.linkType, null);
      assert.equal(audit.catalogType, 'SLC_ITEM');
      assert.ok(!JSON.stringify(audit).includes(query));
      assert.equal((await rows())[0].payload, null);
      await post('web-search', body, auth);
      await service.tick();
      assert.equal((await audits()).length, 1);
      assert.equal((await mysql.counts()).searches, 1);
    });

    await t.test('eligible immediate REVIEW and REJECTED decisions are audited once without unvalidated metadata or counts', async () => {
      await reset();
      for (const [decision, reason, status] of [['REVIEW', 'IP_RATE', 'REVIEW'], ['REJECT', 'SESSION_ABUSE', 'REJECTED']]) {
        const event = input({ decision: { decision, reason } });
        const first = await service.stage(event);
        assert.equal(first.status, status);
        const retry = await service.stage(event);
        assert.equal(retry.duplicate, true);
      }
      assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
      const records = await audits();
      assert.equal(records.length, 2);
      for (const audit of records) {
        assert.equal(audit.initialReason, audit.reason);
        assert.equal(audit.officialEventId, null);
        assert.equal(audit.finalizedAt.getTime(), audit.receivedAt.getTime());
        for (const field of ['itemPersistentID', 'itemTitle', 'catalogType', 'linkType']) assert.equal(audit[field], null);
      }
    });

    await t.test('later burst evidence preserves useful final REVIEW outcomes and their validated click metadata', async () => {
      await reset();
      for (let index = 0; index < 13; index++) await service.stage(input());
      assert.equal((await audits()).length, 0);
      now += 120000;
      await service.tick();
      assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
      assert.equal((await audits()).length, 13);
      assert.ok((await audits()).every((row) => row.status === 'REVIEW' && row.reason === 'RETROSPECTIVE_EVENT_BURST' && row.itemPersistentID === payload.itemPersistentID));
    });

    await t.test('known automation is skipped but its provisional evidence still causes retrospective review', async () => {
      await reset();
      const auth = await credentials();
      await post('entry-click', clickBody(), auth);
      const bot = await post('entry-click', clickBody(), auth, { 'User-Agent': 'Googlebot/2.1' });
      assert.equal(bot.body.status, 'REJECTED');
      assert.equal(bot.body.reason, 'KNOWN_AUTOMATION');
      assert.equal((await rows()).length, 2);
      assert.equal((await audits()).length, 0);
      now += 120000;
      await service.tick();
      assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
      const [audit] = await audits();
      assert.equal(audit.status, 'REVIEW');
      assert.equal(audit.reason, 'RETROSPECTIVE_KNOWN_AUTOMATION');
      assert.equal((await rows())[1].initialReason, 'KNOWN_AUTOMATION');
    });

    await t.test('credential and origin failures produce no detailed audit or provisional records', async () => {
      await reset();
      const auth = await credentials();
      for (const [credentials, headers, extra] of [
        [{}, {}, {}],
        [{ ...auth, 'X-Usage-Token': 'forged-token' }, {}, {}],
        [{ ...auth, Cookie: 'splice_usage=' + 'f'.repeat(64) }, {}, {}],
        [auth, { Origin: 'https://foreign.test' }, {}],
        [auth, {}, { eventId: 'invalid' }],
      ]) {
        const response = await post('entry-click', clickBody(extra), credentials, headers);
        assert.equal(response.body.counted, false);
      }
      now += protection.options.sessionTtlMs + 1;
      assert.equal((await post('entry-click', clickBody(), auth)).body.reason, 'SESSION_EXPIRED');
      assert.equal((await audits()).length, 0);
      assert.equal((await rows()).length, 0);
      assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
    });

    for (const path of ['finalizeDue', 'cleanup']) {
      await t.test(`expired PENDING is audited atomically through ${path} without an official event`, async () => {
        await reset();
        await service.stage(input());
        const [staged] = await rows();
        now = staged.deadlineAt.getTime();
        await service.store[path](new Date(now));
        const [audit] = await audits();
        assert.equal(audit.status, 'EXPIRED');
        assert.equal(audit.reason, 'PENDING_EXPIRED');
        assert.equal(audit.officialEventId, null);
        assert.equal(audit.finalizedAt.getTime(), now);
        assert.equal(audit.itemPersistentID, payload.itemPersistentID);
        assert.equal((await rows())[0].payload, null);
        assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
        await service.tick();
        assert.equal((await audits()).length, 1);
      });
    }

    await t.test('concurrent admissions/workers and reconnect retries cannot double-count or duplicate audits', async () => {
      await reset();
      const event = input();
      await Promise.all(Array.from({ length: 10 }, () => service.stage(event)));
      assert.equal((await rows()).length, 1);
      assert.equal((await audits()).length, 0);
      const other = newService();
      now += 120000;
      await Promise.all([service.tick(), other.tick(), service.tick()]);
      assert.equal((await audits()).length, 1);
      assert.deepEqual(await mysql.counts(), { usage: 1, searches: 0 });
      await mysql.reconnect();
      service = newService();
      assert.equal((await service.stage(event)).duplicate, true);
      await service.tick();
      assert.equal((await audits()).length, 1);
      assert.deepEqual(await mysql.counts(), { usage: 1, searches: 0 });
    });

    await t.test('disabled audit needs no audit table and preserves all existing terminal behavior', async () => {
      await reset(false);
      await mysql.db.query('RENAME TABLE usage_event_audit TO audit_disabled_storage');
      try {
        await service.stage(input());
        await service.stage(input({ sessionId: 'search-session', kind: 'WEB_SEARCH', identity: 'private query',
          payload: { kind: 'WEB_SEARCH', query: 'private query', catalogType: 'SLC_ITEM' } }));
        await service.stage(input({ sessionId: 'review-session', decision: { decision: 'REVIEW', reason: 'IP_RATE' } }));
        await service.stage(input({ sessionId: 'reject-session', decision: { decision: 'REJECT', reason: 'SESSION_ABUSE' } }));
        now += 120000;
        await service.tick();
        assert.deepEqual(await mysql.counts(), { usage: 1, searches: 1 });
        await service.stage(input({ sessionId: 'expired-session' }));
        now += service.options.deadlineMs;
        await service.tick();
        assert.equal((await rows()).filter((row) => row.status === 'EXPIRED').length, 1);
      } finally {
        await mysql.db.query('RENAME TABLE audit_disabled_storage TO usage_event_audit');
      }
      assert.equal((await audits()).length, 0);
    });

    await t.test('audit insert failure rolls back official click/search inserts and permits worker recovery', async () => {
      for (const kind of ['ENTRY_CLICK', 'WEB_SEARCH']) {
        await reset();
        await service.stage(input(kind === 'WEB_SEARCH' ? { kind, identity: 'private query',
          payload: { kind, query: 'private query', catalogType: 'SLC_ITEM' } } : {}));
        now += 120000;
        await failAudit(async () => assert.rejects(service.tick(), /injected audit failure/));
        assert.equal((await audits()).length, 0);
        assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
        const [pending] = await rows();
        assert.equal(pending.status, 'PENDING');
        assert.equal(pending.finalizedAt, null);
        assert.equal(pending.officialEventId, null);
        assert.ok(pending.payload);
        await service.tick();
        assert.equal((await audits()).length, 1);
        assert.equal((await mysql.counts())[kind === 'WEB_SEARCH' ? 'searches' : 'usage'], 1);
      }
    });

    await t.test('immediate HTTP terminal audit failure rolls back admission and releases replay reservation for retry', async () => {
      await reset();
      const auth = await credentials();
      const body = clickBody();
      const headers = { 'User-Agent': 'Mozilla/5.0 ChangedBrowser' };
      await failAudit(async () => {
        const failed = await post('entry-click', body, auth, headers);
        assert.equal(failed.status, 503);
        assert.equal(failed.body.counted, false);
        assert.equal(failed.body.reason, 'PROVISIONAL_UNAVAILABLE');
      });
      assert.equal((await rows()).length, 0);
      assert.equal((await audits()).length, 0);
      assert.equal((await mysql.db.getRepository(LiveUsagePipelineLock).findOneByOrFail({ id: 1 })).configurationId, null);
      assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
      const recovered = await post('entry-click', body, auth, headers);
      assert.equal(recovered.body.status, 'REVIEW');
      assert.equal(recovered.body.reason, 'SESSION_UA_CHANGED');
      assert.equal((await audits()).length, 1);
      await post('entry-click', body, auth, headers);
      assert.equal((await audits()).length, 1);
      assert.equal((await rows()).length, 1);
    });

    await t.test('immediate REJECTED audit failure leaves no partial provisional admission and can retry', async () => {
      await reset();
      const event = input({ decision: { decision: 'REJECT', reason: 'SESSION_ABUSE' } });
      await failAudit(async () => assert.rejects(service.stage(event), /injected audit failure/));
      assert.equal((await rows()).length, 0);
      assert.equal((await audits()).length, 0);
      assert.equal((await service.stage(event)).status, 'REJECTED');
      assert.equal((await audits()).length, 1);
      assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
    });

    await t.test('cleanup expiration audit failure retains pending payload for a safe retry', async () => {
      await reset();
      await service.stage(input());
      now += service.options.deadlineMs;
      await failAudit(async () => assert.rejects(service.store.cleanup(new Date(now)), /injected audit failure/));
      assert.equal((await rows())[0].status, 'PENDING');
      assert.ok((await rows())[0].payload);
      assert.equal((await audits()).length, 0);
      await service.store.cleanup(new Date(now));
      assert.equal((await rows())[0].status, 'EXPIRED');
      assert.equal((await audits())[0].status, 'EXPIRED');
      assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
    });

    await t.test('provisional transition failure also rolls back the already inserted audit and official event', async () => {
      await reset();
      await service.stage(input());
      now += 120000;
      await mysql.db.query("CREATE TRIGGER transition_fail BEFORE UPDATE ON provisional_usage_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected transition failure'");
      try { await assert.rejects(service.tick(), /injected transition failure/); }
      finally { await mysql.db.query('DROP TRIGGER transition_fail'); }
      assert.equal((await audits()).length, 0);
      assert.equal((await rows())[0].status, 'PENDING');
      assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
      await service.tick();
      assert.equal((await audits()).length, 1);
      assert.equal((await mysql.counts()).usage, 1);
    });

    await t.test('title snapshots are bounded by Unicode characters and payload extras never enter audit storage', async () => {
      await reset();
      const title = '😀'.repeat(300);
      const event = input({ payload: { ...payload, itemTitle: title, query: 'private-extra-query', userAgent, ip: '192.0.2.123' } });
      await service.stage(event);
      await service.stage(input({ decision: { decision: 'REVIEW', reason: 'SESSION_UA_CHANGED' } }));
      now += 120000;
      await service.tick();
      const [audit] = await audits();
      assert.equal(audit.itemTitle, '😀'.repeat(255));
      assert.equal(audit.status, 'REVIEW');
      for (const value of [secret, event.sessionId, event.eventId, event.ip, userAgent, 'private-extra-query'])
        assert.ok(!JSON.stringify(await audits()).includes(value));
    });

    await t.test('provisional cleanup leaves audit history, snapshots and official counts intact', async () => {
      await reset();
      await service.stage(input());
      now += 120000;
      await service.tick();
      const retained = await audits();
      await mysql.db.getRepository(slc_item_catalog).createQueryBuilder().update().set({ title: 'Renamed catalog item' })
        .where('persistentID = :id', { id: payload.itemPersistentID }).callListeners(false).execute();
      now += service.options.retentionMs;
      assert.equal(await service.store.cleanup(new Date(now)), 1);
      assert.equal((await rows()).length, 0);
      assert.deepEqual(await audits(), retained);
      assert.equal((await audits())[0].itemTitle, payload.itemTitle);
      assert.deepEqual(await mysql.counts(), { usage: 1, searches: 0 });
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    AppDataSource.getRepository = originalRepository;
    if (originalOrigin === undefined) delete process.env.LIVE_USAGE_ORIGIN;
    else process.env.LIVE_USAGE_ORIGIN = originalOrigin;
    await mysql.close();
  }
});
