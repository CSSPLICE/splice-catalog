import express from 'express';
import { ViewController } from '../controllers/ViewController';

const router = express.Router();
const viewController = new ViewController();

router.get('/catalog', viewController.catalogView);
router.post('/upload', viewController.uploadPost);
router.post('/approve', viewController.approveAll);
router.post('/reject-all', viewController.rejectAll);

export default router;