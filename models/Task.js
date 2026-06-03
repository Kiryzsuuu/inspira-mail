const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  createdBy: {
    userId: mongoose.Schema.Types.ObjectId,
    name: String,
    email: String
  },
  assignedTo: [{
    userId: mongoose.Schema.Types.ObjectId,
    name: String,
    email: String
  }],
  pemberiTugas: { type: String, default: '', trim: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  priority: { type: String, enum: ['rendah', 'normal', 'tinggi', 'urgent'], default: 'normal' },
  status: { type: String, enum: ['pending', 'dikerjakan', 'selesai', 'dibatalkan'], default: 'pending' },
  dueDate: { type: Date },
  completedAt: { type: Date }
}, { timestamps: true });

taskSchema.index({ 'createdBy.userId': 1, createdAt: -1 });
taskSchema.index({ 'assignedTo.userId': 1, createdAt: -1 });
taskSchema.index({ status: 1 });

module.exports = mongoose.model('Task', taskSchema);
