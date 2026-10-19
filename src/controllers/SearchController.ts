import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { meilisearchService } from '../services/MeilisearchService.js';
import { SearchStatisticsService } from '../services/SearchStatisticsService.js';
import { parseSearchQuery } from '../utils/searchQuery.js';

const searchStatisticsService = new SearchStatisticsService();

const catalogMap: { [key: string]: typeof slc_item_catalog | typeof slc_tools_catalog | typeof dataset_catalog } = {
  items: slc_item_catalog,
  tools: slc_tools_catalog,
  datasets: dataset_catalog,
};

const FILTER_FIELDS = [
  { key: 'keywords', label: 'Keywords', itemField: 'keywords', legacyQueryKeys: [], type: 'ontology' },
  { key: 'features', label: 'Features', itemField: 'features', legacyQueryKeys: [] },
  { key: 'tools', label: 'Tools', itemField: 'platform_name', legacyQueryKeys: ['tool'] },
  { key: 'natural_language', label: 'Natural Language', itemField: 'natural_language', legacyQueryKeys: [] },
  {
    key: 'programming_language',
    label: 'Programming Language',
    itemField: 'programming_language',
    legacyQueryKeys: [],
  },
  { key: 'institution', label: 'Institution', itemField: 'institution', legacyQueryKeys: [] },
] as const;

type FilterFieldConfig = (typeof FILTER_FIELDS)[number];
type SelectedFilters = Record<string, string[]>;

const normalizeStringArray = (value: unknown): string[] => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
};

const getSelectedFilterValues = (req: Request, field: FilterFieldConfig): string[] => {
  const rawValues = [req.query[field.key], ...field.legacyQueryKeys.map((key) => req.query[key])].filter(Boolean);
  return rawValues.flatMap((value) => normalizeStringArray(value));
};

const normalizeCatalogItem = (item: any) => {
  item.keywords = normalizeStringArray(item.keywords);
  item.features = normalizeStringArray(item.features);
  item.author = normalizeStringArray(item.author);
  item.institution = normalizeStringArray(item.institution);
  item.natural_language = normalizeStringArray(item.natural_language);
  item.programming_language = normalizeStringArray(item.programming_language);
  return item;
};

const getItemFilterValues = (item: any, field: FilterFieldConfig): string[] => {
  return normalizeStringArray(item[field.itemField]);
};

export class SearchController {
  async searchCatalog(req: Request, res: Response) {
    const { query, error: queryError } = parseSearchQuery(req.query.query);
    if (queryError) return res.status(400).send(queryError);
    const selectedFilters: SelectedFilters = Object.fromEntries(
      FILTER_FIELDS.map((field) => [field.key, getSelectedFilterValues(req, field)]),
    );

    let search_data: any[] = [];

    try {
      if (query) {
        search_data = await meilisearchService.search(query);
      } else {
        search_data = await AppDataSource.getRepository(slc_item_catalog).find();
      }
    } catch (err) {
      console.error('Meilisearch failed, falling back to DB', err);
      search_data = await AppDataSource.getRepository(slc_item_catalog).find();
    }

    search_data = search_data.map(normalizeCatalogItem);

    for (const field of FILTER_FIELDS) {
      const selectedValues = selectedFilters[field.key];
      if (selectedValues.length === 0) continue;

      search_data = search_data.filter((item) => {
        const itemValues = getItemFilterValues(item, field);
        return selectedValues.some((value) => itemValues.includes(value));
      });
    }

    const allCatalogItems = (await AppDataSource.getRepository(slc_item_catalog).find()).map(normalizeCatalogItem);
    const filterSections = FILTER_FIELDS.map((field) => {
      const choices = [
        ...new Set(allCatalogItems.flatMap((item) => getItemFilterValues(item, field)).filter(Boolean)),
      ].sort((left, right) => left.localeCompare(right));

      if (field.key === 'features' && !choices.includes('Untagged')) {
        choices.push('Untagged');
      }

      return {
        key: field.key,
        label: field.label,
        type: 'type' in field ? field.type : 'flat',
        choices: 'type' in field && field.type === 'ontology' ? [] : choices,
      };
    });

    res.render('pages/search', {
      results: search_data,
      currentPage: 1,
      totalPages: 1,
      query,
      selectedFilters,
      filterSections,
      title: 'Search Results',
    });
  }

  searchCatalogAPI(req: Request, res: Response) {
    return this.searchJson(req, res, true);
  }

  searchCatalogResults(req: Request, res: Response) {
    return this.searchJson(req, res, false);
  }

  private async searchJson(req: Request, res: Response, publicApi: boolean) {
    const { query, error } = parseSearchQuery(req.query.terms);
    if (error) return res.status(400).json({ error });
    const catalogName = publicApi ? req.params.catalog : 'items';
    if (!Object.hasOwn(catalogMap, catalogName)) return res.status(404).json({ error: 'Unknown catalog' });
    // Only SLC items are indexed. Do not silently return SLC hits for tool/dataset searches.
    if (query && catalogName !== 'items') {
      return res.status(400).json({ error: 'Full-text search is currently supported only for the items catalog.' });
    }
    try {
      const results = (
        query
          ? await meilisearchService.search(query)
          : await AppDataSource.getRepository(catalogMap[catalogName]).find()
      ).map(normalizeCatalogItem);
      if (publicApi && query) {
        try {
          await searchStatisticsService.recordSearch({
            source: 'API',
            query,
            catalogType: 'SLC_ITEM',
            resultCount: results.length,
          });
        } catch {
          // A completed search remains successful if analytics storage is unavailable.
          console.error('Failed to record public API search analytics');
        }
      }
      return res.json({ results });
    } catch {
      console.error('Search retrieval failed');
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
