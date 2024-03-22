import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { ILike } from 'typeorm';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';

export class SearchController {
  async searchCatalog(req: Request, res: Response) {
    const query = req.body.query;
    const search_data = await AppDataSource.getRepository(slc_item_catalog).find({
      where: [
        { keywords: ILike(`%${query}%`) },
        { platform_name: ILike(`%${query}%`) },
        { exercise_name: ILike(`%${query}%`) },
        { exercise_type: ILike(`%${query}%`) },
        { catalog_type: ILike(`%${query}%`) },
      ],
    });
    res.render('pages/search', { results: search_data, title: 'Search Results' });
  }
}
