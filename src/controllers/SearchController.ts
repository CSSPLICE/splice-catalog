import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { ILike } from 'typeorm';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';

export class SearchController {
  async searchCatalog(req: Request, res: Response) {
    const query = req.body.query || req.query.query;  // Handle GET and POST requests
    if (!query) {
      return res.render('pages/search', {
        results: [],
        currentPage: 1,
        totalPages: 0,
        query: '',  
        title: 'Search Results',
        user: req.oidc.user,
      });
    }

    const currentPage = Number(req.query.page) || 1;
    const ITEMS_PER_PAGE = 25; 

    const [search_data, totalItems] = await AppDataSource.getRepository(slc_item_catalog)
      .findAndCount({
        where: [
          { keywords: ILike(`%${query}%`) },
          { platform_name: ILike(`%${query}%`) },
          { exercise_name: ILike(`%${query}%`) },
          { exercise_type: ILike(`%${query}%`) },
          { catalog_type: ILike(`%${query}%`) },
        ],
        skip: (currentPage - 1) * ITEMS_PER_PAGE,
        take: ITEMS_PER_PAGE,
      });

    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

    res.render('pages/search', {
      results: search_data,
      currentPage,
      totalPages,
      query,  // Pass the query parameter to the view
      title: 'Search Results',
      user: req.oidc.user,
    });
  }
}
