import express from 'express';
import { ViewController } from '../controllers/ViewController';

const router = express.Router();
const viewController = new ViewController();

router.get('/catalog', viewController.catalogView);
router.post('/upload', viewController.uploadPost);
router.post('/approve', viewController.approveAll);

export default router;
