import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadImportFile, validateAgainstProduction, compareWithExisting, seedHistoricalUsage, parseSeedOptions, assertSeedTarget } from '../src/scripts/seedHistoricalUsage.ts';

function fixture() {
  return {
    version: 1, generatedAt: '2026-10-23T12:00:00Z', source: 'nginx_historical',
    filterPolicy: {
      description: 'Successful page requests after bot filtering and the 63-entry cutoff.', knownBotIndicators: ['bot'],
      highVolumeClient: { minimumUniqueCatalogEntries: 63, identity: 'IP address + User-Agent', order: 'after known-bot filtering', excludeAllRequests: true },
    },
    summary: { successfulCatalogRequests: 5, filteredBotRequests: 0, postBotRequests: 5, filteredHighVolumeClients: 0, filteredHighVolumeRequests: 0, includedRequests: 5, uniqueIncludedItems: 2, totalIncludedViews: 5, productionApiItemCount: 2 },
    items: [101, 102].map((legacyId, index) => ({ catalogType: 'SLC_ITEM', legacyId, persistentID: `fixture:${legacyId}`, title: `Entry ${index}`, catalogPath: `/catalog/item/${legacyId}`, viewCount: index + 2 })),
  };
}
const production = (data) => new Map(data.items.map(item => [item.legacyId, { id: item.legacyId, persistentID: item.persistentID, title: item.title, platform_name: 'Fixture' }]));
const stored = (data) => data.items.map(item => ({ source: data.source, catalogType: item.catalogType, legacyCatalogId: item.legacyId, itemPersistentID: item.persistentID, itemTitle: item.title, catalogPath: item.catalogPath, viewCount: item.viewCount }));

// Transactional test double: writes stay staged until commit and disappear on rollback.
function database(initial = [], failUpsert = false) {
  const state = { rows: structuredClone(initial), initializations: 0, upserts: 0, commits: 0, rollbacks: 0, runners: 0, destroys: 0 };
  let staged;
  const repository = {
    async find(options) {
      assert.deepEqual(options.where, { source: 'nginx_historical', catalogType: 'SLC_ITEM' });
      return structuredClone(staged ?? state.rows);
    },
    async upsert(rows, conflictPaths) {
      state.upserts++;
      assert.deepEqual(conflictPaths, ['source', 'catalogType', 'legacyCatalogId']);
      for (const row of rows) {
        const index = staged.findIndex(existing => existing.legacyCatalogId === row.legacyCatalogId);
        if (index < 0) staged.push(structuredClone(row)); else staged[index] = structuredClone(row);
        if (failUpsert) throw new Error('simulated database failure');
      }
    },
  };
  const source = {
    options: { synchronize: false, migrationsRun: false },
    async initialize() { state.initializations++; },
    async destroy() { state.destroys++; },
    getRepository() { return repository; },
    createQueryRunner() {
      state.runners++;
      return {
        isReleased: false, isTransactionActive: false, manager: { getRepository: () => repository },
        async connect() {},
        async startTransaction() { this.isTransactionActive = true; staged = structuredClone(state.rows); },
        async commitTransaction() { state.rows = staged; staged = undefined; this.isTransactionActive = false; state.commits++; },
        async rollbackTransaction() { staged = undefined; this.isTransactionActive = false; state.rollbacks++; },
        async release() { this.isReleased = true; },
      };
    },
  };
  return { state, source };
}

async function withFile(data, action) {
  const folder = await mkdtemp(join(tmpdir(), 'splice-history-test-'));
  try { const path = join(folder, 'import.json'); await writeFile(path, JSON.stringify(data)); return await action(path); }
  finally { await rm(folder, { recursive: true, force: true }); }
}

test('approved import loads with matching sums and production identities', async () => {
  const data = fixture();
  await withFile(data, async path => {
    const loaded = await loadImportFile(path);
    const validation = validateAgainstProduction(loaded, production(data));
    assert.equal(validation.rows.length, 2);
    assert.deepEqual(validation.missingIds, []);
    assert.deepEqual(validation.identityMismatches, []);
  });
});

test('invalid import counts, entries, duplicates and unapproved policies are rejected', async t => {
  const cases = [
    ['summary sum', data => { data.summary.totalIncludedViews++; }],
    ['filter reconciliation', data => { data.summary.filteredHighVolumeRequests = 1; }],
    ['negative count', data => { data.items[0].viewCount = -1; }],
    ['unsafe count', data => { data.items[0].viewCount = Number.MAX_SAFE_INTEGER; }],
    ['duplicate numeric ID', data => { data.items[1] = { ...data.items[0] }; }],
    ['duplicate persistent ID', data => { data.items[1].persistentID = data.items[0].persistentID; }],
    ['wrong route', data => { data.items[0].catalogPath = '/catalog/item/999'; }],
    ['wrong cutoff', data => { data.filterPolicy.highVolumeClient.minimumUniqueCatalogEntries = 62; }],
    ['wrong identity definition', data => { data.filterPolicy.highVolumeClient.identity = 'IP only'; }],
    ['wrong filtering order', data => { data.filterPolicy.highVolumeClient.order = 'before bots'; }],
    ['old bot-only import', data => { delete data.filterPolicy.highVolumeClient; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const data = fixture(); mutate(data);
    await withFile(data, path => assert.rejects(loadImportFile(path)));
  });
});

test('target safeguards require exact confirmation and explicit production approval', () => {
  const target = { host: 'db', port: 3306, database: 'fixture' };
  const dry = parseSeedOptions(['fixture.json', '--dry-run']);
  assert.equal(assertSeedTarget(target, dry, 'production'), 'db:3306/fixture');
  const write = parseSeedOptions(['fixture.json', '--confirm-target=db:3306/fixture']);
  assert.equal(assertSeedTarget(target, write, 'development'), 'db:3306/fixture');
  assert.throws(() => assertSeedTarget(target, { ...write, confirmTarget: undefined }, 'development'), /confirm-target/);
  assert.throws(() => assertSeedTarget(target, { ...write, confirmTarget: 'db:3306/other' }, 'development'), /does not match/);
  assert.throws(() => assertSeedTarget(target, write, 'production'), /approve-production/);
  assert.equal(assertSeedTarget(target, { ...write, approveProduction: true }, 'production'), 'db:3306/fixture');
  assert.throws(() => assertSeedTarget({ ...target, host: 'remote.example.invalid' }, { ...write, confirmTarget: 'remote.example.invalid:3306/fixture' }, 'development'), /approve-production/);
  assert.throws(() => assertSeedTarget({ ...target, migrationsRun: true }, dry, 'development'), /migrations/);
  assert.throws(() => assertSeedTarget({ ...target, synchronize: true }, dry, 'development'), /synchronize/);
  assert.throws(() => parseSeedOptions(['fixture.json', '--allow-identity-mismatch']), /Unsupported option/);
  assert.throws(() => parseSeedOptions(['fixture.json', '--unknown']), /Unsupported option/);
});

test('missing or mismatched production identity fails before any database access', async () => {
  const data = fixture();
  for (const missing of [true, false]) {
    const catalog = production(data);
    if (missing) catalog.delete(101); else catalog.get(101).persistentID = 'fixture:changed';
    const { source, state } = database();
    await assert.rejects(seedHistoricalUsage(data, catalog, false, source), /before database initialization/);
    assert.equal(state.initializations, 0); assert.equal(state.upserts, 0); assert.equal(state.commits, 0);
  }
});

test('dry run performs zero writes and does not create a transaction', async () => {
  const data = fixture(); const { source, state } = database();
  await seedHistoricalUsage(data, production(data), true, source);
  assert.deepEqual(state.rows, []); assert.equal(state.upserts, 0); assert.equal(state.runners, 0); assert.equal(state.destroys, 1);
});

test('same import is idempotent and changed counts replace rather than add', async () => {
  const data = fixture(); const { source, state } = database();
  await seedHistoricalUsage(data, production(data), false, source);
  assert.deepEqual(state.rows, stored(data)); assert.equal(state.upserts, 1);
  await seedHistoricalUsage(data, production(data), false, source);
  assert.equal(state.upserts, 1); assert.equal(state.rows.reduce((sum, row) => sum + row.viewCount, 0), 5);
  const comparison = compareWithExisting(stored(data), state.rows);
  assert.equal(comparison.unchangedRows, 2); assert.equal(comparison.totalHistoricalViewsAfterImport, 5);
  state.rows[0].viewCount = 20;
  await seedHistoricalUsage(data, production(data), false, source);
  assert.equal(state.rows.reduce((sum, row) => sum + row.viewCount, 0), 5);
});

test('stale rows and existing identity conflicts are refused without partial changes', async () => {
  const data = fixture();
  for (const stale of [true, false]) for (const dryRun of [true, false]) {
    const initial = stored(data);
    if (stale) initial.push({ ...initial[0], legacyCatalogId: 999 }); else initial[0].itemPersistentID = 'fixture:other';
    const { source, state } = database(initial);
    await assert.rejects(seedHistoricalUsage(data, production(data), dryRun, source), /transactional replacement/);
    assert.deepEqual(state.rows, initial); assert.equal(state.upserts, 0); assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, dryRun ? 0 : 1);
  }
});

test('database write failure rolls back all staged rows', async () => {
  const data = fixture(); const { source, state } = database([], true);
  await assert.rejects(seedHistoricalUsage(data, production(data), false, source), /simulated database failure/);
  assert.deepEqual(state.rows, []); assert.equal(state.rollbacks, 1); assert.equal(state.commits, 0); assert.equal(state.destroys, 1);
});
