import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateOntologyAliasesRelationship1731121946801 implements MigrationInterface {
    name = 'UpdateOntologyAliasesRelationship1731121946801'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` DROP FOREIGN KEY \`FK_c10b53388b15cbcf35544952dc8\``);
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` DROP FOREIGN KEY \`FK_e3ad5df66ebc6b40df3a8f166ab\``);
        await queryRunner.query(`ALTER TABLE \`item_classification\` DROP FOREIGN KEY \`FK_1af7d2c51470286f1c8d95776b1\``);
        await queryRunner.query(`ALTER TABLE \`item_classification\` DROP FOREIGN KEY \`FK_23a557b6c75301ed489de065d6f\``);
        await queryRunner.query(`DROP INDEX \`UQ_a36fb942938a3f8385558425f4e\` ON \`ontology_aliases\``);
        await queryRunner.query(`DROP INDEX \`UQ_438801da4bf06b823af71a063db\` ON \`ontology_classes\``);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`url\` \`url\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`keywords\` \`keywords\` json NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`description\` \`description\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`author\` \`author\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`institution\` \`institution\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`language\` \`language\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`platform_name\` \`platform_name\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`lti_instructions_url\` \`lti_instructions_url\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`exercise_type\` \`exercise_type\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`exercise_name\` \`exercise_name\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` ADD UNIQUE INDEX \`IDX_83a271eaf3b4429bfd7d393eac\` (\`exercise_name\`)`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`iframe_url\` \`iframe_url\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`lti_url\` \`lti_url\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_tools_catalog\` DROP COLUMN \`tool_description\``);
        await queryRunner.query(`ALTER TABLE \`slc_tools_catalog\` ADD \`tool_description\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_tools_catalog\` DROP COLUMN \`keywords\``);
        await queryRunner.query(`ALTER TABLE \`slc_tools_catalog\` ADD \`keywords\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` ADD UNIQUE INDEX \`IDX_a36fb942938a3f8385558425f4\` (\`alias\`)`);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` CHANGE \`is_active\` \`is_active\` tinyint NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` DROP COLUMN \`created_at\``);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` ADD \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` ADD \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` CHANGE \`parent_class_id\` \`parent_class_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` CHANGE \`child_class_id\` \`child_class_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`ontology_classes\` ADD UNIQUE INDEX \`IDX_438801da4bf06b823af71a063d\` (\`class_uri\`)`);
        await queryRunner.query(`ALTER TABLE \`ontology_classes\` CHANGE \`is_active\` \`is_active\` tinyint NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE \`item_classification\` CHANGE \`item_id\` \`item_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`item_classification\` CHANGE \`class_id\` \`class_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` ADD CONSTRAINT \`FK_e3ad5df66ebc6b40df3a8f166ab\` FOREIGN KEY (\`parent_class_id\`) REFERENCES \`ontology_classes\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` ADD CONSTRAINT \`FK_c10b53388b15cbcf35544952dc8\` FOREIGN KEY (\`child_class_id\`) REFERENCES \`ontology_classes\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`item_classification\` ADD CONSTRAINT \`FK_23a557b6c75301ed489de065d6f\` FOREIGN KEY (\`item_id\`) REFERENCES \`slc_item_catalog\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`item_classification\` ADD CONSTRAINT \`FK_1af7d2c51470286f1c8d95776b1\` FOREIGN KEY (\`class_id\`) REFERENCES \`ontology_classes\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`item_classification\` DROP FOREIGN KEY \`FK_1af7d2c51470286f1c8d95776b1\``);
        await queryRunner.query(`ALTER TABLE \`item_classification\` DROP FOREIGN KEY \`FK_23a557b6c75301ed489de065d6f\``);
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` DROP FOREIGN KEY \`FK_c10b53388b15cbcf35544952dc8\``);
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` DROP FOREIGN KEY \`FK_e3ad5df66ebc6b40df3a8f166ab\``);
        await queryRunner.query(`ALTER TABLE \`item_classification\` CHANGE \`class_id\` \`class_id\` int NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`item_classification\` CHANGE \`item_id\` \`item_id\` int NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`ontology_classes\` CHANGE \`is_active\` \`is_active\` tinyint(1) NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE \`ontology_classes\` DROP INDEX \`IDX_438801da4bf06b823af71a063d\``);
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` CHANGE \`child_class_id\` \`child_class_id\` int NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` CHANGE \`parent_class_id\` \`parent_class_id\` int NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` ADD \`updated_at\` timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` DROP COLUMN \`created_at\``);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` ADD \`created_at\` timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` CHANGE \`is_active\` \`is_active\` tinyint(1) NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE \`ontology_aliases\` DROP INDEX \`IDX_a36fb942938a3f8385558425f4\``);
        await queryRunner.query(`ALTER TABLE \`slc_tools_catalog\` DROP COLUMN \`keywords\``);
        await queryRunner.query(`ALTER TABLE \`slc_tools_catalog\` ADD \`keywords\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_tools_catalog\` DROP COLUMN \`tool_description\``);
        await queryRunner.query(`ALTER TABLE \`slc_tools_catalog\` ADD \`tool_description\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`lti_url\` \`lti_url\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`iframe_url\` \`iframe_url\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` DROP INDEX \`IDX_83a271eaf3b4429bfd7d393eac\``);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`exercise_name\` \`exercise_name\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`exercise_type\` \`exercise_type\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`lti_instructions_url\` \`lti_instructions_url\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`platform_name\` \`platform_name\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`language\` \`language\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`institution\` \`institution\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`author\` \`author\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`description\` \`description\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`keywords\` \`keywords\` json NULL`);
        await queryRunner.query(`ALTER TABLE \`slc_item_catalog\` CHANGE \`url\` \`url\` varchar(255) NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`UQ_438801da4bf06b823af71a063db\` ON \`ontology_classes\` (\`class_uri\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`UQ_a36fb942938a3f8385558425f4e\` ON \`ontology_aliases\` (\`alias\`)`);
        await queryRunner.query(`ALTER TABLE \`item_classification\` ADD CONSTRAINT \`FK_23a557b6c75301ed489de065d6f\` FOREIGN KEY (\`item_id\`) REFERENCES \`slc_item_catalog\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`item_classification\` ADD CONSTRAINT \`FK_1af7d2c51470286f1c8d95776b1\` FOREIGN KEY (\`class_id\`) REFERENCES \`ontology_classes\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` ADD CONSTRAINT \`FK_e3ad5df66ebc6b40df3a8f166ab\` FOREIGN KEY (\`parent_class_id\`) REFERENCES \`ontology_classes\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`ontology_relations\` ADD CONSTRAINT \`FK_c10b53388b15cbcf35544952dc8\` FOREIGN KEY (\`child_class_id\`) REFERENCES \`ontology_classes\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
