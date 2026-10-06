import { Request, Response } from 'express';
import { UsageStatisticsService, UsageStatisticsSortBy } from '../services/UsageStatisticsService.js';

const usageStatisticsService = new UsageStatisticsService();

export class UsageDashboardController {
  async show(req: Request, res: Response): Promise<Response | void> {
    const sortBy: UsageStatisticsSortBy = req.query.sort === 'externalClicks' ? 'externalClicks' : 'views';

    try {
      const overallStatistics = await usageStatisticsService.getOverallStatistics();
      const itemStatistics = await usageStatisticsService.getPerItemStatistics(sortBy);

      return res.render('pages/usage-statistics', {
        title: 'Usage Statistics',
        overallStatistics,
        itemStatistics,
        sortBy,
      });
    } catch (error) {
      console.error('Failed to load usage statistics:', error);
      return res.status(500).send('Unable to load usage statistics');
    }
  }

  async export(req: Request, res: Response): Promise<Response> {
    try {
      const generatedAt = new Date();
      const overallStatistics = await usageStatisticsService.getOverallStatistics();
      const itemStatistics = await usageStatisticsService.getPerItemStatistics('views');
      const events = await usageStatisticsService.getUsageEvents();

      const payload = {
        generatedAt: generatedAt.toISOString(),
        summary: overallStatistics,
        items: itemStatistics,
        events: events.map((event) => ({
          id: event.id,
          itemPersistentID: event.itemPersistentID,
          itemTitle: event.itemTitle,
          eventType: event.eventType,
          linkType: event.linkType ?? null,
          createdAt: event.createdAt,
        })),
      };

      const date = generatedAt.toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="splice-usage-statistics-${date}.json"`);

      return res.send(JSON.stringify(payload, null, 2));
    } catch (error) {
      console.error('Failed to export usage statistics:', error);
      return res.status(500).send('Unable to export usage statistics');
    }
  }

  async exportCsv(req: Request, res: Response): Promise<Response> {
    try {
      const generatedAt = new Date();
      const itemStatistics = await usageStatisticsService.getPerItemStatistics('views');
      const escapeCsvField = (value: string | number): string => {
        const field = String(value);
        return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
      };

      const rows = [
        ['itemPersistentID', 'itemTitle', 'views', 'externalClicks'].join(','),
        ...itemStatistics.map((item) =>
          [item.itemPersistentID, item.itemTitle, item.views, item.externalClicks]
            .map(escapeCsvField)
            .join(','),
        ),
      ];

      const date = generatedAt.toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="splice-usage-statistics-${date}.csv"`);

      return res.send(rows.join('\r\n'));
    } catch (error) {
      console.error('Failed to export usage statistics CSV:', error);
      return res.status(500).send('Unable to export usage statistics');
    }
  }
}
