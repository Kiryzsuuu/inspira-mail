require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const User = require('./models/User');
const Email = require('./models/Email');
const ActivityLog = require('./models/ActivityLog');
const ShortUrl = require('./models/ShortUrl');
const Task = require('./models/Task');
const Signature = require('./models/Signature');
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
  .then(() => console.log('MongoDB Atlas terhubung'))
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
  next();
});

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

// Multer for avatar upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, req.session.userId + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Hanya file gambar'));
  }
});

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
      const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password/${token}`;
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
      tag: m.tag,
      berkas: m.berkas,
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
      to: m.to.map(t => t.name).join(', ') || '-',
      subject: m.subject,
      date: formatDate(m.createdAt),
      tag: m.tag,
      berkas: m.berkas
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
    const formatted = mails.map(m => ({
      _id: m._id,
      id: m._id,
      to: m.to.map(t => t.name).join(', ') || '-',
      subject: m.subject,
      date: formatDate(m.createdAt),
      tag: m.tag,
      berkas: m.berkas
    }));

    res.render('draft', { mails: formatted, active: 'draft', title: 'Draf', ...counts });
  } catch (err) {
    console.error(err);
    res.render('draft', { mails: [], active: 'draft', title: 'Draf', inboxCount: 0, draftCount: 0 });
  }
});

app.get('/compose', requireAuth, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id }, isActive: true }).select('name email organization').sort('name');
    const counts = await getMailCounts(req.user._id);
    res.render('compose', { active: 'compose', title: 'Tulis Surat', users, ...counts });
  } catch (err) {
    res.render('compose', { active: 'compose', title: 'Tulis Surat', users: [], inboxCount: 0, draftCount: 0 });
  }
});

app.post('/compose', requireAuth, async (req, res) => {
  const { to, cc, subject, body, tag, berkas, action } = req.body;
  try {
    const toIds = [].concat(to || []).filter(Boolean);
    const ccIds = [].concat(cc || []).filter(Boolean);
    const [toUsers, ccUsers] = await Promise.all([
      User.find({ _id: { $in: toIds } }).select('name email'),
      User.find({ _id: { $in: ccIds } }).select('name email')
    ]);
    const isDraft = action === 'draft';
    const email = await Email.create({
      from: { userId: req.user._id, name: req.user.name, email: req.user.email },
      to: toUsers.map(u => ({ userId: u._id, name: u.name, email: u.email })),
      cc: ccUsers.map(u => ({ userId: u._id, name: u.name, email: u.email })),
      subject: subject?.trim() || '(Tanpa Subjek)',
      body: body || '',
      tag: tag || 'Normal',
      berkas: berkas?.trim() || '',
      status: isDraft ? 'draft' : 'sent'
    });
    const toNames = toUsers.map(u => u.name).join(', ') || '-';
    if (isDraft) {
      await log(req, 'email_draft', 'email', `Surat disimpan sebagai draf: "${email.subject}"`, { emailId: email._id, subject: email.subject });
    } else {
      await log(req, 'email_sent', 'email', `Surat dikirim kepada ${toNames}: "${email.subject}"`, { emailId: email._id, subject: email.subject, to: toNames, tag });
    }
    res.redirect(isDraft ? '/draft' : '/sent');
  } catch (err) {
    console.error(err);
    res.redirect('/compose');
  }
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
  const { name, organization, phone, bio } = req.body;
  const counts = await getMailCounts(req.user._id);
  try {
    if (!name?.trim()) {
      return res.render('profile', { active: 'profile', title: 'Profil Saya', success: null, error: 'Nama tidak boleh kosong.', ...counts });
    }
    await User.findByIdAndUpdate(req.user._id, {
      name: name.trim(),
      organization: organization?.trim() || 'Inspira Tekno',
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
    if (!err && req.file) {
      await User.findByIdAndUpdate(req.user._id, { avatar: '/uploads/avatars/' + req.file.filename });
      await log(req, 'avatar_update', 'profile', `${req.user.name} memperbarui foto profil`);
    }
    res.redirect('/profile');
  });
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
      date: formatDate(m.createdAt)
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

// Redirect short URL (public, no auth needed)
app.get('/s/:code', async (req, res) => {
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
  const { originalUrl, title } = req.body;
  const counts = await getMailCounts(req.user._id);
  const fail = async (msg) => {
    const urls = await ShortUrl.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.render('shorturl', { active: 'shorturl', title: 'Short URL', urls, error: msg, success: null, ...counts });
  };
  try {
    if (!originalUrl?.trim()) return fail('URL tidak boleh kosong.');
    let url = originalUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    let shortCode, exists = true;
    while (exists) {
      shortCode = generateCode(6);
      exists = await ShortUrl.findOne({ shortCode });
    }

    await ShortUrl.create({
      userId: req.user._id,
      userName: req.user.name,
      originalUrl: url,
      shortCode,
      title: title?.trim() || url
    });

    await log(req, 'system', 'system', `Short URL dibuat: /${shortCode} -> ${url}`);
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
  const { title, description, priority, dueDate, assignedTo } = req.body;
  try {
    const toIds = [].concat(assignedTo || []).filter(Boolean);
    const assignedUsers = await User.find({ _id: { $in: toIds } }).select('name email');
    const task = await Task.create({
      createdBy: { userId: req.user._id, name: req.user.name, email: req.user.email },
      assignedTo: assignedUsers.map(u => ({ userId: u._id, name: u.name, email: u.email })),
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
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const verifyUrl = `${appUrl}/verify/${token}`;

    const qrCodeDataUrl = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 320,
      color: { dark: '#071840', light: '#ffffff' }
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

// ── START ──

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Inspira Mailer berjalan di http://localhost:${PORT}`));
