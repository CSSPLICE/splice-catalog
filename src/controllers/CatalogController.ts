import { validate } from 'class-validator';
import { Request, Response } from 'express';
import { AppDataSource } from './../db/data-source';
import { Catalog } from '../db/entities/catalog';
import { ResponseUtil } from './../utils/Response';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';

export class CatalogController {
  async getCatalog(req: Request, res: Response): Promise<Response> {
    const catalog_data = await AppDataSource.getRepository(Catalog).find();
    return ResponseUtil.sendResponse(res, catalog_data, 200);
  }

  async createSLCItem(req: Request, res: Response): Promise<Response> {
    const SLCItemData = req.body;
    const dto = new CreateSLCItemDTO();
    Object.assign(dto, SLCItemData);
    const err = await validate(dto);
    if (err.length != 0) {
      return ResponseUtil.sendError(res, 'Invalid data', 400, err);
    }
    const repo = AppDataSource.getRepository(Catalog);
    const SLCItem = repo.create(SLCItemData);
    await repo.save(SLCItem);
    return ResponseUtil.sendResponse(res, SLCItem, 201);
  }

  async deleteSLCItem(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const repo = AppDataSource.getRepository(Catalog);
    const SLCItem = await repo.findOneByOrFail({
      id: Number(id),
    });
    await repo.remove(SLCItem);
    return ResponseUtil.sendResponse(res, "Successfully deleted the SLCItem", 201);
  }
}
