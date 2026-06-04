require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const User = require('./models/User');
const Email = require('./models/Email');
const ActivityLog = require('./models/ActivityLog');
const ShortUrl = require('./models/ShortUrl');
const Task = require('./models/Task');
const Signature = require('./models/Signature');
const Agreement = require('./models/Agreement');
const DocCounter = require('./models/DocCounter');
const SuratMasuk = require('./models/SuratMasuk');
const DocumentSignature = require('./models/DocumentSignature');
const SiteSettings = require('./models/SiteSettings');
const QRCode = require('qrcode');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/inspira-mailer';

app.use(session({
  secret: process.env.SESSION_SECRET || 'inspira-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI, touchAfter: 24 * 3600 }),
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB Atlas terhubung');
    // Drop index lama suratId_1 yang unique non-sparse (diganti sparse)
    try {
      await mongoose.connection.db.collection('documentsignatures').dropIndex('suratId_1');
      console.log('Index suratId_1 lama berhasil di-drop, akan dibuat ulang sebagai sparse.');
    } catch { /* index sudah tidak ada atau belum pernah dibuat */ }
  })
  .catch(err => console.error('MongoDB error:', err));

// ── LOGGING HELPER ──

async function log(req, action, category, description, metadata = {}, status = 'success') {
  try {
    const user = req?.user;
    await ActivityLog.create({
      userId: user?._id || null,
      userName: user?.name || metadata.name || 'System',
      userEmail: user?.email || metadata.email || '',
      userRole: user?.role || 'system',
      action,
      category,
      description,
      metadata,
      ipAddress: req?.ip || req?.connection?.remoteAddress || '',
      userAgent: req?.headers?.['user-agent'] || '',
      status
    });
  } catch (e) {
    // logging failures should never crash the app
  }
}

// ── MIDDLEWARE ──

app.use(async (req, res, next) => {
  res.locals.user = null;
  if (req.session.userId) {
    try {
      const user = await User.findById(req.session.userId).select('-password');
      if (user && user.isActive) {
        req.user = user;
        res.locals.user = user;
      } else {
        req.session.destroy(() => {});
      }
    } catch (e) {}
  }
  // Inject site settings ke semua view
  try {
    const ss = await SiteSettings.getSettings();
    res.locals.siteSettings = ss;
  } catch (e) {
    res.locals.siteSettings = {};
  }
  next();
});

// ── PUBLIC REDIRECT — harus sebelum semua route lain ──
app.get('/inspira/:code', async (req, res) => {
  try {
    const su = await ShortUrl.findOneAndUpdate(
      { shortCode: req.params.code, isActive: true },
      { $inc: { clicks: 1 } },
      { new: true }
    );
    if (!su) return res.status(404).send('URL tidak ditemukan atau sudah tidak aktif.');
    res.redirect(su.originalUrl);
  } catch (err) {
    res.status(500).send('Terjadi kesalahan.');
  }
});
app.get('/s/:code', (req, res) => res.redirect('/inspira/' + req.params.code));

function requireAuth(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

// Role hierarchy: admin > direktur > user
const ROLE_LEVEL = { admin: 3, direktur: 2, user: 1 };

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user || (ROLE_LEVEL[req.user.role] || 0) < (ROLE_LEVEL[minRole] || 0)) {
      return res.status(403).redirect('/inbox');
    }
    next();
  };
}

const requireAdmin = requireRole('admin');
const requireDirektur = requireRole('direktur');

// Multer for avatar — memory storage, resized then saved to MongoDB as base64
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Hanya file gambar yang diizinkan.'));
  }
});

async function processAvatar(buffer) {
  const resized = await sharp(buffer)
    .resize(200, 200, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return 'data:image/jpeg;base64,' + resized.toString('base64');
}

// Email transporter
let transporter = null;
if (process.env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// ── HELPERS ──

const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

function formatDate(d) {
  const date = new Date(d);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function formatDateTime(d) {
  const date = new Date(d);
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${h}:${m}`;
}

async function getMailCounts(userId) {
  const [inboxCount, draftCount] = await Promise.all([
    Email.countDocuments({
      'to.userId': userId,
      status: 'sent',
      deletedBy: { $ne: userId },
      readBy: { $not: { $elemMatch: { $eq: userId } } }
    }),
    Email.countDocuments({
      'from.userId': userId,
      status: 'draft',
      deletedBy: { $ne: userId }
    })
  ]);
  return { inboxCount, draftCount };
}

// ── AUTH ROUTES ──

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/inbox');
  res.render('login', { title: 'Masuk', error: null, savedEmail: '' });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email: email?.toLowerCase()?.trim() });
    if (!user || !(await user.matchPassword(password))) {
      await log(req, 'login_failed', 'auth', `Percobaan login gagal untuk email: ${email}`, { email }, 'failed');
      return res.render('login', { title: 'Masuk', error: 'Email atau kata sandi salah.', savedEmail: email });
    }
    if (!user.isActive) {
      await log(req, 'login_failed', 'auth', `Login ditolak - akun dinonaktifkan: ${email}`, { email }, 'failed');
      return res.render('login', { title: 'Masuk', error: 'Akun Anda telah dinonaktifkan.', savedEmail: email });
    }
    req.session.userId = user._id;
    user.lastLogin = new Date();
    await user.save();
    req.user = user;
    await log(req, 'login', 'auth', `${user.name} berhasil masuk ke sistem`, { role: user.role });
    const to = req.session.returnTo || '/inbox';
    delete req.session.returnTo;
    res.redirect(to);
  } catch (err) {
    console.error(err);
    res.render('login', { title: 'Masuk', error: 'Terjadi kesalahan, coba lagi.', savedEmail: email });
  }
});

app.get('/register', (req, res) => {
  if (req.user) return res.redirect('/inbox');
  res.render('register', { title: 'Daftar', error: null, data: {} });
});

app.post('/register', async (req, res) => {
  const { name, email, password, password2, organization } = req.body;
  const data = { name, email, organization };
  if (!name?.trim() || !email?.trim() || !password) {
    return res.render('register', { title: 'Daftar', error: 'Semua kolom wajib diisi.', data });
  }
  if (password !== password2) {
    return res.render('register', { title: 'Daftar', error: 'Kata sandi tidak cocok.', data });
  }
  if (password.length < 8) {
    return res.render('register', { title: 'Daftar', error: 'Kata sandi minimal 8 karakter.', data });
  }
  try {
    if (await User.findOne({ email: email.toLowerCase().trim() })) {
      return res.render('register', { title: 'Daftar', error: 'Email sudah terdaftar.', data });
    }
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashed,
      organization: organization?.trim() || 'Inspira Tekno',
      role: 'user'
    });
    req.session.userId = user._id;
    req.user = user;
    await log(req, 'register', 'auth', `Akun baru didaftarkan: ${user.name} (${user.email})`);
    res.redirect('/inbox');
  } catch (err) {
    console.error(err);
    res.render('register', { title: 'Daftar', error: 'Terjadi kesalahan, coba lagi.', data });
  }
});

app.get('/forgot-password', (req, res) => {
  if (req.user) return res.redirect('/inbox');
  res.render('forgot-password', { title: 'Lupa Kata Sandi', error: null, success: null });
});

app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email: email?.toLowerCase()?.trim() });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      user.resetToken = token;
      user.resetTokenExpiry = Date.now() + 3600000;
      await user.save();
      const resetUrl = `${process.env.APP_URL || 'http://localhost:3005'}/reset-password/${token}`;
      await log(req, 'password_reset_request', 'auth', `Permintaan reset kata sandi untuk: ${user.email}`, { email: user.email });
      if (transporter) {
        await transporter.sendMail({
          from: `"Inspira Mailer" <${process.env.SMTP_USER}>`,
          to: user.email,
          subject: 'Reset Kata Sandi — Inspira Mailer',
          html: `<p>Halo ${user.name},</p><p>Klik link berikut untuk mereset kata sandi Anda (berlaku 1 jam):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
        });
      } else {
        console.log('[Reset URL]', resetUrl);
      }
    }
    res.render('forgot-password', { title: 'Lupa Kata Sandi', error: null, success: 'Jika email terdaftar, link reset kata sandi telah dikirimkan.' });
  } catch (err) {
    console.error(err);
    res.render('forgot-password', { title: 'Lupa Kata Sandi', error: 'Terjadi kesalahan, coba lagi.', success: null });
  }
});

app.get('/reset-password/:token', async (req, res) => {
  try {
    const user = await User.findOne({ resetToken: req.params.token, resetTokenExpiry: { $gt: Date.now() } });
    if (!user) {
      return res.render('reset-password', { title: 'Reset Kata Sandi', error: 'Link tidak valid atau sudah kedaluwarsa.', token: null, success: null });
    }
    res.render('reset-password', { title: 'Reset Kata Sandi', error: null, token: req.params.token, success: null });
  } catch (err) {
    res.render('reset-password', { title: 'Reset Kata Sandi', error: 'Terjadi kesalahan.', token: null, success: null });
  }
});

app.post('/reset-password/:token', async (req, res) => {
  const { password, password2 } = req.body;
  try {
    const user = await User.findOne({ resetToken: req.params.token, resetTokenExpiry: { $gt: Date.now() } });
    if (!user) {
      return res.render('reset-password', { title: 'Reset Kata Sandi', error: 'Link tidak valid atau sudah kedaluwarsa.', token: null, success: null });
    }
    if (password !== password2) {
      return res.render('reset-password', { title: 'Reset Kata Sandi', error: 'Kata sandi tidak cocok.', token: req.params.token, success: null });
    }
    if (password.length < 8) {
      return res.render('reset-password', { title: 'Reset Kata Sandi', error: 'Kata sandi minimal 8 karakter.', token: req.params.token, success: null });
    }
    user.password = await bcrypt.hash(password, 12);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();
    req.user = user;
    await log(req, 'password_reset', 'auth', `Kata sandi berhasil direset untuk: ${user.email}`, { email: user.email });
    res.render('reset-password', { title: 'Reset Kata Sandi', error: null, token: null, success: 'Kata sandi berhasil diubah. Silakan masuk.' });
  } catch (err) {
    res.render('reset-password', { title: 'Reset Kata Sandi', error: 'Terjadi kesalahan.', token: req.params.token, success: null });
  }
});

app.get('/logout', requireAuth, async (req, res) => {
  await log(req, 'logout', 'auth', `${req.user.name} keluar dari sistem`);
  req.session.destroy(() => res.redirect('/login'));
});

// ── MAIN ROUTES ──

app.get('/', requireAuth, (req, res) => res.redirect('/inbox'));

app.get('/inbox', requireAuth, async (req, res) => {
  try {
    const mails = await Email.find({
      'to.userId': req.user._id,
      status: 'sent',
      deletedBy: { $ne: req.user._id }
    }).sort({ createdAt: -1 });

    const counts = await getMailCounts(req.user._id);
    const formatted = mails.map(m => ({
      _id: m._id,
      id: m._id,
      from: m.from.name,
      subject: m.subject,
      date: formatDate(m.createdAt),
      dateISO: m.createdAt ? new Date(m.createdAt).toISOString().slice(0,10) : '',
      tag: m.tag,
      berkas: m.berkas,
      jenis: m.jenis || 'internal',
      read: m.readBy.some(id => id.toString() === req.user._id.toString())
    }));

    res.render('inbox', { mails: formatted, active: 'inbox', title: 'Kotak Masuk', ...counts });
  } catch (err) {
    console.error(err);
    res.render('inbox', { mails: [], active: 'inbox', title: 'Kotak Masuk', inboxCount: 0, draftCount: 0 });
  }
});

app.get('/sent', requireAuth, async (req, res) => {
  try {
    const mails = await Email.find({
      'from.userId': req.user._id,
      status: 'sent',
      deletedBy: { $ne: req.user._id }
    }).sort({ createdAt: -1 });

    const counts = await getMailCounts(req.user._id);
    const formatted = mails.map(m => ({
      _id: m._id,
      id: m._id,
      to: m.to.map(t => t.name).join(', ') || (m.toExternal||[]).map(r=>r.name||r.email).join(', ') || '-',
      subject: m.subject,
      date: formatDate(m.createdAt),
      dateISO: m.createdAt ? new Date(m.createdAt).toISOString().slice(0,10) : '',
      tag: m.tag,
      berkas: m.berkas,
      jenis: m.jenis || 'internal'
    }));

    res.render('sent', { mails: formatted, active: 'sent', title: 'Terkirim', ...counts });
  } catch (err) {
    console.error(err);
    res.render('sent', { mails: [], active: 'sent', title: 'Terkirim', inboxCount: 0, draftCount: 0 });
  }
});

app.get('/draft', requireAuth, async (req, res) => {
  try {
    const mails = await Email.find({
      'from.userId': req.user._id,
      status: 'draft',
      deletedBy: { $ne: req.user._id }
    }).sort({ createdAt: -1 });

    const counts = await getMailCounts(req.user._id);
    res.render('draft', { mails, active: 'draft', title: 'Draf', formatDate, ...counts });
  } catch (err) {
    console.error(err);
    res.render('draft', { mails: [], active: 'draft', title: 'Draf', formatDate, inboxCount: 0, draftCount: 0 });
  }
});

// Edit draft — buka compose form dengan data yang sudah ada
app.get('/draft/:id/edit', requireAuth, async (req, res) => {
  try {
    const email = await Email.findById(req.params.id);
    if (!email || email.from.userId?.toString() !== req.user._id.toString())
      return res.redirect('/draft');
    const users  = await User.find({ _id: { $ne: req.user._id }, isActive: true }).select('name email organization').sort('name');
    const counts = await getMailCounts(req.user._id);
    res.render('draft-edit', { active: 'draft', title: 'Edit Draf', email, users, formatDate, ...counts });
  } catch (err) {
    console.error(err);
    res.redirect('/draft');
  }
});

// Update draft content
app.post('/draft/:id/update', requireAuth, async (req, res) => {
  try {
    const { to, cc, subject, body, tag, berkas, sifat, jenis, externalRecipients,
            kodeDiv, kodeLay, kodeDir, pengirimResmi, sumberTemplate, action } = req.body;
    const email = await Email.findById(req.params.id);
    if (!email || email.from.userId?.toString() !== req.user._id.toString())
      return res.json({ ok: false });

    const toIds = [].concat(to || []).filter(Boolean);
    const ccIds = [].concat(cc || []).filter(Boolean);
    const [toUsers, ccUsers] = await Promise.all([
      User.find({ _id: { $in: toIds } }).select('name email'),
      User.find({ _id: { $in: ccIds } }).select('name email')
    ]);
    let extRecipients = [];
    try { extRecipients = JSON.parse(externalRecipients || '[]'); } catch {}

    const ROMAN_M = ['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
    const seqPart = (email.nomorSurat || '').split('/')[0] || '001';
    const datePart = email.createdAt || new Date();
    const kd = kodeDir || kodeDiv || email.kodeDir || email.kodeDiv || 'DIR';
    const tipe = email.tipeSurat || 'Nota Dinas';
    const nomorSurat = buildNomorSurat(parseInt(seqPart), tipe, kd, jenis || email.jenis || 'internal',
      ROMAN_M[datePart.getMonth()+1], datePart.getFullYear());

    await Email.findByIdAndUpdate(email._id, {
      to:             toUsers.map(u => ({ userId: u._id, name: u.name, email: u.email })),
      cc:             ccUsers.map(u => ({ userId: u._id, name: u.name, email: u.email })),
      toExternal:     jenis === 'eksternal' ? extRecipients : [],
      subject:        subject?.trim() || '(Tanpa Subjek)',
      body:           body || '',
      tag:            tag || 'Normal',
      berkas:         berkas?.trim() || '',
      sifat:          sifat || 'Biasa/Terbuka',
      jenis:          jenis || 'internal',
      kodeDiv:        kodeDiv || email.kodeDiv || 'OPS',
      kodeLay:        kodeLay || email.kodeLay || 'INT',
      kodeDir:        kd,
      pengirimResmi:  pengirimResmi?.trim() || email.pengirimResmi || '',
      sumberTemplate: sumberTemplate || email.sumberTemplate || 'internal',
      nomorSurat
    });
    if (action === 'draft') {
      res.redirect('/compose');
    } else {
      res.redirect(`/email/${email._id}/preview`);
    }
  } catch (err) {
    console.error(err);
    res.redirect('/compose');
  }
});

// Delete single draft
app.delete('/draft/:id', requireAuth, async (req, res) => {
  try {
    const email = await Email.findById(req.params.id);
    if (!email || email.from.userId?.toString() !== req.user._id.toString())
      return res.json({ ok: false });
    await Email.findByIdAndDelete(email._id);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// Bulk delete drafts
app.post('/draft/bulk-delete', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.json({ ok: false });
    await Email.deleteMany({
      _id: { $in: ids },
      'from.userId': req.user._id,
      status: 'draft'
    });
    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    res.json({ ok: false });
  }
});

// Kode direktorat per spesifikasi
const KODE_DIR_MAP = {
  'KOM':'KOM','DIR':'DIR','PLAN':'PLAN','TECH':'TECH','MP':'MP'
};
// Dokumen khusus → nomor pakai tipe langsung
const TIPE_KHUSUS = ['MoU','MoA','Contract','IA','PKS','SPK'];

function buildNomorSurat(seq, tipeSurat, kodeDir, jenis, roman, year) {
  const s = String(seq).padStart(3,'0');
  if (TIPE_KHUSUS.includes(tipeSurat)) {
    return `${s}/${tipeSurat}/NIT/${roman}/${year}`;
  }
  const kd = KODE_DIR_MAP[kodeDir] || kodeDir || 'DIR';
  const ei = jenis === 'internal' ? 'I' : 'E';
  return `${s}/${kd}-${ei}/NIT/${roman}/${year}`;
}

// Manajemen Dokumen — Overview
app.get('/compose', requireAuth, async (req, res) => {
  try {
    const counts = await getMailCounts(req.user._id);
    const { q, tipe, status } = req.query;
    const userId = req.user._id;

    // Query Email dokumen milik user (sebagai pembuat)
    const filter = { 'from.userId': userId };
    if (tipe)   filter.tipeSurat = tipe;
    if (status) filter.status = status;
    if (q)      filter.$or = [
      { subject: { $regex: q, $options: 'i' } },
      { nomorSurat: { $regex: q, $options: 'i' } },
      { tipeSurat: { $regex: q, $options: 'i' } }
    ];

    const [docs, totalAll, totalDraft, totalSent] = await Promise.all([
      Email.find(filter).sort({ createdAt: -1 }).limit(100).lean(),
      Email.countDocuments({ 'from.userId': userId }),
      Email.countDocuments({ 'from.userId': userId, status: 'draft' }),
      Email.countDocuments({ 'from.userId': userId, status: 'sent' }),
    ]);

    res.render('dokumen-overview', {
      active: 'compose', title: 'Manajemen Dokumen',
      docs, totalAll, totalDraft, totalSent,
      q: q||'', tipe: tipe||'', status: status||'',
      formatDate, TIPE_KHUSUS, ...counts
    });
  } catch (err) {
    console.error(err);
    res.redirect('/inbox');
  }
});

// Manajemen Dokumen — Form buat dokumen baru
app.get('/compose/new', requireAuth, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id }, isActive: true }).select('name email organization enik jabatan').sort('name');
    const counts = await getMailCounts(req.user._id);
    res.render('compose', { active: 'compose', title: 'Buat Dokumen Baru', users, ...counts });
  } catch (err) {
    res.render('compose', { active: 'compose', title: 'Buat Dokumen Baru', users: [], inboxCount: 0, draftCount: 0 });
  }
});

app.post('/compose', requireAuth, async (req, res) => {
  const { to, cc, subject, body, tag, berkas, action, sifat, jenis, externalRecipients,
          tipeSurat, suratData, kodeDiv, kodeLay, sumberTemplate, pengirimResmi, kodeDir } = req.body;
  try {
    // Dokumen khusus hanya untuk direktur+admin
    if (TIPE_KHUSUS.includes(tipeSurat) && !['admin','direktur'].includes(req.user.role)) {
      return res.redirect('/compose?error=access');
    }

    const toIds = [].concat(to || []).filter(Boolean);
    const ccIds = [].concat(cc || []).filter(Boolean);
    const [toUsers, ccUsers] = await Promise.all([
      User.find({ _id: { $in: toIds } }).select('name email'),
      User.find({ _id: { $in: ccIds } }).select('name email')
    ]);

    let extRecipients = [];
    try { extRecipients = JSON.parse(externalRecipients || '[]'); } catch {}

    let parsedSuratData = {};
    try { parsedSuratData = JSON.parse(suratData || '{}'); } catch {}

    const now  = new Date();
    const year = now.getFullYear();
    const ROMAN_M = ['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
    const seq  = await DocCounter.nextSeq('SURAT', year);
    const tipe = tipeSurat || 'Nota Dinas';
    const nomorSurat = buildNomorSurat(seq, tipe, kodeDir || kodeDiv || 'DIR', jenis || 'internal', ROMAN_M[now.getMonth()+1], year);

    const isDraft = action === 'draft';
    const email = await Email.create({
      from:           { userId: req.user._id, name: req.user.name, email: req.user.email },
      to:             toUsers.map(u => ({ userId: u._id, name: u.name, email: u.email })),
      cc:             ccUsers.map(u => ({ userId: u._id, name: u.name, email: u.email })),
      toExternal:     jenis === 'eksternal' ? extRecipients : [],
      subject:        subject?.trim() || '(Tanpa Subjek)',
      body:           body || '',
      tag:            tag || 'Normal',
      berkas:         berkas?.trim() || '',
      sifat:          sifat || 'Biasa/Terbuka',
      jenis:          jenis || 'internal',
      tipeSurat:      tipe,
      sumberTemplate: sumberTemplate || 'internal',
      pengirimResmi:  pengirimResmi?.trim() || req.user.name,
      kodeDir:        kodeDir || kodeDiv || 'DIR',
      kodeDiv:        kodeDiv || 'OPS',
      kodeLay:        kodeLay || 'INT',
      suratData:      parsedSuratData,
      nomorSurat,
      status:         'draft'
    });

    await log(req, 'email_draft', 'email', `Surat dibuat: "${email.subject}"`, { emailId: email._id });

    if (isDraft) {
      res.redirect('/compose');          // kembali ke overview → draf terlihat
    } else {
      res.redirect(`/email/${email._id}/preview`);
    }
  } catch (err) {
    console.error(err);
    res.redirect('/compose/new');
  }
});

// ── EMAIL PREVIEW + SIGN + SEND ──

app.get('/email/:id/preview', requireAuth, async (req, res) => {
  try {
    const email = await Email.findById(req.params.id);
    if (!email) return res.redirect('/inbox');
    const uid = req.user._id.toString();
    const isSender = email.from.userId?.toString() === uid;

    // Izinkan juga co-signer yang diundang
    const docSig = await DocumentSignature.findOne({ emailId: email._id });
    const isPendingCosigner = docSig?.signers.some(
      s => s.userId.toString() === uid && s.status === 'pending'
    );

    if (!isSender && !isPendingCosigner) return res.redirect('/inbox');

    const [users, counts] = await Promise.all([
      User.find({ isActive: true }, 'name email role organization _id').sort({ name: 1 }),
      getMailCounts(req.user._id)
    ]);
    res.render('email-preview', {
      title: 'Preview & Tanda Tangan', email,
      docSig: docSig || { signers: [] },
      isSender, isPendingCosigner,
      currentUser: req.user, users, formatDate, ...counts
    });
  } catch (err) { console.error(err); res.redirect('/inbox'); }
});

// Tambah diri sendiri — langsung generate QR
app.post('/email/:id/sign/add-self', requireAuth, async (req, res) => {
  try {
    const email = await Email.findById(req.params.id);
    if (!email) return res.json({ ok: false, message: 'Surat tidak ditemukan.' });

    // Hanya pengirim atau co-signer yang diundang boleh tanda tangan sendiri
    const uid = req.user._id.toString();
    const isSender = email.from.userId?.toString() === uid;

    let docSig = await DocumentSignature.findOne({ emailId: email._id });
    if (!docSig) {
      if (!isSender) return res.json({ ok: false, message: 'Anda tidak memiliki akses.' });
      docSig = new DocumentSignature({ emailId: email._id, createdBy: req.user._id, signers: [] });
    }

    const existing = docSig.signers.find(s => s.userId.toString() === uid);
    if (existing && existing.status === 'signed') return res.json({ ok: false, message: 'Anda sudah menandatangani.' });
    if (existing && existing.status === 'pending') {
      // Co-signer menandatangani dirinya sendiri
    } else if (isSender) {
      // Pengirim menambah dirinya
    } else {
      return res.json({ ok: false, message: 'Anda tidak diundang sebagai penandatangan.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`;
    const qrDataUrl = await QRCode.toDataURL(`${appUrl}/verify/doc/${token}`, {
      errorCorrectionLevel: 'H', margin: 2, width: 200, color: { dark: '#000000', light: '#ffffff' }
    });

    if (existing) {
      // Update pending → signed
      await DocumentSignature.updateOne(
        { emailId: email._id, 'signers._id': existing._id },
        { $set: { 'signers.$.token': token, 'signers.$.qrDataUrl': qrDataUrl, 'signers.$.status': 'signed', 'signers.$.signedAt': new Date() } }
      );
      await docSig.populate('signers');
      const updated = (await DocumentSignature.findOne({ emailId: email._id })).signers.id(existing._id);
      return res.json({ ok: true, signer: updated, action: 'updated' });
    }

    // Pengirim menambah dirinya pertama kali
    const n = docSig.signers.length;
    docSig.signers.push({
      userId: req.user._id, userName: req.user.name,
      userRole: req.user.role || '', userOrg: req.user.organization || '',
      jabatanDisplay: req.user.jabatan || '',
      token, qrDataUrl, status: 'signed', signedAt: new Date(),
      position: { x: 60 + n * 140, y: 640, width: 120, height: 185 }
    });
    await docSig.save();
    res.json({ ok: true, signer: docSig.signers[docSig.signers.length - 1], action: 'added' });
  } catch (err) { console.error(err); res.json({ ok: false, message: 'Gagal.' }); }
});

// Undang co-signer — hanya buat entri pending, TANPA QR
app.post('/email/:id/sign/invite-cosigner', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    const email = await Email.findById(req.params.id);
    if (!email) return res.json({ ok: false, message: 'Surat tidak ditemukan.' });
    if (email.from.userId?.toString() !== req.user._id.toString())
      return res.json({ ok: false, message: 'Hanya pengirim yang bisa mengundang co-signer.' });

    const targetUser = await User.findById(userId);
    if (!targetUser) return res.json({ ok: false, message: 'Pengguna tidak ditemukan.' });

    let docSig = await DocumentSignature.findOne({ emailId: email._id });
    if (!docSig) docSig = new DocumentSignature({ emailId: email._id, createdBy: req.user._id, signers: [] });
    if (docSig.signers.some(s => s.userId.toString() === userId.toString()))
      return res.json({ ok: false, message: 'Penandatangan sudah diundang.' });

    const n = docSig.signers.length;
    docSig.signers.push({
      userId: targetUser._id, userName: targetUser.name,
      userRole: targetUser.role || '', userOrg: targetUser.organization || '',
      jabatanDisplay: targetUser.jabatan || '',
      token: '', qrDataUrl: '', status: 'pending',
      position: { x: 60 + n * 140, y: 640, width: 120, height: 185 }
    });
    await docSig.save();
    res.json({ ok: true, signer: docSig.signers[docSig.signers.length - 1] });
  } catch (err) { console.error(err); res.json({ ok: false, message: 'Gagal.' }); }
});

app.post('/email/:id/sign/update-position', requireAuth, async (req, res) => {
  try {
    const { signerId, x, y, width, height } = req.body;
    await DocumentSignature.updateOne(
      { emailId: req.params.id, 'signers._id': signerId },
      { $set: { 'signers.$.position': { x, y, width, height } } }
    );
    res.json({ ok: true });
  } catch { res.json({ ok: false }); }
});

app.post('/email/:id/sign/update-jabatan', requireAuth, async (req, res) => {
  try {
    const { signerId, jabatan } = req.body;
    await DocumentSignature.updateOne(
      { emailId: req.params.id, 'signers._id': signerId },
      { $set: { 'signers.$.jabatanDisplay': jabatan || '' } }
    );
    res.json({ ok: true });
  } catch { res.json({ ok: false }); }
});

app.post('/email/:id/sign/update-display-mode', requireAuth, async (req, res) => {
  try {
    const { signerId, displayMode } = req.body;
    const valid = ['full','name_only','qr_only'];
    if (!valid.includes(displayMode)) return res.json({ ok: false, message: 'Mode tidak valid.' });
    await DocumentSignature.updateOne(
      { emailId: req.params.id, 'signers._id': signerId },
      { $set: { 'signers.$.displayMode': displayMode } }
    );
    res.json({ ok: true });
  } catch { res.json({ ok: false }); }
});

app.post('/surat-masuk/:id/pdf/update-jabatan', requireAuth, async (req, res) => {
  try {
    const { signerId, jabatan } = req.body;
    await DocumentSignature.updateOne(
      { suratId: req.params.id, 'signers._id': signerId },
      { $set: { 'signers.$.jabatanDisplay': jabatan || '' } }
    );
    res.json({ ok: true });
  } catch { res.json({ ok: false }); }
});

app.delete('/email/:id/sign/signers/:signerId', requireAuth, async (req, res) => {
  try {
    const docSig = await DocumentSignature.findOne({ emailId: req.params.id });
    if (!docSig) return res.json({ ok: false });
    const signer = docSig.signers.id(req.params.signerId);
    const wasCurrentUser = signer?.userId?.toString() === req.user._id.toString();
    await DocumentSignature.updateOne({ emailId: req.params.id }, { $pull: { signers: { _id: req.params.signerId } } });
    res.json({ ok: true, wasCurrentUser });
  } catch { res.json({ ok: false }); }
});

app.post('/email/:id/send', requireAuth, async (req, res) => {
  try {
    const email = await Email.findById(req.params.id);
    if (!email) return res.json({ ok: false, message: 'Surat tidak ditemukan.' });
    if (email.from.userId.toString() !== req.user._id.toString()) return res.json({ ok: false });
    if (email.status === 'sent') return res.json({ ok: false, message: 'Surat sudah dikirim.' });

    await Email.findByIdAndUpdate(email._id, { status: 'sent' });

    const allEmails = [
      ...email.to.map(r => r.email), ...email.cc.map(r => r.email),
      ...(email.toExternal||[]).map(r => r.email)
    ].filter(Boolean);

    if (transporter && allEmails.length > 0) {
      const _ss = await SiteSettings.getSettings();
      const mailerName = _ss.mailerName || (_ss.siteName + ' ' + _ss.siteSub).trim() || 'Inspira Mailer';
      const recipientNames = [
        ...email.to.map(r => r.name),
        ...(email.toExternal||[]).map(r => r.name || r.email)
      ].join(', ') || '-';
      const sifatColor = {'Biasa/Terbuka':'#16a34a','Rahasia':'#9333ea','Terbatas':'#d97706','Segera':'#dc2626'}[email.sifat]||'#6b7280';
      const tgl = new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});

      const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;">
        <div style="background:#071840;padding:24px 32px;border-radius:8px 8px 0 0;">
          <div style="color:#fff;font-size:18px;font-weight:700;">${mailerName}</div>
          <div style="color:rgba(255,255,255,.6);font-size:12px;margin-top:2px;">Sistem Surat Digital</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;padding:32px;border-radius:0 0 8px 8px;background:#fff;">
          <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #f1f5f9;">
            <span style="background:#f0f5ff;color:#1a56a8;border:1px solid #bfcfed;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-right:6px;">${email.jenis === 'internal' ? 'Internal' : 'Eksternal'}</span>
            <span style="background:${sifatColor}20;color:${sifatColor};border:1px solid ${sifatColor}40;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600;">${email.sifat}</span>
          </div>
          <p style="font-size:12px;color:#94a3b8;margin:0 0 6px;">No. Surat: <strong>${email.nomorSurat}</strong></p>
          <h2 style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 20px;">${email.subject}</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;">
            <tr><td style="padding:5px 0;color:#94a3b8;width:90px;">Dari</td><td style="padding:5px 0;color:#0f172a;font-weight:500;">${email.from.name} &lt;${email.from.email}&gt;</td></tr>
            <tr><td style="padding:5px 0;color:#94a3b8;">Kepada</td><td style="padding:5px 0;color:#0f172a;">${recipientNames}</td></tr>
            <tr><td style="padding:5px 0;color:#94a3b8;">Tanggal</td><td style="padding:5px 0;color:#0f172a;">${tgl}</td></tr>
            ${email.berkas ? `<tr><td style="padding:5px 0;color:#94a3b8;">Berkas</td><td style="padding:5px 0;color:#0f172a;">${email.berkas}</td></tr>` : ''}
          </table>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px 24px;font-size:14px;line-height:1.8;color:#334155;">
            ${email.body || '<em>Tidak ada isi surat.</em>'}
          </div>
          <p style="font-size:11px;color:#94a3b8;margin-top:24px;padding-top:12px;border-top:1px solid #f1f5f9;">
            Dikirim melalui <strong>${mailerName}</strong> &middot; Nomor: ${email.nomorSurat}
          </p>
        </div></div>`;

      await transporter.sendMail({
        from: `"${email.from.name} via ${mailerName}" <${process.env.SMTP_USER}>`,
        to: allEmails.join(', '),
        replyTo: email.from.email,
        subject: `[${email.nomorSurat}] ${email.subject}`,
        html: htmlBody
      });
    }

    const toNames = [...email.to.map(r=>r.name),...(email.toExternal||[]).map(r=>r.name||r.email)].join(', ')||'-';
    await log(req, 'email_sent', 'email', `Surat dikirim kepada ${toNames}: "${email.subject}"`, { nomorSurat: email.nomorSurat });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.json({ ok: false, message: 'Gagal mengirim.' }); }
});

// Email detail
app.get('/email/:id', requireAuth, async (req, res) => {
  try {
    const email = await Email.findById(req.params.id);
    if (!email) return res.redirect('/inbox');
    const isSender   = email.from.userId?.toString() === req.user._id.toString();
    const isReceiver = email.to.some(t => t.userId?.toString() === req.user._id.toString())
                    || email.cc.some(t => t.userId?.toString() === req.user._id.toString());
    if (!isSender && !isReceiver) return res.redirect('/inbox');
    if (isReceiver && !email.readBy.map(String).includes(String(req.user._id))) {
      await Email.findByIdAndUpdate(email._id, { $addToSet: { readBy: req.user._id } });
    }
    const docSig = await DocumentSignature.findOne({ emailId: email._id });
    const counts = await getMailCounts(req.user._id);
    res.render('email-detail', {
      title: email.subject, active: isSender ? 'sent' : 'inbox',
      email, docSig: docSig || { signers: [] },
      isSender, currentUser: req.user,
      formatDate, formatDateTime, ...counts
    });
  } catch (err) { console.error(err); res.redirect('/inbox'); }
});

// Mark email read
app.post('/email/:id/read', requireAuth, async (req, res) => {
  try {
    const email = await Email.findByIdAndUpdate(req.params.id, { $addToSet: { readBy: req.user._id } }, { new: true });
    if (email) {
      await log(req, 'email_read', 'email', `Surat dibaca: "${email.subject}"`, { emailId: email._id, subject: email.subject });
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ── PROFILE ──

app.get('/profile', requireAuth, async (req, res) => {
  const counts = await getMailCounts(req.user._id);
  res.render('profile', { active: 'profile', title: 'Profil Saya', success: null, error: null, ...counts });
});

app.post('/profile', requireAuth, async (req, res) => {
  const { name, organization, jabatan, phone, bio, enik } = req.body;
  const counts = await getMailCounts(req.user._id);
  try {
    if (!name?.trim()) {
      return res.render('profile', { active: 'profile', title: 'Profil Saya', success: null, error: 'Nama tidak boleh kosong.', ...counts });
    }
    await User.findByIdAndUpdate(req.user._id, {
      enik: enik?.trim() || '',
      name: name.trim(),
      organization: organization?.trim() || 'Inspira Tekno',
      jabatan: jabatan?.trim() || '',
      phone: phone?.trim() || '',
      bio: bio?.trim() || ''
    });
    await log(req, 'profile_update', 'profile', `${req.user.name} memperbarui profil`);
    const updated = await User.findById(req.user._id).select('-password');
    req.user = updated;
    res.locals.user = updated;
    res.render('profile', { active: 'profile', title: 'Profil Saya', success: 'Profil berhasil diperbarui.', error: null, ...counts });
  } catch (err) {
    res.render('profile', { active: 'profile', title: 'Profil Saya', success: null, error: 'Gagal memperbarui profil.', ...counts });
  }
});

app.post('/profile/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const counts = await getMailCounts(req.user._id);
  const fail = async (msg) => {
    await log(req, 'password_change', 'profile', `Gagal mengubah kata sandi: ${msg}`, {}, 'failed');
    res.render('profile', { active: 'profile', title: 'Profil Saya', success: null, error: msg, ...counts });
  };
  try {
    const user = await User.findById(req.user._id);
    if (!(await user.matchPassword(currentPassword))) return fail('Kata sandi lama salah.');
    if (newPassword !== confirmPassword) return fail('Konfirmasi kata sandi tidak cocok.');
    if (newPassword.length < 8) return fail('Kata sandi minimal 8 karakter.');
    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    await log(req, 'password_change', 'profile', `${req.user.name} berhasil mengubah kata sandi`);
    res.render('profile', { active: 'profile', title: 'Profil Saya', success: 'Kata sandi berhasil diubah.', error: null, ...counts });
  } catch (err) {
    fail('Terjadi kesalahan.');
  }
});

app.post('/profile/avatar', requireAuth, (req, res) => {
  upload.single('avatar')(req, res, async (err) => {
    const counts = await getMailCounts(req.user._id);
    if (err) {
      return res.render('profile', {
        active: 'profile', title: 'Profil Saya',
        success: null, error: err.message, ...counts
      });
    }
    if (!req.file) return res.redirect('/profile');
    try {
      const base64 = await processAvatar(req.file.buffer);
      await User.findByIdAndUpdate(req.user._id, { avatar: base64 });
      await log(req, 'avatar_update', 'profile', `${req.user.name} memperbarui foto profil`);
    } catch (e) {
      console.error('Avatar processing error:', e.message);
    }
    res.redirect('/profile');
  });
});

// ── SITE SETTINGS ──

app.get('/admin/site-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const ss = await SiteSettings.getSettings();
    const counts = await getMailCounts(req.user._id);
    res.render('site-settings', { active: 'admin', title: 'Pengaturan Situs', ss, success: null, error: null, ...counts });
  } catch (err) {
    console.error(err);
    res.redirect('/admin');
  }
});

const ssUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

app.post('/admin/site-settings', requireAuth, requireAdmin, ssUpload.single('logo'), async (req, res) => {
  try {
    const ss = await SiteSettings.getSettings();
    const counts = await getMailCounts(req.user._id);
    const { siteName, siteSub, siteTagline, siteDesc, orgCode, mailerName, smtpHost, smtpPort, smtpUser, smtpPass } = req.body;

    ss.siteName    = siteName?.trim()    || ss.siteName;
    ss.siteSub     = siteSub?.trim()     || ss.siteSub;
    ss.siteTagline = siteTagline?.trim() !== undefined ? siteTagline.trim() : ss.siteTagline;
    ss.siteDesc    = siteDesc?.trim()    !== undefined ? siteDesc.trim()    : ss.siteDesc;
    ss.orgCode     = orgCode?.trim()     || ss.orgCode;
    if (mailerName?.trim()) ss.mailerName = mailerName.trim();
    ss.smtpHost = smtpHost?.trim() || ss.smtpHost;
    ss.smtpPort = parseInt(smtpPort) || ss.smtpPort;
    ss.smtpUser = smtpUser?.trim() || ss.smtpUser;
    if (smtpPass?.trim()) ss.smtpPass = smtpPass.trim();

    if (req.file) {
      const resized = await sharp(req.file.buffer).resize(200, 200, { fit: 'inside' }).png().toBuffer();
      ss.logoBase64 = 'data:image/png;base64,' + resized.toString('base64');
    }

    await ss.save();

    // Update transporter SMTP setelah save
    if (ss.smtpUser && ss.smtpPass) {
      transporter = nodemailer.createTransport({
        host: ss.smtpHost, port: ss.smtpPort,
        auth: { user: ss.smtpUser, pass: ss.smtpPass }
      });
    }

    res.render('site-settings', { active: 'admin', title: 'Pengaturan Situs', ss, success: 'Pengaturan berhasil disimpan.', error: null, ...counts });
  } catch (err) {
    console.error(err);
    const ss = await SiteSettings.getSettings();
    const counts = await getMailCounts(req.user._id);
    res.render('site-settings', { active: 'admin', title: 'Pengaturan Situs', ss, success: null, error: 'Gagal menyimpan.', ...counts });
  }
});

// ── ADMIN ──

app.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [totalUsers, totalSent, totalDraft, users, recentLogs] = await Promise.all([
      User.countDocuments(),
      Email.countDocuments({ status: 'sent' }),
      Email.countDocuments({ status: 'draft' }),
      User.find().sort({ createdAt: -1 }).select('-password'),
      ActivityLog.find().sort({ createdAt: -1 }).limit(50).lean()
    ]);
    const counts = await getMailCounts(req.user._id);

    const logsFormatted = recentLogs.map(l => ({
      ...l,
      dateTime: formatDateTime(l.createdAt)
    }));

    res.render('admin', {
      active: 'admin',
      title: 'Admin Dashboard',
      stats: { totalUsers, totalSent, totalDraft, totalEmails: totalSent + totalDraft },
      users,
      logs: logsFormatted,
      ROLE_LEVEL,
      ...counts
    });
  } catch (err) {
    console.error(err);
    res.redirect('/inbox');
  }
});

// API: get more logs
// Log Penomoran Surat
app.get('/log-penomoran', requireAuth, async (req, res) => {
  try {
    const counts = await getMailCounts(req.user._id);
    const q = req.query.q || '';
    const filter = { nomorSurat: { $exists: true, $ne: '' } };
    if (q) filter.$or = [
      { nomorSurat: { $regex: q, $options: 'i' } },
      { subject: { $regex: q, $options: 'i' } },
      { tipeSurat: { $regex: q, $options: 'i' } }
    ];
    const docs = await Email.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.render('log-penomoran', { active: 'log-penomoran', title: 'Log Penomoran', docs, q, formatDate, ...counts });
  } catch (err) {
    console.error(err);
    res.redirect('/inbox');
  }
});

app.get('/admin/logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.userId) filter.userId = req.query.userId;

    const [logs, total] = await Promise.all([
      ActivityLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ActivityLog.countDocuments(filter)
    ]);

    res.json({
      ok: true,
      logs: logs.map(l => ({ ...l, dateTime: formatDateTime(l.createdAt) })),
      total,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.post('/admin/users/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.json({ ok: false, message: 'Tidak dapat menonaktifkan diri sendiri.' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.json({ ok: false, message: 'Pengguna tidak ditemukan.' });
    target.isActive = !target.isActive;
    await target.save();
    await log(req, 'user_toggled', 'user_management',
      `Admin ${req.user.name} ${target.isActive ? 'mengaktifkan' : 'menonaktifkan'} akun ${target.name} (${target.email})`,
      { targetId: target._id, targetEmail: target.email, isActive: target.isActive }
    );
    res.json({ ok: true, isActive: target.isActive });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.post('/admin/users/:id/role', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'direktur', 'admin'].includes(role)) return res.json({ ok: false, message: 'Role tidak valid.' });
    if (req.params.id === req.user._id.toString()) {
      return res.json({ ok: false, message: 'Tidak dapat mengubah role diri sendiri.' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.json({ ok: false, message: 'Pengguna tidak ditemukan.' });
    const oldRole = target.role;
    await User.findByIdAndUpdate(req.params.id, { role });
    await log(req, 'user_role_changed', 'user_management',
      `Admin ${req.user.name} mengubah role ${target.name} dari "${oldRole}" menjadi "${role}"`,
      { targetId: target._id, targetEmail: target.email, oldRole, newRole: role }
    );
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.post('/admin/users/:id/enik', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enik, jabatan } = req.body;
    const target = await User.findById(req.params.id);
    if (!target) return res.json({ ok: false, message: 'Pengguna tidak ditemukan.' });
    await User.findByIdAndUpdate(req.params.id, {
      enik: enik?.trim() || '',
      jabatan: jabatan?.trim() || ''
    });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.delete('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.json({ ok: false, message: 'Tidak dapat menghapus diri sendiri.' });
    }
    const target = await User.findByIdAndDelete(req.params.id);
    if (!target) return res.json({ ok: false, message: 'Pengguna tidak ditemukan.' });
    await log(req, 'user_deleted', 'user_management',
      `Admin ${req.user.name} menghapus akun ${target.name} (${target.email})`,
      { targetEmail: target.email, targetRole: target.role }
    );
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// ── DIREKTUR ROUTES ──
// Direktur and admin can see all emails (organization-wide view)
app.get('/direktur/overview', requireAuth, requireDirektur, async (req, res) => {
  try {
    const counts = await getMailCounts(req.user._id);
    const [allSent, allDraft, allUsers] = await Promise.all([
      Email.find({ status: 'sent' }).sort({ createdAt: -1 }).limit(20).lean(),
      Email.find({ status: 'draft' }).sort({ createdAt: -1 }).limit(10).lean(),
      User.countDocuments()
    ]);

    const sentFormatted = allSent.map(m => ({
      ...m,
      fromName: m.from?.name || '-',
      toNames: (m.to || []).map(t => t.name).join(', ') || '-',
      date: formatDate(m.createdAt),
      dateISO: m.createdAt ? new Date(m.createdAt).toISOString().slice(0,10) : ''
    }));

    res.render('direktur', {
      active: 'direktur',
      title: 'Ringkasan Organisasi',
      sentMails: sentFormatted,
      draftCount: allDraft.length,
      totalUsers: allUsers,
      ...counts
    });
  } catch (err) {
    console.error(err);
    res.redirect('/inbox');
  }
});

// ── SHORT URL ──

function generateCode(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}


app.get('/shorturl', requireAuth, async (req, res) => {
  try {
    const urls = await ShortUrl.find({ userId: req.user._id }).sort({ createdAt: -1 });
    const counts = await getMailCounts(req.user._id);
    res.render('shorturl', { active: 'shorturl', title: 'Short URL', urls, error: null, success: null, ...counts });
  } catch (err) {
    res.render('shorturl', { active: 'shorturl', title: 'Short URL', urls: [], error: null, success: null, inboxCount: 0, draftCount: 0 });
  }
});

app.post('/shorturl', requireAuth, async (req, res) => {
  const { originalUrl, title, customSlug } = req.body;
  const counts = await getMailCounts(req.user._id);
  const fail = async (msg) => {
    const urls = await ShortUrl.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.render('shorturl', { active: 'shorturl', title: 'Short URL', urls, error: msg, success: null, ...counts });
  };
  try {
    if (!originalUrl?.trim()) return fail('URL tidak boleh kosong.');
    let url = originalUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    let shortCode;
    if (customSlug?.trim()) {
      shortCode = customSlug.trim().toLowerCase().replace(/[^a-z0-9\-_]/g, '-');
      if (shortCode.length < 3) return fail('Custom nama minimal 3 karakter.');
      const exists = await ShortUrl.findOne({ shortCode });
      if (exists) return fail(`Nama "${shortCode}" sudah digunakan. Pilih nama lain.`);
    } else {
      let exists = true;
      while (exists) { shortCode = generateCode(6); exists = await ShortUrl.findOne({ shortCode }); }
    }

    await ShortUrl.create({
      userId: req.user._id,
      userName: req.user.name,
      originalUrl: url,
      shortCode,
      title: title?.trim() || url
    });

    await log(req, 'system', 'system', `Short URL dibuat: /inspira/${shortCode} -> ${url}`);
    const urls = await ShortUrl.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.render('shorturl', { active: 'shorturl', title: 'Short URL', urls, error: null, success: `Short URL berhasil dibuat: /s/${shortCode}`, ...counts });
  } catch (err) {
    console.error(err);
    fail('Terjadi kesalahan, coba lagi.');
  }
});

app.delete('/shorturl/:id', requireAuth, async (req, res) => {
  try {
    await ShortUrl.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.post('/shorturl/:id/toggle', requireAuth, async (req, res) => {
  try {
    const su = await ShortUrl.findOne({ _id: req.params.id, userId: req.user._id });
    if (!su) return res.json({ ok: false });
    su.isActive = !su.isActive;
    await su.save();
    res.json({ ok: true, isActive: su.isActive });
  } catch (err) {
    res.json({ ok: false });
  }
});

// ── TUGAS ──

app.get('/tugas', requireAuth, async (req, res) => {
  try {
    const myId = req.user._id;
    const [myTasks, assignedTasks, users] = await Promise.all([
      Task.find({ 'createdBy.userId': myId }).sort({ createdAt: -1 }),
      Task.find({ 'assignedTo.userId': myId, 'createdBy.userId': { $ne: myId } }).sort({ createdAt: -1 }),
      User.find({ _id: { $ne: myId }, isActive: true }).select('name email').sort('name')
    ]);
    const counts = await getMailCounts(myId);
    const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const fmt = (d) => d ? `${new Date(d).getDate()} ${MONTHS[new Date(d).getMonth()]} ${new Date(d).getFullYear()}` : null;
    const format = tasks => tasks.map(t => ({ ...t.toObject(), dueDateFmt: fmt(t.dueDate) }));
    res.render('tugas', {
      active: 'tugas', title: 'Tugas',
      myTasks: format(myTasks),
      assignedTasks: format(assignedTasks),
      users,
      ...counts
    });
  } catch (err) {
    console.error(err);
    res.render('tugas', { active: 'tugas', title: 'Tugas', myTasks: [], assignedTasks: [], users: [], inboxCount: 0, draftCount: 0 });
  }
});

app.post('/tugas', requireAuth, async (req, res) => {
  const { title, description, priority, dueDate, assignedTo, pemberiTugas, pemberiTugasCustom } = req.body;
  try {
    const toIds = [].concat(assignedTo || []).filter(Boolean);
    const assignedUsers = await User.find({ _id: { $in: toIds } }).select('name email');
    const pemberi = pemberiTugas === 'lainnya' ? (pemberiTugasCustom?.trim() || '') : (pemberiTugas?.trim() || '');
    const task = await Task.create({
      createdBy: { userId: req.user._id, name: req.user.name, email: req.user.email },
      assignedTo: assignedUsers.map(u => ({ userId: u._id, name: u.name, email: u.email })),
      pemberiTugas: pemberi,
      title: title?.trim(),
      description: description?.trim() || '',
      priority: priority || 'normal',
      dueDate: dueDate ? new Date(dueDate) : null
    });
    await log(req, 'system', 'system', `Tugas dibuat: "${task.title}"`, { taskId: task._id });
    res.redirect('/tugas');
  } catch (err) {
    console.error(err);
    res.redirect('/tugas');
  }
});

app.post('/tugas/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['pending', 'dikerjakan', 'selesai', 'dibatalkan'];
    if (!valid.includes(status)) return res.json({ ok: false });
    const task = await Task.findOne({
      _id: req.params.id,
      $or: [{ 'createdBy.userId': req.user._id }, { 'assignedTo.userId': req.user._id }]
    });
    if (!task) return res.json({ ok: false, message: 'Tugas tidak ditemukan.' });
    task.status = status;
    if (status === 'selesai') task.completedAt = new Date();
    await task.save();
    res.json({ ok: true, status });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.delete('/tugas/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOneAndDelete({ _id: req.params.id, 'createdBy.userId': req.user._id });
    if (!task) return res.json({ ok: false, message: 'Hanya pembuat yang bisa menghapus tugas.' });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// ── DIGSIG ──

app.get('/digsig', requireAuth, async (req, res) => {
  try {
    const sig = await Signature.findOne({ userId: req.user._id });
    const counts = await getMailCounts(req.user._id);
    res.render('digsig', { active: 'digsig', title: 'Tanda Tangan Digital', sig, success: null, ...counts });
  } catch (err) {
    res.render('digsig', { active: 'digsig', title: 'Tanda Tangan Digital', sig: null, success: null, inboxCount: 0, draftCount: 0 });
  }
});

// Generate new QR — every call invalidates the old one
app.post('/digsig/generate', requireAuth, async (req, res) => {
  try {
    const { fullName, position, organization, locationLabel, lat, lng } = req.body;
    if (!fullName?.trim()) return res.json({ ok: false, message: 'Nama lengkap wajib diisi.' });

    // New unique token every time — old QR instantly invalid
    const token = crypto.randomBytes(32).toString('hex');
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`;
    const verifyUrl = `${appUrl}/verify/${token}`;

    const qrCodeDataUrl = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 320,
      color: { dark: '#000000', light: '#ffffff' }
    });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
              || req.socket?.remoteAddress || '';

    await Signature.findOneAndUpdate(
      { userId: req.user._id },
      {
        $set: {
          userId: req.user._id,
          fullName: fullName.trim(),
          position: position?.trim() || '',
          organization: organization?.trim() || req.user.organization || '',
          verifyToken: token,
          qrCodeDataUrl,
          signedAt: new Date(),
          imageData: null,
          imagePath: null,
          location: {
            label: locationLabel?.trim() || '',
            lat:   lat  ? parseFloat(lat)  : null,
            lng:   lng  ? parseFloat(lng)  : null,
            ipAddress: ip
          }
        }
      },
      { upsert: true, new: true }
    );

    await log(req, 'system', 'profile',
      `${req.user.name} membuat QR tanda tangan digital baru`,
      { token: token.slice(0, 8) + '...' }
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, message: 'Gagal membuat QR Code.' });
  }
});

app.delete('/digsig', requireAuth, async (req, res) => {
  try {
    await Signature.findOneAndDelete({ userId: req.user._id });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// ── VERIFY (public) ──

// PENTING: route /verify/doc/:token harus SEBELUM /verify/:token
// agar Express tidak salah cocokkan "doc" sebagai :token
app.get('/verify/doc/:token', async (req, res) => {
  try {
    const docSig = await DocumentSignature.findOne({ 'signers.token': req.params.token });
    if (!docSig) {
      return res.render('verify-doc', { title: 'Verifikasi Dokumen', valid: false, signer: null, surat: null, scanTime: new Date() });
    }
    const signer = docSig.signers.find(s => s.token === req.params.token);
    const surat  = await SuratMasuk.findById(docSig.suratId);
    res.render('verify-doc', { title: 'Verifikasi Dokumen', valid: true, signer, surat, scanTime: new Date() });
  } catch (err) {
    res.render('verify-doc', { title: 'Verifikasi Dokumen', valid: false, signer: null, surat: null, scanTime: new Date() });
  }
});

app.get('/verify/:token', async (req, res) => {
  try {
    const sig = await Signature.findOne({ verifyToken: req.params.token });
    if (!sig) {
      return res.render('verify', {
        title: 'Verifikasi Tanda Tangan',
        valid: false,
        sig: null,
        scanTime: new Date()
      });
    }
    res.render('verify', {
      title: 'Verifikasi Tanda Tangan',
      valid: true,
      sig,
      scanTime: new Date()
    });
  } catch (err) {
    res.render('verify', { title: 'Verifikasi Tanda Tangan', valid: false, sig: null, scanTime: new Date() });
  }
});

// ── AGREEMENT (MOU / PKS / SPK / KONTRAK) ──

const ROMAN = ['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
let ORG_CODE = process.env.ORG_CODE || 'INSPIRA';
SiteSettings.getSettings().then(s => { if (s.orgCode) ORG_CODE = s.orgCode; }).catch(() => {});

function buildNomor(type, seq, bulan, tahun) {
  const pad = String(seq).padStart(3, '0');
  return `${type}/${pad}/${ORG_CODE}/${ROMAN[bulan]}/${tahun}`;
}

function formatRupiah(n) {
  if (!n) return '-';
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

app.get('/agreements', requireAuth, requireDirektur, async (req, res) => {
  try {
    const { type, status, q } = req.query;
    const filter = {};
    if (type)   filter.type   = type;
    if (status) filter.status = status;
    if (q)      filter.judul  = { $regex: q, $options: 'i' };

    const [docs, counts] = await Promise.all([
      Agreement.find(filter).sort({ createdAt: -1 }),
      getMailCounts(req.user._id)
    ]);

    const stats = {
      total:    await Agreement.countDocuments(),
      aktif:    await Agreement.countDocuments({ status: 'aktif' }),
      draft:    await Agreement.countDocuments({ status: 'draft' }),
      berakhir: await Agreement.countDocuments({ status: 'berakhir' })
    };

    res.render('agreements', {
      active: 'agreements', title: 'Dokumen & Penomoran',
      docs, stats, filter: { type, status, q },
      formatRupiah, ROMAN,
      ...counts
    });
  } catch (err) {
    console.error(err);
    res.redirect('/inbox');
  }
});

app.get('/agreements/new', requireAuth, requireDirektur, async (req, res) => {
  const counts = await getMailCounts(req.user._id);
  res.render('agreement-form', {
    active: 'agreements', title: 'Buat Dokumen Baru',
    doc: null, error: null, ...counts
  });
});

app.post('/agreements/new', requireAuth, requireDirektur, async (req, res) => {
  const counts = await getMailCounts(req.user._id);
  const fail = (msg) => res.render('agreement-form', {
    active: 'agreements', title: 'Buat Dokumen Baru',
    doc: req.body, error: msg, ...counts
  });

  try {
    const { type, judul, pihakPertama, pihakKedua, nilaiKontrak,
            tanggalMulai, tanggalBerakhir, deskripsi } = req.body;

    if (!type || !judul?.trim()) return fail('Jenis dokumen dan judul wajib diisi.');
    if (!['MOU','PKS','SPK','KONTRAK'].includes(type)) return fail('Jenis dokumen tidak valid.');

    const now   = new Date();
    const tahun = now.getFullYear();
    const bulan = now.getMonth() + 1;

    const seq   = await DocCounter.nextSeq(type, tahun);
    const nomor = buildNomor(type, seq, bulan, tahun);

    const agreement = await Agreement.create({
      type, nomor, urutan: seq, tahun, bulan,
      judul: judul.trim(),
      pihakPertama: pihakPertama?.trim() || ORG_CODE,
      pihakKedua:   pihakKedua?.trim()   || '',
      nilaiKontrak: nilaiKontrak ? parseFloat(nilaiKontrak) : null,
      tanggalMulai:   tanggalMulai   ? new Date(tanggalMulai)   : null,
      tanggalBerakhir: tanggalBerakhir ? new Date(tanggalBerakhir) : null,
      deskripsi: deskripsi?.trim() || '',
      status: 'draft',
      createdBy: {
        userId: req.user._id,
        name:   req.user.name,
        email:  req.user.email,
        role:   req.user.role
      },
      riwayat: [{ status: 'draft', catatan: 'Dokumen dibuat', oleh: req.user.name }]
    });

    await log(req, 'system', 'system',
      `Dokumen ${type} dibuat: ${nomor} — ${judul}`,
      { agreementId: agreement._id, nomor }
    );

    res.redirect('/agreements/' + agreement._id);
  } catch (err) {
    console.error(err);
    fail('Terjadi kesalahan, coba lagi.');
  }
});

app.get('/agreements/:id', requireAuth, requireDirektur, async (req, res) => {
  try {
    const doc = await Agreement.findById(req.params.id);
    if (!doc) return res.redirect('/agreements');
    const counts = await getMailCounts(req.user._id);
    res.render('agreement-detail', {
      active: 'agreements', title: doc.nomor,
      doc, ROMAN, formatRupiah, ...counts
    });
  } catch (err) {
    res.redirect('/agreements');
  }
});

app.post('/agreements/:id/status', requireAuth, requireDirektur, async (req, res) => {
  try {
    const { status, catatan } = req.body;
    const valid = ['draft','review','aktif','berakhir','dibatalkan'];
    if (!valid.includes(status)) return res.json({ ok: false, message: 'Status tidak valid.' });

    const doc = await Agreement.findById(req.params.id);
    if (!doc) return res.json({ ok: false, message: 'Dokumen tidak ditemukan.' });

    // Only direktur/admin can move to aktif
    if (status === 'aktif' && !['direktur','admin'].includes(req.user.role)) {
      return res.json({ ok: false, message: 'Hanya Direktur / Admin yang dapat mengaktifkan dokumen.' });
    }

    doc.status = status;
    doc.riwayat.push({ status, catatan: catatan || '', oleh: req.user.name });
    await doc.save();

    await log(req, 'system', 'system',
      `Status dokumen ${doc.nomor} diubah menjadi "${status}" oleh ${req.user.name}`,
      { agreementId: doc._id, nomor: doc.nomor, status }
    );

    res.json({ ok: true, status });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.delete('/agreements/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await Agreement.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// ── SURAT MASUK ──

const smUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, 'uploads', 'suratmasuk');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf','image/jpeg','image/png','image/jpg'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Hanya file PDF, JPG, atau PNG yang diizinkan.'));
  }
});

app.get('/surat-masuk', requireAuth, async (req, res) => {
  try {
    const { status, klasifikasi, q, dateFrom, dateTo, dateMonth, dateYear, sort } = req.query;
    const filter = {};
    if (status)      filter.status      = status;
    if (klasifikasi) filter.klasifikasi = klasifikasi;
    if (q) filter.$or = [
      { perihal:      { $regex: q, $options: 'i' } },
      { dariInstansi: { $regex: q, $options: 'i' } },
      { nomorSurat:   { $regex: q, $options: 'i' } }
    ];
    if (dateFrom || dateTo) {
      filter.tanggalTerima = {};
      if (dateFrom) filter.tanggalTerima.$gte = new Date(dateFrom);
      if (dateTo)   filter.tanggalTerima.$lte = new Date(dateTo + 'T23:59:59');
    } else if (dateMonth || dateYear) {
      const y = parseInt(dateYear) || new Date().getFullYear();
      const m = parseInt(dateMonth);
      if (m) {
        filter.tanggalTerima = { $gte: new Date(y, m-1, 1), $lt: new Date(y, m, 1) };
      } else {
        filter.tanggalTerima = { $gte: new Date(y, 0, 1), $lt: new Date(y+1, 0, 1) };
      }
    }

    const [surats, counts] = await Promise.all([
      SuratMasuk.find(filter).sort({ tanggalTerima: sort === 'oldest' ? 1 : -1 }),
      getMailCounts(req.user._id)
    ]);

    const stats = {
      total:           await SuratMasuk.countDocuments(),
      baru:            await SuratMasuk.countDocuments({ status: 'baru' }),
      ditindaklanjuti: await SuratMasuk.countDocuments({ status: 'ditindaklanjuti' }),
      selesai:         await SuratMasuk.countDocuments({ status: 'selesai' })
    };

    res.render('surat-masuk', {
      active: 'surat-masuk', title: 'Surat Masuk',
      surats, stats, filter: { status, klasifikasi, q, dateFrom, dateTo, dateMonth, dateYear, sort },
      formatDate, ...counts
    });
  } catch (err) {
    console.error(err);
    res.redirect('/inbox');
  }
});

app.post('/surat-masuk', requireAuth, (req, res) => {
  smUpload.single('fileSurat')(req, res, async (err) => {
    const counts = await getMailCounts(req.user._id);
    const fail = (msg) => res.render('surat-masuk', {
      active: 'surat-masuk', title: 'Surat Masuk',
      surats: [], stats: {}, filter: {},
      error: msg, formatDate, ...counts
    });

    if (err) return fail(err.message);

    try {
      const { nomorSurat, dariInstansi, perihal, tanggalSurat,
              tanggalTerima, klasifikasi, catatan } = req.body;

      if (!dariInstansi?.trim() || !perihal?.trim() || !tanggalTerima) {
        return fail('Instansi pengirim, perihal, dan tanggal terima wajib diisi.');
      }

      const data = {
        nomorSurat:    nomorSurat?.trim() || '',
        dariInstansi:  dariInstansi.trim(),
        perihal:       perihal.trim(),
        tanggalSurat:  tanggalSurat  ? new Date(tanggalSurat)  : null,
        tanggalTerima: new Date(tanggalTerima),
        klasifikasi:   klasifikasi   || 'Normal',
        catatan:       catatan?.trim() || '',
        dicatatOleh: {
          userId: req.user._id,
          name:   req.user.name,
          email:  req.user.email
        },
        status: 'baru'
      };

      if (req.file) {
        data.file = {
          originalName: req.file.originalname,
          path:         '/uploads/suratmasuk/' + req.file.filename,
          mimetype:     req.file.mimetype,
          size:         req.file.size
        };
      }

      await SuratMasuk.create(data);
      await log(req, 'system', 'email',
        `Surat masuk dicatat: "${perihal}" dari ${dariInstansi}`,
        { nomorSurat, dariInstansi }
      );

      res.redirect('/surat-masuk');
    } catch (e) {
      console.error(e);
      fail('Terjadi kesalahan, coba lagi.');
    }
  });
});

app.get('/surat-masuk/:id', requireAuth, async (req, res) => {
  try {
    const surat = await SuratMasuk.findById(req.params.id);
    if (!surat) return res.redirect('/surat-masuk');
    const counts = await getMailCounts(req.user._id);
    res.render('surat-masuk-detail', {
      active: 'surat-masuk', title: 'Detail Surat Masuk',
      surat, formatDate, formatDateTime, ...counts
    });
  } catch (err) {
    res.redirect('/surat-masuk');
  }
});

app.post('/surat-masuk/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['baru','dibaca','ditindaklanjuti','selesai'];
    if (!valid.includes(status)) return res.json({ ok: false });
    await SuratMasuk.findByIdAndUpdate(req.params.id, { status });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.delete('/surat-masuk/:id', requireAuth, async (req, res) => {
  try {
    const surat = await SuratMasuk.findById(req.params.id);
    if (!surat) return res.json({ ok: false });
    // Delete physical file if exists
    if (surat.file?.path) {
      const fp = path.join(__dirname, surat.file.path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await SuratMasuk.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// Serve uploaded letter files (protected)
app.get('/uploads/suratmasuk/:filename', requireAuth, (req, res) => {
  const fp = path.join(__dirname, 'uploads', 'suratmasuk', req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).send('File tidak ditemukan.');
  res.sendFile(fp);
});

// ── SURAT MASUK PDF EDITOR ──

app.get('/surat-masuk/:id/pdf', requireAuth, async (req, res) => {
  try {
    const surat = await SuratMasuk.findById(req.params.id);
    if (!surat) return res.redirect('/surat-masuk');
    const [docSig, users, counts] = await Promise.all([
      DocumentSignature.findOne({ suratId: surat._id }),
      User.find({ isActive: true }, 'name email role organization _id').sort({ name: 1 }),
      getMailCounts(req.user._id)
    ]);
    res.render('surat-pdf-editor', {
      title: 'Editor PDF',
      surat,
      docSig: docSig || { signers: [] },
      currentUser: req.user,
      users,
      formatDate,
      ...counts
    });
  } catch (err) {
    console.error(err);
    res.redirect('/surat-masuk');
  }
});

app.post('/surat-masuk/:id/pdf/add-signer', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    const surat = await SuratMasuk.findById(req.params.id);
    if (!surat) return res.json({ ok: false, message: 'Surat tidak ditemukan.' });

    const targetUser = await User.findById(userId);
    if (!targetUser) return res.json({ ok: false, message: 'Pengguna tidak ditemukan.' });

    let docSig = await DocumentSignature.findOne({ suratId: surat._id });
    if (!docSig) {
      docSig = new DocumentSignature({ suratId: surat._id, createdBy: req.user._id, signers: [] });
    }

    if (docSig.signers.some(s => s.userId.toString() === userId.toString())) {
      return res.json({ ok: false, message: 'Penandatangan sudah ditambahkan.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`;
    const verifyUrl = `${appUrl}/verify/doc/${token}`;

    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 200,
      color: { dark: '#000000', light: '#ffffff' }
    });

    const signerCount = docSig.signers.length;
    docSig.signers.push({
      userId: targetUser._id,
      userName: targetUser.name,
      userRole: targetUser.role || '',
      userOrg: targetUser.organization || '',
      jabatanDisplay: targetUser.jabatan || '',
      token,
      qrDataUrl,
      position: {
        x: 60 + (signerCount * 140),
        y: 680,
        width: 110,
        height: 110
      }
    });

    await docSig.save();

    const newSigner = docSig.signers[docSig.signers.length - 1];
    res.json({ ok: true, signer: newSigner });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, message: 'Gagal menambahkan penandatangan.' });
  }
});

app.post('/surat-masuk/:id/pdf/update-position', requireAuth, async (req, res) => {
  try {
    const { signerId, x, y, width, height } = req.body;
    await DocumentSignature.updateOne(
      { suratId: req.params.id, 'signers._id': signerId },
      { $set: { 'signers.$.position': { x, y, width, height } } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

app.delete('/surat-masuk/:id/pdf/signers/:signerId', requireAuth, async (req, res) => {
  try {
    const docSig = await DocumentSignature.findOne({ suratId: req.params.id });
    if (!docSig) return res.json({ ok: false });

    const signer = docSig.signers.id(req.params.signerId);
    const wasCurrentUser = signer && signer.userId.toString() === req.user._id.toString();

    await DocumentSignature.updateOne(
      { suratId: req.params.id },
      { $pull: { signers: { _id: req.params.signerId } } }
    );
    res.json({ ok: true, wasCurrentUser, removedUserId: signer?.userId?.toString() });
  } catch (err) {
    res.json({ ok: false });
  }
});

// ── START ──

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log(`Inspira Mailer berjalan di http://localhost:${PORT}`));
