import { MigrationInterface, QueryRunner } from "typeorm";

export class AddValidationFields1744688022277 implements MigrationInterface {
    name = 'AddValidationFields1744688022277'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`validation_results\` DROP COLUMN \`metadataErrors\``);
        await queryRunner.query(`ALTER TABLE \`validation_results\` ADD \`metadataIssues\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`validation_results\` ADD \`iframeValidationError\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`validation_results\` ADD \`ltiValidationStatus\` text NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`validation_results\` DROP COLUMN \`ltiValidationStatus\``);
        await queryRunner.query(`ALTER TABLE \`validation_results\` DROP COLUMN \`iframeValidationError\``);
        await queryRunner.query(`ALTER TABLE \`validation_results\` DROP COLUMN \`metadataIssues\``);
        await queryRunner.query(`ALTER TABLE \`validation_results\` ADD \`metadataErrors\` text NULL`);
    }

}
