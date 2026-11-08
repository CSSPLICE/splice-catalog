import express from 'express';
import { UsageController } from '../controllers/UsageController.js';

import { LiveUsageBotProtection, liveUsageBotProtection } from '../services/LiveUsageBotProtection.js';
import { renewUsageSession, usageJson, usagePayloadErrors } from '../middleware/liveUsageProtection.js';

export function createUsageRouter(protection: LiveUsageBotProtection = liveUsageBotProtection) {
  const router = express.Router();
  const usageController = new UsageController(protection);
  router.use(usageJson, usagePayloadErrors);
  router.post('/session', (req, res) => renewUsageSession(req, res, protection));

  router.post('/entry-click', (req, res) => usageController.recordEntryClick(req, res));
  router.post('/web-search', (req, res) => usageController.recordWebSearch(req, res));
  router.post('/external-click', (req, res) => usageController.recordExternalClick(req, res));

  return router;
}

export default createUsageRouter();
