const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const app = express();
app.use(express.json({ limit: '100kb' }));

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:local.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- التهيئة ---------- */
let initPromise;
function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await db.batch([
        `CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'نشط'
        )`,
        `CREATE TABLE IF NOT EXISTS books (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          author TEXT NOT NULL,
          category TEXT,
          available_copies INTEGER NOT NULL DEFAULT 1
        )`,
        `CREATE TABLE IF NOT EXISTS loans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          borrowed_at TEXT NOT NULL,
          due_date TEXT NOT NULL,
          returned_at TEXT,
          FOREIGN KEY (book_id) REFERENCES books(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(book_id, returned_at)`,
      ]);

      const u = await db.execute('SELECT COUNT(*) AS c FROM users');
      if (Number(u.rows[0].c) === 0) {
        await db.batch([
          { sql: 'INSERT INTO users (name, role) VALUES (?, ?)', args: ['أستاذ أحمد علي', 'مدير نظام'] },
          { sql: 'INSERT INTO users (name, role) VALUES (?, ?)', args: ['سارة محمود', 'مساعد أمين مكتبة'] },
        ]);
      }
      const b = await db.execute('SELECT COUNT(*) AS c FROM books');
      if (Number(b.rows[0].c) === 0) {
        await db.batch([
          { sql: 'INSERT INTO books (title, author, category, available_copies) VALUES (?, ?, ?, ?)', args: ['مقدمة في الذكاء الاصطناعي', 'د. خالد وليد', 'علوم', 5] },
          { sql: 'INSERT INTO books (title, author, category, available_copies) VALUES (?, ?, ?, ?)', args: ['تاريخ مصر الحديث', 'أحمد زكي', 'تاريخ', 3] },
        ]);
      }
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/* ---------- أدوات مساعدة ---------- */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

// حماية بمفتاح API في الترويسة: x-api-key
function requireAuth(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return next(new HttpError(500, 'لم يتم ضبط مفتاح الإدارة على الخادم'));
  const provided = req.get('x-api-key') || '';
  if (!crypto.timingSafeEqual(sha(provided), sha(expected))) {
    return next(new HttpError(401, 'غير مصرح'));
  }
  next();
}

function parseId(value, label = 'المعرّف') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${label} غير صالح`);
  return n;
}

function cleanString(value, label, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${label} مطلوب`);
    return null;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${label} يجب أن يكون نصًا`);
  const v = value.trim();
  if (required && !v) throw new HttpError(400, `${label} مطلوب`);
  if (v.length > max) throw new HttpError(400, `${label} طويل جدًا`);
  return v || null;
}

function cleanCopies(value, fallback = 1) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10000) {
    throw new HttpError(400, 'عدد النسخ يجب أن يكون رقمًا صحيحًا غير سالب');
  }
  return n;
}

// يشغّل دالة داخل معاملة (transaction) مع تراجع تلقائي عند الخطأ
async function inTransaction(fn) {
  const tx = await db.transaction('write');
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

/* ---------- الوسائط ---------- */
app.use('/api', wrap(async (req, res, next) => {
  await init();
  next();
}));

/* ---------- الكتب ---------- */
// عام: بحث وترقيم   GET /api/books?q=كلمة&page=1&limit=20
app.get('/api/books', wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  const where = q ? 'WHERE title LIKE ? OR author LIKE ? OR category LIKE ?' : '';
  const like = `%${q}%`;
  const filterArgs = q ? [like, like, like] : [];

  const total = await db.execute({ sql: `SELECT COUNT(*) AS c FROM books ${where}`, args: filterArgs });
  const rows = await db.execute({
    sql: `SELECT * FROM books ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    args: [...filterArgs, limit, (page - 1) * limit],
  });

  res.json({
    page,
    limit,
    total: Number(total.rows[0].c),
    data: rows.rows,
  });
}));

app.get('/api/books/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const r = await db.execute({ sql: 'SELECT * FROM books WHERE id = ?', args: [id] });
  if (!r.rows.length) throw new HttpError(404, 'الكتاب غير موجود');
  res.json(r.rows[0]);
}));

app.post('/api/books', requireAuth, wrap(async (req, res) => {
  const body = req.body || {};
  const title = cleanString(body.title, 'عنوان الكتاب', { required: true });
  const author = cleanString(body.author, 'اسم المؤلف', { required: true });
  const category = cleanString(body.category, 'التصنيف', { max: 100 });
  const copies = cleanCopies(body.copies);

  const r = await db.execute({
    sql: 'INSERT INTO books (title, author, category, available_copies) VALUES (?, ?, ?, ?)',
    args: [title, author, category, copies],
  });
  res.status(201).json({ id: Number(r.lastInsertRowid), message: 'تم إضافة الكتاب بنجاح' });
}));

app.put('/api/books/:id', requireAuth, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const body = req.body || {};
  const title = cleanString(body.title, 'عنوان الكتاب', { required: true });
  const author = cleanString(body.author, 'اسم المؤلف', { required: true });
  const category = cleanString(body.category, 'التصنيف', { max: 100 });
  const copies = cleanCopies(body.copies, null);

  const r = await db.execute({
    sql: `UPDATE books
          SET title = ?, author = ?, category = ?,
              available_copies = COALESCE(?, available_copies)
          WHERE id = ?`,
    args: [title, author, category, copies, id],
  });
  if (r.rowsAffected === 0) throw new HttpError(404, 'الكتاب غير موجود');
  res.json({ message: 'تم تحديث الكتاب بنجاح' });
}));

app.delete('/api/books/:id', requireAuth, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const active = await db.execute({
    sql: 'SELECT COUNT(*) AS c FROM loans WHERE book_id = ? AND returned_at IS NULL',
    args: [id],
  });
  if (Number(active.rows[0].c) > 0) {
    throw new HttpError(409, 'لا يمكن حذف كتاب لديه إعارات نشطة');
  }
  const r = await db.execute({ sql: 'DELETE FROM books WHERE id = ?', args: [id] });
  if (r.rowsAffected === 0) throw new HttpError(404, 'الكتاب غير موجود');
  res.json({ message: 'تم حذف الكتاب' });
}));

/* ---------- المستخدمون (محمية) ---------- */
app.get('/api/users', requireAuth, wrap(async (req, res) => {
  const r = await db.execute('SELECT * FROM users ORDER BY id');
  res.json(r.rows);
}));

app.post('/api/users', requireAuth, wrap(async (req, res) => {
  const body = req.body || {};
  const name = cleanString(body.name, 'الاسم', { required: true });
  const role = cleanString(body.role, 'الدور', { required: true, max: 50 });
  const r = await db.execute({
    sql: 'INSERT INTO users (name, role) VALUES (?, ?)',
    args: [name, role],
  });
  res.status(201).json({ id: Number(r.lastInsertRowid), message: 'تم إضافة المستخدم' });
}));

/* ---------- الإعارات (محمية) ---------- */
// GET /api/loans?status=active|returned|overdue
app.get('/api/loans', requireAuth, wrap(async (req, res) => {
  const now = new Date().toISOString();
  const filters = {
    active: 'WHERE l.returned_at IS NULL',
    returned: 'WHERE l.returned_at IS NOT NULL',
    overdue: 'WHERE l.returned_at IS NULL AND l.due_date < ?',
  };
  const status = req.query.status;
  const where = filters[status] || '';
  const args = status === 'overdue' ? [now] : [];

  const r = await db.execute({
    sql: `SELECT l.*, b.title AS book_title, u.name AS user_name
          FROM loans l
          JOIN books b ON b.id = l.book_id
          JOIN users u ON u.id = l.user_id
          ${where}
          ORDER BY l.id DESC LIMIT 200`,
    args,
  });
  res.json(r.rows);
}));

// استعارة: { "book_id": 1, "user_id": 2, "days": 14 }
app.post('/api/loans', requireAuth, wrap(async (req, res) => {
  const body = req.body || {};
  const bookId = parseId(body.book_id, 'معرّف الكتاب');
  const userId = parseId(body.user_id, 'معرّف المستخدم');
  const days = body.days === undefined ? 14 : Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new HttpError(400, 'مدة الإعارة يجب أن تكون بين 1 و90 يومًا');
  }

  const loanId = await inTransaction(async (tx) => {
    const user = await tx.execute({ sql: 'SELECT status FROM users WHERE id = ?', args: [userId] });
    if (!user.rows.length) throw new HttpError(404, 'المستخدم غير موجود');
    if (user.rows[0].status !== 'نشط') throw new HttpError(403, 'حساب المستخدم غير نشط');

    // خصم نسخة بشكل ذري: ينجح فقط إذا كانت هناك نسخة متاحة
    const dec = await tx.execute({
      sql: 'UPDATE books SET available_copies = available_copies - 1 WHERE id = ? AND available_copies > 0',
      args: [bookId],
    });
    if (dec.rowsAffected === 0) {
      const exists = await tx.execute({ sql: 'SELECT 1 FROM books WHERE id = ?', args: [bookId] });
      throw exists.rows.length
        ? new HttpError(409, 'لا توجد نسخ متاحة من هذا الكتاب حاليًا')
        : new HttpError(404, 'الكتاب غير موجود');
    }

    const borrowed = new Date();
    const due = new Date(borrowed.getTime() + days * 24 * 60 * 60 * 1000);
    const ins = await tx.execute({
      sql: 'INSERT INTO loans (book_id, user_id, borrowed_at, due_date) VALUES (?, ?, ?, ?)',
      args: [bookId, userId, borrowed.toISOString(), due.toISOString()],
    });
    return Number(ins.lastInsertRowid);
  });

  res.status(201).json({ id: loanId, message: 'تمت الاستعارة بنجاح' });
}));

// إرجاع
app.post('/api/loans/:id/return', requireAuth, wrap(async (req, res) => {
  const id = parseId(req.params.id);

  await inTransaction(async (tx) => {
    // يضمن عدم الإرجاع مرتين: التحديث ينجح فقط إن لم تُرجع بعد
    const upd = await tx.execute({
      sql: 'UPDATE loans SET returned_at = ? WHERE id = ? AND returned_at IS NULL',
      args: [new Date().toISOString(), id],
    });
    if (upd.rowsAffected === 0) {
      const exists = await tx.execute({ sql: 'SELECT 1 FROM loans WHERE id = ?', args: [id] });
      throw exists.rows.length
        ? new HttpError(409, 'تم إرجاع هذا الكتاب مسبقًا')
        : new HttpError(404, 'الإعارة غير موجودة');
    }
    await tx.execute({
      sql: 'UPDATE books SET available_copies = available_copies + 1 WHERE id = (SELECT book_id FROM loans WHERE id = ?)',
      args: [id],
    });
  });

  res.json({ message: 'تم إرجاع الكتاب بنجاح' });
}));

/* ---------- 404 ومعالج الأخطاء ---------- */
app.use((req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'صيغة JSON غير صحيحة' });
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ في الخادم' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`الخادم يعمل على المنفذ ${port}`));
}

module.exports = app;
