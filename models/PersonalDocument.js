const mongoose = require('mongoose');

const personalDocSchema = new mongoose.Schema({
  title:          { type: String, required: true },
  filePath:       { type: String, required: true },
  originalName:   { type: String, default: '' },
  fileSize:       { type: Number, default: 0 },
  type:           { type: String, enum: ['uploaded', 'esigned'], default: 'uploaded' },
  signerNames:    [String],
  createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  esignSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ESignSession' },
}, { timestamps: true });

module.exports = mongoose.model('PersonalDocument', personalDocSchema);
