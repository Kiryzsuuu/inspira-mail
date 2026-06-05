require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/inspira-mailer';

const ACCOUNTS = [
  {
    name: 'System Auditor',
    email: 'kiryzsu23@gmail.com',
    password: 'opet123',
    organization: 'System',
    jabatan: 'System Auditor',
  },
  {
    name: 'Health Check Security',
    email: 'opetdutton@gmail.com',
    password: 'opet123',
    organization: 'System',
    jabatan: 'Security Monitor',
  },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  const User = require('../models/User');

  for (const acc of ACCOUNTS) {
    const hashed = await bcrypt.hash(acc.password, 12);
    const existing = await User.findOne({ email: acc.email });

    if (existing) {
      existing.name         = acc.name;
      existing.password     = hashed;
      existing.role         = 'superadmin';
      existing.organization = acc.organization;
      existing.jabatan      = acc.jabatan;
      existing.isActive     = true;
      await existing.save();
      console.log(`✓ Diperbarui: ${acc.email}`);
    } else {
      await User.create({
        name: acc.name,
        email: acc.email,
        password: hashed,
        role: 'superadmin',
        organization: acc.organization,
        jabatan: acc.jabatan,
        isActive: true,
      });
      console.log(`✓ Dibuat: ${acc.email}`);
    }
  }

  console.log('Selesai.');
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
