import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source.js';
import { Brackets, Like } from 'typeorm';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';

export class SearchController {
  async searchCatalog(req: Request, res: Response) {
    const query = (req.query.query) as string;
    const features = req.query.features || [];
    let featureTypes: string[] = [];
    if (typeof features === 'string') {
      featureTypes = features
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(features)) {
      featureTypes = features as string[];
    }
    const tools = req.query.tool || [];
    let toolTypes: string[] = [];
    if (typeof tools === 'string') {
      toolTypes = tools
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(tools)) {
      toolTypes = tools as string[];
    }

    const queryBuilder = AppDataSource.getRepository(slc_item_catalog).createQueryBuilder('item');

    if (query) {
      queryBuilder.where(
        new Brackets((qb) => {
          qb.where('item.keywords LIKE :query', { query: `%${query}%` })
            .orWhere('item.platform_name LIKE :query', { query: `%${query}%` })
            .orWhere('item.title LIKE :query', { query: `%${query}%` })
            .orWhere('item.catalog_type LIKE :query', { query: `%${query}%` });
        }),
      );
    }

    const search_data = await queryBuilder.getMany();

    const allFeatures = await AppDataSource.getRepository(slc_item_catalog)
      .createQueryBuilder('item')
      .select('DISTINCT item.features', 'features')
      .getRawMany();
    const featureChoices = [
      ...new Set(
        allFeatures
          .map((t) => t.features)
          .flat()
          .flatMap((featureString) => (featureString || '').split(',').map((s: string) => s.trim()))
          .filter(Boolean),
      ),
    ];
    if (!featureChoices.includes('Untagged')) {
      featureChoices.push('Untagged');
    }

    const allTools = await AppDataSource.getRepository(slc_item_catalog)
      .createQueryBuilder('item')
      .select('DISTINCT item.platform_name', 'platform_name')
      .getRawMany();
    const toolChoices = allTools.map((t) => t.platform_name).filter(Boolean);

    res.render('pages/search', {
      results: search_data,
      currentPage: 1,
      totalPages: 1,
      query,
      features: featureTypes,
      title: 'Search Results',
      featureChoices,
      tools: toolTypes,
      toolChoices,
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
      });

      return res.json({
        results: search_data,
        query,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
