const mongoose = require('mongoose');

const SiteSettingsSchema = new mongoose.Schema({
  siteName:    { type: String, default: 'Inspira' },
  siteSub:     { type: String, default: 'Mailer' },
  logoBase64:  { type: String, default: '' },
  orgCode:     { type: String, default: 'INSPIRA' },
  smtpHost:    { type: String, default: 'smtp.gmail.com' },
  smtpPort:    { type: Number, default: 587 },
  smtpUser:    { type: String, default: '' },
  smtpPass:    { type: String, default: '' },
}, { timestamps: true });

// Singleton — selalu hanya satu dokumen
SiteSettingsSchema.statics.getSettings = async function () {
  let s = await this.findOne();
  if (!s) s = await this.create({});
  return s;
};

module.exports = mongoose.model('SiteSettings', SiteSettingsSchema);
