import crypto from 'crypto';

const APP_SECRET = process.env.META_APP_SECRET;
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? 'http://localhost:3000/webhook';

if (!APP_SECRET) {
  console.error('META_APP_SECRET is not set. Add it to .env.');
  process.exit(1);
}

function sign(rawBody, secret) {
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${hmac}`;
}

function buildPayload({ messageId, body = "Send Lakshmi's bill. One blouse 350, lining 80." }) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'test-waba-id',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550001111',
                phone_number_id: 'TEST_PHONE_NUMBER_ID',
              },
              messages: [
                {
                  from: '919999999999',
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

async function post(rawBody, headers) {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: rawBody,
  });
  return res.status;
}

function report(label, status, expected) {
  const pass = status === expected ? '✅ PASS' : '❌ FAIL';
  console.log(`${pass} ${label} → HTTP ${status} (expected ${expected})`);
  return status === expected;
}

const results = [];

// --- Signature cases -----------------------------------------------------
const sigBody = buildPayload({ messageId: 'wamid.SIG_CASE' });

results.push(report(
  'valid signature',
  await post(sigBody, { 'X-Hub-Signature-256': sign(sigBody, APP_SECRET) }),
  200,
));

results.push(report(
  'wrong signature',
  await post(sigBody, { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) }),
  403,
));

results.push(report(
  'missing signature',
  await post(sigBody, {}),
  403,
));

results.push(report(
  'malformed header',
  await post(sigBody, { 'X-Hub-Signature-256': 'garbage' }),
  403,
));

// --- Idempotency cases ---------------------------------------------------
// Both deliveries receive HTTP 200; the retry is skipped by the dedupe guard.
const idemBody = buildPayload({ messageId: 'wamid.IDEM_CASE' });
const idemHeaders = { 'X-Hub-Signature-256': sign(idemBody, APP_SECRET) };

results.push(report('idem first delivery', await post(idemBody, idemHeaders), 200));
results.push(report('idem duplicate delivery', await post(idemBody, idemHeaders), 200));

const freshBody = buildPayload({ messageId: 'wamid.FRESH_CASE' });
results.push(report(
  'fresh id after duplicate',
  await post(freshBody, { 'X-Hub-Signature-256': sign(freshBody, APP_SECRET) }),
  200,
));

if (results.every(Boolean)) {
  console.log('\nAll webhook tests passed.');
  console.log('Now check the server log:');
  console.log('  - "wamid.SIG_CASE" should appear once as [in] text');
  console.log('  - "wamid.IDEM_CASE" should appear once as [in] text, then once as duplicate');
  console.log('  - "wamid.FRESH_CASE" should appear once as [in] text');
} else {
  console.error('\nOne or more tests failed.');
  process.exit(1);
}