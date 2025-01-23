import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';
import { validate } from 'class-validator';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { ResponseUtil } from '../utils/Response';
import logger from '../utils/logger';
import { ValidationManager } from '../services/ValidationManager';
import { ToolsCatalogController } from './ToolsCatalogController';
import { MetadataIssue, CategorizationResult } from '../types/ValidationTypes';

export class ReviewController {
  async validateAndReview(req: Request, res: Response) {
    const jsonArray = Array.isArray(req.body) ? req.body : [req.body];
    const validationManager = new ValidationManager();
    const toolsCatalogController = new ToolsCatalogController();

    let metadataIssues: MetadataIssue[] = [];
    let categorizationResults: CategorizationResult[] = [];
    let totalSubmissions = 0;
    let successfulVerifications = 0;
    let allValidItems = [];

    try {
      logger.info('Starting metadata validation');

      // Separate the items by catalog type
      const slcItemCatalogs = jsonArray.filter((item) => item.catalog_type === 'SLCItemCatalog');
      const slcToolsCatalogs = jsonArray.filter((item) => item.catalog_type === 'SLCToolsCatalog');

      // Process SLCItemCatalogs
      if (slcItemCatalogs.length > 0) {
        logger.info(`Processing ${slcItemCatalogs.length} SLCItemCatalog items`);

        // Validate metadata
        const metadataResult = await validationManager.validateMetadata(slcItemCatalogs);
        metadataIssues = metadataResult.issues as MetadataIssue[];
        successfulVerifications += metadataResult.successfulVerifications;
        totalSubmissions += metadataResult.totalSubmissions;
        allValidItems = metadataResult.validItems;

        if (res.locals.io) {
          res.locals.io.emit('metadataValidationComplete', metadataResult);
        }

        // URL Validation
        logger.info('Starting URL validation for SLCItemCatalog');
        const urlResult = await validationManager.validateUrls(allValidItems);
        if (res.locals.io) {
          res.locals.io.emit('urlValidationComplete', urlResult);
        }
        logger.info(`URL Validation Completed: ${urlResult.urlsChecked} checked`);

        // Categorization Process
        logger.info('Starting category report generation for validated items');
        const categoryReport = await validationManager.generateCategoryReport(allValidItems);
        if (res.locals.io) {
          res.locals.io.emit('categoryReportComplete', categoryReport);
        }

        categorizationResults = [
          ...categoryReport.matched.map((item) => ({
            item: item.item.exercise_name,
            status: 'Matched',
            matchedClass: item.matchedClass,
          })),
          ...categoryReport.unclassified.map((item) => ({
            item: item.item.exercise_name,
            status: 'Unclassified',
            matchedClass: 'Unclassified',
          })),
          ...categoryReport.unmatched.map((item) => ({
            item: item.item.exercise_name,
            status: 'Unmatched',
            matchedClass: 'None',
          })),
        ];
        if (res.locals.io) {
          res.locals.io.emit('categorizationComplete', categorizationResults);
        }
      }

      // Process SLCToolsCatalog
      for (const item of slcToolsCatalogs) {
        logger.info('Processing SLCToolsCatalog');
        await toolsCatalogController.createToolsCatalogItem(req, res);
      }

      // Provide metadata validation results
      res.render('pages/review-dashboard', {
        issues: metadataIssues,
        categorizationResults,
        totalSubmissions,
        successfulVerifications,
        urlsChecked: 0,
        successfulUrls: 0,
        unsuccessfulUrls: 0,
        title: 'Review Dashboard',
        urlValidationComplete: false,
      });
    } catch (error) {
      logger.error('Error during validation:', error);
      if (!res.headersSent) {
        res.status(500).send('Error during validation');
      }
    }
  }
}
