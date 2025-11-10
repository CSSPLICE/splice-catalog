import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedInitialData1762794315112 implements MigrationInterface {
  name = 'SeedInitialData1762794315112';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`slc_item_catalog\` (\`id\` int NOT NULL AUTO_INCREMENT, \`catalog_type\` varchar(255) NOT NULL, \`persistentID\` varchar(255) NOT NULL, \`platform_name\` varchar(255) NOT NULL, \`iframe_url\` varchar(255) NOT NULL, \`license\` varchar(255) NOT NULL, \`description\` text NOT NULL, \`author\` text NOT NULL, \`institution\` text NOT NULL, \`keywords\` text NOT NULL, \`features\` text NOT NULL, \`title\` varchar(255) NOT NULL, \`programming_language\` text NOT NULL, \`natural_language\` text NOT NULL, \`protocol\` text NOT NULL, \`protocol_url\` text NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`slc_tools_catalog\` (\`id\` int NOT NULL AUTO_INCREMENT, \`catalog_type\` varchar(255) NOT NULL, \`platform_name\` varchar(255) NOT NULL, \`url\` varchar(255) NOT NULL, \`description\` varchar(255) NULL, \`license\` varchar(255) NULL, \`interface\` varchar(255) NULL, \`contact_email\` varchar(255) NULL, \`lti_credentials\` varchar(255) NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`dataset_catalog\` (\`id\` int NOT NULL AUTO_INCREMENT, \`title\` varchar(255) NULL, \`platform\` varchar(255) NULL, \`dataset_name\` varchar(255) NULL, \`description\` text NULL, \`data_formats\` text NULL, \`data_type\` text NULL, \`keywords\` text NULL, \`contributors\` text NULL, \`publisher\` varchar(255) NULL, \`resource_url\` varchar(1024) NULL, \`resource_url_type\` varchar(255) NULL, \`bibtex_source\` text NULL, \`creator\` varchar(255) NULL, \`given_name\` varchar(255) NULL, \`family_name\` varchar(255) NULL, \`name_identifier\` varchar(255) NULL, \`affiliation\` varchar(255) NULL, \`availability\` varchar(255) NULL, \`rights\` varchar(255) NULL, \`programming_language\` text NULL, \`data_collection_start_date\` varchar(255) NULL, \`data_collection_end_date\` varchar(255) NULL, \`publication_year\` int NULL, \`number_of_semesters\` int NULL, \`data_protection\` varchar(255) NULL, \`measurement_type\` varchar(255) NULL, \`data_processing\` text NULL, \`population\` varchar(255) NULL, \`units_number\` varchar(255) NULL, \`task_number\` varchar(255) NULL, \`sample_size\` varchar(255) NULL, \`sample_demographics\` text NULL, \`country\` text NULL, \`educational_institution\` varchar(255) NULL, \`data_standard\` varchar(255) NULL, \`learning_environment\` varchar(255) NULL, \`aggregation\` varchar(255) NULL, \`aggregation_level\` varchar(255) NULL, \`related_publication_url\` varchar(1024) NULL, \`related_publication\` text NULL, \`research_question\` text NULL, \`future_work\` text NULL, \`fairness_score_text\` text NULL, \`fairness_score\` text NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`ontology_classes\` (\`id\` int NOT NULL AUTO_INCREMENT, \`class_uri\` varchar(255) NOT NULL, \`label\` varchar(255) NOT NULL, \`comment\` text NULL, \`description\` text NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`IDX_438801da4bf06b823af71a063d\` (\`class_uri\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`ontology_relations\` (\`id\` int NOT NULL AUTO_INCREMENT, \`relationship_type\` varchar(255) NOT NULL DEFAULT 'subClassOf', \`parent_class_id\` int NOT NULL, \`child_class_id\` int NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`ontology_aliases\` (\`id\` int NOT NULL AUTO_INCREMENT, \`alias\` varchar(255) NOT NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`class_id\` int NOT NULL, UNIQUE INDEX \`IDX_a36fb942938a3f8385558425f4\` (\`alias\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`item_classification\` (\`id\` int NOT NULL AUTO_INCREMENT, \`classified_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \`item_id\` int NOT NULL, \`class_id\` int NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`validation_results\` (\`id\` int NOT NULL AUTO_INCREMENT, \`user\` varchar(255) NOT NULL, \`dateLastUpdated\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`metadataIssues\` text NULL, \`isUrlValid\` tinyint NOT NULL DEFAULT 0, \`categorizationResults\` text NULL, \`validationStatus\` text NULL, \`iframeValidationError\` text NULL, \`ltiValidationStatus\` text NULL, \`itemId\` int NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`ontology_relations\` ADD CONSTRAINT \`FK_e3ad5df66ebc6b40df3a8f166ab\` FOREIGN KEY (\`parent_class_id\`) REFERENCES \`ontology_classes\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`ontology_relations\` ADD CONSTRAINT \`FK_c10b53388b15cbcf35544952dc8\` FOREIGN KEY (\`child_class_id\`) REFERENCES \`ontology_classes\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`ontology_aliases\` ADD CONSTRAINT \`FK_81d513f797030a86255271fab2d\` FOREIGN KEY (\`class_id\`) REFERENCES \`ontology_classes\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`item_classification\` ADD CONSTRAINT \`FK_23a557b6c75301ed489de065d6f\` FOREIGN KEY (\`item_id\`) REFERENCES \`slc_item_catalog\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`item_classification\` ADD CONSTRAINT \`FK_1af7d2c51470286f1c8d95776b1\` FOREIGN KEY (\`class_id\`) REFERENCES \`ontology_classes\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`validation_results\` ADD CONSTRAINT \`FK_0158ca2c3ffd1a19d9d4d783325\` FOREIGN KEY (\`itemId\`) REFERENCES \`slc_item_catalog\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`validation_results\` DROP FOREIGN KEY \`FK_0158ca2c3ffd1a19d9d4d783325\``);
    await queryRunner.query(`ALTER TABLE \`item_classification\` DROP FOREIGN KEY \`FK_1af7d2c51470286f1c8d95776b1\``);
    await queryRunner.query(`ALTER TABLE \`item_classification\` DROP FOREIGN KEY \`FK_23a557b6c75301ed489de065d6f\``);
    await queryRunner.query(`ALTER TABLE \`ontology_aliases\` DROP FOREIGN KEY \`FK_81d513f797030a86255271fab2d\``);
    await queryRunner.query(`ALTER TABLE \`ontology_relations\` DROP FOREIGN KEY \`FK_c10b53388b15cbcf35544952dc8\``);
    await queryRunner.query(`ALTER TABLE \`ontology_relations\` DROP FOREIGN KEY \`FK_e3ad5df66ebc6b40df3a8f166ab\``);
    await queryRunner.query(`DROP TABLE \`validation_results\``);
    await queryRunner.query(`DROP TABLE \`item_classification\``);
    await queryRunner.query(`DROP INDEX \`IDX_a36fb942938a3f8385558425f4\` ON \`ontology_aliases\``);
    await queryRunner.query(`DROP TABLE \`ontology_aliases\``);
    await queryRunner.query(`DROP TABLE \`ontology_relations\``);
    await queryRunner.query(`DROP INDEX \`IDX_438801da4bf06b823af71a063d\` ON \`ontology_classes\``);
    await queryRunner.query(`DROP TABLE \`ontology_classes\``);
    await queryRunner.query(`DROP TABLE \`dataset_catalog\``);
    await queryRunner.query(`DROP TABLE \`slc_tools_catalog\``);
    await queryRunner.query(`DROP TABLE \`slc_item_catalog\``);
  }
}
