import express from 'express';
import { CatalogController } from '../controllers/CatalogController.js';
import { SearchController } from '../controllers/SearchController.js';

const router = express.Router();

const catalogController = new CatalogController();
const searchController = new SearchController();

router.get('/super-search', (req, res) => searchController.searchCatalog(req, res));

router.post('/', catalogController.createCatalogItem);
router.post('/:id', catalogController.deleteCatalogItem);
router.get('/item/:id', (req, res) => catalogController.getCatalogItemByID(req, res));
router.get('/search/export', (req, res) => searchController.exportSearchResults(req, res));

export default router;