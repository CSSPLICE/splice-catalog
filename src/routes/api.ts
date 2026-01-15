import express from 'express';
import { SearchController } from '../controllers/SearchController.js';

const searchController = new SearchController();
const router = express.Router();

router.get('/:catalog', (req, res) => searchController.searchCatalogAPI(req, res));

export default router;
