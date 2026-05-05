require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;

// ===== PostgreSQL Connection =====
// If DATABASE_URL is not set (e.g. locally before setup), the app will crash gracefully
if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'production') {
  console.warn("\n⚠️ WARNING: DATABASE_URL is not set in your environment variables.");
  console.warn("⚠️ Please create a .env file with your PostgreSQL connection string to run locally.\n");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for cloud databases like Neon/Vercel Postgres
});

async function initDB() {
  const client = await pool.connect();
  try {
    // Create expenses table
    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id VARCHAR(255) PRIMARY KEY,
        amount DECIMAL(10, 2) NOT NULL,
        category VARCHAR(255) NOT NULL,
        date VARCHAR(255) NOT NULL,
        description TEXT,
        payment VARCHAR(255),
        recurring INTEGER DEFAULT 0,
        created_at VARCHAR(255) NOT NULL
      )
    `);

    // Create settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value VARCHAR(255) NOT NULL
      )
    `);

    // Insert default settings if they don't exist
    const existing = await client.query("SELECT COUNT(*) FROM settings WHERE key='budget'");
    if (parseInt(existing.rows[0].count) === 0) {
      await client.query("INSERT INTO settings (key, value) VALUES ('budget', '0')");
      await client.query("INSERT INTO settings (key, value) VALUES ('currency', '₹')");
    }

    console.log('✓ Cloud PostgreSQL Database connected and initialized');
  } catch (err) {
    console.error('Failed to initialize database tables:', err);
  } finally {
    client.release();
  }
}

// ===== Express App =====
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== API Routes =====

// GET all expenses
app.get('/api/expenses', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses ORDER BY date DESC, created_at DESC');
    const rows = result.rows.map(row => ({
      id: row.id,
      amount: parseFloat(row.amount),
      category: row.category,
      date: row.date,
      description: row.description,
      payment: row.payment,
      recurring: !!row.recurring,
      createdAt: row.created_at
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new expense
app.post('/api/expenses', async (req, res) => {
  const { id, amount, category, date, description, payment, recurring, createdAt } = req.body;
  try {
    await pool.query(
      'INSERT INTO expenses (id, amount, category, date, description, payment, recurring, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, amount, category, date, description || category, payment || '', recurring ? 1 : 0, createdAt || new Date().toISOString()]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update expense
app.put('/api/expenses/:id', async (req, res) => {
  const { amount, category, date, description } = req.body;
  try {
    await pool.query(
      'UPDATE expenses SET amount=$1, category=$2, date=$3, description=$4 WHERE id=$5',
      [amount, category, date, description || category, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE expense
app.delete('/api/expenses/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE all expenses
app.delete('/api/expenses', async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST bulk import
app.post('/api/expenses/bulk', async (req, res) => {
  const { expenses: items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected array' });
  let imported = 0;
  for (const e of items) {
    try {
      await pool.query(
        'INSERT INTO expenses (id, amount, category, date, description, payment, recurring, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
        [e.id, e.amount, e.category, e.date, e.description || e.category, e.payment || '', e.recurring ? 1 : 0, e.createdAt || new Date().toISOString()]
      );
      imported++;
    } catch (err) { /* skip duplicates or errors */ }
  }
  res.json({ success: true, imported });
});

// GET settings
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = isNaN(row.value) ? row.value : Number(row.value);
    });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT settings
app.put('/api/settings', async (req, res) => {
  const { budget, currency } = req.body;
  try {
    if (budget !== undefined) {
      await pool.query(
        "INSERT INTO settings (key, value) VALUES ('budget', $1) ON CONFLICT (key) DO UPDATE SET value=$1", 
        [String(budget)]
      );
    }
    if (currency !== undefined) {
      await pool.query(
        "INSERT INTO settings (key, value) VALUES ('currency', $1) ON CONFLICT (key) DO UPDATE SET value=$1", 
        [String(currency)]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Initialize DB on boot
initDB();

// ===== Export for Vercel =====
module.exports = app;

// ===== Start Local Server =====
// (Only runs if 'node server.js' is executed directly, not when imported by Vercel)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  ✨ Cloud-Ready ExpenseFlow server running at http://localhost:${PORT}\n`);
  });
}
