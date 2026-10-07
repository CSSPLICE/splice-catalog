import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsageEventCatalogPath1791309088000 implements MigrationInterface {
  name = 'AddUsageEventCatalogPath1791309088000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`usage_events\` ADD \`catalogType\` varchar(255) NULL, ADD \`catalogPath\` varchar(255) NULL`,
    );
    await queryRunner.query(
      `UPDATE \`usage_events\` AS usageEvent LEFT JOIN \`slc_item_catalog\` AS slcItem ON usageEvent.\`itemPersistentID\` = slcItem.\`persistentID\` SET usageEvent.\`catalogType\` = 'SLC_ITEM', usageEvent.\`catalogPath\` = CASE WHEN slcItem.\`id\` IS NULL THEN NULL ELSE CONCAT('/catalog/item/', slcItem.\`id\`) END`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`usage_events\` DROP COLUMN \`catalogPath\`, DROP COLUMN \`catalogType\``);
  }
}
