import express from 'express';
import { ViewController } from '../controllers/ViewController';

const viewController = new ViewController();

const router = express.Router();

router.get('/', viewController.homeView);

export default router;
