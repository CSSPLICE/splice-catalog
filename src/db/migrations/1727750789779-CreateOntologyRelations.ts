import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateOntologyRelations1727750789779 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'ontology_relations',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'parent_class_id',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'child_class_id',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'relationship_type',
            type: 'varchar',
            length: '255',
            default: "'subClassOf'",
          },
        ],
        foreignKeys: [
          {
            columnNames: ['parent_class_id'],
            referencedTableName: 'ontology_classes',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['child_class_id'],
            referencedTableName: 'ontology_classes',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('ontology_relations');
  }
}
