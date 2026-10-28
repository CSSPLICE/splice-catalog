import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHistoricalUsageTable1791914000000 implements MigrationInterface {
  name = 'CreateHistoricalUsageTable1791914000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`historical_usage\` (\`id\` int unsigned NOT NULL AUTO_INCREMENT, \`catalogType\` varchar(32) NOT NULL, \`legacyCatalogId\` int unsigned NOT NULL, \`itemPersistentID\` varchar(255) NULL, \`itemTitle\` varchar(255) NULL, \`catalogPath\` varchar(255) NULL, \`viewCount\` int unsigned NOT NULL, \`source\` varchar(64) NOT NULL, \`importedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`UQ_historical_usage_source_catalog_legacy\` (\`source\`, \`catalogType\`, \`legacyCatalogId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`historical_usage\``);
  }
}
