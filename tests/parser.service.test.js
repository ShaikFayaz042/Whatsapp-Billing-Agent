import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GROQ_API_KEY = 'test-groq-key';

const {
  extractBillData,
  extractBillEditPatches,
  extractClarificationAnswers,
} = await import('../src/services/parser.service.js');

async function mockExtraction(llmValue, transcript) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(JSON.parse(options.body).model, 'openai/gpt-oss-120b');
    assert.match(JSON.parse(options.body).messages[1].content, new RegExp(transcript));

    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(llmValue) } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    return await extractBillData(transcript);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const baseItem = (overrides = {}) => ({
  rawItemText: 'blouse',
  name: 'Blouse',
  variant: null,
  qty: 1,
  price: 400,
  spokenAmount: null,
  priceType: 'UNIT_PRICE',
  priceSource: 'spoken',
  ambiguity: false,
  ambiguityDetails: [],
  ...overrides,
});

test('extracts a single item with an explicit unit price', async () => {
  const result = await mockExtraction({
    customerName: 'Lakshmi',
    items: [baseItem()],
  }, 'Lakshmi one blouse at 400 rupees');

  assert.equal(result.items[0].qty, 1);
  assert.equal(result.items[0].price, 400);
  assert.equal(result.items[0].priceType, 'UNIT_PRICE');
});

test('preserves the spoken price for a single item without assuming a quantity', async () => {
  const result = await mockExtraction({
    items: [baseItem({
      rawItemText: 'Pink Blouse',
      name: 'Pink Blouse',
      qty: null,
    })],
  }, 'Pink Blouse 400 rupees');

  assert.equal(result.items[0].qty, null);
  assert.equal(result.items[0].price, 400);
  assert.equal(result.items[0].priceType, 'UNIT_PRICE');
  assert.equal(result.items[0].priceSource, 'spoken');
});

test('extracts multiple items with different variants', async () => {
  const result = await mockExtraction({
    customerName: null,
    items: [
      baseItem({ rawItemText: 'Pink Blouse', name: 'Pink Blouse', variant: 'Pink', qty: 2, price: 400 }),
      baseItem({ rawItemText: 'Cutwork Blouse', name: 'Cutwork Blouse', variant: 'Cutwork', qty: 1, price: 500 }),
    ],
  }, 'Two pink blouses at 400 and one cutwork blouse at 500');

  assert.deepEqual(result.items.map((item) => item.name), ['Pink Blouse', 'Cutwork Blouse']);
  assert.deepEqual(result.items.map((item) => item.variant), ['Pink', 'Cutwork']);
  assert.equal(result.items.length, 2);
});

test('keeps Pink Blouse and Cutwork Blouse separate', async () => {
  const result = await mockExtraction({
    items: [
      baseItem({ rawItemText: 'Pink Blouse', name: 'Pink Blouse', variant: 'Pink' }),
      baseItem({ rawItemText: 'Cutwork Blouse', name: 'Cutwork Blouse', variant: 'Cutwork', price: 450 }),
    ],
  }, 'Pink blouse 400 and cutwork blouse 450');

  assert.equal(result.items[0].name, 'Pink Blouse');
  assert.equal(result.items[1].name, 'Cutwork Blouse');
  assert.equal(result.items[0].variant, 'Pink');
  assert.equal(result.items[1].variant, 'Cutwork');
});

test('does not convert generic Saree into Saree Fall', async () => {
  const result = await mockExtraction({
    items: [
      baseItem({ rawItemText: 'Saree', name: 'Saree', variant: null, qty: 2, price: 60 }),
      baseItem({ rawItemText: 'Saree Fall', name: 'Saree Fall', variant: null, qty: 2, price: 70 }),
    ],
  }, 'Two sarees at 60 and two saree falls at 70');

  assert.equal(result.items[0].name, 'Saree');
  assert.equal(result.items[1].name, 'Saree Fall');
});

test('extracts multiple quantities', async () => {
  const result = await mockExtraction({
    items: [baseItem({ qty: 4, price: 350 })],
  }, 'Four blouses at 350 rupees each');
  assert.equal(result.items[0].qty, 4);
});

test('returns null for missing quantity', async () => {
  const result = await mockExtraction({
    items: [baseItem({ qty: null, ambiguity: true, ambiguityDetails: ['quantity'] })],
  }, 'One blouse for 400 rupees');
  assert.equal(result.items[0].qty, null);
  assert.deepEqual(result.items[0].ambiguityDetails, ['quantity']);
});

test('returns null for missing price', async () => {
  const result = await mockExtraction({
    items: [baseItem({ price: null, priceType: null, ambiguity: true, ambiguityDetails: ['price'] })],
  }, 'Two blouses');
  assert.equal(result.items[0].price, null);
  assert.equal(result.items[0].priceType, null);
});

test('preserves a clear price when item description is ambiguous', async () => {
  const result = await mockExtraction({
    items: [baseItem({
      rawItemText: 'special blouse work',
      name: null,
      variant: null,
      qty: 1,
      price: 450,
      ambiguity: true,
      ambiguityDetails: ['item_name', 'variant'],
    })],
  }, 'Special blouse work for 450');
  assert.equal(result.items[0].price, 450);
  assert.equal(result.items[0].name, 'special blouse work');
  assert.ok(result.items[0].ambiguityDetails.includes('item_name'));
});

test('preserves complete descriptions for common tailoring items', async () => {
  const descriptions = [
    'Pink Blouse',
    'Saree Fall with Kuchulu',
    'Princess Cut Stitching',
  ];
  const result = await mockExtraction({
    items: descriptions.map((description) => baseItem({
      rawItemText: description,
      name: description,
    })),
  }, 'Pink Blouse, Saree Fall with Kuchulu, and Princess Cut Stitching');

  assert.deepEqual(result.items.map((item) => item.name), descriptions);
  assert.deepEqual(result.items.map((item) => item.rawItemText), descriptions);
});

test('accepts previously unseen item descriptions without mapping', async () => {
  const description = 'Custom Neck Design';
  const result = await mockExtraction({
    items: [baseItem({ rawItemText: description, name: description })],
  }, description);

  assert.equal(result.items[0].name, description);
  assert.equal(result.items[0].rawItemText, description);
});

test('preserves long custom descriptions and all descriptive words', async () => {
  const description = 'Bridal Designer Blouse with Hand Embroidered Floral Neck and Custom Sleeve Finish';
  const result = await mockExtraction({
    items: [baseItem({ rawItemText: description, name: 'Bridal Blouse' })],
  }, description);

  assert.equal(result.items[0].name, description);
  assert.equal(result.items[0].rawItemText, description);
});

test('trims surrounding whitespace but retains original description wording', async () => {
  const result = await mockExtraction({
    items: [baseItem({
      rawItemText: '  Saree Fall with Kuchulu  ',
      name: 'Saree Fall',
    })],
  }, 'Saree Fall with Kuchulu');

  assert.equal(result.items[0].rawItemText, 'Saree Fall with Kuchulu');
  assert.equal(result.items[0].name, 'Saree Fall with Kuchulu');
});

test('preserves quantity, price, price type, and ambiguity with free-form name', async () => {
  const description = 'Transparent Cutwork Blouse with Beaded Neckline';
  const result = await mockExtraction({
    items: [baseItem({
      rawItemText: description,
      name: 'Blouse',
      variant: 'Transparent Cutwork',
      qty: 3,
      price: 650,
      priceType: 'UNIT_PRICE',
      ambiguity: true,
      ambiguityDetails: ['variant'],
    })],
  }, description);

  assert.equal(result.items[0].name, description);
  assert.equal(result.items[0].qty, 3);
  assert.equal(result.items[0].price, 650);
  assert.equal(result.items[0].priceType, 'UNIT_PRICE');
  assert.equal(result.items[0].ambiguity, true);
  assert.deepEqual(result.items[0].ambiguityDetails, ['variant']);
});

test('falls back to legacy name field and preserves arbitrary text', async () => {
  const description = 'Hand Finished Custom Neck Design';
  const result = await mockExtraction({
    items: [baseItem({
      rawItemText: null,
      name: description,
      variant: null,
    })],
  }, description);

  assert.equal(result.items[0].name, description);
  assert.equal(result.items[0].rawItemText, description);
});

test('extracts fixed discount', async () => {
  const result = await mockExtraction({
    items: [baseItem()],
    discount: { mentioned: true, type: 'FIXED_RUPEES', value: 100 },
  }, 'One blouse 400 rupees discount 100 rupees');
  assert.deepEqual(result.discount, { mentioned: true, type: 'FIXED_RUPEES', value: 100 });
});

test('extracts percentage discount', async () => {
  const result = await mockExtraction({
    items: [baseItem()],
    discount: { mentioned: true, type: 'PERCENTAGE', value: 10 },
  }, 'One blouse 400 rupees ten percent discount');
  assert.deepEqual(result.discount, { mentioned: true, type: 'PERCENTAGE', value: 10 });
});

test('extracts advance payment', async () => {
  const result = await mockExtraction({
    items: [baseItem()],
    advancePayment: { mentioned: true, amount: 200 },
  }, 'One blouse 400 rupees advance 200');
  assert.deepEqual(result.advancePayment, { mentioned: true, amount: 200 });
});

test('preserves additional customer notes', async () => {
  const result = await mockExtraction({
    items: [baseItem()],
    notes: 'Deliver on Friday',
  }, 'One blouse 400 rupees please deliver on Friday');
  assert.equal(result.notes, 'Deliver on Friday');
});

test('returns null customer name when not mentioned', async () => {
  const result = await mockExtraction({
    customerName: null,
    items: [baseItem()],
  }, 'One blouse 400 rupees');
  assert.equal(result.customerName, null);
});

test('preserves a line total instead of converting it to unit price', async () => {
  const result = await mockExtraction({
    items: [baseItem({
      qty: 3,
      price: null,
      spokenAmount: 900,
      priceType: 'LINE_TOTAL',
      ambiguity: true,
      ambiguityDetails: ['price'],
    })],
  }, 'Three blouses for 900 rupees');
  assert.equal(result.items[0].price, null);
  assert.equal(result.items[0].spokenAmount, 900);
  assert.equal(result.items[0].priceType, 'LINE_TOTAL');
  assert.equal(result.items[0].priceSource, 'spoken');
});

test('preserves a unit price for multiple explicitly stated quantities', async () => {
  const result = await mockExtraction({
    items: [baseItem({ qty: 2, price: 400 })],
  }, 'Two Blouses, 400 rupees each');

  assert.equal(result.items[0].qty, 2);
  assert.equal(result.items[0].price, 400);
  assert.equal(result.items[0].priceType, 'UNIT_PRICE');
  assert.equal(result.items[0].priceSource, 'spoken');
});

test('preserves an explicitly spoken per-piece rate', async () => {
  const result = await mockExtraction({
    items: [baseItem({
      rawItemText: 'Lining',
      name: 'Lining',
      qty: 3,
      price: 50,
    })],
  }, 'Lining at 50 rupees per piece');

  assert.equal(result.items[0].price, 50);
  assert.equal(result.items[0].priceType, 'UNIT_PRICE');
  assert.equal(result.items[0].priceSource, 'spoken');
});

test('preserves an amount with unclear unit-versus-total meaning', async () => {
  const result = await mockExtraction({
    items: [baseItem({
      price: null,
      spokenAmount: 400,
      priceType: 'UNCLEAR',
    })],
  }, 'Blouse 400 rupees');

  assert.equal(result.items[0].price, null);
  assert.equal(result.items[0].spokenAmount, 400);
  assert.equal(result.items[0].priceType, 'UNCLEAR');
  assert.equal(result.items[0].priceSource, 'spoken');
  assert.equal(result.items[0].ambiguity, true);
  assert.ok(result.items[0].ambiguityDetails.includes('price'));
});

test('preserves a price independently when quantity is missing', async () => {
  const result = await mockExtraction({
    items: [baseItem({
      qty: null,
      ambiguity: true,
      ambiguityDetails: ['quantity'],
    })],
  }, 'Blouse at 400 rupees');

  assert.equal(result.items[0].qty, null);
  assert.equal(result.items[0].price, 400);
  assert.equal(result.items[0].priceSource, 'spoken');
});

test('keeps prices distinct across items and preserves discount and advance', async () => {
  const result = await mockExtraction({
    items: [
      baseItem({ rawItemText: 'Pink Blouse', name: 'Pink Blouse', price: 400 }),
      baseItem({ rawItemText: 'Lining', name: 'Lining', price: 50 }),
    ],
    discount: { mentioned: true, type: 'FIXED_RUPEES', value: 100 },
    advancePayment: { mentioned: true, amount: 200 },
  }, 'Pink Blouse 400 rupees and Lining 50 rupees, 100 discount, 200 advance');

  assert.deepEqual(result.items.map((item) => item.price), [400, 50]);
  assert.deepEqual(result.items.map((item) => item.priceSource), ['spoken', 'spoken']);
  assert.deepEqual(result.discount, { mentioned: true, type: 'FIXED_RUPEES', value: 100 });
  assert.deepEqual(result.advancePayment, { mentioned: true, amount: 200 });
});

test('marks an absent price missing without assigning a default', async () => {
  const result = await mockExtraction({
    items: [baseItem({
      qty: 2,
      price: null,
      spokenAmount: null,
      priceType: null,
      priceSource: 'spoken',
    })],
  }, 'Two Blouses');

  assert.equal(result.items[0].price, null);
  assert.equal(result.items[0].spokenAmount, null);
  assert.equal(result.items[0].priceType, null);
  assert.equal(result.items[0].priceSource, 'missing');
});

test('retains a model-provided amount but marks an unknown price type unclear', async () => {
  const result = await mockExtraction({
    items: [baseItem({
      price: 425,
      priceType: null,
      priceSource: 'missing',
    })],
  }, 'Custom stitching 425 rupees');

  assert.equal(result.items[0].price, null);
  assert.equal(result.items[0].spokenAmount, 425);
  assert.equal(result.items[0].priceType, 'UNCLEAR');
  assert.equal(result.items[0].priceSource, 'spoken');
});

test('rejects malformed spoken price data instead of silently dropping it', async () => {
  await assert.rejects(
    () => mockExtraction({
      items: [baseItem({ price: true })],
    }, 'One blouse at 400 rupees'),
    /invalid item price/,
  );
});

test('preserves invalid numeric values so bill validation can clarify them', async () => {
  const result = await mockExtraction({
    items: [baseItem({ qty: -1, price: -400 })],
    discount: { mentioned: true, type: 'FIXED_RUPEES', value: -10 },
    advancePayment: { mentioned: true, amount: -5 },
  }, 'One blouse, invalid quantity and price, negative discount and advance');

  assert.equal(result.items[0].qty, -1);
  assert.equal(result.items[0].price, -400);
  assert.equal(result.items[0].priceSource, 'spoken');
  assert.equal(result.discount.value, -10);
  assert.equal(result.advancePayment.amount, -5);
});

test('preserves an empty item description for deterministic validation', async () => {
  const result = await mockExtraction({
    items: [baseItem({ rawItemText: '', name: '' })],
  }, 'An item description was not recognized');

  assert.equal(result.items[0].rawItemText, '');
  assert.equal(result.items[0].name, '');
});

async function mockStructuredCall(llmValue, invoke) {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(llmValue) } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const result = await invoke();
    return { result, requestBody };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('extracts pending follow-up answers and treats “rate of both” as a line total', async () => {
  const billData = {
    customerName: 'Rehan',
    items: [
      baseItem({ qty: null, price: 250, ambiguity: true, ambiguityDetails: ['quantity'] }),
      baseItem({
        rawItemText: 'Lining Cloth',
        name: 'Lining Cloth',
        qty: 2,
        price: null,
        spokenAmount: 350,
        priceType: 'UNCLEAR',
      }),
    ],
    discount: { mentioned: false, type: null, value: null },
    advancePayment: { mentioned: false, amount: null },
    notes: null,
  };
  const validation = {
    missingFields: ['items[0].qty', 'items[1].price'],
    questions: ['What is the quantity of Blouse?', 'Is ₹350 per item or the total?'],
  };
  const { result, requestBody } = await mockStructuredCall({
    answers: [
      { path: 'items[0].qty', value: 1 },
      { path: 'items[1].price', amount: 350, priceType: 'LINE_TOTAL' },
      { path: 'items[0].price', amount: 999, priceType: 'UNIT_PRICE' },
    ],
  }, () => extractClarificationAnswers(
    'Quantity 1 and price is 250 rupees. Lining cloth quantity is 2 and rate of both is 350 rupees.',
    billData,
    validation,
  ));

  assert.deepEqual(result, [
    { path: 'items[0].qty', value: 1 },
    { path: 'items[1].price', amount: 350, priceType: 'LINE_TOTAL' },
  ]);
  assert.equal(requestBody.temperature, 0);
  assert.match(requestBody.messages[0].content, /rate of both is 350 rupees/);
});

test('extracts only explicit bill edits with valid item indexes', async () => {
  const billData = { items: [baseItem(), baseItem({ name: 'Lining' })] };
  const { result, requestBody } = await mockStructuredCall({
    updates: [
      { itemIndex: 0, name: 'Bridal Blouse' },
      { itemIndex: 1, qty: 2, amount: 350, priceType: 'LINE_TOTAL' },
      { itemIndex: 10, name: 'Invented item' },
    ],
  }, () => extractBillEditPatches(
    'Rename Blouse to Bridal Blouse and set Lining quantity to 2, total 350.',
    billData,
  ));

  assert.deepEqual(result, [
    { itemIndex: 0, name: 'Bridal Blouse' },
    { itemIndex: 1, qty: 2, amount: 350, priceType: 'LINE_TOTAL' },
  ]);
  assert.equal(requestBody.temperature, 0);
});
