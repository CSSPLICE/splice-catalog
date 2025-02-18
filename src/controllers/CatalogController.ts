import { validate } from 'class-validator';
import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { ResponseUtil } from '../utils/Response';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';

export class CatalogController {
  async getCatalog(req: Request, res: Response): Promise<Response> {
    const catalog_data = await AppDataSource.getRepository(slc_item_catalog).find();
    return ResponseUtil.sendResponse(res, catalog_data, 200);
  }


  async createOrModifyCatalogItem(req: Request, res: Response): Promise<Response> {
    const CatalogData = req.body;

    if (CatalogData.catalog_type === "SLCItemCatalog"){
      const dto = new CreateSLCItemDTO();
      Object.assign(dto, CatalogData);
      const err = await validate(dto);

      if (err.length !== 0){
        return ResponseUtil.sendError(res, 'Invalid data', 400, err);
      }
    }

    const repo = AppDataSource.getRepository(CatalogData.catalog_type);
    const CatalogItem = await repo.findOneBy({
      persistent_identifier: CatalogData.persistent_identifier,
    });

    if (CatalogItem){
      await repo.update(
        CatalogItem, CatalogData
      )
      return ResponseUtil.sendResponse(res, "successfully updated the CatalogItem", 201);
    }

    else {
      const CatalogItem = repo.create(CatalogData);
      await repo.save(CatalogItem);
      return ResponseUtil.sendResponse(res, CatalogItem, 201);
    }
  } 

  async deleteCatalogItem(req: Request, res: Response): Promise<Response> {
    const { id, persistent_identifier } = req.params;
    const CatalogData = req.body;
    switch (CatalogData.catalog_type) {
      case 'SLCItemCatalog': {
        const repo = AppDataSource.getRepository(CatalogData.catalog_type);
        const CatalogItem = await repo.findOneByOrFail({
          id: Number(id),
          //change 3
          persistent_identifier,
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
