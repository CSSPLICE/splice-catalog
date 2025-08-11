import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKeywordTable implements MigrationInterface {
  name = 'CreateKeywordTable'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`keyword\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(255) NOT NULL,
        \`description\` VARCHAR(255) NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(\`DROP TABLE \\\`keyword\\\`;\`);
  }
}
