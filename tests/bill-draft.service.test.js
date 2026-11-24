import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBillEditPatches,
  applyClarificationAnswers,
  createBillDraftService,
  isBillPreviewRequest,
  isExplicitNewBillRequest,
} from '../src/services/bill-draft.service.js';
import ActiveBill from '../src/models/active-bill.model.js';
import {
  calculateBill,
  calculateBillTotals,
  generateBillPreview,
} from '../src/services/billing.service.js';
import { generateBillPdf } from '../src/services/bill-pdf.service.js';
import { validateBillForBilling } from '../src/services/bill-validation.service.js';

function createFakeModel() {
  const records = [];

  class FakeActiveBill {
    constructor(data) {
      Object.assign(this, structuredClone(data));
    }

    async save() {
      records.push(this);
      return this;
    }

    static async findOne(filter) {
      return records.find((record) => (!filter.ownerWaId || record.ownerWaId === filter.ownerWaId)
        && (!filter.status || record.status === filter.status)
        && (!filter.webEditTokenHash
          || record.webEditTokenHash === filter.webEditTokenHash)
        && (!filter.stage || record.stage === filter.stage)
        && (!filter.webEditExpiresAt
          || record.webEditExpiresAt > filter.webEditExpiresAt.$gt)) ?? null;
    }

    static async findOneAndUpdate(filter, update) {
      const record = records.find((candidate) => (!filter.ownerWaId
        || candidate.ownerWaId === filter.ownerWaId)
        && (!filter.status || candidate.status === filter.status)
        && (!filter.stage || (typeof filter.stage === 'string'
          ? candidate.stage === filter.stage
          : candidate.stage !== filter.stage.$ne))
        && (!filter.webEditTokenHash
          || candidate.webEditTokenHash === filter.webEditTokenHash)
        && (!filter.webEditExpiresAt
          || candidate.webEditExpiresAt > filter.webEditExpiresAt.$gt));
      if (!record) return null;
      Object.assign(record, structuredClone(update.$set));
      for (const field of Object.keys(update.$unset ?? {})) delete record[field];
      return record;
    }
  }

  return FakeActiveBill;
}

const sourceBill = () => ({
  customerName: 'Rehan',
  items: [
    {
      rawItemText: 'Blouse',
      name: 'Blouse',
      qty: null,
      price: 250,
      spokenAmount: null,
      priceType: 'UNIT_PRICE',
      priceSource: 'spoken',
      ambiguity: true,
      ambiguityDetails: ['quantity'],
    },
    {
      rawItemText: 'Lining Cloth',
      name: 'Lining Cloth',
      qty: 2,
      price: null,
      spokenAmount: 350,
      priceType: 'UNCLEAR',
      priceSource: 'spoken',
      ambiguity: true,
      ambiguityDetails: ['price'],
    },
    {
      rawItemText: 'Saree Fall',
      name: 'Saree Fall',
      qty: 1,
      price: 30,
      spokenAmount: null,
      priceType: 'UNIT_PRICE',
      priceSource: 'spoken',
      ambiguity: false,
      ambiguityDetails: [],
    },
  ],
  discount: { mentioned: false, type: null, value: null },
  advancePayment: { mentioned: false, amount: null },
  notes: null,
});

test('stores, updates, supersedes, and cancels owner-specific active drafts', async () => {
  const service = createBillDraftService(createFakeModel());
  const billData = sourceBill();
  const draft = await service.createDraft(
    'owner-1',
    billData,
    { status: 'NEEDS_CLARIFICATION', missingFields: ['items[0].qty'] },
    'AWAITING_CLARIFICATION',
  );
  assert.equal((await service.getActiveDraft('owner-1'))._id, draft._id);
  assert.equal(await service.getActiveDraft('owner-2'), null);

  await service.updateDraft('owner-1', { stage: 'EDITING_BILL' });
  assert.equal((await service.getActiveDraft('owner-1')).stage, 'EDITING_BILL');
  await service.supersedeDraft('owner-1');
  assert.equal(await service.getActiveDraft('owner-1'), null);

  await service.createDraft('owner-1', billData, {}, 'AWAITING_ACTION');
  await service.cancelDraft('owner-1');
  assert.equal(await service.getActiveDraft('owner-1'), null);
});

test('active bill schema enforces one active draft per owner', () => {
  assert.ok(ActiveBill.schema.indexes().some(
    ([fields, options]) => fields.ownerWaId === 1
      && fields.status === 1
      && options.unique === true
      && options.partialFilterExpression.status === 'active',
  ));
});

test('claims a ready draft for one send and marks it sent atomically', async () => {
  const service = createBillDraftService(createFakeModel());
  await service.createDraft('owner-1', sourceBill(), {}, 'AWAITING_ACTION');

  const claimed = await service.claimDraftForSending('owner-1', 'AWAITING_ACTION');
  assert.equal(claimed.stage, 'SENDING_BILL');
  assert.equal(await service.claimDraftForSending('owner-1', 'AWAITING_ACTION'), null);
  const sent = await service.markDraftSent('owner-1');
  assert.equal(sent.status, 'sent');
  assert.equal(sent.stage, 'SENT');
  assert.equal(await service.getActiveDraft('owner-1'), null);
});

test('expires web edit sessions and allows a valid session to be submitted only once', async () => {
  const service = createBillDraftService(createFakeModel());
  const draft = await service.createDraft('owner-1', sourceBill(), {}, 'AWAITING_ACTION');
  const expiry = new Date(Date.now() + 60_000);
  const tokenHash = 'hashed-edit-token';
  await service.updateDraft('owner-1', {
    stage: 'EDITING_WEB',
    webEditTokenHash: tokenHash,
    webEditExpiresAt: expiry,
  });

  assert.equal((await service.getActiveDraftByWebEditTokenHash(tokenHash))._id, draft._id);
  const saved = await service.completeWebEdit(tokenHash, sourceBill(), { status: 'READY' });
  assert.equal(saved.stage, 'AWAITING_ACTION');
  assert.equal(saved.webEditTokenHash, undefined);
  assert.equal(await service.getActiveDraftByWebEditTokenHash(tokenHash), null);
  assert.equal(await service.completeWebEdit(tokenHash, sourceBill(), { status: 'READY' }), null);
});

test('merges clarification answers without replacing prior customer or item data', () => {
  const original = sourceBill();
  const updated = applyClarificationAnswers(original, [
    { path: 'items[0].qty', value: 1 },
    { path: 'items[1].price', amount: 350, priceType: 'LINE_TOTAL' },
    { path: 'items[2].price', amount: 999, priceType: 'UNIT_PRICE' },
  ], ['items[0].qty', 'items[1].price']);

  assert.equal(updated.customerName, 'Rehan');
  assert.equal(updated.items.length, 3);
  assert.equal(updated.items[0].qty, 1);
  assert.equal(updated.items[0].price, 250);
  assert.equal(updated.items[1].qty, 2);
  assert.equal(updated.items[1].priceType, 'LINE_TOTAL');
  assert.equal(updated.items[1].spokenAmount, 350);
  assert.equal(updated.items[2].price, 30);
  assert.equal(original.items[0].qty, null);
});

test('completes the Rehan follow-up example as a ₹630 preview', () => {
  const billData = applyClarificationAnswers(sourceBill(), [
    { path: 'items[0].qty', value: 1 },
    { path: 'items[1].price', amount: 350, priceType: 'LINE_TOTAL' },
  ], ['items[0].qty', 'items[1].price']);

  assert.equal(validateBillForBilling(billData).status, 'READY');
  const { total, formattedItems } = calculateBill(billData.items);
  assert.equal(total, 630);
  const preview = generateBillPreview(billData.customerName, formattedItems, total);
  assert.match(preview, /Customer:\* Rehan/);
  assert.match(preview, /Blouse \| 1 \| ₹250 \| ₹250/);
  assert.match(preview, /Lining Cloth \| 2 \| Line total \| ₹350/);
  assert.match(preview, /Saree Fall \| 1 \| ₹30 \| ₹30/);
  assert.match(preview, /Grand Total:\* ₹630/);
});

test('edits the display name but retains raw speech and unrelated financial fields', () => {
  const original = sourceBill();
  const updated = applyBillEditPatches(original, [
    { itemIndex: 0, name: 'Bridal Blouse', qty: 1, amount: 275, priceType: 'UNIT_PRICE' },
  ]);

  assert.equal(updated.items[0].name, 'Bridal Blouse');
  assert.equal(updated.items[0].rawItemText, 'Blouse');
  assert.equal(updated.items[0].price, 275);
  assert.equal(updated.items[1].spokenAmount, 350);
  assert.equal(updated.customerName, 'Rehan');
});

test('validates manually edited prices and calculates discount, advance, and balance', () => {
  const billData = {
    customerName: 'Rehan',
    customer: { name: 'Rehan', phoneNumber: '+919876543210' },
    items: [{
      name: 'Blouse',
      qty: 2,
      price: 250,
      spokenAmount: null,
      priceType: 'UNIT_PRICE',
      priceSource: 'manual',
      ambiguity: false,
      ambiguityDetails: [],
    }],
    discount: { mentioned: true, type: 'PERCENTAGE', value: 10 },
    advancePayment: { mentioned: true, amount: 100 },
    notes: null,
  };
  assert.equal(validateBillForBilling(billData).status, 'READY');
  assert.deepEqual(
    (({ subtotal, discount, total, advance, balanceDue }) => ({
      subtotal, discount, total, advance, balanceDue,
    }))(calculateBillTotals(billData)),
    { subtotal: 500, discount: 50, total: 450, advance: 100, balanceDue: 350 },
  );
});

test('generates a PDF for a validated bill', async () => {
  const billData = {
    customer: { name: 'Rehan', phoneNumber: '+919876543210' },
    items: [{
      name: 'Blouse',
      qty: 1,
      price: 250,
      priceType: 'UNIT_PRICE',
      priceSource: 'manual',
    }],
  };
  const pdf = await generateBillPdf(billData, calculateBillTotals(billData));
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('recognizes explicit new bill requests, not ordinary clarification replies', () => {
  assert.equal(isExplicitNewBillRequest('Send this bill to Rehan'), true);
  assert.equal(isExplicitNewBillRequest('Please start a new bill'), true);
  assert.equal(isExplicitNewBillRequest('Quantity one and price is 250 rupees'), false);
});

test('recognizes requests to resend a missing bill preview', () => {
  assert.equal(isBillPreviewRequest("I can't see the bill"), true);
  assert.equal(isBillPreviewRequest('Please show me the bill preview'), true);
  assert.equal(isBillPreviewRequest('Please change the quantity'), false);
  assert.equal(isBillPreviewRequest('Start a new bill'), false);
});
