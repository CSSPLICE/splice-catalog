import { Request, Response } from 'express';
import logger from '../utils/logger.js';
import { AppDataSource } from '../db/data-source.js'; // Adjust the path to your data-source file
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { validate, ValidationError } from 'class-validator';
import { meilisearchService } from '../services/MeilisearchService.js';
import { In } from 'typeorm';

const hasBlockingValidationError = (validationErrors: ValidationError[]): boolean => {
  return validationErrors.some((validationError) => {
    const constraints = validationError.constraints || {};
    const contexts = validationError.contexts || {};
    return Object.keys(constraints).some((constraintName) => {
      return contexts[constraintName]?.severity === 'error';
    });
  });
};

export class ReviewController {
  async validateAndReview(req: Request, res: Response) {
    const jsonArray = Array.isArray(req.body) ? req.body : [req.body];
    const itemsRepository = AppDataSource.getRepository(slc_item_catalog);
    const toolsRepository = AppDataSource.getRepository(slc_tools_catalog);
    const datasetRepository = AppDataSource.getRepository(dataset_catalog);
    try {
      logger.info('Starting metadata validation');

      // Separate the items by catalog type
      const slcItemCatalogs = jsonArray.filter((item) => item.catalog_type === 'SLCItem');
      const slcToolsCatalogs = jsonArray.filter((item) => item.catalog_type === 'SLCToolsCatalog');
      const datasetCatalogs = jsonArray.filter((item) => item.catalog_type === 'DatasetCatalog');

      const issues: ValidationError[] = [];
      let saves: number = 0;
      const validSlcEntities: slc_item_catalog[] = [];
      const validToolEntities: slc_tools_catalog[] = [];
      const validDatasetEntities: dataset_catalog[] = [];
      const seenSlcPersistentIds = new Set<string>();

      // Process SLCItemCatalogs
      if (slcItemCatalogs.length > 0) {
        logger.info(`Processing ${slcItemCatalogs.length} SLCItemCatalog items`);

        for (const item of slcItemCatalogs) {
          const persistentID = typeof item.persistentID === 'string' ? item.persistentID.trim() : '';
          if (!persistentID) {
            continue;
          }
          if (seenSlcPersistentIds.has(persistentID)) {
            continue;
          }

          const entity = itemsRepository.create(item);
          const result = await validate(entity);
          if (result.length > 0) {
            issues.push(...result);
          }
          const hasError = hasBlockingValidationError(result);

          if (!hasError) {
            saves++;
            seenSlcPersistentIds.add(persistentID);
            validSlcEntities.push(entity);
          }
        }

        if (validSlcEntities.length > 0) {
          const persistentIds = validSlcEntities.map((entity) => entity.persistentID);
          const existingItems = await itemsRepository.find({
            where: { persistentID: In(persistentIds) },
            select: { persistentID: true },
          });
          const existingPersistentIds = new Set(existingItems.map((item) => item.persistentID));
          const newSlcEntities = validSlcEntities.filter((entity) => !existingPersistentIds.has(entity.persistentID));
          saves -= validSlcEntities.length - newSlcEntities.length;

          if (newSlcEntities.length > 0) {
            await itemsRepository.insert(newSlcEntities);
          }

          try {
            if (newSlcEntities.length > 0) {
              await meilisearchService.indexCatalogItems(newSlcEntities);
            }
            logger.info(`Indexed ${newSlcEntities.length} new SLCItemCatalog items in Meilisearch`);
          } catch (error) {
            logger.error('Failed to batch index uploaded SLCItemCatalog items:', error);
          }
        }
      }

      // Process SLCToolsCatalog
      if (slcToolsCatalogs.length > 0) {
        logger.info(`Processing ${slcToolsCatalogs.length} SLCToolsCatalog items`);
        for (const item of slcToolsCatalogs) {
          const entity = toolsRepository.create(item);
          const result = await validate(entity);
          if (result.length > 0) {
            issues.push(...result);
          }
          const hasError = hasBlockingValidationError(result);

          if (!hasError) {
            saves++;
            validToolEntities.push(entity);
          }
        }

        if (validToolEntities.length > 0) {
          await toolsRepository.save(validToolEntities, { chunk: 100 });
        }
      }
      // Process DatasetCatalog
      if (datasetCatalogs.length > 0) {
        logger.info(`Processing ${datasetCatalogs.length} DatasetCatalog items`);
        for (const item of datasetCatalogs) {
          const entity = datasetRepository.create(item);
          const result = await validate(entity);
          if (result.length > 0) {
            issues.push(...result);
          }
          const hasError = hasBlockingValidationError(result);

          if (!hasError) {
            saves++;
            validDatasetEntities.push(entity);
          }
        }

        if (validDatasetEntities.length > 0) {
          await datasetRepository.save(validDatasetEntities, { chunk: 100 });
        }
      }
      function hasPersistentID(obj: object): obj is { persistentID: string } {
        return Object.prototype.hasOwnProperty.call(obj, 'persistentID');
      }

      const processed_errors = issues.map((error: ValidationError) => {
        let persistentID = 'missing id';
        if (error.target && typeof error.target === 'object' && hasPersistentID(error.target)) {
          persistentID = error.target.persistentID;
        }
        const richConstraints: Record<string, { message: string; severity: string }> = {};
        if (error.constraints) {
          Object.entries(error.constraints).forEach(([key, message]) => {
            const context = error.contexts ? error.contexts[key] : undefined;
            const severity = context?.severity || 'error';
            richConstraints[key] = {
              message: message,
              severity: severity,
            };
          });
        }
        return {
          persistentID: persistentID,
          property: error.property,
          constraints: richConstraints,
        };
      });

      if (processed_errors.length > 0) {
        logger.warn(`Validation completed with ${processed_errors.length} issues.`);
      }

      res.status(200).render('pages/review', {
        title: 'Review Dashboard',
        saves: saves,
        errors: processed_errors,
      });
    } catch (error) {
      logger.error('Error during validation:', error);
      console.log(error);
      if (!res.headersSent) {
        res.status(500).send('Error during validation');
      }
    }
  }
}
