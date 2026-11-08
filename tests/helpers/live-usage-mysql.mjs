import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import mysql from 'mysql2/promise';
import { UsageEvent } from '../../src/db/entities/UsageEvent.ts';
import { SearchEvent } from '../../src/db/entities/SearchEvent.ts';

// Explicit opt-in, localhost only, fresh random schema. Never use application DB_*.
export async function optionalMysql() {
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
      entities: [UsageEvent, SearchEvent],
      synchronize: true,
      logging: false,
    });
    await db.initialize();
  } catch (error) {
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.end();
    throw error;
  }
  return {
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
      await db.getRepository(UsageEvent).clear();
      await db.getRepository(SearchEvent).clear();
    },
    async close() {
      await db.destroy();
      await admin.query(`DROP DATABASE \`${schema}\``);
      await admin.end();
    },
  };
}
