const mongoose = require('mongoose');

const shortUrlSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: String,
  originalUrl: { type: String, required: true },
  shortCode: { type: String, required: true, unique: true },
  title: { type: String, default: '' },
  clicks: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

shortUrlSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('ShortUrl', shortUrlSchema);
