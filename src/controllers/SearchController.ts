import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source.js';
import { Brackets, FindOptionsWhere, ILike, IsNull } from 'typeorm'; 
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { SLCItem } from '../types/ItemTypes.js'; 
import { meilisearchService } from '../services/MeilisearchService.js'; 

const catalogMap: { [key: string]: typeof slc_item_catalog | typeof slc_tools_catalog | typeof dataset_catalog } = {
  items: slc_item_catalog,
  tools: slc_tools_catalog,
  datasets: dataset_catalog,
};

export class SearchController {
  async searchCatalog(req: Request, res: Response) {
    const query = req.query.query as string || '';

    const features = req.query.features || [];
    let featureTypes: string[] = [];
    if (typeof features === 'string') {
      featureTypes = features.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(features)) {
      featureTypes = features as string[];
    }

    const tools = req.query.tool || [];
    let toolTypes: string[] = [];
    if (typeof tools === 'string') {
      toolTypes = tools.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(tools)) {
      toolTypes = tools as string[];
    }

    let search_data: any[] = [];

    try {
      if (query) {
        search_data = await meilisearchService.search(query);
      } else {
        search_data = await AppDataSource.getRepository(slc_item_catalog).find();
      }
    } catch (err) {
      console.error("Meilisearch failed, falling back to DB", err);
      search_data = await AppDataSource.getRepository(slc_item_catalog).find();
    }

    search_data = search_data.map(item => {
      if (item.keywords && typeof item.keywords === 'string') {
        item.keywords = item.keywords.split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (!item.keywords) {
        item.keywords = [];
      }

      if (item.features && typeof item.features === 'string') {
        item.features = item.features.split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (!item.features) {
        item.features = [];
      }
      return item;
    });

    if (featureTypes.length > 0) {
      search_data = search_data.filter(item => {
        const itemFeatures = Array.isArray(item.features) ? item.features : (item.features || '').split(',');
        return featureTypes.some(f => itemFeatures.map((s: string) => s.trim()).includes(f));
      });
    }

    if (toolTypes.length > 0) {
      search_data = search_data.filter(item => {
        return toolTypes.includes(item.platform_name);
      });
    }

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
    const query = req.query.terms as string || '';

    let results: any[] = [];

    try {
      if (query) {
        results = await meilisearchService.search(query);
      } else {
        const catalogName = req.params.catalog || 'items';
        const entity = catalogMap[catalogName] || slc_item_catalog;
        results = await AppDataSource.getRepository(entity).find();
      }

      results = results.map(item => {
        item.keywords = typeof item.keywords === 'string' 
          ? item.keywords.split(',').map((s: string) => s.trim()).filter(Boolean) 
          : (item.keywords || []);
        item.features = typeof item.features === 'string' 
          ? item.features.split(',').map((s: string) => s.trim()).filter(Boolean) 
          : (item.features || []);
        return item;
      });

      return res.json({ results });
    } catch (error) {
      console.error("API Search Error:", error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async exportSearchResults(req: Request, res: Response) {
    try {
      const repo = AppDataSource.getRepository(slc_item_catalog);
      const results = await repo.find();

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="catalog.json"');

      return res.send(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error('Error exporting catalog:', err);
      return res.status(500).json({ message: 'Failed to export catalog' });
    }
  }

}