import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source.js';
import { Brackets } from 'typeorm';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import {FindOptionsWhere, ILike, IsNull} from 'typeorm';
import { SLCItem } from 'src/types/ItemTypes.js';


const catalogMap: { [key: string]: typeof slc_item_catalog | typeof slc_tools_catalog | typeof dataset_catalog } = {
  items: slc_item_catalog,
  tools: slc_tools_catalog,
  datasets: dataset_catalog,
};

export class SearchController {
  async searchCatalog(req: Request, res: Response) {
    const query = req.query.query as string;
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
    const catalogName = req.params.catalog;
    const entity = catalogMap[catalogName];

    if (!entity) {
      return res.status(404).json({ error: 'Catalog not found' });
    }

    const repository = AppDataSource.getRepository(entity);
    const metadata = repository.metadata;
    const queryBuilder = repository.createQueryBuilder('item');
    let hasWhereClause = false;

    const generalTerms = req.query.terms as string;
    if (generalTerms) {
      const generalWhereClauses = metadata.columns
        .filter((col) => ['varchar', 'text', 'string'].includes(col.type.toString()))
        .map((col) => `item.${col.propertyName} LIKE :generalTerms`);

      if (generalWhereClauses.length > 0) {
        queryBuilder.where(
          new Brackets((qb) => {
            qb.where(generalWhereClauses.join(' OR '), { generalTerms: `%${generalTerms}%` });
          }),
        );
        hasWhereClause = true;
      }
    }

    for (const key in req.query) {
      if (key === 'terms') {
        continue;
      }

      const value = req.query[key];

      if (typeof value === 'string') {
        const columnName = key;

        const column = metadata.findColumnWithPropertyName(columnName);
        if (column) {
          const paramName = `${columnName}_${Math.random().toString(36).substring(7)}`;
          const condition = `item.${columnName} LIKE :${paramName}`;
          const paramValue: string = `%${value}%`;

          if (hasWhereClause) {
            queryBuilder.andWhere(condition, { [paramName]: paramValue });
          } else {
            queryBuilder.where(condition, { [paramName]: paramValue });
            hasWhereClause = true;
          }
        }
      }
    }

    if (!hasWhereClause && !generalTerms) {
      const results = await repository.find();
      return res.json({ results });
    }

    try {
      const results = await queryBuilder.getMany();
      return res.json({ results });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
  async exportSearchResults(req: Request, res: Response) {
    try {
      const rawQuery = req.query.query;
      const query = typeof rawQuery === 'string' ? rawQuery : '';

      const exerciseTypeParam = req.query.exerciseType || [];
      const exerciseTypes =
        typeof exerciseTypeParam === 'string'
          ? exerciseTypeParam.split(',')
          : Array.isArray(exerciseTypeParam)
          ? exerciseTypeParam
          : [];

      let dbQuery: FindOptionsWhere<SLCItem>[] = [
        { keywords: ILike(`%${query}%`) },
        { platform_name: ILike(`%${query}%`) },
        { title: ILike(`%${query}%`) },
        { catalog_type: ILike(`%${query}%`) },
      ];

      if (exerciseTypes.length > 0) {
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

        if (queryWithExerciseTypes.length > 0) {
          dbQuery = queryWithExerciseTypes;
        }
      }

      const repo = AppDataSource.getRepository(slc_item_catalog);
      const results = await repo.find({ where: dbQuery });

      const payload = {
        query,
        exerciseTypes,
        count: results.length,
        results,
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="search-results.json"',
      );

      return res.send(JSON.stringify(payload, null, 2));
    } catch (err) {
      console.error('Error exporting search results:', err);
      return res
        .status(500)
        .json({ success: false, message: 'Failed to export search results' });
    }
  }
}
