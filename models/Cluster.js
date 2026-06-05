const mongoose = require('mongoose');

const clusterSchema = new mongoose.Schema({
  nama:        { type: String, required: true, trim: true },
  deskripsi:   { type: String, trim: true, default: '' },
  anggota: [{
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name:    String,
    jabatan: String,
    _id:     false
  }]
}, { timestamps: true });

module.exports = mongoose.model('Cluster', clusterSchema);
