import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedInitialData1699653979099 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      // 'INSERT IGNORE INTO slc_item_catalog (id, platform_name, url, keywords, institution) VALUES \n' +
      'INSERT IGNORE INTO slc_item_catalog (platform_name, url, keywords, institution) VALUES \n' +
        // "   (1, 'OpenDSA', 'https://opendsa-server.cs.vt.edu', 'eTextbook, LTI', 'Virginia Tech'), \n" +
        // "   (2, 'CodeWorkout', 'https://codeworkout.cs.vt.edu', 'programming practice, LTI', 'Virginia Tech')",
        "   ('OpenDSA', 'https://opendsa-server.cs.vt.edu', 'eTextbook, LTI', 'Virginia Tech'), \n" +
        "   ('CodeWorkout', 'https://codeworkout.cs.vt.edu', 'programming practice, LTI', 'Virginia Tech')"
    );
    // Inserting initial data into slc_tools_catalog
    await queryRunner.query(`
      INSERT IGNORE INTO slc_tools_catalog (platform_name, url, tool_description, license, standard_support, keywords, contact_email) VALUES 
        ('OpenDSA', 'https://opendsa-server.cs.vt.edu', 'Interactive eTextbook for Data Structures and Algorithms.', 'CC BY-NC-SA 4.0', 'LTI', 'Data Structures, Algorithms, Interactive Learning', 'opendsa@cs.vt.edu'),
        ('CodeWorkout', 'https://codeworkout.cs.vt.edu', 'Exercise platform offering coding practice.', 'CC BY-NC-SA 4.0', 'LTI', 'Programming, Practice, Auto-assessment', 'codeworkout@cs.vt.edu')
    `);

    // Inserting initial data into dataset_catalog
    await queryRunner.query(`
      INSERT INTO dataset_catalog 
      (title, platform, datasetName, url, description, dataFormats, dataType, keywords, population, contributors, language, publicationYear) 
      VALUES 
      (
        'CS1 Intro Programming', 
        'DataShop', 
        'CS1 Intro Programming', 
        'https://datashop.web.cmu.edu/DatasetInfo?datasetId=1234', 
        'A dataset of introductory programming course interactions.', 
        'DataShop,ProgSnap2,CSV', 
        'Programming,Interaction', 
        'programming,cs1,student interactions', 
        'Undergraduate Students', 
        '[{\"name\":\"John Doe\",\"affiliation\":\"Carnegie Mellon University\"}]', 
        'Python', 
        2020
      ),
      (
        'Algorithms and Data Structures', 
        'OpenDSA', 
        'Algorithms and Data Structures', 
        'https://opendsa-server.cs.vt.edu/DatasetInfo?datasetId=5678', 
        'A dataset of algorithms and data structures course interactions.', 
        'DataShop,ProgSnap2,CSV', 
        'Algorithms,Data Structures', 
        'algorithms,data structures,sorting,searching', 
        'Undergraduate Students', 
        '[{\"name\":\"Jane Smith\",\"affiliation\":\"Virginia Tech\"}]', 
        'Python', 
        2021
      )
    `);


  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM slc_item_catalog`);
    await queryRunner.query(`DELETE FROM slc_tools_catalog`);
    await queryRunner.query(`DELETE FROM dataset_catalog`);
  }
}
