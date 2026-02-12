import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSearchAliasesTable implements MigrationInterface {
  name = 'CreateSearchAliasesTable';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`search_aliases\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`term\` varchar(255) NOT NULL,
        \`synonym\` varchar(255) NOT NULL,
        \`is_active\` tinyint NOT NULL DEFAULT 1,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_term_synonym\` (\`term\`, \`synonym\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`search_aliases\``);
  }
}
