import 'reflect-metadata';
import { AppDataSource } from '../src/db/data-source';
import { OntologyClasses } from '../src/db/entities/OntologyClass';
import { OntologyRelations } from '../src/db/entities/OntologyRelation';
import { OntologyAliases } from '../src/db/entities/OntologyAlias';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Normalizes 
 * - Replacing underscores and hyphens with spaces
 * - Converting to lowercase
 * - Trimming whitespace
 * @param label The label to normalize.
 * @returns The normalized label.
 */
const normalizeLabel = (label: string): string => {
  return label
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')     
    .trim()
    .toLowerCase();
};

/**
 * Creates OntologyClass entry 
 * @param label The label of the class.
 * @returns
 */
const createMissingClass = async (label: string): Promise<OntologyClasses> => {
  const classUri = `http://opendsa.org/ontology#${label.replace(/\s+/g, '_')}`;
  
  // Check if a class with this class_uri already exists
  const existingClass = await AppDataSource.getRepository(OntologyClasses).findOne({
    where: { class_uri: classUri },
  });

  if (existingClass) {
    console.log(`Class with URI "${classUri}" already exists as "${existingClass.label}". Using existing class.`);
    return existingClass;
  }

  const ontologyClass = new OntologyClasses();
  ontologyClass.class_uri = classUri;
  ontologyClass.label = label;
  ontologyClass.comment = `Auto-generated class for "${label}". Please update with appropriate details.`;
  ontologyClass.description = 'Auto-generated class. Description pending.';
  ontologyClass.is_active = true;

  await AppDataSource.manager.save(ontologyClass);
  console.log(`Auto-created missing class: "${ontologyClass.label}" with URI "${ontologyClass.class_uri}"`);

  return ontologyClass;
};

async function importOntologyData() {
  await AppDataSource.initialize();

  try {
    const ontologyClassesPath = path.join(__dirname, '../src/db/seed_data/ontology_classes.json');
    const ontologyRelationsPath = path.join(__dirname, '../src/db/seed_data/ontology_relations.json');
    const ontologyAliasesPath = path.join(__dirname, '../src/db/seed_data/ontology_aliases.json');

    const ontologyClassesData = JSON.parse(fs.readFileSync(ontologyClassesPath, 'utf8'));
    const ontologyRelationsData = JSON.parse(fs.readFileSync(ontologyRelationsPath, 'utf8'));
    const ontologyAliasesData = JSON.parse(fs.readFileSync(ontologyAliasesPath, 'utf8'));

    // check 'Unclassified' category exists
    const unclassifiedClassUri = 'http://opendsa.org/ontology#Unclassified';
    const existingUnclassified = await AppDataSource.getRepository(OntologyClasses).findOne({
      where: { class_uri: unclassifiedClassUri },
    });

    if (!existingUnclassified) {
      const unclassifiedClass = new OntologyClasses();
      unclassifiedClass.class_uri = unclassifiedClassUri;
      unclassifiedClass.label = 'Unclassified';
      unclassifiedClass.comment = 'Category for unclassified items';
      unclassifiedClass.description = 'Items unclassified according to current ontology categories';
      unclassifiedClass.is_active = true;

      await AppDataSource.manager.save(unclassifiedClass);
      console.log('Inserted "Unclassified" category');
    } else {
      console.log('"Unclassified" category already exists');
    }

    // Import Ontology Classes
    console.log('Importing Ontology Classes...');
    for (const classItem of ontologyClassesData) {
      try {
        const existingClass = await AppDataSource.getRepository(OntologyClasses).findOne({
          where: { class_uri: classItem.class_uri },
        });

        if (existingClass) {
          console.log(`Class "${classItem.label}" already exists. Skipping.`);
          continue;
        }

        const ontologyClass = new OntologyClasses();
        ontologyClass.class_uri = classItem.class_uri;
        ontologyClass.label = classItem.label;
        ontologyClass.comment = classItem.comment;
        ontologyClass.description = classItem['description (optional)'] || '';
        ontologyClass.is_active = classItem['is_active (default)'] !== 'FALSE';

        await AppDataSource.manager.save(ontologyClass);
        console.log(`Inserted class: "${ontologyClass.label}"`);
      } catch (error) {
        console.error(`Error inserting class "${classItem.label}":`, error);
      }
    }

    // Load all ontology classes
    const allClasses = await AppDataSource.getRepository(OntologyClasses).find();
    const classLabelMap = new Map<string, OntologyClasses>();
    allClasses.forEach((ontologyClass) => {
      const normalizedLabel = normalizeLabel(ontologyClass.label);
      classLabelMap.set(normalizedLabel, ontologyClass);
    });

    // Function to find class
    const findOrCreateClass = async (label: string): Promise<OntologyClasses> => {
      const normalized = normalizeLabel(label);
      let ontologyClass = classLabelMap.get(normalized);

      if (!ontologyClass) {
        ontologyClass = await createMissingClass(label);
        classLabelMap.set(normalized, ontologyClass);
      }

      return ontologyClass;
    };
    const missingLabels = new Set<string>();

    // Import Ontology Relations
    console.log('Importing Ontology Relations...');
    for (const relationItem of ontologyRelationsData) {
      try {
        const parentClass = await findOrCreateClass(relationItem.parent_class);
        const childClass = await findOrCreateClass(relationItem.child_class);
        const existingRelation = await AppDataSource.getRepository(OntologyRelations).findOne({
          where: {
            parent_class: { id: parentClass.id },
            child_class: { id: childClass.id },
            relationship_type: relationItem.relation_type || 'subClassOf',
          },
        });

        if (existingRelation) {
          console.log(
            `Relation "${relationItem.parent_class}" -> "${relationItem.child_class}" already exists. Skipping.`
          );
          continue;
        }

        const ontologyRelation = new OntologyRelations();
        ontologyRelation.parent_class = parentClass;
        ontologyRelation.child_class = childClass;
        ontologyRelation.relationship_type = relationItem.relation_type || 'subClassOf';

        await AppDataSource.manager.save(ontologyRelation);
        console.log(
          `Inserted relation: "${parentClass.label}" (${parentClass.id}) -> "${childClass.label}" (${childClass.id})`
        );
      } catch (error) {
        console.error(
          `Error inserting relation "${relationItem.parent_class}" -> "${relationItem.child_class}":`,
          error
        );
      }
    }

    // Import Ontology Aliases
    console.log('Importing Ontology Aliases...');
    for (const aliasItem of ontologyAliasesData) {
      try {
        const ontologyClass = await findOrCreateClass(aliasItem.ontology_class_label);

        // Check if the alias already exists
        const existingAlias = await AppDataSource.getRepository(OntologyAliases).findOne({
          where: { alias: aliasItem.alias_label },
        });

        if (existingAlias) {
          console.log(`Alias "${aliasItem.alias_label}" already exists. Skipping.`);
          continue;
        }

        const ontologyAlias = new OntologyAliases();
        ontologyAlias.alias = aliasItem.alias_label;
        ontologyAlias.class = ontologyClass;
        ontologyAlias.is_active = aliasItem['is_active (default)'] !== 'FALSE';

        await AppDataSource.manager.save(ontologyAlias);
        console.log(`Inserted alias: "${ontologyAlias.alias}"`);
      } catch (error) {
        console.error(`Error inserting alias "${aliasItem.alias_label}":`, error);
      }
    }

    // Report any missing labels
    if (missingLabels.size > 0) {
      console.warn('The following class labels referenced in relations or aliases were not found in ontology_classes.json and were auto-created:');
      missingLabels.forEach((label) => console.warn(`- "${label}"`));
      console.warn('Please review the auto-created classes for accuracy and completeness.');
    }

    console.log('Ontology data import completed successfully');
  } catch (error) {
    console.error('Error during ontology data import:', error);
  } finally {
    await AppDataSource.destroy();
  }
}

importOntologyData().catch((error) => {
  console.error('Error importing ontology data:', error);
});
