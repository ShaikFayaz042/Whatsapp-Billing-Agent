import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import webhookRoutes from './routes/webhook.routes.js';
import billEditRoutes from './routes/bill-edit.routes.js';

const app = express();
const publicDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public',
);

// Capture raw body so the webhook handler can verify Meta's HMAC signature.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use('/webhook', webhookRoutes);
app.use('/edit-assets', express.static(publicDirectory, {
  etag: true,
  maxAge: '1h',
}));
app.use('/edit', billEditRoutes);

export default app;