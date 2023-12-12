import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedInitialData1699653979099 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      // 'INSERT IGNORE INTO slc_item_catalog (id, platform_name, url, keywords, institution) VALUES \n' +
      'INSERT IGNORE INTO slc_item_catalog (platform_name, url, keywords, institution) VALUES \n' +
        // "   (1, 'OpenDSA', 'https://opendsa-server.cs.vt.edu', 'eTextbook, LTI', 'Virginia Tech'), \n" +
        // "   (2, 'CodeWorkout', 'https://codeworkout.cs.vt.edu', 'programming practice, LTI', 'Virginia Tech')",
        "   ('OpenDSA', 'https://opendsa-server.cs.vt.edu', 'eTextbook, LTI', 'Virginia Tech'), \n" +
        "   ('CodeWorkout', 'https://codeworkout.cs.vt.edu', 'programming practice, LTI', 'Virginia Tech')",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM slc_item_catalog`);
  }
}
