import { validate } from 'class-validator';
import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { ResponseUtil } from '../utils/Response';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { slc_item_catalog } from 'src/db/entities/SLCItemCatalog';

export class CatalogController {
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
    return ResponseUtil.sendResponse(res, CatalogItem, 201);
  }

  async deleteCatalogItem(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const CatalogData = req.body;
    switch (CatalogData.catalog_type) {
      case 'SLCItemCatalog': {
        const repo = AppDataSource.getRepository(CatalogData.catalog_type);
        const CatalogItem = await repo.findOneByOrFail({
          id: Number(id),
        });
        await repo.remove(CatalogItem);
        return ResponseUtil.sendResponse(res, 'successfully deleted the CatalogItem', 201);
      }
      case 'DatasetCatalog': {
        break;
      }
      default: {
        break;
      }
    }
    return ResponseUtil.sendResponse(res, 'failed to delete the CatalogItem', 400);
  }
}
