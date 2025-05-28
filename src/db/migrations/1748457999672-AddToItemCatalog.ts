import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddToItemCatalog1748457999672 implements MigrationInterface {
    name = 'AddToItemCatalog1748457999672 ';
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn('slc_item_catalog', new TableColumn({
            name: 'programming_language',
            type: 'varchar',
            isNullable: false}));
        await queryRunner.addColumn('slc_item_catalog', new TableColumn({
            name: 'persistent_id',
            type: 'varchar',
            isNullable: false}));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('slc_item_catalog', 'programming_language');
        await queryRunner.dropColumn('slc_item_catalog', 'persistent_id');
    }

}
