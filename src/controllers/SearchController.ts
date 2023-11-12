import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { Catalog } from '../db/entities/catalog';
import { ILike } from 'typeorm';

export class SearchController {
  async searchCatalog(req: Request, res: Response) {
    const query = req.body.query;
    const search_data = await AppDataSource.getRepository(Catalog).find({
      where: [{ keywords: ILike(`%${query}%`) }, { platform_name: ILike(`%${query}%`) }],
    });
    res.render('pages/search', {
      results: search_data,
      title: 'Search Results',
      user: req.oidc.user,
    });
  }
}
