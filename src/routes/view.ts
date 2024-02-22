import express from 'express';
import { ViewController } from '../controllers/ViewController';
import multer from 'multer';

const viewController = new ViewController();

const router = express.Router();

const maxSize = 1000000*50

const upload = multer({ dest: '/tmp', limits: {fieldSize: maxSize} });

router.get('/', viewController.homeView);
router.post('/upload', upload.single('file'), viewController.uploadPost);
router.get('/upload', viewController.uploadView);
router.post('/item', viewController.itemView);
router.get('/instructions', viewController.instructionsView);
router.get('/catalog', viewController.catalogView);

export default router;
