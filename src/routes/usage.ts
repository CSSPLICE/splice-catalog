import express from 'express';
import { UsageController } from '../controllers/UsageController.js';

const router = express.Router();
const usageController = new UsageController();

router.post('/external-click', (req, res) => usageController.recordExternalClick(req, res));

export default router;
