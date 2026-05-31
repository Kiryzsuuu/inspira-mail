const mongoose = require('mongoose');

// Tracks the last used sequential number per doc type per year
const docCounterSchema = new mongoose.Schema({
  key:  { type: String, required: true, unique: true }, // e.g. "MOU-2026"
  seq:  { type: Number, default: 0 }
});

docCounterSchema.statics.nextSeq = async function(type, year) {
  const key = `${type}-${year}`;
  const doc = await this.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return doc.seq;
};

module.exports = mongoose.model('DocCounter', docCounterSchema);
