import mongoose from 'mongoose';

export function normalizePhoneNumber(value) {
  if (value == null) return value;
  if (typeof value !== 'string') {
    throw new TypeError('Phone number must be a string in international format.');
  }

  const phoneNumber = value.trim().replace(/[\s().-]/g, '');
  if (!phoneNumber) return phoneNumber;
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    throw new Error(
      'Phone number must include its country code in E.164 format, for example +<country-code><number>.',
    );
  }
  return phoneNumber;
}

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  phoneNumber: {
    type: String,
    required: true,
    set: normalizePhoneNumber,
    validate: {
      validator: (value) => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value),
      message: 'Phone number must be in E.164 international format.',
    },
  },
  aliases: {
    type: [{ type: String, trim: true }],
    default: [],
    validate: {
      validator: (aliases) => aliases.every((alias) => alias.length > 0),
      message: 'Aliases must not contain empty values.',
    },
  },
  whatsappOptIn: {
    type: Boolean,
    default: false,
  },
  isTestCustomer: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
  notes: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
});

customerSchema.index({ phoneNumber: 1 }, { unique: true });

const Customer = mongoose.models.Customer
  || mongoose.model('Customer', customerSchema);

export default Customer;
