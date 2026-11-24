import app from './app.js';
import { env } from './config/env.js';
import { connectToDatabase } from './services/database.service.js';
import Customer from './models/customer.model.js';
import ActiveBill from './models/active-bill.model.js';

async function startServer() {
  if (!env.ownerWaId || !/^\d+$/.test(env.ownerWaId)) {
    throw new Error('OWNER_WA_ID must be set to the owner WhatsApp ID from Meta webhooks.');
  }
  await connectToDatabase();
  await Customer.init();
  await ActiveBill.init();
  app.listen(env.port, () => {
    console.log(`Server listening on port ${env.port}`);
  });
}

startServer().catch((error) => {
  console.error(`[startup] ${error.message}`);
  process.exitCode = 1;
});