import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProvisionalUsageEvents1794000000000 implements MigrationInterface {
  name = 'CreateProvisionalUsageEvents1794000000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE provisional_usage_events (
      id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
      eventKey char(64) NOT NULL, sessionKey char(64) NOT NULL,
      networkKey char(64) NOT NULL, agentKey char(64) NOT NULL, identityKey char(64) NOT NULL,
      kind varchar(20) NOT NULL, initialDecision varchar(10) NOT NULL, initialReason varchar(64) NOT NULL,
      status varchar(10) NOT NULL, reason varchar(64) NOT NULL, payload json NULL,
      sessionStartedAt datetime(3) NOT NULL, receivedAt datetime(3) NOT NULL,
      reviewAfter datetime(3) NOT NULL, deadlineAt datetime(3) NOT NULL, purgeAfter datetime(3) NOT NULL,
      finalizedAt datetime(3) NULL, officialEventId int NULL,
      UNIQUE INDEX UQ_provisional_event_key (eventKey),
      INDEX IDX_provisional_due (status, reviewAfter),
      INDEX IDX_provisional_session_time (sessionKey, receivedAt),
      INDEX IDX_provisional_cohort_time (networkKey, agentKey, receivedAt),
      INDEX IDX_provisional_expiry (purgeAfter)
    ) ENGINE=InnoDB`);
    await queryRunner.query(
      'CREATE TABLE live_usage_pipeline_lock (id tinyint NOT NULL PRIMARY KEY, configurationId char(64) NULL) ENGINE=InnoDB',
    );
    await queryRunner.query('INSERT INTO live_usage_pipeline_lock (id, configurationId) VALUES (1, NULL)');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE provisional_usage_events');
    await queryRunner.query('DROP TABLE live_usage_pipeline_lock');
  }
}
