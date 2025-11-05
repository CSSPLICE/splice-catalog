import express from 'express';
import { downloadValidationResults, ViewController } from '../controllers/ViewController.js';
import multer from 'multer';
import pkg from 'express-openid-connect';
import { checkRole, roles } from '../middleware/middleware.js';
const { requiresAuth } = pkg;

const viewController = new ViewController();

const router = express.Router();

const maxSize = 1000000 * 50;

const upload = multer({ dest: '/tmp', limits: { fieldSize: maxSize } });

router.get('/', viewController.homeView);
router.post('/upload', checkRole(roles.contributor), upload.single('file'), viewController.uploadPost);
router.get('/upload', checkRole(roles.contributor), viewController.uploadView);

router.get('/instructions', viewController.instructionsView);
router.get('/catalog', viewController.catalogView);
router.get('/datasetcatalog', viewController.datasetCatalogView);
router.get('/toolcatalog', viewController.toolView);
router.get('/about', viewController.aboutView);
router.get('/profile', requiresAuth(), viewController.profileView);
router.get('/download-validation-results', downloadValidationResults);

export default router;
