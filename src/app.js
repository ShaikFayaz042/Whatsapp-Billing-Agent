import express from 'express';
import webhookRoutes from './routes/webhook.routes.js';

const app = express();

// Capture raw body so the webhook handler can verify Meta's HMAC signature.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use('/webhook', webhookRoutes);

export default app;