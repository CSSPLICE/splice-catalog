/** Local educational comparison. Owns its loopback HTTP server and a NEW MySQL
 * schema; never targets the running app or reads application DB_* credentials.
 * Requires LIVE_USAGE_TEST_MYSQL=disposable and a dedicated non-3306 test port. */
import 'reflect-metadata';
import { AsyncLocalStorage } from 'node:async_hooks';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import puppeteer from 'puppeteer';
import { AppDataSource } from '../../src/db/data-source.ts';
import { slc_item_catalog } from '../../src/db/entities/SLCItemCatalog.ts';
import { ProvisionalUsageEvent } from '../../src/db/entities/ProvisionalUsageEvent.ts';
import { LiveUsageBotProtection } from '../../src/services/LiveUsageBotProtection.ts';
import { ProvisionalUsageService } from '../../src/services/ProvisionalUsageService.ts';
import { browserUsageSession } from '../../src/middleware/liveUsageProtection.ts';
import { createUsageRouter } from '../../src/routes/usage.ts';
import { optionalMysql } from '../helpers/live-usage-mysql.mjs';

export function assertLoopback(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('Only an owned HTTP loopback fixture is permitted');
  return url.origin;
}
const executablePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(executablePath)) throw new Error('Set CHROME_BIN to run real Chrome simulations');
if (process.env.LIVE_USAGE_TEST_MYSQL !== 'disposable') throw new Error('Explicit disposable MySQL opt-in required');
const port = Number(process.env.LIVE_USAGE_SIMULATION_PORT || 0);
if (!Number.isInteger(port) || port < 0 || port > 65535 || [3000, 3001, 3306, 7700].includes(port))
  throw new Error('Choose a free fixture-only loopback port');
const mysql = await optionalMysql({ phase2: true });
const originalRepository = AppDataSource.getRepository,
  originalOrigin = process.env.LIVE_USAGE_ORIGIN;
AppDataSource.getRepository = (entity) => mysql.db.getRepository(entity);
const secret = 'local-phase2-simulation-key-at-least-32-bytes';
const ua =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const items = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  catalog_type: 'SLC_ITEM',
  persistentID: `urn:simulation:${i + 1}`,
  title: `Fixture ${i + 1}`,
  iframe_url: '/resource',
}));
await mysql.db
  .getRepository(slc_item_catalog)
  .createQueryBuilder()
  .insert()
  .values(items.map((item) => ({ ...item })))
  .callListeners(false)
  .execute();
let service,
  protection,
  records = [],
  offset = 0,
  inflight = 0;
let contexts = [],
  browser;
const requestLabels = new AsyncLocalStorage();
const now = () => Date.now() + offset;
function resetDetector() {
  protection = new LiveUsageBotProtection({ mode: 'enforce' }, now);
  const classify = protection.classifyBrowser.bind(protection);
  protection.classifyBrowser = (input) => {
    const decision = classify(input);
    // Ground truth comes from the scenario fixture, never from the detector.
    const eventKey =
      input.sessionId && typeof input.eventId === 'string'
        ? createHmac('sha256', secret).update(`event\0${input.sessionId}:${input.eventId}`).digest('hex')
        : null;
    records.push({ decision, eventKey, label: requestLabels.getStore() || 'bot', at: now() });
    return decision;
  };
  service = new ProvisionalUsageService(mysql.db, secret, protection.options, {}, now);
}
resetDetector();
const app = express();
app.use(
  '/usage',
  (req, res, next) => {
    // Count requests until the server actually finishes its analytics response.
    if (req.method === 'POST' && req.path !== '/session') {
      inflight++;
      res.on('finish', () => inflight--);
    }
    requestLabels.run(req.get('x-fixture-label') || 'bot', next);
  },
  (req, res, next) => createUsageRouter(protection, service)(req, res, next),
);
app.use((req, res, next) => browserUsageSession(protection)(req, res, next));
app.get('/js/usageTracking.js', (_req, res) => res.sendFile(resolve('src/public/js/usageTracking.js')));
app.get('/catalog', (_req, res) => {
  const session = res.locals.liveUsageSession;
  res.send(`<!doctype html><html><head><meta name="splice-usage-token" content="${session.csrf}" data-expires-at="${session.expiresAt}"><script src="/js/usageTracking.js" defer></script></head><body>
    ${items
      .map(
        (
          item,
        ) => `<a id="item-${item.id}" href="/catalog/item/${item.id}" target="_blank" data-usage-entry-click data-catalog-type="SLC_ITEM" data-item-identifier="${encodeURIComponent(item.persistentID)}">Item ${item.id}</a>
    <a id="external-${item.id}" href="/resource" target="_blank" data-usage-external-click data-catalog-type="SLC_ITEM" data-item-identifier="${encodeURIComponent(item.persistentID)}" data-link-type="iframe_url">Resource ${item.id}</a>`,
      )
      .join('<br>')}
    <form id="searchForm" action="/search-done" target="_blank"><input name="query" id="query"><button>Search</button></form></body></html>`);
});
app.get('/catalog/item/:id', (_req, res) => res.send('Fixture detail page'));
app.get('/resource', (_req, res) => res.send('Fixture external resource'));
app.get('/search-done', (_req, res) => res.send('Fixture search result'));
const server = await new Promise((done) => {
  const listener = app.listen(port, '127.0.0.1', () => done(listener));
});
const base = assertLoopback(`http://127.0.0.1:${server.address().port}`);
process.env.LIVE_USAGE_ORIGIN = base;
const results = [];
async function until(predicate) {
  for (let i = 0; i < 500; i++) {
    if (await predicate()) return;
    await delay(20);
  }
  assert.ok(await predicate(), 'fixture requests did not settle');
}
async function actor(label = 'bot') {
  // Browser contexts isolate cookie jars. All still use ONE real loopback IP;
  // this experiment does not claim to simulate independent network addresses.
  const context = await browser.createBrowserContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ 'x-fixture-label': label });
  await page.setRequestInterception(true);
  page.on('request', (request) => (request.url().startsWith(base + '/') ? request.continue() : request.abort()));
  await page.goto(base + '/catalog', { waitUntil: 'load' });
  await page.waitForFunction(() => window.spliceUsageTrackingInitialized === true);
  assert.ok(
    await page.$('#item-1'),
    `Expected fixture catalog links; received ${await page.$$eval('a', (links) =>
      links
        .slice(0, 4)
        .map((link) => link.id)
        .join(','),
    )}`,
  );
  return page;
}
async function click(page, id, external = false) {
  // CDP mouse input creates a real trusted browser activation. Analytics travels
  // through the unchanged tracking script/HTTP controller, not a fake DOM event.
  await page.bringToFront();
  await page.click(`#${external ? 'external' : 'item'}-${id}`);
}
async function search(page, query) {
  await page.bringToFront();
  await page.focus('#query');
  await page.keyboard.down('Meta');
  await page.keyboard.press('A');
  await page.keyboard.up('Meta');
  await page.type('#query', query);
  await page.keyboard.press('Enter');
}
async function scenario(name, expected, traffic, restart = false) {
  for (const context of contexts) await context.close();
  contexts = [];
  await mysql.clear();
  records = [];
  offset = 0;
  resetDetector();
  const began = Date.now();
  await traffic();
  await until(() => inflight === 0 && records.length >= expected);
  assert.equal(records.length, expected);
  const pendingBefore = (await service.store.summary()).pending;
  const immediateCounted = records.filter((row) => row.decision.decision === 'ACCEPT').length;
  const immediateReasons = {};
  for (const row of records) immediateReasons[row.decision.reason] = (immediateReasons[row.decision.reason] || 0) + 1;
  // Real 3–5-second clicks above are NOT accelerated. Only finalization clock is
  // advanced, explicitly, after traffic to avoid waiting another 120 seconds.
  offset += service.options.reviewWindowMs + 1;
  if (restart) {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--loader', 'ts-node/esm', 'tests/local-bot-simulations/worker-once.mjs'],
      {
        env: {
          ...process.env,
          LIVE_USAGE_PROVISIONAL_ENABLED: 'false',
          PHASE2_TEST_SCHEMA: mysql.schema,
          PHASE2_TEST_STATE_SECRET: secret,
          PHASE2_TEST_NOW: String(now()),
          PHASE2_TEST_OPTIONS: '{}',
        },
        timeout: 15000,
      },
    );
    assert.ok(JSON.parse(stdout.trim()).finalized > 0);
  } else await service.tick();
  const rows = await mysql.db.getRepository(ProvisionalUsageEvent).find();
  const byKey = new Map(rows.map((row) => [row.eventKey, row]));
  const accepted = (record) => byKey.get(record.eventKey)?.status === 'ACCEPTED';
  const humans = records.filter((row) => row.label === 'legitimate'),
    bots = records.filter((row) => row.label === 'bot');
  const falsePositives = humans.filter((row) => !accepted(row)).length;
  const falseNegatives = bots.filter(accepted).length;
  const counts = await mysql.counts(),
    summary = await service.store.summary();
  assert.equal(summary.pending, 0);
  assert.equal(counts.usage + counts.searches, rows.filter((row) => row.status === 'ACCEPTED').length);
  const [storage] = await mysql.db.query(
    'SELECT DATA_LENGTH + INDEX_LENGTH AS bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    ['provisional_usage_events'],
  );
  const result = {
    scenario: name,
    requests: records.length,
    immediateCounted,
    newCounted: counts.usage + counts.searches,
    legitimateEvents: humans.length,
    legitimateFalsePositives: falsePositives,
    automatedEvents: bots.length,
    automatedWithheld: bots.length - falseNegatives,
    automatedCounted: falseNegatives,
    pendingBefore,
    pendingAfter: summary.pending,
    reasons: summary.classifications,
    immediateReasons,
    trafficWallMs: Date.now() - began,
    configuredReviewWindowMs: service.options.reviewWindowMs,
    finalizationClockAdvanced: true,
    provisionalRows: rows.length,
    terminalPayloadsRetained: rows.filter((row) => row.payload !== null).length,
    approximateTableBytes: Number(storage.bytes),
  };
  assert.equal(result.terminalPayloadsRetained, 0);
  results.push(result);
  console.log(JSON.stringify(result));
  return result;
}
try {
  browser = await puppeteer.launch({ executablePath, headless: true, args: [`--user-agent=${ua}`] });
  const obvious = await scenario('1000 known-bot HTTP requests', 1000, async () => {
    // Bounded concurrency: 20 workers each await 50 JSON HTTP POSTs, for 1,000.
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        for (let i = 0; i < 50; i++) {
          const response = await fetch(base + '/usage/entry-click', {
            method: 'POST',
            headers: { Origin: base, 'Content-Type': 'application/json', 'User-Agent': 'Googlebot/2.1' },
            body: JSON.stringify({
              catalogType: 'SLC_ITEM',
              itemIdentifier: items[0].persistentID,
              eventId: randomBytes(16).toString('hex'),
            }),
          });
          assert.equal((await response.json()).counted, false);
        }
      }),
    );
  });
  assert.equal(obvious.newCounted, 0);
  const direct = await scenario('fake Chrome POST without credentials', 1, async () => {
    await fetch(base + '/usage/entry-click', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json', 'User-Agent': ua },
      body: JSON.stringify({
        catalogType: 'SLC_ITEM',
        itemIdentifier: items[0].persistentID,
        eventId: randomBytes(16).toString('hex'),
      }),
    });
  });
  assert.equal(direct.newCounted, 0);
  const rapid = await scenario('20 rapid real Chrome clicks', 20, async () => {
    const page = await actor();
    for (let i = 1; i <= 20; i++) await click(page, i);
  });
  assert.equal(rapid.newCounted, 0);
  const slow = await scenario('20 slow real Chrome clicks, 3–5 seconds apart', 20, async () => {
    const page = await actor();
    for (let i = 1; i <= 20; i++) {
      if (i > 1) await delay([3000, 4000, 5000][i % 3]);
      await click(page, i);
    }
  });
  assert.equal(slow.newCounted, 20); // Honest false negatives; no human-attestation claim.
  const independent = await scenario('20 isolated browser contexts, one click each, one IP', 20, async () => {
    for (let i = 1; i <= 20; i++) await click(await actor(), i);
  });
  assert.equal(independent.newCounted, 20);
  const coexist = await scenario('normal browsing interleaved with rapid automation', 24, async () => {
    const bot = await actor(),
      human = await actor('legitimate');
    for (let i = 1; i <= 20; i++) {
      await click(bot, i);
      if (i === 4) await click(human, 2);
      if (i === 8) await click(human, 2, true);
      if (i === 12) await search(human, 'binary trees');
      if (i === 16) await click(human, 6);
    }
  });
  assert.equal(coexist.newCounted, 4);
  assert.equal(coexist.legitimateFalsePositives, 0);
  const students = await scenario('8 students sharing an IP, 6 varied rapid interactions each', 48, async () => {
    for (let student = 0; student < 8; student++) {
      const page = await actor('legitimate');
      for (let step = 0; step < 6; step++) {
        const id = ((student * 3 + step * 5) % 30) + 1;
        if (step === 4) await search(page, `exercise ${student}`);
        else await click(page, id, step === 2);
        await delay(120 + step * 25);
      }
    }
  });
  assert.equal(students.newCounted, 48);
  assert.equal(students.legitimateFalsePositives, 0);
  const restarted = await scenario(
    'fresh finalizer process while 3 legitimate events are pending',
    3,
    async () => {
      const page = await actor('legitimate');
      await click(page, 1);
      await click(page, 1, true);
      await search(page, 'restart recovery');
    },
    true,
  );
  assert.equal(restarted.newCounted, 3);
  // Independent cookie jars, identical UA/IP; only this fixture suppresses
  // link navigation to keep measured per-step server timing tightly aligned.
  async function professors(label, sameSequence) {
    const pages = [];
    for (let i = 0; i < 5; i++) {
      const page = await actor(label);
      await page.evaluate(() => document.addEventListener('click', (event) => event.preventDefault()));
      pages.push(page);
    }
    for (let step = 0; step < 5; step++) {
      for (let i = 0; i < 5; i++) await click(pages[i], sameSequence ? step + 1 : ((i * 5 + step) % 30) + 1);
      await delay(500);
    }
  }
  const different = await scenario('5 professors, independent contexts, different navigation sequences', 25, () =>
    professors('legitimate', false),
  );
  assert.equal(different.newCounted, 25);
  assert.equal(different.legitimateFalsePositives, 0);
  for (const label of ['legitimate', 'bot']) {
    const synchronized = await scenario(`5 synchronized contexts labeled ${label}, same sequence`, 25, () =>
      professors(label, true),
    );
    assert.equal(synchronized.newCounted, 25);
    assert.equal(synchronized.reasons['ACCEPTED:COORDINATION_OBSERVED'], 25);
  }
  const interference = await scenario(
    '601 invalid requests then five credentialed professors on the same IP',
    606,
    async () => {
      for (let i = 0; i < 601; i++)
        await fetch(base + '/usage/entry-click', {
          method: 'POST',
          headers: { Origin: base, 'Content-Type': 'application/json', 'User-Agent': ua },
          body: JSON.stringify({
            catalogType: 'SLC_ITEM',
            itemIdentifier: items[0].persistentID,
            eventId: randomBytes(16).toString('hex'),
          }),
        });
      for (let i = 0; i < 5; i++) await click(await actor('legitimate'), i + 1);
    },
  );
  assert.equal(interference.newCounted, 5);
  assert.equal(interference.legitimateFalsePositives, 0);
  const total = results.reduce(
    (sum, row) => ({
      automated: sum.automated + row.automatedEvents,
      truePositives: sum.truePositives + row.automatedWithheld,
      falsePositives: sum.falsePositives + row.legitimateFalsePositives,
      humans: sum.humans + row.legitimateEvents,
    }),
    { automated: 0, truePositives: 0, falsePositives: 0, humans: 0 },
  );
  const report = {
    results,
    fixtureMetrics: {
      ...total,
      withholdingPrecision: total.truePositives / (total.truePositives + total.falsePositives),
      automationRecall: total.truePositives / total.automated,
    },
    notes: [
      'Known bots dominate aggregate recall. Inspect browser-only cohorts separately; controlled labels do not establish production precision/recall.',
      'The 20 independent contexts share one real IP. Low-volume distributed automation is not solved.',
      'Only finalizer clock was advanced; slow click intervals used real wall-clock delays.',
      'Identical synchronized educator and automated fixtures are accepted with COORDINATION_OBSERVED; no browser-human certainty is claimed.',
    ],
  };
  const output = process.env.LIVE_USAGE_SIMULATION_OUTPUT || '/tmp/splice-phase21-comparison.json';
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Comparison saved: ${output}`);
} finally {
  await browser?.close();
  for (const stream of browser?.process()?.stdio || []) stream?.destroy();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  AppDataSource.getRepository = originalRepository;
  if (originalOrigin === undefined) delete process.env.LIVE_USAGE_ORIGIN;
  else process.env.LIVE_USAGE_ORIGIN = originalOrigin;
  await mysql.close();
}
