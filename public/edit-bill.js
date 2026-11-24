const itemsContainer = document.querySelector('#items');
const errorNotice = document.querySelector('#error');
const successNotice = document.querySelector('#success');
const submitButton = document.querySelector('#submit');
const tokenPath = window.location.pathname.replace(/\/$/, '');
const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
let bill = null;

function showError(message) {
  errorNotice.textContent = message;
  errorNotice.hidden = false;
  successNotice.hidden = true;
}

function addItem(item = {}) {
  const card = document.createElement('section');
  card.className = 'item';
  card.dataset.sourceIndex = Number.isInteger(item.sourceIndex)
    ? String(item.sourceIndex)
    : '';
  card.dataset.priceType = item.priceType === 'LINE_TOTAL' ? 'LINE_TOTAL' : 'UNIT_PRICE';

  const heading = document.createElement('div');
  heading.className = 'item-heading';
  const title = document.createElement('strong');
  title.textContent = `Item ${itemsContainer.children.length + 1}`;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => {
    card.remove();
    renumberItems();
    updateTotal();
  });
  heading.append(title, remove);

  const fields = document.createElement('div');
  fields.className = 'fields';
  const name = makeField('Item name', 'text', item.name ?? '', 'e.g. Blouse stitching');
  const quantity = makeField('Quantity', 'number', item.quantity ?? '', '1');
  quantity.input.min = '0.01';
  quantity.input.step = 'any';
  const amountLabel = card.dataset.priceType === 'LINE_TOTAL'
    ? 'Line total (₹)'
    : 'Rate (₹)';
  const amount = makeField(amountLabel, 'number', item.amount ?? '', '0');
  amount.input.min = '0';
  amount.input.step = 'any';

  for (const input of [name.input, quantity.input, amount.input]) {
    input.addEventListener('input', updateTotal);
  }
  fields.append(name.label, quantity.label, amount.label);
  card.append(heading, fields);
  itemsContainer.append(card);
  renumberItems();
}

function makeField(labelText, type, value, placeholder) {
  const label = document.createElement('label');
  const caption = document.createElement('span');
  caption.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  if (type === 'text') input.maxLength = 120;
  label.append(caption, input);
  return { label, input };
}

function renumberItems() {
  [...itemsContainer.children].forEach((item, index) => {
    item.querySelector('.item-heading strong').textContent = `Item ${index + 1}`;
  });
}

function updateTotal() {
  let subtotal = 0;
  for (const item of itemsContainer.children) {
    const [name, quantity, amount] = item.querySelectorAll('input');
    if (!name.value.trim() && !quantity.value && !amount.value) continue;
    const qty = Number(quantity.value);
    const rate = Number(amount.value);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate < 0) continue;
    subtotal += item.dataset.priceType === 'LINE_TOTAL' ? rate : qty * rate;
  }
  const discount = bill?.discountMentioned
    ? bill.discountType === 'PERCENTAGE' ? subtotal * bill.discount / 100 : bill.discount
    : 0;
  document.querySelector('#total').textContent = money.format(Math.max(0, subtotal - discount));
}

function readItems() {
  return [...itemsContainer.children].map((item) => {
    const [name, quantity, amount] = item.querySelectorAll('input');
    return {
      name: name.value,
      quantity: quantity.value,
      amount: amount.value,
      priceType: item.dataset.priceType,
      sourceIndex: item.dataset.sourceIndex === '' ? null : Number(item.dataset.sourceIndex),
    };
  });
}

async function loadBill() {
  const response = await fetch(`${tokenPath}/data`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(await response.text());
  bill = await response.json();
  document.querySelector('#customer-name').textContent = bill.customerName;
  for (const item of bill.items) addItem(item);
  updateTotal();
}

document.querySelector('#add-item').addEventListener('click', () => addItem());
submitButton.addEventListener('click', async () => {
  errorNotice.hidden = true;
  successNotice.hidden = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Saving…';
  try {
    const response = await fetch(tokenPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: readItems() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not save your changes.');
    successNotice.textContent = result.notificationError
      ?? 'Changes saved. Return to WhatsApp to review the updated bill.';
    successNotice.hidden = false;
    itemsContainer.querySelectorAll('input, button').forEach((control) => {
      control.disabled = true;
    });
    document.querySelector('#add-item').disabled = true;
    submitButton.textContent = 'Changes saved';
  } catch (error) {
    showError(error.message);
    submitButton.disabled = false;
    submitButton.textContent = 'Submit changes';
  }
});

loadBill().catch((error) => {
  document.querySelector('#items').textContent = '';
  showError(error.message);
  submitButton.disabled = true;
});
