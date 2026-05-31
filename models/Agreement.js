const mongoose = require('mongoose');

const agreementSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['MOU', 'PKS', 'SPK', 'KONTRAK'],
    required: true
  },
  nomor: { type: String, required: true, unique: true },
  urutan: { type: Number, required: true },   // sequential per type per year
  tahun: { type: Number, required: true },
  bulan: { type: Number, required: true },

  judul: { type: String, required: true, trim: true },
  pihakPertama: { type: String, trim: true },  // internal org name
  pihakKedua:   { type: String, trim: true },  // external party
  nilaiKontrak: { type: Number, default: null },// for SPK/KONTRAK
  tanggalMulai: { type: Date },
  tanggalBerakhir: { type: Date },
  deskripsi: { type: String, trim: true },

  status: {
    type: String,
    enum: ['draft', 'review', 'aktif', 'berakhir', 'dibatalkan'],
    default: 'draft'
  },

  createdBy: {
    userId: mongoose.Schema.Types.ObjectId,
    name: String,
    email: String,
    role: String
  },

  attachments: [{ filename: String, url: String }],

  riwayat: [{
    status: String,
    catatan: String,
    oleh: String,
    waktu: { type: Date, default: Date.now }
  }]

}, { timestamps: true });

agreementSchema.index({ type: 1, tahun: 1 });
agreementSchema.index({ status: 1 });

module.exports = mongoose.model('Agreement', agreementSchema);
