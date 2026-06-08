const mongoose = require('mongoose');

const signerSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:     { type: String, default: '' },
  email:    { type: String, default: '' },
  status:   { type: String, enum: ['pending', 'signed'], default: 'pending' },
  position: {
    page: { type: Number, default: 0 },
    xPct: { type: Number, default: 0.05 },
    yPct: { type: Number, default: 0.82 },
    wPct: { type: Number, default: 0.28 },
    hPct: { type: Number, default: 0.10 },
  },
  signedAt: { type: Date },
}, { _id: true });

const esignSchema = new mongoose.Schema({
  title:        { type: String, required: true },
  originalFile: { type: String, required: true },
  signedFile:   { type: String, default: '' },
  originalName: { type: String, default: '' },
  status:       { type: String, enum: ['draft', 'partial', 'signed'], default: 'draft' },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  signers:      [signerSchema],
}, { timestamps: true });

module.exports = mongoose.model('ESignSession', esignSchema);
