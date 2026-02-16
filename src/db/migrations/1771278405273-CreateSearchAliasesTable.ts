import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSearchAliasesTable1771278405273 implements MigrationInterface {
  name = 'CreateSearchAliasesTable1771278405273';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`search_aliases\` (\`id\` int NOT NULL AUTO_INCREMENT, \`term\` varchar(255) NOT NULL, \`synonym\` varchar(255) NOT NULL, \`is_active\` tinyint NOT NULL DEFAULT '1', \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`search_aliases\``);
  }
}
