import { MigrationInterface, QueryRunner } from "typeorm";
export class UpdateSLCItemCatalog1748379850251 implements MigrationInterface {
    name = 'UpdateSLCItemCatalog1748379850251';
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.renameColumn('slc_item_catalog', 'language', 'natural_language');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.renameColumn('slc_item_catalog', 'natural_language', 'language');
    }

}
