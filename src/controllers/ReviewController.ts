import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';
import { validate } from 'class-validator';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { ResponseUtil } from '../utils/Response';
import logger from '../utils/logger';
import { ValidationManager } from '../services/ValidationManager';
import { ToolsCatalogController } from './ToolsCatalogController';

export class ReviewController {
  async validateAndReview(req: Request, res: Response) {
    const jsonArray = Array.isArray(req.body) ? req.body : [req.body]; 
    const validationManager = new ValidationManager();
    const toolsCatalogController = new ToolsCatalogController();

    let metadataIssues = [];
    let totalSubmissions = 0;
    let successfulVerifications = 0;
    let allValidItems = [];

    try {
      logger.info('Starting metadata validation');

      // Separate the items by catalog type
      const slcItemCatalogs = jsonArray.filter(item => item.catalog_type === 'SLCItemCatalog');
      const slcToolsCatalogs = jsonArray.filter(item => item.catalog_type === 'SLCToolsCatalog');

      // Process SLCItemCatalogs
      if (slcItemCatalogs.length > 0) {
        logger.info(`Processing ${slcItemCatalogs.length} SLCItemCatalog items`);
        
        // Validate metadata 
        const metadataResult = await validationManager.validateMetadata(slcItemCatalogs);
        metadataIssues = metadataResult.issues;
        successfulVerifications += metadataResult.successfulVerifications;
        totalSubmissions += metadataResult.totalSubmissions;
        allValidItems = metadataResult.validItems;

        if (res.locals.io) {
          res.locals.io.emit('metadataValidationComplete', metadataResult);
        }

        // Provide metadata validation results
        res.render('pages/review-dashboard', {
          issues: metadataIssues,
          totalSubmissions,
          successfulVerifications,
          urlsChecked: 0,
          successfulUrls: 0,
          unsuccessfulUrls: 0,
          title: 'Review Dashboard',
          urlValidationComplete: false,
        });

        logger.info('Starting URL validation for SLCItemCatalog');
        const urlResult = await validationManager.validateUrls(allValidItems);

        if (res.locals.io) {
          res.locals.io.emit('urlValidationComplete', urlResult);
        }
        logger.info(`URL Validation Completed: ${urlResult.urlsChecked} checked`);
      }

      // Process SLCToolsCatalog
      for (const item of slcToolsCatalogs) {
        logger.info('Processing SLCToolsCatalog');
        await toolsCatalogController.createToolsCatalogItem(req, res);
      }

    } catch (error) {
      logger.error('Error during validation:', error);
      if (!res.headersSent) {
        res.status(500).send('Error during validation');
      }
    }
  }
}
