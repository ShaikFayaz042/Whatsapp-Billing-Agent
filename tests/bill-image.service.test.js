import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { generateBillImage } from '../src/services/bill-image.service.js';

function item(name) {
  return {
    name,
    qty: 1,
    price: 250,
    priceType: 'UNIT_PRICE',
    lineTotal: 250,
  };
}

test('generates a reference-style portrait PNG with height based on bill rows', async () => {
  const billData = {
    customer: {
      name: 'Ayesha & Sons <Tailoring>',
      phoneNumber: '+916305655121',
    },
  };
  const totals = { formattedItems: [item('Blouse')], total: 250 };
  const oneItemImage = await generateBillImage(
    billData,
    totals,
    new Date('2026-05-04T12:00:00.000Z'),
  );
  const twoItemImage = await generateBillImage(
    billData,
    { ...totals, formattedItems: [...totals.formattedItems, item('Saree Fall')] },
    new Date('2026-05-04T12:00:00.000Z'),
  );
  const oneItemMetadata = await sharp(oneItemImage).metadata();
  const twoItemMetadata = await sharp(twoItemImage).metadata();

  assert.equal(oneItemMetadata.format, 'png');
  assert.equal(oneItemMetadata.width, 1000);
  assert.ok(oneItemMetadata.height > oneItemMetadata.width);
  assert.ok(twoItemMetadata.height > oneItemMetadata.height);
  assert.ok(oneItemImage.length <= 5_000_000);
});

test('wraps long and XML-special item names without changing text size', async () => {
  const billData = { customer: { name: 'Customer <script> & "Friends"' } };
  const totals = {
    formattedItems: [item('Very long blouse design & <custom> with a name that wraps over multiple lines')],
    total: 250,
  };
  const shortImage = await generateBillImage(
    billData,
    { ...totals, formattedItems: [item('Blouse')] },
  );
  const image = await generateBillImage(billData, totals);
  const shortMetadata = await sharp(shortImage).metadata();
  const metadata = await sharp(image).metadata();

  assert.ok(metadata.height > shortMetadata.height);
  assert.ok(image.length <= 5_000_000);
});

test('rejects invalid totals instead of rendering a malformed bill', async () => {
  await assert.rejects(
    generateBillImage({ items: [] }, { formattedItems: [], total: 0 }),
    /at least one formatted item/,
  );
  await assert.rejects(
    generateBillImage({}, { formattedItems: [item('Blouse')], total: Number.NaN }),
    /finite numbers/,
  );
});
