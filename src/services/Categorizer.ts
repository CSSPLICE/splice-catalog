import { AppDataSource } from '../db/data-source';
import { ItemClassification } from '../db/entities/ItemClassification';
import { OntologyClasses } from '../db/entities/OntologyClass';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';
import { SLCItem,  MatchedItem } from '../types/ItemTypes';
import logger from '../utils/logger';

export class Categorizer {
  private itemRepo = AppDataSource.getRepository(slc_item_catalog);
  private classificationRepo = AppDataSource.getRepository(ItemClassification); 
  private ontologyRepo = AppDataSource.getRepository(OntologyClasses);

  /**
   * Stores items in the catalog and classifies them based on the ontology classes.
   * @param items Items to be stored and classified.
   * @param matchedItems Matched items with their corresponding classes.
   */
  public async storeItemsAndClassify(items: SLCItem[], matchedItems: MatchedItem[]) {
    for (const item of items) {
      try {
        //Find or insert the item in slc_item_catalog
        let itemRecord = await this.itemRepo.findOne({ where: { exercise_name: item.exercise_name } });

        if (!itemRecord) {
          logger.info(`Inserting new item into slc_item_catalog: ${item.exercise_name}`);
          itemRecord = await this.itemRepo.save(item);
          logger.info(`Inserted item with ID: ${itemRecord?.id} for exercise: ${item.exercise_name}`);
        } else {
          logger.info(`Found existing item with ID: ${itemRecord.id} for exercise: ${item.exercise_name}`);
        }

        if (!itemRecord || !itemRecord.id) {
          logger.error(`Item ${item.exercise_name} could not be saved or retrieved from slc_item_catalog.`);
          continue;  // Skip if itemRecord is null
        }

        //Find or assign class
        const matchedItem = matchedItems.find(m => m.item.exercise_name === item.exercise_name);
        let classEntity: OntologyClasses | null = null;

        if (matchedItem && matchedItem.matchedClass) {
          classEntity = await this.ontologyRepo.findOne({ where: { label: matchedItem.matchedClass } });
        }

        if (!classEntity) {
          logger.info(`Assigning 'Unclassified' class to item ${item.exercise_name}`);
          classEntity = await this.ontologyRepo.findOne({ where: { label: 'Unclassified' } });
          if (!classEntity) {
            logger.error(`"Unclassified" class not found in ontology.`);
            continue;
          }
        }

        // Create classification instance by assigning entities directly
        const classification = this.classificationRepo.create({
          item: itemRecord,       
          ontologyClass: classEntity,    
        });

        // Log the classification object to ensure values are set correctly
        logger.debug(`Prepared classification: ${JSON.stringify(classification, null, 2)}`);
        logger.info(`Saving classification for item_id: ${itemRecord.id}, class_id: ${classEntity.id}`);

        await this.classificationRepo.save(classification);

        logger.info(`Successfully classified item ${item.exercise_name} under class ${classEntity.label}`);
      } catch (error) {
        logger.error(`Failed to classify item ${item.exercise_name}:`, error);
      }
    }
  }
}

