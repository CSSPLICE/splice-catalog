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
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const featuresParam = req.query.features || [];

    const features =
      typeof featuresParam === 'string'
        ? [featuresParam]
        : Array.isArray(featuresParam)
        ? featuresParam
        : [];

    const repo = AppDataSource.getRepository(slc_item_catalog);
    const qb = repo.createQueryBuilder('item');

    if (query) {
      qb.where(
        new Brackets((qb2) => {
          qb2
            .where('item.keywords LIKE :q', { q: `%${query}%` })
            .orWhere('item.platform_name LIKE :q', { q: `%${query}%` })
            .orWhere('item.title LIKE :q', { q: `%${query}%` })
            .orWhere('item.catalog_type LIKE :q', { q: `%${query}%` });
        }),
      );
    }

    if (features.length > 0) {
      qb.andWhere(
        new Brackets((qb2) => {
          features.forEach((f, idx) => {
            qb2.orWhere(`item.features LIKE :f${idx}`, {
              [`f${idx}`]: `%${f}%`,
            });
          });
        }),
      );
    }

    const rows = await qb.getMany();

    // export
    if (req.route?.path === '/export') {
      const payload = rows.map((item) => ({
        catalog_type: item.catalog_type,
        platform_name: item.platform_name,
        iframe_url: item.iframe_url,
        persistentID: item.persistentID,
        protocol_url: item.protocol_url,
        protocol: item.protocol,
        license: item.license,
        description: item.description,
        author: item.author,
        institution: item.institution,
        keywords: item.keywords,
        features: item.features,
        title: item.title,
        programming_language: item.programming_language,
        natural_language: item.natural_language,
      }));

      return res.json(payload);
    }

    return res.render('pages/search', {
      results: rows,
      query,
      features,
      title: 'Search Results',
    });
  }
}
