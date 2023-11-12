import express from 'express';
import { SearchController } from '../controllers/SearchController';

const searchController = new SearchController();

const router = express.Router();

router.post('/', searchController.searchCatalog);

export default router;
