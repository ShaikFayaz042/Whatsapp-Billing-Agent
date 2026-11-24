import mongoose from 'mongoose';
import Customer, { normalizePhoneNumber } from '../models/customer.model.js';

function exactWhitespaceInsensitivePattern(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('Customer name or alias must be a non-empty string.');
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  const escaped = normalized
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/ /g, '\\s+');
  return new RegExp(`^${escaped}$`, 'i');
}

function lookupResult(matches) {
  if (!matches || matches.length === 0) return { status: 'NOT_FOUND' };
  if (matches.length === 1) return { status: 'FOUND', customer: matches[0] };
  return { status: 'AMBIGUOUS', customers: matches };
}

export function createCustomerService(CustomerModel = Customer) {
  async function createCustomer(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('Customer data must be an object.');
    }

    const phoneNumber = normalizePhoneNumber(data.phoneNumber);
    const customer = new CustomerModel({ ...data, phoneNumber });
    try {
      return await customer.save();
    } catch (error) {
      if (error?.code === 11000 && error.keyPattern?.phoneNumber) {
        throw new Error('A customer with this phone number already exists.', {
          cause: error,
        });
      }
      throw error;
    }
  }

  async function findCustomerByPhoneNumber(phoneNumber) {
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    const customer = await CustomerModel.findOne({
      phoneNumber: normalizedPhoneNumber,
    });
    return lookupResult(customer ? [customer] : []);
  }

  async function findCustomerByExactName(name) {
    const pattern = exactWhitespaceInsensitivePattern(name);
    return lookupResult(await CustomerModel.find({ name: pattern }));
  }

  async function findCustomerByExactAlias(alias) {
    const pattern = exactWhitespaceInsensitivePattern(alias);
    return lookupResult(await CustomerModel.find({ aliases: pattern }));
  }

  async function getCustomerById(id) {
    if (!mongoose.isValidObjectId(id)) return { status: 'NOT_FOUND' };
    const customer = await CustomerModel.findById(id);
    return lookupResult(customer ? [customer] : []);
  }

  async function listActiveCustomers() {
    return CustomerModel.find({ status: 'active' });
  }

  return {
    createCustomer,
    findCustomerByPhoneNumber,
    findCustomerByExactName,
    findCustomerByExactAlias,
    getCustomerById,
    listActiveCustomers,
  };
}

const customerService = createCustomerService();

export const createCustomer = customerService.createCustomer;
export const findCustomerByPhoneNumber = customerService.findCustomerByPhoneNumber;
export const findCustomerByExactName = customerService.findCustomerByExactName;
export const findCustomerByExactAlias = customerService.findCustomerByExactAlias;
export const getCustomerById = customerService.getCustomerById;
export const listActiveCustomers = customerService.listActiveCustomers;
