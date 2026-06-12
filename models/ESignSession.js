const mongoose = require('mongoose');

const signerSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName:       { type: String, default: '' },
  userRole:       { type: String, default: '' },
  userOrg:        { type: String, default: '' },
  jabatanDisplay: { type: String, default: '' },
  token:          { type: String, default: '' },
  qrDataUrl:      { type: String, default: '' },
  status:         { type: String, enum: ['pending', 'signed'], default: 'pending' },
  displayMode:    { type: String, enum: ['full', 'name_only', 'qr_only'], default: 'full' },
  showDate:       { type: Boolean, default: true },
  lokasiTtd:     { type: String, default: '' },
  tanggalTtd:    { type: Date },
  tanggalDisplay: { type: String, default: '' },
  position: {
    page:   { type: Number, default: 0 },
    x:      { type: Number, default: 60 },
    y:      { type: Number, default: 680 },
    width:  { type: Number, default: 110 },
    height: { type: Number, default: 110 },
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
