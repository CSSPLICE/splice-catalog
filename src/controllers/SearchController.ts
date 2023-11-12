import { Request, Response } from 'express';
import { AppDataSource } from './../db/data-source';
import { Catalog } from '../db/entities/catalog';
import { ResponseUtil } from './../utils/Response';
import { ILike } from 'typeorm';

export class SearchController {
  async searchCatalog(req: Request, res: Response): Promise<Response> {
    const query = req.body.query;
    const search_data = await AppDataSource.getRepository(Catalog).findBy({
      keywords: ILike(`%${query}%`),
    });
    return ResponseUtil.sendResponse(res, search_data, 200);
  }
}
