const mongoose = require('mongoose');

const direktoratSchema = new mongoose.Schema({
  kode: { type: String, required: true, trim: true, uppercase: true, unique: true },
  nama: { type: String, required: true, trim: true }
}, { timestamps: true });

module.exports = mongoose.model('Direktorat', direktoratSchema);
