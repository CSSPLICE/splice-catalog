import { meilisearchService } from '../services/MeilisearchService.js';
import { validate } from 'class-validator';
import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source.js';
import { ResponseUtil } from '../utils/Response.js';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';

export class CatalogController {
  async searchCatalog(req: Request, res: Response): Promise<Response> {
    try {
      const query = (req.query.q as string) || '';
      const searchResults = await meilisearchService.search(query);
      return ResponseUtil.sendResponse(res, searchResults, 200);
    } catch (error) {
      console.error('Search Error:', error);
      return ResponseUtil.sendError(res, 'Search operation failed', 500, error);
    }
  }

  async getCatalog(req: Request, res: Response): Promise<Response> {
    const catalog_data = await AppDataSource.getRepository(slc_item_catalog).find();
    return ResponseUtil.sendResponse(res, catalog_data, 200);
  }

  async createCatalogItem(req: Request, res: Response): Promise<Response> {
    const CatalogData = req.body;
    switch (CatalogData.catalog_type) {
      case 'SLCItemCatalog': {
        const dto = new CreateSLCItemDTO();
        Object.assign(dto, CatalogData);
        const err = await validate(dto);
        if (err.length !== 0) {
          return ResponseUtil.sendError(res, 'Invalid data', 400, err);
        }
        break;
      }
      case 'DatasetCatalog': {
        break;
      }
      default: {
        break;
      }
    }
    const repo = AppDataSource.getRepository(CatalogData.catalog_type);
    const CatalogItem = repo.create(CatalogData);
    await repo.save(CatalogItem);
    if (CatalogData.catalog_type === 'SLCItemCatalog') {
      try {
        await meilisearchService.indexCatalogItems([CatalogItem]);
        console.log('Successfully synced new item to Meilisearch');
      } catch (err) {
        console.error('Search Indexing Error:', err);
      }
    }

    return ResponseUtil.sendResponse(res, CatalogItem, 201);
  }

  async deleteCatalogItem(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const CatalogData = req.body;

    if (CatalogData.catalog_type === 'SLCItemCatalog') {
      const repo = AppDataSource.getRepository(CatalogData.catalog_type);
      const CatalogItem = await repo.findOneByOrFail({ id: Number(id) });

      await repo.remove(CatalogItem);

      try {
        await meilisearchService.deleteDocument(id);
      } catch (err) {
        console.error('Search Deletion Error:', err);
      }

      return ResponseUtil.sendResponse(res, 'successfully deleted the CatalogItem', 201);
    }

    return ResponseUtil.sendResponse(res, 'failed to delete the CatalogItem', 400);
  }

  async getCatalogItemByID(req: Request, res: Response): Promise<Response | void> {
    const { id } = req.params;
    const idNumber = Number(id);

    if (isNaN(idNumber)) {
      return res.status(400).send('Invalid catalog ID');
    }

    try {
      const item = await AppDataSource.getRepository(slc_item_catalog).findOneBy({
        id: idNumber,
      });

      if (!item) {
        return res.status(404).render('pages/item', {
          item: null,
          title: 'Item Not Found',
        });
      }

      return res.render('pages/item', {
        item,
        title: 'Item View',
      });
    } catch (error) {
      console.error('Error retrieving item:', error);
      return res.status(500).send('Internal Server Error');
    }
  }
}
