const mongoose = require('mongoose');

const docSignerSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName:     { type: String, required: true },
  userRole:     { type: String, default: '' },
  userOrg:      { type: String, default: '' },
  token:        { type: String, required: true },
  qrDataUrl:    { type: String, required: true },
  position: {
    x:      { type: Number, default: 60 },
    y:      { type: Number, default: 680 },
    width:  { type: Number, default: 110 },
    height: { type: Number, default: 110 }
  },
  addedAt: { type: Date, default: Date.now }
}, { _id: true });

const documentSignatureSchema = new mongoose.Schema({
  suratId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SuratMasuk', required: true, unique: true, index: true },
  signers:   [docSignerSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('DocumentSignature', documentSignatureSchema);
