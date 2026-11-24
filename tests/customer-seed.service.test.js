import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCustomerSeedEnabled,
  upsertCustomers,
} from '../src/services/customer-seed.service.js';

test('real customer seed marks records as real and uses the configured MongoDB URI', async () => {
  const records = new Map();

  class FakeCustomerModel {
    constructor(data) {
      Object.assign(this, data);
    }

    async validate() {
      if (!this.name || !this.phoneNumber) throw new Error('validation failed');
      if (this.isTestCustomer !== false) throw new Error('must be a real customer');
    }

    static async updateOne(filter, update) {
      if (records.has(filter.phoneNumber)) return { upsertedCount: 0 };
      records.set(filter.phoneNumber, { ...update.$setOnInsert });
      return { upsertedCount: 1 };
    }
  }

  assert.doesNotThrow(() => assertCustomerSeedEnabled({
    mongoUri: 'mongodb://127.0.0.1:27017/whatsapp_billing_live',
    seedCustomers: 'true',
  }));
  assert.throws(
    () => assertCustomerSeedEnabled({
      mongoUri: 'mongodb://127.0.0.1:27017/whatsapp_billing_live',
      seedCustomers: 'false',
    }),
    /SEED_CUSTOMERS=true/,
  );

  assert.deepEqual(await upsertCustomers([{
    name: 'Real Customer',
    phoneNumber: '+999 123 456 789',
  }], FakeCustomerModel), { inserted: 1, unchanged: 0 });
  assert.equal(records.get('+999123456789').isTestCustomer, false);
});
