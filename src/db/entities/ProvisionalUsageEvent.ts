import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import type { Classification } from '../../services/LiveUsageBotProtection.js';

export type ProvisionalStatus = 'PENDING' | 'ACCEPTED' | 'REVIEW' | 'REJECTED' | 'EXPIRED';
export type BrowserEventKind = 'ENTRY_CLICK' | 'EXTERNAL_CLICK' | 'WEB_SEARCH';
export type BrowserUsagePayload =
  | {
      kind: 'ENTRY_CLICK' | 'EXTERNAL_CLICK';
      itemPersistentID: string;
      itemTitle: string;
      catalogType: string;
      catalogPath: string;
      linkType?: string;
    }
  | { kind: 'WEB_SEARCH'; query: string; catalogType: 'SLC_ITEM' };

@Entity('provisional_usage_events')
@Index('UQ_provisional_event_key', ['eventKey'], { unique: true })
@Index('IDX_provisional_due', ['status', 'reviewAfter'])
@Index('IDX_provisional_session_time', ['sessionKey', 'receivedAt'])
@Index('IDX_provisional_cohort_time', ['networkKey', 'agentKey', 'receivedAt'])
@Index('IDX_provisional_expiry', ['purgeAfter'])
export class ProvisionalUsageEvent {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ type: 'char', length: 64 }) eventKey!: string;
  @Column({ type: 'char', length: 64 }) sessionKey!: string;
  @Column({ type: 'char', length: 64 }) networkKey!: string;
  @Column({ type: 'char', length: 64 }) agentKey!: string;
  @Column({ type: 'char', length: 64 }) identityKey!: string;
  @Column({ type: 'varchar', length: 20 }) kind!: BrowserEventKind;
  @Column({ type: 'varchar', length: 10 }) initialDecision!: Classification;
  @Column({ type: 'varchar', length: 64 }) initialReason!: string;
  @Column({ type: 'varchar', length: 10 }) status!: ProvisionalStatus;
  @Column({ type: 'varchar', length: 64 }) reason!: string;
  @Column({ type: 'json', nullable: true }) payload!: BrowserUsagePayload | null;
  @Column({ type: 'datetime', precision: 3 }) sessionStartedAt!: Date;
  @Column({ type: 'datetime', precision: 3 }) receivedAt!: Date;
  @Column({ type: 'datetime', precision: 3 }) reviewAfter!: Date;
  @Column({ type: 'datetime', precision: 3 }) deadlineAt!: Date;
  @Column({ type: 'datetime', precision: 3 }) purgeAfter!: Date;
  @Column({ type: 'datetime', precision: 3, nullable: true }) finalizedAt!: Date | null;
  @Column({ type: 'int', nullable: true }) officialEventId!: number | null;
}

@Entity('live_usage_pipeline_lock')
export class LiveUsagePipelineLock {
  @Column({ type: 'tinyint', primary: true }) id!: number;
  @Column({ type: 'char', length: 64, nullable: true }) configurationId!: string | null;
}
