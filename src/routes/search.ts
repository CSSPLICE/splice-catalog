import express from 'express';
import { SearchController } from '../controllers/SearchController';


const searchController = new SearchController();

const router = express.Router();

router.post('/', searchController.searchCatalog);
router.get('/', searchController.searchCatalog); //for pagination links
router.get('/dump/:query', searchController.dumpSearchResultsAPI);
router.get('/:query', searchController.searchCatalogByPath);


export default router;
