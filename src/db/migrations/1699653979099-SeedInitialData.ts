import { MigrationInterface, QueryRunner } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export class SeedInitialData1699653979099 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    try {     
      // Inserting initial data into slc_item_catalog
      await queryRunner.query(
        // 'INSERT IGNORE INTO slc_item_catalog (id, platform_name, url, keywords, institution) VALUES \n' +
        // "   (1, 'OpenDSA', 'https://opendsa-server.cs.vt.edu', 'eTextbook, LTI', 'Virginia Tech'), \n" +
        // "   (2, 'CodeWorkout', 'https://codeworkout.cs.vt.edu', 'programming practice, LTI', 'Virginia Tech')",
        `INSERT IGNORE INTO slc_item_catalog (platform_name, url, keywords, institution) VALUES 
        ('OpenDSA', 'https://opendsa-server.cs.vt.edu', '["eTextbook", "LTI"]', 'Virginia Tech'),
        ('CodeWorkout', 'https://codeworkout.cs.vt.edu', '["programming practice", "LTI"]', 'Virginia Tech')`
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

      // Check "Unclassified" category exists
      console.log('Checking for "Unclassified" category in ontology_classes');
      const unclassifiedClass = await queryRunner.query(
        `SELECT * FROM ontology_classes WHERE label = 'Unclassified'`
      );

      if (unclassifiedClass.length === 0) {
        console.log('Inserting "Unclassified" category');
        await queryRunner.query(
          `INSERT INTO ontology_classes (class_uri, label, comment, description, is_active)
          VALUES (?, ?, ?, ?, ?);`,
          [
            'http://opendsa.org/ontology#Unclassified', 
            'Unclassified', 
            'Category for unclassified items', 
            'Items unclassified iaccoeding to current ontology category', 
            true
          ]
        );
      } else {
        console.log('"Unclassified" category already exists');
      }

      // Seeding ontology_classes
      console.log('Seeding ontology_classes');
      const ontologyClassesPath = path.join(__dirname, '../seed_data/ontology_classes.json');
      const ontologyClasses = JSON.parse(fs.readFileSync(ontologyClassesPath, 'utf8'));
      
      for (const ontologyClass of ontologyClasses) {
        console.log(`Inserting class: ${ontologyClass.label}`);
        await queryRunner.query(
          `INSERT IGNORE INTO ontology_classes (class_uri, label, comment, description, is_active)
          VALUES (?, ?, ?, ?, ?);`,
          [ontologyClass.class_uri, ontologyClass.label, ontologyClass.comment, ontologyClass.description, true]
        );
      }

      // Seeding ontology_relations with adjusted query to handle class_uri fragment
      console.log('Seeding ontology_relations');
      const ontologyRelationsPath = path.join(__dirname, '../seed_data/ontology_relations.json');
      const ontologyRelations = JSON.parse(fs.readFileSync(ontologyRelationsPath, 'utf8'));

      for (const relation of ontologyRelations) {
        console.log('Inserting relation:', relation.parent_class, '->', relation.child_class);
        await queryRunner.query(
          `INSERT IGNORE INTO ontology_relations (parent_class_id, child_class_id, relationship_type)
          VALUES (
            (SELECT id FROM ontology_classes WHERE SUBSTRING_INDEX(class_uri, '#', -1) = ?),
            (SELECT id FROM ontology_classes WHERE SUBSTRING_INDEX(class_uri, '#', -1) = ?),
            ?);`,
          [relation.parent_class, relation.child_class, relation.relation_type]
        );
      }

      console.log('Migration completed successfully');
    } catch (error) {
      console.error('Error during migration:', error);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM slc_item_catalog`);
    await queryRunner.query(`DELETE FROM slc_tools_catalog`);
    await queryRunner.query(`DELETE FROM ontology_classes`);
    await queryRunner.query(`DELETE FROM ontology_relations`);
  }
}
