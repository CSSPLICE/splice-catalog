import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedSearchAliases implements MigrationInterface {
  name = 'SeedSearchAliases';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO \`search_aliases\` (term, synonym) VALUES
      ('BST', 'Binary Search Tree'),
      ('Binary Search Tree', 'BST'),
      ('ADT', 'Abstract Data Type'),
      ('Abstract Data Type', 'ADT');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM \`search_aliases\`
      WHERE (term = 'BST' AND synonym = 'Binary Search Tree')
         OR (term = 'Binary Search Tree' AND synonym = 'BST')
         OR (term = 'ADT' AND synonym = 'Abstract Data Type')
         OR (term = 'Abstract Data Type' AND synonym = 'ADT');
    `);
  }
}
