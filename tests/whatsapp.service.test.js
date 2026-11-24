import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
process.env.PHONE_NUMBER_ID = 'test-phone-id';
const {
  sendBillActionMessage,
  sendBillEditMenuMessage,
  sendBillImage,
  sendBillPdf,
  sendCustomerSelectionMessage,
} = await import('../src/services/whatsapp.service.js');

async function captureMessage(send) {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ messages: [{ id: 'mock-message' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await send();
    return request;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('sends edit, confirm, and cancel as WhatsApp interactive reply buttons', async () => {
  const request = await captureMessage(
    () => sendBillActionMessage('owner-wa-id', 'Bill preview text'),
  );
  assert.equal(request.body.to, 'owner-wa-id');
  assert.equal(request.body.type, 'interactive');
  assert.deepEqual(
    request.body.interactive.action.buttons.map((button) => button.reply.id),
    ['bill_edit', 'bill_confirm', 'bill_cancel'],
  );
});

test('offers contact and item editing as WhatsApp reply buttons', async () => {
  const request = await captureMessage(
    () => sendBillEditMenuMessage('owner-wa-id'),
  );
  assert.equal(request.body.type, 'interactive');
  assert.equal(request.body.interactive.type, 'button');
  assert.deepEqual(
    request.body.interactive.action.buttons.map((button) => button.reply.id),
    ['bill_edit_contact', 'bill_edit_items'],
  );
});

test('preserves Meta error details and trace ID for failed sends', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      message: '(#139000) Blocked by Integrity',
      error_data: {
        details: 'The message could not be sent.',
      },
      fbtrace_id: 'trace-123',
    },
  }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    await assert.rejects(
      sendBillEditMenuMessage('owner-wa-id'),
      /Blocked by Integrity \| The message could not be sent\. \| fbtrace_id=trace-123/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sends customer choices as a bounded WhatsApp interactive list', async () => {
  const customers = Array.from({ length: 12 }, (_, index) => ({
    _id: `customer-${index}`,
    name: `Customer ${index}`,
    phoneNumber: `+9199999999${String(index).padStart(2, '0')}`,
  }));
  const request = await captureMessage(
    () => sendCustomerSelectionMessage('owner-wa-id', customers),
  );

  assert.equal(request.body.type, 'interactive');
  assert.equal(request.body.interactive.type, 'list');
  assert.equal(request.body.interactive.action.sections[0].rows.length, 10);
  assert.equal(
    request.body.interactive.action.sections[0].rows.at(-1).id,
    'customer:new_number',
  );
  assert.match(request.body.interactive.body.text, /exact registered name/);
});

test('uploads a bill PDF and sends it to the selected WhatsApp number', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const body = calls.length === 1
      ? { id: 'media-id' }
      : { messages: [{ id: 'bill-message' }] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await sendBillPdf('+919876543210', Buffer.from('%PDF-1.4'), 'bill.pdf');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(calls[0].url, /\/media$/);
  assert.equal(calls[1].url.endsWith('/messages'), true);
  assert.equal(calls[1].options.body.includes('"to":"+919876543210"'), true);
  assert.equal(calls[1].options.body.includes('"type":"document"'), true);
});

test('uploads a bill PNG with existing WhatsApp auth and sends its media ID as an image', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const body = calls.length === 1
      ? { id: 'image-media-id' }
      : { messages: [{ id: 'bill-image-message' }] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await sendBillImage('+919876543210', Buffer.from('png-data'));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(calls[0].url, /\/media$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  const uploadedFile = calls[0].options.body.get('file');
  assert.equal(uploadedFile.type, 'image/png');
  assert.equal(calls[1].url.endsWith('/messages'), true);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '+919876543210',
    type: 'image',
    image: { id: 'image-media-id' },
  });
});

test('does not upload bill images larger than WhatsApp supports', async () => {
  const originalFetch = globalThis.fetch;
  let uploaded = false;
  globalThis.fetch = async () => {
    uploaded = true;
    throw new Error('Unexpected upload');
  };
  try {
    await assert.rejects(
      sendBillImage('+919876543210', Buffer.alloc(5_000_001)),
      /5 MB image limit/,
    );
    assert.equal(uploaded, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
