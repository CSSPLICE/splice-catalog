import 'dotenv/config';
import { createHash, createHmac } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AppDataSource } from '../db/data-source.js';
import {
  ProvisionalUsageEvent,
  LiveUsagePipelineLock,
  BrowserUsagePayload,
  BrowserEventKind,
  ProvisionalStatus,
} from '../db/entities/ProvisionalUsageEvent.js';
import { UsageEvent } from '../db/entities/UsageEvent.js';
import { SearchEvent } from '../db/entities/SearchEvent.js';
import { UsageEventAudit, UsageAuditStatus } from '../db/entities/UsageEventAudit.js';
import { liveUsageAuditConfiguration, LiveUsageAuditConfiguration } from './LiveUsageAuditConfiguration.js';
import {
  Decision,
  ProtectionOptions,
  CoordinationPolicy,
  evaluateProvisionalEvent,
  liveUsageBotProtection,
  LiveUsageBotProtection,
} from './LiveUsageBotProtection.js';

export interface ProvisionalOptions extends CoordinationPolicy {
  reviewWindowMs: number;
  deadlineMs: number;
  retentionMs: number;
  pollMs: number;
  batchSize: number;
  maxRows: number;
  maxEvidence: number;
}
export const provisionalDefaults: ProvisionalOptions = {
  reviewWindowMs: 120_000,
  deadlineMs: 900_000,
  retentionMs: 3_600_000,
  pollMs: 1000,
  batchSize: 100,
  maxRows: 100_000,
  maxEvidence: 5000,
  coordinatedSessions: 4,
  sequenceLength: 5,
  synchronyMs: 750,
  freshSessionMs: 30_000,
};
// A versioned fingerprint fences code-only evaluator changes as well as settings.
export const currentUsagePolicy = 'phase2.1-v1';
// Exact reasons only: retrospective REVIEW evidence remains useful even when
// another event in the session was known automation. Never remove provisional evidence.
const excludedAuditReasons = new Set([
  'KNOWN_AUTOMATION',
  'ORIGIN_INVALID',
  'SESSION_MISSING',
  'SESSION_INVALID',
  'SESSION_EXPIRED',
  'TOKEN_INVALID',
  'EVENT_ID_INVALID',
  'CREDENTIAL_CONTEXT_UNAVAILABLE',
]);
export interface UsagePolicyConfiguration {
  policy: string;
  options: ProvisionalOptions;
  thresholds: ProtectionOptions;
}
export function usageConfigurationId(secret: string, configuration: UsagePolicyConfiguration): string {
  if (!/^[a-z0-9.-]{1,24}$/.test(configuration.policy)) throw new Error('Invalid usage policy identifier');
  // Preserve the exact legacy fingerprint, including property order, for draining v1.
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        policy: configuration.policy,
        secret,
        options: configuration.options,
        thresholds: configuration.thresholds,
      }),
    )
    .digest('hex');
  return configuration.policy === 'phase2-v1'
    ? digest
    : `${configuration.policy}:${digest.slice(0, 63 - configuration.policy.length)}`;
}

export interface ProvisionalSubmission {
  sessionId: string;
  sessionStartedAt: number;
  ip: string;
  userAgent: string;
  eventId: string;
  kind: BrowserEventKind;
  identity: string;
  decision: Decision;
  payload: BrowserUsagePayload | null;
}
export interface StageResult {
  counted: false;
  status: ProvisionalStatus;
  decision: 'ACCEPT' | 'REVIEW' | 'REJECT';
  reason: string;
  duplicate: boolean;
}
export interface ProvisionalUsageStore {
  stage(
    row: Partial<ProvisionalUsageEvent>,
    replayOnly: boolean,
  ): Promise<{ row: ProvisionalUsageEvent; duplicate: boolean }>;
  finalizeDue(now: Date): Promise<number>;
  cleanup(now: Date): Promise<number>;
  summary(): Promise<{ pending: number; classifications: Record<string, number> }>;
}

/** All state transitions use the same InnoDB lock. This trades throughput for a
 * small, correct local implementation with atomic capacity/replay/finalization. */
export class MySqlProvisionalUsageStore implements ProvisionalUsageStore {
  constructor(
    private db: DataSource,
    private options: ProvisionalOptions,
    private thresholds: ProtectionOptions,
    readonly configurationId: string,
    private auditConfiguration: Pick<LiveUsageAuditConfiguration, 'enabled'> = liveUsageAuditConfiguration,
  ) {}

  get dataSource() {
    return this.db;
  }

  private async locked<T>(work: (manager: EntityManager) => Promise<T>, expected = this.configurationId): Promise<T> {
    return this.db.transaction(async (manager) => {
      const repository = manager.getRepository(LiveUsagePipelineLock);
      const lock = await repository.findOne({ where: { id: 1 }, lock: { mode: 'pessimistic_write' } });
      if (!lock) throw new Error('PROVISIONAL_MIGRATION_REQUIRED');
      if (lock.configurationId && lock.configurationId !== expected)
        throw new Error('PROVISIONAL_CONFIGURATION_MISMATCH');
      if (!lock.configurationId) {
        if (expected !== this.configurationId || (await manager.getRepository(ProvisionalUsageEvent).count()))
          throw new Error('PROVISIONAL_POLICY_UNINITIALIZED');
        await repository.update(1, { configurationId: this.configurationId });
      }
      return work(manager);
    });
  }

  private async auditFinalized(manager: EntityManager, row: ProvisionalUsageEvent): Promise<void> {
    if (
      !this.auditConfiguration.enabled ||
      row.status === 'PENDING' ||
      excludedAuditReasons.has(row.initialReason) ||
      excludedAuditReasons.has(row.reason)
    )
      return;
    if (!row.finalizedAt) throw new Error('PROVISIONAL_FINALIZATION_REQUIRED');
    // Only the canonical payload staged by the server can supply display fields.
    // Read it before redaction; never spread it into the audit insert (it may contain a query).
    const payload = row.payload?.kind === row.kind ? row.payload : null;
    const click = payload && payload.kind !== 'WEB_SEARCH' ? payload : null;
    await manager.getRepository(UsageEventAudit).insert({
      provisionalEventId: row.id,
      eventKey: row.eventKey,
      sessionKey: row.sessionKey,
      networkKey: row.networkKey,
      agentKey: row.agentKey,
      identityKey: row.identityKey,
      kind: row.kind,
      initialDecision: row.initialDecision,
      initialReason: row.initialReason,
      status: row.status,
      reason: row.reason,
      policyVersion: currentUsagePolicy,
      sessionStartedAt: row.sessionStartedAt,
      receivedAt: row.receivedAt,
      finalizedAt: row.finalizedAt,
      officialEventId: row.officialEventId,
      catalogType: payload?.catalogType ?? null,
      linkType: click?.kind === 'EXTERNAL_CLICK' ? click.linkType ?? null : null,
      itemPersistentID: click?.itemPersistentID ?? null,
      itemTitle: click ? Array.from(click.itemTitle).slice(0, 255).join('') : null,
    });
  }

  async assertConfiguration(): Promise<void> {
    await this.locked(async () => {});
  }

  async policyStatus() {
    const lock = await this.db.getRepository(LiveUsagePipelineLock).findOneBy({ id: 1 });
    if (!lock) throw new Error('PROVISIONAL_MIGRATION_REQUIRED');
    return {
      active: lock.configurationId,
      desired: this.configurationId,
      pending: await this.db.getRepository(ProvisionalUsageEvent).countBy({ status: 'PENDING' }),
    };
  }

  // Explicit operator action only. The shared lock serializes the pending check,
  // switch, admissions and finalizers. Old workers are fenced after commit.
  async transitionPolicy(expected: string) {
    return this.locked(async (manager) => {
      if (await manager.getRepository(ProvisionalUsageEvent).countBy({ status: 'PENDING' }))
        throw new Error('PROVISIONAL_POLICY_DRAIN_REQUIRED');
      await manager.getRepository(LiveUsagePipelineLock).update(1, { configurationId: this.configurationId });
      return { from: expected, to: this.configurationId };
    }, expected);
  }

  stage(data: Partial<ProvisionalUsageEvent>, replayOnly: boolean) {
    return this.locked(async (manager) => {
      const repository = manager.getRepository(ProvisionalUsageEvent);
      const existing = await repository.findOneBy({ eventKey: data.eventKey });
      if (existing) return { row: existing, duplicate: true };
      if (replayOnly) throw new Error('PROVISIONAL_REPLAY_NOT_STORED');
      if ((await repository.count()) >= this.options.maxRows) throw new Error('PROVISIONAL_CAPACITY');
      const row = await repository.save(repository.create(data));
      await this.auditFinalized(manager, row);
      return { row, duplicate: false };
    });
  }

  async finalizeDue(now: Date): Promise<number> {
    // Check even an empty queue: configuration errors must remain visible.
    await this.assertConfiguration();
    // Short transactions per row keep browser admissions from waiting for a batch.
    const candidates = await this.db
      .getRepository(ProvisionalUsageEvent)
      .createQueryBuilder('event')
      .where('event.status = :status AND event.reviewAfter <= :now', { status: 'PENDING', now })
      .orderBy('event.reviewAfter', 'ASC')
      .addOrderBy('event.id', 'ASC')
      .limit(this.options.batchSize)
      .getMany();
    let finalized = 0;
    for (const candidate of candidates) {
      finalized += await this.locked(async (manager) => {
        const repository = manager.getRepository(ProvisionalUsageEvent);
        const row = await repository.findOneBy({ id: candidate.id });
        if (!row) return 0; // A concurrent retention pass may have removed it.
        if (row.status !== 'PENDING' || row.reviewAfter > now) return 0;
        let decision: Decision;
        if (row.deadlineAt <= now) decision = { decision: 'REVIEW', reason: 'PENDING_EXPIRED' };
        else {
          // Session protections must not be crowded out by an unrelated cohort.
          const session = await repository
            .createQueryBuilder('event')
            .where('event.sessionKey = :session', { session: row.sessionKey })
            .andWhere('event.receivedAt >= :start AND event.receivedAt <= :end', {
              start: new Date(row.receivedAt.getTime() - this.thresholds.windowMs),
              end: row.reviewAfter,
            })
            .orderBy('event.receivedAt', 'ASC')
            .addOrderBy('event.id', 'ASC')
            .limit(this.options.maxEvidence + 1)
            .getMany();
          if (session.length > this.options.maxEvidence) {
            decision = { decision: 'REVIEW', reason: 'SESSION_EVIDENCE_CAPACITY' };
          } else {
            const cohort =
              row.kind === 'ENTRY_CLICK'
                ? await repository
                    .createQueryBuilder('event')
                    .where('event.networkKey = :network AND event.agentKey = :agent', {
                      network: row.networkKey,
                      agent: row.agentKey,
                    })
                    .andWhere('event.receivedAt >= :start AND event.receivedAt <= :end', {
                      start: new Date(row.receivedAt.getTime() - this.thresholds.windowMs),
                      end: row.reviewAfter,
                    })
                    .orderBy('event.receivedAt', 'ASC')
                    .addOrderBy('event.id', 'ASC')
                    .limit(this.options.maxEvidence + 1)
                    .getMany()
                : [];
            // A saturated optional observation query cannot exclude a bystander.
            const evidence =
              cohort.length > this.options.maxEvidence
                ? session
                : [...new Map([...cohort, ...session].map((item) => [item.id, item])).values()];
            decision = evaluateProvisionalEvent(row, evidence, this.thresholds, this.options);
            if (cohort.length > this.options.maxEvidence && decision.decision === 'ACCEPT')
              decision.reason = 'COORDINATION_CAPACITY_UNOBSERVED';
          }
        }
        let officialEventId: number | null = null;
        if (decision.decision === 'ACCEPT') {
          if (!row.payload) throw new Error('PROVISIONAL_PAYLOAD_MISSING');
          if (row.payload.kind === 'WEB_SEARCH') {
            const official = await manager.getRepository(SearchEvent).save({
              source: 'WEB',
              query: row.payload.query,
              catalogType: row.payload.catalogType,
              resultCount: null,
              createdAt: row.receivedAt,
            });
            officialEventId = official.id;
          } else {
            const { kind, ...payload } = row.payload;
            const official = await manager
              .getRepository(UsageEvent)
              .save({ ...payload, eventType: kind, createdAt: row.receivedAt });
            officialEventId = official.id;
          }
        }
        const status: UsageAuditStatus =
          decision.reason === 'PENDING_EXPIRED'
            ? 'EXPIRED'
            : decision.decision === 'ACCEPT'
              ? 'ACCEPTED'
              : decision.decision === 'REJECT'
                ? 'REJECTED'
                : 'REVIEW';
        await this.auditFinalized(manager, { ...row, status, reason: decision.reason, finalizedAt: now, officialEventId });
        await repository.update(row.id, {
          status,
          reason: decision.reason,
          payload: null,
          finalizedAt: now,
          officialEventId,
        });
        return 1;
      });
    }
    return finalized;
  }

  cleanup(now: Date): Promise<number> {
    return this.locked(async (manager) => {
      const repository = manager.getRepository(ProvisionalUsageEvent);
      // Expired pending events must be terminal/redacted before evidence deletion.
      const overdue = await repository
        .createQueryBuilder('event')
        .where('event.status = :status AND event.deadlineAt <= :now', { status: 'PENDING', now })
        .orderBy('event.id')
        .limit(this.options.batchSize)
        .getMany();
      if (overdue.length) {
        for (const row of overdue) {
          await this.auditFinalized(manager, { ...row, status: 'EXPIRED', reason: 'PENDING_EXPIRED', finalizedAt: now });
        }
        await repository.update(
          overdue.map((row) => row.id),
          { status: 'EXPIRED', reason: 'PENDING_EXPIRED', payload: null, finalizedAt: now },
        );
      }
      const expired = await repository
        .createQueryBuilder('event')
        .where('event.purgeAfter <= :now AND event.status != :pending', { now, pending: 'PENDING' })
        .orderBy('event.id')
        .limit(this.options.batchSize)
        .getMany();
      if (!expired.length) return 0;
      const result = await repository.delete(expired.map((row) => row.id));
      return result.affected || 0;
    });
  }

  async summary() {
    const rows = await this.db
      .getRepository(ProvisionalUsageEvent)
      .createQueryBuilder('event')
      .select('event.status', 'status')
      .addSelect('event.reason', 'reason')
      .addSelect('COUNT(*)', 'count')
      .groupBy('event.status')
      .addGroupBy('event.reason')
      .getRawMany();
    const classifications: Record<string, number> = {};
    let pending = 0;
    for (const row of rows) {
      classifications[`${row.status}:${row.reason}`] = Number(row.count);
      if (row.status === 'PENDING') pending += Number(row.count);
    }
    return { pending, classifications };
  }
}

export class ProvisionalUsageService {
  readonly options: ProvisionalOptions;
  readonly store: ProvisionalUsageStore;
  readonly configuration: UsagePolicyConfiguration;
  readonly configurationId: string;
  private secret: string;
  constructor(
    db: DataSource,
    secret: string,
    thresholds: ProtectionOptions,
    options: Partial<ProvisionalOptions> = {},
    private now: () => number = Date.now,
    store?: ProvisionalUsageStore,
    auditConfiguration: Pick<LiveUsageAuditConfiguration, 'enabled'> = liveUsageAuditConfiguration,
  ) {
    if (Buffer.byteLength(secret) < 32) throw new Error('LIVE_USAGE_STATE_SECRET must contain at least 32 bytes');
    this.options = { ...provisionalDefaults, ...options };
    if (
      Object.values(this.options).some((value) => !Number.isSafeInteger(value) || value < 1) ||
      this.options.deadlineMs <= this.options.reviewWindowMs ||
      this.options.retentionMs <= this.options.deadlineMs + thresholds.windowMs ||
      this.options.retentionMs < thresholds.sessionTtlMs ||
      this.options.coordinatedSessions < 2 ||
      this.options.sequenceLength < 3
    )
      throw new Error('Invalid provisional configuration');
    this.secret = secret;
    this.configuration = { policy: currentUsagePolicy, options: this.options, thresholds };
    this.configurationId = usageConfigurationId(secret, this.configuration);
    this.key = (domain, value) => createHmac('sha256', secret).update(`${domain}\0${value}`).digest('hex');
    this.store = store || new MySqlProvisionalUsageStore(db, this.options, thresholds, this.configurationId, auditConfiguration);
  }
  private key: (domain: string, value: string) => string;

  async transitionPolicy(from: UsagePolicyConfiguration, target: UsagePolicyConfiguration = this.configuration) {
    if (!(this.store instanceof MySqlProvisionalUsageStore)) throw new Error('MySQL store required');
    // Compute predecessor with the SAME secret: rotation cannot bypass tombstones.
    if (from.thresholds.sessionTtlMs !== target.thresholds.sessionTtlMs)
      throw new Error('PROVISIONAL_CREDENTIAL_POLICY_CHANGE_UNSUPPORTED');
    if (![currentUsagePolicy, 'phase2-v1'].includes(target.policy))
      throw new Error('PROVISIONAL_TARGET_POLICY_UNSUPPORTED');
    // Validate target settings without connecting or touching any event rows.
    new LiveUsageBotProtection(target.thresholds);
    new ProvisionalUsageService({} as DataSource, this.secret, target.thresholds, target.options);
    const targetStore = new MySqlProvisionalUsageStore(
      this.store.dataSource,
      target.options,
      target.thresholds,
      usageConfigurationId(this.secret, target),
    );
    return targetStore.transitionPolicy(usageConfigurationId(this.secret, from));
  }

  async stage(input: ProvisionalSubmission): Promise<StageResult> {
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(input.eventId)) throw new Error('PROVISIONAL_EVENT_ID_INVALID');
    const now = this.now();
    const initial = input.decision;
    const status: ProvisionalStatus =
      initial.decision === 'ACCEPT' ? 'PENDING' : initial.decision === 'REJECT' ? 'REJECTED' : 'REVIEW';
    if (status === 'PENDING' && (!input.payload || input.payload.kind !== input.kind))
      throw new Error('PROVISIONAL_PAYLOAD_INVALID');
    const { row, duplicate } = await this.store.stage(
      {
        eventKey: this.key('event', `${input.sessionId}:${input.eventId}`),
        sessionKey: this.key('session', input.sessionId),
        networkKey: this.key('network', input.ip.replace(/^::ffff:/, '')),
        agentKey: this.key('agent', input.userAgent),
        identityKey: this.key('identity', `${input.kind}:${input.identity}`),
        kind: input.kind,
        initialDecision: initial.decision,
        initialReason: initial.reason,
        status,
        reason: status === 'PENDING' ? 'PROVISIONAL_PENDING' : initial.reason,
        payload: status === 'PENDING' ? input.payload : null,
        sessionStartedAt: new Date(input.sessionStartedAt),
        receivedAt: new Date(now),
        reviewAfter: new Date(now + this.options.reviewWindowMs),
        deadlineAt: new Date(now + this.options.deadlineMs),
        purgeAfter: new Date(now + this.options.retentionMs),
        finalizedAt: status === 'PENDING' ? null : new Date(now),
        officialEventId: null,
      },
      initial.reason === 'EVENT_REPLAY',
    );
    return {
      counted: false,
      status: row.status,
      decision: row.status === 'ACCEPTED' ? 'ACCEPT' : row.status === 'REJECTED' ? 'REJECT' : 'REVIEW',
      reason: duplicate ? 'DUPLICATE_EVENT' : row.reason,
      duplicate,
    };
  }
  async tick() {
    const finalized = await this.store.finalizeDue(new Date(this.now()));
    const purged = await this.store.cleanup(new Date(this.now()));
    return { finalized, purged };
  }
}

function configuredService(): ProvisionalUsageService | null {
  const enabled = process.env.LIVE_USAGE_PROVISIONAL_ENABLED || 'false';
  if (!['true', 'false'].includes(enabled)) throw new Error('Invalid LIVE_USAGE_PROVISIONAL_ENABLED');
  if (enabled !== 'true') return null;
  const options: Partial<ProvisionalOptions> = {};
  for (const key of Object.keys(provisionalDefaults) as Array<keyof ProvisionalOptions>) {
    const variable = `LIVE_USAGE_PROVISIONAL_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
    if (process.env[variable] !== undefined) options[key] = Number(process.env[variable]);
  }
  return new ProvisionalUsageService(
    AppDataSource,
    process.env.LIVE_USAGE_STATE_SECRET || '',
    liveUsageBotProtection.options,
    options,
  );
}
export const provisionalUsageService = configuredService();
export function startProvisionalWorker(service = provisionalUsageService) {
  if (!service || liveUsageBotProtection.options.mode !== 'enforce') return () => {};
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await service.tick();
    } catch (error) {
      const reason =
        error instanceof Error && /^PROVISIONAL_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'PROVISIONAL_UNAVAILABLE';
      console.error(`Provisional usage finalization failed: ${reason}; pending events retained for retry`);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), service.options.pollMs);
  timer.unref();
  return () => clearInterval(timer);
}
