import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.GROQ_API_KEY = 'test-groq-key';

const { transcribeAudio } = await import('../src/services/transcription.service.js');

async function createAudioFile() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'billing-agent-'));
  const filePath = path.join(directory, 'voice.ogg');
  await fs.writeFile(filePath, Buffer.from('mock audio'));
  return { directory, filePath };
}

async function withMockTranslation(returnedText, fn) {
  const originalFetch = globalThis.fetch;
  const { directory, filePath } = await createAudioFile();

  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/audio/translations');
      assert.equal(options.method, 'POST');

      const body = options.body;
      assert.equal(body.get('model'), 'whisper-large-v3');
      assert.equal(body.get('temperature'), '0');
      assert.equal(body.get('language'), null);
      assert.match(body.get('prompt'), /saree fall/i);

      return new Response(JSON.stringify({ text: returnedText }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await fn(filePath);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('Hindi voice is returned as English text', async () => {
  await withMockTranslation(
    'Lakshmi, two blouses at 400 rupees each and lining.',
    async (filePath) => {
      assert.equal(
        await transcribeAudio(filePath),
        'Lakshmi, two blouses at 400 rupees each and lining.',
      );
    },
  );
});

test('Telugu voice is returned as English text', async () => {
  await withMockTranslation(
    'Prashanti needs one cutwork blouse at 500 rupees.',
    async (filePath) => {
      assert.equal(
        await transcribeAudio(filePath),
        'Prashanti needs one cutwork blouse at 500 rupees.',
      );
    },
  );
});

test('English voice remains English and preserves terms and values', async () => {
  await withMockTranslation(
    'Lakshmi: three Blouses, Lining, and two Saree Falls at 350 rupees each.',
    async (filePath) => {
      const rawTranscript = await transcribeAudio(filePath);
      assert.equal(rawTranscript, 'Lakshmi: three Blouses, Lining, and two Saree Falls at 350 rupees each.');
      assert.match(rawTranscript, /\bthree\b/);
      assert.match(rawTranscript, /\b350\b/);
      assert.match(rawTranscript, /Cutwork|Blouses/);
      assert.match(rawTranscript, /Saree Falls/);
    },
  );
});

test('Hindi-English mixed voice is translated to English', async () => {
  await withMockTranslation(
    'Lakshmi, do two Pink Blouses and one Lining, 400 rupees.',
    async (filePath) => {
      assert.equal(
        await transcribeAudio(filePath),
        'Lakshmi, do two Pink Blouses and one Lining, 400 rupees.',
      );
    },
  );
});

test('Telugu-English mixed voice is translated to English', async () => {
  await withMockTranslation(
    'Prashanti wants two cutwork blouses and one saree fall at 450 rupees.',
    async (filePath) => {
      assert.equal(
        await transcribeAudio(filePath),
        'Prashanti wants two cutwork blouses and one saree fall at 450 rupees.',
      );
    },
  );
});

test('translation HTTP failure does not return fallback text', async () => {
  const originalFetch = globalThis.fetch;
  const { directory, filePath } = await createAudioFile();

  try {
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: { message: 'invalid audio' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );

    await assert.rejects(
      transcribeAudio(filePath),
      /Groq Translation failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('empty translation response does not return fallback text', async () => {
  await withMockTranslation('', async (filePath) => {
    await assert.rejects(
      transcribeAudio(filePath),
      /Groq Translation returned no English text/,
    );
  });
});
