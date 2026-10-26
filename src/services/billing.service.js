export function calculateBill(items) {
  let total = 0;
  const formattedItems = items.map((item) => {
    const lineTotal = item.price * item.qty;
    total += lineTotal;
    return `• ${item.name} (x${item.qty}): ₹${lineTotal}`;
  });

  return { total, formattedItems };
}

export function generateDummyBill(customerName = 'Lakshmi') {
  const dummyItems = [
    { name: 'Blouse stitching', qty: 1, price: 350 },
    { name: 'Lining', qty: 1, price: 80 },
    { name: 'Saree fall', qty: 1, price: 100 },
  ];

  const { total, formattedItems } = calculateBill(dummyItems);
  const billText = `
🧾 *Dummy Bill for ${customerName}*

${formattedItems.join('\n')}

*Total Amount: ₹${total}*
  `.trim();

  return billText;
}