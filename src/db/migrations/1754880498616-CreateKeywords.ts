import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class CreateKeywords1754880498616 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.createTable(
      new Table({
        name: "keywords",
        columns: [
          { name: "id", type: "int", isPrimary: true, isGenerated: true, generationStrategy: "increment" },
          { name: "name", type: "varchar", length: "200", isNullable: false },
          { name: "description", type: "text", isNullable: true }
        ]
      }),
      true // ifNotExist
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.dropTable("keywords");
  }
}
