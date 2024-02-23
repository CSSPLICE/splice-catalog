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
    // Inserting initial data into slc_tools_catalog
    await queryRunner.query(`
      INSERT IGNORE INTO slc_tools_catalog (platform_name, url, tool_description, license, standard_support, keywords, contact_email) VALUES 
        ('OpenDSA', 'https://opendsa-server.cs.vt.edu', 'Interactive eTextbook for Data Structures and Algorithms.', 'CC BY-NC-SA 4.0', 'LTI', 'Data Structures, Algorithms, Interactive Learning', 'opendsa@cs.vt.edu'),
        ('CodeWorkout', 'https://codeworkout.cs.vt.edu', 'Exercise platform offering coding practice.', 'CC BY-NC-SA 4.0', 'LTI', 'Programming, Practice, Auto-assessment', 'codeworkout@cs.vt.edu')
    `);




  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM slc_item_catalog`);
    await queryRunner.query(`DELETE FROM slc_tools_catalog`);
  }
}
