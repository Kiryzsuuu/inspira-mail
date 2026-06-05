const mongoose = require('mongoose');

const organisasiSchema = new mongoose.Schema({
  nama: { type: String, required: true, trim: true, unique: true }
}, { timestamps: true });

module.exports = mongoose.model('Organisasi', organisasiSchema);
