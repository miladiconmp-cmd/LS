const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
// تعديل المنفذ ليتوافق ديناميكياً مع استضافة Render المجانية
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// الاتصال بقاعدة بيانات SQLite المحفوظة محلياً بالسيرفر
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('خطأ في الاتصال بقاعدة البيانات:', err.message);
    else console.log('تم الاتصال بقاعدة بيانات المكتبة بنجاح.');
});

// إنشاء الجداول الافتراضية
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT DEFAULT 'نشط'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        category TEXT,
        available_copies INTEGER DEFAULT 1
    )`);

    // إدخال بيانات افتراضية عند التشغيل لأول مرة
    db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
        if (row && row.count === 0) {
            db.run("INSERT INTO users (name, role, status) VALUES ('أستاذ أحمد علي', 'مدير نظام', 'نشط')");
            db.run("INSERT INTO users (name, role, status) VALUES ('سارة محمود', 'مساعد أمين مكتبة', 'نشط')");
        }
    });

    db.get("SELECT COUNT(*) as count FROM books", [], (err, row) => {
        if (row && row.count === 0) {
            db.run("INSERT INTO books (title, author, category, available_copies) VALUES ('مقدمة في الذكاء الاصطناعي', 'د. خالد وليد', 'علوم', 5)");
            db.run("INSERT INTO books (title, author, category, available_copies) VALUES ('تاريخ مصر الحديث', 'أحمد زكي', 'تاريخ', 3)");
        }
    });
});

// الروابط البرمجية (APIs) لتخزين واسترجاع البيانات
app.get('/api/users', (req, res) => {
    db.all("SELECT * FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/books', (req, res) => {
    db.all("SELECT * FROM books", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/books', (req, res) => {
    const { title, author, category, copies } = req.body;
    db.run("INSERT INTO books (title, author, category, available_copies) VALUES (?, ?, ?, ?)", 
    [title, author, category, copies], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, message: 'تم إضافة الكتاب بنجاح' });
    });
});

app.listen(PORT, () => {
    console.log(`المكتبة الذكية تعمل على المنفذ: ${PORT}`);
});
