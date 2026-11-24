import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const IMAGE_WIDTH = 1000;
const IMAGE_LIMIT_BYTES = 5_000_000;
const TABLE_LEFT = 68;
const TABLE_RIGHT = 938;
const ITEM_COLUMN_END = 532;
const QTY_COLUMN_END = 653;
const RATE_COLUMN_END = 789;
const FONT_SIZE = 27;
const LINE_HEIGHT = 36;
const NAVY = '#0c234a';
const PAPER = '#fbf9f3';

function escapeXml(value) {
  const validXmlCharacters = Array.from(String(value), (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
      ? character
      : '';
  }).join('');

  return validXmlCharacters
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function estimateCharacterWidth(character) {
  if (/\s/u.test(character)) return FONT_SIZE * 0.3;
  if (/\p{Mark}/u.test(character)) return 0;
  if (/[ilI.,:;!'|]/u.test(character)) return FONT_SIZE * 0.32;
  if (/[MW@#%]/u.test(character)) return FONT_SIZE * 0.82;
  if (character.codePointAt(0) >= 0x0900) return FONT_SIZE;
  return FONT_SIZE * 0.57;
}

function wrapText(value, maxWidth) {
  const words = String(value).trim().split(/\s+/u).filter(Boolean);
  const lines = [];
  let line = '';
  let lineWidth = 0;

  for (const word of words) {
    const wordCharacters = Array.from(word);
    const wordWidth = wordCharacters.reduce(
      (width, character) => width + estimateCharacterWidth(character),
      0,
    );
    if (line && lineWidth + FONT_SIZE * 0.3 + wordWidth <= maxWidth) {
      line += ` ${word}`;
      lineWidth += FONT_SIZE * 0.3 + wordWidth;
      continue;
    }

    if (line) lines.push(line);
    line = '';
    lineWidth = 0;
    for (const character of wordCharacters) {
      const characterWidth = estimateCharacterWidth(character);
      if (line && lineWidth + characterWidth > maxWidth) {
        lines.push(line);
        line = '';
        lineWidth = 0;
      }
      line += character;
      lineWidth += characterWidth;
    }
  }

  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function formatAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error('Bill image amounts must be finite numbers.');
  }
  return `₹${new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Bill image date must be a valid Date.');
  }
  return date.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
}

function formatPhoneNumber(phoneNumber) {
  if (typeof phoneNumber !== 'string' || !phoneNumber.trim()) return null;
  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return phoneNumber;
}

function renderBillSvg(billData, totals, issueDate, logoData) {
  if (!Array.isArray(totals?.formattedItems) || totals.formattedItems.length === 0) {
    throw new Error('A bill image requires at least one formatted item.');
  }

  const customerName = billData.customer?.name ?? billData.customerName;
  const customerPhone = formatPhoneNumber(billData.customer?.phoneNumber);
  const date = formatDate(issueDate);
  const customerLines = typeof customerName === 'string' && customerName.trim()
    ? wrapText(`Customer: ${customerName.trim()}`, TABLE_RIGHT - TABLE_LEFT)
    : [];
  const customerLine = customerLines.length > 0
    ? `<text x="${TABLE_LEFT}" y="230" class="customer">${customerLines.map((line, index) => (
      `<tspan x="${TABLE_LEFT}" dy="${index === 0 ? 0 : LINE_HEIGHT}">${escapeXml(line)}</tspan>`
    )).join('')}</text>`
    : '';
  const phoneLine = customerPhone
    ? `<text x="${TABLE_LEFT}" y="${customerLines.length > 0 ? 230 + customerLines.length * 38 : 230}" class="phone">WhatsApp: ${escapeXml(customerPhone)}</text>`
    : '';
  const tableTop = 384 + Math.max(0, customerLines.length - 1) * 38;
  const headerHeight = 72;
  const rows = totals.formattedItems.map((item) => {
    const name = typeof item.name === 'string' ? item.name : '';
    const lines = wrapText(name, ITEM_COLUMN_END - TABLE_LEFT - 20);
    const rowHeight = Math.max(74, lines.length * LINE_HEIGHT + 30);
    const amount = item.lineTotal == null ? '—' : formatAmount(item.lineTotal);
    const rate = item.priceType === 'UNIT_PRICE' && item.price != null
      ? formatAmount(item.price)
      : item.priceType === 'LINE_TOTAL'
        ? 'Line total'
        : '—';
    const quantity = item.qty == null ? '—' : String(item.qty);
    const nameText = lines.map((line, index) => (
      `<tspan x="${TABLE_LEFT + 12}" dy="${index === 0 ? 0 : LINE_HEIGHT}">${escapeXml(line)}</tspan>`
    )).join('');
    const nameBaseline = 15 + FONT_SIZE * 0.8;
    const cellBaseline = rowHeight / 2 + FONT_SIZE / 3;
    const content = `
      <text x="${TABLE_LEFT + 12}" y="${nameBaseline}" class="cell">${nameText}</text>
      <text x="${(ITEM_COLUMN_END + QTY_COLUMN_END) / 2}" y="${cellBaseline}" class="cell centered">${escapeXml(quantity)}</text>
      <text x="${RATE_COLUMN_END - 12}" y="${cellBaseline}" class="cell right">${escapeXml(rate)}</text>
      <text x="${TABLE_RIGHT - 12}" y="${cellBaseline}" class="cell right">${escapeXml(amount)}</text>`;
    return { rowHeight, content };
  });

  const rowsHeight = rows.reduce((height, row) => height + row.rowHeight, 0);
  const totalRuleTop = tableTop + headerHeight + rowsHeight + 40;
  const totalRuleBottom = totalRuleTop + 72;
  const height = totalRuleBottom + 388;
  let y = tableTop + headerHeight;
  const rowMarkup = rows.map((row) => {
    const markup = `
      <line x1="${TABLE_LEFT}" y1="${y}" x2="${TABLE_RIGHT}" y2="${y}" class="rule" />
      <g transform="translate(0 ${y})">${row.content}</g>`;
    y += row.rowHeight;
    return markup;
  }).join('');
  const tableBottom = y;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${IMAGE_WIDTH} ${height}">
    <rect width="100%" height="100%" fill="${PAPER}" />
    <rect x="28" y="28" width="${IMAGE_WIDTH - 56}" height="${height - 56}" fill="none" stroke="#b8aa91" stroke-width="1.5" />
    <style>
      text { font-family: Arial, "Noto Sans Devanagari", sans-serif; fill: ${NAVY}; }
      .date { font-size: 25px; font-weight: 700; text-anchor: end; }
      .customer { font-size: 27px; font-weight: 700; }
      .phone { font-size: 23px; }
      .heading { font-size: 25px; font-weight: 700; }
      .cell { font-size: ${FONT_SIZE}px; }
      .centered { text-anchor: middle; }
      .right { text-anchor: end; }
      .total-label { font-size: 32px; font-weight: 700; }
      .total-amount { font-size: 36px; font-weight: 700; }
      .rule { stroke: ${NAVY}; stroke-width: 1.5; }
    </style>
    <image x="345" y="52" width="310" height="118" href="data:image/png;base64,${logoData}" preserveAspectRatio="xMidYMid meet" />
    <text x="${TABLE_RIGHT}" y="118" class="date">${escapeXml(date)}</text>
    ${customerLine}
    ${phoneLine}
    <line x1="${TABLE_LEFT}" y1="${tableTop}" x2="${TABLE_RIGHT}" y2="${tableTop}" class="rule" />
    <text x="${TABLE_LEFT + 17}" y="${tableTop + 46}" class="heading">Item</text>
    <text x="${(ITEM_COLUMN_END + QTY_COLUMN_END) / 2}" y="${tableTop + 46}" class="heading centered">Qty</text>
    <text x="${RATE_COLUMN_END - 15}" y="${tableTop + 46}" class="heading right">Rate</text>
    <text x="${TABLE_RIGHT - 15}" y="${tableTop + 46}" class="heading right">Amount</text>
    <line x1="${TABLE_LEFT}" y1="${tableTop}" x2="${TABLE_LEFT}" y2="${tableBottom}" class="rule" />
    <line x1="${ITEM_COLUMN_END}" y1="${tableTop}" x2="${ITEM_COLUMN_END}" y2="${tableBottom}" class="rule" />
    <line x1="${QTY_COLUMN_END}" y1="${tableTop}" x2="${QTY_COLUMN_END}" y2="${tableBottom}" class="rule" />
    <line x1="${RATE_COLUMN_END}" y1="${tableTop}" x2="${RATE_COLUMN_END}" y2="${tableBottom}" class="rule" />
    <line x1="${TABLE_RIGHT}" y1="${tableTop}" x2="${TABLE_RIGHT}" y2="${tableBottom}" class="rule" />
    ${rowMarkup}
    <line x1="${TABLE_LEFT}" y1="${tableBottom}" x2="${TABLE_RIGHT}" y2="${tableBottom}" class="rule" />
    <line x1="448" y1="${totalRuleTop}" x2="${TABLE_RIGHT}" y2="${totalRuleTop}" class="rule" />
    <text x="${RATE_COLUMN_END - 15}" y="${totalRuleTop + 53}" class="total-label right">TOTAL:</text>
    <text x="${TABLE_RIGHT - 15}" y="${totalRuleTop + 53}" class="total-amount right">${escapeXml(formatAmount(totals.total))}</text>
    <line x1="448" y1="${totalRuleBottom}" x2="${TABLE_RIGHT}" y2="${totalRuleBottom}" class="rule" />
  </svg>`;
}

export async function generateBillImage(billData, totals, issueDate = new Date()) {
  const logo = await readFile(new URL('../assets/boutique-logo.png', import.meta.url));
  const svg = renderBillSvg(billData, totals, issueDate, logo.toString('base64'));
  const image = await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  if (image.length > IMAGE_LIMIT_BYTES) {
    throw new Error("Generated bill image exceeds WhatsApp's 5 MB image limit.");
  }
  return image;
}
