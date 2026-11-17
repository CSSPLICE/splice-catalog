import type { Request, Response } from 'express';
import { liveUsageAuditConfiguration } from '../services/LiveUsageAuditConfiguration.js';
import {
  auditDefaultDays, auditExportLimit, auditPageOffsetLimit, UsageAuditHistoryService, type AuditHistoryFilters,
} from '../services/UsageAuditHistoryService.js';
import { csvField, parseCalendarDate } from '../utils/usageDashboardFormatting.js';

const history = new UsageAuditHistoryService();
const dayMs = 86_400_000;
const statuses = ['ACCEPTED', 'REVIEW', 'REJECTED', 'EXPIRED'] as const;
const kinds = ['ENTRY_CLICK', 'EXTERNAL_CLICK', 'WEB_SEARCH'] as const;
const catalogs = ['SLC_ITEM', 'TOOL', 'DATASET'] as const;
const keys = new Set(['q', 'status', 'kind', 'catalogType', 'itemPersistentID', 'period', 'from', 'to', 'page', 'pageSize']);

class InvalidAuditQuery extends Error {}

function parseAuditQuery(query: Request['query'], now: Date) {
  for (const [key, value] of Object.entries(query)) {
    if (!keys.has(key) || typeof value !== 'string') throw new InvalidAuditQuery('Invalid audit filter.');
  }
  const input = query as Record<string, string | undefined>;
  const choice = <T extends string>(key: string, options: readonly T[]) => {
    const value = input[key];
    if (!value) return undefined;
    const selected = options.find((option) => option === value);
    if (!selected) throw new InvalidAuditQuery(`Invalid ${key} filter.`);
    return selected;
  };
  const text = (key: string, max: number) => {
    const value = input[key];
    if (value && value.length > max) throw new InvalidAuditQuery(`Use at most ${max} characters for ${key}.`);
    return value?.trim() || undefined;
  };
  const integer = (key: string, fallback: number, max: number) => {
    const value = input[key] ?? String(fallback);
    const number = Number(value);
    if (!/^[1-9]\d*$/.test(value) || number > max) {
      throw new InvalidAuditQuery(`${key} must be an integer from 1 to ${max}.`);
    }
    return number;
  };

  const pageSize = integer('pageSize', 6, 100);
  const page = integer('page', 1, Math.floor(auditPageOffsetLimit / pageSize) + 1);
  const period = choice('period', ['7d', '30d', '90d', 'custom'] as const);
  let from: Date;
  let toExclusive: Date;
  if (period === 'custom') {
    const start = parseCalendarDate(input.from, 'From date');
    const end = parseCalendarDate(input.to, 'To date');
    if (start.error || end.error) throw new InvalidAuditQuery(start.error ?? end.error);
    if (!start.date || !end.date || start.value < '1000-01-01' || end.value > '9999-12-30') {
      throw new InvalidAuditQuery('Choose valid From and To dates for a custom range.');
    }
    if (start.value > end.value) throw new InvalidAuditQuery('From date must be on or before To date.');
    if (Date.parse(end.value) - Date.parse(start.value) >= 366 * dayMs) {
      throw new InvalidAuditQuery('Choose a custom range of at most 366 days.');
    }
    from = start.date;
    toExclusive = end.date;
  } else {
    if (input.from || input.to) throw new InvalidAuditQuery('Select Custom range to use From and To dates.');
    const days = period ? Number(period.slice(0, -1)) : auditDefaultDays;
    from = new Date(now);
    from.setHours(0, 0, 0, 0);
    toExclusive = new Date(from);
    from.setDate(from.getDate() - days + 1);
  }
  toExclusive.setDate(toExclusive.getDate() + 1);
  const filters: AuditHistoryFilters = {
    from, toExclusive, search: text('q', 200), status: choice('status', statuses),
    kind: choice('kind', kinds), catalogType: choice('catalogType', catalogs), itemPersistentID: text('itemPersistentID', 255),
  };
  return { filters, page, pageSize };
}

export class UsageAuditHistoryController {
  async page(req: Request, res: Response) {
    try {
      const { filters, page, pageSize } = parseAuditQuery(req.query, new Date());
      const result = await history.page(filters, page, pageSize);
      return res.json({
        ...result, collectionEnabled: liveUsageAuditConfiguration.enabled,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch (error) {
      if (error instanceof InvalidAuditQuery) return res.status(400).json({ error: error.message });
      console.error('Failed to load audit history');
      return res.status(500).json({ error: 'Unable to load audit history. Please try again.' });
    }
  }

  async export(req: Request, res: Response, format: 'json' | 'csv') {
    try {
      const { filters } = parseAuditQuery(req.query, new Date());
      const rows = await history.export(filters);
      if (rows.length > auditExportLimit) {
        return res.status(422).json({ error: `${format.toUpperCase()} export is limited to 5,000 records. Narrow the audit filters and try again.` });
      }
      res.attachment(`splice-audit-history.${format}`);
      if (format === 'json') return res.json(rows);
      const csv = [
        ['Finalized At', 'Event Type', 'Status', 'Reason', 'Catalog Type', 'Item Persistent ID', 'Item Title', 'Official Event ID', 'Policy Version'],
        ...rows.map((row) => [row.finalizedAt.toISOString(), row.kind, row.status, row.reason, row.catalogType,
          row.itemPersistentID, row.itemTitle, row.officialEventId, row.policyVersion]),
      ].map((row) => row.map(csvField).join(',')).join('\r\n');
      return res.type('text/csv').send(csv);
    } catch (error) {
      if (error instanceof InvalidAuditQuery) return res.status(400).json({ error: error.message });
      console.error('Failed to export audit history');
      return res.status(500).json({ error: 'Unable to export audit history. Please try again.' });
    }
  }
}
