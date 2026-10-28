import express from 'express';
import { UsageDashboardController } from '../controllers/UsageDashboardController.js';
import { checkRole, roles } from '../middleware/middleware.js';

const router = express.Router();
const usageDashboardController = new UsageDashboardController();

router.get('/usage-statistics/historical', checkRole(roles.admin), (req, res) => usageDashboardController.historicalPage(req, res));
router.get('/usage-statistics/historical/export', checkRole(roles.admin), (req, res) => usageDashboardController.exportHistorical(req, res));
router.get('/usage-statistics/historical/export.csv', checkRole(roles.admin), (req, res) => usageDashboardController.exportHistorical(req, res, 'csv'));

router.get('/usage-statistics/export', checkRole(roles.admin), (req, res) => usageDashboardController.export(req, res));
router.get('/usage-statistics/export.csv', checkRole(roles.admin), (req, res) => usageDashboardController.exportCsv(req, res));
router.get('/usage-statistics', checkRole(roles.admin), (req, res) => usageDashboardController.show(req, res));

export default router;
