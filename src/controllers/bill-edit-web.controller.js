import path from 'path';
import { fileURLToPath } from 'url';
import { calculateBillTotals } from '../services/billing.service.js';
import {
  createBillDraftService,
} from '../services/bill-draft.service.js';
import {
  applyWebBillItemEdits,
  hashBillEditToken,
} from '../services/bill-edit-web.service.js';
import { sendBillResponse } from './webhook.controller.js';

const billDrafts = createBillDraftService();
const publicDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public',
);
const tokenPattern = /^[a-f0-9]{64}$/;

function secureResponseHeaders(res) {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
}

function validToken(req, res) {
  if (!tokenPattern.test(req.params.token ?? '')) {
    res.status(404).send('This bill edit link is invalid or has expired.');
    return null;
  }
  return hashBillEditToken(req.params.token);
}

function handleRouteError(error, req, res, _next) {
  console.error(`[bill-edit] request failed: ${error.message}`);
  if (res.headersSent) return;
  return res.status(500).json({ error: 'The bill could not be processed. Please try again.' });
}

async function findDraft(req, res) {
  const tokenHash = validToken(req, res);
  if (!tokenHash) return null;
  const draft = await billDrafts.getActiveDraftByWebEditTokenHash(tokenHash);
  if (!draft) {
    res.status(410).send('This bill edit link has expired. Reopen Edit from WhatsApp to get a new link.');
    return null;
  }
  return { draft, tokenHash };
}

export async function showBillEditForm(req, res) {
  secureResponseHeaders(res);
  const session = await findDraft(req, res);
  if (!session) return;
  return res.sendFile(path.join(publicDirectory, 'edit-bill.html'));
}

export async function getBillEditData(req, res) {
  secureResponseHeaders(res);
  const session = await findDraft(req, res);
  if (!session) return;

  const { draft } = session;
  const totals = calculateBillTotals(draft.billData);
  return res.json({
    customerName: draft.billData.customerName ?? '',
    items: draft.billData.items.map((item, sourceIndex) => ({
      sourceIndex,
      name: item.name ?? '',
      quantity: item.qty ?? '',
      amount: item.priceType === 'LINE_TOTAL'
        ? item.spokenAmount ?? ''
        : item.price ?? item.spokenAmount ?? '',
      priceType: item.priceType === 'LINE_TOTAL' ? 'LINE_TOTAL' : 'UNIT_PRICE',
    })),
    discount: totals.discount,
    discountType: draft.billData.discount?.type ?? 'FIXED_RUPEES',
    discountMentioned: draft.billData.discount?.mentioned === true,
    total: totals.total,
  });
}

export async function submitBillEditForm(req, res) {
  secureResponseHeaders(res);
  const session = await findDraft(req, res);
  if (!session) return;

  let edited;
  try {
    edited = applyWebBillItemEdits(session.draft.billData, req.body?.items);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const updated = await billDrafts.completeWebEdit(
    session.tokenHash,
    edited.billData,
    edited.validation,
  );
  if (!updated) {
    return res.status(410).json({
      error: 'This bill edit link has expired or was already used. Reopen Edit from WhatsApp.',
    });
  }

  let notificationError = null;
  try {
    await sendBillResponse(updated.ownerWaId, updated.billData, updated.validation);
  } catch (error) {
    notificationError = 'Changes were saved, but WhatsApp could not be notified. Please check the server logs.';
    console.error(`[bill-edit] saved form changes but failed to notify owner: ${error.message}`);
  }
  const totals = calculateBillTotals(updated.billData);
  return res.json({ saved: true, total: totals.total, notificationError });
}

export { handleRouteError as handleBillEditRouteError };
