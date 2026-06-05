const mongoose = require('mongoose');

const kontakSchema = new mongoose.Schema({
  nama:     { type: String, default: '' },
  jabatan:  { type: String, default: '' },
  email:    { type: String, default: '' },
  telepon:  { type: String, default: '' },
}, { _id: false });

const perusahaanSchema = new mongoose.Schema({
  nama:       { type: String, required: true, trim: true },
  singkatan:  { type: String, trim: true, default: '' },
  alamat:     { type: String, default: '' },
  email:      { type: String, default: '' },
  telepon:    { type: String, default: '' },
  website:    { type: String, default: '' },
  keterangan: { type: String, default: '' },
  kontak:     { type: [kontakSchema], default: [] },
  isActive:   { type: Boolean, default: true },
  createdBy:  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name:   String,
  },
}, { timestamps: true });

module.exports = mongoose.model('Perusahaan', perusahaanSchema);
