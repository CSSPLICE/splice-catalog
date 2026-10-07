import { Request, Response } from 'express';
import {
  CatalogTypeActivity,
  DailyUsageActivity,
  UsageDateRange,
  UsageCatalogType,
  OverallUsageStatistics,
  PerItemUsageStatistics,
  UsageStatisticsService,
  UsageStatisticsSortBy,
} from '../services/UsageStatisticsService.js';

const usageStatisticsService = new UsageStatisticsService();

interface ParsedDateRange {
  from: string;
  to: string;
  dateRange?: UsageDateRange;
  error?: string;
}

function parseCalendarDate(value: unknown, label: string): { value: string; date?: Date; error?: string } {
  if (value === undefined || value === '') return { value: '' };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { value: typeof value === 'string' ? value : '', error: `${label} must use YYYY-MM-DD format.` };
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { value, error: `${label} must be a valid calendar date.` };
  }
  return { value, date };
}

function parseDateRange(req: Request): ParsedDateRange {
  const fromResult = parseCalendarDate(req.query.from, 'From date');
  const toResult = parseCalendarDate(req.query.to, 'To date');
  const from = fromResult.value;
  const to = toResult.value;

  if (fromResult.error || toResult.error) {
    return { from, to, error: fromResult.error ?? toResult.error };
  }
  if (from && to && from > to) {
    return { from, to, error: 'From date must be on or before To date.' };
  }

  const dateRange: UsageDateRange = {};
  if (fromResult.date) dateRange.from = fromResult.date;
  if (toResult.date) {
    const toExclusive = toResult.date;
    toExclusive.setDate(toExclusive.getDate() + 1);
    dateRange.toExclusive = toExclusive;
  }
  return {
    from,
    to,
    dateRange: dateRange.from || dateRange.toExclusive ? dateRange : undefined,
  };
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function periodLabel(from: string, to: string): string {
  if (from && to) return `Showing activity from ${formatDate(from)} through ${formatDate(to)}`;
  if (from) return `Showing activity from ${formatDate(from)} onward`;
  if (to) return `Showing activity through ${formatDate(to)}`;
  return 'All-time activity';
}

function exportFilename(extension: 'json' | 'csv', generatedAt: Date, from: string, to: string): string {
  const period = from && to ? `${from}-to-${to}` : generatedAt.toISOString().slice(0, 10);
  return `splice-usage-statistics-${period}.${extension}`;
}

function parseCatalogType(value: unknown): UsageCatalogType | undefined {
  if (value === 'SLC_ITEM' || value === 'TOOL' || value === 'DATASET') return value;
  return undefined;
}

function buildDashboardQuery(
  from: string,
  to: string,
  catalogType: 'ALL' | UsageCatalogType,
  sort?: UsageStatisticsSortBy,
  query?: string,
): string {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (catalogType !== 'ALL') params.set('catalogType', catalogType);
  if (query) params.set('q', query);
  if (sort) params.set('sort', sort);
  return params.toString();
}

export class UsageDashboardController {
  async show(req: Request, res: Response): Promise<Response | void> {
    const sortBy: UsageStatisticsSortBy = req.query.sort === 'externalClicks' ? 'externalClicks' : 'views';
    const parsedRange = parseDateRange(req);
    const catalogType = parseCatalogType(req.query.catalogType);
    const selectedCatalogType = catalogType ?? 'ALL';
    const searchQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    try {
      let overallStatistics: OverallUsageStatistics = { totalViews: 0, totalExternalClicks: 0 };
      let allItemStatistics: PerItemUsageStatistics[] = [];
      let activityOverTime: DailyUsageActivity[] = [];
      let catalogTypeActivity: CatalogTypeActivity[] = [
        { catalogType: 'SLC_ITEM', label: 'SLC Items', count: 0 },
        { catalogType: 'TOOL', label: 'Tools', count: 0 },
        { catalogType: 'DATASET', label: 'Datasets', count: 0 },
      ];
      let uniqueCatalogEntries = 0;

      if (!parsedRange.error) {
        [overallStatistics, allItemStatistics, uniqueCatalogEntries, activityOverTime, catalogTypeActivity] = await Promise.all([
            usageStatisticsService.getOverallStatistics(parsedRange.dateRange, catalogType),
            usageStatisticsService.getPerItemStatistics(sortBy, parsedRange.dateRange, catalogType),
            usageStatisticsService.getUniqueCatalogEntryCount(parsedRange.dateRange, catalogType),
            usageStatisticsService.getDailyActivity(parsedRange.dateRange, catalogType),
            usageStatisticsService.getCatalogTypeViewActivity(parsedRange.dateRange, catalogType),
          ]);
      }

      const itemStatistics = searchQuery
        ? allItemStatistics.filter((item) =>
            [item.itemTitle, item.catalogPath ?? '', item.itemPersistentID]
              .some((value) => value.toLowerCase().includes(searchQuery.toLowerCase())),
          )
        : allItemStatistics;

      return res.render('pages/usage-statistics', {
        title: 'Usage Statistics',
        overallStatistics,
        uniqueCatalogEntries,
        activityOverTime,
        catalogTypeActivity,
        hasAnalytics: overallStatistics.totalViews + overallStatistics.totalExternalClicks > 0,
        itemStatistics,
        sortBy,
        selectedCatalogType,
        from: parsedRange.from,
        to: parsedRange.to,
        searchQuery,
        exportQuery: buildDashboardQuery(parsedRange.from, parsedRange.to, selectedCatalogType),
        sortViewsQuery: buildDashboardQuery(parsedRange.from, parsedRange.to, selectedCatalogType, 'views', searchQuery),
        sortClicksQuery: buildDashboardQuery(parsedRange.from, parsedRange.to, selectedCatalogType, 'externalClicks', searchQuery),
        filterSort: sortBy,
        validationMessage: parsedRange.error,
        rangeLabel: parsedRange.error ? '' : periodLabel(parsedRange.from, parsedRange.to),
      });
    } catch (error) {
      console.error('Failed to load usage statistics:', error);
      return res.status(500).send('Unable to load usage statistics');
    }
  }

  async export(req: Request, res: Response): Promise<Response> {
    const parsedRange = parseDateRange(req);
    const catalogType = parseCatalogType(req.query.catalogType);
    if (parsedRange.error) return res.status(400).send(parsedRange.error);

    try {
      const generatedAt = new Date();
      const [overallStatistics, itemStatistics, events] = await Promise.all([
        usageStatisticsService.getOverallStatistics(parsedRange.dateRange, catalogType),
        usageStatisticsService.getPerItemStatistics('views', parsedRange.dateRange, catalogType),
        usageStatisticsService.getUsageEvents(parsedRange.dateRange, catalogType),
      ]);

      const payload = {
        generatedAt: generatedAt.toISOString(),
        period: {
          from: parsedRange.from || null,
          to: parsedRange.to || null,
        },
        filters: {
          catalogType: catalogType ?? 'ALL',
        },
        summary: overallStatistics,
        items: itemStatistics,
        events: events.map((event) => ({
          id: event.id,
          itemPersistentID: event.itemPersistentID,
          itemTitle: event.itemTitle,
          eventType: event.eventType,
          linkType: event.linkType ?? null,
          catalogType: event.catalogType ?? null,
          catalogPath: event.catalogPath ?? null,
          createdAt: event.createdAt,
        })),
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exportFilename('json', generatedAt, parsedRange.from, parsedRange.to)}"`,
      );
      return res.send(JSON.stringify(payload, null, 2));
    } catch (error) {
      console.error('Failed to export usage statistics:', error);
      return res.status(500).send('Unable to export usage statistics');
    }
  }

  async exportCsv(req: Request, res: Response): Promise<Response> {
    const parsedRange = parseDateRange(req);
    const catalogType = parseCatalogType(req.query.catalogType);
    if (parsedRange.error) return res.status(400).send(parsedRange.error);

    try {
      const generatedAt = new Date();
      const itemStatistics = await usageStatisticsService.getPerItemStatistics('views', parsedRange.dateRange, catalogType);
      const escapeCsvField = (value: string | number | null): string => {
        const field = String(value ?? '');
        return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
      };
      const rows = [
        [
          'fromDate',
          'toDate',
          'catalogType',
          'catalogPath',
          'itemPersistentID',
          'itemTitle',
          'views',
          'externalClicks',
        ].join(','),
        ...itemStatistics.map((item) =>
          [
            parsedRange.from,
            parsedRange.to,
            item.catalogType,
            item.catalogPath,
            item.itemPersistentID,
            item.itemTitle,
            item.views,
            item.externalClicks,
          ]
            .map(escapeCsvField)
            .join(','),
        ),
      ];

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exportFilename('csv', generatedAt, parsedRange.from, parsedRange.to)}"`,
      );
      return res.send(rows.join('\r\n'));
    } catch (error) {
      console.error('Failed to export usage statistics CSV:', error);
      return res.status(500).send('Unable to export usage statistics');
    }
  }
}
