import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { UsageStatisticsService } from '../services/UsageStatisticsService.js';
import { SearchStatisticsService } from '../services/SearchStatisticsService.js';
import { parseSearchQuery } from '../utils/searchQuery.js';

const usageStatisticsService = new UsageStatisticsService();
const searchStatisticsService = new SearchStatisticsService();
const supportedLinkTypes = { SLC_ITEM: 'iframe_url', TOOL: 'tool_url', DATASET: 'resource_url' } as const;

export class UsageController {
  recordEntryClick(req: Request, res: Response): Promise<Response> {
    return this.recordClick(req, res, 'ENTRY_CLICK');
  }

  recordExternalClick(req: Request, res: Response): Promise<Response> {
    return this.recordClick(req, res, 'EXTERNAL_CLICK');
  }

  async recordWebSearch(req: Request, res: Response): Promise<Response> {
    const { query, error } = parseSearchQuery(req.body?.query);
    if (error || !query) return res.status(400).json({ error: error || 'A nonempty search query is required.' });
    try {
      // This measures explicit submissions, not background retrieval or identified users.
      await searchStatisticsService.recordSearch({ source: 'WEB', query, catalogType: 'SLC_ITEM', resultCount: null });
      return res.status(201).json({ success: true });
    } catch {
      console.error('Failed to record WEB search analytics');
      return res.status(500).json({ error: 'Unable to record search analytics' });
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
      return res.status(400).json({ error: 'Invalid click data' });

    try {
      let snapshot: { itemPersistentID: string; itemTitle: string; catalogPath: string; resourceUrl?: string };
      if (catalogType === 'SLC_ITEM') {
        const item = await AppDataSource.getRepository(slc_item_catalog).findOneBy({ persistentID: identifier });
        if (!item) return res.status(404).json({ error: 'Catalog item not found' });
        snapshot = {
          itemPersistentID: item.persistentID,
          itemTitle: item.title?.trim() || item.persistentID,
          catalogPath: `/catalog/item/${item.id}`,
          resourceUrl: item.iframe_url,
        };
      } else {
        const id = Number(identifier);
        if (!/^\d+$/.test(identifier) || !Number.isSafeInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Invalid catalog item ID' });
        }
        if (catalogType === 'TOOL') {
          const tool = await AppDataSource.getRepository(slc_tools_catalog).findOneBy({ id });
          if (!tool) return res.status(404).json({ error: 'Tool not found' });
          snapshot = {
            itemPersistentID: String(tool.id),
            itemTitle: tool.platform_name,
            catalogPath: `/toolcatalog/item/${tool.id}`,
            resourceUrl: tool.url,
          };
        } else {
          const dataset = await AppDataSource.getRepository(dataset_catalog).findOneBy({ id });
          if (!dataset) return res.status(404).json({ error: 'Dataset not found' });
          snapshot = {
            itemPersistentID: String(dataset.id),
            itemTitle: dataset.title?.trim() || dataset.dataset_name?.trim() || 'Dataset',
            catalogPath: `/datasetcatalog/item/${dataset.id}`,
            resourceUrl: dataset.resource_url,
          };
        }
      }
      if (eventType === 'EXTERNAL_CLICK' && !snapshot.resourceUrl?.trim()) {
        return res.status(400).json({ error: 'Catalog entry has no resource URL' });
      }
      await usageStatisticsService.recordEvent({
        itemPersistentID: snapshot.itemPersistentID,
        itemTitle: snapshot.itemTitle,
        catalogPath: snapshot.catalogPath,
        catalogType,
        eventType,
        ...(eventType === 'EXTERNAL_CLICK' ? { linkType: supportedLinkTypes[catalogType] } : {}),
      });
      return res.status(201).json({ success: true });
    } catch {
      console.error(`Failed to record ${eventType} usage event`);
      return res.status(500).json({ error: 'Unable to record usage event' });
    }
  }
}
