import express from 'express';
import { SearchController } from '../controllers/SearchController.js';

const searchController = new SearchController();
const router = express.Router();

router.get('/results', (req, res) => searchController.searchCatalogResults(req, res));
router.post('/', searchController.searchCatalog);
router.get('/', searchController.searchCatalog); //for pagination links
router.get('/export', (req, res) => searchController.exportSearchResults(req, res));
export default router;
