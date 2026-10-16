import { AppDataSource } from '../db/data-source.js';
import { HistoricalUsage } from '../db/entities/HistoricalUsage.js';
import { UsageEvent } from '../db/entities/UsageEvent.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
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
  liveViews: number;
  historicalViews: number;
  totalExternalClicks: number;
}

export interface PerItemUsageStatistics {
  catalogType: string | null;
  catalogPath: string | null;
  itemPersistentID: string;
  itemTitle: string;
  views: number;
  liveViews: number;
  historicalViews: number;
  externalClicks: number;
  lifecycleStatus?: 'RENAMED' | 'DELETED' | 'RECREATED';
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
const historicalUsageSource = 'nginx_historical';

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

    const liveViews = Number(result?.totalViews ?? 0);
    let historicalViews = 0;
    if (!dateRange && (!catalogType || catalogType === 'SLC_ITEM')) {
      const historicalResult = await AppDataSource.getRepository(HistoricalUsage)
        .createQueryBuilder('historicalUsage')
        .select('COALESCE(SUM(historicalUsage.viewCount), 0)', 'historicalViews')
        .where('historicalUsage.source = :historicalSource', { historicalSource: historicalUsageSource })
        .andWhere('historicalUsage.catalogType = :historicalCatalogType', { historicalCatalogType: 'SLC_ITEM' })
        .andWhere('historicalUsage.itemPersistentID IS NOT NULL')
        .getRawOne();
      historicalViews = Number(historicalResult?.historicalViews ?? 0);
    }

    return {
      totalViews: liveViews + historicalViews,
      liveViews,
      historicalViews,
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

    if (!dateRange && (!catalogType || catalogType === 'SLC_ITEM')) {
      const historicalResult = await AppDataSource.getRepository(HistoricalUsage)
        .createQueryBuilder('historicalUsage')
        .select('COALESCE(SUM(historicalUsage.viewCount), 0)', 'count')
        .where('historicalUsage.source = :historicalSource', { historicalSource: historicalUsageSource })
        .andWhere('historicalUsage.catalogType = :historicalCatalogType', { historicalCatalogType: 'SLC_ITEM' })
        .andWhere('historicalUsage.itemPersistentID IS NOT NULL')
        .getRawOne();
      const slcCount = counts.get('SLC_ITEM') ?? 0;
      counts.set('SLC_ITEM', slcCount + Number(historicalResult?.count ?? 0));
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

    const statisticsByIdentity = new Map<string, PerItemUsageStatistics>();
    const identityKey = (catalogType: string | null, itemPersistentID: string) =>
      JSON.stringify([catalogType, itemPersistentID]);

    for (const result of results) {
      const catalogType = result.catalogType ?? null;
      const liveViews = Number(result.views ?? 0);
      const item: PerItemUsageStatistics = {
        catalogType,
        catalogPath: result.catalogPath ?? null,
        itemPersistentID: result.itemPersistentID,
        itemTitle: result.itemTitle,
        views: liveViews,
        liveViews,
        historicalViews: 0,
        externalClicks: Number(result.externalClicks ?? 0),
      };
      statisticsByIdentity.set(identityKey(catalogType, item.itemPersistentID), item);
    }

    if (!dateRange && (!catalogType || catalogType === 'SLC_ITEM')) {
      const historicalRows = await AppDataSource.getRepository(HistoricalUsage)
        .createQueryBuilder('historicalUsage')
        .where('historicalUsage.source = :historicalSource', { historicalSource: historicalUsageSource })
        .andWhere('historicalUsage.catalogType = :historicalCatalogType', { historicalCatalogType: 'SLC_ITEM' })
        .andWhere('historicalUsage.itemPersistentID IS NOT NULL')
        .getMany();

      for (const historicalRow of historicalRows) {
        const itemPersistentID = historicalRow.itemPersistentID;
        if (!itemPersistentID) continue;
        const key = identityKey('SLC_ITEM', itemPersistentID);
        const existing = statisticsByIdentity.get(key);
        if (existing) {
          existing.historicalViews += historicalRow.viewCount;
          existing.views += historicalRow.viewCount;
          if (!existing.catalogPath) existing.catalogPath = historicalRow.catalogPath;
          if (!existing.itemTitle) existing.itemTitle = historicalRow.itemTitle ?? itemPersistentID;
        } else {
          statisticsByIdentity.set(key, {
            catalogType: 'SLC_ITEM',
            catalogPath: historicalRow.catalogPath,
            itemPersistentID,
            itemTitle: historicalRow.itemTitle ?? itemPersistentID,
            views: historicalRow.viewCount,
            liveViews: 0,
            historicalViews: historicalRow.viewCount,
            externalClicks: 0,
          });
        }
      }
    }

    return [...statisticsByIdentity.values()].sort((left, right) => {
      const countDifference = right[sortColumn] - left[sortColumn];
      if (countDifference !== 0) return countDifference;
      const typeDifference = (left.catalogType ?? '').localeCompare(right.catalogType ?? '');
      return typeDifference || left.itemPersistentID.localeCompare(right.itemPersistentID);
    });
  }

  async addLifecycleStatuses(items: PerItemUsageStatistics[]): Promise<PerItemUsageStatistics[]> {
    const slcItems = items.filter((item) => item.catalogType === 'SLC_ITEM');
    if (slcItems.length > 0) {
      const [currentCatalogItems, eventSnapshots, historicalSnapshots] = await Promise.all([
        AppDataSource.getRepository(slc_item_catalog).find({
          select: ['id', 'persistentID', 'title'],
        }),
        AppDataSource.getRepository(UsageEvent)
          .createQueryBuilder('usageEvent')
          .select('usageEvent.itemPersistentID', 'itemPersistentID')
          .addSelect(
            "MAX(CASE WHEN currentItem.id IS NOT NULL AND BINARY usageEvent.itemTitle <> BINARY currentItem.title THEN 1 ELSE 0 END)",
            'hasDifferentTitle',
          )
          .addSelect(
            "MAX(CASE WHEN currentItem.id IS NOT NULL AND usageEvent.catalogPath REGEXP '^/catalog/item/[0-9]+$' AND CAST(SUBSTRING_INDEX(usageEvent.catalogPath, '/', -1) AS UNSIGNED) <> currentItem.id THEN 1 ELSE 0 END)",
            'hasDifferentCatalogID',
          )
          .leftJoin(slc_item_catalog, 'currentItem', 'currentItem.persistentID = usageEvent.itemPersistentID')
          .where('usageEvent.catalogType = :slcCatalogType', { slcCatalogType: 'SLC_ITEM' })
          .groupBy('usageEvent.itemPersistentID')
          .getRawMany(),
        AppDataSource.getRepository(HistoricalUsage).find({
          select: ['itemPersistentID', 'itemTitle', 'catalogPath'],
          where: { source: historicalUsageSource, catalogType: 'SLC_ITEM' },
        }),
      ]);

      const currentByPersistentID = new Map(currentCatalogItems.map((item) => [item.persistentID, item]));
      const snapshotsByPersistentID = new Map<string, { hasDifferentTitle: boolean; hasDifferentCatalogID: boolean }>();
      for (const snapshot of eventSnapshots) {
        snapshotsByPersistentID.set(snapshot.itemPersistentID, {
          hasDifferentTitle: Number(snapshot.hasDifferentTitle) > 0,
          hasDifferentCatalogID: Number(snapshot.hasDifferentCatalogID) > 0,
        });
      }

      for (const historicalSnapshot of historicalSnapshots) {
        if (!historicalSnapshot.itemPersistentID) continue;
        const currentItem = currentByPersistentID.get(historicalSnapshot.itemPersistentID);
        if (!currentItem) continue;
        const state = snapshotsByPersistentID.get(historicalSnapshot.itemPersistentID) ?? {
          hasDifferentTitle: false,
          hasDifferentCatalogID: false,
        };
        if (historicalSnapshot.itemTitle && historicalSnapshot.itemTitle !== currentItem.title) {
          state.hasDifferentTitle = true;
        }
        const pathID = historicalSnapshot.catalogPath?.match(/^\/catalog\/item\/(\d+)$/)?.[1];
        if (pathID && Number(pathID) !== currentItem.id) state.hasDifferentCatalogID = true;
        snapshotsByPersistentID.set(historicalSnapshot.itemPersistentID, state);
      }

      for (const item of slcItems) {
        const currentItem = currentByPersistentID.get(item.itemPersistentID);
        if (!currentItem) {
          item.lifecycleStatus = 'DELETED';
          item.catalogPath = null;
          continue;
        }

        const snapshots = snapshotsByPersistentID.get(item.itemPersistentID);
        if (snapshots?.hasDifferentCatalogID) {
          item.lifecycleStatus = 'RECREATED';
          item.catalogPath = `/catalog/item/${currentItem.id}`;
        } else if (snapshots?.hasDifferentTitle) {
          item.lifecycleStatus = 'RENAMED';
        }
      }
    }
    return items;
  }
}
