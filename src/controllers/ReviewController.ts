import { Request, Response } from 'express';
import logger from '../utils/logger.js';
import { AppDataSource } from '../db/data-source.js'; // Adjust the path to your data-source file
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import {validate, ValidationError} from "class-validator";
import {slc_tools_catalog} from "../db/entities/SLCToolsCatalog.js";
import {dataset_catalog} from "../db/entities/DatasetCatalog.js";

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

      const errors: ValidationError[] = [];
      let saves: number = 0;
      // Process SLCItemCatalogs
      if (slcItemCatalogs.length > 0) {
        logger.info(`Processing ${slcItemCatalogs.length} SLCItemCatalog items`);
        for (const item of slcItemCatalogs) {
          const entity = itemsRepository.create(item);
          const result = await validate(entity);
          if (result.length === 0) {
            saves++;
            await itemsRepository.save(entity);
          }
          else {
            errors.push(...result);
          }
        }
      }
      // Process SLCToolsCatalog
      if (slcToolsCatalogs.length > 0) {
        logger.info(`Processing ${slcToolsCatalogs.length} SLCToolsCatalog items`);
        for (const item of slcToolsCatalogs) {
          const entity = toolsRepository.create(item);
          const result = await validate(entity);
          if (result.length === 0) {
            saves++;
            await toolsRepository.save(entity);
          }
          else {
            errors.push(...result);
          }
        }
      }
      // Process DatasetCatalog
      if (datasetCatalogs.length > 0) {
        logger.info(`Processing ${datasetCatalogs.length} SLCToolsCatalog items`);
        for (const item of datasetCatalogs) {
          const entity = datasetRepository.create(item);
          const result = await validate(entity);
          if (result.length === 0) {
            saves++;
            await datasetRepository.save(entity);
          }
          else {
            errors.push(...result);
          }
        }
      }
      if (errors.length > 0) {
        console.log("Validation Errors: ", errors);
        res.status(500).send(
          errors.map(
            (error: ValidationError) => {
              return {
                persistentID: error.target?.persistentID || "missing id",
                constraints: error.constraints,
              }
            }
          )
        );
      }
      else {
        res.status(200).send(`successfully saved ${saves} entries`);
      }
    } catch (error) {
      logger.error('Error during validation:', error);
      if (!res.headersSent) {
        res.status(500).send('Error during validation');
      }
    }
  }
}
