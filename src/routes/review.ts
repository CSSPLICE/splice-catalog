import express from 'express';
import { Request } from 'express';
import { ViewController } from '../controllers/ViewController';

const router = express.Router();
const viewController = new ViewController();

router.get('/catalog', viewController.catalogView);
router.post('/upload', viewController.uploadPost);
router.post('/approve', viewController.approveAll);
router.post('/validate', async (req: Request) => {
  console.log('Received JSON data:', req.body);
  // proceed with validation logic
});
export default router;
