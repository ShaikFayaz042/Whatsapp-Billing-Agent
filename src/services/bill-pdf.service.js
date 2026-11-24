import PDFDocument from 'pdfkit';

function formatAmount(amount) {
  return `INR ${new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

export function generateBillPdf(billData, totals, issueDate = new Date()) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    const left = document.page.margins.left;
    const right = document.page.width - document.page.margins.right;
    const pageWidth = right - left;
    const columns = {
      item: { x: left, width: pageWidth * 0.52 },
      qty: { x: left + pageWidth * 0.57, width: pageWidth * 0.10 },
      rate: { x: left + pageWidth * 0.68, width: pageWidth * 0.14 },
      amount: { x: left + pageWidth * 0.83, width: pageWidth * 0.17 },
    };
    const rule = (y, color = '#d7dee5', width = 0.6) => {
      document.moveTo(left, y).lineTo(right, y).strokeColor(color).lineWidth(width).stroke();
    };

    const headerY = document.y;
    document.fillColor('#243447').font('Helvetica-Bold').fontSize(18)
      .text("SHE'S BOUTIQUE TAILORS", left, headerY, { width: pageWidth * 0.68 });
    document.font('Helvetica-Bold').fontSize(11)
      .text(issueDate.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }),
        left + pageWidth * 0.70, headerY + 6, { width: pageWidth * 0.30, align: 'right' });
    document.fillColor('#748093').font('Helvetica-Bold').fontSize(10)
      .text('CUSTOMER BILL', left, headerY + 25);
    rule(headerY + 52, '#243447', 1.4);

    const drawTableHeader = () => {
      const y = document.y;
      document.font('Helvetica-Bold').fillColor('#243447').fontSize(10);
      document.text('Item', columns.item.x, y, { width: columns.item.width });
      document.text('Qty', columns.qty.x, y, {
        width: columns.qty.width,
        align: 'center',
      });
      document.text('Rate', columns.rate.x, y, {
        width: columns.rate.width,
        align: 'right',
      });
      document.text('Amount', columns.amount.x, y, {
        width: columns.amount.width,
        align: 'right',
      });
      document.y = y + 22;
      rule(document.y, '#98a6b3', 0.9);
      document.y += 9;
    };

    const customerY = headerY + 76;
    document.fillColor('#243447').font('Helvetica-Bold').fontSize(11)
      .text('Customer', left, customerY);
    document.text(
      billData.customer?.name ?? billData.customerName ?? 'Unknown',
      left + 82,
      customerY,
      { width: pageWidth - 82 },
    );
    document.fillColor('#748093').font('Helvetica').fontSize(10)
      .text(`WhatsApp: ${billData.customer?.phoneNumber ?? ''}`, left, headerY + 99);
    document.y = headerY + 145;
    drawTableHeader();
    for (const item of totals.formattedItems) {
      const itemName = item.name ?? '';
      const hasKnownPrice = ['spoken', 'manual'].includes(item.priceSource);
      const rate = hasKnownPrice && item.priceType === 'UNIT_PRICE' && item.price != null
        ? formatAmount(item.price)
        : hasKnownPrice && item.priceType === 'LINE_TOTAL' && item.spokenAmount != null
          ? 'Line total'
          : item.priceType === 'UNCLEAR' && item.spokenAmount != null
            ? 'Unclear'
            : 'Pending';
      const amount = item.lineTotal === null ? 'Pending' : formatAmount(item.lineTotal);
      const rowHeight = Math.max(
        document.heightOfString(itemName, { width: columns.item.width }),
        15,
      );
      if (document.y + rowHeight + 18 > document.page.height - document.page.margins.bottom) {
        document.addPage();
        drawTableHeader();
      }
      const rowY = document.y;
      document.font('Helvetica').fontSize(10).fillColor('#243447')
        .text(itemName, columns.item.x, rowY, { width: columns.item.width });
      document.text(String(item.qty ?? 'Pending'), columns.qty.x, rowY, {
        width: columns.qty.width,
        align: 'center',
      });
      document.text(rate, columns.rate.x, rowY, {
        width: columns.rate.width,
        align: 'right',
      });
      document.text(amount, columns.amount.x, rowY, {
        width: columns.amount.width,
        align: 'right',
      });
      document.y = rowY + rowHeight + 10;
      rule(document.y, '#e1e6eb');
      document.y += 8;
    }

    if (document.y + 55 > document.page.height - document.page.margins.bottom) {
      document.addPage();
    }
    const totalY = document.y + 5;
    rule(totalY, '#98a6b3', 0.9);
    document.fillColor('#243447').font('Helvetica-Bold').fontSize(11)
      .text('TOTAL', columns.rate.x - 70, totalY + 13, {
        width: 60,
        align: 'right',
      });
    document.fontSize(16).text(formatAmount(totals.total), columns.amount.x, totalY + 10, {
      width: columns.amount.width,
      align: 'right',
    });
    rule(totalY + 42, '#243447', 1.4);

    document.end();
  });
}
