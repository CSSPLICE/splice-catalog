import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { AppDataSource } from '../src/db/data-source.ts';
import { ProvisionalUsageEvent } from '../src/db/entities/ProvisionalUsageEvent.ts';
import { UsageEvent } from '../src/db/entities/UsageEvent.ts';
import { SearchEvent } from '../src/db/entities/SearchEvent.ts';
import { HistoricalUsage } from '../src/db/entities/HistoricalUsage.ts';
import { slc_item_catalog } from '../src/db/entities/SLCItemCatalog.ts';
import { LiveUsageBotProtection } from '../src/services/LiveUsageBotProtection.ts';
import {
  ProvisionalUsageService,
  MySqlProvisionalUsageStore,
  usageConfigurationId,
} from '../src/services/ProvisionalUsageService.ts';
import { UsageStatisticsService } from '../src/services/UsageStatisticsService.ts';
import { SearchStatisticsService } from '../src/services/SearchStatisticsService.ts';
import { UsageDashboardController } from '../src/controllers/UsageDashboardController.ts';
import { UsageController } from '../src/controllers/UsageController.ts';
import { createUsageRouter } from '../src/routes/usage.ts';
import { optionalMysql } from './helpers/live-usage-mysql.mjs';
const execute = promisify(execFile);
const secret = 'phase2-isolated-test-secret-at-least-32-bytes';
const fast = { reviewWindowMs: 1000, deadlineMs: 10000, retentionMs: 3600000 };
const ua = 'Mozilla/5.0 FixturePrivacyBrowser';
const payload = {
  kind: 'ENTRY_CLICK',
  itemPersistentID: 'urn:phase2:1',
  itemTitle: 'Fixture',
  catalogType: 'SLC_ITEM',
  catalogPath: '/catalog/item/1',
};

test(
  'Phase 2 real MySQL lifecycle, HTTP and dashboard',
  {
    skip: process.env.LIVE_USAGE_TEST_MYSQL !== 'disposable' ? 'Opt in to a disposable localhost MySQL schema' : false,
    timeout: 120000,
  },
  async (t) => {
    const mysql = await optionalMysql({ phase2: true });
    const originalRepository = AppDataSource.getRepository;
    const originalOrigin = process.env.LIVE_USAGE_ORIGIN;
    AppDataSource.getRepository = (entity) => mysql.db.getRepository(entity);
    await mysql.db
      .getRepository(slc_item_catalog)
      .createQueryBuilder()
      .insert()
      .values({
        id: 1,
        catalog_type: 'SLC_ITEM',
        persistentID: payload.itemPersistentID,
        title: payload.itemTitle,
        iframe_url: '/resource',
        keywords: [],
      })
      .callListeners(false)
      .execute();
    await mysql.db.getRepository(HistoricalUsage).insert({
      catalogType: 'SLC_ITEM',
      legacyCatalogId: 42,
      itemPersistentID: 'unchanged',
      itemTitle: 'Historical sentinel',
      viewCount: 99,
      source: 'nginx_historical',
    });
    let now, protection, service;
    async function reset(options = {}) {
      await mysql.clear();
      now = Date.now();
      protection = new LiveUsageBotProtection({ mode: 'enforce' }, () => now);
      service = new ProvisionalUsageService(mysql.db, secret, protection.options, { ...fast, ...options }, () => now);
    }
    await reset();
    const app = express();
    app.use('/usage', (req, res, next) => createUsageRouter(protection, service)(req, res, next));
    app.post('/fixture/direct', express.json(), (req, res) =>
      new UsageController(protection, service).recordEntryClick(req, res),
    );
    const dashboard = new UsageDashboardController();
    app.get('/fixture/dashboard.json', (req, res) => dashboard.export(req, res));
    app.get('/fixture/dashboard.csv', (req, res) => dashboard.exportCsv(req, res));
    const server = await new Promise((done) => {
      const listener = app.listen(0, '127.0.0.1', () => done(listener));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    process.env.LIVE_USAGE_ORIGIN = base;
    const observations = () => mysql.db.getRepository(ProvisionalUsageEvent).find({ order: { id: 'ASC' } });
    function input(extra = {}) {
      return {
        sessionId: 'fixture-session',
        sessionStartedAt: now,
        ip: '192.0.2.1',
        userAgent: ua,
        eventId: randomBytes(16).toString('hex'),
        kind: payload.kind,
        identity: 'SLC_ITEM:urn:phase2:1',
        decision: { decision: 'ACCEPT', reason: 'ELIGIBLE_BROWSER_EVENT' },
        payload,
        ...extra,
      };
    }
    async function credentials() {
      const response = await fetch(base + '/usage/session', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json', 'User-Agent': ua },
        body: '{}',
      });
      assert.equal(response.status, 200);
      return {
        Cookie: response.headers.get('set-cookie').split(';')[0],
        'X-Usage-Token': (await response.json()).csrf,
      };
    }
    async function post(path, data, auth) {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json', 'User-Agent': ua, ...auth },
        body: JSON.stringify(data),
      });
      return { status: response.status, body: await response.json() };
    }
    try {
      await t.test('actual migration is tracked and metadata agrees with its columns/indexes', async () => {
        assert.deepEqual(await mysql.db.showMigrations(), false);
        const [tracked] = await mysql.db.query('SELECT name FROM migrations');
        assert.equal(tracked.name, 'CreateProvisionalUsageEvents1794000000000');
        const schemaDiff = await mysql.db.driver.createSchemaBuilder().log();
        assert.deepEqual(schemaDiff.upQueries, []);
        assert.deepEqual(schemaDiff.downQueries, []);
      });
      await t.test('pending HTTP entry, external and WEB search do not enter official dashboard/CSV', async () => {
        await reset();
        const auth = await credentials();
        for (const [path, data] of [
          ['/usage/entry-click', { catalogType: 'SLC_ITEM', itemIdentifier: payload.itemPersistentID }],
          [
            '/usage/external-click',
            { catalogType: 'SLC_ITEM', itemIdentifier: payload.itemPersistentID, linkType: 'iframe_url' },
          ],
          ['/usage/web-search', { query: ' binary   tree ' }],
        ]) {
          const result = await post(path, { ...data, eventId: randomBytes(16).toString('hex') }, auth);
          assert.equal(result.status, 202);
          assert.equal(result.body.counted, false);
          assert.equal(result.body.status, 'PENDING');
        }
        assert.equal((await service.store.summary()).pending, 3);
        assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
        const pending = await (await fetch(base + '/fixture/dashboard.json?period=all')).json();
        assert.equal(
          pending.summary.totalEntryClicks + pending.summary.totalExternalClicks + pending.summary.webSearches,
          0,
        );
        now += 1001;
        await service.tick();
        assert.deepEqual(await mysql.counts(), { usage: 2, searches: 1 });
        const snapshot = await (await fetch(base + '/fixture/dashboard.json?period=all')).json();
        assert.equal(snapshot.summary.totalEntryClicks, 1);
        assert.equal(snapshot.summary.totalExternalClicks, 1);
        assert.equal(snapshot.summary.webSearches, 1);
        const csv = await (await fetch(base + '/fixture/dashboard.csv?period=all')).text();
        assert.match(csv, /totalEntryClicks,1/);
        assert.match(csv, /totalExternalClicks,1/);
        assert.match(csv, /webSearches,1/);
        assert.equal(
          (await mysql.db.getRepository(SearchEvent).findOneByOrFail({ source: 'WEB' })).query,
          'binary tree',
        );
        assert.ok((await observations()).every((row) => row.payload === null && row.status === 'ACCEPTED'));
      });
      await t.test(
        'alternate controller route inherits provisional admission rather than immediate writes',
        async () => {
          await reset();
          const auth = await credentials();
          const result = await post(
            '/fixture/direct',
            { catalogType: 'SLC_ITEM', itemIdentifier: payload.itemPersistentID, eventId: 'alternateRoute123456' },
            auth,
          );
          assert.equal(result.body.status, 'PENDING');
          assert.equal((await mysql.counts()).usage, 0);
          now += 1001;
          await service.tick();
          assert.equal((await mysql.counts()).usage, 1);
        },
      );
      await t.test('known bot with valid credentials is rejected and taints only its pending session', async () => {
        await reset();
        const auth = await credentials();
        await post(
          '/usage/entry-click',
          { catalogType: 'SLC_ITEM', itemIdentifier: payload.itemPersistentID, eventId: 'earlyValidEvent1234' },
          auth,
        );
        const bot = await post(
          '/usage/entry-click',
          { catalogType: 'SLC_ITEM', itemIdentifier: payload.itemPersistentID, eventId: 'laterBotEvent123456' },
          { ...auth, 'User-Agent': 'Googlebot/2.1' },
        );
        assert.equal(bot.body.status, 'REJECTED');
        now += 1001;
        await service.tick();
        assert.equal((await mysql.counts()).usage, 0);
        assert.deepEqual(
          (await observations()).map((row) => row.status),
          ['REVIEW', 'REJECTED'],
        );
      });
      await t.test('an admission database error permits a safe retry of the same event ID', async () => {
        await reset();
        const auth = await credentials();
        const event = {
          catalogType: 'SLC_ITEM',
          itemIdentifier: payload.itemPersistentID,
          eventId: 'admissionRetry123456',
        };
        await mysql.db.query(
          "CREATE TRIGGER phase2_admission_fail BEFORE INSERT ON provisional_usage_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'simulated admission failure'",
        );
        try {
          const response = await post('/usage/entry-click', event, auth);
          assert.equal(response.status, 503);
          assert.equal(response.body.counted, false);
        } finally {
          await mysql.db.query('DROP TRIGGER phase2_admission_fail');
        }
        assert.equal((await post('/usage/entry-click', event, auth)).body.status, 'PENDING');
        assert.equal((await observations()).length, 1);
        now += 1001;
        await service.tick();
        assert.equal((await mysql.counts()).usage, 1);
      });
      await t.test('20 rapid events: Phase 1 accepts 12, all 20 are withheld after review', async () => {
        await reset();
        const session = protection.issueSession(undefined, ua);
        const old = [];
        for (let i = 0; i < 20; i++) {
          const eventId = randomBytes(16).toString('hex');
          const decision = protection.classifyBrowser({
            ip: '192.0.2.1',
            userAgent: ua,
            sameOrigin: true,
            sessionId: session.id,
            csrf: session.csrf,
            eventId,
            kind: 'ENTRY_CLICK',
            identity: `item-${i}`,
          });
          old.push(decision);
          await service.stage(input({ sessionId: session.id, eventId, identity: `item-${i}`, decision }));
          now += 10;
        }
        assert.equal(old.filter((d) => d.decision === 'ACCEPT').length, 12);
        now += 1001;
        await service.tick();
        assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
        assert.equal((await observations()).filter((row) => row.status === 'REVIEW').length, 20);
      });
      await t.test('replayed admissions and concurrent independent workers cannot double-count', async () => {
        await reset();
        const event = input();
        await Promise.all(Array.from({ length: 10 }, () => service.stage(event)));
        assert.equal((await observations()).length, 1);
        const other = new ProvisionalUsageService(mysql.db, secret, protection.options, fast, () => now);
        now += 1001;
        await Promise.all([service.tick(), other.tick(), service.tick()]);
        assert.deepEqual(await mysql.counts(), { usage: 1, searches: 0 });
        assert.equal((await observations())[0].status, 'ACCEPTED');
        await service.tick();
        await service.stage(event);
        await service.tick();
        assert.equal((await mysql.counts()).usage, 1);
      });
      await t.test('HTTP retry reconciles the stored event even after local replay reservation', async () => {
        await reset();
        const auth = await credentials();
        const event = {
          catalogType: 'SLC_ITEM',
          itemIdentifier: payload.itemPersistentID,
          eventId: 'stableHttpEvent123456',
        };
        assert.equal((await post('/usage/entry-click', event, auth)).body.status, 'PENDING');
        const retry = await post('/usage/entry-click', event, auth);
        assert.equal(retry.body.reason, 'DUPLICATE_EVENT');
        assert.equal((await observations()).length, 1);
        now += 1001;
        await service.tick();
        assert.equal((await post('/usage/entry-click', event, auth)).body.status, 'ACCEPTED');
        assert.equal((await mysql.counts()).usage, 1);
      });
      await t.test('a real process restart preserves pending payload/evidence and finalizes exactly once', async () => {
        await reset();
        await service.stage(input());
        now += 1001;
        const launch = () =>
          execute(process.execPath, ['--loader', 'ts-node/esm', 'tests/local-bot-simulations/worker-once.mjs'], {
            env: {
              ...process.env,
              TS_NODE_EXPERIMENTAL_RESOLVER: 'true',
              TS_NODE_TRANSPILE_ONLY: 'true',
              LIVE_USAGE_PROVISIONAL_ENABLED: 'false',
              PHASE2_TEST_SCHEMA: mysql.schema,
              PHASE2_TEST_STATE_SECRET: secret,
              PHASE2_TEST_OPTIONS: JSON.stringify(fast),
              PHASE2_TEST_NOW: String(now),
            },
            timeout: 15000,
          });
        const workers = await Promise.all([launch(), launch()]);
        assert.equal(
          workers.reduce((total, worker) => total + JSON.parse(worker.stdout.trim()).finalized, 0),
          1,
        );
        assert.equal((await mysql.counts()).usage, 1);
        await service.tick();
        assert.equal((await mysql.counts()).usage, 1);
      });
      await t.test('later evidence still applies when all volatile browser state is replaced', async () => {
        await reset();
        for (let i = 0; i < 13; i++) await service.stage(input({ identity: `item-${i}` }));
        await mysql.reconnect();
        now += 1001;
        const restarted = new ProvisionalUsageService(
          mysql.db,
          secret,
          new LiveUsageBotProtection({ mode: 'enforce' }).options,
          fast,
          () => now,
        );
        await restarted.tick();
        assert.equal((await mysql.counts()).usage, 0);
        assert.ok((await observations()).every((row) => row.status === 'REVIEW'));
      });
      await t.test('official insert and state transition roll back together on real database error', async () => {
        await reset();
        await service.stage(input());
        now += 1001;
        await mysql.db.query(
          "CREATE TRIGGER phase2_fail BEFORE UPDATE ON provisional_usage_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'simulated transition failure'",
        );
        try {
          await assert.rejects(service.tick());
        } finally {
          await mysql.db.query('DROP TRIGGER phase2_fail');
        }
        assert.equal((await mysql.counts()).usage, 0);
        assert.equal((await observations())[0].status, 'PENDING');
        assert.ok((await observations())[0].payload);
        await service.tick();
        assert.equal((await mysql.counts()).usage, 1);
      });
      await t.test('queue capacity, configuration mismatch and missing credentials fail closed', async () => {
        await reset({ maxRows: 1 });
        await service.stage(input());
        await assert.rejects(service.stage(input()), /PROVISIONAL_CAPACITY/);
        const mismatched = new ProvisionalUsageService(
          mysql.db,
          'another-secret-with-at-least-32-bytes',
          protection.options,
          { ...fast, maxRows: 1 },
          () => now,
        );
        await assert.rejects(mismatched.tick(), /PROVISIONAL_CONFIGURATION_MISMATCH/);
        assert.equal(
          (
            await post(
              '/usage/entry-click',
              { catalogType: 'SLC_ITEM', itemIdentifier: payload.itemPersistentID, eventId: 'withoutCredentials123' },
              {},
            )
          ).status,
          401,
        );
        assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
      });
      await t.test('deadline expiry redacts payload and cleanup deletes only expired provisional rows', async () => {
        await reset();
        await service.stage(input());
        const sentinel = await mysql.db.getRepository(UsageEvent).save({ ...payload, eventType: 'ENTRY_CLICK' });
        now += 10000;
        await service.tick();
        assert.equal((await observations())[0].status, 'EXPIRED');
        assert.equal((await observations())[0].payload, null);
        now += service.options.retentionMs;
        await service.tick();
        assert.equal((await observations()).length, 0);
        assert.equal((await mysql.counts()).usage, 1);
        assert.ok(await mysql.db.getRepository(UsageEvent).findOneBy({ id: sentinel.id }));
        assert.equal((await mysql.db.getRepository(HistoricalUsage).find())[0].viewCount, 99);
      });
      await t.test(
        'original interaction timestamp, daily and per-item statistics survive delayed visibility',
        async () => {
          await reset();
          const interaction = now;
          await service.stage(input());
          now += 1001;
          await service.tick();
          const row = (await mysql.db.getRepository(UsageEvent).find())[0];
          assert.equal(row.createdAt.getTime(), interaction);
          const stats = new UsageStatisticsService();
          assert.equal((await stats.getOverallStatistics(undefined, undefined, false)).totalEntryClicks, 1);
          assert.equal(
            (await stats.getDailyActivity()).reduce((n, day) => n + day.entryClicks, 0),
            1,
          );
          assert.equal(
            (await stats.getPerItemStatistics('entryClicks', undefined, undefined, false))[0].entryClicks,
            1,
          );
          assert.deepEqual(await new SearchStatisticsService().getSummary(), { webSearches: 0, publicApiSearches: 0 });
        },
      );
      await t.test('actual short review-window latency is observed rather than inferred', async () => {
        await reset({ reviewWindowMs: 200 });
        const realtime = new ProvisionalUsageService(mysql.db, secret, protection.options, {
          ...fast,
          reviewWindowMs: 200,
        });
        const began = Date.now();
        await realtime.stage(input());
        await realtime.tick();
        assert.equal((await mysql.counts()).usage, 0);
        await delay(220);
        await realtime.tick();
        assert.equal((await mysql.counts()).usage, 1);
        const elapsed = Date.now() - began;
        assert.ok(elapsed >= 200 && elapsed < 10000);
        t.diagnostic(`Measured local 200 ms policy visibility latency: ${elapsed} ms`);
      });
      await t.test(
        'durable coordination accepts five synchronized professors, unrelated actions and a shared-IP bystander',
        async () => {
          await reset({ reviewWindowMs: 10000, deadlineMs: 30000 });
          const began = now;
          for (let step = 0; step < 5; step++)
            for (let session = 0; session < 5; session++) {
              now = began + step * 1000 + session * 10;
              await service.stage(
                input({ sessionId: `coordinated-${session}`, sessionStartedAt: began, identity: `item-${step}` }),
              );
            }
          for (const kind of ['EXTERNAL_CLICK', 'WEB_SEARCH'])
            await service.stage(
              input({
                sessionId: 'coordinated-0',
                sessionStartedAt: began,
                kind,
                identity: 'unrelated',
                payload:
                  kind === 'WEB_SEARCH'
                    ? { kind, query: 'unrelated', catalogType: 'SLC_ITEM' }
                    : { ...payload, kind, linkType: 'iframe_url' },
              }),
            );
          await service.stage(
            input({ sessionId: 'professor-bystander', sessionStartedAt: began, identity: 'other-item' }),
          );
          now += 10001;
          await service.tick();
          assert.deepEqual(await mysql.counts(), { usage: 27, searches: 1 });
          const rows = await observations();
          assert.equal(rows.filter((row) => row.reason === 'COORDINATION_OBSERVED').length, 25);
          assert.ok(rows.every((row) => row.status === 'ACCEPTED'));
          assert.ok(
            rows.filter((row) => row.kind !== 'ENTRY_CLICK').every((row) => row.reason === 'REVIEW_WINDOW_ELIGIBLE'),
          );
        },
      );
      await t.test(
        '1000 known bots and 601 missing/invalid token requests cannot exclude five shared-IP professors',
        async () => {
          await reset();
          const auth = await credentials();
          const body = { catalogType: 'SLC_ITEM', itemIdentifier: payload.itemPersistentID };
          for (const [count, headers, reason] of [
            [1000, { 'User-Agent': 'Googlebot/2.1' }, 'KNOWN_AUTOMATION'],
            [601, {}, 'SESSION_MISSING'],
            [601, { ...auth, 'X-Usage-Token': 'invalid' }, 'TOKEN_INVALID'],
          ]) {
            for (let i = 0; i < count; i++) {
              const result = await post(
                '/usage/entry-click',
                { ...body, eventId: randomBytes(16).toString('hex') },
                headers,
              );
              assert.equal(result.body.reason, reason);
              assert.equal(result.body.counted, false);
            }
          }
          assert.equal((await observations()).length, 0);
          for (let i = 0; i < 5; i++) {
            const result = await post(
              '/usage/entry-click',
              { ...body, eventId: randomBytes(16).toString('hex') },
              await credentials(),
            );
            assert.equal(result.body.status, 'PENDING');
          }
          assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
          now += 1001;
          await service.tick();
          assert.equal((await mysql.counts()).usage, 5);
        },
      );
      await t.test(
        'HTTP replay floods, concurrent duplicates and distinct repeated click IDs preserve official counts',
        async () => {
          await reset();
          const auth = await credentials();
          const event = {
            catalogType: 'SLC_ITEM',
            itemIdentifier: payload.itemPersistentID,
            eventId: randomBytes(16).toString('hex'),
          };
          const responses = await Promise.all(
            Array.from({ length: 20 }, () => post('/usage/entry-click', event, auth)),
          );
          assert.equal(responses.filter((r) => !r.body.duplicate).length, 1);
          for (let i = 0; i < 601; i++)
            assert.equal((await post('/usage/entry-click', event, auth)).body.reason, 'DUPLICATE_EVENT');
          assert.equal(
            (await post('/usage/entry-click', { ...event, eventId: randomBytes(16).toString('hex') }, auth)).body
              .status,
            'PENDING',
          );
          assert.equal((await observations()).length, 2);
          now += 1001;
          await service.tick();
          assert.equal((await mysql.counts()).usage, 2);
        },
      );
      await t.test(
        'credentialed high-volume abuse is session-local, with REJECTED evidence and no bystander loss',
        async () => {
          await reset();
          const auth = await credentials();
          for (let i = 0; i < 241; i++) {
            const result = await post(
              '/usage/entry-click',
              {
                catalogType: 'SLC_ITEM',
                itemIdentifier: payload.itemPersistentID,
                eventId: randomBytes(16).toString('hex'),
              },
              auth,
            );
            if (i === 240) assert.equal(result.body.status, 'REJECTED');
          }
          for (let i = 0; i < 5; i++)
            await post(
              '/usage/entry-click',
              {
                catalogType: 'SLC_ITEM',
                itemIdentifier: payload.itemPersistentID,
                eventId: randomBytes(16).toString('hex'),
              },
              await credentials(),
            );
          now += 1001;
          while ((await service.store.summary()).pending) await service.tick();
          assert.equal((await mysql.counts()).usage, 5);
          assert.equal((await observations()).filter((r) => r.status === 'REJECTED').length, 1);
        },
      );
      await t.test(
        'a saturated optional cohort cannot crowd out session burst detection or bystander eligibility',
        async () => {
          await reset({ maxEvidence: 20 });
          for (let i = 0; i < 30; i++) await service.stage(input({ sessionId: `unrelated-${i}` }));
          for (let i = 0; i < 20; i++) await service.stage(input({ sessionId: 'burst', identity: `item-${i}` }));
          now += 1001;
          await service.tick();
          assert.equal((await mysql.counts()).usage, 30);
          assert.equal(
            (await observations()).filter((r) => r.reason === 'COORDINATION_CAPACITY_UNOBSERVED').length,
            30,
          );
          assert.equal((await observations()).filter((r) => r.reason === 'RETROSPECTIVE_EVENT_BURST').length, 20);
        },
      );
      await t.test(
        'explicit legacy drain/switch, configuration upgrade and rollback fence workers without altering records',
        async () => {
          await reset();
          const current = structuredClone(service.configuration);
          const legacy = { ...current, policy: 'phase2-v1' };
          const legacyId = usageConfigurationId(secret, legacy);
          const oldStore = new MySqlProvisionalUsageStore(mysql.db, service.options, protection.options, legacyId);
          const oldService = new ProvisionalUsageService(
            mysql.db,
            secret,
            protection.options,
            fast,
            () => now,
            oldStore,
          );
          const original = input();
          await oldService.stage(original);
          await assert.rejects(service.tick(), /PROVISIONAL_CONFIGURATION_MISMATCH/);
          await assert.rejects(service.transitionPolicy(legacy), /PROVISIONAL_POLICY_DRAIN_REQUIRED/);
          await mysql.reconnect();
          assert.equal((await observations())[0].status, 'PENDING');
          // Recreate the predecessor store against the restarted connection.
          const drained = new MySqlProvisionalUsageStore(mysql.db, service.options, protection.options, legacyId);
          now += 1001;
          await drained.finalizeDue(new Date(now));
          assert.equal((await mysql.counts()).usage, 1);
          const upgraded = new ProvisionalUsageService(mysql.db, secret, protection.options, fast, () => now);
          const snapshot = await observations();
          const officialBefore = await mysql.db.getRepository(UsageEvent).find();
          assert.deepEqual(await upgraded.transitionPolicy(legacy), { from: legacyId, to: upgraded.configurationId });
          await assert.rejects(drained.stage(snapshot[0], false), /PROVISIONAL_CONFIGURATION_MISMATCH/);
          await assert.rejects(drained.finalizeDue(new Date(now)), /PROVISIONAL_CONFIGURATION_MISMATCH/);
          assert.deepEqual(await observations(), snapshot);
          assert.deepEqual(await mysql.db.getRepository(UsageEvent).find(), officialBefore);
          assert.equal((await upgraded.stage(original)).duplicate, true);
          assert.equal((await mysql.counts()).usage, 1);
          assert.equal((await upgraded.stage(input())).status, 'PENDING');
          await assert.rejects(upgraded.transitionPolicy(current, legacy), /PROVISIONAL_POLICY_DRAIN_REQUIRED/);
          now += 1001;
          await upgraded.tick();
          // Supported configuration changes use the same drain fence.
          const changed = new ProvisionalUsageService(
            mysql.db,
            secret,
            protection.options,
            { ...fast, pollMs: 2000 },
            () => now,
          );
          await assert.rejects(changed.tick(), /PROVISIONAL_CONFIGURATION_MISMATCH/);
          await mysql.db.query(
            "CREATE TRIGGER phase21_policy_fail BEFORE UPDATE ON live_usage_pipeline_lock FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'simulated policy failure'",
          );
          try {
            await assert.rejects(changed.transitionPolicy(current));
          } finally {
            await mysql.db.query('DROP TRIGGER phase21_policy_fail');
          }
          await upgraded.tick(); // Failed switch rolled back; previous worker remains valid.
          assert.equal((await mysql.counts()).usage, 2);
          await changed.transitionPolicy(current);
          await assert.rejects(upgraded.tick(), /PROVISIONAL_CONFIGURATION_MISMATCH/);
          await changed.tick();
          // Roll back with the new tool, then restart the old application binary.
          await changed.transitionPolicy(changed.configuration, legacy);
          await assert.rejects(changed.tick(), /PROVISIONAL_CONFIGURATION_MISMATCH/);
          await drained.finalizeDue(new Date(now));
          assert.equal((await mysql.counts()).usage, 2);
          assert.deepEqual((await mysql.db.getRepository(UsageEvent).find())[0], officialBefore[0]);
          const wrongSecret = new ProvisionalUsageService(
            mysql.db,
            'different-secret-with-at-least-32-bytes',
            protection.options,
            fast,
            () => now,
          );
          await assert.rejects(wrongSecret.transitionPolicy(legacy), /PROVISIONAL_CONFIGURATION_MISMATCH/);
          await assert.rejects(
            upgraded.transitionPolicy(legacy, {
              ...current,
              thresholds: { ...current.thresholds, sessionTtlMs: 3600000 },
            }),
            /PROVISIONAL_CREDENTIAL_POLICY_CHANGE_UNSUPPORTED/,
          );
        },
      );

      await t.test('operator CLI inspects, switches and rolls back only the disposable schema', async () => {
        await reset();
        const legacy = { ...service.configuration, policy: 'phase2-v1' };
        const legacyId = usageConfigurationId(secret, legacy);
        await new MySqlProvisionalUsageStore(
          mysql.db,
          service.options,
          protection.options,
          legacyId,
        ).assertConfiguration();
        const variable = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
        const env = {
          ...process.env,
          TS_NODE_EXPERIMENTAL_RESOLVER: 'true',
          TS_NODE_TRANSPILE_ONLY: 'true',
          LIVE_USAGE_MODE: 'enforce',
          LIVE_USAGE_PROVISIONAL_ENABLED: 'true',
          LIVE_USAGE_STATE_SECRET: secret,
          DB_HOST: '127.0.0.1',
          DB_PORT: process.env.LIVE_USAGE_TEST_MYSQL_PORT,
          DB_USERNAME: 'root',
          DB_PASSWORD: process.env.LIVE_USAGE_TEST_MYSQL_PASSWORD || 'local-test-only',
          DB_DATABASE: mysql.schema,
          ORM_LOGGING: 'false',
          LIVE_USAGE_BOT_INDICATORS: '',
        };
        for (const [key, value] of Object.entries(service.options))
          env[`LIVE_USAGE_PROVISIONAL_${variable(key)}`] = String(value);
        for (const [key, value] of Object.entries(protection.options))
          if (typeof value === 'number') env[`LIVE_USAGE_${variable(key)}`] = String(value);
        const cli = async (...args) =>
          JSON.parse(
            (
              await execute(process.execPath, ['--loader', 'ts-node/esm', 'src/scripts/liveUsagePolicy.ts', ...args], {
                env,
                timeout: 15000,
              })
            ).stdout.trim(),
          );
        assert.deepEqual(await cli('manifest'), service.configuration);
        assert.equal((await cli('status')).active, legacyId);
        assert.equal((await cli('transition', '--from', 'legacy')).to, service.configurationId);
        assert.equal((await cli('status')).active, service.configurationId);
        // File manifest is the supported predecessor for future upgrades/rollback.
        const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const dir = await mkdtemp(join(tmpdir(), 'splice-policy-'));
        try {
          const path = join(dir, 'current.json');
          await writeFile(path, JSON.stringify(await cli('manifest')));
          assert.equal((await cli('transition', '--from', path, '--to', 'legacy')).to, legacyId);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
        assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
      });
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      AppDataSource.getRepository = originalRepository;
      if (originalOrigin === undefined) delete process.env.LIVE_USAGE_ORIGIN;
      else process.env.LIVE_USAGE_ORIGIN = originalOrigin;
      await mysql.close();
    }
  },
);
