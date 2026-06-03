const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  name: String,
  email: String
}, { _id: false });

const externalSchema = new mongoose.Schema({
  name:  String,
  email: String
}, { _id: false });

const emailSchema = new mongoose.Schema({
  from:        { type: participantSchema, required: true },
  to:          [participantSchema],
  cc:          [participantSchema],
  toExternal:  [externalSchema],
  subject:     { type: String, required: true },
  body:        { type: String, default: '' },
  tag:         { type: String, enum: ['Urgent','Penting','Info','Normal','Draft'], default: 'Normal' },
  berkas:      { type: String, default: '' },
  nomorSurat:  { type: String, default: '' },
  sifat:       { type: String, enum: ['Biasa/Terbuka','Rahasia','Terbatas','Segera'], default: 'Biasa/Terbuka' },
  jenis:       { type: String, enum: ['internal','eksternal'], default: 'internal' },
  tipeSurat:   { type: String, default: 'Surat' },
  suratData:   { type: mongoose.Schema.Types.Mixed, default: {} },
  status:      { type: String, enum: ['draft','sent'], default: 'draft' },
  readBy:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deletedBy:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

module.exports = mongoose.model('Email', emailSchema);
