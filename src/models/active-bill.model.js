import mongoose from 'mongoose';

const activeBillSchema = new mongoose.Schema({
  ownerWaId: {
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'superseded', 'sent'],
    default: 'active',
    required: true,
  },
  webEditTokenHash: {
    type: String,
  },
  webEditExpiresAt: {
    type: Date,
  },
  stage: {
    type: String,
    enum: [
      'AWAITING_CLARIFICATION',
      'AWAITING_ACTION',
      'EDITING_BILL',
      'EDITING_CONTACT',
      'EDITING_WEB',
      'EDITING_CONTACT_PHONE',
      'SENDING_BILL',
      'SENT',
    ],
    required: true,
  },
  billData: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  validation: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
}, {
  timestamps: true,
});

activeBillSchema.index(
  { ownerWaId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
  },
);
activeBillSchema.index(
  { webEditTokenHash: 1 },
  { unique: true, sparse: true },
);

const ActiveBill = mongoose.models.ActiveBill
  || mongoose.model('ActiveBill', activeBillSchema);

export default ActiveBill;
