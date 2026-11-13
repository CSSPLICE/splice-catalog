import { AppDataSource } from '../db/data-source.js';
import { UsageEventAudit } from '../db/entities/UsageEventAudit.js';
import type { UsageAuditStatus } from '../db/entities/UsageEventAudit.js';
import type { BrowserEventKind } from '../db/entities/ProvisionalUsageEvent.js';
import type { UsageCatalogType } from './UsageStatisticsService.js';
import { liveUsageAuditConfiguration } from './LiveUsageAuditConfiguration.js';

export const auditExportLimit = 5000;
export const auditPageOffsetLimit = 10000;
export const auditDefaultDays = Math.min(30, liveUsageAuditConfiguration.retentionDays);

export interface AuditHistoryFilters {
  from: Date;
  toExclusive: Date;
  search?: string;
  status?: UsageAuditStatus;
  kind?: BrowserEventKind;
  catalogType?: UsageCatalogType;
  itemPersistentID?: string;
}

const auditColumns = ['finalizedAt', 'kind', 'status', 'reason', 'catalogType', 'itemPersistentID', 'itemTitle', 'officialEventId'] as const;
type AuditHistoryRow = Pick<UsageEventAudit, (typeof auditColumns)[number]>;

export class UsageAuditHistoryService {
  private query(filters: AuditHistoryFilters) {
    const query = AppDataSource.getRepository(UsageEventAudit).createQueryBuilder('audit')
      .where('audit.finalizedAt >= :from AND audit.finalizedAt < :toExclusive', {
        from: filters.from, toExclusive: filters.toExclusive,
      });
    if (filters.search) {
      query.andWhere(
        '(LOCATE(:search, audit.itemTitle) > 0 OR LOCATE(:search, audit.itemPersistentID) > 0 OR LOCATE(:search, audit.reason) > 0)',
        { search: filters.search },
      );
    }
    for (const key of ['status', 'kind', 'catalogType', 'itemPersistentID'] as const) {
      if (filters[key]) query.andWhere(`audit.${key} = :${key}`, { [key]: filters[key] });
    }
    return query;
  }

  private rowsQuery(filters: AuditHistoryFilters) {
    return this.query(filters)
      .select(auditColumns.map((column) => `audit.${column}`))
      .orderBy('audit.finalizedAt', 'DESC').addOrderBy('audit.id', 'DESC');
  }

  async page(filters: AuditHistoryFilters, requestedPage: number, pageSize: number) {
    const matchingCount = await this.query(filters).getCount();
    const totalPages = Math.min(
      Math.max(1, Math.ceil(matchingCount / pageSize)), Math.floor(auditPageOffsetLimit / pageSize) + 1,
    );
    const page = Math.min(requestedPage, totalPages);
    const rows: AuditHistoryRow[] = matchingCount
      ? await this.rowsQuery(filters).offset((page - 1) * pageSize).limit(pageSize).getMany()
      : [];
    return { rows, matchingCount, page, pageSize, totalPages, pageLimitReached: matchingCount > totalPages * pageSize };
  }

  async export(filters: AuditHistoryFilters): Promise<Array<AuditHistoryRow & Pick<UsageEventAudit, 'policyVersion'>>> {
    return this.rowsQuery(filters).addSelect('audit.policyVersion').limit(auditExportLimit + 1).getMany();
  }
}
