import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { UsageStatisticsService } from '../services/UsageStatisticsService.js';

const usageStatisticsService = new UsageStatisticsService();

export class UsageController {
  async recordExternalClick(req: Request, res: Response): Promise<Response> {
    const { itemPersistentID, linkType } = req.body ?? {};

    if (typeof itemPersistentID !== 'string' || !itemPersistentID.trim() || linkType !== 'iframe_url') {
      return res.status(400).json({ error: 'Invalid external click data' });
    }

    try {
      const item = await AppDataSource.getRepository(slc_item_catalog).findOneBy({ persistentID: itemPersistentID });

      if (!item) {
        return res.status(404).json({ error: 'Catalog item not found' });
      }

      await usageStatisticsService.recordEvent({
        itemPersistentID: item.persistentID,
        itemTitle: item.title,
        eventType: 'EXTERNAL_CLICK',
        linkType: 'iframe_url',
      });

      return res.status(201).json({ success: true });
    } catch (error) {
      console.error('Failed to record EXTERNAL_CLICK usage event:', error);
      return res.status(500).json({ error: 'Unable to record usage event' });
    }
  }
}
