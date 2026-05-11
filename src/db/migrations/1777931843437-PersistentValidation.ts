import { MigrationInterface, QueryRunner } from "typeorm";

export class PersistentValidation1777931843437 implements MigrationInterface {
    name = 'PersistentValidation1777931843437'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`validation_job_constraint\` (\`id\` int NOT NULL AUTO_INCREMENT, \`persistentID\` varchar(255) NOT NULL, \`property\` varchar(255) NOT NULL, \`constraints\` json NOT NULL, \`job_id\` varchar(36) NOT NULL, INDEX \`IDX_c22b54c8595159cc986422820e\` (\`persistentID\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`validation_job\` (\`id\` varchar(36) NOT NULL, \`submitted_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`catalog_type\` varchar(64) NULL, \`total\` int NOT NULL DEFAULT '0', \`saved\` int NOT NULL DEFAULT '0', \`updated\` int NOT NULL DEFAULT '0', \`processed\` int NOT NULL DEFAULT '0', \`status\` enum ('processing', 'failed', 'complete') NOT NULL DEFAULT 'processing', PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`validation_job_constraint\` ADD CONSTRAINT \`FK_916d4f5d9eaa91d2e2d60d25e6f\` FOREIGN KEY (\`job_id\`) REFERENCES \`validation_job\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`validation_job_constraint\` DROP FOREIGN KEY \`FK_916d4f5d9eaa91d2e2d60d25e6f\``);
        await queryRunner.query(`DROP TABLE \`validation_job\``);
        await queryRunner.query(`DROP INDEX \`IDX_c22b54c8595159cc986422820e\` ON \`validation_job_constraint\``);
        await queryRunner.query(`DROP TABLE \`validation_job_constraint\``);
    }

}
