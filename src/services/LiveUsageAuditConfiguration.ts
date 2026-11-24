import 'dotenv/config';

export interface LiveUsageAuditConfiguration {
  enabled: boolean;
  retentionDays: number;
  maxRowsPerPass: number;
}

function validateRetentionDays(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 365)
    throw new Error('LIVE_USAGE_AUDIT_RETENTION_DAYS must be an integer between 1 and 365');
  return value;
}

/** Independent of ProvisionalOptions and usageConfigurationId: retention is not
 * a detection policy and must never fence existing provisional workers. */
export function readLiveUsageAuditConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): LiveUsageAuditConfiguration {
  const enabled = env.LIVE_USAGE_AUDIT_ENABLED ?? 'false';
  if (!['true', 'false'].includes(enabled)) throw new Error('Invalid LIVE_USAGE_AUDIT_ENABLED');
  const retention = env.LIVE_USAGE_AUDIT_RETENTION_DAYS ?? '90';
  if (!/^[0-9]+$/.test(retention))
    throw new Error('LIVE_USAGE_AUDIT_RETENTION_DAYS must be an integer between 1 and 365');
  const maxRows = env.LIVE_USAGE_AUDIT_MAX_ROWS_PER_PASS ?? '20000';
  const maxRowsPerPass = Number(maxRows);
  if (!/^[0-9]+$/.test(maxRows) || maxRowsPerPass < 1 || maxRowsPerPass > 100_000)
    throw new Error('LIVE_USAGE_AUDIT_MAX_ROWS_PER_PASS must be an integer between 1 and 100000');
  return { enabled: enabled === 'true', retentionDays: validateRetentionDays(Number(retention)), maxRowsPerPass };
}

/** Eligible for future cleanup when finalizedAt <= cutoff. Recalculate with the
 * active retention for each pass so policy changes cover all retained rows.
 * Subtract fixed elapsed days (24 hours) from now, leaving finalizedAt indexed. */
export function usageAuditRetentionCutoff(now: Date, retentionDays: number): Date {
  const cutoff = new Date(now.getTime() - validateRetentionDays(retentionDays) * 86_400_000);
  if (!Number.isFinite(cutoff.getTime())) throw new Error('Invalid audit retention timestamp');
  return cutoff;
}

export const liveUsageAuditConfiguration = readLiveUsageAuditConfiguration();
