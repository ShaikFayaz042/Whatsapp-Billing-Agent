const KNOWN_AMBIGUITY_FIELDS = new Set([
  'item_name',
  'variant',
  'quantity',
  'price',
  'line_total',
]);

function numericValue(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateBillForBilling(billData) {
  const issues = [];
  const missingFields = [];
  const questions = [];
  const addIssue = ({ itemName = null, field, path, reason, question }) => {
    if (missingFields.includes(path)) return;
    issues.push({ itemName, field, reason });
    missingFields.push(path);
    if (!questions.includes(question)) questions.push(question);
  };

  if (!billData || !Array.isArray(billData.items) || billData.items.length === 0) {
    addIssue({
      field: 'items',
      path: 'items',
      reason: 'No bill items were provided',
      question: 'What items should I include in the bill?',
    });
  } else {
    billData.items.forEach((item, index) => {
      const itemName = typeof item?.name === 'string' && item.name.trim()
        ? item.name.trim()
        : null;
      const label = itemName || `item ${index + 1}`;
      const ambiguityDetails = Array.isArray(item?.ambiguityDetails)
        ? item.ambiguityDetails
        : [];
      const hasAmbiguity = (field) => ambiguityDetails.includes(field);

      if (!itemName) {
        addIssue({
          itemName: null,
          field: 'name',
          path: `items[${index}].name`,
          reason: 'Item name is missing',
          question: `What is the name or description of item ${index + 1}?`,
        });
      } else if (hasAmbiguity('item_name')) {
        addIssue({
          itemName,
          field: 'name',
          path: `items[${index}].name`,
          reason: 'Item description is ambiguous',
          question: `Please clarify the item description for ${itemName}.`,
        });
      }

      const qty = numericValue(item?.qty);
      if (qty === null) {
        addIssue({
          itemName,
          field: 'qty',
          path: `items[${index}].qty`,
          reason: 'Quantity was not mentioned or is invalid',
          question: `What is the quantity of ${label}?`,
        });
      } else if (qty <= 0) {
        addIssue({
          itemName,
          field: 'qty',
          path: `items[${index}].qty`,
          reason: 'Quantity must be a positive number',
          question: `What is the quantity of ${label}? It must be greater than zero.`,
        });
      } else if (hasAmbiguity('quantity')) {
        addIssue({
          itemName,
          field: 'qty',
          path: `items[${index}].qty`,
          reason: 'Quantity is ambiguous',
          question: `Please clarify the quantity of ${label}.`,
        });
      }

      const priceType = item?.priceType;
      const unitPrice = numericValue(item?.price);
      const lineTotal = numericValue(item?.spokenAmount);
      let priceReason = null;
      let priceQuestion = null;

      if (priceType === 'UNIT_PRICE') {
        if (unitPrice === null) {
          const absent = item?.price == null
            || (typeof item.price === 'string' && !item.price.trim());
          priceReason = absent ? 'Price was not mentioned' : 'Unit price is invalid';
          priceQuestion = `What is the unit price of ${label}?`;
        } else if (unitPrice < 0) {
          priceReason = 'Unit price must not be negative';
          priceQuestion = `What is the unit price of ${label}? It must not be negative.`;
        }
      } else if (priceType === 'LINE_TOTAL') {
        if (lineTotal === null) {
          const absent = item?.spokenAmount == null
            || (typeof item.spokenAmount === 'string' && !item.spokenAmount.trim());
          priceReason = absent ? 'Price was not mentioned' : 'Line total is invalid';
          priceQuestion = `What is the total price for ${label}?`;
        } else if (lineTotal < 0) {
          priceReason = 'Line total must not be negative';
          priceQuestion = `What is the total price for ${label}? It must not be negative.`;
        }
      } else if (priceType === 'UNCLEAR') {
        priceReason = 'Price was mentioned but its meaning is unclear';
        priceQuestion = lineTotal === null
          ? `What is the price of ${label}?`
          : `Is ₹${lineTotal} the unit price or the total for ${label}?`;
      } else if (unitPrice !== null || lineTotal !== null) {
        priceReason = 'Price type is missing or invalid';
        const amount = lineTotal ?? unitPrice;
        priceQuestion = `Is ₹${amount} the unit price or the total for ${label}?`;
      } else {
        priceReason = 'Price was not mentioned';
        priceQuestion = `What is the price of ${label}?`;
      }

      if (!priceReason && !['spoken', 'manual'].includes(item?.priceSource)) {
        priceReason = 'Price is not confirmed as explicitly spoken';
        priceQuestion = `What is the price of ${label}?`;
      }
      if (!priceReason && (hasAmbiguity('price') || hasAmbiguity('line_total'))) {
        priceReason = 'Price is ambiguous';
        priceQuestion = lineTotal !== null
          ? `Please clarify the ${priceType === 'LINE_TOTAL' ? 'total price' : 'price'} of ${label}.`
          : `Please clarify whether the price of ${label} is per item or a total.`;
      }
      if (priceReason) {
        addIssue({
          itemName,
          field: 'price',
          path: `items[${index}].price`,
          reason: priceReason,
          question: priceQuestion,
        });
      }

      if (itemName && hasAmbiguity('variant') && !hasAmbiguity('item_name')) {
        addIssue({
          itemName,
          field: 'variant',
          path: `items[${index}].variant`,
          reason: 'Item variant or description is ambiguous',
          question: `Please clarify the item description for ${label}.`,
        });
      }
      const hasUnknownAmbiguity = ambiguityDetails.some(
        (detail) => !KNOWN_AMBIGUITY_FIELDS.has(detail),
      );
      if (item?.ambiguity === true
        && (ambiguityDetails.length === 0 || hasUnknownAmbiguity)) {
        addIssue({
          itemName,
          field: 'item',
          path: `items[${index}].ambiguity`,
          reason: 'Item details are ambiguous',
          question: `Please clarify the details of ${label}.`,
        });
      }
    });
  }

  if (billData?.discount?.mentioned === true) {
    const discountValue = numericValue(billData.discount.value);
    const discountType = billData.discount.type;
    if (discountType !== 'FIXED_RUPEES' && discountType !== 'PERCENTAGE') {
      addIssue({
        field: 'discount.type',
        path: 'discount.type',
        reason: 'Discount type is unclear',
        question: 'Is the discount a fixed rupee amount or a percentage?',
      });
    }
    if (discountValue === null) {
      addIssue({
        field: 'discount.value',
        path: 'discount.value',
        reason: 'Discount amount or percentage is unclear',
        question: discountType === 'PERCENTAGE'
          ? 'What discount percentage should I record?'
          : 'What discount amount should I record?',
      });
    } else if (discountValue < 0) {
      addIssue({
        field: 'discount.value',
        path: 'discount.value',
        reason: 'Discount must not be negative',
        question: 'What non-negative discount should I record?',
      });
    } else if (discountType === 'PERCENTAGE' && discountValue > 100) {
      addIssue({
        field: 'discount.value',
        path: 'discount.value',
        reason: 'Percentage discount must be between 0 and 100',
        question: 'What discount percentage between 0 and 100 should I record?',
      });
    }
  }

  if (billData?.advancePayment?.mentioned === true) {
    const advanceAmount = numericValue(billData.advancePayment.amount);
    if (advanceAmount === null) {
      addIssue({
        field: 'advancePayment.amount',
        path: 'advancePayment.amount',
        reason: 'Advance payment amount is unclear',
        question: 'What advance payment amount should I record?',
      });
    } else if (advanceAmount < 0) {
      addIssue({
        field: 'advancePayment.amount',
        path: 'advancePayment.amount',
        reason: 'Advance payment must not be negative',
        question: 'What non-negative advance payment should I record?',
      });
    }
  }

  if (issues.length === 0 && billData?.discount?.mentioned === true) {
    const subtotal = billData.items.reduce((sum, item) => {
      const qty = numericValue(item.qty);
      const amount = item.priceType === 'UNIT_PRICE'
        ? numericValue(item.price) * qty
        : numericValue(item.spokenAmount);
      return sum + amount;
    }, 0);
    const discount = billData.discount.type === 'PERCENTAGE'
      ? subtotal * billData.discount.value / 100
      : billData.discount.value;
    if (discount > subtotal) {
      addIssue({
        field: 'discount.value',
        path: 'discount.value',
        reason: 'Discount must not exceed the bill subtotal',
        question: 'The discount is greater than the bill subtotal. What discount should I record?',
      });
    }
  }

  return {
    status: issues.length === 0 ? 'READY' : 'NEEDS_CLARIFICATION',
    issues,
    missingFields,
    questions,
  };
}

export function formatClarificationQuestions(validation) {
  return `Please clarify:\n${validation.questions.map((question) => `• ${question}`).join('\n')}`;
}
