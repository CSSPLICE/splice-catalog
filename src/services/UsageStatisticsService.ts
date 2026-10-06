import { AppDataSource } from '../db/data-source.js';
import { UsageEvent } from '../db/entities/UsageEvent.js';

export type UsageStatisticsSortBy = 'views' | 'externalClicks';

export interface OverallUsageStatistics {
  totalViews: number;
  totalExternalClicks: number;
}

export interface PerItemUsageStatistics {
  itemPersistentID: string;
  itemTitle: string;
  views: number;
  externalClicks: number;
}

export class UsageStatisticsService {
  async recordEvent(eventData: {
    itemPersistentID: string;
    itemTitle: string;
    eventType: string;
    linkType?: string;
  }): Promise<UsageEvent> {
    const repository = AppDataSource.getRepository(UsageEvent);
    const event = repository.create(eventData);
    return repository.save(event);
  }

  async countEventsByType(eventType: string): Promise<number> {
    return AppDataSource.getRepository(UsageEvent).count({ where: { eventType } });
  }

  async getUsageEvents(): Promise<UsageEvent[]> {
    return AppDataSource.getRepository(UsageEvent).find({
      order: {
        createdAt: 'DESC',
        id: 'DESC',
      },
    });
  }

  async getOverallStatistics(): Promise<OverallUsageStatistics> {
    const result = await AppDataSource.getRepository(UsageEvent)
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
      })
      .getRawOne();

    return {
      totalViews: Number(result?.totalViews ?? 0),
      totalExternalClicks: Number(result?.totalExternalClicks ?? 0),
    };
  }

  async getPerItemStatistics(sortBy: UsageStatisticsSortBy = 'views'): Promise<PerItemUsageStatistics[]> {
    const sortColumn = sortBy === 'views' ? 'views' : 'externalClicks';

    const results = await AppDataSource.getRepository(UsageEvent)
      .createQueryBuilder('usageEvent')
      .select('usageEvent.itemPersistentID', 'itemPersistentID')
      .addSelect(
        (subQuery) =>
          subQuery
            .select('latestUsageEvent.itemTitle')
            .from(UsageEvent, 'latestUsageEvent')
            .where('latestUsageEvent.itemPersistentID = usageEvent.itemPersistentID')
            .orderBy('latestUsageEvent.createdAt', 'DESC')
            .addOrderBy('latestUsageEvent.id', 'DESC')
            .limit(1),
        'itemTitle',
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
      .groupBy('usageEvent.itemPersistentID')
      .orderBy(sortColumn, 'DESC')
      .addOrderBy('usageEvent.itemPersistentID', 'ASC')
      .getRawMany();

    return results.map((result) => ({
      itemPersistentID: result.itemPersistentID,
      itemTitle: result.itemTitle,
      views: Number(result.views ?? 0),
      externalClicks: Number(result.externalClicks ?? 0),
    }));
  }
}
