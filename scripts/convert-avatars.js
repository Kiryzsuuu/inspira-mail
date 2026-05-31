/**
 * Converts all users with file-path avatars (/uploads/avatars/...)
 * to base64 stored directly in MongoDB.
 * Resizes to 200x200 JPEG (same as new upload pipeline).
 * Deletes local files after successful conversion.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const sharp    = require('sharp');
const fs       = require('fs');
const path     = require('path');

const ROOT = path.join(__dirname, '..');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('DB terhubung\n');

  const col = mongoose.connection.db.collection('users');
  const users = await col.find({ avatar: { $regex: '^/uploads/' } }).toArray();

  if (users.length === 0) {
    console.log('Tidak ada avatar lama yang perlu dikonversi.');
    await mongoose.disconnect();
    process.exit(0);
  }

  for (const u of users) {
    const filePath = path.join(ROOT, u.avatar);
    console.log(`Memproses: ${u.name} (${u.email})`);
    console.log(`  File: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      console.log('  ✗ File tidak ditemukan — avatar dihapus dari DB\n');
      await col.updateOne({ _id: u._id }, { $set: { avatar: null } });
      continue;
    }

    try {
      const buf = fs.readFileSync(filePath);
      const resized = await sharp(buf)
        .resize(200, 200, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();

      const base64 = 'data:image/jpeg;base64,' + resized.toString('base64');
      await col.updateOne({ _id: u._id }, { $set: { avatar: base64 } });

      const kb = Math.round(base64.length / 1024);
      console.log(`  ✓ Dikonversi ke base64 (${kb} KB) dan disimpan ke DB`);

      fs.unlinkSync(filePath);
      console.log('  ✓ File lokal dihapus\n');
    } catch (err) {
      console.error('  ✗ Gagal:', err.message, '\n');
    }
  }

  // Clean up uploads/avatars folder if empty
  const dir = path.join(ROOT, 'uploads', 'avatars');
  try {
    const remaining = fs.readdirSync(dir);
    if (remaining.length === 0) {
      fs.rmdirSync(dir);
      console.log('Folder uploads/avatars/ kosong dan dihapus.');
    } else {
      console.log(`Folder uploads/avatars/ masih ada ${remaining.length} file yang tidak terkonversi.`);
    }
  } catch (_) {}

  console.log('\nKonversi selesai.');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
