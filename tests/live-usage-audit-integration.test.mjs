import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { AppDataSource } from '../src/db/data-source.ts';
import { UsageEventAudit } from '../src/db/entities/UsageEventAudit.ts';
import { ProvisionalUsageEvent, LiveUsagePipelineLock } from '../src/db/entities/ProvisionalUsageEvent.ts';
import { UsageEvent } from '../src/db/entities/UsageEvent.ts';
import { SearchEvent } from '../src/db/entities/SearchEvent.ts';
import { HistoricalUsage } from '../src/db/entities/HistoricalUsage.ts';
import { slc_item_catalog } from '../src/db/entities/SLCItemCatalog.ts';
import { LiveUsageBotProtection } from '../src/services/LiveUsageBotProtection.ts';
import { ProvisionalUsageService, currentUsagePolicy } from '../src/services/ProvisionalUsageService.ts';
import { readLiveUsageAuditConfiguration, usageAuditRetentionCutoff } from '../src/services/LiveUsageAuditConfiguration.ts';
import { cleanupUsageEventAudit } from '../src/services/LiveUsageAuditRetention.ts';
import { createUsageRouter } from '../src/routes/usage.ts';
import dashboardRoutes from '../src/routes/usageDashboard.ts';
import { optionalMysql } from './helpers/live-usage-mysql.mjs';

const secret = 'audit-pipeline-fixture-secret-at-least-32-bytes';
const userAgent = 'Mozilla/5.0 AuditFixtureBrowser';
const payload = {
  kind: 'ENTRY_CLICK', itemPersistentID: 'urn:audit:1', itemTitle: 'Canonical catalog title',
  catalogType: 'SLC_ITEM', catalogPath: '/catalog/item/1',
};

function shutdownProbe(firstWorker) {
  const secondWorker = firstWorker === 'audit' ? 'provisional' : 'audit';
  return `
    await import(${JSON.stringify(import.meta.resolve('reflect-metadata'))});
    const { Server } = await import('node:http');
    const { AppDataSource } = await import(${JSON.stringify(new URL('../src/db/data-source.ts', import.meta.url).href)});
    const { ProvisionalUsageService } = await import(${JSON.stringify(new URL('../src/services/ProvisionalUsageService.ts', import.meta.url).href)});
    const workers = Object.fromEntries(['audit', 'provisional'].map(name => [name, {
      release: Promise.withResolvers(), finished: Promise.withResolvers(),
    }]));
    const events = [];
    async function pauseWorker(name, run) {
      console.log('shutdown probe: ' + name + ' started');
      await workers[name].release.promise;
      try {
        const result = await run();
        events.push(name + ' finished');
        return result;
      } finally {
        workers[name].finished.resolve();
      }
    }
    const tick = ProvisionalUsageService.prototype.tick;
    ProvisionalUsageService.prototype.tick = function () {
      return pauseWorker('provisional', () => tick.call(this));
    };
    const query = AppDataSource.query.bind(AppDataSource);
    AppDataSource.query = (sql, ...args) => sql.startsWith('DELETE FROM usage_event_audit')
      ? pauseWorker('audit', () => query(sql, ...args))
      : query(sql, ...args);
    const close = Server.prototype.close;
    Server.prototype.close = function (...args) {
      this.once('close', () => {
        const first = workers[${JSON.stringify(firstWorker)}];
        first.release.resolve();
        void first.finished.promise.then(() => setImmediate(workers[${JSON.stringify(secondWorker)}].release.resolve));
      });
      return close.apply(this, args);
    };
    const destroy = AppDataSource.destroy.bind(AppDataSource);
    AppDataSource.destroy = async () => {
      console.log('shutdown probe: ' + [...events, 'database destroy'].join(', '));
      await destroy();
    };
  `;
}

async function runCatalog(db, expectedLog, {
  retentionDays = '90', maxRowsPerPass, expectedExitCode = 0, firstWorkerToFinish,
} = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'splice-audit-start-'));
  // The upload route creates its container-specific directory during import.
  const uploadDirectoryFixture = `
    import fs from 'node:fs';
    const { mkdirSync } = fs;
    fs.mkdirSync = (path, ...args) => mkdirSync(path === '/home/deploy/app/uploads' ? 'uploads' : path, ...args);
  `;
  const preload = uploadDirectoryFixture + (firstWorkerToFinish ? shutdownProbe(firstWorkerToFinish) : '');
  const child = spawn(process.execPath, [
    '--import', 'data:text/javascript,' + encodeURIComponent(preload),
    '--loader', import.meta.resolve('ts-node/esm'), fileURLToPath(new URL('../src/index.ts', import.meta.url)),
  ], {
    cwd,
    env: {
      TS_NODE_PROJECT: fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
      TS_NODE_EXPERIMENTAL_RESOLVER: 'true', TS_NODE_TRANSPILE_ONLY: 'true',
      APP_PORT: '0', LIVE_USAGE_MODE: 'off', LIVE_USAGE_AUDIT_RETENTION_DAYS: retentionDays,
      ...(maxRowsPerPass === undefined ? {} : { LIVE_USAGE_AUDIT_MAX_ROWS_PER_PASS: maxRowsPerPass }),
      ...(firstWorkerToFinish ? {
        LIVE_USAGE_MODE: 'enforce', LIVE_USAGE_PROVISIONAL_ENABLED: 'true', LIVE_USAGE_STATE_SECRET: secret,
      } : {}),
      DB_HOST: db.options.host, DB_PORT: String(db.options.port), DB_DATABASE: db.options.database,
      DB_USERNAME: db.options.username, DB_PASSWORD: db.options.password,
      SECRET: secret, baseURL: 'http://127.0.0.1:3000', clientID: 'audit-test', issuerBaseURL: 'https://127.0.0.1:1',
      MEILISEARCH_HOST: 'http://127.0.0.1:1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  const ready = Promise.withResolvers();
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (expectedExitCode === 0 && output.includes(expectedLog)) ready.resolve(true);
  });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000);
  try {
    const started = await Promise.race([ready.promise, closed.then(() => false)]);
    if (!started) {
      for (const name of ['error.log', 'exceptions.log']) {
        output += await readFile(join(cwd, 'logs', name), 'utf8').catch(() => '');
      }
    }
    assert.equal(started, expectedExitCode === 0, output);
    if (started) child.kill('SIGTERM');
    assert.deepEqual(await closed, [expectedExitCode, null], output);
    assert.ok(output.includes(expectedLog), output);
    assert.doesNotMatch(output, /Usage audit retention cleanup failed/);
    return output;
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed.catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
}

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
    app.use('/admin', (req, _res, next) => {
      const role = req.get('x-fixture-role');
      req.oidc = {
        isAuthenticated: () => Boolean(role),
        user: { 'https://roles': role === 'malformed' ? 'non-admin' : [role] },
      };
      next();
    }, dashboardRoutes);
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const auditResponse = (query = '', { format, role = 'admin' } = {}) => fetch(
      `${base}/admin/usage-statistics/audit${format ? `/export.${format}` : ''}?${query}`,
      { headers: { 'x-fixture-role': role } },
    );
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
      const date = audit.finalizedAt;
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const response = await auditResponse(`kind=WEB_SEARCH&period=custom&from=${day}&to=${day}`, { format: 'json' });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.deepEqual(JSON.parse(text), [{
        finalizedAt: date.toISOString(), kind: 'WEB_SEARCH', status: audit.status, reason: audit.reason,
        catalogType: 'SLC_ITEM', itemPersistentID: null, itemTitle: null, officialEventId: official.id,
        policyVersion: currentUsagePolicy,
      }]);
      for (const secret of [query, audit.eventKey, audit.sessionKey, audit.networkKey, audit.agentKey, audit.identityKey]) {
        assert.ok(!text.includes(secret));
      }
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
      const date = retained[0].finalizedAt;
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const response = await auditResponse(`period=custom&from=${day}&to=${day}`);
      assert.equal(response.status, 200);
      const { rows: visible } = await response.json();
      assert.deepEqual(visible.map((record) => record.itemTitle), [payload.itemTitle]);
    });

    const auditRepository = () => mysql.db.getRepository(UsageEventAudit);
    const day = 86_400_000;
    const retentionConfig = (days, enabled = false) => readLiveUsageAuditConfiguration({
      LIVE_USAGE_AUDIT_ENABLED: String(enabled), LIVE_USAGE_AUDIT_RETENTION_DAYS: String(days),
    });
    const cleanup = (days = 90) => cleanupUsageEventAudit(mysql.db, retentionConfig(days), new Date(now));
    async function seedAudit(firstReference, count, finalizedAt, fields = {}) {
      for (let offset = 0; offset < count; offset += 500) {
        await auditRepository().insert(Array.from({ length: Math.min(500, count - offset) }, (_, i) => {
          const provisionalEventId = firstReference + offset + i;
          return {
            provisionalEventId, finalizedAt,
            eventKey: provisionalEventId.toString(16).padStart(64, '0'),
            sessionKey: 'b'.repeat(64), networkKey: 'c'.repeat(64), agentKey: 'd'.repeat(64), identityKey: 'e'.repeat(64),
            kind: 'ENTRY_CLICK', initialDecision: 'ACCEPT', initialReason: 'ELIGIBLE_BROWSER_EVENT',
            status: 'ACCEPTED', reason: 'REVIEW_WINDOW_ELIGIBLE', policyVersion: currentUsagePolicy,
            sessionStartedAt: finalizedAt, receivedAt: finalizedAt,
            ...fields,
          };
        }));
      }
    }
    const refs = async () => (await audits()).map((audit) => audit.provisionalEventId);

    await t.test('audit listing and both export endpoints require an authenticated administrator and validate filters', async () => {
      for (const format of [undefined, 'csv', 'json']) {
        for (const [role, status] of [['', 401], ['contributor', 403], ['malformed', 403]]) {
          const response = await auditResponse('', { format, role });
          assert.equal(response.status, status);
          assert.equal(response.headers.get('cache-control'), 'no-store');
        }
        for (const query of [
          'status=PENDING', 'kind=API_SEARCH', 'catalogType=OTHER', 'q=a&q=b', 'q%5Bterm%5D=x', 'sort=id',
          'page=0', 'page=102&pageSize=100', 'pageSize=101', 'q=' + 'a'.repeat(201), 'itemPersistentID=' + 'a'.repeat(256),
          'period=custom&from=2026-02-30&to=2026-03-01', 'period=custom&from=2026-04-02&to=2026-04-01',
          'period=custom&from=2026-01-01&to=2027-01-02', 'period=custom&from=2026-01-01', 'period=7d&from=2026-01-01',
        ]) {
          const response = await auditResponse(query, { format });
          assert.equal(response.status, 400, query);
          assert.equal(response.headers.get('cache-control'), 'no-store');
        }
      }
    });

    await t.test('audit list filters actual rows, breaks timestamp ties by ID and projects only display fields', async () => {
      await reset();
      const start = new Date(2026, 0, 10);
      const end = new Date(2026, 0, 11);
      for (let id = 1; id <= 12; id++) {
        await seedAudit(id, 1, start, { catalogType: 'SLC_ITEM', itemTitle: 'Counted item', officialEventId: id });
      }
      await seedAudit(13, 1, start, { catalogType: 'TOOL', itemPersistentID: 'urn:tool:7', itemTitle: 'Reviewed tool',
        kind: 'EXTERNAL_CLICK', status: 'REVIEW', reason: 'SESSION_RATE', officialEventId: 17 });
      await seedAudit(14, 1, end, { itemTitle: 'Following day' });
      await seedAudit(15, 1, new Date(end.getTime() - 1), { kind: 'WEB_SEARCH', status: 'REJECTED', reason: 'SESSION_ABUSE' });
      const date = 'period=custom&from=2026-01-10&to=2026-01-10';
      const response = await auditResponse(date);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const first = await response.json();
      assert.equal(first.matchingCount, 14);
      assert.equal(first.pageSize, 6);
      assert.equal(first.totalPages, 3);
      assert.equal(first.page, 1);
      assert.deepEqual(first.rows.map((row) => row.officialEventId), [null, 17, 12, 11, 10, 9]);
      assert.deepEqual(first.rows.slice(0, 2).map((row) => row.reason), ['SESSION_ABUSE', 'SESSION_RATE']);
      assert.equal(first.rows[0].itemTitle, null);
      assert.deepEqual(Object.keys(first.rows[0]).sort(), [
        'catalogType', 'finalizedAt', 'itemPersistentID', 'itemTitle', 'kind', 'officialEventId', 'reason', 'status',
      ]);
      const second = await (await auditResponse(`${date}&page=2`)).json();
      assert.equal(second.page, 2);
      assert.deepEqual(second.rows.map((row) => row.officialEventId), [8, 7, 6, 5, 4, 3]);
      for (const requestedPage of [3, 4]) {
        const last = await (await auditResponse(`${date}&page=${requestedPage}`)).json();
        assert.equal(last.page, 3);
        assert.deepEqual(last.rows.map((row) => row.officialEventId), [2, 1]);
      }
      const filteredPage = await (await auditResponse(`${date}&status=ACCEPTED&page=2`)).json();
      assert.equal(filteredPage.matchingCount, 12);
      assert.equal(filteredPage.totalPages, 2);
      assert.equal(filteredPage.page, 2);
      assert.deepEqual(filteredPage.rows.map((row) => row.officialEventId), [6, 5, 4, 3, 2, 1]);
      for (const filter of ['status=REVIEW', 'kind=EXTERNAL_CLICK', 'q=SESSION_RATE', 'q=Reviewed%20tool', 'q=urn%3Atool%3A7', 'catalogType=TOOL&itemPersistentID=urn%3Atool%3A7']) {
        const filtered = await (await auditResponse(`${date}&${filter}`)).json();
        assert.equal(filtered.matchingCount, 1, filter);
        assert.equal(filtered.rows[0].itemTitle, 'Reviewed tool');
      }
      assert.equal((await (await auditResponse(`${date}&q=%25`)).json()).matchingCount, 0);
      assert.equal((await (await auditResponse(`${date}&q=urn%3Atool&catalogType=TOOL`)).json()).matchingCount, 1);
      assert.equal((await (await auditResponse(date.replaceAll('2026-01-10', '2026-01-11'))).json()).rows[0].itemTitle, 'Following day');
    });

    await t.test('audit CSV and JSON export the same ordered, filtered records and enforce the same cap', async () => {
      await reset();
      await seedAudit(1, 5000, new Date(now));
      await seedAudit(5001, 6, new Date(now), {
        catalogType: 'DATASET', itemPersistentID: '@123', itemTitle: 'Additional reviewed dataset', status: 'REVIEW', reason: 'SESSION_RATE',
      });
      await seedAudit(5007, 1, new Date(now), {
        catalogType: 'DATASET', itemPersistentID: '@123', itemTitle: '  =SUM(1,2)', status: 'REVIEW', reason: 'SESSION_RATE',
      });
      await seedAudit(5008, 1, new Date(now), {
        catalogType: 'DATASET', itemPersistentID: '@123', itemTitle: 'Reviewed dataset', status: 'REVIEW', reason: 'SESSION_RATE',
      });
      for (const format of ['csv', 'json']) {
        const large = await auditResponse('', { format });
        assert.equal(large.status, 422);
        assert.equal(large.headers.get('content-disposition'), null);
        assert.equal(large.headers.get('cache-control'), 'no-store');
        assert.match((await large.json()).error, /5,000 records.*Narrow the audit filters/);
        const atLimit = await auditResponse('status=ACCEPTED', { format });
        assert.equal(atLimit.status, 200);
        assert.equal(format === 'json' ? (await atLimit.json()).length : (await atLimit.text()).split('\r\n').length - 1, 5000);
      }

      const query = 'period=7d&status=REVIEW&catalogType=DATASET&q=%40123';
      const listing = await (await auditResponse(query)).json();
      assert.equal(listing.matchingCount, 8);
      assert.deepEqual(listing.rows.slice(0, 2).map((row) => row.itemTitle), ['Reviewed dataset', '  =SUM(1,2)']);
      const lastPage = await (await auditResponse(`${query}&page=2`)).json();
      assert.equal(lastPage.rows.length, 2);
      const exportQuery = `${query}&page=2&pageSize=1`;
      const json = await auditResponse(exportQuery, { format: 'json' });
      assert.equal(json.status, 200);
      assert.match(json.headers.get('content-type'), /^application\/json\b/);
      assert.equal(json.headers.get('cache-control'), 'no-store');
      assert.match(json.headers.get('content-disposition'), /attachment; filename="splice-audit-history.json"/);
      assert.deepEqual(await json.json(), [...listing.rows, ...lastPage.rows].map((row) => ({ ...row, policyVersion: currentUsagePolicy })));

      const response = await auditResponse(exportQuery, { format: 'csv' });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('content-disposition'), /attachment; filename="splice-audit-history.csv"/);
      const [header, ...rows] = (await response.text()).split('\r\n');
      assert.equal(header, 'Finalized At,Event Type,Status,Reason,Catalog Type,Item Persistent ID,Item Title,Official Event ID,Policy Version');
      const prefix = `${listing.rows[0].finalizedAt},ENTRY_CLICK,REVIEW,SESSION_RATE,DATASET,'@123,`;
      assert.deepEqual(rows, [
        `${prefix}Reviewed dataset,,${currentUsagePolicy}`,
        `${prefix}"'  =SUM(1,2)",,${currentUsagePolicy}`,
        ...Array(6).fill(`${prefix}Additional reviewed dataset,,${currentUsagePolicy}`),
      ]);
    });

    await t.test('default retention deletes through the exact cutoff and preserves official and pending data', async () => {
      await reset();
      await service.stage(input());
      await service.stage(input({ sessionId: 'search-fixture', kind: 'WEB_SEARCH', identity: 'search fixture',
        payload: { kind: 'WEB_SEARCH', query: 'search fixture', catalogType: 'SLC_ITEM' } }));
      now += 120000;
      await service.tick();
      now += 91 * day;
      await service.stage(input());
      await mysql.db.getRepository(HistoricalUsage).insert({
        catalogType: 'SLC_ITEM', legacyCatalogId: 1, viewCount: 42, source: 'retention-fixture',
      });
      const snapshot = async () => ({
        officialClicks: await mysql.db.getRepository(UsageEvent).find(),
        officialSearches: await mysql.db.getRepository(SearchEvent).find(),
        historical: await mysql.db.getRepository(HistoricalUsage).find(),
        provisional: await rows(),
        pipelineLock: await mysql.db.getRepository(LiveUsagePipelineLock).find(),
      });
      const before = await snapshot();
      assert.equal(before.provisional.at(-1).status, 'PENDING');
      const cutoff = now - 90 * day;
      await seedAudit(100, 1, new Date(cutoff - 1));
      await seedAudit(101, 1, new Date(cutoff));
      await seedAudit(102, 1, new Date(cutoff + 1));

      const defaults = readLiveUsageAuditConfiguration({});
      assert.deepEqual(await cleanupUsageEventAudit(mysql.db, defaults, new Date(now)), {
        deleted: 4, tableMissing: false, limitReached: false,
      });
      assert.deepEqual(await refs(), [102]);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await mysql.counts(), { usage: 1, searches: 1 });
      assert.equal((await cleanup()).deleted, 0);
    });

    await t.test('retention changes apply on the next pass after reconnect and never restore deletions', async () => {
      await reset();
      for (const age of [100, 75, 31, 29]) await seedAudit(age, 1, new Date(now - age * day));
      assert.equal((await cleanup(90)).deleted, 1);
      await mysql.reconnect();
      assert.equal((await cleanup(180)).deleted, 0);
      assert.deepEqual(await refs(), [29, 31, 75]);
      assert.equal((await cleanup(30)).deleted, 2);
      assert.deepEqual(await refs(), [29]);
      assert.equal((await cleanup(180)).deleted, 0);
      assert.deepEqual(await refs(), [29]);
    });

    await t.test('indexed batches drain the oldest rows first with deterministic ID ordering', async () => {
      await reset();
      await seedAudit(1, 2, new Date(now - 91 * day));
      await seedAudit(3, 20_002, new Date(now - 92 * day));
      await seedAudit(20_005, 1, new Date(now));
      const statements = [];
      let plan;
      const db = {
        async query(sql, params) {
          if (statements.length === 0) [plan] = await mysql.db.query('EXPLAIN ' + sql, params);
          statements.push({ sql, params });
          return mysql.db.query(sql, params);
        },
      };
      assert.deepEqual(await cleanupUsageEventAudit(db, retentionConfig(90), new Date(now)), {
        deleted: 20_000, tableMissing: false, limitReached: true,
      });
      assert.equal(statements.length, 20);
      assert.ok(statements.every(({ params }) => params[1] === 1000));
      assert.deepEqual(await refs(), [1, 2, 20_003, 20_004, 20_005]);
      assert.equal(plan.key, 'IDX_usage_audit_finalized');
      assert.equal(plan.type, 'range');
      assert.doesNotMatch(plan.Extra ?? '', /filesort/i);
      assert.equal((await cleanup()).deleted, 4);
      assert.equal((await cleanup()).deleted, 0);
      assert.deepEqual(await refs(), [20_005]);
    });

    await t.test('scheduled cleanup honors a 1501-row cap and warns about a possible backlog', async () => {
      await reset();
      await seedAudit(1, 1503, new Date(now - 91 * day));
      await seedAudit(1504, 1, new Date(now));
      await runCatalog(mysql.db, 'Usage audit retention cleanup reached its row limit. Expired rows may remain', {
        maxRowsPerPass: '1501',
      });
      assert.deepEqual(await refs(), [1502, 1503, 1504]);

      const oneRow = readLiveUsageAuditConfiguration({ LIVE_USAGE_AUDIT_MAX_ROWS_PER_PASS: '1' });
      assert.deepEqual(await cleanupUsageEventAudit(mysql.db, oneRow, new Date(now)), {
        deleted: 1, tableMissing: false, limitReached: true,
      });
      assert.deepEqual(await refs(), [1503, 1504]);
    });

    await t.test('an invalid row cap fails startup before retention can delete anything', async () => {
      await reset();
      await seedAudit(1, 2, new Date(now - 91 * day));
      await runCatalog(mysql.db, 'LIVE_USAGE_AUDIT_MAX_ROWS_PER_PASS must be an integer between 1 and 100000', {
        maxRowsPerPass: '100001', expectedExitCode: 1,
      });
      assert.deepEqual(await refs(), [1, 2]);
    });

    await t.test('a failed delete rolls back its batch and a later pass resumes from committed progress', async () => {
      await reset();
      await seedAudit(1, 1003, new Date(now - 91 * day));
      await mysql.db.query(`CREATE TRIGGER retention_fail BEFORE DELETE ON usage_event_audit FOR EACH ROW
        BEGIN IF OLD.provisionalEventId = 1002 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected retention failure';
        END IF; END`);
      try {
        await assert.rejects(cleanup(), /injected retention failure/);
        assert.deepEqual(await refs(), [1001, 1002, 1003]);
      } finally {
        await mysql.db.query('DROP TRIGGER retention_fail');
      }
      assert.equal((await cleanup()).deleted, 3);
      assert.equal((await cleanup()).deleted, 0);
    });

    await t.test('concurrent cleanup passes and provisional finalization preserve fresh audit and official records', async () => {
      await reset();
      await service.stage(input());
      await seedAudit(100, 1500, new Date(now - 91 * day));
      now += 120000;
      const [first, second, finalized] = await Promise.all([cleanup(), cleanup(), service.store.finalizeDue(new Date(now))]);
      assert.equal(first.deleted + second.deleted, 1500);
      assert.equal(finalized, 1);
      assert.deepEqual(await refs(), [1]);
      assert.deepEqual(await mysql.counts(), { usage: 1, searches: 0 });
      assert.equal((await rows())[0].status, 'ACCEPTED');
    });

    await t.test('cleanup skips a missing table in disabled mode and retries when the table returns', async () => {
      await reset();
      await seedAudit(1, 1, usageAuditRetentionCutoff(new Date(now), 90));
      await mysql.db.query('RENAME TABLE usage_event_audit TO audit_unavailable');
      try {
        assert.deepEqual(await cleanup(), { deleted: 0, tableMissing: true, limitReached: false });
        await assert.rejects(cleanupUsageEventAudit(mysql.db, retentionConfig(90, true), new Date(now)), {
          code: 'ER_NO_SUCH_TABLE',
        });
      } finally {
        await mysql.db.query('RENAME TABLE audit_unavailable TO usage_event_audit');
      }
      assert.deepEqual(await cleanup(), { deleted: 1, tableMissing: false, limitReached: false });
    });

    await t.test('default-disabled server starts without the audit table and enforces retention after restart', async () => {
      await reset();
      await seedAudit(1, 1, new Date(now - 60 * day));
      await seedAudit(2, 1, new Date(now - 15 * day));
      await mysql.db.query('RENAME TABLE usage_event_audit TO audit_unavailable');
      try {
        await runCatalog(mysql.db, 'Server is running on port 0');
      } finally {
        await mysql.db.query('RENAME TABLE audit_unavailable TO usage_event_audit');
      }
      await runCatalog(mysql.db, 'Usage audit retention cleanup completed', { retentionDays: '30' });
      assert.deepEqual(await refs(), [2]);
      await runCatalog(mysql.db, 'Usage audit retention cleanup completed', { retentionDays: '180' });
      assert.deepEqual(await refs(), [2]);
    });

    await t.test('server shuts down the database only after both active workers finish', async () => {
      await reset();
      for (const [first, second] of [['audit', 'provisional'], ['provisional', 'audit']]) {
        const output = await runCatalog(mysql.db, 'shutdown probe: audit started', { firstWorkerToFinish: first });
        assert.ok(output.includes('shutdown probe: provisional started'), output);
        assert.ok(output.includes(`shutdown probe: ${first} finished, ${second} finished, database destroy`), output);
        assert.doesNotMatch(output, /Provisional usage finalization failed|Failed to shut down server/);
      }
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    AppDataSource.getRepository = originalRepository;
    if (originalOrigin === undefined) delete process.env.LIVE_USAGE_ORIGIN;
    else process.env.LIVE_USAGE_ORIGIN = originalOrigin;
    await mysql.close();
  }
});
