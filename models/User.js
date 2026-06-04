const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  enik:     { type: String, trim: true, default: '' },
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['user', 'direktur', 'admin'], default: 'user' },
  organization: { type: String, default: 'Inspira Tekno', trim: true },
  jabatan:  { type: String, trim: true },
  phone: { type: String, trim: true },
  bio: { type: String, trim: true },
  kodeDir: { type: String, enum: ['','KOM','DIR','PLAN','TECH','MP'], default: '' },
  avatar: String,
  resetToken: String,
  resetTokenExpiry: Date,
  lastLogin: Date,
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

userSchema.methods.matchPassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

userSchema.methods.getInitials = function() {
  return this.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
};

userSchema.methods.getRoleLabel = function() {
  const labels = { admin: 'Super Admin', direktur: 'Direktur / Komisaris', user: 'User' };
  return labels[this.role] || 'Pengguna';
};

userSchema.methods.canApprove = function() {
  return ['admin', 'direktur'].includes(this.role);
};

userSchema.methods.isAdmin = function() {
  return this.role === 'admin';
};

module.exports = mongoose.model('User', userSchema);
