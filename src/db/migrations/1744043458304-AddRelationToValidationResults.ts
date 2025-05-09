import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRelationToValidationResults1744043458304 implements MigrationInterface {
  name = 'AddRelationToValidationResults1744043458304';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`validation_results\` ADD \`itemId\` int NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE \`validation_results\` ADD CONSTRAINT \`FK_0158ca2c3ffd1a19d9d4d783325\` FOREIGN KEY (\`itemId\`) REFERENCES \`slc_item_catalog\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`validation_results\` DROP FOREIGN KEY \`FK_0158ca2c3ffd1a19d9d4d783325\``);
    await queryRunner.query(`ALTER TABLE \`validation_results\` DROP COLUMN \`itemId\``);
  }
}
