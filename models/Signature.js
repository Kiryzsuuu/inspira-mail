const mongoose = require('mongoose');

const signatureSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  fullName:     { type: String, required: true },
  position:     { type: String, default: '' },
  organization: { type: String, default: '' },
  verifyToken:  { type: String, required: true },   // rotates every generate
  qrCodeDataUrl:{ type: String, required: true },   // base64 QR image
  signedAt:     { type: Date,   required: true },
  location: {
    label:     String,
    lat:       Number,
    lng:       Number,
    ipAddress: String
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Signature', signatureSchema);
