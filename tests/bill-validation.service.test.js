import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClarificationQuestions,
  validateBillForBilling,
} from '../src/services/bill-validation.service.js';

const item = (overrides = {}) => ({
  rawItemText: 'Blouse',
  name: 'Blouse',
  variant: null,
  qty: 1,
  price: 400,
  spokenAmount: null,
  priceType: 'UNIT_PRICE',
  priceSource: 'spoken',
  ambiguity: false,
  ambiguityDetails: [],
  ...overrides,
});

const bill = (overrides = {}) => ({
  customerName: null,
  items: [item()],
  discount: { mentioned: false, type: null, value: null },
  advancePayment: { mentioned: false, amount: null },
  notes: null,
  ...overrides,
});

test('marks a complete bill READY and keeps an optional customer name', () => {
  const result = validateBillForBilling(bill({ customerName: 'Lakshmi' }));
  assert.deepEqual(result, {
    status: 'READY',
    issues: [],
    missingFields: [],
    questions: [],
  });
});

test('requires a non-empty item name', () => {
  const result = validateBillForBilling(bill({
    items: [item({ name: '  ' })],
  }));
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.ok(result.missingFields.includes('items[0].name'));
  assert.equal(result.issues[0].field, 'name');
});

test('requires quantity and rejects non-positive quantities', () => {
  const missing = validateBillForBilling(bill({
    items: [item({ qty: null })],
  }));
  assert.ok(missing.missingFields.includes('items[0].qty'));

  const invalid = validateBillForBilling(bill({
    items: [item({ qty: 0 })],
  }));
  assert.match(invalid.issues[0].reason, /positive number/);
});

test('requires an explicitly available unit price', () => {
  const result = validateBillForBilling(bill({
    items: [item({ price: null, priceSource: 'missing' })],
  }));
  assert.equal(result.issues[0].field, 'price');
  assert.equal(result.issues[0].reason, 'Price was not mentioned');
  assert.ok(result.missingFields.includes('items[0].price'));
});

test('requires a spoken amount for line totals', () => {
  const result = validateBillForBilling(bill({
    items: [item({
      price: null,
      spokenAmount: null,
      priceType: 'LINE_TOTAL',
      priceSource: 'missing',
    })],
  }));
  assert.equal(result.issues[0].reason, 'Price was not mentioned');
});

test('requires clarification when a spoken amount has an unclear price type', () => {
  const result = validateBillForBilling(bill({
    items: [item({
      price: null,
      spokenAmount: 400,
      priceType: 'UNCLEAR',
    })],
  }));
  assert.equal(result.issues[0].reason, 'Price was mentioned but its meaning is unclear');
  assert.match(result.questions[0], /unit price or the total/);
});

test('returns all missing item fields without inventing values', () => {
  const source = bill({
    items: [item({
      name: '',
      qty: null,
      price: null,
      spokenAmount: null,
      priceType: null,
      priceSource: 'missing',
    })],
  });
  const original = structuredClone(source);
  const result = validateBillForBilling(source);

  assert.deepEqual(result.missingFields, [
    'items[0].name',
    'items[0].qty',
    'items[0].price',
  ]);
  assert.deepEqual(source, original);
  assert.equal(source.items[0].price, null);
});

test('accepts valid fixed and percentage discounts without calculating totals', () => {
  for (const discount of [
    { mentioned: true, type: 'FIXED_RUPEES', value: 100 },
    { mentioned: true, type: 'PERCENTAGE', value: 10 },
  ]) {
    assert.equal(validateBillForBilling(bill({ discount })).status, 'READY');
  }
});

test('requires clarification for a mentioned discount with unclear value', () => {
  const result = validateBillForBilling(bill({
    discount: { mentioned: true, type: 'FIXED_RUPEES', value: null },
  }));
  assert.ok(result.missingFields.includes('discount.value'));
  assert.match(result.questions[0], /discount amount/);
});

test('rejects invalid discounts and advance payments', () => {
  const discount = validateBillForBilling(bill({
    discount: { mentioned: true, type: 'PERCENTAGE', value: 101 },
  }));
  assert.match(discount.issues[0].reason, /between 0 and 100/);

  const advance = validateBillForBilling(bill({
    advancePayment: { mentioned: true, amount: null },
  }));
  assert.ok(advance.missingFields.includes('advancePayment.amount'));

  const negativeDiscount = validateBillForBilling(bill({
    discount: { mentioned: true, type: 'FIXED_RUPEES', value: -1 },
  }));
  assert.match(negativeDiscount.issues[0].reason, /must not be negative/);

  const negativeAdvance = validateBillForBilling(bill({
    advancePayment: { mentioned: true, amount: -1 },
  }));
  assert.match(negativeAdvance.issues[0].reason, /must not be negative/);
});

test('treats an unmentioned advance and discount as valid zero adjustments', () => {
  assert.equal(validateBillForBilling(bill()).status, 'READY');
});

test('accepts unknown free-form item names without catalogue matching', () => {
  const result = validateBillForBilling(bill({
    items: [item({ name: 'Hand Finished Custom Neck Design with Kuchulu' })],
  }));
  assert.equal(result.status, 'READY');
});

test('preserves spoken price while asking about another ambiguous field', () => {
  const source = bill({
    items: [item({
      name: 'Special Blouse',
      qty: null,
      price: 450,
      ambiguity: true,
      ambiguityDetails: ['item_name'],
    })],
  });
  const result = validateBillForBilling(source);

  assert.equal(result.status, 'NEEDS_CLARIFICATION');
  assert.equal(source.items[0].price, 450);
  assert.equal(source.items[0].priceType, 'UNIT_PRICE');
  assert.ok(result.missingFields.includes('items[0].name'));
  assert.ok(result.missingFields.includes('items[0].qty'));
});

test('asks only targeted questions and formats them for WhatsApp', () => {
  const result = validateBillForBilling(bill({
    items: [item({ qty: null, price: null, priceSource: 'missing' })],
  }));
  const message = formatClarificationQuestions(result);
  assert.match(message, /^Please clarify:/);
  assert.match(message, /quantity of Blouse/);
  assert.match(message, /price of Blouse/);
  assert.doesNotMatch(message, /customer name/);
});
