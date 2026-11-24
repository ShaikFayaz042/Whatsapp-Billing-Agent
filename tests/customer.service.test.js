import test from 'node:test';
import assert from 'node:assert/strict';
import Customer from '../src/models/customer.model.js';
import { createCustomerService } from '../src/services/customer.service.js';

const TEST_PHONE = '+999123456789';

function createFakeModel() {
  const records = [];
  let nextId = 1;

  class FakeCustomer {
    constructor(data) {
      Object.assign(this, data);
      this.status = data.status ?? 'active';
      this._id = String(nextId++).padStart(24, '0');
    }

    async save() {
      if (records.some((record) => record.phoneNumber === this.phoneNumber)) {
        const error = new Error('duplicate key');
        error.code = 11000;
        error.keyPattern = { phoneNumber: 1 };
        throw error;
      }
      records.push(this);
      return this;
    }

    static async findOne(filter) {
      return records.find((record) => record.phoneNumber === filter.phoneNumber) ?? null;
    }

    static async find(filter) {
      if (filter.status) {
        return records.filter((record) => record.status === filter.status);
      }
      if (filter.name instanceof RegExp) {
        return records.filter((record) => filter.name.test(record.name));
      }
      if (filter.aliases instanceof RegExp) {
        return records.filter((record) => record.aliases.some((alias) => filter.aliases.test(alias)));
      }
      return [];
    }

    static async findById(id) {
      return records.find((record) => record._id === String(id)) ?? null;
    }

    static seed(record) {
      records.push(record);
    }
  }

  return FakeCustomer;
}

test('creates a customer using a normalized international phone number', async () => {
  const service = createCustomerService(createFakeModel());
  const customer = await service.createCustomer({
    name: 'Test Customer',
    phoneNumber: '+999 123 456 789',
  });

  assert.equal(customer.phoneNumber, TEST_PHONE);
});

test('rejects duplicate normalized phone numbers', async () => {
  const service = createCustomerService(createFakeModel());
  await service.createCustomer({ name: 'First', phoneNumber: TEST_PHONE });
  await assert.rejects(
    () => service.createCustomer({ name: 'Second', phoneNumber: '+999-123-456-789' }),
    /already exists/,
  );
});

test('finds a customer by exact name', async () => {
  const model = createFakeModel();
  const service = createCustomerService(model);
  await service.createCustomer({ name: 'Test Customer', phoneNumber: TEST_PHONE });

  const result = await service.findCustomerByExactName('Test Customer');
  assert.equal(result.status, 'FOUND');
  assert.equal(result.customer.name, 'Test Customer');
});

test('finds a customer by exact alias', async () => {
  const service = createCustomerService(createFakeModel());
  await service.createCustomer({
    name: 'Test Customer',
    phoneNumber: TEST_PHONE,
    aliases: ['Customer One'],
  });

  assert.equal((await service.findCustomerByExactAlias('Customer One')).status, 'FOUND');
});

test('matches names case-insensitively and ignores repeated whitespace', async () => {
  const service = createCustomerService(createFakeModel());
  await service.createCustomer({ name: 'Test   Customer', phoneNumber: TEST_PHONE });

  assert.equal((await service.findCustomerByExactName(' test customer ')).status, 'FOUND');
});

test('finds a customer by normalized phone number', async () => {
  const service = createCustomerService(createFakeModel());
  await service.createCustomer({ name: 'Test Customer', phoneNumber: TEST_PHONE });

  const result = await service.findCustomerByPhoneNumber('+999 123-456-789');
  assert.equal(result.status, 'FOUND');
  assert.equal(result.customer.phoneNumber, TEST_PHONE);
});

test('gets a customer by valid MongoDB ID', async () => {
  const service = createCustomerService(createFakeModel());
  const created = await service.createCustomer({
    name: 'Test Customer',
    phoneNumber: TEST_PHONE,
  });

  const result = await service.getCustomerById(created._id);
  assert.equal(result.status, 'FOUND');
  assert.equal(result.customer._id, created._id);
});

test('returns NOT_FOUND when no customer matches', async () => {
  const service = createCustomerService(createFakeModel());

  assert.deepEqual(await service.findCustomerByExactName('Missing Customer'), {
    status: 'NOT_FOUND',
  });
});

test('returns AMBIGUOUS when multiple customers have the same exact name', async () => {
  const model = createFakeModel();
  const service = createCustomerService(model);
  await service.createCustomer({ name: 'Same Name', phoneNumber: TEST_PHONE });
  await service.createCustomer({ name: 'Same Name', phoneNumber: '+999123456780' });

  const result = await service.findCustomerByExactName('Same Name');
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.customers.length, 2);
});

test('lists active customers and excludes inactive customers', async () => {
  const model = createFakeModel();
  const service = createCustomerService(model);
  await service.createCustomer({ name: 'Active Test', phoneNumber: TEST_PHONE });
  await service.createCustomer({
    name: 'Inactive Test',
    phoneNumber: '+999123456780',
    status: 'inactive',
  });

  const customers = await service.listActiveCustomers();
  assert.deepEqual(customers.map((customer) => customer.name), ['Active Test']);
});

test('customer schema applies defaults, trims names, and uniquely indexes phone', async () => {
  const customer = new Customer({
    name: '  Test Customer  ',
    phoneNumber: '+999 123 456 789',
  });
  await customer.validate();

  assert.equal(customer.name, 'Test Customer');
  assert.equal(customer.phoneNumber, TEST_PHONE);
  assert.deepEqual(customer.aliases, []);
  assert.equal(customer.whatsappOptIn, false);
  assert.equal(customer.isTestCustomer, false);
  assert.equal(customer.status, 'active');
  assert.ok(Customer.schema.indexes().some(
    ([fields, options]) => fields.phoneNumber === 1 && options.unique === true,
  ));
});

test('schema rejects phone numbers without an explicit country code', async () => {
  const customer = new Customer({ name: 'Test Customer', phoneNumber: '123456789' });
  await assert.rejects(() => customer.validate());
});
