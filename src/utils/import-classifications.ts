import 'reflect-metadata';
import { AppDataSource } from '../db/data-source';
import { OntologyClasses } from '../db/entities/OntologyClass';
import { OntologyAliases } from '../db/entities/OntologyAlias';
import { OntologyRelations } from '../db/entities/OntologyRelation';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';
import { ItemClassification } from '../db/entities/ItemClassification';
import * as winston from 'winston';
import { lemmatizer } from 'lemmatizer'; 

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(
      ({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'import-classifications.log' }),
  ],
});


// Defines a set of stop words to be removed
const stopWords = new Set([
  'exercise', 'sum', 'count', 'check',
  'largest', 'multiply', 'gcd', 'is', 'reverse', 'add', 'of', 'the',
  'and', 'by'
]);

/**
 * @param words 
 * @param n 
 * @returns 
 */
const generateNGrams = (words: string[], n: number): string[] => {
  const ngrams: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '));
  }
  return ngrams;
};

/**
 * Normalizes strings 
 * @param text 
 * @returns 
 */
const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')  // Replace underscores and hyphens with spaces
    .replace(/[^a-z0-9 ]/g, '')       
    .replace(/\s+/g, ' ')             
    .trim()
    .split(' ')
    .filter(word => !stopWords.has(word)) 
    .map(word => lemmatizer(word))   
    .join(' ');
};


const initializeDataSource = async () => {
  try {
    await AppDataSource.initialize();
    logger.info('Data Source has been initialized.');
  } catch (error) {
    logger.error(`Error initializing Data Source: ${error}`);
    process.exit(1);
  }
};

/**
 * Builds a lookup map 
 * @returns normalized terms(key) and OntologyClasses(values)
 */
const buildOntologyLookupMap = async (): Promise<Map<string, OntologyClasses>> => {
  const ontologyClassRepository = AppDataSource.getRepository(OntologyClasses);
  const ontologyAliasRepository = AppDataSource.getRepository(OntologyAliases);

  const ontologyClasses = await ontologyClassRepository.find({
    relations: ['aliases'],
    where: { is_active: true },
  });

  const lookupMap: Map<string, OntologyClasses> = new Map();

  ontologyClasses.forEach((ontologyClass) => {
    const normalizedLabel = normalizeText(ontologyClass.label);
    if (normalizedLabel) { 
      lookupMap.set(normalizedLabel, ontologyClass);
      logger.debug(`Added class label to lookup: "${normalizedLabel}" -> ID ${ontologyClass.id}`);
    } else {
      logger.warn(`Skipped empty label for Ontology Class ID ${ontologyClass.id}`);
    }

    ontologyClass.aliases.forEach((alias) => {
      if (alias.is_active) { 
        const normalizedAlias = normalizeText(alias.alias);
        if (normalizedAlias) { 
          lookupMap.set(normalizedAlias, ontologyClass);
          logger.debug(`Added alias to lookup: "${normalizedAlias}" -> ID ${ontologyClass.id}`);
        } else {
          logger.warn(`Skipped empty alias for Ontology Class ID ${ontologyClass.id}`);
        }
      }
    });
  });

  logger.info(`Loaded ${ontologyClasses.length} ontology classes with aliases.`);
  return lookupMap;
};

/**
 * Builds a hierarchical of ontology classes
 * @returns child class ID (key) and parent OntologyClasses(value)
 */
const buildOntologyHierarchyMap = async (): Promise<Map<number, OntologyClasses[]>> => {
  const ontologyRelationRepository = AppDataSource.getRepository(OntologyRelations);
  const relations = await ontologyRelationRepository.find({
    relations: ['parent_class', 'child_class'],
  });

  const hierarchyMap: Map<number, OntologyClasses[]> = new Map();

  relations.forEach((relation) => {
    const parent = relation.parent_class;
    const childId = relation.child_class.id;

    if (!hierarchyMap.has(childId)) {
      hierarchyMap.set(childId, []);
    }
    hierarchyMap.get(childId)!.push(parent);
  });

  logger.info(`Loaded ${relations.length} ontology relations.`);
  return hierarchyMap;
};

/**
 * Fetches the "Unclassified" ontology class entity.
 * @returns The OntologyClasses entity
 */
const getUnclassifiedClass = async (): Promise<OntologyClasses> => {
  const ontologyClassRepository = AppDataSource.getRepository(OntologyClasses);
  const unclassifiedClass = await ontologyClassRepository.findOne({
    where: { label: 'Unclassified' },
  });

  if (!unclassifiedClass) {
    logger.error('Unclassified ontology class not found. Please ensure it exists.');
    process.exit(1);
  }

  logger.info(`"Unclassified" class ID: ${unclassifiedClass.id}`);
  return unclassifiedClass;
};

/**
 * Fetches all items from the slc_item_catalog.
 * @returns slc_item_catalog items.
 */
const fetchAllItems = async (): Promise<slc_item_catalog[]> => {
  const itemCatalogRepository = AppDataSource.getRepository(slc_item_catalog);
  const items = await itemCatalogRepository.find();
  logger.info(`Fetched ${items.length} items from slc_item_catalog.`);
  return items;
};

/**
 * Processes and classifies each item in the slc_item_catalog.
 * @param items
 * @param lookupMap 
 * @param hierarchyMap 
 * @param unclassifiedClass 
 */
const processItems = async (
  items: slc_item_catalog[],
  lookupMap: Map<string, OntologyClasses>,
  hierarchyMap: Map<number, OntologyClasses[]>,
  unclassifiedClass: OntologyClasses
) => {
  const itemClassificationRepository = AppDataSource.getRepository(ItemClassification);

  let classifiedCount = 0;
  let unclassifiedCount = 0;

  const ontologyKeys = Array.from(lookupMap.keys());

  for (const item of items) {
    const classifications: Set<OntologyClasses> = new Set();

    // Extract and normalize keywords and exercise_name
    let keywords: string[] = [];
    if (item.keywords) {
      try {
        keywords = Array.isArray(item.keywords) ? item.keywords : JSON.parse(item.keywords as any);
        if (!Array.isArray(keywords)) {
          logger.warn(`Item ID ${item.id}: Keywords field is not an array after parsing.`);
          keywords = [];
        }
      } catch (error) {
        logger.error(`Item ID ${item.id}: Error parsing keywords JSON - ${error}`);
        keywords = [];
      }
    }
    const exerciseName: string = item.exercise_name || '';

    const terms = [...keywords, exerciseName]
      .map(term => normalizeText(term))
      .filter(term => term.length > 0);

    logger.debug(`Processing Item ID ${item.id} with terms: [${terms.join(', ')}]`);

    for (const term of terms) {
      if (lookupMap.has(term)) {
        const ontologyClass = lookupMap.get(term)!;
        classifications.add(ontologyClass);
        logger.debug(`Exact match: "${term}" -> Class ID ${ontologyClass.id}`);

        // Add parent classes
        if (hierarchyMap.has(ontologyClass.id)) {
          hierarchyMap.get(ontologyClass.id)!.forEach(parentClass => {
            classifications.add(parentClass);
            logger.debug(`Also adding parent class ID ${parentClass.id} for class ID ${ontologyClass.id}`);
          });
        }
        continue; 
      } else {
        logger.debug(`No exact match found for term "${term}" in item ID ${item.id}`);
      }

      // Token-based matching
      const tokens = term.split(' ');
      for (const token of tokens) {
        if (lookupMap.has(token)) {
          const ontologyClass = lookupMap.get(token)!;
          classifications.add(ontologyClass);
          logger.debug(`Token match: "${token}" -> Class ID ${ontologyClass.id}`);

          // Add parent classes
          if (hierarchyMap.has(ontologyClass.id)) {
            hierarchyMap.get(ontologyClass.id)!.forEach(parentClass => {
              classifications.add(parentClass);
              logger.debug(`Also adding parent class ID ${parentClass.id} for class ID ${ontologyClass.id}`);
            });
          }
        }
      }

      const biGrams = generateNGrams(tokens, 2);
      const triGrams = generateNGrams(tokens, 3);

      const matchNGrams = (ngrams: string[]) => {
        for (const ngram of ngrams) {
          if (lookupMap.has(ngram)) {
            const ontologyClass = lookupMap.get(ngram)!;
            classifications.add(ontologyClass);
            logger.debug(`N-gram match: "${ngram}" -> Class ID ${ontologyClass.id}`);

            // Add parent classes
            if (hierarchyMap.has(ontologyClass.id)) {
              hierarchyMap.get(ontologyClass.id)!.forEach(parentClass => {
                classifications.add(parentClass);
                logger.debug(`Also adding parent class ID ${parentClass.id} for class ID ${ontologyClass.id}`);
              });
            }
          }
        }
      };

      matchNGrams(triGrams);
      matchNGrams(biGrams);

      ontologyKeys.forEach(ontologyKey => {
        if (ontologyKey && term.includes(ontologyKey)) { 
          const ontologyClass = lookupMap.get(ontologyKey)!;
          classifications.add(ontologyClass);
          logger.debug(`Substring match: "${ontologyKey}" found in term "${term}" -> Class ID ${ontologyClass.id}`);

          // Add parent classes
          if (hierarchyMap.has(ontologyClass.id)) {
            hierarchyMap.get(ontologyClass.id)!.forEach(parentClass => {
              classifications.add(parentClass);
              logger.debug(`Also adding parent class ID ${parentClass.id} for class ID ${ontologyClass.id}`);
            });
          }
        }
      });
    }

    // If no classifications found, assign to "Unclassified"
    if (classifications.size === 0) {
      classifications.add(unclassifiedClass);
      unclassifiedCount += 1;
      logger.info(`Item ID ${item.id} classified as "Unclassified".`);
    } else {
      classifiedCount += 1;
      logger.info(`Item ID ${item.id} classified under ${classifications.size} classes.`);
    }

    // Prepare classification entries
    const classificationEntries = Array.from(classifications).map(ontologyClass => {
      const classification = new ItemClassification();
      classification.item = item; 
      classification.ontologyClass = ontologyClass; 
      return classification;
    });

    try {
      await itemClassificationRepository.save(classificationEntries);
      logger.debug(`Classifications saved for item ID ${item.id}.`);
    } catch (error) {
      logger.error(`Error saving classifications for item ID ${item.id}: ${error}`);
    }
  }

  logger.info(`Classification Summary: ${classifiedCount} classified items, ${unclassifiedCount} unclassified items.`);
};


 //execute the import and classification process.
const importAndClassify = async () => {
  await initializeDataSource();

  try {
    const lookupMap = await buildOntologyLookupMap();
    const hierarchyMap = await buildOntologyHierarchyMap();
    const unclassifiedClass = await getUnclassifiedClass();
    const items = await fetchAllItems();

    if (items.length === 0) {
      logger.warn('No items found in slc_item_catalog to classify.');
      return;
    }

    await processItems(items, lookupMap, hierarchyMap, unclassifiedClass);

    logger.info('Import and classification process completed successfully.');
  } catch (error) {
    logger.error(`Error during import and classification process: ${error}`);
  } finally {
    await AppDataSource.destroy();
    logger.info('Data Source has been destroyed.');
  }
};

// Execute the import and classification process
importAndClassify().catch(error => {
  logger.error(`Unhandled error: ${error}`);
  process.exit(1);
});
