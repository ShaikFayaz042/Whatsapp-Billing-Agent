import crypto from 'crypto';
import { env } from '../config/env.js';
import { sendTextMessage } from '../services/whatsapp.service.js';
import { generateDummyBill } from '../services/billing.service.js';
import { downloadMedia } from '../services/media.service.js';
import { transcribeAudio } from '../services/transcription.service.js';

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

  try {
    processWebhookEvent(req.body);
  } catch (err) {
    console.error('[webhook] processing failed:', err.message);
  }
};

function processWebhookEvent(body) {
  if (body?.object !== 'whatsapp_business_account') {
    console.log('[webhook] ignoring non-whatsapp event');
    return;
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const metadata = value.metadata ?? {};

      for (const message of value.messages ?? []) {
        handleIncomingMessage(message, metadata);
      }

      for (const status of value.statuses ?? []) {
        handleStatusUpdate(status);
      }
    }
  }
}

async function handleIncomingMessage(message, metadata) {
  if (isDuplicate(message.id)) {
    console.log(`[in] duplicate message ${message.id} — skipped`);
    return;
  }

  const from = message.from;
  const type = message.type;

  if (type === 'text') {
    const body = message.text?.body?.trim().toLowerCase() ?? '';
    console.log(`[in] text from ${from}: ${body}`);

    if (body === 'hi') {
      try {
        const dummyBill = generateDummyBill('Lakshmi');
        await sendTextMessage(from, dummyBill);
        console.log(`[out] sent dummy bill to ${from}`);
      } catch (err) {
        console.error('[out] failed to send reply:', err.message);
      }
    }
    return;
  }

  if (type === 'audio') {
    const audio = message.audio ?? {};
    console.log(`[in] voice note from ${from} | media id: ${audio.id}`);

    try {
      const savedFilePath = await downloadMedia(audio.id);
      await sendTextMessage(from, 'Voice note mil gaya, main sun raha hoon...');

      console.log('[media] Transcribing audio...');
      const transcript = await transcribeAudio(savedFilePath);
      console.log(`[media] Transcript: "${transcript}"`);

      await sendTextMessage(from, `Aapne yeh kaha:\n\n_"${transcript}"_`);
    } catch (err) {
      console.error('[media] Failed in audio process:', err.message);
      try {
        await sendTextMessage(
          from,
          'Maaf kijiyega, aapka voice note samajh nahi aaya. Dobara bhejenge?',
        );
      } catch (replyError) {
        console.error('[media] Failed to send error reply:', replyError.message);
      }
    }
    return;
  }

  console.log(`[in] unsupported type "${type}" from ${from}`);
  // metadata.phone_number_id tells us which business number received it.
  void metadata;
}

function handleStatusUpdate(status) {
  if (isDuplicate(`status:${status.id}`)) {
    console.log(`[status] duplicate status ${status.id} — skipped`);
    return;
  }

  const suffix = status.errors ? ` (${status.errors.length} error(s))` : '';
  console.log(`[status] ${status.status} for message ${status.id}${suffix}`);
}