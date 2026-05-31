require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/inspira-mailer';

async function seedAdmin() {
  await mongoose.connect(MONGO_URI);
  const User = require('../models/User');
  const ActivityLog = require('../models/ActivityLog');

  const email = 'maskiryz23@gmail.com';
  const password = 'opet123';
  const name = 'Administrator';
  const organization = 'Inspira Tekno';

  let user = await User.findOne({ email });

  if (user) {
    const hashed = await bcrypt.hash(password, 12);
    user.password = hashed;
    user.role = 'admin';
    user.isActive = true;
    user.name = user.name || name;
    await user.save();
    console.log(`✓ Admin sudah ada, kata sandi direset: ${email}`);
  } else {
    const hashed = await bcrypt.hash(password, 12);
    user = await User.create({
      name,
      email,
      password: hashed,
      role: 'admin',
      organization,
      isActive: true
    });
    console.log(`✓ Admin berhasil dibuat: ${email}`);
  }

  await ActivityLog.create({
    userId: user._id,
    userName: user.name,
    userEmail: user.email,
    userRole: 'admin',
    action: 'system',
    category: 'system',
    description: 'Akun admin diinisialisasi oleh sistem seed',
    status: 'success'
  });

  console.log('Selesai.');
  await mongoose.disconnect();
  process.exit(0);
}

seedAdmin().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
