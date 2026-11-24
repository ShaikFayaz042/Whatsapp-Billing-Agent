import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWebBillItemEdits,
  createBillEditToken,
  hashBillEditToken,
} from '../src/services/bill-edit-web.service.js';
import { calculateBillTotals } from '../src/services/billing.service.js';

const bill = {
  customerName: 'Ayesha',
  customer: { name: 'Ayesha', phoneNumber: '+919876543210' },
  items: [{
    name: 'Blouse',
    qty: 2,
    price: 250,
    priceType: 'UNIT_PRICE',
    priceSource: 'spoken',
    ambiguity: false,
    ambiguityDetails: [],
    variant: 'Custom fit',
  }],
  discount: { mentioned: false, type: null, value: null },
  advancePayment: { mentioned: false, amount: null },
};

test('applies item additions, removals, and rate changes without mutating the source draft', () => {
  const result = applyWebBillItemEdits(bill, [
    { sourceIndex: 0, name: 'Blouse', quantity: '2', amount: '450' },
    { name: 'Saree fall', quantity: '1', amount: '120' },
    { name: '', quantity: '', amount: '', remove: true },
  ]);

  assert.equal(result.validation.status, 'READY');
  assert.equal(result.billData.items.length, 2);
  assert.equal(result.billData.items[0].priceSource, 'manual');
  assert.equal(result.billData.items[0].variant, 'Custom fit');
  assert.equal(calculateBillTotals(result.billData).total, 1020);
  assert.equal(bill.items[0].name, 'Blouse');
});

test('rejects invalid quantities, rates, empty bills, and more than 50 rows', () => {
  assert.throws(
    () => applyWebBillItemEdits(bill, [{ name: 'Blouse', quantity: '0', amount: '100' }]),
    /quantity must be a number/i,
  );
  assert.throws(
    () => applyWebBillItemEdits(bill, [{ name: 'Blouse', quantity: ['1'], amount: '100' }]),
    /quantity must be a number/i,
  );
  assert.throws(
    () => applyWebBillItemEdits(bill, [{ name: 'Blouse', quantity: '1', amount: '-1' }]),
    /rate must be a number/i,
  );
  assert.throws(() => applyWebBillItemEdits(bill, []), /at least one/i);
  assert.throws(() => applyWebBillItemEdits(bill, Array(51).fill({})), /between 1 and 50/i);
});

test('creates unguessable edit tokens and stores only their one-way hash', () => {
  const first = createBillEditToken();
  const second = createBillEditToken();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.match(hashBillEditToken(first), /^[a-f0-9]{64}$/);
  assert.notEqual(hashBillEditToken(first), first);
});
