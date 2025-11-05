import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source.js';
import { Brackets, FindOptionsWhere, IsNull, Like } from 'typeorm';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { SLCItem } from 'src/types/ItemTypes.js';

export class SearchController {
  async searchCatalog(req: Request, res: Response) {
    const query = (req.body.query || req.query.query) as string;
    const features = req.query.features || [];
    let featureTypes: string[] = [];
    if (typeof features === 'string') {
        featureTypes = features.split(',').map(s => s.trim()).filter(Boolean);
    } else if (Array.isArray(features)) {
        featureTypes = features as string[];
    }
    const currentPage = Number(req.query.page) || 1;
    const ITEMS_PER_PAGE = 25;

    const queryBuilder = AppDataSource.getRepository(slc_item_catalog).createQueryBuilder("item");

    if (query) {
        queryBuilder.where(new Brackets(qb => {
            qb.where("item.keywords LIKE :query", { query: `%${query}%` })
              .orWhere("item.platform_name LIKE :query", { query: `%${query}%` })
              .orWhere("item.title LIKE :query", { query: `%${query}%` })
              .orWhere("item.catalog_type LIKE :query", { query: `%${query}%` });
        }));
    }

    if (featureTypes.length > 0) {
        queryBuilder.andWhere(new Brackets(qb => {
            for (const type of featureTypes) {
                if (type === 'Untagged') {
                    qb.orWhere("item.features IS NULL");
                } else {
                    const paramName = `type_${featureTypes.indexOf(type)}`;
                    qb.orWhere(`item.features LIKE :${paramName}`, { [paramName]: `%${type}%` });
                }
            }
        }));
    }

    const [search_data, totalItems] = await queryBuilder
        .skip((currentPage - 1) * ITEMS_PER_PAGE)
        .take(ITEMS_PER_PAGE)
        .getManyAndCount();

    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

    const allFeatures = await AppDataSource.getRepository(slc_item_catalog)
      .createQueryBuilder("item")
      .select("DISTINCT item.features", "features")
      .getRawMany();
    const featureChoices = [...new Set(allFeatures
      .map(t => t.features)
      .flat()
      .flatMap(featureString => featureString.split(',').map(s => s.trim()))
      .filter(Boolean))];
    if (!featureChoices.includes('Untagged')) {
      featureChoices.push('Untagged');
    }

    res.render('pages/search', {
      results: search_data,
      currentPage,
      totalPages,
      query,
      features,
      title: 'Search Results',
      featureChoices,
    });
  }
  async searchCatalogAPI(req: Request, res: Response) {
    const query = req.query.query;
    if (!query) {
      return res.status(400).json({ error: 'Missing query parameter' });
    }

    const currentPage = Number(req.query.page) || 1;
    const ITEMS_PER_PAGE = 25;

    try {
      const [search_data, totalItems] = await AppDataSource.getRepository(slc_item_catalog).findAndCount({
        where: [
          { keywords: Like(`%${query}%`) },
          { platform_name: Like(`%${query}%`) },
          { title: Like(`%${query}%`) },
          { catalog_type: Like(`%${query}%`) },
        ],
        skip: (currentPage - 1) * ITEMS_PER_PAGE,
        take: ITEMS_PER_PAGE,
      });

      const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

      return res.json({
        results: search_data,
        currentPage,
        totalPages,
        query,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}