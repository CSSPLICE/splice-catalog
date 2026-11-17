import { Request, Response } from 'express';
import { LiveUsageBotProtection, liveUsageBotProtection, Decision } from '../services/LiveUsageBotProtection.js';
import { classifyBrowserRequest, notCounted, browserUsageContext } from '../middleware/liveUsageProtection.js';
import { AppDataSource } from '../db/data-source.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { UsageStatisticsService } from '../services/UsageStatisticsService.js';
import { SearchStatisticsService } from '../services/SearchStatisticsService.js';
import { ProvisionalUsageService, provisionalUsageService } from '../services/ProvisionalUsageService.js';
import type { BrowserUsagePayload, BrowserEventKind } from '../db/entities/ProvisionalUsageEvent.js';
import { parseSearchQuery } from '../utils/searchQuery.js';

const usageStatisticsService = new UsageStatisticsService();
const searchStatisticsService = new SearchStatisticsService();
const supportedLinkTypes = { SLC_ITEM: 'iframe_url', TOOL: 'tool_url', DATASET: 'resource_url' } as const;

export class UsageController {
  constructor(
    private protection: LiveUsageBotProtection = liveUsageBotProtection,
    private provisional: ProvisionalUsageService | null = provisionalUsageService,
  ) {}

  private get delayed() {
    return this.protection.options.mode === 'enforce' && this.provisional !== null;
  }

  private async stage(
    req: Request,
    res: Response,
    decision: Decision,
    kind: BrowserEventKind,
    identity: string,
    payload: BrowserUsagePayload | null,
  ): Promise<Response> {
    const context = browserUsageContext(req, this.protection);
    if (!context || !this.provisional)
      return notCounted(res, { decision: 'REVIEW', reason: 'CREDENTIAL_CONTEXT_UNAVAILABLE' });
    try {
      const result = await this.provisional.stage({
        sessionId: context.sessionId,
        sessionStartedAt: context.startedAt,
        ip: context.ip,
        userAgent: context.userAgent,
        eventId: context.eventId,
        kind,
        identity,
        decision,
        payload,
      });
      return res.status(202).json(result);
    } catch (error) {
      // A commit can be ambiguous. Retrying the same ID is safe because the DB
      // event key is unique; release only the local reservation, not DB evidence.
      this.protection.releaseReplayReservation(context.sessionId, context.eventId);
      const reason =
        error instanceof Error &&
        [
          'PROVISIONAL_MIGRATION_REQUIRED',
          'PROVISIONAL_CONFIGURATION_MISMATCH',
          'PROVISIONAL_CAPACITY',
          'PROVISIONAL_REPLAY_NOT_STORED',
        ].includes(error.message)
          ? error.message
          : 'PROVISIONAL_UNAVAILABLE';
      return res.status(503).json({ counted: false, decision: 'REVIEW', reason });
    }
  }

  private async withhold(
    req: Request,
    res: Response,
    decision: Decision,
    kind: BrowserEventKind,
    identity: string,
  ): Promise<Response> {
    if (this.delayed && browserUsageContext(req, this.protection))
      return this.stage(req, res, decision, kind, identity, null);
    return notCounted(res, decision);
  }
  recordEntryClick(req: Request, res: Response): Promise<Response> {
    return this.recordClick(req, res, 'ENTRY_CLICK');
  }

  recordExternalClick(req: Request, res: Response): Promise<Response> {
    return this.recordClick(req, res, 'EXTERNAL_CLICK');
  }

  async recordWebSearch(req: Request, res: Response): Promise<Response> {
    const { query, error } = parseSearchQuery(req.body?.query);
    if (error || !query)
      return res.status(400).json({
        counted: false,
        decision: 'REJECT',
        reason: 'PAYLOAD_INVALID',
        error: error || 'A nonempty search query is required.',
      });
    const decision = classifyBrowserRequest(req, 'WEB_SEARCH', query, this.protection);
    if (decision.decision !== 'ACCEPT') return this.withhold(req, res, decision, 'WEB_SEARCH', query);
    try {
      if (this.delayed)
        return this.stage(req, res, decision, 'WEB_SEARCH', query, {
          kind: 'WEB_SEARCH',
          query,
          catalogType: 'SLC_ITEM',
        });
      // This measures explicit submissions, not background retrieval or identified users.
      await searchStatisticsService.recordSearch({ source: 'WEB', query, catalogType: 'SLC_ITEM', resultCount: null });
      return res.status(201).json({ success: true, counted: true, ...decision });
    } catch {
      console.error('Failed to record WEB search analytics');
      return res.status(500).json({
        counted: false,
        decision: 'REVIEW',
        reason: 'STORAGE_UNAVAILABLE',
        error: 'Unable to record search analytics',
      });
    }
  }

  private async recordClick(
    req: Request,
    res: Response,
    eventType: 'ENTRY_CLICK' | 'EXTERNAL_CLICK',
  ): Promise<Response> {
    const { catalogType: requestedType, itemIdentifier, itemPersistentID, linkType } = req.body ?? {};
    const catalogType: unknown = requestedType ?? (itemPersistentID ? 'SLC_ITEM' : undefined);
    const identifier = itemIdentifier ?? itemPersistentID;
    if (
      (catalogType !== 'SLC_ITEM' && catalogType !== 'TOOL' && catalogType !== 'DATASET') ||
      typeof identifier !== 'string' ||
      !identifier.trim() ||
      identifier.length > 255 ||
      (eventType === 'EXTERNAL_CLICK' && supportedLinkTypes[catalogType] !== linkType)
    )
      return res
        .status(400)
        .json({ counted: false, decision: 'REJECT', reason: 'PAYLOAD_INVALID', error: 'Invalid click data' });

    if (
      catalogType !== 'SLC_ITEM' &&
      (!/^\d+$/.test(identifier) || !Number.isSafeInteger(Number(identifier)) || Number(identifier) <= 0)
    ) {
      return res
        .status(400)
        .json({ counted: false, decision: 'REJECT', reason: 'PAYLOAD_INVALID', error: 'Invalid catalog item ID' });
    }
    const decision = classifyBrowserRequest(req, eventType, `${catalogType}:${identifier}`, this.protection);
    if (decision.decision !== 'ACCEPT')
      return this.withhold(req, res, decision, eventType, `${catalogType}:${identifier}`);
    try {
      let snapshot: { itemPersistentID: string; itemTitle: string; catalogPath: string; resourceUrl?: string };
      if (catalogType === 'SLC_ITEM') {
        const item = await AppDataSource.getRepository(slc_item_catalog).findOneBy({ persistentID: identifier });
        if (!item)
          return res
            .status(404)
            .json({ counted: false, decision: 'REJECT', reason: 'ITEM_NOT_FOUND', error: 'Catalog item not found' });
        snapshot = {
          itemPersistentID: item.persistentID,
          itemTitle: item.title?.trim() || item.persistentID,
          catalogPath: `/catalog/item/${item.id}`,
          resourceUrl: item.iframe_url,
        };
      } else {
        const id = Number(identifier);
        if (catalogType === 'TOOL') {
          const tool = await AppDataSource.getRepository(slc_tools_catalog).findOneBy({ id });
          if (!tool)
            return res
              .status(404)
              .json({ counted: false, decision: 'REJECT', reason: 'ITEM_NOT_FOUND', error: 'Tool not found' });
          snapshot = {
            itemPersistentID: String(tool.id),
            itemTitle: tool.platform_name,
            catalogPath: `/toolcatalog/item/${tool.id}`,
            resourceUrl: tool.url,
          };
        } else {
          const dataset = await AppDataSource.getRepository(dataset_catalog).findOneBy({ id });
          if (!dataset)
            return res
              .status(404)
              .json({ counted: false, decision: 'REJECT', reason: 'ITEM_NOT_FOUND', error: 'Dataset not found' });
          snapshot = {
            itemPersistentID: String(dataset.id),
            itemTitle: dataset.title?.trim() || dataset.dataset_name?.trim() || 'Dataset',
            catalogPath: `/datasetcatalog/item/${dataset.id}`,
            resourceUrl: dataset.resource_url,
          };
        }
      }
      if (eventType === 'EXTERNAL_CLICK' && !snapshot.resourceUrl?.trim()) {
        return res.status(400).json({
          counted: false,
          decision: 'REJECT',
          reason: 'PAYLOAD_INVALID',
          error: 'Catalog entry has no resource URL',
        });
      }
      if (this.delayed)
        return this.stage(req, res, decision, eventType, `${catalogType}:${identifier}`, {
          kind: eventType,
          itemPersistentID: snapshot.itemPersistentID,
          itemTitle: snapshot.itemTitle,
          catalogPath: snapshot.catalogPath,
          catalogType,
          ...(eventType === 'EXTERNAL_CLICK' ? { linkType: supportedLinkTypes[catalogType] } : {}),
        });
      await usageStatisticsService.recordEvent({
        itemPersistentID: snapshot.itemPersistentID,
        itemTitle: snapshot.itemTitle,
        catalogPath: snapshot.catalogPath,
        catalogType,
        eventType,
        ...(eventType === 'EXTERNAL_CLICK' ? { linkType: supportedLinkTypes[catalogType] } : {}),
      });
      return res.status(201).json({ success: true, counted: true, ...decision });
    } catch {
      console.error(`Failed to record ${eventType} usage event`);
      return res.status(500).json({
        counted: false,
        decision: 'REVIEW',
        reason: 'STORAGE_UNAVAILABLE',
        error: 'Unable to record usage event',
      });
    }
  }
}
