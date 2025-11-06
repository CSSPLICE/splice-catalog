import express from 'express';
import { SearchController } from '../controllers/SearchController.js';

const searchController = new SearchController();
const router = express.Router();

router.get('/:catalog', searchController.searchCatalogAPI);

export default router;
