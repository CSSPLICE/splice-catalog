import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import mysql from 'mysql2/promise';
import { UsageEvent } from '../../src/db/entities/UsageEvent.ts';
import { ProvisionalUsageEvent, LiveUsagePipelineLock } from '../../src/db/entities/ProvisionalUsageEvent.ts';
import { CreateProvisionalUsageEvents1794000000000 } from '../../src/db/migrations/1794000000000-CreateProvisionalUsageEvents.ts';
import { slc_item_catalog } from '../../src/db/entities/SLCItemCatalog.ts';
import { slc_tools_catalog } from '../../src/db/entities/SLCToolsCatalog.ts';
import { dataset_catalog } from '../../src/db/entities/DatasetCatalog.ts';
import { HistoricalUsage } from '../../src/db/entities/HistoricalUsage.ts';
import { SearchEvent } from '../../src/db/entities/SearchEvent.ts';

// Explicit opt-in, localhost only, fresh random schema. Never use application DB_*.
export async function optionalMysql({ phase2 = false } = {}) {
  if (process.env.LIVE_USAGE_TEST_MYSQL !== 'disposable') return null;
  const port = Number(process.env.LIVE_USAGE_TEST_MYSQL_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3306)
    throw new Error('Use a dedicated disposable MySQL port, not 3306');
  const config = {
    host: '127.0.0.1',
    port,
    user: 'root',
    password: process.env.LIVE_USAGE_TEST_MYSQL_PASSWORD || 'local-test-only',
  };
  const schema = `splice_bot_test_${randomBytes(8).toString('hex')}`;
  const admin = await mysql.createConnection(config);
  let db;
  try {
    await admin.query(`CREATE DATABASE \`${schema}\``);
    db = new DataSource({
      type: 'mysql',
      ...config,
      username: config.user,
      database: schema,
      entities: [
        UsageEvent,
        SearchEvent,
        ...(phase2 ? [slc_item_catalog, slc_tools_catalog, dataset_catalog, HistoricalUsage] : []),
      ],
      synchronize: true,
      logging: false,
    });
    await db.initialize();
    if (phase2) {
      // Baseline fixture tables were synchronized only in this fresh schema.
      // Phase 2 tables must be created by the actual production migration.
      db.setOptions({
        synchronize: false,
        entities: [...db.options.entities, ProvisionalUsageEvent, LiveUsagePipelineLock],
        migrations: [CreateProvisionalUsageEvents1794000000000],
      });
      await db.buildMetadatas();
      await db.runMigrations({ transaction: 'all' });
    }
  } catch (error) {
    if (db?.isInitialized) await db.destroy();
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.end();
    throw error;
  }
  return {
    get db() {
      return db;
    },
    schema,
    async reconnect() {
      const options = { ...db.options, synchronize: false };
      if (db.isInitialized) await db.destroy();
      db = new DataSource(options);
      await db.initialize();
    },
    async save(entity, value) {
      return db.getRepository(entity).save(db.getRepository(entity).create(value));
    },
    async counts() {
      return {
        usage: await db.getRepository(UsageEvent).count(),
        searches: await db.getRepository(SearchEvent).count(),
      };
    },
    async clear() {
      if (phase2) {
        await db.getRepository(ProvisionalUsageEvent).clear();
        await db.getRepository(LiveUsagePipelineLock).update(1, { configurationId: null });
      }
      await db.getRepository(UsageEvent).clear();
      await db.getRepository(SearchEvent).clear();
    },
    async close() {
      if (db.isInitialized) await db.destroy();
      await admin.query(`DROP DATABASE \`${schema}\``);
      await admin.end();
    },
  };
}
