import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBill, generateBillPreview } from '../src/services/billing.service.js';

test('calculates an explicitly spoken unit rate by quantity', () => {
  const { total, formattedItems } = calculateBill([{
    name: 'Pink Blouse',
    qty: 2,
    price: 400,
    spokenAmount: null,
    priceType: 'UNIT_PRICE',
    priceSource: 'spoken',
  }]);

  assert.equal(total, 800);
  assert.equal(formattedItems[0].lineTotal, 800);
});

test('uses a spoken line total once without multiplying it by quantity', () => {
  const { total, formattedItems } = calculateBill([{
    name: 'Blouse',
    qty: 3,
    price: null,
    spokenAmount: 1200,
    priceType: 'LINE_TOTAL',
    priceSource: 'spoken',
  }]);

  assert.equal(formattedItems[0].lineTotal, 1200);
  assert.equal(total, 1200);

  const preview = generateBillPreview(null, formattedItems, total);
  assert.match(preview, /Blouse \| 3 \| Line total \| ₹1200/);
  assert.match(preview, /\*Grand Total:\* ₹1200/);
  assert.doesNotMatch(preview, /₹3600/);
});

test('shows manually entered unit rates and line totals in the bill preview', () => {
  const { total, formattedItems } = calculateBill([
    {
      name: 'Blouse',
      qty: 2,
      price: 360,
      priceType: 'UNIT_PRICE',
      priceSource: 'manual',
    },
    {
      name: 'Cut work',
      qty: 1,
      spokenAmount: 200,
      priceType: 'LINE_TOTAL',
      priceSource: 'manual',
    },
  ]);

  const preview = generateBillPreview(null, formattedItems, total);
  assert.match(preview, /Blouse \| 2 \| ₹360 \| ₹720/);
  assert.match(preview, /Cut work \| 1 \| Line total \| ₹200/);
  assert.match(preview, /\*Grand Total:\* ₹920/);
  assert.doesNotMatch(preview, /Pending/);
});

test('keeps an unclear spoken amount visible but out of calculated totals', () => {
  const { total, formattedItems } = calculateBill([{
    name: 'Custom Stitching',
    qty: 1,
    price: null,
    spokenAmount: 450,
    priceType: 'UNCLEAR',
    priceSource: 'spoken',
  }]);

  assert.equal(formattedItems[0].lineTotal, null);
  assert.equal(total, 0);
  const preview = generateBillPreview(null, formattedItems, total);
  assert.match(preview, /Custom Stitching \| 1 \| Unclear \| ₹450 \(unclear\)/);
  assert.match(preview, /Final Total:\* Pending/);
});

test('does not use missing or untyped prices in bill calculations', () => {
  const { total, formattedItems } = calculateBill([
    {
      name: 'Missing Price',
      qty: 2,
      price: null,
      spokenAmount: null,
      priceType: null,
      priceSource: 'missing',
    },
    {
      name: 'Unverified Rate',
      qty: 2,
      price: 500,
      spokenAmount: null,
      priceType: null,
      priceSource: 'missing',
    },
  ]);

  assert.equal(total, 0);
  assert.deepEqual(formattedItems.map((item) => item.lineTotal), [null, null]);
});

test('preserves a spoken unit price when quantity is missing without fabricating a line amount', () => {
  const { total, formattedItems } = calculateBill([{
    name: 'Blouse',
    qty: null,
    price: 400,
    spokenAmount: null,
    priceType: 'UNIT_PRICE',
    priceSource: 'spoken',
  }]);

  assert.equal(formattedItems[0].price, 400);
  assert.equal(formattedItems[0].lineTotal, null);
  assert.equal(total, 0);
});

test('does not present a pre-discount amount as the final total', () => {
  const { total, formattedItems } = calculateBill([{
    name: 'Blouse',
    qty: 1,
    price: 400,
    priceType: 'UNIT_PRICE',
    priceSource: 'spoken',
  }]);
  const preview = generateBillPreview(null, formattedItems, total, {
    discount: { mentioned: true, type: 'PERCENTAGE', value: 10 },
  });

  assert.match(preview, /Subtotal before discount:\* ₹400/);
  assert.match(preview, /Final Total:\* Pending discount calculation/);
  assert.match(preview, /Discount recorded:\* 10% \(not applied\)/);
  assert.doesNotMatch(preview, /Grand Total/);
});

test('marks balance calculation pending when advance was mentioned', () => {
  const { total, formattedItems } = calculateBill([{
    name: 'Blouse',
    qty: 1,
    price: 400,
    priceType: 'UNIT_PRICE',
    priceSource: 'spoken',
  }]);
  const preview = generateBillPreview(null, formattedItems, total, {
    advancePayment: { mentioned: true, amount: 200 },
  });

  assert.match(preview, /Advance recorded:\* ₹200 \(balance not calculated\)/);
});
