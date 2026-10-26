import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

const MEDIA_HOSTS = new Set([
  'graph.facebook.com',
  'lookaside.fbsbx.com',
  'lookaside.facebook.com',
]);

export async function downloadMedia(mediaId) {
  if (!mediaId) throw new Error('A WhatsApp media ID is required.');
  if (!env.whatsappAccessToken) throw new Error('WhatsApp access token is not configured.');

  const urlRes = await fetch(
    `https://graph.facebook.com/${env.graphApiVersion}/${encodeURIComponent(mediaId)}`,
    { headers: { Authorization: `Bearer ${env.whatsappAccessToken}` } },
  );
  const urlData = await urlRes.json();
  if (!urlRes.ok) {
    throw new Error(`Failed to get media URL: ${JSON.stringify(urlData)}`);
  }

  const mediaUrl = new URL(urlData.url);
  if (mediaUrl.protocol !== 'https:' || !MEDIA_HOSTS.has(mediaUrl.hostname)) {
    throw new Error('Meta returned an unsupported media URL.');
  }

  const mediaRes = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${env.whatsappAccessToken}` },
  });
  if (!mediaRes.ok) throw new Error('Failed to download media file.');

  const buffer = Buffer.from(await mediaRes.arrayBuffer());
  const downloadsDir = path.resolve('downloads');
  await fs.mkdir(downloadsDir, { recursive: true });

  const mimeSubtype = urlData.mime_type?.split('/')[1]?.split(';')[0];
  const extension = mimeSubtype && /^[a-z0-9.+-]+$/i.test(mimeSubtype)
    ? mimeSubtype
    : 'ogg';
  const filePath = path.join(downloadsDir, `${path.basename(mediaId)}.${extension}`);
  await fs.writeFile(filePath, buffer);

  return filePath;
}