import express from 'express';
import { ViewController } from '../controllers/ViewController.js';
import { downloadValidationResults } from '../controllers/ViewController.js';
import multer from 'multer';
import pkg from 'express-openid-connect';
const { requiresAuth } = pkg;

const viewController = new ViewController();

const router = express.Router();

const maxSize = 1000000 * 50;

const upload = multer({ dest: '/tmp', limits: { fieldSize: maxSize } });

router.get('/', viewController.homeView);
router.post('/upload', upload.single('file'), viewController.uploadPost);
router.get('/upload', viewController.uploadView);
router.get('/item/:id/:name', viewController.itemViewById);
router.get('/instructions', viewController.instructionsView);
router.get('/catalog', viewController.catalogView);
router.get('/datasetcatalog', viewController.datasetCatalogView);
router.get('/toolcatalog', viewController.toolView);
router.get('/about', viewController.aboutView);
router.get('/profile', requiresAuth(), viewController.profileView);
router.get('/download-validation-results', downloadValidationResults);

export default router;
