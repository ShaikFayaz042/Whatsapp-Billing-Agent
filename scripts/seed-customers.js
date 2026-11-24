import { copyFile, readFile } from 'node:fs/promises';
import Customer from '../src/models/customer.model.js';
import { connectToDatabase, disconnectFromDatabase } from '../src/services/database.service.js';
import {
  assertCustomerSeedEnabled,
  upsertCustomers,
} from '../src/services/customer-seed.service.js';

async function main() {
  assertCustomerSeedEnabled();

  const fileUrl = new URL('../data/customers.json', import.meta.url);
  let records;
  try {
    records = JSON.parse(await readFile(fileUrl, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const exampleUrl = new URL('../data/customers.example.json', import.meta.url);
      await copyFile(exampleUrl, fileUrl);
      console.log(
        'Created data/customers.json. Add real customer records, then run the seed command again.',
      );
      return;
    }
    if (error instanceof SyntaxError) {
      throw new Error('data/customers.json contains invalid JSON.');
    }
    throw error;
  }
  if (!Array.isArray(records)) {
    throw new Error('data/customers.json must contain a JSON array.');
  }
  if (records.length === 0) {
    console.log('No real customers configured; nothing was seeded.');
    return;
  }

  try {
    await connectToDatabase();
    await Customer.init();
    const result = await upsertCustomers(records);
    console.log(
      `Customer seed complete: ${result.inserted} inserted, ${result.unchanged} unchanged.`,
    );
  } finally {
    await disconnectFromDatabase();
  }
}

main().catch((error) => {
  console.error(`[seed] ${error.message}`);
  process.exitCode = 1;
});
