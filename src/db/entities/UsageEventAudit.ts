import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import type { BrowserEventKind, ProvisionalStatus } from './ProvisionalUsageEvent.js';
import type { Classification } from '../../services/LiveUsageBotProtection.js';

export type UsageAuditStatus = Exclude<ProvisionalStatus, 'PENDING'>;

/** Finalized browser evidence only. References deliberately have no foreign keys:
 * audit history must survive provisional and official event deletion. */
@Entity('usage_event_audit')
@Index('UQ_usage_audit_provisional_event', ['provisionalEventId'], { unique: true })
@Index('UQ_usage_audit_event_key', ['eventKey'], { unique: true })
@Index('IDX_usage_audit_received', ['receivedAt'])
@Index('IDX_usage_audit_finalized', ['finalizedAt'])
@Index('IDX_usage_audit_status_time', ['status', 'finalizedAt'])
@Index('IDX_usage_audit_kind_time', ['kind', 'finalizedAt'])
@Index('IDX_usage_audit_resource_time', ['catalogType', 'itemPersistentID', 'finalizedAt'])
export class UsageEventAudit {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ type: 'int' }) provisionalEventId!: number;
  // Copy the existing domain-separated HMAC-SHA256 values; never raw identifiers.
  @Column({ type: 'char', length: 64 }) eventKey!: string;
  @Column({ type: 'char', length: 64 }) sessionKey!: string;
  @Column({ type: 'char', length: 64 }) networkKey!: string;
  @Column({ type: 'char', length: 64 }) agentKey!: string;
  @Column({ type: 'char', length: 64 }) identityKey!: string;
  @Column({ type: 'varchar', length: 20 }) kind!: BrowserEventKind;
  @Column({ type: 'varchar', length: 10 }) initialDecision!: Classification;
  @Column({ type: 'varchar', length: 64 }) initialReason!: string;
  @Column({ type: 'varchar', length: 10 }) status!: UsageAuditStatus;
  @Column({ type: 'varchar', length: 64 }) reason!: string;
  @Column({ type: 'varchar', length: 24 }) policyVersion!: string;
  @Column({ type: 'datetime', precision: 3 }) sessionStartedAt!: Date;
  @Column({ type: 'datetime', precision: 3 }) receivedAt!: Date;
  // Cleanup compares this indexed timestamp with the CURRENT retention cutoff.
  @Column({ type: 'datetime', precision: 3 }) finalizedAt!: Date;
  // kind disambiguates usage_events (clicks) from search_events (WEB_SEARCH).
  @Column({ type: 'int', nullable: true }) officialEventId!: number | null;
  // Canonical server-side catalog/link categories only.
  @Column({ type: 'varchar', length: 32, nullable: true }) catalogType!: string | null;
  @Column({ type: 'varchar', length: 32, nullable: true }) linkType!: string | null;
  // Clicks only: validated catalog record ID and bounded title snapshot.
  // WEB_SEARCH must leave both fields (and linkType) null; never copy request metadata.
  @Column({ type: 'varchar', length: 255, nullable: true }) itemPersistentID!: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) itemTitle!: string | null;
}
