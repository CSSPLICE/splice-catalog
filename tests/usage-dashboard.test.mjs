import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { SelectQueryBuilder } from 'typeorm';
import puppeteer from 'puppeteer';
import { AppDataSource } from '../src/db/data-source.ts';
import { HistoricalUsage } from '../src/db/entities/HistoricalUsage.ts';
import { UsageStatisticsService } from '../src/services/UsageStatisticsService.ts';
import { SearchStatisticsService } from '../src/services/SearchStatisticsService.ts';
import { UsageAuditHistoryService } from '../src/services/UsageAuditHistoryService.ts';
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

const historicalEntries = [400, 300, 200, 100, 70, 50, 30, 20, 15, 14, 12, 10, 8, 5].map((count, index) => ({
  catalogType: 'SLC_ITEM',
  itemPersistentID: `history:${index + 1}`,
  itemTitle: index === 1 ? '<img src=x onerror="window.historicalXss=true">' : index === 2 ? '=SUM(1,2)' : `Historical entry ${String(index + 1).padStart(2, '0')}`,
  historicalPageRequests: count,
  catalogPath: index === 0 ? '/catalog/item/7007' : null,
}));

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

test('historical queries bound pages and validate current persistent identities without trusting imported IDs', async () => {
  await AppDataSource.buildMetadatas();
  const prototype = SelectQueryBuilder.prototype;
  const original = { one: prototype.getRawOne, many: prototype.getRawMany, count: prototype.getCount };
  const statements = [];
  const raw = [
    { itemPersistentID: 'production:7', currentPersistentID: 'production:7', currentId: '7007' },
    { itemPersistentID: 'production:8', currentPersistentID: 'different:8', currentId: 8 },
    { itemPersistentID: null, currentPersistentID: null, currentId: 9 },
    { itemPersistentID: 'CaseSensitive', currentPersistentID: 'casesensitive', currentId: 10 },
    { itemPersistentID: 'production:11', currentPersistentID: 'production:11', currentId: 'javascript:bad' },
  ].map((row) => ({ ...row, catalogType: 'SLC_ITEM', itemTitle: 'Imported title', historicalPageRequests: '40', legacyCatalogId: 7, catalogPath: '/catalog/item/7' }));
  try {
    prototype.getRawOne = async function () {
      statements.push(this.getQueryAndParameters());
      return { rowCount: '3729', totalRequests: '23202' };
    };
    prototype.getRawMany = async function () { statements.push(this.getQueryAndParameters()); return raw; };
    prototype.getCount = async function () { statements.push(this.getQueryAndParameters()); return 13; };
    const service = new UsageStatisticsService();
    const search = "literal%_' OR 1=1";
    const rows = await service.getHistoricalUsageEntries(search, 2);
    assert.equal(rows[0].catalogPath, '/catalog/item/7007');
    assert.ok(rows.slice(1).every((row) => row.catalogPath === null));
    assert.equal(rows[0].historicalPageRequests, 40);
    const [sql, parameters] = statements.at(-1);
    assert.match(sql, /LIMIT 6 OFFSET 6/);
    assert.match(sql, /BINARY .*persistentID.* = BINARY .*itemPersistentID/);
    assert.match(sql, /LOCATE\(/);
    assert.ok(parameters.includes(search));
    assert.ok(!sql.includes(search));
    assert.doesNotMatch(sql, /createdAt|usage_events|search_events/);
    const page = await service.getHistoricalUsagePage(search, 999999);
    assert.equal(page.page, 3);
    assert.equal(page.pageSize, 6);
    assert.equal(page.matchingCount, 13);
    assert.equal(page.rowCount, 3729);
    assert.equal(page.totalRequests, 23202);
    assert.match(statements.at(-1)[0], /LIMIT 6 OFFSET 12/);
    await service.getHistoricalUsageEntries();
    assert.doesNotMatch(statements.at(-1)[0], /LIMIT|OFFSET|LOCATE/);
    assert.ok(statements.every(([, params]) => params.includes('nginx_historical') && params.includes('SLC_ITEM')));
    assert.equal(AppDataSource.isInitialized, false);
  } finally {
    prototype.getRawOne = original.one; prototype.getRawMany = original.many; prototype.getCount = original.count;
  }
});

test('dashboard rendering, unified exports, filters and responsive interactions', { timeout: 120000 }, async (t) => {
  const originals = [],
    calls = [],
    analyticsHits = [];
  let empty = false;
  let apiOnly = false;
  let historicalEmpty = false, historicalFailure = false;
  let auditEmpty = false, auditFailure = false, auditOversizedExport = false;
  const historicalCalls = [];
  const auditCalls = [], auditExports = [];
  const auditRows = Array.from({ length: 14 }, (_, index) => ({
    finalizedAt: new Date('2026-11-10T15:30:00Z'), kind: index === 1 ? 'WEB_SEARCH' : index === 4 ? 'EXTERNAL_CLICK' : 'ENTRY_CLICK',
    status: ['REVIEW', 'REVIEW', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVIEW', 'REVIEW', 'REVIEW'][index] ?? 'ACCEPTED',
    reason: [
      'SESSION_RATE', 'RETROSPECTIVE_EVENT_BURST', 'REVIEW_WINDOW_ELIGIBLE', 'SESSION_ABUSE', 'PENDING_EXPIRED',
      'RETROSPECTIVE_KNOWN_AUTOMATION', 'constructor', '<img src=x onerror="window.auditXss=true">',
    ][index] ?? 'REVIEW_WINDOW_ELIGIBLE',
    catalogType: index === 1 || index === 3 ? null : index === 4 ? 'DATASET' : 'SLC_ITEM',
    itemPersistentID: index === 1 || index === 3 ? null : `urn:fixture:${index + 1}`,
    itemTitle: index === 7 ? '<img src=x onerror="window.auditXss=true">' :
      (index < 5 ? ['Graph traversal exercises', null, 'Binary search visualizer', null, 'Sorting lab dataset'][index] : `Audited item ${index + 1}`),
    officialEventId: index === 2 || index > 4 ? index + 1 : null,
  }));
  const filteredAuditRows = (filters) => auditRows.filter((row) =>
    (!filters.status || row.status === filters.status) && (!filters.kind || row.kind === filters.kind) &&
    (!filters.catalogType || row.catalogType === filters.catalogType) &&
    (!filters.search || [row.itemTitle, row.itemPersistentID, row.reason].some((text) => text?.includes(filters.search))),
  );
  stub(UsageAuditHistoryService.prototype, 'page', async (filters, requestedPage, pageSize) => {
    auditCalls.push({ filters, requestedPage, pageSize });
    if (auditFailure) throw new Error('Simulated audit outage');
    const rows = auditEmpty ? [] : filteredAuditRows(filters);
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(requestedPage, totalPages);
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), matchingCount: rows.length, page, pageSize, totalPages };
  }, originals);
  stub(UsageAuditHistoryService.prototype, 'export', async (filters) => {
    auditExports.push(filters);
    return auditOversizedExport ? Array(5001).fill(auditRows[0]) : filteredAuditRows(filters)
      .map((row) => ({ ...row, policyVersion: 'fixture-policy' }));
  }, originals);
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
    async () => (historicalEmpty ? { rowCount: 0, totalRequests: 0 } : { rowCount: 14, totalRequests: 1234 }),
    originals,
  );
  stub(usage, 'getHistoricalUsageEntries', async () => structuredClone(historicalEmpty ? [] : historicalEntries), originals);
  stub(usage, 'getHistoricalUsagePage', async (query, requestedPage) => {
    historicalCalls.push({ query, requestedPage });
    if (historicalFailure) throw new Error('Simulated historical outage');
    const all = historicalEmpty ? [] : historicalEntries;
    const matching = all.filter((row) => `${row.itemTitle} ${row.catalogType} ${row.catalogType.replace(/_/g, ' ')}`.toLowerCase().includes(query.toLowerCase()));
    const totalPages = Math.max(1, Math.ceil(matching.length / 6));
    const page = Math.min(requestedPage, totalPages);
    return { rowCount: all.length, totalRequests: all.reduce((sum, row) => sum + row.historicalPageRequests, 0), matchingCount: matching.length, page, pageSize: 6, totalPages, rows: structuredClone(matching.slice((page - 1) * 6, page * 6)) };
  }, originals);
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
      user: { 'https://roles': role === 'admin' ? ['admin'] : role === 'malformed' ? 'non-admin' : [] },
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
      assert.match(html, /Historical Nginx Data/);
      assert.match(html, /Audit History/);
      assert.doesNotMatch(html, /class="usage-historical"|1,234|Historical entry 01/);
      assert.equal(historicalCalls.length, 0);
      assert.equal(auditCalls.length, 0);
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
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const data = await response.json();
      assert.deepEqual(Object.keys(data), [
        'generatedAt',
        'filters',
        'summary',
        'activityOverTime',
        'entryClicksByCatalogType',
        'catalogEntryStatistics',
        'frequentSearchTerms',
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
      for (const tab of ['entries', 'terms', 'historical', 'audit']) {
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
      assert.equal('historicalNginx' in data, false);
      assert.ok(csv.includes('"\'=SUM(1,2)"'));
      assert.ok(csv.includes('""fixture""'));
      for (const text of [JSON.stringify(data), csv])
        assert.doesNotMatch(text, /ITEM_VIEW|legacyItemViews|historicalPageRequests|historicalNginx|Historical Nginx|lifecycleStatus/);
      assert.equal((await fetch(`${endpoint}/export.csv?from=2026-10-04&to=2026-10-01`)).status, 400);
      for (const path of ['', '/export', '/export.csv']) {
        assert.equal((await fetch(endpoint + path, { headers: { 'x-fixture-role': 'anonymous' } })).status, 401);
        assert.equal((await fetch(endpoint + path, { headers: { 'x-fixture-role': 'contributor' } })).status, 403);
      }
    });
    await t.test('separate historical reports are admin-only and JSON/CSV agree', async () => {
      const report = `${endpoint}/historical/export`;
      const result = await fetch(report + '?catalogType=TOOL&from=invalid');
      assert.equal(result.headers.get('cache-control'), 'no-store');
      const json = await result.json();
      assert.equal(json.rowCount, 14);
      assert.deepEqual(json.entries, historicalEntries);
      assert.equal(json.totalRequests, 1234);
      assert.equal(json.period, 'all-time');
      assert.match(json.note, /not intentional entry clicks/);
      const csv = await (await fetch(report + '.csv?q=unmatched&page=999&from=invalid')).text();
      const [entryHeaders, ...entryRows] = csvBlocks(csv).get('Historical Nginx Data');
      assert.deepEqual(entryRows, json.entries.map((row) => entryHeaders.map((key) => csvValue(row[key]))));
      assert.ok(csv.includes("\"'=SUM(1,2)\""));
      const [headers, values] = csv.trim().split('\r\n').map((line) => line.split(','));
      assert.equal(values[headers.indexOf('totalRequests')], String(json.totalRequests));
      assert.equal(values[headers.indexOf('rowCount')], String(json.rowCount));
      for (const suffix of ['', '.csv']) {
        assert.equal((await fetch(report + suffix, { headers: { 'x-fixture-role': 'anonymous' } })).status, 401);
        assert.equal((await fetch(report + suffix, { headers: { 'x-fixture-role': 'contributor' } })).status, 403);
      }
      historicalEmpty = true;
      assert.equal((await (await fetch(report)).json()).imported, false);
      historicalEmpty = false;
    });
    await t.test('historical endpoint is admin-only, bounded, searchable and independent of live filters', async () => {
      const path = `${endpoint}/historical`;
      for (const [role, status] of [['anonymous', 401], ['contributor', 403]])
        assert.equal((await fetch(path, { headers: { 'x-fixture-role': role } })).status, status);
      for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1000001', 'page[]=1', 'q[]=test', `q=${'x'.repeat(201)}`])
        assert.equal((await fetch(`${path}?${query}`)).status, 400);
      const response = await fetch(`${path}?page=2&from=invalid&to=invalid&catalogType=TOOL&pageSize=9999`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const data = await response.json();
      assert.equal(data.period, 'all-time');
      assert.equal(data.page, 2);
      assert.equal(data.rows.length, 6);
      assert.equal(data.totalRequests, 1234);
      assert.equal(data.rowCount, 14);
      assert.equal((await (await fetch(`${path}?q=SLC%20Item`)).json()).matchingCount, 14);
      const filtered = await (await fetch(`${path}?q=entry%2014&page=999`)).json();
      assert.equal(filtered.matchingCount, 1);
      assert.equal(filtered.rows[0].itemTitle, 'Historical entry 14');
      assert.equal(filtered.page, 1);
      assert.equal(filtered.totalRequests, 1234);
      assert.equal(filtered.rowCount, 14);
      const none = await (await fetch(`${path}?q=unmatched`)).json();
      assert.equal(none.rows.length, 0);
      assert.equal(none.matchingCount, 0);
      assert.equal(none.totalRequests, 1234);
      historicalFailure = true;
      assert.equal((await fetch(path)).status, 500);
      assert.equal((await fetch(endpoint + '/export')).status, 200);
      historicalFailure = false;
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
    await t.test('audit tab HTML requires an admin and does not include audit records', async () => {
      for (const [role, status] of [['anonymous', 401], ['contributor', 403], ['malformed', 403]]) {
        assert.equal((await fetch(`${endpoint}?tab=audit`, { headers: { 'x-fixture-role': role } })).status, status);
      }
      const response = await fetch(`${endpoint}?tab=audit`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const html = await response.text();
      assert.match(html, /data-initial-tab="audit"/);
      assert.doesNotMatch(html, /SESSION_RATE|window\.auditXss/);
      assert.equal(auditCalls.length, 0);
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
      const captureAudit = async (filename, maxHeight) => {
        const clip = await page.$eval('.usage-statistics-panel', (node, height) => {
          const bounds = node.getBoundingClientRect();
          return { x: bounds.x + scrollX, y: bounds.y + scrollY, width: bounds.width, height: Math.min(bounds.height, height) };
        }, maxHeight);
        await page.screenshot({ path: resolve('node_modules/.cache/usage-dashboard', filename), clip });
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
      await t.test('four tabs follow the existing order alongside five live cards', async () => {
        assert.equal(await page.$('.usage-historical'), null);
        assert.equal(await page.$$eval('.usage-kpi', (nodes) => nodes.length), 5);
        assert.doesNotMatch(await page.content(), /usage-history-content/);
        assert.deepEqual(await page.$$eval('[role=tab]', (nodes) => nodes.map((node) => node.dataset.tab)),
          ['entries', 'terms', 'historical', 'audit']);
      });
      await t.test('historical tab loads only one page and preserves live cards, charts and exports', async () => {
        await page.setViewport({ width: 1500, height: 1100 });
        await open();
        const callsBefore = historicalCalls.length;
        const live = await page.$$eval('.usage-kpi-value', (nodes) => nodes.map((node) => node.textContent));
        assert.equal(await page.$$eval('[data-historical-rows] [data-table-row]', (nodes) => nodes.length), 0);
        await page.click('[data-tab="historical"]');
        await page.waitForFunction(() => document.querySelector('[data-historical-totals]').textContent.includes('1,234'));
        assert.equal(historicalCalls.length, callsBefore + 1);
        assert.equal(await page.$$eval('#usage-panel-historical [data-table-row]', (nodes) => nodes.length), 6);
        assert.match(await page.$eval('[data-historical-totals]', (node) => node.textContent), /1,234.*14 imported entries/);
        assert.equal(await page.$eval('#usage-panel-historical a.usage-item-link', (node) => node.getAttribute('href')), '/catalog/item/7007');
        assert.equal(await page.$('#usage-panel-historical img'), null);
        if (process.env.USAGE_SCREENSHOTS === '1') await page.screenshot({ path: resolve('node_modules/.cache/usage-dashboard/historical.png'), fullPage: true });
        assert.equal(await page.evaluate(() => window.historicalXss), undefined);
        assert.match(await page.$eval('#usage-panel-historical', (node) => node.textContent), /not confirmed human clicks/);
        await page.click('#usage-panel-historical [aria-label="Next page"]');
        await page.waitForFunction(() => document.querySelector('#usage-panel-historical [data-table-summary]').textContent.includes('7–12'));
        await page.type('#historicalEntrySearch', 'entry 14');
        await page.waitForFunction(() => document.querySelector('#usage-panel-historical [data-table-summary]').textContent.includes('1–1 of 1'));
        assert.equal(await page.$$eval('#usage-panel-historical [data-table-row]', (nodes) => nodes.length), 1);
        assert.match(await page.$eval('[data-historical-totals]', (node) => node.textContent), /1,234.*14 imported entries/);
        await page.click('[data-tab="terms"]');
        const beforeReturn = historicalCalls.length;
        await page.click('[data-tab="historical"]');
        assert.equal(await page.$eval('#historicalEntrySearch', (node) => node.value), 'entry 14');
        assert.equal(historicalCalls.length, beforeReturn);
        assert.deepEqual(await page.$$eval('.usage-kpi-value', (nodes) => nodes.map((node) => node.textContent)), live);
        assert.equal(await page.$$eval('.usage-charts > article', (nodes) => nodes.length), 2);
        const links = await page.$$eval('#usage-panel-historical .usage-export-actions a', (nodes) => nodes.map((node) => node.getAttribute('href')));
        assert.deepEqual(links, ['/admin/usage-statistics/historical/export', '/admin/usage-statistics/historical/export.csv']);
        await page.goto(`${endpoint}?tab=historical&from=2026-10-01&to=2026-10-04&catalogType=TOOL`, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => document.querySelector('[data-historical-totals]').textContent.includes('1,234'));
        assert.equal(await page.$eval('#usage-panel-historical', (node) => node.hidden), false);
        assert.deepEqual(historicalCalls.at(-1), { query: '', requestedPage: 1 });
      });
      await t.test('historical tab handles unavailable and empty data without altering live metrics', async () => {
        historicalFailure = true;
        await open();
        await page.click('[data-tab="historical"]');
        await page.waitForFunction(() => document.querySelector('#usage-panel-historical [data-table-summary]').textContent.includes('unavailable'));
        historicalFailure = false;
        historicalEmpty = true;
        await page.click('[data-tab="historical"]');
        await page.waitForFunction(() => document.querySelector('[data-historical-totals]').textContent.includes('0 page requests'));
        assert.match(await page.$eval('#usage-panel-historical [data-table-empty]', (node) => node.textContent), /No historical data has been imported/);
        assert.equal(await page.$$eval('.usage-kpi', (nodes) => nodes.length), 5);
        historicalEmpty = false;
      });
      await t.test('audit tab loads on demand and filters and pages independently of official metrics', async () => {
        const panel = '#usage-panel-audit';
        const summary = `${panel} [data-table-summary]`;
        const waitForSummary = (range) => page.waitForFunction(
          (selector, value) => document.querySelector(selector).textContent === `Showing ${value} audit records.`, {}, summary, range,
        );
        await page.setViewport({ width: 1500, height: 1100 });
        await open();
        const before = auditCalls.length;
        const official = await page.$$eval('.usage-kpi-value, .usage-series', (nodes) =>
          nodes.map((node) => node.getAttribute('d') || node.textContent),
        );
        assert.equal(await page.$eval(panel, (node) => node.hidden), true);
        assert.equal(await page.$$eval(`${panel} [data-table-row]`, (rows) => rows.length), 0);
        assert.equal(auditCalls.length, before);
        await page.click('[data-tab="audit"]');
        await waitForSummary('1–6 of 14');
        assert.equal(auditCalls.length, before + 1);
        assert.equal(auditCalls.at(-1).pageSize, 6);
        assert.equal(await page.$eval('[data-tab-count="audit"]', (node) => node.textContent), '14');
        assert.equal(await page.$(`${panel} [name="itemPersistentID"]`), null);
        assert.equal(await page.$$eval(`${panel} input[type="search"]`, (nodes) => nodes.length), 1);
        assert.equal(await page.$eval(`${panel} [name="q"]`, (node) => node.placeholder), 'Search by item title, persistent ID, or reason...');
        const filterOptions = await page.$$eval(`${panel} [name="status"], ${panel} [name="kind"]`, (selects) =>
          selects.map((select) => Array.from(select.options, (option) => [option.value, option.label])),
        );
        assert.deepEqual(filterOptions, [
          [['', 'All statuses'], ['ACCEPTED', 'Accepted'], ['REVIEW', 'Review'], ['REJECTED', 'Rejected'], ['EXPIRED', 'Expired']],
          [['', 'All events'], ['ENTRY_CLICK', 'Entry Click'], ['EXTERNAL_CLICK', 'External Click'], ['WEB_SEARCH', 'Web Search']],
        ]);
        const toolbar = await page.$eval(panel, (node) => {
          const search = node.querySelector('[name="q"]').getBoundingClientRect();
          const actions = node.querySelector('.usage-export-actions').getBoundingClientRect();
          const buttons = [...node.querySelectorAll('[data-audit-download]')];
          const existing = document.querySelector('#usage-panel-entries .usage-export-actions a');
          const styles = (control) => ['padding', 'borderRadius', 'border', 'fontSize', 'color', 'minHeight']
            .map((key) => getComputedStyle(control)[key]);
          return { searchLeft: search.right < actions.left, aligned: search.top === actions.top,
            matchingButtons: buttons.every((button) => JSON.stringify(styles(button)) === JSON.stringify(styles(existing))) };
        });
        assert.deepEqual(toolbar, { searchLeft: true, aligned: true, matchingButtons: true });
        const visible = await page.$$eval(`${panel} [data-table-row]`, (rows) => rows.map((row) => {
          const badge = row.cells[2].firstElementChild;
          const style = getComputedStyle(badge);
          const luminance = (color) => {
            const [r, g, b] = color.match(/\d+/g).map((channel) => {
              const value = Number(channel) / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          return {
            status: badge.textContent, reason: row.cells[3].textContent, background: style.backgroundColor,
            contrast: (luminance(style.backgroundColor) + 0.05) / (luminance(style.color) + 0.05),
            wrap: getComputedStyle(row.cells[3]).overflowWrap,
          };
        }));
        assert.deepEqual(visible.map(({ status, reason, background }) => [status, reason, background]), [
          ['Under review', 'High session activity rate', 'rgb(251, 245, 232)'],
          ['Under review', 'Unusual activity burst', 'rgb(251, 245, 232)'],
          ['Accepted', 'Eligible after review', 'rgb(240, 247, 242)'],
          ['Rejected', 'Session activity limit exceeded', 'rgb(251, 239, 239)'],
          ['Expired', 'Review period expired', 'rgb(242, 242, 242)'],
          ['Under review', 'Automation activity detected', 'rgb(251, 245, 232)'],
        ]);
        assert.ok(visible.every(({ contrast, wrap }) => contrast >= 4.5 && wrap === 'normal'));
        assert.equal(await page.$eval('[data-audit-disabled]', (node) => node.hidden), false);
        if (process.env.USAGE_SCREENSHOTS === '1') await captureAudit('audit-toolbar-desktop.png', 690);
        assert.equal(await page.$eval(`${panel} [aria-label="Previous page"]`, (node) => node.disabled), true);
        await page.click(`${panel} [aria-label="Next page"]`);
        await waitForSummary('7–12 of 14');
        assert.equal(auditCalls.at(-1).requestedPage, 2);
        assert.equal(await page.$$eval(`${panel} [data-table-row]`, (rows) => rows.length), 6);
        assert.deepEqual(await page.$$eval(`${panel} .usage-audit-reason`, (cells) =>
          cells.slice(0, 2).map((cell) => cell.textContent)), ['Unrecognized reason', 'Unrecognized reason']);
        assert.match(await page.$eval(`${panel} [data-audit-rows]`, (node) => node.textContent), /<img src=x onerror=/);
        assert.equal(await page.$(`${panel} img`), null);
        assert.equal(await page.evaluate(() => window.auditXss), undefined);
        await page.click(`${panel} [aria-label="Page 3"]`);
        await waitForSummary('13–14 of 14');
        assert.equal(auditCalls.at(-1).requestedPage, 3);
        assert.equal(await page.$$eval(`${panel} [data-table-row]`, (rows) => rows.length), 2);
        assert.equal(await page.$eval(`${panel} [aria-label="Next page"]`, (node) => node.disabled), true);
        await page.click(`${panel} [aria-label="Previous page"]`);
        await waitForSummary('7–12 of 14');

        const beforeFilter = auditCalls.length;
        await page.type(`${panel} [name="q"]`, 'urn:fixture:1');
        await page.select(`${panel} [name="status"]`, 'REVIEW');
        await page.select(`${panel} [name="kind"]`, 'ENTRY_CLICK');
        assert.equal(await page.$eval(`${panel} [name="status"]`, (select) => select.selectedOptions[0].label), 'Review');
        assert.equal(await page.$eval(`${panel} [name="kind"]`, (select) => select.selectedOptions[0].label), 'Entry Click');
        await page.select(`${panel} [name="catalogType"]`, 'SLC_ITEM');
        await page.select(`${panel} [name="period"]`, 'custom');
        await page.$eval(`${panel} [name="from"]`, (node) => { node.value = '2026-11-10'; });
        await page.$eval(`${panel} [name="to"]`, (node) => { node.value = '2026-11-10'; });
        assert.equal(auditCalls.length, beforeFilter);
        await page.click(`${panel} [type="submit"]`);
        await waitForSummary('1–1 of 1');
        assert.equal(auditCalls.at(-1).requestedPage, 1);
        assert.equal(auditCalls.at(-1).filters.status, 'REVIEW');
        assert.equal(auditCalls.at(-1).filters.search, 'urn:fixture:1');
        assert.equal(auditCalls.at(-1).filters.kind, 'ENTRY_CLICK');
        assert.equal(auditCalls.at(-1).filters.catalogType, 'SLC_ITEM');
        assert.equal(auditCalls.at(-1).filters.from.getDate(), 10);
        assert.equal(auditCalls.at(-1).filters.toExclusive.getDate(), 11);
        assert.equal(await page.$eval('[data-tab-count="audit"]', (node) => node.textContent), '14');
        auditOversizedExport = true;
        try {
          for (const format of ['json', 'csv']) {
            await page.click(`[data-audit-download="${format}"]`);
            await page.waitForFunction((label) => document.querySelector('[data-audit-export-message]').textContent
              .includes(`${label} export is limited to 5,000 records`), {}, format.toUpperCase());
            assert.deepEqual(auditExports.at(-1), auditCalls.at(-1).filters);
          }
        } finally {
          auditOversizedExport = false;
        }
        const downloadDirectory = await mkdtemp(join(tmpdir(), 'splice-audit-exports-'));
        try {
          await page.browserContext().setDownloadBehavior({ policy: 'allow', downloadPath: downloadDirectory });
          const files = {};
          for (const format of ['json', 'csv']) {
            await page.click(`[data-audit-download="${format}"]`);
            const file = join(downloadDirectory, `splice-audit-history.${format}`);
            for (let attempt = 0; attempt < 50 && !existsSync(file); attempt++) await delay(100);
            files[format] = await readFile(file, 'utf8');
            assert.deepEqual(auditExports.at(-1), auditCalls.at(-1).filters);
          }
          const records = JSON.parse(files.json);
          assert.equal(records.length, 1);
          assert.equal(records[0].itemTitle, 'Graph traversal exercises');
          assert.equal(records[0].reason, 'SESSION_RATE');
          assert.deepEqual(files.csv.split('\r\n').slice(1), [
            `${records[0].finalizedAt},ENTRY_CLICK,REVIEW,SESSION_RATE,SLC_ITEM,urn:fixture:1,Graph traversal exercises,,fixture-policy`,
          ]);
        } finally {
          await page.browserContext().setDownloadBehavior({ policy: 'deny' });
          await rm(downloadDirectory, { recursive: true, force: true });
        }
        assert.deepEqual(await page.$$eval('.usage-kpi-value, .usage-series', (nodes) =>
          nodes.map((node) => node.getAttribute('d') || node.textContent),
        ), official);
        assert.equal(await page.$eval('[data-audit-reset]', (node) => node.textContent), 'Reset');
        await page.click('[data-audit-reset]');
        await waitForSummary('1–6 of 14');
        assert.equal(await page.$eval(`${panel} [name="from"]`, (node) => node.disabled), true);
        assert.deepEqual(await page.$eval(`${panel} form`, (form) => Array.from(new FormData(form).values())), ['', '', '', '', '']);
      });
      await t.test('audit query failures and empty results leave the other tabs usable', async () => {
        try {
          auditFailure = true;
          await open();
          await page.click('[data-tab="audit"]');
          await page.waitForFunction(() => document.querySelector('[data-audit-rows]').textContent.includes('Unable to load audit history. Please try again.'));
          assert.equal(await page.$$eval('.usage-kpi', (nodes) => nodes.length), 5);
          await page.click('[data-tab="terms"]');
          assert.equal(await page.$eval('#usage-panel-terms', (node) => node.hidden), false);
          auditFailure = false;
          auditEmpty = true;
          await page.click('[data-tab="audit"]');
          await page.waitForFunction(() => document.querySelector('[data-audit-rows]').textContent.includes('No audit records found for the selected filters.'));
          assert.equal(await page.$$eval('[data-audit-rows] [data-table-row]', (nodes) => nodes.length), 0);
        } finally {
          auditFailure = false;
          auditEmpty = false;
        }
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
          await page.click('[data-tab="historical"]');
          await page.waitForFunction(() => document.querySelector('[data-historical-totals]').textContent.includes('1,234'));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          if (width === 390 && process.env.USAGE_SCREENSHOTS === '1') await page.screenshot({ path: resolve('node_modules/.cache/usage-dashboard/historical-mobile.png'), fullPage: true });
          await page.click('[data-tab="audit"]');
          await page.waitForFunction(() => document.querySelector('#usage-panel-audit [data-table-summary]').textContent.includes('1–6 of 14'));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          await page.$eval('#usage-panel-audit .usage-table-scroll', (node) => { node.scrollLeft = node.scrollWidth; });
          assert.ok(await page.$eval('#usage-panel-audit .usage-table-scroll', (node) => node.scrollLeft > 0));
          await page.$eval('#usage-panel-audit .usage-table-scroll', (node) => { node.scrollLeft = 0; });
          if (width === 390 && process.env.USAGE_SCREENSHOTS === '1') await captureAudit('audit-toolbar-mobile.png', 700);
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
          await page.waitForFunction(
            (expectedPath) => location.pathname === expectedPath && new URL(location.href).searchParams.get('query') === 'binary   tree',
            {}, path === '/catalog' ? '/catalog' : '/search/',
          );
          assert.equal(
            headerSearches.length,
            before + 1,
            `${path}: received ${JSON.stringify(analyticsHits)}, at ${page.url()}`,
          );
          const eventId = headerSearches.at(-1).eventId;
          assert.match(eventId, /^[a-f0-9]{32}$/);
          assert.deepEqual(headerSearches.at(-1), { query: 'binary tree', eventId });
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
      await t.test('empty data has real zeros and safe percentages without a historical footer', async () => {
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
        assert.equal(await page.$('.usage-historical'), null);
        assert.equal((await page.content()).includes('NaN'), false);
      });
    } else await t.test('Chrome interactions', { skip: 'Set CHROME_BIN to enable browser verification' }, () => {});
  } finally {
    await browser?.close();
    // Chrome helpers can retain inherited pipes after the browser process exits.
    for (const stream of browser?.process()?.stdio ?? []) stream?.destroy();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    for (const [owner, name, original] of originals) owner[name] = original;
  }
});
