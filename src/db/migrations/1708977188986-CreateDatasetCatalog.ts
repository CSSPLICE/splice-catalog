import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class CreateDatasetCatalog1708977188986 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
            name: "dataset_catalog",
            columns: [
                { 
                    name: 'id', 
                    type: 'int', 
                    isPrimary: true, 
                    isGenerated: true, 
                    generationStrategy: 'increment' 
                },
                { 
                    name: 'title', 
                    type: 'varchar' 
                },
                { 
                    name: 'platform', 
                    type: 'varchar' 
                },
                { 
                    name: 'datasetName', 
                    type: 'varchar' 
                },
                { 
                    name: 'url', 
                    type: 'varchar' 
                },
                { 
                    name: 'description', 
                    type: 'text' 
                },
                { 
                    name: 'dataFormats', 
                    type: 'json' 
                },
                { 
                    name: 'dataType', 
                    type: 'json' 
                },
                { 
                    name: 'keywords', 
                    type: 'json' 
                },
                { 
                    name: 'population', 
                    type: 'varchar', 
                    isNullable: true 
                },
                { 
                    name: 'contributors', 
                    type: 'json', 
                    isNullable: true 
                },
                { 
                    name: 'language', 
                    type: 'varchar', 
                    isNullable: true 
                },
                { 
                    name: 'publicationYear', 
                    type: 'int' 
                },
              ],
            
        }), true);

    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("dataset_catalog");
    }

}
