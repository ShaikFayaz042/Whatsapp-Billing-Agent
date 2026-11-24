import { env } from '../config/env.js';
import Customer, { normalizePhoneNumber } from '../models/customer.model.js';

export function assertCustomerSeedEnabled({
  mongoUri = env.mongodbUri,
  seedCustomers = env.seedCustomers,
} = {}) {
  if (seedCustomers !== 'true') {
    throw new Error('Set SEED_CUSTOMERS=true to explicitly enable real customer seeding.');
  }
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required to seed customers.');
  }

  let parsedUri;
  try {
    parsedUri = new URL(mongoUri);
  } catch {
    throw new Error('MONGODB_URI is not a valid MongoDB connection URI.');
  }
  if (parsedUri.protocol !== 'mongodb:' && parsedUri.protocol !== 'mongodb+srv:') {
    throw new Error('MONGODB_URI must use mongodb:// or mongodb+srv://.');
  }
}

export async function upsertCustomers(records, CustomerModel = Customer) {
  if (!Array.isArray(records)) {
    throw new TypeError('Customer data must be a JSON array.');
  }

  const preparedRecords = [];
  const seenPhoneNumbers = new Set();
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError(`Customer at index ${index} must be an object.`);
    }
    const phoneNumber = normalizePhoneNumber(record.phoneNumber);
    if (seenPhoneNumbers.has(phoneNumber)) {
      throw new Error(`Duplicate phone number in customer data at index ${index}.`);
    }
    seenPhoneNumbers.add(phoneNumber);

    const customerData = {
      name: record.name,
      phoneNumber,
      aliases: record.aliases ?? [],
      whatsappOptIn: record.whatsappOptIn ?? false,
      isTestCustomer: false,
      status: record.status ?? 'active',
      ...(record.notes === undefined ? {} : { notes: record.notes }),
    };
    await new CustomerModel(customerData).validate();
    preparedRecords.push(customerData);
  }

  let inserted = 0;
  let unchanged = 0;
  for (const customer of preparedRecords) {
    const now = new Date();
    const result = await CustomerModel.updateOne(
      { phoneNumber: customer.phoneNumber },
      {
        $setOnInsert: {
          ...customer,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, runValidators: true, timestamps: false },
    );
    if (result.upsertedCount === 1) inserted += 1;
    else unchanged += 1;
  }

  return { inserted, unchanged };
}
