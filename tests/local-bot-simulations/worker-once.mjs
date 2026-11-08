// Restart harness: a fresh Node process, new MySQL connection, same durable queue.
// This cannot target application DB_* credentials or a remote database.
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UsageEvent } from '../../src/db/entities/UsageEvent.ts';
import { SearchEvent } from '../../src/db/entities/SearchEvent.ts';
import { ProvisionalUsageEvent, LiveUsagePipelineLock } from '../../src/db/entities/ProvisionalUsageEvent.ts';
import { LiveUsageBotProtection } from '../../src/services/LiveUsageBotProtection.ts';
import { ProvisionalUsageService } from '../../src/services/ProvisionalUsageService.ts';
const port = Number(process.env.LIVE_USAGE_TEST_MYSQL_PORT),
  schema = process.env.PHASE2_TEST_SCHEMA;
if (
  process.env.LIVE_USAGE_TEST_MYSQL !== 'disposable' ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535 ||
  port === 3306 ||
  !/^splice_bot_test_[a-f0-9]{16}$/.test(schema || '')
)
  throw new Error('Disposable loopback schema required');
const db = new DataSource({
  type: 'mysql',
  host: '127.0.0.1',
  port,
  username: 'root',
  password: process.env.LIVE_USAGE_TEST_MYSQL_PASSWORD || 'local-test-only',
  database: schema,
  entities: [UsageEvent, SearchEvent, ProvisionalUsageEvent, LiveUsagePipelineLock],
  synchronize: false,
  logging: false,
});
try {
  await db.initialize();
  const service = new ProvisionalUsageService(
    db,
    process.env.PHASE2_TEST_STATE_SECRET,
    new LiveUsageBotProtection({ mode: 'enforce' }).options,
    JSON.parse(process.env.PHASE2_TEST_OPTIONS || '{}'),
    () => Number(process.env.PHASE2_TEST_NOW),
  );
  console.log(JSON.stringify({ ...(await service.tick()), ...(await service.store.summary()) }));
} finally {
  if (db.isInitialized) await db.destroy();
}
