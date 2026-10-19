import { AppDataSource } from '../db/data-source.js';
import { SearchEvent, SearchSource } from '../db/entities/SearchEvent.js';
import type { UsageCatalogType, UsageDateRange } from './UsageStatisticsService.js';
import { parseSearchQuery } from '../utils/searchQuery.js';

export interface SearchSummary {
  webSearches: number;
  publicApiSearches: number;
}
export interface SearchTermStatistics extends SearchSummary {
  query: string;
  totalSearches: number;
}

export class SearchStatisticsService {
  async recordSearch(data: {
    source: SearchSource;
    query: string;
    catalogType: UsageCatalogType | null;
    resultCount: number | null;
  }): Promise<SearchEvent> {
    const parsed = parseSearchQuery(data.query);
    if (parsed.error || !parsed.query) throw new Error('Invalid search query');
    if (data.source !== 'WEB' && data.source !== 'API') throw new Error('Invalid search source');
    if (data.resultCount !== null && (!Number.isSafeInteger(data.resultCount) || data.resultCount < 0)) {
      throw new Error('Invalid search result count');
    }
    const repository = AppDataSource.getRepository(SearchEvent);
    return repository.save(repository.create({ ...data, query: parsed.query }));
  }

  private scopedQuery(dateRange?: UsageDateRange, catalogType?: UsageCatalogType) {
    const query = AppDataSource.getRepository(SearchEvent).createQueryBuilder('searchEvent');
    if (dateRange?.from) query.andWhere('searchEvent.createdAt >= :from', { from: dateRange.from });
    if (dateRange?.toExclusive) query.andWhere('searchEvent.createdAt < :to', { to: dateRange.toExclusive });
    if (catalogType) query.andWhere('searchEvent.catalogType = :catalogType', { catalogType });
    return query;
  }

  async getSummary(dateRange?: UsageDateRange, catalogType?: UsageCatalogType): Promise<SearchSummary> {
    const result = await this.scopedQuery(dateRange, catalogType)
      .select("SUM(CASE WHEN searchEvent.source = 'WEB' THEN 1 ELSE 0 END)", 'webSearches')
      .addSelect("SUM(CASE WHEN searchEvent.source = 'API' THEN 1 ELSE 0 END)", 'publicApiSearches')
      .getRawOne();
    return { webSearches: Number(result?.webSearches ?? 0), publicApiSearches: Number(result?.publicApiSearches ?? 0) };
  }

  async getDailyPublicApiSearches(
    dateRange?: UsageDateRange,
    catalogType?: UsageCatalogType,
  ): Promise<Array<{ date: string; publicApiSearches: number }>> {
    const results = await this.scopedQuery(dateRange, catalogType)
      .select('DATE(searchEvent.createdAt)', 'date')
      .addSelect('COUNT(*)', 'publicApiSearches')
      .andWhere('searchEvent.source = :source', { source: 'API' })
      .groupBy('DATE(searchEvent.createdAt)')
      .orderBy('DATE(searchEvent.createdAt)', 'ASC')
      .getRawMany();
    return results.map((row) => ({
      date:
        row.date instanceof Date
          ? `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}-${String(row.date.getDate()).padStart(2, '0')}`
          : String(row.date).slice(0, 10),
      publicApiSearches: Number(row.publicApiSearches ?? 0),
    }));
  }

  async getFrequentTerms(dateRange?: UsageDateRange, catalogType?: UsageCatalogType): Promise<SearchTermStatistics[]> {
    const results = await this.scopedQuery(dateRange, catalogType)
      // Binary grouping preserves meaningful case/content rather than relying on DB collation.
      .select('BINARY searchEvent.query', 'query')
      .addSelect("SUM(CASE WHEN searchEvent.source = 'WEB' THEN 1 ELSE 0 END)", 'webSearches')
      .addSelect("SUM(CASE WHEN searchEvent.source = 'API' THEN 1 ELSE 0 END)", 'publicApiSearches')
      .addSelect('COUNT(*)', 'totalSearches')
      .groupBy('BINARY searchEvent.query')
      .orderBy('totalSearches', 'DESC')
      .addOrderBy('BINARY searchEvent.query', 'ASC')
      .limit(100)
      .getRawMany();
    return results.map((row) => ({
      query: Buffer.isBuffer(row.query) ? row.query.toString('utf8') : String(row.query),
      webSearches: Number(row.webSearches),
      publicApiSearches: Number(row.publicApiSearches),
      totalSearches: Number(row.totalSearches),
    }));
  }

  async getEvents(dateRange?: UsageDateRange, catalogType?: UsageCatalogType): Promise<SearchEvent[]> {
    return this.scopedQuery(dateRange, catalogType)
      .orderBy('searchEvent.createdAt', 'DESC')
      .addOrderBy('searchEvent.id', 'DESC')
      .getMany();
  }
}
