const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  name: String,
  email: String
}, { _id: false });

const emailSchema = new mongoose.Schema({
  from: { type: participantSchema, required: true },
  to: [participantSchema],
  cc: [participantSchema],
  subject: { type: String, required: true },
  body: { type: String, default: '' },
  tag: { type: String, enum: ['Urgent', 'Penting', 'Info', 'Normal', 'Draft'], default: 'Normal' },
  berkas: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'sent'], default: 'draft' },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deletedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

module.exports = mongoose.model('Email', emailSchema);
