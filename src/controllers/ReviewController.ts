import { Request, Response } from 'express';
import logger from '../utils/logger.js';
import { AppDataSource } from '../db/data-source.js'; // Adjust the path to your data-source file
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { validate, ValidationError } from 'class-validator';

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

      // Process SLCItemCatalogs
      if (slcItemCatalogs.length > 0) {
        logger.info(`Processing ${slcItemCatalogs.length} SLCItemCatalog items`);

        for (const item of slcItemCatalogs) {
          const entity = itemsRepository.create(item);
          const result = await validate(entity);
          if (result.length > 0) {
            issues.push(...result);
          }
          const hasError = result.some(
            (validationError) => {
              const constraints = validationError.constraints || {};
              const contexts = validationError.contexts || {};
              return Object.keys(constraints).some(
                (constraintName) => {
                  return contexts[constraintName]?.severity === 'error';
                }
              );
          });

          if (!hasError) {
            saves++;
            await itemsRepository.save(entity);
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
          const hasError = result.some(
            (validationError) => {
              const constraints = validationError.constraints || {};
              const contexts = validationError.contexts || {};
              return Object.keys(constraints).some(
                (constraintName) => {
                  return contexts[constraintName]?.severity === 'error';
                }
              );
          });

          if (!hasError) {
            saves++;
            await toolsRepository.save(entity);
          }
        }
      }
      // Process DatasetCatalog
      if (datasetCatalogs.length > 0) {
        logger.info(`Processing ${datasetCatalogs.length} SLCToolsCatalog items`);
        for (const item of datasetCatalogs) {
          const entity = datasetRepository.create(item);
          const result = await validate(entity);
          if (result.length > 0) {
            issues.push(...result);
          }
          const hasError = result.some(
            (validationError) => {
              const constraints = validationError.constraints || {};
              const contexts = validationError.contexts || {};
              return Object.keys(constraints).some(
                (constraintName) => {
                  return contexts[constraintName]?.severity === 'error';
                }
              );
          });

          if (!hasError) {
            saves++;
            await datasetRepository.save(entity);
          }
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
        console.log('Validation Errors: ', processed_errors);
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
