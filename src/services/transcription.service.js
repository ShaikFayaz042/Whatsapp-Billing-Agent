import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

export async function transcribeAudio(filePath) {
  if (!env.groqApiKey) throw new Error('GROQ_API_KEY is not configured.');

  const fileBlob = new Blob([await fs.readFile(filePath)], { type: 'audio/ogg' });
  const formData = new FormData();
  formData.append('file', fileBlob, path.basename(filePath));
  formData.append('model', 'whisper-large-v3');
  formData.append(
    'prompt',
    'Tailoring terms like blouse, lining, saree fall, pico, alteration, dress, frock, kurti, rupees.',
  );
  formData.append('temperature', '0');

  const response = await fetch(
    'https://api.groq.com/openai/v1/audio/translations',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.groqApiKey}` },
      body: formData,
    },
  );

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Groq Translation returned invalid JSON.');
  }

  if (!response.ok) {
    throw new Error(`Groq Translation failed: ${JSON.stringify(data)}`);
  }

  if (typeof data.text !== 'string' || !data.text.trim()) {
    throw new Error('Groq Translation returned no English text.');
  }

  return data.text;
}