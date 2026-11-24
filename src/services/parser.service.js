import { env } from '../config/env.js';


const systemPrompt = `
You are a bill-data extraction assistant for a tailoring
business in India. The transcript is in English.

The transcript may contain speech recognition errors.

Extract only information supported by the transcript.

RULES:

1. Preserve customerName only when explicitly spoken. Otherwise use null.
2. For each item, copy the complete item description to rawItemText and name.
   Keep the wording and descriptive terms; do not normalize, standardize,
   abbreviate, categorize, or substitute any part of the description.
3. Keep descriptors such as color, style, work, fabric, and custom details in
   name. If variant is also provided, it must not replace or be removed from name.
4. Accept any item description, including unfamiliar or custom terms. There is
   no fixed item list, category, alias, or catalogue.
5. Generic Saree and Saree Fall are distinct descriptions. Do not add or remove
   words to make one resemble the other.
6. Extract qty only when it is explicitly stated. It must be a positive integer.
   Never assume qty 1. If missing or unclear, use null.
7. Extract every clearly spoken rupee amount. price means a per-unit price
   only; do not put a line total or unclear amount in price.
8. Use UNIT_PRICE when the amount is explicitly a per-piece/unit rate
   (including "each" or "per piece"), or is stated as the price for a single
   item description. If multiple pieces are mentioned, use UNIT_PRICE only
   when per-item pricing is clear. Use LINE_TOTAL only when the amount
   explicitly covers the complete item quantity (including "total"). Use
   UNCLEAR when an amount covers multiple pieces but its meaning is unclear.
   Use null for priceType only when no amount was mentioned.
9. For LINE_TOTAL, keep the full spoken amount in spokenAmount and set price
   null. Never divide it by quantity or calculate a unit price.
10. For UNCLEAR, keep the amount in spokenAmount and set price null. Never
    assume it is a unit price or line total. Quantity does not resolve this.
11. Set priceSource to "spoken" whenever a rupee amount was explicitly spoken,
    including line totals and unclear amounts. Otherwise set it to "missing".
    Never reuse another item's price, apply a default, or use a rate card.
12. Extract a fixed or percentage discount exactly as spoken. Use
   discount.type "FIXED_RUPEES" or "PERCENTAGE". If mentioned but unclear,
   use mentioned true, type null and value null.
13. Extract only explicitly mentioned advance payments. Use advancePayment
   mentioned false unless advance is spoken. If unclear, mentioned true and
   amount null.
14. Preserve additional instructions or customer notes in notes. Otherwise use null.
15. Never invent customer names, item words, variants, quantities, prices,
   discounts or notes.
16. Preserve clearly extracted fields even when another field is ambiguous.
   Do not discard an explicit price because item description or variant is ambiguous.
17. ambiguityDetails must identify unclear fields, for example "quantity",
   "price", "item_name", "variant", "line_total", "discount", or "advance".
18. Do not calculate line totals, subtotal, discounts or balance due.
19. If the transcript contains no billing information, return exactly:
   {"error":"no_bill_found"}

Return ONLY valid JSON with this structure:

{
  "customerName": "Name or null",
  "items": [
    {
      "rawItemText": "Pink Blouse",
      "name": "Pink Blouse",
      "variant": null,
      "qty": 3,
      "price": 300,
      "spokenAmount": null,
      "priceType": "UNIT_PRICE",
      "priceSource": "spoken",
      "ambiguity": false,
      "ambiguityDetails": []
    }
  ],
  "discount": {
    "mentioned": false,
    "type": null,
    "value": null
  },
  "advancePayment": {
    "mentioned": false,
    "amount": null
  },
  "notes": null
}
`;

function validateBillData(value) {
  if (value?.error === 'no_bill_found') return value;
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) {
    throw new Error('Groq Parser returned an invalid bill structure.');
  }
  if (value.customerName != null && typeof value.customerName !== 'string') {
    throw new Error('Groq Parser returned an invalid customer name.');
  }

  const items = value.items.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Groq Parser returned an invalid item.');
    }
    if (item.name != null && typeof item.name !== 'string') {
      throw new Error('Groq Parser returned an invalid item name.');
    }
    if (item.variant != null && typeof item.variant !== 'string') {
      throw new Error('Groq Parser returned an invalid item variant.');
    }
    if (item.rawItemText != null && typeof item.rawItemText !== 'string') {
      throw new Error('Groq Parser returned an invalid raw item text.');
    }

    const rawQty = item.qty;
    const parsedQty = rawQty == null || (typeof rawQty === 'string' && !rawQty.trim())
      ? NaN
      : Number(rawQty);
    const qty = Number.isFinite(parsedQty) ? parsedQty : null;

    const parseAmount = (rawAmount, fieldName) => {
      if (rawAmount == null || (typeof rawAmount === 'string' && !rawAmount.trim())) {
        return null;
      }
      if (typeof rawAmount !== 'number' && typeof rawAmount !== 'string') {
        throw new Error(`Groq Parser returned an invalid ${fieldName}.`);
      }
      const amount = Number(rawAmount);
      if (!Number.isFinite(amount)) {
        throw new Error(`Groq Parser returned an invalid ${fieldName}.`);
      }
      return amount;
    };
    const rawPrice = parseAmount(item.price, 'item price');
    const rawSpokenAmount = parseAmount(item.spokenAmount, 'spoken amount');
    const validPriceTypes = new Set(['UNIT_PRICE', 'LINE_TOTAL', 'UNCLEAR']);
    let priceType = validPriceTypes.has(item.priceType) ? item.priceType : null;
    let price = null;
    let spokenAmount = null;

    if (priceType === 'UNIT_PRICE') {
      price = rawPrice ?? rawSpokenAmount;
      if (price === null) priceType = null;
    } else if (priceType === 'LINE_TOTAL' || priceType === 'UNCLEAR') {
      spokenAmount = rawSpokenAmount ?? rawPrice;
      if (spokenAmount === null) priceType = null;
    } else if (rawPrice !== null || rawSpokenAmount !== null) {
      priceType = 'UNCLEAR';
      spokenAmount = rawSpokenAmount ?? rawPrice;
    }
    const priceSource = price !== null || spokenAmount !== null ? 'spoken' : 'missing';
    const ambiguityDetails = Array.isArray(item.ambiguityDetails)
      ? item.ambiguityDetails.filter((detail) => typeof detail === 'string' && detail.trim())
        .map((detail) => detail.trim())
      : [];
    if (priceType === 'UNCLEAR' && !ambiguityDetails.includes('price')) {
      ambiguityDetails.push('price');
    }
    const rawItemText = item.rawItemText?.trim() || item.name?.trim() || '';
    return {
      rawItemText,
      name: rawItemText,
      variant: item.variant?.trim() || null,
      qty,
      price,
      spokenAmount,
      priceType,
      priceSource,
      ambiguity: item.ambiguity === true || ambiguityDetails.length > 0,
      ambiguityDetails,
    };
  });

  if (items.length === 0) return { error: 'no_bill_found' };

  const discountValue = value.discount?.value;
  let parsedDiscountValue = discountValue == null
    || (typeof discountValue === 'string' && !discountValue.trim())
    ? null
    : Number(discountValue);
  if (!Number.isFinite(parsedDiscountValue)) {
    parsedDiscountValue = null;
  }
  const discountType = ['FIXED_RUPEES', 'PERCENTAGE'].includes(value.discount?.type)
    ? value.discount.type
    : null;

  const advanceValue = value.advancePayment?.amount;
  let parsedAdvance = advanceValue == null
    || (typeof advanceValue === 'string' && !advanceValue.trim())
    ? null
    : Number(advanceValue);
  if (!Number.isFinite(parsedAdvance)) parsedAdvance = null;

  return {
    customerName: value.customerName?.trim() || null,
    items,
    discount: {
      mentioned: value.discount?.mentioned === true,
      type: discountType,
      value: parsedDiscountValue,
    },
    advancePayment: {
      mentioned: value.advancePayment?.mentioned === true,
      amount: parsedAdvance,
    },
    notes: typeof value.notes === 'string' && value.notes.trim()
      ? value.notes.trim()
      : null,
  };
}

export async function extractBillData(transcript) {
  if (!env.groqApiKey) throw new Error('GROQ_API_KEY is not configured.');
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return { error: 'no_bill_found' };
  }

  const parsed = await requestJson([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Transcript: "${transcript}"` },
  ], 'bill parser', 0.1);
  return validateBillData(parsed);
}

async function requestJson(messages, operation, temperature = 0) {
  if (!env.groqApiKey) throw new Error('GROQ_API_KEY is not configured.');
  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages,
        temperature,
        response_format: { type: 'json_object' },
      }),
    },
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Groq ${operation} failed: ${JSON.stringify(data)}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`Groq ${operation} returned no JSON content.`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Groq ${operation} returned invalid JSON.`);
  }
}

function validateClarificationAnswers(value, pendingFields) {
  if (!value || !Array.isArray(value.answers)) {
    throw new Error('Groq clarification parser returned an invalid answer structure.');
  }
  const allowedPaths = new Set(pendingFields);
  return value.answers.flatMap((answer) => {
    if (!answer || typeof answer.path !== 'string' || !allowedPaths.has(answer.path)) {
      return [];
    }

    if (answer.path.endsWith('.price')) {
      if (answer.amount == null
        || (typeof answer.amount === 'string' && !answer.amount.trim())) return [];
      const amount = Number(answer.amount);
      if (!Number.isFinite(amount)) return [];
      const priceType = ['UNIT_PRICE', 'LINE_TOTAL', 'UNCLEAR'].includes(answer.priceType)
        ? answer.priceType
        : 'UNCLEAR';
      return [{ path: answer.path, amount, priceType }];
    }

    if (answer.path.endsWith('.qty')
      || answer.path === 'discount.value'
      || answer.path === 'advancePayment.amount') {
      if (answer.value == null
        || (typeof answer.value === 'string' && !answer.value.trim())) return [];
      const number = Number(answer.value);
      return Number.isFinite(number)
        ? [{ path: answer.path, value: number }]
        : [];
    }

    if (typeof answer.value !== 'string' || !answer.value.trim()) return [];
    return [{ path: answer.path, value: answer.value.trim() }];
  });
}

export async function extractClarificationAnswers(transcript, billData, validation) {
  if (typeof transcript !== 'string' || !transcript.trim()) return [];
  const pendingFields = validation?.missingFields ?? [];
  if (pendingFields.length === 0) return [];

  const fieldContext = pendingFields.map((path) => {
    const itemMatch = /^items\[(\d+)\]\.(.+)$/.exec(path);
    if (itemMatch) {
      const item = billData.items[Number(itemMatch[1])];
      return {
        path,
        itemName: item?.name || item?.rawItemText || null,
        currentQuantity: item?.qty ?? null,
        currentPriceType: item?.priceType ?? null,
        currentSpokenAmount: item?.spokenAmount ?? null,
      };
    }
    return { path };
  });

  const system = `You extract only explicit answers to pending bill clarification questions.
Return JSON only: {"answers":[{"path":"...","value":1}]}.
Only answer a path listed as pending. Do not invent, infer, or change any other field.
Use the item names and existing draft to associate an answer. If an answer cannot be
unambiguously matched to a pending field, omit it. An unlabeled answer may be matched
only when there is exactly one compatible pending field.
For a price path, return {"path":"...","amount":number,"priceType":"UNIT_PRICE"|"LINE_TOTAL"|"UNCLEAR"}.
Use UNIT_PRICE for explicit "each/per piece" wording. Use LINE_TOTAL for an explicit
combined amount such as "total for both" or "rate of both is 350 rupees"; that exact
wording means the combined total. Use UNCLEAR if the amount meaning is still unclear.
Do not calculate totals, divide amounts, or modify item descriptions unless that exact
field is pending. For discount and advance paths, return only the explicitly stated value.
If the transcript does not answer a pending field, leave it out.`;

  const parsed = await requestJson([
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({
        transcript,
        pendingFields: fieldContext,
        existingBill: billData,
        questions: validation.questions,
      }),
    },
  ], 'clarification parser');
  return validateClarificationAnswers(parsed, pendingFields);
}

export async function extractBillEditPatches(transcript, billData) {
  if (typeof transcript !== 'string' || !transcript.trim()) return [];
  const system = `Extract only explicit edits to this existing bill. Return JSON only:
{"updates":[{"itemIndex":0,"name":"New description","qty":2,"amount":500,"priceType":"UNIT_PRICE"}]}.
Use zero-based itemIndex from the supplied item list. Do not create items, change the
customer, calculate amounts, or modify fields not explicitly requested. Preserve all
other data. Item names are free-form. For an explicit price edit, include amount and
priceType: UNIT_PRICE for an explicit per-unit rate, LINE_TOTAL for an explicit total,
or UNCLEAR if its meaning is unclear. Omit unmentioned values. If an edit cannot be
matched unambiguously to an existing item, omit it.`;
  const parsed = await requestJson([
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({
        transcript,
        items: billData.items.map(({ name, qty, price, spokenAmount, priceType }, itemIndex) => ({
          itemIndex,
          name,
          qty,
          price,
          spokenAmount,
          priceType,
        })),
      }),
    },
  ], 'bill edit parser');

  if (!parsed || !Array.isArray(parsed.updates)) {
    throw new Error('Groq bill edit parser returned an invalid update structure.');
  }
  return parsed.updates.flatMap((update) => {
    if (!Number.isInteger(update?.itemIndex)
      || update.itemIndex < 0
      || update.itemIndex >= billData.items.length) {
      return [];
    }
    const patch = { itemIndex: update.itemIndex };
    if (typeof update.name === 'string' && update.name.trim()) {
      patch.name = update.name.trim();
    }
    if (update.qty != null && Number.isFinite(Number(update.qty))) {
      patch.qty = Number(update.qty);
    }
    if (update.amount != null && Number.isFinite(Number(update.amount))) {
      patch.amount = Number(update.amount);
      patch.priceType = ['UNIT_PRICE', 'LINE_TOTAL', 'UNCLEAR'].includes(update.priceType)
        ? update.priceType
        : 'UNCLEAR';
    }
    return Object.keys(patch).length > 1 ? [patch] : [];
  });
}