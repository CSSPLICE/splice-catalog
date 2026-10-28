import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSearchEventsTable1792400000000 implements MigrationInterface {
  name = 'CreateSearchEventsTable1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TABLE `search_events` (`id` int NOT NULL AUTO_INCREMENT, `source` enum ('WEB', 'API') NOT NULL, `query` varchar(500) NOT NULL, `catalogType` varchar(32) NULL, `resultCount` int unsigned NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_search_events_source_createdAt` (`source`, `createdAt`), PRIMARY KEY (`id`)) ENGINE=InnoDB",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `search_events`');
  }
}
