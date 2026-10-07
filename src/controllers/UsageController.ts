import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { UsageStatisticsService } from '../services/UsageStatisticsService.js';

const usageStatisticsService = new UsageStatisticsService();

export class UsageController {
  async recordExternalClick(req: Request, res: Response): Promise<Response> {
    const { catalogType: requestedCatalogType, itemIdentifier, itemPersistentID, linkType } = req.body ?? {};
    const catalogType = requestedCatalogType ?? (itemPersistentID ? 'SLC_ITEM' : undefined);
    const identifier = itemIdentifier ?? itemPersistentID;
    const supportedLinkTypes: Record<string, string> = {
      SLC_ITEM: 'iframe_url',
      TOOL: 'tool_url',
      DATASET: 'resource_url',
    };

    if (
      typeof catalogType !== 'string' ||
      supportedLinkTypes[catalogType] !== linkType ||
      typeof identifier !== 'string' ||
      !identifier.trim()
    ) {
      return res.status(400).json({ error: 'Invalid external click data' });
    }

    try {
      if (catalogType === 'SLC_ITEM') {
        const item = await AppDataSource.getRepository(slc_item_catalog).findOneBy({ persistentID: identifier });
        if (!item) return res.status(404).json({ error: 'Catalog item not found' });

        await usageStatisticsService.recordEvent({
          itemPersistentID: item.persistentID,
          itemTitle: item.title,
          eventType: 'EXTERNAL_CLICK',
          linkType: 'iframe_url',
          catalogType: 'SLC_ITEM',
          catalogPath: `/catalog/item/${item.id}`,
        });
      } else {
        if (!/^\d+$/.test(identifier) || !Number.isSafeInteger(Number(identifier))) {
          return res.status(400).json({ error: 'Invalid catalog item ID' });
        }
        const id = Number(identifier);

        if (catalogType === 'TOOL') {
          const tool = await AppDataSource.getRepository(slc_tools_catalog).findOneBy({ id });
          if (!tool) return res.status(404).json({ error: 'Tool not found' });

          await usageStatisticsService.recordEvent({
            catalogType: 'TOOL',
            catalogPath: `/toolcatalog/item/${tool.id}`,
            itemPersistentID: String(tool.id),
            itemTitle: tool.platform_name,
            eventType: 'EXTERNAL_CLICK',
            linkType: 'tool_url',
          });
        } else {
          const dataset = await AppDataSource.getRepository(dataset_catalog).findOneBy({ id });
          if (!dataset) return res.status(404).json({ error: 'Dataset not found' });
          const itemTitle = dataset.title?.trim() || dataset.dataset_name?.trim() || 'Dataset';

          await usageStatisticsService.recordEvent({
            catalogType: 'DATASET',
            catalogPath: `/datasetcatalog/item/${dataset.id}`,
            itemPersistentID: String(dataset.id),
            itemTitle,
            eventType: 'EXTERNAL_CLICK',
            linkType: 'resource_url',
          });
        }
      }

      return res.status(201).json({ success: true });
    } catch (error) {
      console.error('Failed to record EXTERNAL_CLICK usage event:', error);
      return res.status(500).json({ error: 'Unable to record usage event' });
    }
  }
}
