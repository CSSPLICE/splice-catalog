import express from 'express';
import { CatalogController } from '../controllers/CatalogController.js';

const catalogController = new CatalogController();

const router = express.Router();

router.get('/search', (req, res) => catalogController.searchCatalog(req, res));

router.post('/', catalogController.createCatalogItem);
router.post('/:id', catalogController.deleteCatalogItem);
router.get('/item/:id', (req, res) => catalogController.getCatalogItemByID(req, res));

export default router;