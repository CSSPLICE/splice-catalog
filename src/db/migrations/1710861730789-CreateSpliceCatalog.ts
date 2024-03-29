import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateSpliceCatalog1710861730789 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'slc_item_catalog',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'catalog_type',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'url',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'keywords',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'description',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'author',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'institution',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'language',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'platform_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'lti_instructions_url',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'exercise_type',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'exercise_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'iframe_url',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'lti_url',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('slc_item_catalog');
  }
}
