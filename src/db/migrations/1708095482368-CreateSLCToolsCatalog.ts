import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateSLCToolsCatalog1708095482368 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'slc_tools_catalog',
        columns: [
          {
            name: 'platform_name',
            type: 'varchar',
            isPrimary: true,
          },
          {
            name: 'url',
            type: 'varchar',
          },
          {
            name: 'tool_description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'license',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'standard_support',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'keywords',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'contact_email',
            type: 'varchar',
            isNullable: true,
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {}
}
