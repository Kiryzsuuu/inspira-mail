const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName: String,
  userEmail: String,
  userRole: String,

  action: {
    type: String,
    enum: [
      'login',
      'logout',
      'login_failed',
      'register',
      'password_change',
      'password_reset_request',
      'password_reset',
      'profile_update',
      'avatar_update',
      'email_sent',
      'email_draft',
      'email_read',
      'email_deleted',
      'user_created',
      'user_updated',
      'user_deleted',
      'user_role_changed',
      'user_toggled',
      'system'
    ],
    required: true
  },

  category: {
    type: String,
    enum: ['auth', 'email', 'user_management', 'profile', 'system'],
    required: true
  },

  description: { type: String, required: true },

  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

  ipAddress: String,
  userAgent: String,

  status: { type: String, enum: ['success', 'failed', 'warning'], default: 'success' }

}, { timestamps: true });

activityLogSchema.index({ userId: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ category: 1, createdAt: -1 });
activityLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
