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
          { sql: 'INSERT INTO users (name,
