import express from 'express';
import { UsageDashboardController } from '../controllers/UsageDashboardController.js';
import { UsageAuditHistoryController } from '../controllers/UsageAuditHistoryController.js';
import { checkRole, roles } from '../middleware/middleware.js';

const router = express.Router();
const usageDashboardController = new UsageDashboardController();
const auditHistory = new UsageAuditHistoryController();

router.use('/usage-statistics/audit', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
}, checkRole(roles.admin));
router.get('/usage-statistics/audit', (req, res) => auditHistory.page(req, res));
router.get('/usage-statistics/audit/export.json', (req, res) => auditHistory.export(req, res, 'json'));
router.get('/usage-statistics/audit/export.csv', (req, res) => auditHistory.export(req, res, 'csv'));

router.get('/usage-statistics/historical', checkRole(roles.admin), (req, res) => usageDashboardController.historicalPage(req, res));
router.get('/usage-statistics/historical/export', checkRole(roles.admin), (req, res) => usageDashboardController.exportHistorical(req, res));
router.get('/usage-statistics/historical/export.csv', checkRole(roles.admin), (req, res) => usageDashboardController.exportHistorical(req, res, 'csv'));

router.get('/usage-statistics/export', checkRole(roles.admin), (req, res) => usageDashboardController.export(req, res));
router.get('/usage-statistics/export.csv', checkRole(roles.admin), (req, res) => usageDashboardController.exportCsv(req, res));
router.get('/usage-statistics', checkRole(roles.admin), (req, res) => usageDashboardController.show(req, res));

export default router;
