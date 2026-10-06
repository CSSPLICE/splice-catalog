import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsageEventsTable1791251377107 implements MigrationInterface {
  name = 'CreateUsageEventsTable1791251377107';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`usage_events\` (\`id\` int NOT NULL AUTO_INCREMENT, \`itemPersistentID\` varchar(255) NOT NULL, \`itemTitle\` varchar(255) NOT NULL, \`eventType\` varchar(255) NOT NULL, \`linkType\` varchar(255) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`usage_events\``);
  }
}
