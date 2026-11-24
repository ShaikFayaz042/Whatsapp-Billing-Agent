export function calculateBill(items) {
  let total = 0;
  const formattedItems = [];

  for (const item of items) {
    let lineTotal = null;
    if (['spoken', 'manual'].includes(item.priceSource) && item.priceType === 'UNIT_PRICE'
      && item.price != null && item.qty != null) {
      lineTotal = item.price * item.qty;
    } else if (['spoken', 'manual'].includes(item.priceSource) && item.priceType === 'LINE_TOTAL'
      && item.spokenAmount != null) {
      lineTotal = item.spokenAmount;
    }

    if (lineTotal !== null) total += lineTotal;
    formattedItems.push({
      ...item,
      lineTotal,
    });
  }

  return { total, formattedItems };
}

export function calculateBillTotals(billData) {
  const { total: subtotal, formattedItems } = calculateBill(billData.items);
  const discount = billData.discount?.mentioned
    ? billData.discount.type === 'PERCENTAGE'
      ? subtotal * billData.discount.value / 100
      : billData.discount.value
    : 0;
  const total = Math.max(0, subtotal - discount);
  const advance = billData.advancePayment?.mentioned
    ? billData.advancePayment.amount
    : 0;

  return {
    formattedItems,
    subtotal,
    discount,
    advance,
    total,
    balanceDue: Math.max(0, total - advance),
  };
}

export function generateBillPreview(
  customerName,
  formattedItems,
  total,
  { discount = null, advancePayment = null } = {},
) {
  const header = `*SHE'S BOUTIQUE TAILORS*\nCUSTOMER BILL PREVIEW\n-------------------\n`;
  const customer = `*Customer:* ${customerName || 'Unknown'}\n\n`;

  let table = `*Item* | *Qty* | *Rate* | *Amount*\n`;
  let hasPendingDetails = false;
  formattedItems.forEach((item) => {
    const pending = item.lineTotal === null;
    hasPendingDetails ||= pending;
    const qty = item.qty ?? 'Pending';
    let rate = 'Pending';
    const hasKnownPrice = ['spoken', 'manual'].includes(item.priceSource);
    if (hasKnownPrice && item.priceType === 'UNIT_PRICE'
      && item.price != null) {
      rate = `₹${item.price}`;
    } else if (hasKnownPrice && item.priceType === 'LINE_TOTAL'
      && item.spokenAmount != null) {
      rate = 'Line total';
    } else if (item.priceSource === 'spoken' && item.priceType === 'UNCLEAR'
      && item.spokenAmount != null) {
      rate = 'Unclear';
    }

    const amount = item.lineTotal !== null
      ? `₹${item.lineTotal}`
      : item.priceSource === 'spoken' && item.priceType === 'UNCLEAR'
        && item.spokenAmount != null
        ? `₹${item.spokenAmount} (unclear)`
        : 'Pending';
    table += `${item.name} | ${qty} | ${rate} | ${amount}\n`;
  });

  const adjustmentLines = [];
  if (discount?.mentioned) {
    const discountValue = discount.type === 'PERCENTAGE'
      ? `${discount.value}%`
      : `₹${discount.value}`;
    adjustmentLines.push(`*Discount recorded:* ${discountValue} (not applied)`);
  }
  if (advancePayment?.mentioned) {
    adjustmentLines.push(
      `*Advance recorded:* ₹${advancePayment.amount} (balance not calculated)`,
    );
  }

  const hasUnappliedDiscount = discount?.mentioned === true;
  const needsPendingTotal = hasPendingDetails || hasUnappliedDiscount;
  const pendingReasons = [];
  if (hasPendingDetails) pendingReasons.push('missing details');
  if (hasUnappliedDiscount) pendingReasons.push('discount calculation');
  const totalLine = needsPendingTotal
    ? `*${hasUnappliedDiscount ? 'Subtotal before discount' : 'Known Subtotal'}:* ₹${total}\n*Final Total:* Pending ${pendingReasons.join(' and ')}.`
    : `*Grand Total:* ₹${total}`;
  const footer = `\n-------------------\n${totalLine}\n\n_Preview only — not sent yet._`;

  const adjustments = adjustmentLines.length > 0
    ? `\n${adjustmentLines.join('\n')}\n`
    : '';
  return header + customer + table + adjustments + footer;
}