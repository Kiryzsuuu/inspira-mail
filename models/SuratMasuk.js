const mongoose = require('mongoose');

const suratMasukSchema = new mongoose.Schema({
  nomorSurat:    { type: String, trim: true, default: '' },
  dariInstansi:  { type: String, required: true, trim: true },
  perihal:       { type: String, required: true, trim: true },
  tanggalSurat:  { type: Date },
  tanggalTerima: { type: Date, required: true },
  klasifikasi:   { type: String, enum: ['Biasa','Penting','Segera','Mendesak'], default: 'Biasa' },
  catatan:       { type: String, trim: true, default: '' },

  // Uploaded scan stored locally
  file: {
    originalName: String,
    path: String,       // /uploads/suratmasuk/filename
    mimetype: String,
    size: Number
  },

  dicatatOleh: {
    userId: mongoose.Schema.Types.ObjectId,
    name:   String,
    email:  String
  },

  status: {
    type: String,
    enum: ['baru', 'dibaca', 'ditindaklanjuti', 'selesai'],
    default: 'baru'
  }
}, { timestamps: true });

suratMasukSchema.index({ tanggalTerima: -1 });
suratMasukSchema.index({ status: 1 });
suratMasukSchema.index({ dariInstansi: 1 });

module.exports = mongoose.model('SuratMasuk', suratMasukSchema);
