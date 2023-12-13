import express from 'express';
import { ViewController } from '../controllers/ViewController';
import multer from 'multer';

const viewController = new ViewController();

const router = express.Router();

const upload = multer({ dest: './upload' });
if (process.env.NODE_ENV === 'production') {
    const upload = multer({ dest: './dist/upload' }); 
}

router.get('/', viewController.homeView);
router.post('/upload', upload.single('file'), viewController.uploadPost);
router.get('/upload', viewController.uploadView);

export default router;
