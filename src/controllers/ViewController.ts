import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';
import logger from '../utils/logger';
import fs from 'fs';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { validate } from 'class-validator';
import { ResponseUtil } from '../utils/Response';
import { ILike } from 'typeorm';
import { ToolsCatalogController } from './ToolsCatalogController';
import { CreateSLCToolsDTO } from '../dtos/SLCToolsDTO';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog';
import { dataset_catalog } from '../db/entities/DatasetCatalog';
import { CreateDatasetCatalogDTO } from '../dtos/DatasetCatalogDTO';
import { ReviewController } from './ReviewController';
import { ValidationManager } from '../services/ValidationManager';

const reviewController = new ReviewController();
const validationManager = new ValidationManager();

export class ViewController {
  async catalogView(req: Request, res: Response) {
    const currentPage = Number(req.query.page) || 1;
    const ITEMS_PER_PAGE = 25; // subject to change
    const totalItems = await AppDataSource.getRepository(slc_item_catalog).count();
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    const offset = (currentPage - 1) * ITEMS_PER_PAGE;

    const catalog_data = await AppDataSource.getRepository(slc_item_catalog).find({
      skip: offset,
      take: ITEMS_PER_PAGE,
    });
    res.render('pages/catalog', { catalog: catalog_data, currentPage, totalPages, title: 'SPLICE Catalog' });
  }

  async itemView(req: Request, res: Response) {
    const query = req.body.item_link;
    const item = await AppDataSource.getRepository(slc_item_catalog).findOne({
      where: [{ exercise_name: ILike(`%${query}%`) }],
    });
    res.render('pages/item', { item: item, title: 'Item View' });
  }

  async instructionsView(req: Request, res: Response) {
    res.render('pages/instructions', { title: 'Instructions' });
  }

  async homeView(req: Request, res: Response) {
    // Fetch counts from the database
    const toolCatalogCount = await AppDataSource.getRepository(slc_tools_catalog).count();
    const slcItemCount = await AppDataSource.getRepository(slc_item_catalog).count();
    const datasetCount = await AppDataSource.getRepository(dataset_catalog).count();
    //#to do Fetch dataset count similarly

    // Render the home page with counts
    res.render('pages/index', {
      title: 'Home',
      toolCatalogCount: toolCatalogCount,
      slcItemCount: slcItemCount,
      datasetCount: datasetCount, // to be replaced with actual dataset count
      user: req.oidc.user,
    });
  }

  async uploadView(req: Request, res: Response) {
    res.render('pages/upload', { title: 'Upload Data' });
  }

  async toolView(req: Request, res: Response) {
    // Fetch SLC tools catalog data
    const toolsCatalog_data = await AppDataSource.getRepository(slc_tools_catalog).find();
    res.render('pages/toolcatalog', { toolsCatalog: toolsCatalog_data, title: 'Tools Catalog' });
  }

  async datasetCatalogView(req: Request, res: Response) {
    try {
      const datasetCatalog_data = await AppDataSource.getRepository(dataset_catalog).find();
      res.render('pages/datasetcatalog', { datasets: datasetCatalog_data, title: 'Dataset Catalog' });
    } catch (error) {
      console.error('Failed to fetch dataset catalog data:', error);
      res.status(500).send('Internal Server Error');
    }
  }

  async uploadPost(req: Request, res: Response) {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const absolutePath = req.file.path;
      const jsonString = fs.readFileSync(absolutePath, 'utf-8');
      req.body = JSON.parse(jsonString);

      await reviewController.validateAndReview(req, res);
    } catch (error) {
      logger.error('Error processing upload:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async approveAll(req: Request, res: Response) {
    const data = req.body.data;
    console.log('ApproveAll called with data:', data);
    const jsonArray = JSON.parse(data);
    console.log('Parsed JSON data:', jsonArray);

    let processedCount = 0;
    const itemsToClassify: CreateSLCItemDTO[] = [];

    for (const item of jsonArray) {
      let dto, repo;

      // Check if the item has an exercise_name
      if (!item.exercise_name || item.exercise_name.trim() === '') {
        console.log('Skipping item without exercise_name:', item);
        continue; // Skip this item if it doesn't have an exercise_name
      }

      switch (item.catalog_type) {
        case 'SLCItemCatalog': {
          dto = new CreateSLCItemDTO();
          Object.assign(dto, item);
          repo = AppDataSource.getRepository(slc_item_catalog);
          itemsToClassify.push(dto); // Add to classification list
          break;
        }

        case 'DatasetCatalog': {
          const dto = new CreateDatasetCatalogDTO();
          Object.assign(dto, item);
          const validationErrors = await validate(dto);
          if (validationErrors.length > 0) {
            console.error(`Validation errors for ${item.catalog_type}:`, validationErrors);
            continue; // Skip this item if validation fails
          }
          const repo = AppDataSource.getRepository(dataset_catalog);
          const catalogItem = repo.create(dto);
          await repo.save(catalogItem);
          processedCount++;
          break;
        }

        default:
          logger.warn(`Unrecognized catalog type: ${item.catalog_type}`);
          continue; // Skip this item
      }

      // Common validation and saving logic for the catalog types
      if (dto && repo) {
        const validationErrors = await validate(dto);
        if (validationErrors.length > 0) {
          console.error(`Validation errors for ${item.catalog_type}:`, validationErrors);
        } else {
          const catalogItem = repo.create(dto);
          await repo.save(catalogItem);
          processedCount++;
        }
      }
    }

    // Proceed to store and classify items after processing all entries
    if (itemsToClassify.length > 0) {
      const categoryReport = await validationManager.generateCategoryReport(itemsToClassify);
      await validationManager.storeAndClassifyItems(categoryReport);
    }

    return ResponseUtil.sendResponse(res, `${processedCount} entries processed successfully`, 201);
    const catalog_data = await AppDataSource.getRepository(slc_item_catalog).find();
    res.render('pages/index', {
      catalog: catalog_data,
      title: 'SPLICE Catalog',
      user: req.oidc.user,
    });
  }

  profileView(req: Request, res: Response) {
    // res.render('pages/profile', { title: 'Profile', user: JSON.stringify(req.oidc.user, null, 2) });
    res.render('pages/profile', { title: 'Profile', user: req.oidc.user });
  }

  async rejectAll(req: Request, res: Response) {
    return res.redirect('/upload');
  }
}
