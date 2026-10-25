import 'reflect-metadata';
import assert from 'node:assert/strict';
import { beforeEach, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { SelectQueryBuilder } from 'typeorm';
import ejs from 'ejs';
import { AppDataSource } from '../src/db/data-source.ts';
import { UsageEvent } from '../src/db/entities/UsageEvent.ts';
import { SearchEvent } from '../src/db/entities/SearchEvent.ts';
import { HistoricalUsage } from '../src/db/entities/HistoricalUsage.ts';
import { slc_item_catalog } from '../src/db/entities/SLCItemCatalog.ts';
import { slc_tools_catalog } from '../src/db/entities/SLCToolsCatalog.ts';
import { dataset_catalog } from '../src/db/entities/DatasetCatalog.ts';
import { UsageController } from '../src/controllers/UsageController.ts';
import { SearchController } from '../src/controllers/SearchController.ts';
import { CatalogController } from '../src/controllers/CatalogController.ts';
import { UsageDashboardController } from '../src/controllers/UsageDashboardController.ts';
import { UsageStatisticsService } from '../src/services/UsageStatisticsService.ts';
import { SearchStatisticsService } from '../src/services/SearchStatisticsService.ts';
import { meilisearchService } from '../src/services/MeilisearchService.ts';
import { parseSearchQuery } from '../src/utils/searchQuery.ts';
import { checkRole } from '../src/middleware/middleware.ts';
import { CreateSearchEventsTable1792400000000 } from '../src/db/migrations/1792400000000-CreateSearchEventsTable.ts';

// All persistence and search-engine operations are replaced before any handler is invoked.
const originalRepository = AppDataSource.getRepository.bind(AppDataSource);
const originalSearch = meilisearchService.search;
let events, searches, storageFailure, engineFailure, hits;
const item = {
  id: 7,
  persistentID: 'urn:test:7',
  title: 'Canonical title',
  iframe_url: 'https://example.test/resource',
  keywords: [],
};
const tool = { id: 8, platform_name: 'Canonical tool', url: 'https://example.test/tool' };
const dataset = { id: 9, title: 'Canonical dataset', resource_url: 'https://example.test/dataset' };
function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
    render(view, data) {
      this.view = view;
      this.data = data;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
  };
}
beforeEach(() => {
  events = [];
  searches = [];
  storageFailure = false;
  engineFailure = false;
  hits = [item];
  AppDataSource.getRepository = (entity) => {
    if (entity === UsageEvent || entity === SearchEvent)
      return {
        create: (value) => ({ ...value }),
        save: async (value) => {
          if (storageFailure) throw new Error('simulated storage failure');
          (entity === UsageEvent ? events : searches).push(value);
          return value;
        },
      };
    const record =
      entity === slc_item_catalog
        ? item
        : entity === slc_tools_catalog
          ? tool
          : entity === dataset_catalog
            ? dataset
            : undefined;
    if (!record) throw new Error('Unexpected persistence access: database operations are disabled in tests');
    return {
      findOneBy: async (where) =>
        Object.entries(where).every(([key, value]) => record[key] === value) ? record : null,
      find: async () => [record],
    };
  };
  meilisearchService.search = async () => {
    if (engineFailure) throw new Error('simulated engine failure');
    return hits;
  };
});
after(() => {
  AppDataSource.getRepository = originalRepository;
  meilisearchService.search = originalSearch;
});

for (const [catalogType, itemIdentifier, expected] of [
  ['SLC_ITEM', item.persistentID, item.title],
  ['TOOL', '8', tool.platform_name],
  ['DATASET', '9', dataset.title],
]) {
  test(`entry click resolves canonical ${catalogType} metadata exactly once`, async () => {
    const res = response();
    await new UsageController().recordEntryClick(
      { body: { catalogType, itemIdentifier, itemTitle: 'spoof', catalogPath: '/spoof' } },
      res,
    );
    assert.equal(res.statusCode, 201);
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'ENTRY_CLICK');
    assert.equal(events[0].itemTitle, expected);
    assert.equal(events[0].catalogType, catalogType);
    assert.notEqual(events[0].catalogPath, '/spoof');
    assert.equal(events[0].linkType, undefined);
  });
}
for (const [catalogType, itemIdentifier, linkType] of [
  ['SLC_ITEM', item.persistentID, 'iframe_url'],
  ['TOOL', '8', 'tool_url'],
  ['DATASET', '9', 'resource_url'],
]) {
  test(`external click preserves ${linkType}`, async () => {
    const res = response();
    await new UsageController().recordExternalClick({ body: { catalogType, itemIdentifier, linkType } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'EXTERNAL_CLICK');
    assert.equal(events[0].linkType, linkType);
  });
}
test('invalid/unknown identities and mismatched links create no events', async () => {
  const controller = new UsageController();
  for (const body of [
    {},
    { catalogType: 'toString', itemIdentifier: '8' },
    { catalogType: 'TOOL', itemIdentifier: '-8' },
    { catalogType: 'TOOL', itemIdentifier: '9007199254740993' },
    { catalogType: 'TOOL', itemIdentifier: '999' },
    { catalogType: 'SLC_ITEM', itemIdentifier: [] },
  ]) {
    const res = response();
    await controller.recordEntryClick({ body }, res);
    assert.ok([400, 404].includes(res.statusCode));
  }
  const res = response();
  await controller.recordExternalClick(
    { body: { catalogType: 'TOOL', itemIdentifier: '8', linkType: 'iframe_url' } },
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(events.length, 0);
});
test('detail GET handler can be called repeatedly without any event write', async () => {
  const controller = new CatalogController();
  for (let count = 0; count < 3; count++) {
    const res = response();
    await controller.getCatalogItemByID({ params: { id: '7' } }, res);
    assert.equal(res.view, 'pages/item');
  }
  assert.equal(events.length, 0);
  const source = await readFile('src/controllers/ViewController.ts', 'utf8');
  assert.doesNotMatch(source, /recordEvent|ITEM_VIEW/);
});
test('normalization is minimal and invalid/overlong inputs are rejected', () => {
  assert.deepEqual(parseSearchQuery('  C++ \n  trees & graphs '), { query: 'C++ trees & graphs' });
  assert.equal(parseSearchQuery('   ').query, '');
  for (const query of [[], {}, 'x'.repeat(501)]) assert.ok(parseSearchQuery(query).error);
});
test('WEB ingestion fixes source, ignores identifiers and records deliberate repetitions', async () => {
  for (let i = 0; i < 2; i++) {
    const res = response();
    await new UsageController().recordWebSearch(
      { body: { query: '  binary   tree ', source: 'API', userId: 'do-not-store', resultCount: 999 } },
      res,
    );
    assert.equal(res.statusCode, 201);
  }
  assert.equal(searches.length, 2);
  assert.deepEqual(searches[0], { source: 'WEB', query: 'binary tree', catalogType: 'SLC_ITEM', resultCount: null });
  for (const query of ['', '  ', [], 'x'.repeat(501)]) {
    const res = response();
    await new UsageController().recordWebSearch({ body: { query } }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(searches.length, 2);
});
test('internal retrieval never records API analytics, even with forged source flags', async () => {
  const res = response();
  await new SearchController().searchCatalogResults({ query: { terms: 'trees', source: 'API' }, params: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.results.length, 1);
  assert.equal(searches.length, 0);
});
test('public API records completed searches including zero results', async () => {
  const controller = new SearchController();
  for (const results of [[item], []]) {
    hits = results;
    const res = response();
    await controller.searchCatalogAPI({ query: { terms: '  tree  ' }, params: { catalog: 'items' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(searches.at(-1).resultCount, results.length);
  }
  assert.equal(searches.length, 2);
  assert.equal(searches[0].source, 'API');
  assert.equal(searches[0].query, 'tree');
});
test('empty, failed, malformed and unsupported API searches create no successful-search events', async () => {
  const controller = new SearchController();
  for (const terms of [undefined, ' ', [], 'x'.repeat(501)]) {
    const res = response();
    await controller.searchCatalogAPI({ query: { terms }, params: { catalog: 'items' } }, res);
  }
  for (const catalog of ['tools', 'datasets', 'unknown', 'toString']) {
    const res = response();
    await controller.searchCatalogAPI({ query: { terms: 'tree' }, params: { catalog } }, res);
    assert.ok([400, 404].includes(res.statusCode));
  }
  engineFailure = true;
  const res = response();
  await controller.searchCatalogAPI({ query: { terms: 'tree' }, params: { catalog: 'items' } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(searches.length, 0);
});
test('analytics storage failure does not fail a completed API search', async () => {
  storageFailure = true;
  const res = response();
  await new SearchController().searchCatalogAPI({ query: { terms: 'tree' }, params: { catalog: 'items' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.results.length, 1);
});
test('admin guard responds once for anonymous callers', () => {
  const res = response();
  let sends = 0;
  res.send = () => {
    sends++;
    return res;
  };
  checkRole('admin')({ oidc: { isAuthenticated: () => false } }, res, () => assert.fail('must not authorize'));
  assert.equal(res.statusCode, 401);
  assert.equal(sends, 1);
});
test('new migration matches entity fields and existing usage migrations remain unchanged', async () => {
  const sql = [];
  await new CreateSearchEventsTable1792400000000().up({ query: async (statement) => sql.push(statement) });
  assert.equal(sql.length, 1);
  assert.match(sql[0], /CREATE TABLE `search_events`/);
  for (const field of [
    'source',
    'query',
    'catalogType',
    'resultCount',
    'createdAt',
    'IDX_search_events_source_createdAt',
  ])
    assert.ok(sql[0].includes(field));
  const names = [
    '1791251377107-CreateUsageEventsTable.ts',
    '1791309088000-AddUsageEventCatalogPath.ts',
    '1791914000000-CreateHistoricalUsageTable.ts',
  ];
  for (const name of names) {
    const path = `src/db/migrations/${name}`;
    assert.equal(await readFile(path, 'utf8'), execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' }));
  }
});
test('real query builders keep legacy and historical counts out of entry totals and retain filters', async () => {
  AppDataSource.getRepository = originalRepository;
  await AppDataSource.buildMetadatas(); // Builds metadata only; never initializes a connection.
  assert.ok(AppDataSource.hasMetadata(SearchEvent));
  assert.ok(AppDataSource.entityMetadatas.some((entry) => entry.name === 'ValidationJob'));
  const originalOne = SelectQueryBuilder.prototype.getRawOne;
  const originalMany = SelectQueryBuilder.prototype.getRawMany;
  const originalGetMany = SelectQueryBuilder.prototype.getMany;
  const statements = [];
  try {
    SelectQueryBuilder.prototype.getRawOne = async function () {
      statements.push(this.getQueryAndParameters());
      return this.expressionMap.mainAlias.metadata.target === HistoricalUsage
        ? { count: '50' }
        : { totalEntryClicks: '2', totalExternalClicks: '3', legacyItemViews: '11' };
    };
    SelectQueryBuilder.prototype.getRawMany = async function () {
      statements.push(this.getQueryAndParameters());
      if (this.expressionMap.mainAlias.metadata.target === SearchEvent)
        return [{ date: '2026-10-01', publicApiSearches: '6' }];
      return [
        {
          catalogType: 'SLC_ITEM',
          itemPersistentID: item.persistentID,
          itemTitle: item.title,
          catalogPath: '/catalog/item/7',
          entryClicks: '2',
          externalClicks: '3',
          legacyItemViews: '11',
        },
      ];
    };
    SelectQueryBuilder.prototype.getMany = async function () {
      statements.push(this.getQueryAndParameters());
      return [{ ...item, itemPersistentID: item.persistentID, viewCount: 50, catalogPath: '/catalog/item/7' }];
    };
    const service = new UsageStatisticsService();
    assert.deepEqual(await service.getOverallStatistics(), {
      totalEntryClicks: 2,
      totalExternalClicks: 3,
      legacyItemViews: 11,
      historicalPageRequests: 50,
    });
    const rows = await service.getPerItemStatistics();
    assert.equal(rows[0].entryClicks, 2);
    assert.equal(rows[0].legacyItemViews, 11);
    assert.equal(rows[0].historicalPageRequests, 50);
    statements.length = 0;
    assert.equal((await service.getOverallStatistics(undefined, undefined, false)).historicalPageRequests, 0);
    assert.equal((await service.getPerItemStatistics('entryClicks', undefined, undefined, false))[0].historicalPageRequests, 0);
    await service.addLifecycleStatuses(rows, false);
    assert.ok(statements.every(([sql]) => !sql.includes('historical_usage')), 'Live dashboard queries must not depend on historical storage');
    const range = { from: new Date('2026-10-01T00:00:00Z'), toExclusive: new Date('2026-10-02T00:00:00Z') };
    const scoped = await service.getOverallStatistics(range, 'TOOL');
    assert.equal(scoped.historicalPageRequests, 0);
    const [sql, parameters] = statements.at(-1);
    assert.match(sql, /createdAt.*>=/);
    assert.match(sql, /createdAt.*</);
    assert.ok(parameters.includes('TOOL'));
    await new SearchStatisticsService().getSummary(range, 'SLC_ITEM');
    assert.ok(statements.at(-1)[1].includes('SLC_ITEM'));
    const dailyApi = await new SearchStatisticsService().getDailyPublicApiSearches(range, 'SLC_ITEM');
    assert.deepEqual(dailyApi, [{ date: '2026-10-01', publicApiSearches: 6 }]);
    const [dailySql, dailyParams] = statements.at(-1);
    assert.match(dailySql, /COUNT\(\*\)/);
    assert.match(dailySql, /GROUP BY DATE/);
    assert.ok(dailyParams.includes('API'));
    assert.ok(dailyParams.includes('SLC_ITEM'));
    assert.ok(dailyParams.includes(range.from));
    assert.ok(dailyParams.includes(range.toExclusive));
  } finally {
    SelectQueryBuilder.prototype.getRawOne = originalOne;
    SelectQueryBuilder.prototype.getRawMany = originalMany;
    SelectQueryBuilder.prototype.getMany = originalGetMany;
  }
});
test('dashboard, JSON and CSV share the same distinct metrics and frequent terms', async () => {
  const usage = UsageStatisticsService.prototype,
    search = SearchStatisticsService.prototype;
  const originals = new Map();
  const stub = (owner, name, value) => {
    originals.set([owner, name], owner[name]);
    owner[name] = async () => structuredClone(value);
  };
  const summary = { totalEntryClicks: 2, totalExternalClicks: 3, legacyItemViews: 11, historicalPageRequests: 50 };
  const items = [
    {
      catalogType: 'SLC_ITEM',
      catalogPath: '/catalog/item/7',
      itemPersistentID: item.persistentID,
      itemTitle: '=formula',
      entryClicks: 2,
      externalClicks: 3,
      legacyItemViews: 11,
      historicalPageRequests: 50,
    },
  ];
  try {
    stub(usage, 'getOverallStatistics', summary);
    originals.set([usage, 'getHistoricalUsageSummary'], usage.getHistoricalUsageSummary);
    usage.getHistoricalUsageSummary = async () => { throw new Error('Live dashboard must not query historical aggregates'); };
    stub(usage, 'getPerItemStatistics', items);
    stub(usage, 'getUniqueCatalogEntryCount', 1);
    stub(usage, 'getDailyActivity', [{ date: '2026-10-01', entryClicks: 2, externalClicks: 3, legacyItemViews: 11 }]);
    stub(usage, 'getCatalogTypeEntryActivity', [{ catalogType: 'SLC_ITEM', label: 'SLC Items', count: 2 }]);
    stub(usage, 'addLifecycleStatuses', items);
    stub(usage, 'getUsageEvents', []);
    stub(search, 'getSummary', { webSearches: 4, publicApiSearches: 5 });
    stub(search, 'getDailyPublicApiSearches', [{ date: '2026-10-01', publicApiSearches: 5 }]);
    stub(search, 'getFrequentTerms', [
      { query: '<trees>, "graphs"', webSearches: 4, publicApiSearches: 5, totalSearches: 9 },
    ]);
    stub(search, 'getEvents', []);
    const controller = new UsageDashboardController();
    const req = { query: {} };
    const screen = response();
    await controller.show(req, screen);
    const json = response();
    await controller.export(req, json);
    const payload = JSON.parse(json.body);
    const csv = response();
    await controller.exportCsv(req, csv);
    assert.deepEqual(screen.data.overallStatistics, payload.summary);
    assert.deepEqual(screen.data.searchTerms, payload.frequentSearchTerms);
    assert.deepEqual(screen.data.activityOverTime, payload.activityOverTime);
    assert.deepEqual(payload.summary, {
      totalEntryClicks: 2,
      totalExternalClicks: 3,
      uniqueCatalogEntries: 1,
      webSearches: 4,
      publicApiSearches: 5,
    });
    assert.deepEqual(payload.activityOverTime, [
      { date: '2026-10-01', entryClicks: 2, externalClicks: 3, publicApiSearches: 5 },
    ]);
    assert.equal('historicalNginx' in payload, false);
    assert.equal(csv.body.split('\r\n\r\n').length, 5);
    for (const [metric, value] of Object.entries(payload.summary)) assert.ok(csv.body.includes(`${metric},${value}`));
    for (const text of [json.body, csv.body])
      assert.doesNotMatch(text, /ITEM_VIEW|legacyItemViews|historicalPageRequests|historicalNginx|Historical Nginx|lifecycleStatus/);
    assert.match(csv.body, /Frequent Search Terms/);
    assert.match(csv.body, /'=formula/);
    assert.match(csv.body, /""graphs""/);
    const html = await ejs.renderFile('src/views/pages/usage-statistics.ejs', {
      ...screen.data,
      user: null,
      isAdmin: false,
      showLoginButton: false,
    });
    for (const label of [
      'Entry Clicks',
      'External Resource Clicks',
      'Web Searches',
      'Public API Searches',
    ])
      assert.ok(html.includes(label));
    assert.ok(html.includes('&lt;trees&gt;'));
    assert.ok(!html.includes('Legacy ITEM_VIEW'));
    assert.doesNotMatch(html, /Historical Nginx|usage-historical|23,202/);
    assert.ok(!html.includes('usage-lifecycle-badge'));
  } finally {
    for (const [[owner, name], original] of originals) owner[name] = original;
  }
});
