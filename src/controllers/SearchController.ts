import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { ILike } from 'typeorm';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';

export class SearchController {
  async searchCatalog(req: Request, res: Response) {
    const query = req.body.query;
    const currentPage = Number(req.query.page) || 1;
    const ITEMS_PER_PAGE = 25; 

    const totalItems = await AppDataSource.getRepository(slc_item_catalog).count({
      where: [
        { keywords: ILike(`%${query}%`) },
        { platform_name: ILike(`%${query}%`) },
        { exercise_name: ILike(`%${query}%`) },
        { exercise_type: ILike(`%${query}%`) },
        { catalog_type: ILike(`%${query}%`) },
      ],
    });
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

    const offset = (currentPage - 1) * ITEMS_PER_PAGE;

    const search_data = await AppDataSource.getRepository(slc_item_catalog)
      .find({
        where: [
          { keywords: ILike(`%${query}%`) },
          { platform_name: ILike(`%${query}%`) },
          { exercise_name: ILike(`%${query}%`) },
          { exercise_type: ILike(`%${query}%`) },
          { catalog_type: ILike(`%${query}%`) },
        ],
        skip: offset,
        take: ITEMS_PER_PAGE,
      });

    res.render('pages/search', {
      results: search_data,
      currentPage,
      totalPages,
      title: 'Search Results',
      user: req.oidc.user;
    });
  }
}
