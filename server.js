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
    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id VARCHAR(255) PRIMARY KEY,
        amount DECIMAL(10, 2) NOT NULL,
        category VARCHAR(255) NOT NULL,
        date VARCHAR(255) NOT NULL,
        description TEXT,
        payment VARCHAR(255),
        recurring INTEGER DEFAULT 0,
        created_at VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL DEFAULT 'default'
      )
    `);
    try { await client.query(`ALTER TABLE expenses ADD COLUMN user_id VARCHAR(255) NOT NULL DEFAULT 'default'`); } catch (e) {}

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        user_id VARCHAR(255) NOT NULL,
        key VARCHAR(255) NOT NULL,
        value VARCHAR(255) NOT NULL,
        PRIMARY KEY (user_id, key)
      )
    `);
    try {
      await client.query(`ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey`);
      await client.query(`ALTER TABLE settings ADD PRIMARY KEY (user_id, key)`);
    } catch (e) {}

    console.log('✓ Cloud PostgreSQL connected and initialized');
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
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
let supabase;
if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

// ===== JWT Auth Middleware =====
async function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.slice(7);
  
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase client not initialized on server' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw error || new Error('No user found');
    req.userId = user.id;
    req.userEmail = user.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token: ' + err.message });
  }
}

// ===== Public Routes =====

// Frontend config — exposes only public Supabase keys
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  });
});

// Debug endpoint to test DB connection on Vercel
app.get('/api/test-db', async (req, res) => {
  try {
    const client = await pool.connect();
    client.release();
    res.json({ 
      status: 'connected', 
      dbUrl: (process.env.DATABASE_URL || '').substring(0, 20) + '...',
      hasJwtSecret: !!process.env.SUPABASE_JWT_SECRET
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack, code: err.code });
  }
});

// ===== Protected API Routes (require JWT) =====

// GET all expenses for this user
app.get('/api/expenses', verifyJWT, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM expenses WHERE user_id = $1 ORDER BY date DESC, created_at DESC',
      [req.userId]
    );
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
app.post('/api/expenses', verifyJWT, async (req, res) => {
  const { id, amount, category, date, description, payment, recurring, createdAt } = req.body;
  try {
    await pool.query(
      'INSERT INTO expenses (id, amount, category, date, description, payment, recurring, created_at, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, amount, category, date, description || category, payment || '', recurring ? 1 : 0, createdAt || new Date().toISOString(), req.userId]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update expense (only own)
app.put('/api/expenses/:id', verifyJWT, async (req, res) => {
  const { amount, category, date, description } = req.body;
  try {
    await pool.query(
      'UPDATE expenses SET amount=$1, category=$2, date=$3, description=$4 WHERE id=$5 AND user_id=$6',
      [amount, category, date, description || category, req.params.id, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE single expense (only own)
app.delete('/api/expenses/:id', verifyJWT, async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE all expenses for this user
app.delete('/api/expenses', verifyJWT, async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE user_id=$1', [req.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST bulk import
app.post('/api/expenses/bulk', verifyJWT, async (req, res) => {
  const { expenses: items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected array' });
  let imported = 0;
  for (const e of items) {
    try {
      await pool.query(
        'INSERT INTO expenses (id, amount, category, date, description, payment, recurring, created_at, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING',
        [e.id, e.amount, e.category, e.date, e.description || e.category, e.payment || '', e.recurring ? 1 : 0, e.createdAt || new Date().toISOString(), req.userId]
      );
      imported++;
    } catch (err) { /* skip */ }
  }
  res.json({ success: true, imported });
});

// GET settings for this user
app.get('/api/settings', verifyJWT, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT key, value FROM settings WHERE user_id = $1',
      [req.userId]
    );
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = isNaN(row.value) ? row.value : Number(row.value);
    });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT settings for this user
app.put('/api/settings', verifyJWT, async (req, res) => {
  const { budget, currency } = req.body;
  try {
    if (budget !== undefined) {
      await pool.query(
        'INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO UPDATE SET value=$3',
        [req.userId, 'budget', String(budget)]
      );
    }
    if (currency !== undefined) {
      await pool.query(
        'INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO UPDATE SET value=$3',
        [req.userId, 'currency', String(currency)]
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
    console.log(`\n  ✨ Chilav Book server running at http://localhost:${PORT}\n`);
  });
}
