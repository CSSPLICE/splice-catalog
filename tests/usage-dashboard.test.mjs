import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import puppeteer from 'puppeteer';
import { AppDataSource } from '../src/db/data-source.ts';
import { HistoricalUsage } from '../src/db/entities/HistoricalUsage.ts';
import { UsageStatisticsService } from '../src/services/UsageStatisticsService.ts';
import { SearchStatisticsService } from '../src/services/SearchStatisticsService.ts';
import dashboardRoutes from '../src/routes/usageDashboard.ts';

// Fixtures are confined to tests. The production page always uses the existing reporting services.
const items = Array.from({ length: 16 }, (_, index) => ({
  catalogType: ['SLC_ITEM', 'TOOL', 'DATASET'][index % 3],
  catalogPath: `/catalog/item/${index + 1}`,
  itemPersistentID: `fixture:${index + 1}`,
  itemTitle: `Catalog exercise ${String(index + 1).padStart(2, '0')}`,
  entryClicks: 32 - index,
  externalClicks: index + 1,
  legacyItemViews: 3,
  historicalPageRequests: 10,
  lifecycleStatus: 'RENAMED',
}));
const terms = Array.from({ length: 15 }, (_, index) => ({
  query: index === 0 ? '=SUM(1,2)' : index === 1 ? '<script>alert("fixture")</script>' : `Search topic ${index}`,
  webSearches: 30 - index,
  publicApiSearches: 15 - index,
  totalSearches: 45 - index * 2,
}));
const legacyOnly = { ...items[0], itemTitle: 'Legacy-only entry must stay out', entryClicks: 0, externalClicks: 0 };

function csvBlocks(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if (char === '\n' && !quoted) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r' || quoted) field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  assert.equal(quoted, false);
  const blocks = new Map();
  let title = null;
  for (const cells of rows) {
    if (cells.length === 1 && cells[0] === '') {
      title = null;
      continue;
    }
    if (title === null) {
      title = cells[0];
      blocks.set(title, []);
    } else blocks.get(title).push(cells);
  }
  return blocks;
}
function csvValue(value) {
  const text = String(value ?? '');
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + text : text;
}

function stub(owner, name, replacement, originals) {
  originals.push([owner, name, owner[name]]);
  owner[name] = replacement;
}

test('historical status distinguishes an absent import using aggregate rows only', async () => {
  const original = AppDataSource.getRepository;
  const clauses = [];
  let result = { rowCount: '0', totalRequests: '0' };
  const builder = {
    select() {
      return this;
    },
    addSelect() {
      return this;
    },
    where(sql, parameters) {
      clauses.push([sql, parameters]);
      return this;
    },
    andWhere(sql, parameters) {
      clauses.push([sql, parameters]);
      return this;
    },
    async getRawOne() {
      return result;
    },
  };
  try {
    AppDataSource.getRepository = (entity) => {
      assert.equal(entity, HistoricalUsage);
      return { createQueryBuilder: () => builder };
    };
    const service = new UsageStatisticsService();
    assert.deepEqual(await service.getHistoricalUsageSummary(), { rowCount: 0, totalRequests: 0 });
    result = { rowCount: '4', totalRequests: '1234' };
    assert.deepEqual(await service.getHistoricalUsageSummary(), { rowCount: 4, totalRequests: 1234 });
    assert.ok(clauses.some(([, parameters]) => parameters.source === 'nginx_historical'));
    assert.ok(clauses.some(([, parameters]) => parameters.catalogType === 'SLC_ITEM'));
    assert.equal(AppDataSource.isInitialized, false);
  } finally {
    AppDataSource.getRepository = original;
  }
});

test('dashboard rendering, unified exports, filters and responsive interactions', { timeout: 120000 }, async (t) => {
  const originals = [],
    calls = [],
    analyticsHits = [];
  let empty = false;
  let apiOnly = false;
  const usage = UsageStatisticsService.prototype,
    search = SearchStatisticsService.prototype;
  const totals = {
    totalEntryClicks: items.reduce((sum, item) => sum + item.entryClicks, 0),
    totalExternalClicks: items.reduce((sum, item) => sum + item.externalClicks, 0),
    legacyItemViews: 777,
    historicalPageRequests: 1234,
  };
  stub(
    usage,
    'getOverallStatistics',
    async (range, catalog) => {
      calls.push({ range, catalog });
      return empty ? Object.fromEntries(Object.keys(totals).map((key) => [key, 0])) : totals;
    },
    originals,
  );
  stub(
    usage,
    'getHistoricalUsageSummary',
    async () => (empty ? { rowCount: 0, totalRequests: 0 } : { rowCount: 4, totalRequests: 1234 }),
    originals,
  );
  stub(usage, 'getPerItemStatistics', async () => structuredClone(empty ? [] : [...items, legacyOnly]), originals);
  stub(usage, 'getUniqueCatalogEntryCount', async () => (empty ? 0 : items.length), originals);
  stub(
    usage,
    'getDailyActivity',
    async () =>
      empty || apiOnly
        ? []
        : [
            { date: '2026-10-01', entryClicks: 140, externalClicks: 44, legacyItemViews: 8 },
            { date: '2026-10-03', entryClicks: 120, externalClicks: 50, legacyItemViews: 0 },
            { date: '2026-10-04', entryClicks: 132, externalClicks: 42, legacyItemViews: 0 },
          ],
    originals,
  );
  stub(
    usage,
    'getCatalogTypeEntryActivity',
    async () =>
      ['SLC_ITEM', 'TOOL', 'DATASET'].map((catalogType) => ({
        catalogType,
        count: empty
          ? 0
          : items.filter((item) => item.catalogType === catalogType).reduce((sum, item) => sum + item.entryClicks, 0),
      })),
    originals,
  );
  stub(usage, 'addLifecycleStatuses', async (rows) => rows, originals);
  stub(
    usage,
    'getUsageEvents',
    async () => (empty ? [] : [{ eventType: 'ITEM_VIEW', itemPersistentID: 'legacy:1' }]),
    originals,
  );
  stub(
    search,
    'getSummary',
    async () => ({
      webSearches: empty ? 0 : terms.reduce((sum, term) => sum + term.webSearches, 0),
      publicApiSearches: empty ? 0 : terms.reduce((sum, term) => sum + term.publicApiSearches, 0),
    }),
    originals,
  );
  stub(search, 'getFrequentTerms', async () => structuredClone(empty ? [] : terms), originals);
  stub(
    search,
    'getDailyPublicApiSearches',
    async (range, catalog) => {
      calls.push({ dailyApiRange: range, dailyApiCatalog: catalog });
      return empty
        ? []
        : [
            { date: '2026-10-02', publicApiSearches: 20 },
            { date: '2026-10-03', publicApiSearches: 70 },
            { date: '2026-10-04', publicApiSearches: 30 },
          ];
    },
    originals,
  );
  stub(search, 'getEvents', async () => [], originals);
  const app = express();
  app.set('views', resolve('src/views'));
  app.set('view engine', 'ejs');
  app.use(express.json());
  app.use((req, res, next) => {
    const role = req.get('x-fixture-role') || 'admin';
    req.oidc = {
      isAuthenticated: () => role !== 'anonymous',
      user: { 'https://roles': role === 'admin' ? ['admin'] : [] },
    };
    Object.assign(res.locals, {
      user:
        role === 'anonymous' ? null : { nickname: 'Fixture User', 'https://roles': role === 'admin' ? ['admin'] : [] },
      isAdmin: role === 'admin',
      showLoginButton: role === 'anonymous',
    });
    next();
  });
  // Render the real public templates without connecting to a database.
  app.get('/', (req, res) =>
    res.render('pages/index', { title: 'Home', toolCatalogCount: 0, slcItemCount: 0, datasetCount: 0 }),
  );
  app.get('/catalog', (req, res) =>
    res.render('pages/search', { title: 'Catalog', results: [], query: '', filterSections: [], selectedFilters: {} }),
  );
  app.get('/about', (req, res) => res.render('pages/about', { title: 'About' }));
  app.get('/instructions', (req, res) => res.render('pages/instructions', { title: 'Instructions' }));
  app.get('/search/results', (req, res) => res.json({ results: [] }));
  app.get('/search', (req, res) => res.send('Search destination'));
  app.use('/admin', dashboardRoutes);
  app.use(express.static(resolve('src/public')));
  const headerSearches = [];
  app.post('/usage/:event', (req, res) => {
    if (req.params.event === 'web-search') headerSearches.push(req.body);
    analyticsHits.push(req.params.event);
    res.status(201).end();
  });
  const server = await new Promise((done) => {
    const listener = app.listen(0, '127.0.0.1', () => done(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const endpoint = `${base}/admin/usage-statistics`;
  let browser;
  try {
    await t.test('live rows and all three real daily series render with connecting lines', async () => {
      const html = await (await fetch(endpoint)).text();
      assert.equal((html.match(/class="usage-kpi"/g) || []).length, 5);
      assert.ok(!html.includes('Legacy-only entry must stay out'));
      assert.ok(!html.includes('ITEM_VIEW'));
      assert.ok(!html.includes('lifecycle-badge'));
      assert.ok(!html.includes('Design preview'));
      assert.ok(html.includes('1,234'));
      assert.ok(html.includes('href="/admin"'));
      assert.match(
        await readFile('src/public/css/usage-statistics.css', 'utf8'),
        /-apple-system, BlinkMacSystemFont, ['"]Segoe UI['"], Roboto, Helvetica, Arial, sans-serif/,
      );
      const path = html.match(/usage-series--entry" d="([^"]+)"/)[1];
      assert.equal((path.match(/M/g) || []).length, 1);
      assert.equal((path.match(/L/g) || []).length, 3);
      assert.equal((html.match(/class="usage-point usage-point--entry"/g) || []).length, 4);
      assert.equal((html.match(/class="usage-series usage-series--/g) || []).length, 3);
      assert.equal((html.match(/class="usage-point usage-point--api"/g) || []).length, 4);
    });
    await t.test('JSON and CSV export the same full dashboard, independent of tab or table search', async () => {
      const params = '?from=2026-10-01&to=2026-10-04&catalogType=TOOL';
      const response = await fetch(`${endpoint}/export${params}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-disposition'), /attachment/);
      const data = await response.json();
      assert.deepEqual(Object.keys(data), [
        'generatedAt',
        'filters',
        'summary',
        'activityOverTime',
        'entryClicksByCatalogType',
        'catalogEntryStatistics',
        'frequentSearchTerms',
        'historicalNginx',
      ]);
      assert.equal(data.catalogEntryStatistics.length, 16);
      assert.equal(data.frequentSearchTerms.length, 15);
      assert.equal(data.filters.catalogType, 'TOOL');
      assert.equal(data.filters.from, '2026-10-01');
      assert.equal(data.filters.to, '2026-10-04');
      assert.equal(calls.findLast((call) => call.dailyApiCatalog)?.dailyApiCatalog, 'TOOL');
      assert.equal(
        data.activityOverTime.reduce((sum, row) => sum + row.publicApiSearches, 0),
        data.summary.publicApiSearches,
      );
      assert.equal(
        data.activityOverTime.reduce((sum, row) => sum + row.entryClicks, 0),
        data.summary.totalEntryClicks,
      );
      assert.equal(
        data.activityOverTime.reduce((sum, row) => sum + row.externalClicks, 0),
        data.summary.totalExternalClicks,
      );
      for (const tab of ['entries', 'terms']) {
        const other = await (
          await fetch(`${endpoint}/export${params}&tab=${tab}&dataset=${tab}&q=unmatched&sort=externalClicks`)
        ).json();
        delete other.generatedAt;
        const expected = { ...data };
        delete expected.generatedAt;
        assert.deepEqual(other, expected);
      }
      const csv = await (await fetch(`${endpoint}/export.csv${params}`)).text();
      const blocks = csvBlocks(csv);
      assert.deepEqual(
        [...blocks.keys()],
        [
          'Summary',
          'Activity Over Time',
          'Entry Clicks by Catalog Type',
          'Catalog Entry Statistics',
          'Frequent Search Terms',
          'Historical Nginx Page Requests',
        ],
      );
      const summary = new Map(blocks.get('Summary'));
      for (const [key, value] of Object.entries(data.summary)) assert.equal(summary.get(key), String(value));
      assert.equal(summary.get('filters.catalogType'), data.filters.catalogType);
      assert.equal(summary.get('filters.from'), data.filters.from);
      const sameRows = (title, expected) => {
        const [headers, ...rows] = blocks.get(title);
        assert.deepEqual(
          rows,
          expected.map((row) => headers.map((header) => csvValue(row[header]))),
        );
      };
      sameRows('Activity Over Time', data.activityOverTime);
      sameRows('Entry Clicks by Catalog Type', data.entryClicksByCatalogType);
      sameRows('Catalog Entry Statistics', data.catalogEntryStatistics);
      sameRows('Frequent Search Terms', data.frequentSearchTerms);
      sameRows('Historical Nginx Page Requests', [data.historicalNginx]);
      assert.ok(csv.includes('"\'=SUM(1,2)"'));
      assert.ok(csv.includes('""fixture""'));
      for (const text of [JSON.stringify(data), csv])
        assert.doesNotMatch(text, /ITEM_VIEW|legacyItemViews|historicalPageRequests|lifecycleStatus/);
      assert.equal((await fetch(`${endpoint}/export.csv?from=2026-10-04&to=2026-10-01`)).status, 400);
      for (const path of ['', '/export', '/export.csv']) {
        assert.equal((await fetch(endpoint + path, { headers: { 'x-fixture-role': 'anonymous' } })).status, 401);
        assert.equal((await fetch(endpoint + path, { headers: { 'x-fixture-role': 'contributor' } })).status, 403);
      }
    });
    await t.test('date presets use inclusive calendar days and custom ranges remain valid', async () => {
      const html = await (await fetch(`${endpoint}?period=7d`)).text();
      const from = html.match(/id="usageFrom" value="([^"]*)"/)[1],
        to = html.match(/id="usageTo" value="([^"]*)"/)[1];
      assert.equal((Date.parse(to) - Date.parse(from)) / 86400000, 6);
      assert.ok(calls.findLast((call) => 'range' in call).range.from instanceof Date);
      const custom = await (
        await fetch(`${endpoint}?period=custom&from=2026-09-01&to=2026-10-01&catalogType=DATASET`)
      ).text();
      assert.ok(custom.includes('value="2026-09-01"'));
      assert.ok(custom.includes('Across datasets'));
      assert.equal(calls.findLast((call) => 'catalog' in call).catalog, 'DATASET');
      const all = await (await fetch(`${endpoint}?period=all&from=2026-10-01&to=2026-10-02`)).text();
      assert.ok(all.includes('id="usageFrom" value=""'));
      assert.equal(calls.findLast((call) => 'range' in call).range, undefined);
      const frozen = await (await fetch(`${endpoint}/export?period=7d&from=2026-01-01&to=2026-01-07`)).json();
      assert.equal(frozen.filters.period, '7d');
      assert.equal(frozen.filters.from, '2026-01-01');
      assert.equal(frozen.filters.to, '2026-01-07');
    });
    const executablePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (existsSync(executablePath)) {
      browser = await puppeteer.launch({ executablePath, headless: true });
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setRequestInterception(true);
      const bootstrapPath = resolve('node_modules/.cache/usage-dashboard/bootstrap.min.css');
      const bootstrapBundlePath = resolve('node_modules/.cache/usage-dashboard/bootstrap.bundle.min.js');
      page.on('request', async (request) => {
        if (request.url().startsWith(base)) return request.continue();
        if (request.url().includes('/bootstrap@5.1.3/dist/css/bootstrap.min.css') && existsSync(bootstrapPath)) {
          return request.respond({
            status: 200,
            contentType: 'text/css',
            headers: { 'access-control-allow-origin': '*' },
            body: await readFile(bootstrapPath),
          });
        }
        if (request.url().includes('/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js')) {
          if (!existsSync(bootstrapBundlePath)) return request.continue();
          return request.respond({
            status: 200,
            contentType: 'application/javascript',
            body: await readFile(bootstrapBundlePath),
          });
        }
        return request.abort();
      });
      const open = async () => {
        await page.goto(endpoint, { waitUntil: 'networkidle0' });
        await page.waitForSelector('[data-usage-dashboard][data-initialized=true]');
      };
      await t.test('desktop has five aligned cards, 64/36 charts and six live rows', async () => {
        await page.setViewport({ width: 1500, height: 1100 });
        await open();
        const geometry = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('.usage-kpi')].map((card) => card.getBoundingClientRect());
          const charts = [...document.querySelectorAll('.usage-charts > article')].map((chart) =>
            chart.getBoundingClientRect(),
          );
          return {
            tops: cards.map((card) => card.top),
            ratio: charts[0].width / (charts[0].width + charts[1].width),
            overflow: document.documentElement.scrollWidth > innerWidth,
            visibleRows: [...document.querySelectorAll('#usage-panel-entries [data-table-row]')].filter(
              (row) => !row.hidden,
            ).length,
          };
        });
        assert.equal(new Set(geometry.tops).size, 1);
        assert.ok(Math.abs(geometry.ratio - 0.64) < 0.01);
        assert.equal(geometry.overflow, false);
        assert.equal(geometry.visibleRows, 6);
        assert.ok(await page.$eval('.usage-pagination button', (node) => node.getBoundingClientRect().height >= 36));
        const series = await page.$$eval('.usage-series', (nodes) =>
          nodes.map((node) => ({
            path: node.getAttribute('d'),
            fill: getComputedStyle(node).fill,
            width: Number.parseFloat(getComputedStyle(node).strokeWidth),
            stroke: getComputedStyle(node).stroke,
          })),
        );
        assert.equal(series.length, 3);
        assert.ok(series.every((row) => row.path.includes('L') && row.fill === 'none' && row.width >= 2.5));
        assert.deepEqual(
          series.map((row) => row.stroke),
          ['rgb(57, 125, 171)', 'rgb(191, 119, 50)', 'rgb(92, 140, 105)'],
        );
        assert.equal(await page.$$eval('.usage-point--api', (nodes) => nodes.length), 4);
        assert.equal(await page.$eval('.usage-page', (node) => getComputedStyle(node).maxWidth), '1440px');
        assert.equal(await page.$eval('body', (node) => getComputedStyle(node).backgroundColor), 'rgb(245, 247, 249)');
        assert.ok(await page.$eval('.usage-page', (node) => getComputedStyle(node).fontFamily.includes('Roboto')));
        assert.equal(await page.$eval('#searchTermSearch', (node) => node.type), 'search');
        assert.equal(await page.$$eval('#usage-panel-terms input', (nodes) => nodes.length), 1);
        assert.equal(await page.$eval('[data-tab-count="entries"]', (node) => node.textContent), '16');
        assert.match(
          await page.$eval('#usage-panel-entries [data-table-summary]', (node) => node.textContent),
          /Showing 1–6 of 16/,
        );
        if (process.env.USAGE_SCREENSHOTS === '1') {
          await mkdir(resolve('node_modules/.cache/usage-dashboard'), { recursive: true });
          await page.screenshot({ path: resolve('node_modules/.cache/usage-dashboard/desktop.png'), fullPage: true });
        }
      });
      await t.test('search, fixed ordering, paging and independent tab state work together', async () => {
        const entries = '#usage-panel-entries',
          searchTerms = '#usage-panel-terms';
        await page.click(`${entries} [aria-label="Next page"]`);
        assert.match(await page.$eval(`${entries} [data-table-summary]`, (node) => node.textContent), /7–12 of 16/);
        await page.click('[data-tab="terms"]');
        await page.click(`${searchTerms} [aria-label="Next page"]`);
        await page.click('[data-tab="entries"]');
        assert.match(await page.$eval(`${entries} [data-table-summary]`, (node) => node.textContent), /7–12 of 16/);
        await page.type('#catalogEntrySearch', 'exercise 1');
        assert.equal(await page.$eval('[data-tab-count="entries"]', (node) => node.textContent), '7');
        assert.equal(
          await page.$('.usage-table th button, [data-sort], [data-sort-icon], .usage-table [aria-sort]'),
          null,
        );
        const visibleTitles = () =>
          page.$$eval('#usage-panel-entries [data-table-row]:not([hidden]) .usage-item-link', (nodes) =>
            nodes.map((node) => node.textContent),
          );
        const beforeClick = await visibleTitles();
        for (const heading of await page.$$('.usage-table th')) {
          if (await heading.isVisible()) {
            assert.notEqual(await heading.evaluate((node) => getComputedStyle(node).cursor), 'pointer');
            assert.equal(await heading.evaluate((node) => getComputedStyle(node).fontWeight), '600');
            await heading.click();
          }
        }
        assert.deepEqual(await visibleTitles(), beforeClick);
        const exportHref = await page.$eval(`${entries} [data-export-link]`, (node) => node.href);
        const exported = await (await fetch(exportHref)).json();
        assert.equal(exported.catalogEntryStatistics.length, 16);
        assert.equal(exported.frequentSearchTerms.length, 15);
        assert.equal(new URL(exportHref).searchParams.has('q'), false);
        await page.click('[data-tab="terms"]');
        assert.match(await page.$eval(`${searchTerms} [data-table-summary]`, (node) => node.textContent), /7–12 of 15/);
        await page.type('#searchTermSearch', 'unmatched');
        assert.match(await page.$eval(`${searchTerms} [data-table-summary]`, (node) => node.textContent), /0–0 of 0/);
        assert.equal(await page.$eval(`${searchTerms} [data-table-empty]`, (node) => node.hidden), false);
        await page.click('[data-tab="entries"]');
        assert.equal(await page.$eval('#catalogEntrySearch', (node) => node.value), 'exercise 1');
        await page.focus('[data-tab="entries"]');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.$eval('[data-tab="terms"]', (node) => node.getAttribute('aria-selected')), 'true');
      });
      await t.test('fixed ordering resolves count ties and survives search, paging and old sort URLs', async () => {
        const previousItems = usage.getPerItemStatistics;
        const previousTerms = search.getFrequentTerms;
        usage.getPerItemStatistics = async () => [
          { ...items[0], itemTitle: 'Beta', entryClicks: 10, externalClicks: 2 },
          { ...items[1], itemTitle: 'Alpha', entryClicks: 10, externalClicks: 2 },
          { ...items[2], itemTitle: 'Zulu', entryClicks: 10, externalClicks: 3 },
          ...['Delta', 'Charlie', 'Foxtrot', 'Echo', 'Golf'].map((itemTitle) => ({
            ...items[3],
            itemTitle,
            entryClicks: 9,
            externalClicks: 50,
          })),
        ].map((item) => ({ ...item, catalogPath: '/entry/fixed' }));
        search.getFrequentTerms = async () => [
          { query: 'zebra', webSearches: 10, publicApiSearches: 0, totalSearches: 10 },
          { query: 'beta', webSearches: 9, publicApiSearches: 1, totalSearches: 10 },
          { query: 'alpha', webSearches: 0, publicApiSearches: 10, totalSearches: 10 },
          { query: 'top', webSearches: 1, publicApiSearches: 10, totalSearches: 11 },
        ];
        const entries = () =>
          page.$$eval('#usage-panel-entries [data-table-row]:not([hidden]) .usage-item-link', (nodes) =>
            nodes.map((node) => node.textContent),
          );
        const termNames = () =>
          page.$$eval('#usage-panel-terms [data-table-row]:not([hidden]) td:first-child', (nodes) =>
            nodes.map((node) => node.textContent),
          );
        try {
          await page.goto(endpoint + '?sort=externalClicks&direction=asc', { waitUntil: 'networkidle0' });
          assert.equal(await page.$('[name="sort"], [name="direction"]'), null);
          assert.deepEqual(await entries(), ['Zulu', 'Alpha', 'Beta', 'Charlie', 'Delta', 'Echo']);
          await page.click('#usage-panel-entries [aria-label="Next page"]');
          assert.deepEqual(await entries(), ['Foxtrot', 'Golf']);
          await page.type('#catalogEntrySearch', 'a');
          assert.deepEqual(await entries(), ['Alpha', 'Beta', 'Charlie', 'Delta']);
          await page.$eval('#catalogEntrySearch', (input) => {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          assert.deepEqual(await entries(), ['Zulu', 'Alpha', 'Beta', 'Charlie', 'Delta', 'Echo']);
          await page.click('[data-tab="terms"]');
          assert.deepEqual(await termNames(), ['top', 'alpha', 'beta', 'zebra']);
          await page.type('#searchTermSearch', 'a');
          assert.deepEqual(await termNames(), ['alpha', 'beta', 'zebra']);
          for (const heading of await page.$$('#usage-panel-terms th')) await heading.click();
          assert.deepEqual(await termNames(), ['alpha', 'beta', 'zebra']);
        } finally {
          usage.getPerItemStatistics = previousItems;
          search.getFrequentTerms = previousTerms;
        }
      });
      await t.test('presets, manual dates and catalog choices persist on apply and exports', async () => {
        await open();
        await page.select('#usagePeriod', '30d');
        const dates = await page.evaluate(() => [
          document.querySelector('#usageFrom').value,
          document.querySelector('#usageTo').value,
        ]);
        assert.equal((Date.parse(dates[1]) - Date.parse(dates[0])) / 86400000, 29);
        await page.$eval('#usageFrom', (input) => {
          input.value = '2026-09-01';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.equal(await page.$eval('#usagePeriod', (input) => input.value), 'custom');
        await page.select('#usageCatalogType', 'TOOL');
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.usage-primary-button')]);
        assert.equal(await page.$eval('#usageFrom', (input) => input.value), '2026-09-01');
        assert.equal(await page.$eval('#usageCatalogType', (input) => input.value), 'TOOL');
        const url = new URL(await page.$eval('#usage-panel-entries [data-export-link]', (node) => node.href));
        assert.equal(url.searchParams.get('from'), '2026-09-01');
        assert.equal(url.searchParams.get('catalogType'), 'TOOL');
        await page.reload({ waitUntil: 'networkidle0' });
        assert.equal(await page.$eval('#usagePeriod', (input) => input.value), 'custom');
      });
      await t.test('historical panel is collapsed, independent and expandable', async () => {
        assert.equal(await page.$eval('.usage-historical', (node) => node.open), false);
        await page.click('.usage-historical summary');
        assert.equal(await page.$eval('.usage-historical', (node) => node.open), true);
        assert.match(
          await page.$eval('.usage-history-content', (node) => node.textContent),
          /not confirmed human activity/,
        );
      });
      await t.test('tablet and mobile have no document clipping and retain usable tables', async () => {
        for (const width of [900, 390, 320]) {
          await page.setViewport({ width, height: 1000 });
          await open();
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
            `overflow at ${width}px`,
          );
          assert.equal(
            await page.$eval('.usage-kpis', (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
            width === 900 ? 3 : width === 320 ? 1 : 2,
          );
          if (width === 390 && process.env.USAGE_SCREENSHOTS === '1')
            await page.screenshot({ path: resolve('node_modules/.cache/usage-dashboard/mobile.png'), fullPage: true });
          await page.click('[data-tab="terms"]');
          assert.equal(await page.$eval('#usage-panel-terms', (node) => node.hidden), false);
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(analyticsHits, []);
      });
      await t.test(
        'shared header matches public navigation with working dropdowns at desktop and mobile widths',
        async () => {
          const paths = ['/', '/catalog', '/about', '/instructions', '/admin/usage-statistics'];
          const expectedLinks = [
            '/',
            '#',
            '/admin/usage-statistics',
            'https://cssplice.github.io',
            '/instructions/',
            '/about/',
            'mailto:cssplice@gmail.com',
          ];
          for (const width of [1500, 390]) {
            await page.setViewport({ width, height: 1100 });
            let publicHeader;
            for (const path of paths) {
              await page.goto(base + path, { waitUntil: 'networkidle0' });
              const header = await page.$eval('body > header', (node) => {
                const style = getComputedStyle(node);
                const nav = node.querySelector('.nav-link');
                const input = node.querySelector('#query');
                const button = node.querySelector('.btn-outline-light');
                return {
                  background: style.backgroundColor,
                  color: getComputedStyle(nav).color,
                  font: getComputedStyle(nav).fontFamily,
                  fontSize: getComputedStyle(nav).fontSize,
                  padding: style.padding,
                  containerWidth: getComputedStyle(node.querySelector('.container')).maxWidth,
                  inputHeight: input.getBoundingClientRect().height,
                  buttonColor: getComputedStyle(button).color,
                  buttonBorder: getComputedStyle(button).borderColor,
                  links: [...node.querySelectorAll('.nav > li > a')].map((link) => link.getAttribute('href')),
                  html: node.outerHTML,
                };
              });
              assert.equal(header.background, 'rgb(33, 37, 41)', path);
              assert.equal(header.color, 'rgb(255, 255, 255)', path);
              assert.deepEqual(header.links, expectedLinks, path);
              if (publicHeader) assert.deepEqual(header, publicHeader, path);
              else publicHeader = header;
              assert.equal(await page.$$eval('body > header', (nodes) => nodes.length), 1);
              assert.deepEqual(
                await page.$$eval('[id]', (nodes) => {
                  const ids = nodes.map((node) => node.id);
                  return ids.filter((id, index) => ids.indexOf(id) !== index);
                }),
                [],
              );
              assert.equal(await page.$$eval('script[src="/js/usageTracking.js"]', (nodes) => nodes.length), 1);
              assert.equal(await page.$$eval('script[src*="bootstrap.bundle.min.js"]', (nodes) => nodes.length), 1);
              await page.click('#catalogDropdown');
              await page.waitForSelector('.dropdown-menu.show');
              assert.equal(await page.$eval('#catalogDropdown', (node) => node.getAttribute('aria-expanded')), 'true');
              assert.deepEqual(
                await page.$$eval('.dropdown-item', (nodes) => nodes.map((node) => node.getAttribute('href'))),
                ['/toolcatalog/', '/catalog/', '/datasetcatalog/', '/ontology/tiles/'],
              );
              await page.keyboard.press('Escape');
              assert.equal(await page.$eval('#catalogDropdown', (node) => node.getAttribute('aria-expanded')), 'false');
              if (path === '/admin/usage-statistics') {
                assert.match(
                  await page.$eval('.usage-breadcrumb', (node) => node.textContent),
                  /Admin panel.*Usage Statistics/,
                );
                assert.ok(
                  await page.evaluate(
                    () =>
                      document.querySelector('.usage-breadcrumb').getBoundingClientRect().top >=
                      document.querySelector('body > header').getBoundingClientRect().bottom,
                  ),
                );
              }
            }
          }
          for (const role of ['anonymous', 'contributor']) {
            await page.setExtraHTTPHeaders({ 'x-fixture-role': role });
            for (const path of paths.slice(0, -1)) {
              await page.goto(base + path, { waitUntil: 'networkidle0' });
              assert.equal(await page.$('body > header a[href="/admin/usage-statistics"]'), null);
              assert.equal(await page.$('body > header a[href="/admin"]'), null);
              assert.equal(Boolean(await page.$('body > header a[href="/login"]')), role === 'anonymous');
              for (const href of ['/profile', '/logout'])
                assert.equal(Boolean(await page.$(`body > header a[href="${href}"]`)), role === 'contributor');
            }
          }
          await page.setExtraHTTPHeaders({});
          assert.deepEqual(errors, []);
          assert.deepEqual(analyticsHits, []);
        },
      );
      await t.test('each real header search submission tracks once while typing and dropdowns do not', async () => {
        for (const path of ['/', '/catalog', '/about', '/instructions', '/admin/usage-statistics']) {
          await page.goto(base + path, { waitUntil: 'networkidle0' });
          const before = headerSearches.length;
          await page.type('#query', 'binary   tree');
          assert.equal(headerSearches.length, before);
          await page.keyboard.press('Enter');
          // Native navigation can detach the fetch response from DevTools; assert server receipt.
          for (let attempt = 0; attempt < 100 && headerSearches.length === before; attempt++) await delay(50);
          await page.waitForNetworkIdle();
          assert.equal(
            headerSearches.length,
            before + 1,
            `${path}: received ${JSON.stringify(analyticsHits)}, at ${page.url()}`,
          );
          assert.deepEqual(headerSearches.at(-1), { query: 'binary tree' });
          const url = new URL(page.url());
          assert.equal(url.pathname, path === '/catalog' ? '/catalog' : '/search/');
          assert.equal(url.searchParams.get('query'), 'binary   tree');
        }
        assert.ok(analyticsHits.every((event) => event === 'web-search'));
        analyticsHits.length = 0;
        assert.deepEqual(errors, []);
      });
      await t.test('API-only dates render real search activity without requiring click events', async () => {
        apiOnly = true;
        await open();
        assert.equal(await page.$$eval('.usage-point--api', (nodes) => nodes.length), 3);
        const api = await page.$$eval('.usage-point--api title', (nodes) => nodes.map((node) => node.textContent));
        assert.ok(api.some((text) => text.includes('70 public API searches')));
        assert.equal(await page.$('.usage-chart-empty'), null);
        apiOnly = false;
      });
      await t.test('empty data has real zeros, safe percentages and an absent-import explanation', async () => {
        empty = true;
        await page.setViewport({ width: 1500, height: 1100 });
        await open();
        assert.ok(
          (await page.$$eval('.usage-kpi-value', (nodes) => nodes.map((node) => node.textContent))).every(
            (value) => value === '0',
          ),
        );
        assert.equal(await page.$('.usage-line-chart'), null);
        assert.equal(await page.$('.usage-donut-segment'), null);
        assert.ok(
          (await page.$$eval('.usage-donut-legend small', (nodes) => nodes.map((node) => node.textContent))).every(
            (value) => value === '0%',
          ),
        );
        await page.click('.usage-historical summary');
        assert.match(
          await page.$eval('.usage-history-content', (node) => node.textContent),
          /No historical import is present/,
        );
        assert.equal((await page.content()).includes('NaN'), false);
      });
    } else await t.test('Chrome interactions', { skip: 'Set CHROME_BIN to enable browser verification' }, () => {});
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    for (const [owner, name, original] of originals) owner[name] = original;
  }
});
