import express from 'express';
import { SearchController } from '../controllers/SearchController.js';

const searchController = new SearchController();

const router = express.Router();

router.post('/', searchController.searchCatalog);
router.get('/', searchController.searchCatalog); //for pagination links
router.get('/api', searchController.searchCatalogAPI);

export default router;
