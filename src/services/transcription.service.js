import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

export async function transcribeAudio(filePath) {
  if (!env.groqApiKey) throw new Error('GROQ_API_KEY is not configured.');

  const fileBlob = new Blob([await fs.readFile(filePath)], { type: 'audio/ogg' });
  const formData = new FormData();
  formData.append('file', fileBlob, path.basename(filePath));
  formData.append('model', 'whisper-large-v3');

  const response = await fetch(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.groqApiKey}` },
      body: formData,
    },
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Groq Transcription failed: ${JSON.stringify(data)}`);
  }

  return data.text;
}