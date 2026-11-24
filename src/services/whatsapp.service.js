import { env } from '../config/env.js';

async function sendMessage(to, message) {
  if (!env.whatsappAccessToken || !env.phoneNumberId) {
    throw new Error('WhatsApp access token and phone number ID are required.');
  }

  const response = await fetch(
    `https://graph.facebook.com/${env.graphApiVersion}/${env.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.whatsappAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        ...message,
      }),
    },
  );

  const result = await response.json();
  if (!response.ok) {
    const apiError = result.error;
    const errorParts = [
      apiError?.message ?? `WhatsApp API returned ${response.status}.`,
      apiError?.error_data?.details,
      apiError?.fbtrace_id ? `fbtrace_id=${apiError.fbtrace_id}` : null,
    ].filter(Boolean);
    throw new Error(errorParts.join(' | '));
  }

  return result;
}

export async function sendTextMessage(to, text) {
  return sendMessage(to, {
    type: 'text',
    text: { preview_url: false, body: text },
  });
}

export async function sendBillActionMessage(to, text) {
  return sendMessage(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'bill_edit', title: 'Edit' } },
          { type: 'reply', reply: { id: 'bill_confirm', title: 'Confirm & Send' } },
          { type: 'reply', reply: { id: 'bill_cancel', title: 'Cancel Bill' } },
        ],
      },
    },
  });
}

export async function sendBillEditMenuMessage(to) {
  return sendMessage(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: 'What would you like to edit?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'bill_edit_contact', title: 'Edit Contact' } },
          { type: 'reply', reply: { id: 'bill_edit_items', title: 'Edit Items' } },
        ],
      },
    },
  });
}

export async function sendBillPdf(to, pdfBuffer, fileName) {
  if (!env.whatsappAccessToken || !env.phoneNumberId) {
    throw new Error('WhatsApp access token and phone number ID are required.');
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), fileName);
  const uploadResponse = await fetch(
    `https://graph.facebook.com/${env.graphApiVersion}/${env.phoneNumberId}/media`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.whatsappAccessToken}` },
      body: form,
    },
  );
  const uploadResult = await uploadResponse.json();
  if (!uploadResponse.ok || typeof uploadResult.id !== 'string') {
    throw new Error(uploadResult.error?.message ?? 'WhatsApp could not upload the bill PDF.');
  }

  return sendMessage(to, {
    type: 'document',
    document: {
      id: uploadResult.id,
      filename: fileName,
      caption: "Your bill from SHE'S BOUTIQUE TAILORS.",
    },
  });
}

export async function sendCustomerSelectionMessage(to, customers) {
  const rows = customers.slice(0, 9).map((customer) => ({
    id: `customer:${customer._id}`,
    title: customer.name.slice(0, 24),
    description: customer.phoneNumber.slice(0, 72),
  }));
  rows.push({
    id: 'customer:new_number',
    title: 'Use a different number',
  });
  if (rows.length === 0) {
    return sendTextMessage(to, 'No active customers are available. Reply with a registered customer name.');
  }

  const extra = customers.length > rows.length
    ? ' Reply with an exact registered name to choose someone not shown.'
    : '';
  return sendMessage(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: `Select the bill customer, or reply with an exact registered name.${extra}`,
      },
      action: {
        button: 'Choose customer',
        sections: [{
          title: 'Active customers',
          rows,
        }],
      },
    },
  });
}