import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsageEventAudit1794100000000 implements MigrationInterface {
  name = 'CreateUsageEventAudit1794100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE usage_event_audit (
      id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
      provisionalEventId int NOT NULL,
      eventKey char(64) NOT NULL, sessionKey char(64) NOT NULL,
      networkKey char(64) NOT NULL, agentKey char(64) NOT NULL, identityKey char(64) NOT NULL,
      kind varchar(20) NOT NULL, initialDecision varchar(10) NOT NULL, initialReason varchar(64) NOT NULL,
      status varchar(10) NOT NULL, reason varchar(64) NOT NULL, policyVersion varchar(24) NOT NULL,
      sessionStartedAt datetime(3) NOT NULL, receivedAt datetime(3) NOT NULL,
      finalizedAt datetime(3) NOT NULL,
      officialEventId int NULL, catalogType varchar(32) NULL, linkType varchar(32) NULL,
      itemPersistentID varchar(255) NULL, itemTitle varchar(255) NULL,
      UNIQUE INDEX UQ_usage_audit_provisional_event (provisionalEventId),
      UNIQUE INDEX UQ_usage_audit_event_key (eventKey),
      INDEX IDX_usage_audit_received (receivedAt),
      INDEX IDX_usage_audit_finalized (finalizedAt),
      INDEX IDX_usage_audit_status_time (status, finalizedAt),
      INDEX IDX_usage_audit_kind_time (kind, finalizedAt),
      INDEX IDX_usage_audit_resource_time (catalogType, itemPersistentID, finalizedAt)
    ) ENGINE=InnoDB`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE usage_event_audit');
  }
}
