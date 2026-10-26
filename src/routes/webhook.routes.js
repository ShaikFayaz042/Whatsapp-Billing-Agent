import { Router } from 'express';
import { verifyWebhook, handleWebhookPost } from '../controllers/webhook.controller.js';

const router = Router();

router.get('/', verifyWebhook);
router.post('/', handleWebhookPost);

export default router;