import crypto from 'crypto';
import { calculateBillTotals } from './billing.service.js';
import { validateBillForBilling } from './bill-validation.service.js';

export const BILL_EDIT_SESSION_TTL_MS = 15 * 60 * 1000;

export function createBillEditToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashBillEditToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseNumber(value, label, { minimum }) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${label} must be a number.`);
  }
  if (String(value).trim() === '') {
    throw new Error(`${label} is required.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${label} must be a number greater than or equal to ${minimum}.`);
  }
  return parsed;
}

export function applyWebBillItemEdits(billData, submittedItems) {
  if (!Array.isArray(submittedItems) || submittedItems.length > 50) {
    throw new Error('The bill must contain between 1 and 50 items.');
  }

  const items = [];
  const sourceIndexes = new Set();
  for (const [index, submitted] of submittedItems.entries()) {
    if (submitted?.remove === true) continue;

    const name = typeof submitted?.name === 'string' ? submitted.name.trim() : '';
    const quantity = submitted?.quantity;
    const amount = submitted?.amount;
    const hasSourceIndex = submitted?.sourceIndex !== null
      && submitted?.sourceIndex !== undefined
      && submitted?.sourceIndex !== '';
    if (!hasSourceIndex && !name && !quantity && !amount) continue;
    if (!name) throw new Error(`Item ${index + 1}: enter an item name or remove the item.`);
    if (name.length > 120) throw new Error(`Item ${index + 1}: item name is too long.`);

    let originalItem = null;
    if (hasSourceIndex) {
      const sourceIndex = Number(submitted.sourceIndex);
      if (!Number.isInteger(sourceIndex)
        || sourceIndex < 0
        || sourceIndex >= billData.items.length
        || sourceIndexes.has(sourceIndex)) {
        throw new Error(`Item ${index + 1}: the original item could not be verified.`);
      }
      sourceIndexes.add(sourceIndex);
      originalItem = billData.items[sourceIndex];
    }

    const qty = parseNumber(quantity, `Item ${index + 1} quantity`, { minimum: Number.MIN_VALUE });
    const price = parseNumber(amount, `Item ${index + 1} rate`, { minimum: 0 });
    const priceType = submitted.priceType ?? 'UNIT_PRICE';
    if (!['UNIT_PRICE', 'LINE_TOTAL'].includes(priceType)) {
      throw new Error(`Item ${index + 1}: choose a valid rate type.`);
    }
    items.push({
      ...(originalItem ?? {}),
      rawItemText: originalItem?.name === name ? originalItem.rawItemText ?? name : name,
      name,
      variant: originalItem?.name === name ? originalItem.variant ?? null : null,
      qty,
      price: priceType === 'UNIT_PRICE' ? price : null,
      spokenAmount: priceType === 'LINE_TOTAL' ? price : null,
      priceType,
      priceSource: 'manual',
      ambiguity: false,
      ambiguityDetails: [],
    });
  }

  if (items.length === 0) throw new Error('Keep at least one bill item.');

  const updated = { ...billData, items };
  const validation = validateBillForBilling(updated);
  if (validation.status !== 'READY') {
    throw new Error(validation.questions.join(' '));
  }
  const totals = calculateBillTotals(updated);
  if (![totals.subtotal, totals.discount, totals.total, ...totals.formattedItems.map((item) => item.lineTotal)]
    .every(Number.isFinite)) {
    throw new Error('The bill total is too large to calculate. Reduce the quantity or rate.');
  }
  return { billData: updated, validation };
}
