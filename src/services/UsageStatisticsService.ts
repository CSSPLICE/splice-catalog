import { AppDataSource } from '../db/data-source.js';
import { UsageEvent } from '../db/entities/UsageEvent.js';
import { SelectQueryBuilder } from 'typeorm';

export interface UsageDateRange {
  from?: Date;
  toExclusive?: Date;
}

export type UsageCatalogType = 'SLC_ITEM' | 'TOOL' | 'DATASET';

function applyDateRange(
  query: SelectQueryBuilder<UsageEvent>,
  alias: string,
  dateRange?: UsageDateRange,
  catalogType?: UsageCatalogType,
): SelectQueryBuilder<UsageEvent> {
  if (dateRange?.from) {
    query.andWhere(`${alias}.createdAt >= :rangeFrom`, { rangeFrom: dateRange.from });
  }
  if (dateRange?.toExclusive) {
    query.andWhere(`${alias}.createdAt < :rangeToExclusive`, { rangeToExclusive: dateRange.toExclusive });
  }
  if (catalogType) {
    query.andWhere(`${alias}.catalogType = :rangeCatalogType`, { rangeCatalogType: catalogType });
  }
  return query;
}

export type UsageStatisticsSortBy = 'views' | 'externalClicks';

export interface OverallUsageStatistics {
  totalViews: number;
  totalExternalClicks: number;
}

export interface PerItemUsageStatistics {
  catalogType: string | null;
  catalogPath: string | null;
  itemPersistentID: string;
  itemTitle: string;
  views: number;
  externalClicks: number;
}

export interface DailyUsageActivity {
  date: string;
  views: number;
  externalClicks: number;
}

export interface CatalogTypeActivity {
  catalogType: UsageCatalogType;
  label: string;
  count: number;
}

const supportedCatalogTypes: UsageCatalogType[] = ['SLC_ITEM', 'TOOL', 'DATASET'];
const catalogTypeLabels: Record<UsageCatalogType, string> = {
  SLC_ITEM: 'SLC Items',
  TOOL: 'Tools',
  DATASET: 'Datasets',
};

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class UsageStatisticsService {
  async recordEvent(eventData: {
    itemPersistentID: string;
    itemTitle: string;
    eventType: string;
    linkType?: string;
    catalogType?: string | null;
    catalogPath?: string | null;
  }): Promise<UsageEvent> {
    const repository = AppDataSource.getRepository(UsageEvent);
    const event = repository.create(eventData);
    return repository.save(event);
  }

  async countEventsByType(eventType: string): Promise<number> {
    return AppDataSource.getRepository(UsageEvent).count({ where: { eventType } });
  }

  async getUsageEvents(dateRange?: UsageDateRange, catalogType?: UsageCatalogType): Promise<UsageEvent[]> {
    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .orderBy('usageEvent.createdAt', 'DESC')
      .addOrderBy('usageEvent.id', 'DESC');

    return applyDateRange(query, 'usageEvent', dateRange, catalogType).getMany();
  }

  async getOverallStatistics(
    dateRange?: UsageDateRange,
    catalogType?: UsageCatalogType,
  ): Promise<OverallUsageStatistics> {
    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select(
        'SUM(CASE WHEN usageEvent.eventType = :itemViewEventType THEN 1 ELSE 0 END)',
        'totalViews',
      )
      .addSelect(
        'SUM(CASE WHEN usageEvent.eventType = :externalClickEventType THEN 1 ELSE 0 END)',
        'totalExternalClicks',
      )
      .setParameters({
        itemViewEventType: 'ITEM_VIEW',
        externalClickEventType: 'EXTERNAL_CLICK',
      });
    const result = await applyDateRange(query, 'usageEvent', dateRange, catalogType).getRawOne();

    return {
      totalViews: Number(result?.totalViews ?? 0),
      totalExternalClicks: Number(result?.totalExternalClicks ?? 0),
    };
  }

  async getUniqueCatalogEntryCount(
    dateRange?: UsageDateRange,
    catalogType?: UsageCatalogType,
  ): Promise<number> {
    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select('COUNT(DISTINCT usageEvent.catalogType, usageEvent.itemPersistentID)', 'uniqueCatalogEntries');
    const result = await applyDateRange(query, 'usageEvent', dateRange, catalogType).getRawOne();
    return Number(result?.uniqueCatalogEntries ?? 0);
  }

  async getDailyActivity(
    dateRange?: UsageDateRange,
    catalogType?: UsageCatalogType,
  ): Promise<DailyUsageActivity[]> {
    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select('DATE(usageEvent.createdAt)', 'date')
      .addSelect(
        'SUM(CASE WHEN usageEvent.eventType = :itemViewEventType THEN 1 ELSE 0 END)',
        'views',
      )
      .addSelect(
        'SUM(CASE WHEN usageEvent.eventType = :externalClickEventType THEN 1 ELSE 0 END)',
        'externalClicks',
      )
      .setParameters({
        itemViewEventType: 'ITEM_VIEW',
        externalClickEventType: 'EXTERNAL_CLICK',
      })
      .andWhere('usageEvent.eventType IN (:...activityEventTypes)', {
        activityEventTypes: ['ITEM_VIEW', 'EXTERNAL_CLICK'],
      })
      .groupBy('DATE(usageEvent.createdAt)')
      .orderBy('DATE(usageEvent.createdAt)', 'ASC');
    const results = await applyDateRange(query, 'usageEvent', dateRange, catalogType).getRawMany();
    const dailyCounts = new Map<string, DailyUsageActivity>();

    for (const result of results) {
      const date = result.date instanceof Date ? localDateKey(result.date) : String(result.date).slice(0, 10);
      dailyCounts.set(date, {
        date,
        views: Number(result.views ?? 0),
        externalClicks: Number(result.externalClicks ?? 0),
      });
    }

    if (dateRange?.from && dateRange.toExclusive) {
      const cursor = new Date(dateRange.from);
      const maxFilledDays = 366;
      const selectedDayCount = Math.round((dateRange.toExclusive.getTime() - dateRange.from.getTime()) / 86400000);
      if (selectedDayCount > 0 && selectedDayCount <= maxFilledDays) {
        const filledDays: DailyUsageActivity[] = [];
        while (cursor < dateRange.toExclusive) {
          const date = localDateKey(cursor);
          filledDays.push(dailyCounts.get(date) ?? { date, views: 0, externalClicks: 0 });
          cursor.setDate(cursor.getDate() + 1);
        }
        return filledDays;
      }
    }

    return [...dailyCounts.values()];
  }

  async getCatalogTypeActivity(
    dateRange?: UsageDateRange,
    catalogType?: UsageCatalogType,
  ): Promise<CatalogTypeActivity[]> {
    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select('usageEvent.catalogType', 'catalogType')
      .addSelect('COUNT(*)', 'count')
      .where('usageEvent.catalogType IN (:...supportedCatalogTypes)', { supportedCatalogTypes })
      .groupBy('usageEvent.catalogType');
    const results = await applyDateRange(query, 'usageEvent', dateRange, catalogType).getRawMany();
    const counts = new Map<UsageCatalogType, number>(
      supportedCatalogTypes.map((type) => [type, 0]),
    );

    for (const result of results) {
      if (counts.has(result.catalogType)) counts.set(result.catalogType, Number(result.count ?? 0));
    }

    return supportedCatalogTypes.map((type) => ({
      catalogType: type,
      label: catalogTypeLabels[type],
      count: counts.get(type) ?? 0,
    }));
  }

  async getCatalogTypeViewActivity(
    dateRange?: UsageDateRange,
    catalogType?: UsageCatalogType,
  ): Promise<CatalogTypeActivity[]> {
    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select('usageEvent.catalogType', 'catalogType')
      .addSelect('COUNT(*)', 'count')
      .where('usageEvent.eventType = :catalogViewEventType', { catalogViewEventType: 'ITEM_VIEW' })
      .andWhere('usageEvent.catalogType IN (:...supportedCatalogTypes)', { supportedCatalogTypes })
      .groupBy('usageEvent.catalogType');
    const results = await applyDateRange(query, 'usageEvent', dateRange, catalogType).getRawMany();
    const counts = new Map<UsageCatalogType, number>(supportedCatalogTypes.map((type) => [type, 0]));

    for (const result of results) {
      if (counts.has(result.catalogType)) counts.set(result.catalogType, Number(result.count ?? 0));
    }

    return supportedCatalogTypes.map((type) => ({
      catalogType: type,
      label: catalogTypeLabels[type],
      count: counts.get(type) ?? 0,
    }));
  }

  async getPerItemStatistics(
    sortBy: UsageStatisticsSortBy = 'views',
    dateRange?: UsageDateRange,
    catalogType?: UsageCatalogType,
  ): Promise<PerItemUsageStatistics[]> {
    const sortColumn = sortBy === 'views' ? 'views' : 'externalClicks';

    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select('usageEvent.itemPersistentID', 'itemPersistentID')
      .addSelect('usageEvent.catalogType', 'catalogType')
      .addSelect(
        (subQueryBuilder) => {
          const titleQuery = subQueryBuilder
            .select('latestUsageEvent.itemTitle')
            .from(UsageEvent, 'latestUsageEvent')
            .where('latestUsageEvent.itemPersistentID = usageEvent.itemPersistentID')
            .andWhere('latestUsageEvent.catalogType <=> usageEvent.catalogType');
          applyDateRange(titleQuery, 'latestUsageEvent', dateRange, catalogType);
          return titleQuery
            .orderBy('latestUsageEvent.createdAt', 'DESC')
            .addOrderBy('latestUsageEvent.id', 'DESC')
            .limit(1);
        },
        'itemTitle',
      )
      .addSelect(
        (subQueryBuilder) => {
          const pathQuery = subQueryBuilder
            .select('latestUsageEvent.catalogPath')
            .from(UsageEvent, 'latestUsageEvent')
            .where('latestUsageEvent.itemPersistentID = usageEvent.itemPersistentID')
            .andWhere('latestUsageEvent.catalogType <=> usageEvent.catalogType');
          applyDateRange(pathQuery, 'latestUsageEvent', dateRange, catalogType);
          return pathQuery
            .orderBy('latestUsageEvent.createdAt', 'DESC')
            .addOrderBy('latestUsageEvent.id', 'DESC')
            .limit(1);
        },
        'catalogPath',
      )
      .addSelect(
        'SUM(CASE WHEN usageEvent.eventType = :itemViewEventType THEN 1 ELSE 0 END)',
        'views',
      )
      .addSelect(
        'SUM(CASE WHEN usageEvent.eventType = :externalClickEventType THEN 1 ELSE 0 END)',
        'externalClicks',
      )
      .setParameters({
        itemViewEventType: 'ITEM_VIEW',
        externalClickEventType: 'EXTERNAL_CLICK',
      })
      .groupBy('usageEvent.catalogType')
      .addGroupBy('usageEvent.itemPersistentID')
      .orderBy(sortColumn, 'DESC')
      .addOrderBy('usageEvent.catalogType', 'ASC')
      .addOrderBy('usageEvent.itemPersistentID', 'ASC');

    const results = await applyDateRange(query, 'usageEvent', dateRange, catalogType).getRawMany();

    return results.map((result) => ({
      catalogType: result.catalogType ?? null,
      catalogPath: result.catalogPath ?? null,
      itemPersistentID: result.itemPersistentID,
      itemTitle: result.itemTitle,
      views: Number(result.views ?? 0),
      externalClicks: Number(result.externalClicks ?? 0),
    }));
  }
}
