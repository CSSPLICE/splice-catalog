import { Request, Response } from 'express';
import logger from '../utils/logger.js';
import { ValidationManager } from '../services/ValidationManager.js';
import { ToolsCatalogController } from './ToolsCatalogController.js';
import { MetadataIssue, CategorizationResult, URLValidationResult } from '../types/ValidationTypes.js';
import { ValidationResults } from '../db/entities/ValidationResults.js';
import { AppDataSource } from '../db/data-source.js'; // Adjust the path to your data-source file
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import {plainToInstance} from "class-transformer";
import {CreateSLCItemDTO} from "../dtos/SLCItemDTO.js";
import {validate} from "class-validator";

export class ReviewController {
  async validateAndReview(req: Request, res: Response) {
    const jsonArray = Array.isArray(req.body) ? req.body : [req.body];
    const validationResultsRepository = AppDataSource.getRepository(ValidationResults);
    const catalogRepository = AppDataSource.getRepository(slc_item_catalog);
    const validationManager = new ValidationManager(validationResultsRepository, catalogRepository);
    const toolsCatalogController = new ToolsCatalogController();

    let metadataIssues: MetadataIssue[] = [];
    let categorizationResults: CategorizationResult[] = [];
    let totalSubmissions = 0;
    let successfulVerifications = 0;
    let allValidItems = [];
    let urlResult: URLValidationResult | undefined;

    try {
      logger.info('Starting metadata validation');

      // Separate the items by catalog type
      const slcItemCatalogs = jsonArray.filter((item) => item.catalog_type === 'SLCItem');
      const slcToolsCatalogs = jsonArray.filter((item) => item.catalog_type === 'SLCToolsCatalog');

      // Process SLCItemCatalogs
      if (slcItemCatalogs.length > 0) {
        logger.info(`Processing ${slcItemCatalogs.length} SLCItemCatalog items`);

        // // Validate metadata
        // const metadataResult = await validationManager.validateMetadata(slcItemCatalogs);
        // metadataIssues = metadataResult.issues as MetadataIssue[];
        // successfulVerifications += metadataResult.successfulVerifications;
        // totalSubmissions += metadataResult.totalSubmissions;
        // allValidItems = metadataResult.validItems;
        //
        // if (res.locals.io) {
        //   res.locals.io.emit('metadataValidationComplete', metadataResult);
        // }

        // // URL Validation
        // logger.info('Starting URL validation for SLCItemCatalog');
        // urlResult = await validationManager.validateUrls(allValidItems);
        // const { urlsChecked, successfulUrls } = urlResult;
        // if (res.locals.io) {
        //   res.locals.io.emit('urlValidationComplete', urlResult);
        // }
        // logger.info(`URL Validation Completed: ${successfulUrls}/${urlsChecked} successful`);

        // // Categorization Process
        // logger.info('Starting category report generation for validated items');
        // const categoryReport = await validationManager.generateCategoryReport(allValidItems);
        // if (res.locals.io) {
        //   res.locals.io.emit('categoryReportComplete', categoryReport);
        // }

        // // Store and classify all items
        // try {
        //   logger.info('Starting storage and classification of all valid items');
        //   await validationManager.storeAndClassifyItems(categoryReport);
        //   logger.info('Successfully stored and classified all items');
        // } catch (error) {
        //   logger.error('Error in storing and classifying items:', error);
        // }

        // categorizationResults = [
        //   ...categoryReport.matched.map((item) => ({
        //     item: item.item.exercise_name,
        //     status: 'success' as const,
        //     matchedClass: item.matchedClass,
        //   })),
        //   ...categoryReport.unclassified.map((item) => ({
        //     item: item.item.exercise_name,
        //     status: 'Unclassified' as const,
        //     matchedClass: 'Unclassified',
        //   })),
        //   ...categoryReport.unmatched.map((item) => ({
        //     item: item.item.exercise_name,
        //     status: 'failed' as const,
        //     matchedClass: 'None',
        //   })),
        // ];
        // if (res.locals.io) {
        //   res.locals.io.emit('categorizationComplete', categorizationResults);
        // }

        for (const item of slcItemCatalogs) {
          const dto = plainToInstance(CreateSLCItemDTO, item)
          const result = await validate(dto)
          if (result.length === 0) {
            const entity = catalogRepository.create(item)
            await catalogRepository.save(entity)
          }
          else {
            console.log(`Error: ${result.length} validation issues:`, result)
            throw new Error("Failed: Validation Issues");
          }
        }
      }

      // Process SLCToolsCatalog items
      if (slcToolsCatalogs.length > 0) {
        logger.info(`Processing ${slcToolsCatalogs.length} SLCToolsCatalog items`);
        slcToolsCatalogs.forEach(async () => {
          try {
            await toolsCatalogController.createToolsCatalogItem(req, res);
          } catch (error) {
            logger.error(`Error processing tools catalog item:`, error);
          }
        });
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
          user: req.oidc.user,
          showLoginButton: res.locals.showLoginButton,
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
