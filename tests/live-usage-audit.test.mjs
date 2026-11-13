import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppDataSource } from '../src/db/data-source.ts';
import { UsageEventAudit } from '../src/db/entities/UsageEventAudit.ts';
import { UsageAuditHistoryController } from '../src/controllers/UsageAuditHistoryController.ts';
import { CreateUsageEventAudit1794100000000 } from '../src/db/migrations/1794100000000-CreateUsageEventAudit.ts';
import {
  readLiveUsageAuditConfiguration,
  usageAuditRetentionCutoff,
} from '../src/services/LiveUsageAuditConfiguration.ts';
import { LiveUsageBotProtection } from '../src/services/LiveUsageBotProtection.ts';
import { ProvisionalUsageService } from '../src/services/ProvisionalUsageService.ts';
import { cleanupUsageEventAudit, startAuditRetentionWorker } from '../src/services/LiveUsageAuditRetention.ts';
import { setImmediate as flushAsync } from 'node:timers/promises';
import { optionalMysql } from './helpers/live-usage-mysql.mjs';

test('audit filter validation rejects ambiguous and oversized input before a database query', async (t) => {
  const repository = t.mock.method(AppDataSource, 'getRepository', () => { throw new Error('Unexpected audit query'); });
  const controller = new UsageAuditHistoryController();
  for (const query of [
    { status: ['REVIEW', 'REJECTED'] }, { q: { text: 'title' } }, { page: '0' }, { pageSize: '101' },
    { page: '102', pageSize: '100' }, { kind: 'API_SEARCH' }, { catalogType: 'invalid' },
    { period: 'custom', from: '2026-02-30', to: '2026-03-01' }, { itemPersistentID: 'x'.repeat(256) },
  ]) {
    for (const format of [undefined, 'csv', 'json']) {
      const response = {
        status(code) { this.code = code; return this; },
        json(body) { return body; },
      };
      const body = format ? await controller.export({ query }, response, format) : await controller.page({ query }, response);
      assert.equal(response.code, 400, JSON.stringify(query));
      assert.equal(typeof body.error, 'string');
    }
  }
  assert.equal(repository.mock.callCount(), 0);
});

test('retention scheduler runs daily, skips overlap, retries failures and drains on stop', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const day = 86_400_000;
  const first = Promise.withResolvers();
  const last = Promise.withResolvers();
  const failures = [];
  const successes = [];
  const warnings = [];
  const skipped = { deleted: 0, tableMissing: true, limitReached: false };
  let calls = 0;
  const stop = startAuditRetentionWorker(async () => {
    calls++;
    if (calls === 1) return first.promise;
    if (calls === 2) throw Object.assign(new Error('private query details'), { code: 'ER_LOCK_DEADLOCK' });
    return last.promise;
  }, {
    info: (...args) => successes.push(args),
    error: (...args) => failures.push(args),
    warn: (...args) => warnings.push(args),
  });
  try {
    await flushAsync();
    assert.equal(calls, 1);
    t.mock.timers.tick(day);
    await flushAsync();
    assert.equal(calls, 1);

    first.resolve(skipped);
    await flushAsync();
    assert.deepEqual(successes, []);
    assert.deepEqual(warnings, []);
    t.mock.timers.tick(day - 1);
    await flushAsync();
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    await flushAsync();
    assert.deepEqual(failures, [['Usage audit retention cleanup failed', { code: 'ER_LOCK_DEADLOCK' }]]);

    t.mock.timers.tick(day);
    await flushAsync();
    assert.equal(calls, 3);
    let stopped = false;
    const drained = stop().then(() => { stopped = true; });
    await flushAsync();
    assert.equal(stopped, false);
    last.resolve({ deleted: 1501, tableMissing: false, limitReached: true });
    await drained;
    assert.deepEqual(successes, [['Usage audit retention cleanup completed', { deleted: 1501 }]]);
    assert.deepEqual(warnings, [
      ['Usage audit retention cleanup reached its row limit. Expired rows may remain', { deleted: 1501 }],
    ]);
    t.mock.timers.tick(day);
    await flushAsync();
    assert.equal(calls, 3);
  } finally {
    first.resolve(skipped);
    last.resolve(skipped);
    await stop();
  }
});

test('audit defaults to disabled, 90 days, and 20000 rows per pass', () => {
  assert.deepEqual(readLiveUsageAuditConfiguration({}), { enabled: false, retentionDays: 90, maxRowsPerPass: 20000 });
  for (const days of [1, 90, 365])
    assert.deepEqual(
      readLiveUsageAuditConfiguration({ LIVE_USAGE_AUDIT_ENABLED: 'true', LIVE_USAGE_AUDIT_RETENTION_DAYS: String(days) }),
      { enabled: true, retentionDays: days, maxRowsPerPass: 20000 },
    );
});

test('audit pass cap accepts integer limits through 100000 and rejects malformed or out-of-range values', () => {
  for (const limit of [1, 1501, 100000]) {
    assert.equal(readLiveUsageAuditConfiguration({ LIVE_USAGE_AUDIT_MAX_ROWS_PER_PASS: String(limit) }).maxRowsPerPass, limit);
  }
  for (const limit of ['', '0', '-1', '1500.5', '1e3', '0xff', ' 1501 ', '100001', '9007199254740993', 'NaN']) {
    assert.throws(
      () => readLiveUsageAuditConfiguration({ LIVE_USAGE_AUDIT_MAX_ROWS_PER_PASS: limit }),
      /LIVE_USAGE_AUDIT_MAX_ROWS_PER_PASS must be an integer between 1 and 100000/,
    );
  }
});

test('audit cleanup requests only the remaining allowance and distinguishes an exhausted backlog', async () => {
  const config = readLiveUsageAuditConfiguration({ LIVE_USAGE_AUDIT_MAX_ROWS_PER_PASS: '1501' });
  for (const lastBatch of [500, 501]) {
    const limits = [];
    const db = {
      async query(_sql, [, limit]) {
        limits.push(limit);
        return { affectedRows: limits.length === 1 ? 1000 : lastBatch };
      },
    };
    assert.deepEqual(await cleanupUsageEventAudit(db, config), {
      deleted: 1000 + lastBatch, tableMissing: false, limitReached: lastBatch === 501,
    });
    assert.deepEqual(limits, [1000, 501]);
  }
});

test('audit configuration rejects malformed booleans and unsafe retention even when disabled', () => {
  for (const value of ['', 'TRUE', '1', 'yes', ' false '])
    assert.throws(() => readLiveUsageAuditConfiguration({ LIVE_USAGE_AUDIT_ENABLED: value }), /LIVE_USAGE_AUDIT_ENABLED/);
  for (const value of ['', '0', '-1', '1.5', '90days', 'NaN', 'Infinity', '1e2', '0x5a', ' 90 ', '366', '9007199254740993'])
    assert.throws(
      () => readLiveUsageAuditConfiguration({ LIVE_USAGE_AUDIT_RETENTION_DAYS: value }),
      /LIVE_USAGE_AUDIT_RETENTION_DAYS/,
    );
});

test('audit cutoff uses elapsed days across DST and year boundaries', () => {
  for (const timestamp of ['2026-10-31T23:59:59.123Z', '2026-12-31T23:59:59.123Z']) {
    const now = new Date(timestamp);
    for (const days of [1, 90, 365]) {
      const cutoff = usageAuditRetentionCutoff(now, days);
      assert.equal(now.getTime() - cutoff.getTime(), days * 86400000);
      assert.equal(now.toISOString(), timestamp);
    }
  }
  assert.throws(() => usageAuditRetentionCutoff(new Date('invalid'), 90), /timestamp/);
  for (const days of [0, 1.5, 366, Infinity])
    assert.throws(() => usageAuditRetentionCutoff(new Date(), days), /LIVE_USAGE_AUDIT_RETENTION_DAYS/);
});

test('current retention reclassifies existing rows, including the exact cutoff boundary', () => {
  const now = new Date('2026-11-10T12:02:00.123Z');
  const day = 86400000;
  const retained = [90 * day, 60 * day, 30 * day, 30 * day - 1, 10 * day].map((age) =>
    new Date(now.getTime() - age));
  const expired = (days) => retained.map((finalizedAt) => finalizedAt <= usageAuditRetentionCutoff(now, days));
  assert.deepEqual(expired(90), [true, false, false, false, false]);
  assert.deepEqual(expired(30), [true, true, true, false, false]);
  assert.deepEqual(expired(365), [false, false, false, false, false]);
});

test('audit settings do not alter provisional policy fingerprint or review window', () => {
  const previous = { enabled: process.env.LIVE_USAGE_AUDIT_ENABLED, retention: process.env.LIVE_USAGE_AUDIT_RETENTION_DAYS };
  try {
    const configurations = [];
    for (const [enabled, retention] of [['false', '90'], ['true', '30'], ['true', '365']]) {
      process.env.LIVE_USAGE_AUDIT_ENABLED = enabled;
      process.env.LIVE_USAGE_AUDIT_RETENTION_DAYS = retention;
      readLiveUsageAuditConfiguration();
      const service = new ProvisionalUsageService(
        {}, 'audit-fixture-secret-at-least-32-bytes', new LiveUsageBotProtection().options,
      );
      assert.equal(service.options.reviewWindowMs, 120000);
      assert.equal(Object.hasOwn(service.options, 'retentionDays'), false);
      configurations.push(service.configurationId);
    }
    assert.equal(new Set(configurations).size, 1);
  } finally {
    for (const [name, value] of [['LIVE_USAGE_AUDIT_ENABLED', previous.enabled], ['LIVE_USAGE_AUDIT_RETENTION_DAYS', previous.retention]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

const auditColumns = [
  'id', 'provisionalEventId', 'eventKey', 'sessionKey', 'networkKey', 'agentKey', 'identityKey',
  'kind', 'initialDecision', 'initialReason', 'status', 'reason', 'policyVersion',
  'sessionStartedAt', 'receivedAt', 'finalizedAt', 'officialEventId', 'catalogType', 'linkType', 'itemPersistentID', 'itemTitle',
];
const auditIndexes = [
  ['UQ_usage_audit_provisional_event', ['provisionalEventId'], true],
  ['UQ_usage_audit_event_key', ['eventKey'], true],
  ['IDX_usage_audit_received', ['receivedAt'], false],
  ['IDX_usage_audit_finalized', ['finalizedAt'], false],
  ['IDX_usage_audit_status_time', ['status', 'finalizedAt'], false],
  ['IDX_usage_audit_kind_time', ['kind', 'finalizedAt'], false],
  ['IDX_usage_audit_resource_time', ['catalogType', 'itemPersistentID', 'finalizedAt'], false],
];

test('registered audit metadata limits storage to approved fields and indexed finalized evidence', async () => {
  await AppDataSource.buildMetadatas(); // Never initializes an application connection.
  const metadata = AppDataSource.getMetadata(UsageEventAudit);
  assert.equal(metadata.tableName, 'usage_event_audit');
  assert.deepEqual(metadata.columns.map((column) => column.propertyName), auditColumns);
  assert.deepEqual(metadata.columns.filter((column) => column.isNullable).map((column) => column.propertyName),
    ['officialEventId', 'catalogType', 'linkType', 'itemPersistentID', 'itemTitle']);
  for (const name of ['itemPersistentID', 'itemTitle']) {
    const column = metadata.findColumnWithPropertyName(name);
    assert.equal(column.type, 'varchar');
    assert.equal(column.length, '255');
  }
  for (const name of ['eventKey', 'sessionKey', 'networkKey', 'agentKey', 'identityKey']) {
    const column = metadata.findColumnWithPropertyName(name);
    assert.equal(column.type, 'char');
    assert.equal(column.length, '64');
  }
  for (const name of ['sessionStartedAt', 'receivedAt', 'finalizedAt']) {
    const column = metadata.findColumnWithPropertyName(name);
    assert.equal(column.type, 'datetime');
    assert.equal(column.precision, 3);
    assert.equal(column.default, undefined);
  }
  const byName = (left, right) => left[0].localeCompare(right[0]);
  assert.deepEqual(metadata.indices.map((index) => [index.name, index.columns.map((column) => column.propertyName), index.isUnique]).sort(byName),
    [...auditIndexes].sort(byName));
  assert.equal(metadata.foreignKeys.length, 0);
  assert.equal(metadata.relations.length, 0);
  assert.equal(AppDataSource.isInitialized, false);
});

test('audit migration creates exactly one independent table and reverts only that table', async () => {
  const queries = [];
  const runner = { query: async (sql) => queries.push(sql) };
  const migration = new CreateUsageEventAudit1794100000000();
  await migration.up(runner);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^CREATE TABLE usage_event_audit \(/);
  assert.match(queries[0], /ENGINE=InnoDB$/);
  assert.doesNotMatch(queries[0], /FOREIGN KEY|REFERENCES|payload|\bquery\b|userAgent|\bip\b|cookie|token/i);
  assert.doesNotMatch(queries[0], /expiresAt|IDX_usage_audit_expiry/);
  for (const [name, columns, unique] of auditIndexes)
    assert.ok(queries[0].includes(`${unique ? 'UNIQUE INDEX' : 'INDEX'} ${name} (${columns.join(', ')})`));
  await migration.down(runner);
  assert.deepEqual(queries.slice(1), ['DROP TABLE usage_event_audit']);
});

test('audit migration matches MySQL metadata, enforces uniqueness and survives reconnect without provisional tables', {
  skip: process.env.LIVE_USAGE_TEST_MYSQL !== 'disposable' ? 'Opt in to a disposable localhost MySQL schema' : false,
}, async () => {
  const mysql = await optionalMysql();
  try {
    const db = mysql.db;
    db.setOptions({
      synchronize: false,
      entities: [...db.options.entities, UsageEventAudit],
      migrations: [CreateUsageEventAudit1794100000000],
    });
    await db.buildMetadatas();
    await db.runMigrations({ transaction: 'all' });
    assert.equal(await db.showMigrations(), false);
    const diff = await db.driver.createSchemaBuilder().log();
    assert.deepEqual(diff.upQueries, []);
    assert.deepEqual(diff.downQueries, []);
    const runner = db.createQueryRunner();
    try {
      assert.equal(await runner.hasTable('provisional_usage_events'), false);
      const table = await runner.getTable('usage_event_audit');
      assert.deepEqual(table.columns.map((column) => column.name).sort(), [...auditColumns].sort());
      assert.equal(table.foreignKeys.length, 0);
    } finally {
      await runner.release();
    }
    const finalizedAt = new Date('2026-11-10T12:02:00.123Z');
    const row = {
      provisionalEventId: 123, eventKey: 'a'.repeat(64), sessionKey: 'b'.repeat(64), networkKey: 'c'.repeat(64),
      agentKey: 'd'.repeat(64), identityKey: 'e'.repeat(64), kind: 'WEB_SEARCH', initialDecision: 'ACCEPT',
      initialReason: 'ELIGIBLE_BROWSER_EVENT', status: 'ACCEPTED', reason: 'REVIEW_WINDOW_ELIGIBLE',
      policyVersion: 'phase2.1-v1', sessionStartedAt: new Date('2026-11-10T11:59:00Z'),
      receivedAt: new Date('2026-11-10T12:00:00.123Z'), finalizedAt,
      officialEventId: null, catalogType: 'SLC_ITEM', linkType: null, itemPersistentID: null, itemTitle: null,
    };
    const repository = db.getRepository(UsageEventAudit);
    // TypeORM adds the generated ID to insert inputs; keep the reusable fixture pristine.
    await repository.insert({ ...row });
    await assert.rejects(repository.insert({ ...row, eventKey: 'f'.repeat(64) }),
      (error) => error.code === 'ER_DUP_ENTRY' && error.message.includes('UQ_usage_audit_provisional_event'));
    await assert.rejects(repository.insert({ ...row, provisionalEventId: 124 }),
      (error) => error.code === 'ER_DUP_ENTRY' && error.message.includes('UQ_usage_audit_event_key'));
    await mysql.reconnect();
    const stored = await mysql.db.getRepository(UsageEventAudit).findOneByOrFail({ provisionalEventId: 123 });
    assert.equal(stored.finalizedAt.getTime(), finalizedAt.getTime());
    assert.equal(stored.itemPersistentID, null);
    assert.equal(stored.itemTitle, null);
    assert.equal(stored.linkType, null);
    const auditRepository = mysql.db.getRepository(UsageEventAudit);
    const now = new Date('2027-01-09T12:02:00.123Z'); // Original row is 60 days old.
    for (const [offset, kind, catalogType, itemPersistentID, title, age] of [
      [1, 'ENTRY_CLICK', 'SLC_ITEM', 'urn:catalog:7', 'Title snapshot'.padEnd(255, '.'), 45],
      [2, 'EXTERNAL_CLICK', 'TOOL', '7', 'Tool snapshot', 10],
      [3, 'ENTRY_CLICK', 'DATASET', '7', 'Dataset snapshot', 91],
    ]) {
      const clickFinalizedAt = new Date(now.getTime() - age * 86400000);
      await auditRepository.insert({
        ...row, provisionalEventId: 123 + offset, eventKey: String(offset).repeat(64),
        kind, catalogType, itemPersistentID, itemTitle: title,
        linkType: kind === 'EXTERNAL_CLICK' ? 'tool_url' : null,
        sessionStartedAt: new Date(clickFinalizedAt.getTime() - 180000),
        receivedAt: new Date(clickFinalizedAt.getTime() - 120000), finalizedAt: clickFinalizedAt,
      });
    }
    const clicks = await auditRepository.find({ order: { provisionalEventId: 'ASC' } });
    assert.equal(clicks[1].itemTitle.length, 255);
    assert.equal(clicks[1].itemPersistentID, 'urn:catalog:7');
    assert.equal(clicks[2].linkType, 'tool_url');
    await assert.rejects(auditRepository.insert({
      ...row, provisionalEventId: 127, eventKey: 'f'.repeat(64), kind: 'ENTRY_CLICK',
      itemPersistentID: 'urn:catalog:7', itemTitle: 'x'.repeat(256),
    }), { code: 'ER_DATA_TOO_LONG' });
    const resource = await auditRepository.createQueryBuilder('event')
      .where('event.catalogType = :catalogType AND event.itemPersistentID = :itemPersistentID',
        { catalogType: 'TOOL', itemPersistentID: '7' })
      .andWhere('event.finalizedAt > :cutoff', { cutoff: usageAuditRetentionCutoff(now, 30) })
      .getMany();
    assert.deepEqual(resource.map((event) => event.provisionalEventId), [125]);
    const eligible = async (retentionDays) => (await auditRepository.createQueryBuilder('event')
      .where('event.finalizedAt <= :cutoff', { cutoff: usageAuditRetentionCutoff(now, retentionDays) })
      .orderBy('event.provisionalEventId', 'ASC').getMany()).map((event) => event.provisionalEventId);
    assert.deepEqual(await eligible(90), [126]);
    assert.deepEqual(await eligible(30), [123, 124, 126]);
    assert.deepEqual(await eligible(365), []);
    assert.equal(await auditRepository.count(), 4); // Policy changes require no row rewrites or cleanup here.
    assert.deepEqual(await mysql.counts(), { usage: 0, searches: 0 });
    await mysql.db.undoLastMigration({ transaction: 'all' });
    const rollbackRunner = mysql.db.createQueryRunner();
    try {
      assert.equal(await rollbackRunner.hasTable('usage_event_audit'), false);
      assert.equal(await rollbackRunner.hasTable('usage_events'), true);
      assert.equal(await rollbackRunner.hasTable('search_events'), true);
    } finally {
      await rollbackRunner.release();
    }
  } finally {
    await mysql.close();
  }
});
