import { env } from '../config/env.js';

export async function sendTextMessage(to, text) {
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
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    },
  );

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message ?? `WhatsApp API returned ${response.status}.`);
  }

  return result;
}