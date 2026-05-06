require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;

// ===== PostgreSQL Connection =====
if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'production') {
  console.warn("\n⚠️ WARNING: DATABASE_URL is not set in your environment variables.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  const client = await pool.connect();
  try {
    // Ensure expenses table exists
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
    
    // Add user_id column if missing
    try { await client.query(`ALTER TABLE expenses ADD COLUMN user_id VARCHAR(255)`); } catch (e) {}

    // Ensure settings table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255),
        value VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) DEFAULT 'default'
      )
    `);

    // Add user_id column if missing to settings and fix primary key
    try { await client.query(`ALTER TABLE settings ADD COLUMN user_id VARCHAR(255) DEFAULT 'default'`); } catch (e) {}
    try { 
      await client.query(`ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey`);
      await client.query(`ALTER TABLE settings ADD PRIMARY KEY (user_id, key)`);
    } catch (e) {}

    console.log('✓ Cloud PostgreSQL Database connected and initialized with Auth schema');
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

// ===== Supabase Client =====
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.VITE_SUPABASE_ANON_KEY || 'placeholder'
);

// ===== Auth Middleware =====
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Unauthorized: No token provided' });

  // Use Supabase native token validation which supports ECC (P-256) keys natively
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
  }
  
  req.user = { sub: user.id };
  next();
};

// ===== Public API Routes =====
// Provide frontend with Supabase public keys
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY
  });
});

// ===== Protected API Routes =====
app.use('/api/expenses', authenticateToken);
app.use('/api/settings', authenticateToken);

// GET all expenses
app.get('/api/expenses', async (req, res) => {
  try {
    // Auto-migrate orphaned records to the first user who logs in
    await pool.query('UPDATE expenses SET user_id = $1 WHERE user_id IS NULL', [req.user.sub]);
    
    const result = await pool.query('SELECT * FROM expenses WHERE user_id = $1 ORDER BY date DESC, created_at DESC', [req.user.sub]);
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
      'INSERT INTO expenses (id, amount, category, date, description, payment, recurring, created_at, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, amount, category, date, description || category, payment || '', recurring ? 1 : 0, createdAt || new Date().toISOString(), req.user.sub]
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
      'UPDATE expenses SET amount=$1, category=$2, date=$3, description=$4 WHERE id=$5 AND user_id=$6',
      [amount, category, date, description || category, req.params.id, req.user.sub]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE expense
app.delete('/api/expenses/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.sub]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE all expenses
app.delete('/api/expenses', async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE user_id=$1', [req.user.sub]);
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
        'INSERT INTO expenses (id, amount, category, date, description, payment, recurring, created_at, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING',
        [e.id, e.amount, e.category, e.date, e.description || e.category, e.payment || '', e.recurring ? 1 : 0, e.createdAt || new Date().toISOString(), req.user.sub]
      );
      imported++;
    } catch (err) { /* skip duplicates or errors */ }
  }
  res.json({ success: true, imported });
});

// GET settings
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings WHERE user_id = $1 OR user_id = $2', [req.user.sub, 'default']);
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
        "INSERT INTO settings (user_id, key, value) VALUES ($1, 'budget', $2) ON CONFLICT (user_id, key) DO UPDATE SET value=$2", 
        [req.user.sub, String(budget)]
      );
    }
    if (currency !== undefined) {
      await pool.query(
        "INSERT INTO settings (user_id, key, value) VALUES ($1, 'currency', $2) ON CONFLICT (user_id, key) DO UPDATE SET value=$2", 
        [req.user.sub, String(currency)]
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  ✨ Cloud-Ready ExpenseFlow server running at http://localhost:${PORT}\n`);
  });
}
