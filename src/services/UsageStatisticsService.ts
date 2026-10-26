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

export type UsageStatisticsSortBy = 'entryClicks' | 'externalClicks';

export interface OverallUsageStatistics {
  totalEntryClicks: number;
  totalExternalClicks: number;
  legacyItemViews: number;
  historicalPageRequests: number;
}

export interface PerItemUsageStatistics {
  catalogType: string | null;
  catalogPath: string | null;
  itemPersistentID: string;
  itemTitle: string;
  entryClicks: number;
  externalClicks: number;
  legacyItemViews: number;
  historicalPageRequests: number;
  lifecycleStatus?: 'RENAMED' | 'DELETED' | 'RECREATED';
}

export interface HistoricalUsageEntry {
  catalogType: string;
  itemPersistentID: string | null;
  itemTitle: string;
  historicalPageRequests: number;
  catalogPath: string | null;
}

export interface DailyUsageActivity {
  date: string;
  entryClicks: number;
  externalClicks: number;
  legacyItemViews: number;
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
const historicalPageSize = 6;

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export class UsageStatisticsService {
  async recordEvent(eventData: {
    itemPersistentID: string;
    itemTitle: string;
    eventType: 'ENTRY_CLICK' | 'EXTERNAL_CLICK';
    linkType?: string;
    catalogType?: string | null;
    catalogPath?: string | null;
  }): Promise<UsageEvent> {
    const repository = AppDataSource.getRepository(UsageEvent);
    return repository.save(repository.create(eventData));
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

  private historicalQuery() {
    return AppDataSource.getRepository(HistoricalUsage)
      .createQueryBuilder('historicalUsage')
      .where('historicalUsage.source = :historicalSource', { historicalSource: historicalUsageSource })
      .andWhere('historicalUsage.catalogType = :historicalCatalogType', { historicalCatalogType: 'SLC_ITEM' })
      .andWhere('historicalUsage.itemPersistentID IS NOT NULL');
  }

  private historicalReportQuery(search = '') {
    const query = AppDataSource.getRepository(HistoricalUsage)
      .createQueryBuilder('historicalUsage')
      .where('historicalUsage.source = :source', { source: historicalUsageSource })
      .andWhere('historicalUsage.catalogType = :catalogType', { catalogType: 'SLC_ITEM' });
    if (search) {
      // LOCATE treats wildcard characters literally and keeps user input parameterized.
      query.andWhere(
        `(LOCATE(:historicalSearch, COALESCE(historicalUsage.itemTitle, '')) > 0 OR LOCATE(:historicalCatalogSearch, REPLACE(historicalUsage.catalogType, '_', ' ')) > 0)`,
        { historicalSearch: search, historicalCatalogSearch: search.replace(/_/g, ' ') },
      );
    }
    return query;
  }

  async getHistoricalUsageSummary(): Promise<{ rowCount: number; totalRequests: number }> {
    const result = await this.historicalReportQuery()
      .select('COUNT(*)', 'rowCount')
      .addSelect('COALESCE(SUM(historicalUsage.viewCount), 0)', 'totalRequests')
      .getRawOne();
    return { rowCount: Number(result?.rowCount ?? 0), totalRequests: Number(result?.totalRequests ?? 0) };
  }

  async getHistoricalUsageEntries(search = '', page?: number): Promise<HistoricalUsageEntry[]> {
    const query = this.historicalReportQuery(search)
      .leftJoin(slc_item_catalog, 'currentItem', 'BINARY currentItem.persistentID = BINARY historicalUsage.itemPersistentID')
      .select('historicalUsage.catalogType', 'catalogType')
      .addSelect('historicalUsage.itemPersistentID', 'itemPersistentID')
      .addSelect('historicalUsage.itemTitle', 'itemTitle')
      .addSelect('historicalUsage.viewCount', 'historicalPageRequests')
      .addSelect('currentItem.id', 'currentId')
      .addSelect('currentItem.persistentID', 'currentPersistentID')
      .orderBy('historicalUsage.viewCount', 'DESC')
      .addOrderBy('historicalUsage.itemTitle', 'ASC')
      .addOrderBy('historicalUsage.id', 'ASC');
    if (page !== undefined) query.offset((page - 1) * historicalPageSize).limit(historicalPageSize);
    const rows = await query.getRawMany();
    return rows.map((row) => {
      const currentId = Number(row.currentId);
      const matched = typeof row.itemPersistentID === 'string' && row.itemPersistentID.length > 0
        && row.currentPersistentID === row.itemPersistentID && Number.isSafeInteger(currentId) && currentId > 0;
      return {
        catalogType: String(row.catalogType),
        itemPersistentID: row.itemPersistentID ?? null,
        itemTitle: row.itemTitle || 'Untitled entry',
        historicalPageRequests: Number(row.historicalPageRequests),
        // Resolve the current local ID from the persistent identity, never the imported numeric ID/path.
        catalogPath: matched ? `/catalog/item/${currentId}` : null,
      };
    });
  }

  async getHistoricalUsagePage(search = '', requestedPage = 1) {
    const summary = await this.getHistoricalUsageSummary();
    const matchingCount = search ? await this.historicalReportQuery(search).getCount() : summary.rowCount;
    const totalPages = Math.max(1, Math.ceil(matchingCount / historicalPageSize));
    const page = Math.min(requestedPage, totalPages);
    return {
      ...summary,
      matchingCount,
      page,
      pageSize: historicalPageSize,
      totalPages,
      rows: await this.getHistoricalUsageEntries(search, page),
    };
  }

  async getOverallStatistics(
    dateRange?: UsageDateRange,
    catalogType?: UsageCatalogType,
    includeHistorical = true,
  ): Promise<OverallUsageStatistics> {
    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select("SUM(CASE WHEN usageEvent.eventType = 'ENTRY_CLICK' THEN 1 ELSE 0 END)", 'totalEntryClicks')
      .addSelect("SUM(CASE WHEN usageEvent.eventType = 'EXTERNAL_CLICK' THEN 1 ELSE 0 END)", 'totalExternalClicks')
      .addSelect("SUM(CASE WHEN usageEvent.eventType = 'ITEM_VIEW' THEN 1 ELSE 0 END)", 'legacyItemViews');
    const result = await applyDateRange(query, 'usageEvent', dateRange, catalogType).getRawOne();
    let historicalPageRequests = 0;
    if (includeHistorical && !dateRange && (!catalogType || catalogType === 'SLC_ITEM')) {
      const historical = await this.historicalQuery()
        .select('COALESCE(SUM(historicalUsage.viewCount), 0)', 'count')
        .getRawOne();
      historicalPageRequests = Number(historical?.count ?? 0);
    }
    return {
      totalEntryClicks: Number(result?.totalEntryClicks ?? 0),
      totalExternalClicks: Number(result?.totalExternalClicks ?? 0),
      legacyItemViews: Number(result?.legacyItemViews ?? 0),
      historicalPageRequests,
    };
  }

  async getUniqueCatalogEntryCount(dateRange?: UsageDateRange, catalogType?: UsageCatalogType): Promise<number> {
    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select('COUNT(DISTINCT usageEvent.catalogType, usageEvent.itemPersistentID)', 'uniqueCatalogEntries')
      .where('usageEvent.eventType IN (:...types)', { types: ['ENTRY_CLICK', 'EXTERNAL_CLICK'] });
    const result = await applyDateRange(query, 'usageEvent', dateRange, catalogType).getRawOne();
    return Number(result?.uniqueCatalogEntries ?? 0);
  }

  async getDailyActivity(dateRange?: UsageDateRange, catalogType?: UsageCatalogType): Promise<DailyUsageActivity[]> {
    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select('DATE(usageEvent.createdAt)', 'date')
      .addSelect("SUM(CASE WHEN usageEvent.eventType = 'ENTRY_CLICK' THEN 1 ELSE 0 END)", 'entryClicks')
      .addSelect("SUM(CASE WHEN usageEvent.eventType = 'EXTERNAL_CLICK' THEN 1 ELSE 0 END)", 'externalClicks')
      .addSelect("SUM(CASE WHEN usageEvent.eventType = 'ITEM_VIEW' THEN 1 ELSE 0 END)", 'legacyItemViews')
      .where('usageEvent.eventType IN (:...types)', { types: ['ENTRY_CLICK', 'EXTERNAL_CLICK', 'ITEM_VIEW'] })
      .groupBy('DATE(usageEvent.createdAt)')
      .orderBy('DATE(usageEvent.createdAt)', 'ASC');
    const results = await applyDateRange(query, 'usageEvent', dateRange, catalogType).getRawMany();
    const days = new Map<string, DailyUsageActivity>();
    for (const row of results) {
      const date = row.date instanceof Date ? localDateKey(row.date) : String(row.date).slice(0, 10);
      days.set(date, {
        date,
        entryClicks: Number(row.entryClicks ?? 0),
        externalClicks: Number(row.externalClicks ?? 0),
        legacyItemViews: Number(row.legacyItemViews ?? 0),
      });
    }
    if (dateRange?.from && dateRange.toExclusive) {
      const count = Math.round((dateRange.toExclusive.getTime() - dateRange.from.getTime()) / 86400000);
      if (count > 0 && count <= 366) {
        const filled: DailyUsageActivity[] = [];
        for (
          const cursor = new Date(dateRange.from);
          cursor < dateRange.toExclusive;
          cursor.setDate(cursor.getDate() + 1)
        ) {
          const date = localDateKey(cursor);
          filled.push(days.get(date) ?? { date, entryClicks: 0, externalClicks: 0, legacyItemViews: 0 });
        }
        return filled;
      }
    }
    return [...days.values()];
  }

  async getCatalogTypeEntryActivity(
    dateRange?: UsageDateRange,
    catalogType?: UsageCatalogType,
  ): Promise<CatalogTypeActivity[]> {
    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select('usageEvent.catalogType', 'catalogType')
      .addSelect('COUNT(*)', 'count')
      .where("usageEvent.eventType = 'ENTRY_CLICK'")
      .andWhere('usageEvent.catalogType IN (:...types)', { types: supportedCatalogTypes })
      .groupBy('usageEvent.catalogType');
    const results = await applyDateRange(query, 'usageEvent', dateRange, catalogType).getRawMany();
    return supportedCatalogTypes.map((type) => ({
      catalogType: type,
      label: catalogTypeLabels[type],
      count: Number(results.find((row) => row.catalogType === type)?.count ?? 0),
    }));
  }

  async getPerItemStatistics(
    sortBy: UsageStatisticsSortBy = 'entryClicks',
    dateRange?: UsageDateRange,
    catalogType?: UsageCatalogType,
    includeHistorical = true,
  ): Promise<PerItemUsageStatistics[]> {
    const query = AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select('usageEvent.itemPersistentID', 'itemPersistentID')
      .addSelect('usageEvent.catalogType', 'catalogType');
    for (const field of ['itemTitle', 'catalogPath']) {
      query.addSelect((sub) => {
        const latest = sub
          .select(`latestUsageEvent.${field}`)
          .from(UsageEvent, 'latestUsageEvent')
          .where('latestUsageEvent.itemPersistentID = usageEvent.itemPersistentID')
          .andWhere('latestUsageEvent.catalogType <=> usageEvent.catalogType');
        applyDateRange(latest, 'latestUsageEvent', dateRange, catalogType);
        return latest.orderBy('latestUsageEvent.createdAt', 'DESC').addOrderBy('latestUsageEvent.id', 'DESC').limit(1);
      }, field);
    }
    query
      .addSelect("SUM(CASE WHEN usageEvent.eventType = 'ENTRY_CLICK' THEN 1 ELSE 0 END)", 'entryClicks')
      .addSelect("SUM(CASE WHEN usageEvent.eventType = 'EXTERNAL_CLICK' THEN 1 ELSE 0 END)", 'externalClicks')
      .addSelect("SUM(CASE WHEN usageEvent.eventType = 'ITEM_VIEW' THEN 1 ELSE 0 END)", 'legacyItemViews')
      .where('usageEvent.eventType IN (:...types)', { types: ['ENTRY_CLICK', 'EXTERNAL_CLICK', 'ITEM_VIEW'] })
      .groupBy('usageEvent.catalogType')
      .addGroupBy('usageEvent.itemPersistentID');
    const results = await applyDateRange(query, 'usageEvent', dateRange, catalogType).getRawMany();
    const items = new Map<string, PerItemUsageStatistics>();
    const key = (type: string | null, id: string) => JSON.stringify([type, id]);
    for (const row of results) {
      const item = {
        catalogType: row.catalogType ?? null,
        catalogPath: row.catalogPath ?? null,
        itemPersistentID: row.itemPersistentID,
        itemTitle: row.itemTitle,
        entryClicks: Number(row.entryClicks ?? 0),
        externalClicks: Number(row.externalClicks ?? 0),
        legacyItemViews: Number(row.legacyItemViews ?? 0),
        historicalPageRequests: 0,
      };
      items.set(key(item.catalogType, item.itemPersistentID), item);
    }
    if (includeHistorical && !dateRange && (!catalogType || catalogType === 'SLC_ITEM')) {
      for (const row of await this.historicalQuery().getMany()) {
        if (!row.itemPersistentID) continue;
        const identity = key('SLC_ITEM', row.itemPersistentID);
        const item = items.get(identity) ?? {
          catalogType: 'SLC_ITEM',
          catalogPath: row.catalogPath,
          itemPersistentID: row.itemPersistentID,
          itemTitle: row.itemTitle ?? row.itemPersistentID,
          entryClicks: 0,
          externalClicks: 0,
          legacyItemViews: 0,
          historicalPageRequests: 0,
        };
        item.historicalPageRequests += row.viewCount;
        if (!item.catalogPath) item.catalogPath = row.catalogPath;
        items.set(identity, item);
      }
    }
    return [...items.values()].sort(
      (left, right) =>
        right[sortBy] - left[sortBy] ||
        (left.catalogType ?? '').localeCompare(right.catalogType ?? '') ||
        left.itemPersistentID.localeCompare(right.itemPersistentID),
    );
  }

  async addLifecycleStatuses(items: PerItemUsageStatistics[], includeHistorical = true): Promise<PerItemUsageStatistics[]> {
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
            'MAX(CASE WHEN currentItem.id IS NOT NULL AND BINARY usageEvent.itemTitle <> BINARY currentItem.title THEN 1 ELSE 0 END)',
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
        includeHistorical ? AppDataSource.getRepository(HistoricalUsage).find({
          select: ['itemPersistentID', 'itemTitle', 'catalogPath'],
          where: { source: historicalUsageSource, catalogType: 'SLC_ITEM' },
        }) : Promise.resolve([]),
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
