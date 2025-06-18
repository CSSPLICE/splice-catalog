import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class UpdateToolsCatalog1748460550596 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn('slc_tools_catalog', new TableColumn({
            name: 'lti_key',
            type: 'varchar',
            isNullable: true}));
        await queryRunner.addColumn('slc_tools_catalog', new TableColumn({
            name: 'lti_secret',
            type: 'varchar',
            isNullable: true}));
        await queryRunner.addColumn('slc_tools_catalog', new TableColumn({
            name: 'lti_config_url',
            type: 'varchar',
            isNullable: true}));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('slc_tools_catalog', 'lti_key');
        await queryRunner.dropColumn('slc_tools_catalog', 'lti_secret');
        await queryRunner.dropColumn('slc_tools_catalog', 'lti_config_url');


    }

}
