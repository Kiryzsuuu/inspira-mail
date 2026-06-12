const mongoose = require('mongoose');

const nomorSajaSchema = new mongoose.Schema({
  nomorSurat:  { type: String, required: true },
  tipeSurat:   { type: String, required: true },
  perihal:     { type: String, default: '(Tanpa Perihal)' },
  tanggal:     { type: Date, required: true },
  kodeDir:     { type: String, default: 'DIR' },
  jenis:       { type: String, enum: ['internal','eksternal'], default: 'internal' },
  createdBy:   {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name:   String,
    email:  String,
  },
  isDeleted:   { type: Boolean, default: false },
  deletedAt:   { type: Date },
  deletedBy:   {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name:   String,
  },
}, { timestamps: true });

module.exports = mongoose.model('NomorSaja', nomorSajaSchema);
