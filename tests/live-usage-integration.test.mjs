import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';
import { AppDataSource } from '../src/db/data-source.ts';
import { UsageEvent } from '../src/db/entities/UsageEvent.ts';
import { SearchEvent } from '../src/db/entities/SearchEvent.ts';
import { slc_item_catalog } from '../src/db/entities/SLCItemCatalog.ts';
import { createUsageRouter } from '../src/routes/usage.ts';
import { UsageController } from '../src/controllers/UsageController.ts';
import { SearchController } from '../src/controllers/SearchController.ts';
import { LiveUsageBotProtection } from '../src/services/LiveUsageBotProtection.ts';
import { browserUsageSession, usageJson, usagePayloadErrors } from '../src/middleware/liveUsageProtection.ts';
import { meilisearchService } from '../src/services/MeilisearchService.ts';
import { optionalMysql } from './helpers/live-usage-mysql.mjs';

const ua = 'Mozilla/5.0 TestBrowser';
const click = { catalogType: 'SLC_ITEM', itemIdentifier: 'urn:test:7' };

test('live event HTTP write path in enforce mode', { timeout: 30000 }, async (t) => {
  const mysql = await optionalMysql();
  const originalRepository = AppDataSource.getRepository,
    originalSearch = meilisearchService.search;
  let events = [],
    searches = [],
    failure = false,
    now = Date.now();
  let protection;
  function reset(options = {}) {
    events = [];
    searches = [];
    failure = false;
    now = Date.now();
    protection = new LiveUsageBotProtection({ mode: 'enforce', ...options }, () => now);
  }
  reset();
  AppDataSource.getRepository = (entity) => {
    if (entity === UsageEvent || entity === SearchEvent)
      return {
        create: (data) => ({ ...data }),
        save: async (data) => {
          if (failure) throw new Error('simulated database failure');
          if (mysql) await mysql.save(entity, data);
          (entity === UsageEvent ? events : searches).push(data);
          return data;
        },
      };
    assert.equal(entity, slc_item_catalog);
    return {
      findOneBy: async ({ persistentID }) =>
        persistentID === click.itemIdentifier
          ? { id: 7, persistentID, title: 'Canonical', iframe_url: '/resource' }
          : null,
    };
  };
  meilisearchService.search = async () => [];
  const app = express();
  app.use('/usage', usageJson, usagePayloadErrors);
  app.use(express.json({ limit: '50mb' }));
  app.use('/usage', (req, res, next) => createUsageRouter(protection)(req, res, next));
  app.post('/alternate-write', (req, res) => new UsageController(protection).recordEntryClick(req, res));
  app.get('/api/:catalog', (req, res) => new SearchController(protection).searchCatalogAPI(req, res));
  app.get(
    '/page',
    (req, res, next) => browserUsageSession(protection)(req, res, next),
    (_req, res) => res.json(res.locals.liveUsageSession),
  );
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const server = await new Promise((done) => {
    const listener = app.listen(0, '127.0.0.1', () => done(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function session(userAgent = ua) {
    const res = await fetch(`${base}/usage/session`, {
      method: 'POST',
      headers: { Origin: base, 'User-Agent': userAgent, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 200);
    return {
      cookie: res.headers.get('set-cookie').split(';')[0],
      token: (await res.json()).csrf,
      rawCookie: res.headers.get('set-cookie'),
    };
  }
  async function post(path = '/usage/entry-click', body = click, credentials, headers = {}) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: {
        Origin: base,
        'User-Agent': ua,
        'Content-Type': 'application/json',
        ...(credentials ? { Cookie: credentials.cookie, 'X-Usage-Token': credentials.token } : {}),
        ...headers,
      },
      body: JSON.stringify({ ...body, eventId: body.eventId || randomBytes(16).toString('hex') }),
    });
    return { status: response.status, body: await response.json() };
  }
  try {
    for (const [path, body, field] of [
      ['/usage/entry-click', click, 'usage'],
      ['/usage/external-click', { ...click, linkType: 'iframe_url' }, 'usage'],
      ['/usage/web-search', { query: ' binary   tree ' }, 'searches'],
    ]) {
      await t.test(`${path}: accepted event saves once and known bot saves zero`, async () => {
        reset();
        const credentials = await session();
        const accepted = await post(path, body, credentials);
        assert.equal(accepted.status, 201);
        assert.equal(accepted.body.counted, true);
        const rejected = await post(path, body, credentials, { 'User-Agent': 'Googlebot' });
        assert.equal(rejected.body.counted, false);
        assert.equal(rejected.body.reason, 'KNOWN_AUTOMATION');
        assert.equal(field === 'usage' ? events.length : searches.length, 1);
        if (field === 'searches') assert.equal(searches[0].query, 'binary tree');
      });
    }
    await t.test('direct POSTs and alternate controller route cannot bypass credentials', async () => {
      reset();
      for (let i = 0; i < 20; i++) {
        const result = await post(i % 2 ? '/alternate-write' : '/usage/entry-click');
        assert.equal(result.status, 401);
        assert.equal(result.body.counted, false);
      }
      assert.equal(events.length, 0);
    });
    await t.test('cross-origin, same-site subdomain, null origin and forged token cannot count', async () => {
      reset();
      const credentials = await session();
      for (const headers of [
        { Origin: 'https://evil.test' },
        { Origin: 'null' },
        { 'Sec-Fetch-Site': 'same-site' },
        { 'X-Usage-Token': 'forged' },
      ]) {
        assert.equal((await post(undefined, undefined, credentials, headers)).body.counted, false);
      }
      assert.equal(events.length, 0);
    });
    await t.test('Referer fallback is same-origin only; missing provenance is rejected', async () => {
      reset();
      const credentials = await session();
      async function withoutOrigin(referer) {
        const response = await fetch(base + '/usage/entry-click', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': ua,
            Cookie: credentials.cookie,
            'X-Usage-Token': credentials.token,
            ...(referer ? { Referer: referer } : {}),
          },
          body: JSON.stringify({ ...click, eventId: randomBytes(16).toString('hex') }),
        });
        return response.json();
      }
      assert.equal((await withoutOrigin(base + '/catalog')).counted, true);
      assert.equal((await withoutOrigin('https://evil.test/catalog')).reason, 'ORIGIN_INVALID');
      assert.equal((await withoutOrigin()).reason, 'ORIGIN_INVALID');
      assert.equal(events.length, 1);
    });
    await t.test('session capacity and issuance failure have explicit non-counting responses', async () => {
      reset({ maxSessions: 1 });
      await session();
      const response = await fetch(base + '/usage/session', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).reason, 'STATE_CAPACITY');
      protection.issueSession = () => {
        throw new Error('state failed');
      };
      const unavailable = await fetch(base + '/usage/session', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(unavailable.status, 503);
      assert.equal((await unavailable.json()).reason, 'STATE_UNAVAILABLE');
      const page = await fetch(base + '/page', { headers: { Accept: 'text/html' } });
      assert.equal(page.status, 200);
      assert.equal(events.length, 0);
    });
    await t.test('invalid payloads and unknown identifiers never save', async () => {
      reset();
      const credentials = await session();
      for (const body of [
        {},
        { catalogType: 'TOOL', itemIdentifier: '-1' },
        { ...click, itemIdentifier: 'unknown' },
        { ...click, itemIdentifier: [] },
      ]) {
        const response = await post(undefined, body, credentials);
        assert.ok([400, 404].includes(response.status));
        assert.equal(response.body.counted, false);
      }
      assert.equal(events.length, 0);
    });
    await t.test('event replay under concurrent HTTP requests creates exactly one row', async () => {
      reset();
      const credentials = await session();
      const body = JSON.stringify({ ...click, eventId: 'sameEventId123456789' });
      const results = await Promise.all(
        Array.from({ length: 20 }, async () => {
          const response = await fetch(base + '/usage/entry-click', {
            method: 'POST',
            headers: {
              Origin: base,
              'Content-Type': 'application/json',
              'User-Agent': ua,
              Cookie: credentials.cookie,
              'X-Usage-Token': credentials.token,
            },
            body,
          });
          return response.json();
        }),
      );
      assert.equal(events.length, 1);
      assert.equal(results.filter((r) => r.counted).length, 1);
      assert.equal(results.filter((r) => r.reason === 'EVENT_REPLAY').length, 19);
    });
    await t.test('reviewed repetition excluded, deliberate repeats counted', async () => {
      reset({ repeatReview: 2 });
      const credentials = await session();
      for (let i = 0; i < 2; i++) assert.equal((await post(undefined, undefined, credentials)).body.counted, true);
      const reviewed = await post(undefined, undefined, credentials);
      assert.equal(reviewed.body.decision, 'REVIEW');
      assert.equal(reviewed.body.counted, false);
      assert.equal(events.length, 2);
    });
    await t.test('database errors return counted false and cannot replay into a second attempt', async () => {
      reset();
      const credentials = await session();
      failure = true;
      const failedEvent = { ...click, eventId: 'failedEvent123456789' };
      const response = await post(undefined, failedEvent, credentials);
      assert.equal(response.status, 500);
      assert.equal(response.body.counted, false);
      assert.equal(events.length, 0);
      failure = false;
      const replay = await post(undefined, failedEvent, credentials);
      assert.equal(replay.body.reason, 'EVENT_REPLAY');
      assert.equal(events.length, 0);
      assert.equal((await post(undefined, undefined, credentials)).body.counted, true);
    });
    await t.test('state failure withholds analytics while pages and API results remain available', async () => {
      reset();
      const credentials = await session();
      protection.classifyBrowser = () => {
        throw new Error('state unavailable');
      };
      const response = await post(undefined, undefined, credentials);
      assert.equal(response.body.reason, 'STATE_UNAVAILABLE');
      assert.equal(events.length, 0);
      protection.classifyApi = () => {
        throw new Error('state unavailable');
      };
      const api = await fetch(base + '/api/items?terms=trees');
      assert.equal(api.status, 200);
      assert.equal(api.headers.get('x-usage-counted'), 'false');
      assert.equal(searches.length, 0);
    });
    await t.test('expired session renews; old credentials stay unusable', async () => {
      reset({ sessionTtlMs: 1000 });
      const old = await session();
      now += 1000;
      const expired = await post(undefined, undefined, old);
      assert.equal(expired.status, 401);
      assert.equal(expired.body.counted, false);
      const fresh = await session();
      assert.equal((await post(undefined, undefined, fresh)).body.counted, true);
      assert.equal((await post(undefined, undefined, old)).body.counted, false);
      assert.equal(events.length, 1);
    });
    await t.test('local cookie is HttpOnly SameSite Strict; HTML embeds credentials without counting', async () => {
      reset();
      const credentials = await session();
      assert.match(credentials.rawCookie, /HttpOnly/);
      assert.match(credentials.rawCookie, /SameSite=Strict/);
      assert.match(credentials.rawCookie, /Path=\//);
      assert.doesNotMatch(credentials.rawCookie, /; Secure/);
      const page = await fetch(base + '/page', {
        headers: { Accept: 'text/html', Cookie: credentials.cookie, 'User-Agent': ua },
      });
      assert.equal((await page.json()).csrf, credentials.token);
      assert.equal(page.headers.get('cache-control'), 'private, no-store');
      assert.equal(events.length, 0);
    });
    await t.test('production cookie has Secure and host-only prefix', async () => {
      reset();
      const saved = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const credentials = await session();
        assert.match(credentials.rawCookie, /^__Host-splice_usage=/);
        assert.match(credentials.rawCookie, /; Secure/);
      } finally {
        if (saved === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = saved;
      }
    });
    await t.test('small parser rejects oversized, compressed, non-JSON and malformed requests', async () => {
      reset();
      for (const [body, headers, status] of [
        [JSON.stringify({ query: 'x'.repeat(5000) }), {}, 413],
        ['{', {}, 400],
        ['[]', {}, 401],
        ['query=x', { 'Content-Type': 'application/x-www-form-urlencoded' }, 415],
        ['{}', { 'Content-Encoding': 'gzip' }, 415],
      ]) {
        const response = await fetch(base + '/usage/web-search', {
          method: 'POST',
          headers: { Origin: base, 'Content-Type': 'application/json', ...headers },
          body,
        });
        // An array is syntactically valid JSON but has no valid search payload.
        assert.equal(response.status, body === '[]' ? 400 : status);
        assert.equal((await response.json()).counted, false);
      }
      assert.equal(events.length + searches.length, 0);
    });
    await t.test('spoofed XFF ignored unless peer proxy is explicitly trusted', async () => {
      app.set('trust proxy', false);
      const response = await fetch(base + '/ip', { headers: { 'X-Forwarded-For': '203.0.113.9' } });
      assert.equal((await response.json()).ip, '127.0.0.1');
      app.set('trust proxy', ['loopback']);
      const trusted = await fetch(base + '/ip', { headers: { 'X-Forwarded-For': '1.2.3.4, 203.0.113.9' } });
      assert.equal((await trusted.json()).ip, '203.0.113.9');
      app.set('trust proxy', false);
    });
    await t.test('API scripts count, bots do not, IP rate reviews; retrieval still succeeds', async () => {
      reset({ ipReview: 2 });
      for (const [userAgent, counted] of [
        ['curl/8', 'true'],
        ['python-requests/2', 'true'],
        ['Googlebot', 'false'],
        ['curl/8', 'false'],
      ]) {
        const response = await fetch(base + '/api/items?terms=trees', { headers: { 'User-Agent': userAgent } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-usage-counted'), counted);
      }
      assert.equal(searches.length, 2);
    });
    await t.test('normal traffic counts during known-bot attack', async () => {
      reset();
      const credentials = await session();
      await Promise.all(
        Array.from({ length: 50 }, () => post(undefined, undefined, undefined, { 'User-Agent': 'Bytespider' })),
      );
      assert.equal((await post(undefined, undefined, credentials)).body.counted, true);
      assert.equal(events.length, 1);
    });
    await t.test(
      'real MySQL row counts match the accepted writes',
      { skip: !mysql ? 'Docker/MySQL unavailable; set LIVE_USAGE_TEST_MYSQL=disposable and test port' : false },
      async () => {
        await mysql.clear();
        reset();
        const credentials = await session();
        await post(undefined, undefined, credentials);
        await post('/usage/external-click', { ...click, linkType: 'iframe_url' }, credentials);
        await post('/usage/web-search', { query: 'trees' }, credentials);
        await post(undefined, undefined, credentials, { 'User-Agent': 'Googlebot' });
        await post('/usage/web-search', { query: 'trees' }, credentials, { 'User-Agent': 'Googlebot' });
        assert.deepEqual(await mysql.counts(), { usage: 2, searches: 1 });
      },
    );
  } finally {
    await new Promise((done) => server.close(done));
    AppDataSource.getRepository = originalRepository;
    meilisearchService.search = originalSearch;
    await mysql?.close();
  }
});
