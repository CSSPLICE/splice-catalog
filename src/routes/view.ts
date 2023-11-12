import express from 'express';
import { ViewController } from '../controllers/ViewController';
import { requiresAuth } from 'express-openid-connect';

const viewController = new ViewController();

const router = express.Router();

router.get('/', viewController.homeView);
router.get('/profile', requiresAuth(), viewController.profileView);

export default router;
