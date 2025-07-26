import express from 'express';
import { SearchController } from '../controllers/SearchController';


const searchController = new SearchController();

const router = express.Router();

router.post('/', searchController.searchCatalog);
router.get('/', searchController.searchCatalog); //for pagination links
<<<<<<< HEAD
router.get('/api', searchController.searchCatalogAPI);
=======
router.get('/dump/:query', searchController.dumpSearchResultsAPI);
router.get('/:query', searchController.searchCatalogByPath);

>>>>>>> lalit_manmari_backup

export default router;
