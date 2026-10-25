import { Request, Response } from 'express';
import {
  UsageDateRange,
  UsageCatalogType,
  PerItemUsageStatistics,
  UsageStatisticsService,
} from '../services/UsageStatisticsService.js';
import { SearchStatisticsService } from '../services/SearchStatisticsService.js';

const usageStatisticsService = new UsageStatisticsService();
const searchStatisticsService = new SearchStatisticsService();

interface ParsedDateRange {
  from: string;
  to: string;
  dateRange?: UsageDateRange;
  error?: string;
  period: 'all' | '7d' | '30d' | 'custom';
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

function parseDateRange(req: Request, preserveResolvedPreset = false): ParsedDateRange {
  const requestedPeriod = req.query.period;
  const period =
    requestedPeriod === 'all' || requestedPeriod === '7d' || requestedPeriod === '30d' || requestedPeriod === 'custom'
      ? requestedPeriod
      : req.query.from || req.query.to
        ? 'custom'
        : 'all';
  let fromValue = req.query.from;
  let toValue = req.query.to;
  if (period === 'all') {
    fromValue = '';
    toValue = '';
  }
  if ((period === '7d' || period === '30d') && !(preserveResolvedPreset && req.query.from && req.query.to)) {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (period === '7d' ? 6 : 29));
    fromValue = calendarKey(start);
    toValue = calendarKey(today);
  }
  const fromResult = parseCalendarDate(fromValue, 'From date');
  const toResult = parseCalendarDate(toValue, 'To date');
  const from = fromResult.value;
  const to = toResult.value;

  if (fromResult.error || toResult.error) {
    return { from, to, period, error: fromResult.error ?? toResult.error };
  }
  if (from && to && from > to) {
    return { from, to, period, error: 'From date must be on or before To date.' };
  }

  if (period === 'custom' && !from && !to)
    return { from, to, period, error: 'Choose at least one date for a custom range.' };
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
    period,
    dateRange: dateRange.from || dateRange.toExclusive ? dateRange : undefined,
  };
}

function calendarKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  period: ParsedDateRange['period'],
): string {
  const params = new URLSearchParams();
  params.set('period', period);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (catalogType !== 'ALL') params.set('catalogType', catalogType);
  return params.toString();
}

function liveEntries(items: PerItemUsageStatistics[]) {
  return items
    .filter((item) => item.entryClicks > 0 || item.externalClicks > 0)
    .map((item) => ({
      catalogType: item.catalogType,
      catalogPath: item.catalogPath,
      itemPersistentID: item.itemPersistentID,
      itemTitle: item.itemTitle,
      entryClicks: item.entryClicks,
      externalClicks: item.externalClicks,
    }));
}

function emptySnapshot(parsed: ParsedDateRange, catalogType?: UsageCatalogType) {
  return {
    generatedAt: new Date().toISOString(),
    filters: {
      period: parsed.period,
      from: parsed.from || null,
      to: parsed.to || null,
      catalogType: catalogType ?? 'ALL',
      frequentTermLimit: 100,
    },
    summary: {
      totalEntryClicks: 0,
      totalExternalClicks: 0,
      uniqueCatalogEntries: 0,
      webSearches: 0,
      publicApiSearches: 0,
    },
    activityOverTime: [] as Array<{
      date: string;
      entryClicks: number;
      externalClicks: number;
      publicApiSearches: number;
    }>,
    entryClicksByCatalogType: [
      { catalogType: 'SLC_ITEM', label: 'SLC Items', count: 0 },
      { catalogType: 'TOOL', label: 'Tools', count: 0 },
      { catalogType: 'DATASET', label: 'Datasets', count: 0 },
    ],
    catalogEntryStatistics: [] as ReturnType<typeof liveEntries>,
    frequentSearchTerms: [] as Awaited<ReturnType<SearchStatisticsService['getFrequentTerms']>>,
  };
}

// One shared projection feeds the page and both export formats. Legacy event data is never projected.
async function loadDashboardSnapshot(parsed: ParsedDateRange, catalogType?: UsageCatalogType) {
  const snapshot = emptySnapshot(parsed, catalogType);
  if (parsed.error) return snapshot;
  const range = parsed.dateRange;
  const [overall, items, unique, clicks, catalogActivity, searches, terms, dailyApi] = await Promise.all([
    usageStatisticsService.getOverallStatistics(range, catalogType, false),
    usageStatisticsService.getPerItemStatistics('entryClicks', range, catalogType, false),
    usageStatisticsService.getUniqueCatalogEntryCount(range, catalogType),
    usageStatisticsService.getDailyActivity(range, catalogType),
    usageStatisticsService.getCatalogTypeEntryActivity(range, catalogType),
    searchStatisticsService.getSummary(range, catalogType),
    searchStatisticsService.getFrequentTerms(range, catalogType),
    searchStatisticsService.getDailyPublicApiSearches(range, catalogType),
  ]);
  snapshot.summary = {
    totalEntryClicks: overall.totalEntryClicks,
    totalExternalClicks: overall.totalExternalClicks,
    uniqueCatalogEntries: unique,
    webSearches: searches.webSearches,
    publicApiSearches: searches.publicApiSearches,
  };
  const days = new Map<string, (typeof snapshot.activityOverTime)[number]>();
  for (const row of clicks)
    days.set(row.date, {
      date: row.date,
      entryClicks: row.entryClicks,
      externalClicks: row.externalClicks,
      publicApiSearches: 0,
    });
  for (const row of dailyApi) {
    const day = days.get(row.date) ?? { date: row.date, entryClicks: 0, externalClicks: 0, publicApiSearches: 0 };
    day.publicApiSearches = row.publicApiSearches;
    days.set(row.date, day);
  }
  snapshot.activityOverTime = [...days.values()]
    .filter((row) => range || row.entryClicks > 0 || row.externalClicks > 0 || row.publicApiSearches > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  snapshot.entryClicksByCatalogType = snapshot.entryClicksByCatalogType.map((row) => ({
    ...row,
    count: catalogActivity.find((activity) => activity.catalogType === row.catalogType)?.count ?? 0,
  }));
  snapshot.catalogEntryStatistics = liveEntries(await usageStatisticsService.addLifecycleStatuses(items, false));
  snapshot.frequentSearchTerms = terms.map((term) => ({
    query: term.query,
    webSearches: term.webSearches,
    publicApiSearches: term.publicApiSearches,
    totalSearches: term.totalSearches,
  }));
  return snapshot;
}

type DashboardSnapshot = Awaited<ReturnType<typeof loadDashboardSnapshot>>;

function csvField(value: unknown): string {
  const text = String(value ?? '');
  const safe =
    typeof value === 'string' && (/^[\s\p{Cc}]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value)) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function snapshotCsv(snapshot: DashboardSnapshot): string {
  const table = (headers: string[], rows: object[]) => [
    headers,
    ...rows.map((row) => headers.map((header) => (row as Record<string, unknown>)[header])),
  ];
  const blocks: unknown[][][] = [
    [
      ['Summary'],
      ['generatedAt', snapshot.generatedAt],
      ...Object.entries(snapshot.filters).map(([key, value]) => [`filters.${key}`, value]),
      ['metric', 'value'],
      ...Object.entries(snapshot.summary),
    ],
    [
      ['Activity Over Time'],
      ...table(['date', 'entryClicks', 'externalClicks', 'publicApiSearches'], snapshot.activityOverTime),
    ],
    [['Entry Clicks by Catalog Type'], ...table(['catalogType', 'label', 'count'], snapshot.entryClicksByCatalogType)],
    [
      ['Catalog Entry Statistics'],
      ...table(
        ['catalogType', 'catalogPath', 'itemPersistentID', 'itemTitle', 'entryClicks', 'externalClicks'],
        snapshot.catalogEntryStatistics,
      ),
    ],
    [
      ['Frequent Search Terms'],
      ...table(['query', 'webSearches', 'publicApiSearches', 'totalSearches'], snapshot.frequentSearchTerms),
    ],
  ];
  return blocks.map((rows) => rows.map((row) => row.map(csvField).join(',')).join('\r\n')).join('\r\n\r\n');
}

export class UsageDashboardController {
  async show(req: Request, res: Response): Promise<Response | void> {
    const parsed = parseDateRange(req);
    const catalogType = parseCatalogType(req.query.catalogType);
    const selectedCatalogType = catalogType ?? 'ALL';
    try {
      const snapshot = await loadDashboardSnapshot(parsed, catalogType);
      return res.render('pages/usage-statistics', {
        title: 'Usage Statistics',
        overallStatistics: snapshot.summary,
        uniqueCatalogEntries: snapshot.summary.uniqueCatalogEntries,
        activityOverTime: snapshot.activityOverTime,
        catalogTypeActivity: snapshot.entryClicksByCatalogType,
        itemStatistics: [...snapshot.catalogEntryStatistics].sort(
          (left, right) =>
            right.entryClicks - left.entryClicks ||
            right.externalClicks - left.externalClicks ||
            left.itemTitle.localeCompare(right.itemTitle),
        ),
        searchTerms: [...snapshot.frequentSearchTerms].sort(
          (left, right) => right.totalSearches - left.totalSearches || left.query.localeCompare(right.query),
        ),
        selectedCatalogType,
        period: parsed.period,
        today: calendarKey(new Date()),
        activeTab: req.query.tab === 'terms' ? 'terms' : 'entries',
        catalogContextLabel: catalogType
          ? `Across ${catalogType === 'SLC_ITEM' ? 'SLC items' : catalogType === 'TOOL' ? 'tools' : 'datasets'}`
          : 'Across all catalogs',
        from: parsed.from,
        to: parsed.to,
        searchQuery: typeof req.query.q === 'string' ? req.query.q.trim() : '',
        exportQuery: buildDashboardQuery(parsed.from, parsed.to, selectedCatalogType, parsed.period),
        validationMessage: parsed.error,
        rangeLabel: parsed.error ? '' : periodLabel(parsed.from, parsed.to),
      });
    } catch {
      console.error('Failed to load usage statistics');
      return res.status(500).send('Unable to load usage statistics');
    }
  }

  export(req: Request, res: Response): Promise<Response> {
    return this.exportSnapshot(req, res, 'json');
  }

  exportCsv(req: Request, res: Response): Promise<Response> {
    return this.exportSnapshot(req, res, 'csv');
  }

  // Separate all-time research report; never part of the live dashboard or its exports.
  async exportHistorical(req: Request, res: Response, format: 'json' | 'csv' = 'json'): Promise<Response> {
    try {
      const summary = await usageStatisticsService.getHistoricalUsageSummary();
      const historical = {
        source: 'nginx_historical',
        catalogType: 'SLC_ITEM',
        period: 'all-time',
        ...summary,
        imported: summary.rowCount > 0,
        note: 'Historical HTTP page-request aggregates, not intentional entry clicks or confirmed human activity. Independent of live filters.',
      };
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="splice-historical-usage.${format}"`);
      const csv = [Object.keys(historical), Object.values(historical)].map((row) => row.map(csvField).join(',')).join('\r\n');
      return res.send(format === 'json' ? JSON.stringify(historical, null, 2) : csv);
    } catch {
      console.error('Failed to export historical usage statistics');
      return res.status(500).send('Unable to export historical usage statistics');
    }
  }

  private async exportSnapshot(req: Request, res: Response, format: 'json' | 'csv'): Promise<Response> {
    const parsed = parseDateRange(req, true);
    if (parsed.error) return res.status(400).send(parsed.error);
    try {
      const snapshot = await loadDashboardSnapshot(parsed, parseCatalogType(req.query.catalogType));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exportFilename(format, new Date(snapshot.generatedAt), parsed.from, parsed.to)}"`,
      );
      return res.send(format === 'json' ? JSON.stringify(snapshot, null, 2) : snapshotCsv(snapshot));
    } catch {
      console.error('Failed to export usage statistics');
      return res.status(500).send('Unable to export usage statistics');
    }
  }
}
