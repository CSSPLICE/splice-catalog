import { Request, Response } from 'express';
import logger from '../utils/logger.js';
// import { ValidationManager } from '../services/ValidationManager.js';
// import { ToolsCatalogController } from './ToolsCatalogController.js';
import { MetadataIssue, CategorizationResult, URLValidationResult } from '../types/ValidationTypes.js';
import { ValidationResults } from '../db/entities/ValidationResults.js';
import { AppDataSource } from '../db/data-source.js'; // Adjust the path to your data-source file
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { validate, ValidationError } from 'class-validator';

export class ReviewController {
  async validateAndReview(req: Request, res: Response) {
    const jsonArray = Array.isArray(req.body) ? req.body : [req.body];
    const validationResultsRepository = AppDataSource.getRepository(ValidationResults);
    const catalogRepository = AppDataSource.getRepository(slc_item_catalog);
    // const validationManager = new ValidationManager(validationResultsRepository, catalogRepository);
    // const toolsCatalogController = new ToolsCatalogController();

    const metadataIssues: MetadataIssue[] = [];
    const categorizationResults: CategorizationResult[] = [];
    const totalSubmissions = 0;
    const successfulVerifications = 0;
    // const allValidItems = [];
    let urlResult: URLValidationResult | undefined;

    try {
      logger.info('Starting metadata validation');

      // Separate the items by catalog type
      const slcItemCatalogs = jsonArray.filter((item) => item.catalog_type === 'SLCItem');
      const slcToolsCatalogs = jsonArray.filter((item) => item.catalog_type === 'SLCToolsCatalog');
      const errors: ValidationError[] = [];
      let saves: number = 0;
      // Process SLCItemCatalogs
      if (slcItemCatalogs.length > 0) {
        logger.info(`Processing ${slcItemCatalogs.length} SLCItemCatalog items`);

        for (const item of slcItemCatalogs) {
          const entity = catalogRepository.create(item);
          const result = await validate(entity);
          if (result.length === 0) {
            saves++;
            await catalogRepository.save(entity);
          } else {
            errors.push(...result);
          }
        }
      }

      // Process SLCToolsCatalog items
      if (slcToolsCatalogs.length > 0) {
        logger.info(`Processing ${slcToolsCatalogs.length} SLCToolsCatalog items`);
        const toolsRepository = AppDataSource.getRepository(slc_tools_catalog);
        for (const item of slcToolsCatalogs) {
          const entity = toolsRepository.create(item);
          const result = await validate(entity);
          if (result.length === 0) {
            saves++;
            await toolsRepository.save(entity);
          } else {
            errors.push(...result);
          }
        }
      }
      if (errors.length > 0) {
        console.log('Validation Errors: ', errors);
        res.status(500).send(
          errors.map((error: ValidationError) => {
            const target = error.target as slc_item_catalog | slc_tools_catalog | undefined;
            let id = 'missing id';
            if (target) {
              if ('persistentID' in target && target.persistentID) {
                id = target.persistentID;
              } else if ('id' in target && target.id) {
                id = String(target.id);
              }
            }
            return {
              id: id,
              constraints: error.constraints,
            };
          }),
        );
      } else {
        res.status(200).send(`successfully saved ${saves} entries`);
      }
      //provide metadata validation results
      const allValidationResults = await validationResultsRepository.find({
        relations: ['item'],
        order: { dateLastUpdated: 'DESC' },
      });
      if (!res.headersSent) {
        res.render('pages/review-dashboard', {
          issues: metadataIssues,
          categorizationResults,
          totalSubmissions,
          successfulVerifications,
          urlsChecked: urlResult?.urlsChecked || 0,
          successfulUrls: urlResult?.successfulUrls || 0,
          unsuccessfulUrls: urlResult?.unsuccessfulUrls || 0,
          title: 'Review Dashboard',
          urlValidationComplete: true,
          validationResults: allValidationResults,
        });
      }
    } catch (error) {
      logger.error('Error during validation:', error);
      if (!res.headersSent) {
        res.status(500).send('Error during validation');
      }
    }
  }
}
