const mongoose = require('mongoose');

const jabatanSchema = new mongoose.Schema({
  nama: { type: String, required: true, trim: true, unique: true }
}, { timestamps: true });

module.exports = mongoose.model('Jabatan', jabatanSchema);
