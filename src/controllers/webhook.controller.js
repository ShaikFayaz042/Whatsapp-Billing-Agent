import crypto from 'crypto';
import { env } from '../config/env.js';
import {
  sendBillActionMessage,
  sendBillEditMenuMessage,
  sendBillPdf,
  sendCustomerSelectionMessage,
  sendTextMessage,
} from '../services/whatsapp.service.js';
import {
  calculateBill,
  calculateBillTotals,
  generateBillPreview,
} from '../services/billing.service.js';
import { generateBillPdf } from '../services/bill-pdf.service.js';
import { normalizePhoneNumber } from '../models/customer.model.js';
import {
  BILL_EDIT_SESSION_TTL_MS,
  createBillEditToken,
  hashBillEditToken,
} from '../services/bill-edit-web.service.js';
import { downloadMedia } from '../services/media.service.js';
import { transcribeAudio } from '../services/transcription.service.js';
import {
  extractBillData,
  extractBillEditPatches,
  extractClarificationAnswers,
} from '../services/parser.service.js';
import {
  formatClarificationQuestions,
  validateBillForBilling,
} from '../services/bill-validation.service.js';
import {
  applyBillEditPatches,
  applyClarificationAnswers,
  createBillDraftService,
  isBillPreviewRequest,
  isExplicitNewBillRequest,
} from '../services/bill-draft.service.js';
import {
  createCustomer,
  findCustomerByExactName,
  findCustomerByPhoneNumber,
  getCustomerById,
  listActiveCustomers,
} from '../services/customer.service.js';

const billDrafts = createBillDraftService();
const senderQueues = new Map();

/**
 * Verify the X-Hub-Signature-256 header against the raw body.
 * Returns true only when the HMAC matches using timing-safe comparison.
 */
function verifyWhatsAppSignature(rawBody, signatureHeader, appSecret) {
  if (!rawBody || !signatureHeader || !appSecret) return false;

  const parts = signatureHeader.split('=');
  if (parts.length !== 2) return false;

  const [algo, receivedSig] = parts;
  if (algo !== 'sha256') return false;

  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedSig, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

// --- Idempotency ---------------------------------------------------------
// Meta may retry deliveries, so remember recently seen IDs and skip repeats.
// Bounded TTL keeps memory flat; a Map preserves insertion order for eviction.
const SEEN_TTL_MS = 10 * 60 * 1000;
const SEEN_MAX = 1000;
const seenIds = new Map();

function isDuplicate(id) {
  if (!id) return false;
  const now = Date.now();

  while (seenIds.size > 0) {
    const [oldestId, timestamp] = seenIds.entries().next().value;
    if (now - timestamp < SEEN_TTL_MS && seenIds.size < SEEN_MAX) break;
    seenIds.delete(oldestId);
  }

  if (seenIds.has(id)) return true;
  seenIds.set(id, now);
  return false;
}
// -------------------------------------------------------------------------

// GET /webhook — Meta verification handshake
export const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.metaVerifyToken) {
    console.log('[webhook] verification handshake succeeded');
    return res.status(200).send(challenge);
  }

  console.warn('[webhook] verification handshake failed');
  return res.sendStatus(403);
};

// POST /webhook — incoming events (messages + statuses)
export const handleWebhookPost = (req, res) => {
  const signature = req.headers['x-hub-signature-256'];

  if (!verifyWhatsAppSignature(req.rawBody, signature, env.metaAppSecret)) {
    console.warn('[webhook] rejected: invalid or missing signature');
    return res.status(403).json({ error: 'invalid signature' });
  }

  // Meta expects a fast 200 ack. Respond first, then process.
  res.status(200).end();

  processWebhookEvent(req.body).catch((err) => {
    console.error('[webhook] processing failed:', err.message);
  });
};

async function processWebhookEvent(body) {
  if (body?.object !== 'whatsapp_business_account') {
    console.log('[webhook] ignoring non-whatsapp event');
    return;
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const metadata = value.metadata ?? {};

      for (const message of value.messages ?? []) {
        try {
          await queueIncomingMessage(message, metadata);
        } catch (err) {
          console.error('[in] message processing failed:', err.message);
          if (message.from) {
            try {
              await sendTextMessage(
                message.from,
                'Maaf kijiyega, processing mein error aaya. Dobara try karein.',
              );
            } catch (replyError) {
              console.error('[out] failed to send error reply:', replyError.message);
            }
          }
        }
      }

      for (const status of value.statuses ?? []) {
        handleStatusUpdate(status);
      }
    }
  }
}

async function queueIncomingMessage(message, metadata) {
  const sender = message.from;
  if (!sender) return handleIncomingMessage(message, metadata);
  const previous = senderQueues.get(sender) ?? Promise.resolve();
  const current = previous.catch(() => {})
    .then(() => handleIncomingMessage(message, metadata));
  senderQueues.set(sender, current);
  try {
    await current;
  } finally {
    if (senderQueues.get(sender) === current) senderQueues.delete(sender);
  }
}

async function handleIncomingMessage(message, metadata) {
  if (isDuplicate(message.id)) {
    console.log(`[in] duplicate message ${message.id} — skipped`);
    return;
  }

  const from = message.from;
  if (!env.ownerWaId || from !== env.ownerWaId) {
    console.warn(`[in] ignored message from non-owner sender ${from ?? '(unknown)'}`);
    return;
  }
  const type = message.type;

  if (type === 'text') {
    const body = message.text?.body?.trim() ?? '';
    console.log(`[in] text from ${from}: ${body}`);
    if (body.toLowerCase() === 'hi') {
      await sendTextMessage(from, 'Namaste! Apne bill ki details voice note mein bhejiye.');
      return;
    }
    await handleOwnerInput(from, body);
    return;
  }

  if (type === 'interactive') {
    const reply = message.interactive?.button_reply
      ?? message.interactive?.list_reply;
    await handleBillAction(from, reply?.id);
    return;
  }

  if (type === 'audio') {
    const audio = message.audio ?? {};
    console.log(`[in] voice note from ${from} | media id: ${audio.id}`);

    let rawTranscript;
    try {
      const savedFilePath = await downloadMedia(audio.id);
      console.log('[media] Translating audio to English...');
      rawTranscript = await transcribeAudio(savedFilePath);
    } catch (err) {
      console.error('[media] Failed to download or transcribe audio:', err.message);
      await sendTextMessage(from, 'Maaf kijiyega, processing mein error aaya. Dobara try karein.');
      return;
    }
    console.log(`[media] Raw English translation: "${rawTranscript}"`);
    await handleOwnerInput(from, rawTranscript);
    return;
  }

  console.log(`[in] unsupported type "${type}" from ${from}`);
  // metadata.phone_number_id tells us which business number received it.
  void metadata;
}

async function handleOwnerInput(from, text) {
  if (!text) {
    await sendTextMessage(from, 'Bill details ya clarification bhejiye.');
    return;
  }

  let draft = await billDrafts.getActiveDraft(from);
  if (isExplicitNewBillRequest(text)) {
    const billData = await extractBillData(text);
    if (draft && billData.error !== 'no_bill_found') {
      await billDrafts.supersedeDraft(from);
    }
    await startBillDraft(from, billData);
    return;
  }

  if (draft) {
    if (draft.stage === 'AWAITING_CLARIFICATION') {
      await mergeClarificationReply(draft, text);
      return;
    }
    if (draft.stage === 'EDITING_BILL') {
      await applyBillEdits(draft, text);
      return;
    }
    if (draft.stage === 'EDITING_CONTACT') {
      await applyContactChange(draft, text);
      return;
    }
    if (draft.stage === 'EDITING_CONTACT_PHONE') {
      await applyContactPhoneChange(draft, text);
      return;
    }
    if (draft.stage === 'AWAITING_ACTION' && isBillPreviewRequest(text)) {
      await sendBillResponse(
        from,
        draft.billData,
        validateBillForBilling(draft.billData),
      );
      return;
    }
    await sendTextMessage(
      from,
      'A bill draft is waiting for an action. Finish Edit Bill, Confirm & Send, Cancel Bill, or say “new bill” to start another.',
    );
    return;
  }

  const billData = await extractBillData(text);
  if (billData.error === 'no_bill_found') {
    await sendTextMessage(
      from,
      `Aapne kaha:\n_"${text}"_\n\nMujhe isme billing details nahi mili. Kripya customer aur items batayein.`,
    );
    return;
  }
  await startBillDraft(from, billData);
}

async function startBillDraft(from, billData) {
  if (billData.error === 'no_bill_found') {
    await sendTextMessage(from, 'Naye bill ke liye customer aur item details bhejiye.');
    return;
  }
  if (billData.customerName) {
    const customer = await findCustomerByExactName(billData.customerName);
    if (customer.status === 'FOUND' && customer.customer.status === 'active') {
      billData = {
        ...billData,
        customer: {
          id: String(customer.customer._id),
          name: customer.customer.name,
          phoneNumber: customer.customer.phoneNumber,
          isNew: false,
        },
      };
    }
  }
  const validation = validateBillForBilling(billData);
  const stage = validation.status === 'NEEDS_CLARIFICATION'
    ? 'AWAITING_CLARIFICATION'
    : 'AWAITING_ACTION';
  await billDrafts.createDraft(from, billData, validation, stage);
  await sendBillResponse(from, billData, validation);
}

async function mergeClarificationReply(draft, text) {
  const currentValidation = validateBillForBilling(draft.billData);
  const answers = await extractClarificationAnswers(
    text,
    draft.billData,
    currentValidation,
  );
  if (answers.length === 0) {
    await sendTextMessage(
      draft.ownerWaId,
      `I couldn't match that reply to the pending questions.\n${formatClarificationQuestions(currentValidation)}`,
    );
    return;
  }

  const billData = applyClarificationAnswers(
    draft.billData,
    answers,
    currentValidation.missingFields,
  );
  const validation = validateBillForBilling(billData);
  const stage = validation.status === 'NEEDS_CLARIFICATION'
    ? 'AWAITING_CLARIFICATION'
    : 'AWAITING_ACTION';
  await billDrafts.updateDraft(draft.ownerWaId, { billData, validation, stage });
  await sendBillResponse(draft.ownerWaId, billData, validation);
}

async function applyBillEdits(draft, text) {
  const patches = await extractBillEditPatches(text, draft.billData);
  if (patches.length === 0) {
    await sendTextMessage(
      draft.ownerWaId,
      'I could not identify an unambiguous item edit. Please name the item and the field to change.',
    );
    return;
  }
  const billData = applyBillEditPatches(draft.billData, patches);
  const validation = validateBillForBilling(billData);
  const stage = validation.status === 'NEEDS_CLARIFICATION'
    ? 'AWAITING_CLARIFICATION'
    : 'AWAITING_ACTION';
  await billDrafts.updateDraft(draft.ownerWaId, { billData, validation, stage });
  await sendBillResponse(draft.ownerWaId, billData, validation);
}

async function applyContactChange(draft, name) {
  const result = await findCustomerByExactName(name);
  if (result.status === 'AMBIGUOUS') {
    const activeMatches = result.customers.filter((customer) => customer.status === 'active');
    if (activeMatches.length === 0) {
      await sendTextMessage(draft.ownerWaId, 'No active customer matched that exact name.');
      return;
    }
    await sendCustomerSelectionMessage(draft.ownerWaId, activeMatches);
    return;
  }
  if (result.status === 'NOT_FOUND' || result.customer.status !== 'active') {
    await sendTextMessage(
      draft.ownerWaId,
      'No active customer matched that exact name. Choose a customer from the list or try the registered name again.',
    );
    return;
  }
  await setBillCustomer(draft, result.customer);
}

async function applyContactPhoneChange(draft, text) {
  let name = draft.billData.customerName?.trim();
  let rawPhone = text.trim();
  if (!name) {
    const separator = text.lastIndexOf(',');
    if (separator < 1) {
      await sendTextMessage(
        draft.ownerWaId,
        'Please send the customer name and WhatsApp number separated by a comma.',
      );
      return;
    }
    name = text.slice(0, separator).trim();
    rawPhone = text.slice(separator + 1).trim();
  }

  let phoneNumber;
  try {
    phoneNumber = normalizePhoneNumber(rawPhone);
  } catch {
    await sendTextMessage(
      draft.ownerWaId,
      'Enter a valid WhatsApp number with country code, for example +919876543210.',
    );
    return;
  }

  const match = await findCustomerByPhoneNumber(phoneNumber);
  if (match.status === 'FOUND') {
    if (match.customer.status !== 'active') {
      await sendTextMessage(draft.ownerWaId, 'That number belongs to an inactive customer.');
      return;
    }
    await setBillCustomer(draft, match.customer);
    return;
  }

  await setBillCustomer(draft, {
    id: null,
    name,
    phoneNumber,
    isNew: true,
  });
}

async function setBillCustomer(draft, customer) {
  const billData = {
    ...draft.billData,
    customerName: customer.name,
    customer: {
      id: customer.id ?? (customer._id ? String(customer._id) : null),
      name: customer.name,
      phoneNumber: customer.phoneNumber,
      isNew: customer.isNew === true,
    },
  };
  const validation = validateBillForBilling(billData);
  await billDrafts.updateDraft(draft.ownerWaId, {
    billData,
    validation,
    stage: 'AWAITING_ACTION',
    webEditTokenHash: null,
    webEditExpiresAt: null,
  });
  await sendBillResponse(draft.ownerWaId, billData, validation);
}

async function handleBillAction(from, actionId) {
  const draft = await billDrafts.getActiveDraft(from);
  if (!draft) {
    await sendTextMessage(from, 'There is no active bill draft.');
    return;
  }

  if (actionId === 'bill_cancel') {
    if (draft.stage === 'SENDING_BILL') {
      await sendTextMessage(from, 'The bill is already being sent and cannot be cancelled now.');
      return;
    }
    const cancelled = await billDrafts.cancelDraft(from);
    if (!cancelled) {
      await sendTextMessage(from, 'The bill is already being sent and cannot be cancelled now.');
      return;
    }
    await sendTextMessage(from, 'Thanks! The current bill draft has been cancelled.');
    return;
  }
  if (actionId === 'bill_confirm') {
    if (!['AWAITING_ACTION', 'EDITING_WEB'].includes(draft.stage)) {
      await sendTextMessage(from, 'This bill is not ready to send. Complete Edit Bill or its pending clarification first.');
      return;
    }
    await sendConfirmedBill(draft, draft.stage);
    return;
  }
  if (actionId === 'bill_edit') {
    if (!['AWAITING_ACTION', 'EDITING_WEB'].includes(draft.stage)) {
      await sendTextMessage(from, 'Complete the pending clarification before editing this bill.');
      return;
    }
    await billDrafts.updateDraft(from, {
      stage: 'EDITING_BILL',
      webEditTokenHash: null,
      webEditExpiresAt: null,
    });
    await sendBillEditMenuMessage(from);
    return;
  }
  if (actionId === 'bill_edit_items') {
    if (draft.stage !== 'EDITING_BILL') {
      await sendTextMessage(from, 'Choose Edit before opening the bill items form.');
      return;
    }
    let baseUrl;
    try {
      baseUrl = new URL(env.billEditBaseUrl);
    } catch {
      throw new Error('BILL_EDIT_BASE_URL must be set to the public HTTPS server URL.');
    }
    if (baseUrl.protocol !== 'https:') {
      throw new Error('BILL_EDIT_BASE_URL must use HTTPS.');
    }
    if (baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
      throw new Error('BILL_EDIT_BASE_URL must be the public server origin without a path or query.');
    }
    const token = createBillEditToken();
    const expiresAt = new Date(Date.now() + BILL_EDIT_SESSION_TTL_MS);
    await billDrafts.updateDraft(from, {
      stage: 'EDITING_WEB',
      webEditTokenHash: hashBillEditToken(token),
      webEditExpiresAt: expiresAt,
    });
    baseUrl.pathname = `/edit/${token}`;
    await sendTextMessage(
      from,
      `Edit bill items securely using this link (valid for 15 minutes):\n${baseUrl.toString()}`,
    );
    return;
  }
  if (actionId === 'bill_edit_contact' || actionId === 'bill_contact') {
    if (!['EDITING_BILL', 'AWAITING_ACTION'].includes(draft.stage)) {
      await sendTextMessage(from, 'Choose Edit before changing the bill contact.');
      return;
    }
    await billDrafts.updateDraft(from, { stage: 'EDITING_CONTACT' });
    await sendCustomerSelectionMessage(from, await listActiveCustomers());
    return;
  }
  if (typeof actionId === 'string' && actionId.startsWith('customer:')) {
    if (draft.stage !== 'EDITING_CONTACT') {
      await sendTextMessage(from, 'Choose Edit Contact before selecting a customer.');
      return;
    }
    if (actionId === 'customer:new_number') {
      await billDrafts.updateDraft(from, { stage: 'EDITING_CONTACT_PHONE' });
      const prompt = draft.billData.customerName
        ? 'Please enter the customer WhatsApp number with country code (for example +919876543210).'
        : 'Please enter the customer name and WhatsApp number separated by a comma.';
      await sendTextMessage(from, prompt);
      return;
    }
    const customerResult = await getCustomerById(actionId.slice('customer:'.length));
    if (customerResult.status !== 'FOUND' || customerResult.customer.status !== 'active') {
      await sendTextMessage(from, 'That customer is not available. Please choose an active customer.');
      return;
    }
    await setBillCustomer(draft, customerResult.customer);
    return;
  }
  await sendTextMessage(from, 'Unknown bill action. Use the buttons on the current preview.');
}

export async function sendBillResponse(to, billData, validation) {
  if (validation.status === 'NEEDS_CLARIFICATION') {
    await sendTextMessage(to, formatClarificationQuestions(validation));
    return;
  }

  const { total, formattedItems } = calculateBill(billData.items);
  const billText = generateBillPreview(
    billData.customerName,
    formattedItems,
    total,
    {
      discount: billData.discount,
      advancePayment: billData.advancePayment,
    },
  );
  await sendBillActionMessage(to, billText);
}

function customerForBill(customer) {
  return {
    id: String(customer._id),
    name: customer.name,
    phoneNumber: customer.phoneNumber,
    isNew: false,
  };
}

async function prepareBillRecipient(draft) {
  const customer = draft.billData.customer;
  if (!customer?.name || !customer?.phoneNumber) {
    throw new Error('Select a customer with a WhatsApp number in Edit Bill first.');
  }
  if (customer.isNew) {
    const existing = await findCustomerByPhoneNumber(customer.phoneNumber);
    if (existing.status === 'FOUND') {
      if (existing.customer.status !== 'active') {
        throw new Error('The bill recipient is inactive. Choose an active customer.');
      }
      return customerForBill(existing.customer);
    }
    const created = await createCustomer({
      name: customer.name,
      phoneNumber: customer.phoneNumber,
    });
    return customerForBill(created);
  }

  const current = customer.id ? await getCustomerById(customer.id) : null;
  if (!current || current.status !== 'FOUND' || current.customer.status !== 'active') {
    throw new Error('The bill recipient is unavailable. Reopen Edit Bill and select an active customer.');
  }
  return customerForBill(current.customer);
}

async function sendConfirmedBill(draft, expectedStage) {
  if (validateBillForBilling(draft.billData).status !== 'READY') {
    await sendTextMessage(
      draft.ownerWaId,
      'This bill still has missing or invalid details. Edit the bill and correct the highlighted fields before sending.',
    );
    return;
  }

  let recipient;
  try {
    recipient = await prepareBillRecipient(draft);
  } catch (error) {
    await sendTextMessage(
      draft.ownerWaId,
      `${error.message} Open Edit Bill to select or enter the customer.`,
    );
    return;
  }

  const claimed = await billDrafts.claimDraftForSending(
    draft.ownerWaId,
    expectedStage,
  );
  if (!claimed) {
    await sendTextMessage(draft.ownerWaId, 'This bill is no longer waiting to be sent.');
    return;
  }

  const billData = {
    ...claimed.billData,
    customerName: recipient.name,
    customer: recipient,
  };
  await billDrafts.updateDraft(draft.ownerWaId, { billData });
  const totals = calculateBillTotals(billData);
  const pdf = await generateBillPdf(billData, totals);
  const fileName = `bill-${Date.now()}.pdf`;
  await sendBillPdf(recipient.phoneNumber, pdf, fileName);
  await billDrafts.markDraftSent(draft.ownerWaId);
  await sendTextMessage(draft.ownerWaId, `Bill sent to ${recipient.name} on WhatsApp.`);
}

function handleStatusUpdate(status) {
  if (isDuplicate(`status:${status.id}`)) {
    console.log(`[status] duplicate status ${status.id} — skipped`);
    return;
  }

  const suffix = status.errors ? ` (${status.errors.length} error(s))` : '';
  console.log(`[status] ${status.status} for message ${status.id}${suffix}`);
}