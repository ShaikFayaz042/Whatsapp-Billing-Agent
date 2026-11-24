import ActiveBill from '../models/active-bill.model.js';

export function createBillDraftService(ActiveBillModel = ActiveBill) {
  async function getActiveDraft(ownerWaId) {
    return ActiveBillModel.findOne({ ownerWaId, status: 'active' });
  }

  async function getActiveDraftByWebEditTokenHash(webEditTokenHash) {
    return ActiveBillModel.findOne({
      webEditTokenHash,
      status: 'active',
      stage: 'EDITING_WEB',
      webEditExpiresAt: { $gt: new Date() },
    });
  }

  async function completeWebEdit(webEditTokenHash, billData, validation) {
    return ActiveBillModel.findOneAndUpdate(
      {
        webEditTokenHash,
        status: 'active',
        stage: 'EDITING_WEB',
        webEditExpiresAt: { $gt: new Date() },
      },
      {
        $set: {
          billData,
          validation,
          stage: 'AWAITING_ACTION',
        },
        $unset: { webEditTokenHash: 1, webEditExpiresAt: 1 },
      },
      { new: true, runValidators: true },
    );
  }

  async function createDraft(ownerWaId, billData, validation, stage) {
    return new ActiveBillModel({
      ownerWaId,
      billData,
      validation,
      stage,
      status: 'active',
    }).save();
  }

  async function updateDraft(ownerWaId, updates) {
    const setUpdates = { ...updates };
    const unsetUpdates = {};
    for (const field of ['webEditTokenHash', 'webEditExpiresAt']) {
      if (setUpdates[field] === null) {
        delete setUpdates[field];
        unsetUpdates[field] = 1;
      }
    }
    const update = { $set: setUpdates };
    if (Object.keys(unsetUpdates).length > 0) update.$unset = unsetUpdates;
    const draft = await ActiveBillModel.findOneAndUpdate(
      { ownerWaId, status: 'active' },
      update,
      { new: true, runValidators: true },
    );
    if (!draft) throw new Error('The active bill draft no longer exists.');
    return draft;
  }

  async function supersedeDraft(ownerWaId) {
    return ActiveBillModel.findOneAndUpdate(
      { ownerWaId, status: 'active' },
      {
        $set: { status: 'superseded' },
        $unset: { webEditTokenHash: 1, webEditExpiresAt: 1 },
      },
      { new: true },
    );
  }

  async function cancelDraft(ownerWaId) {
    return ActiveBillModel.findOneAndUpdate(
      { ownerWaId, status: 'active', stage: { $ne: 'SENDING_BILL' } },
      {
        $set: { status: 'cancelled' },
        $unset: { webEditTokenHash: 1, webEditExpiresAt: 1 },
      },
      { new: true },
    );
  }

  async function claimDraftForSending(ownerWaId, stage) {
    return ActiveBillModel.findOneAndUpdate(
      { ownerWaId, status: 'active', stage },
      {
        $set: {
          stage: 'SENDING_BILL',
        },
        $unset: { webEditTokenHash: 1, webEditExpiresAt: 1 },
      },
      { new: true },
    );
  }

  async function markDraftSent(ownerWaId) {
    return ActiveBillModel.findOneAndUpdate(
      { ownerWaId, status: 'active', stage: 'SENDING_BILL' },
      {
        $set: {
          status: 'sent',
          stage: 'SENT',
        },
        $unset: { webEditTokenHash: 1, webEditExpiresAt: 1 },
      },
      { new: true },
    );
  }

  return {
    getActiveDraft,
    getActiveDraftByWebEditTokenHash,
    completeWebEdit,
    createDraft,
    updateDraft,
    supersedeDraft,
    cancelDraft,
    claimDraftForSending,
    markDraftSent,
  };
}

function clearAmbiguity(item, ...fields) {
  item.ambiguityDetails = (item.ambiguityDetails ?? [])
    .filter((detail) => !fields.includes(detail));
  item.ambiguity = item.ambiguityDetails.length > 0;
}

function setSpokenPrice(item, amount, priceType) {
  item.priceType = ['UNIT_PRICE', 'LINE_TOTAL', 'UNCLEAR'].includes(priceType)
    ? priceType
    : 'UNCLEAR';
  item.price = item.priceType === 'UNIT_PRICE' ? amount : null;
  item.spokenAmount = item.priceType === 'UNIT_PRICE' ? null : amount;
  item.priceSource = 'spoken';
  if (item.priceType === 'UNCLEAR') {
    item.ambiguityDetails = [...new Set([...(item.ambiguityDetails ?? []), 'price'])];
    item.ambiguity = true;
  } else {
    clearAmbiguity(item, 'price', 'line_total');
  }
}

function parseItemPath(path) {
  const match = /^items\[(\d+)\]\.(name|qty|price|variant)$/.exec(path);
  return match
    ? { index: Number(match[1]), field: match[2] }
    : null;
}

export function applyClarificationAnswers(billData, answers, pendingFields) {
  const allowedPaths = new Set(pendingFields);
  const updated = structuredClone(billData);

  for (const answer of answers) {
    if (!allowedPaths.has(answer.path)) continue;
    const itemPath = parseItemPath(answer.path);
    if (itemPath) {
      const item = updated.items[itemPath.index];
      if (!item) continue;

      if (itemPath.field === 'price') {
        if (typeof answer.amount !== 'number' || !Number.isFinite(answer.amount)) continue;
        setSpokenPrice(item, answer.amount, answer.priceType);
      } else if (itemPath.field === 'qty') {
        if (typeof answer.value !== 'number' || !Number.isFinite(answer.value)) continue;
        item.qty = answer.value;
        clearAmbiguity(item, 'quantity');
      } else if (itemPath.field === 'name' || itemPath.field === 'variant') {
        if (typeof answer.value !== 'string' || !answer.value.trim()) continue;
        item[itemPath.field] = answer.value.trim();
        if (itemPath.field === 'name' && !item.rawItemText) {
          item.rawItemText = answer.value.trim();
        }
        clearAmbiguity(item, itemPath.field === 'name' ? 'item_name' : 'variant');
      }
      continue;
    }

    if (answer.path === 'discount.type'
      && ['FIXED_RUPEES', 'PERCENTAGE'].includes(answer.value)) {
      updated.discount = { ...updated.discount, mentioned: true, type: answer.value };
    } else if (answer.path === 'discount.value'
      && typeof answer.value === 'number' && Number.isFinite(answer.value)) {
      updated.discount = { ...updated.discount, mentioned: true, value: answer.value };
    } else if (answer.path === 'advancePayment.amount'
      && typeof answer.value === 'number' && Number.isFinite(answer.value)) {
      updated.advancePayment = {
        ...updated.advancePayment,
        mentioned: true,
        amount: answer.value,
      };
    }
  }

  return updated;
}

export function applyBillEditPatches(billData, patches) {
  const updated = structuredClone(billData);

  for (const patch of patches) {
    const item = updated.items[patch.itemIndex];
    if (!item) continue;

    if (typeof patch.name === 'string' && patch.name.trim()) {
      item.name = patch.name.trim();
      clearAmbiguity(item, 'item_name');
    }
    if (typeof patch.qty === 'number' && Number.isFinite(patch.qty)) {
      item.qty = patch.qty;
      clearAmbiguity(item, 'quantity');
    }
    if (typeof patch.amount === 'number' && Number.isFinite(patch.amount)) {
      setSpokenPrice(item, patch.amount, patch.priceType);
    }
  }

  return updated;
}

export function isExplicitNewBillRequest(text) {
  return /\b(?:new bill|start (?:a )?new bill|create (?:a )?new bill|another bill|next bill|prepare (?:a )?bill|make (?:a )?bill|send (?:this )?bill to)\b/i
    .test(text);
}

export function isBillPreviewRequest(text) {
  return /\b(?:show|resend|repeat)\b.{0,30}\b(?:bill|preview)\b|\b(?:bill|preview)\b.{0,30}\b(?:missing|not visible|can't see|cannot see|didn't receive|not received)\b|\b(?:can't|cannot)\s+see\s+(?:the\s+)?bill\b/i
    .test(text);
}
