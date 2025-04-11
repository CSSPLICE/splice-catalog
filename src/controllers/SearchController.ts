import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { FindOptionsWhere, ILike, IsNull } from 'typeorm';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';
import { SLCItem } from 'src/types/ItemTypes';

export class SearchController {
  async searchCatalog(req: Request, res: Response) {
    const query = req.body.query || req.query.query; // Handle GET and POST requests
    const exerciseType = req.query.exerciseType || [];
    const exerciseTypes = typeof exerciseType === 'string' ? exerciseType.split(',') : [];
    if (!query) {
      return res.render('pages/search', {
        results: [],
        currentPage: 1,
        totalPages: 0,
        query: '',
        exerciseType,
        title: 'Search Results',
        user: req.oidc.user,
      });
    }

    let dbQuery: FindOptionsWhere<SLCItem>[] = [
      { keywords: ILike(`%${query}%`) },
      { platform_name: ILike(`%${query}%`) },
      { exercise_name: ILike(`%${query}%`) },
      { catalog_type: ILike(`%${query}%`) },
    ];

    if (exerciseTypes.length > 0) {
      // Split your base query OR conditions
      let queryWithExerciseTypes: FindOptionsWhere<SLCItem>[] = [];

      if (exerciseTypes.includes('Untagged')) {
        queryWithExerciseTypes = dbQuery.map((orcond) => ({
          ...orcond,
          exercise_type: IsNull(),
        }));
      }

      const nonNullTypes = exerciseTypes.filter((type) => type !== 'Untagged');

      if (nonNullTypes.length > 0) {
        for (const type of nonNullTypes) {
          queryWithExerciseTypes.push(
            ...dbQuery.map((orcond) => ({
              ...orcond,
              exercise_type: ILike(`%${type}%`),
            })),
          );
        }
      }

      dbQuery = queryWithExerciseTypes;
    }

    const currentPage = Number(req.query.page) || 1;
    const ITEMS_PER_PAGE = 25;

    const [search_data, totalItems] = await AppDataSource.getRepository(slc_item_catalog).findAndCount({
      where: dbQuery,
      skip: (currentPage - 1) * ITEMS_PER_PAGE,
      take: ITEMS_PER_PAGE,
    });

    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

    res.render('pages/search', {
      results: search_data,
      currentPage,
      totalPages,
      query, // Pass the query parameter to the view
      exerciseType,
      title: 'Search Results',
      user: req.oidc.user,
    });
  }
}
