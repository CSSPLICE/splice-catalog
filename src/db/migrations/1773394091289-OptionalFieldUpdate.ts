import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptionalFieldUpdate1773394091289 implements MigrationInterface {
  name = 'OptionalFieldUpdate1773394091289';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`slc_item_catalog\` CHANGE \`platform_name\` \`platform_name\` varchar(255) NULL`,
    );
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`iframe_url\` \`iframe_url\` varchar(255) NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`license\` \`license\` varchar(255) NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`description\` \`description\` text NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`author\` \`author\` text NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`institution\` \`institution\` text NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`keywords\` \`keywords\` text NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`features\` \`features\` text NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`title\` \`title\` varchar(255) NULL`);
    await queryRunner.query(
      `ALTER TABLE \`slc_item_catalog\` CHANGE \`programming_language\` \`programming_language\` text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`slc_item_catalog\` CHANGE \`natural_language\` \`natural_language\` text NULL`,
    );
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`protocol\` \`protocol\` text NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`protocol_url\` \`protocol_url\` text NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`protocol_url\` \`protocol_url\` text NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`protocol\` \`protocol\` text NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE \`slc_item_catalog\` CHANGE \`natural_language\` \`natural_language\` text NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`slc_item_catalog\` CHANGE \`programming_language\` \`programming_language\` text NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`title\` \`title\` varchar(255) NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`features\` \`features\` text NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`keywords\` \`keywords\` text NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`institution\` \`institution\` text NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`author\` \`author\` text NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`description\` \`description\` text NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`license\` \`license\` varchar(255) NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE \`slc_item_catalog\` CHANGE \`iframe_url\` \`iframe_url\` varchar(255) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`slc_item_catalog\` CHANGE \`platform_name\` \`platform_name\` varchar(255) NOT NULL`,
    );
  }
}
