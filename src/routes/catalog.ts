import express from 'express';
import { CatalogController } from '../controllers/CatalogController';

const catalogController = new CatalogController();

const router = express.Router();

router.get('/', catalogController.getCatalog);
router.post('/', catalogController.createCatalogItem);
router.post('/:id', catalogController.deleteCatalogItem);
router.get("/dump/:id", catalogController.dumpItem);
//router.get('/item/:name', (req, res) => catalogController.getCatalogItemByName(req, res));

export default router;
