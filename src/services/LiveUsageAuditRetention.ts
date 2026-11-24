import type { DataSource } from 'typeorm';
import {
  liveUsageAuditConfiguration,
  usageAuditRetentionCutoff,
  type LiveUsageAuditConfiguration,
} from './LiveUsageAuditConfiguration.js';

const batchSize = 1_000;
const cleanupIntervalMs = 24 * 60 * 60 * 1_000;

function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return;
  const { code } = error;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) return code;
}

export async function cleanupUsageEventAudit(
  db: DataSource,
  configuration: LiveUsageAuditConfiguration = liveUsageAuditConfiguration,
  now = new Date(),
): Promise<{ deleted: number; tableMissing: boolean; limitReached: boolean }> {
  const cutoff = usageAuditRetentionCutoff(now, configuration.retentionDays);
  const { maxRowsPerPass } = configuration;
  let deleted = 0;
  while (deleted < maxRowsPerPass) {
    const limit = Math.min(batchSize, maxRowsPerPass - deleted);
    try {
      // A single autocommitted statement per batch keeps selection and deletion atomic.
      // InnoDB stores the primary key in the finalizedAt index for ties.
      const result: { affectedRows: number } = await db.query(
        'DELETE FROM usage_event_audit WHERE finalizedAt <= ? ORDER BY finalizedAt, id LIMIT ?',
        [cutoff, limit],
      );
      deleted += result.affectedRows;
      if (result.affectedRows < limit) break;
    } catch (error) {
      if (!configuration.enabled && databaseErrorCode(error) === 'ER_NO_SUCH_TABLE') {
        return { deleted, tableMissing: true, limitReached: false };
      }
      throw error;
    }
  }
  return { deleted, tableMissing: false, limitReached: deleted === maxRowsPerPass };
}

export function startAuditRetentionWorker(
  cleanup: () => ReturnType<typeof cleanupUsageEventAudit>,
  logger: Pick<Console, 'info' | 'warn' | 'error'>,
): () => Promise<void> {
  let active: Promise<void> | undefined;
  const run = () => {
    if (active) return;
    active = Promise.resolve().then(async () => {
      try {
        const result = await cleanup();
        if (!result.tableMissing) logger.info('Usage audit retention cleanup completed', { deleted: result.deleted });
        if (result.limitReached) {
          logger.warn('Usage audit retention cleanup reached its row limit. Expired rows may remain', {
            deleted: result.deleted,
          });
        }
      } catch (error) {
        logger.error('Usage audit retention cleanup failed', { code: databaseErrorCode(error) ?? 'UNKNOWN' });
      }
    }).finally(() => {
      active = undefined;
    });
  };
  const timer = setInterval(run, cleanupIntervalMs);
  timer.unref();
  run();
  return async () => {
    clearInterval(timer);
    await active;
  };
}
