import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(rateLimit({ windowMs: 60_000, max: 100 }));

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'deadlines',
  password: process.env.MYSQL_PASSWORD || 'deadlines_pw',
  database: process.env.MYSQL_DATABASE || 'deadlines',
  // Return DATETIME/TIMESTAMP as strings to avoid implicit TZ conversion
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deadlines (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      details TEXT,
      datetime DATETIME NOT NULL,
      tags JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
}

const JWT_SECRET = process.env.JWT_SECRET || 'DuanYuFiFlower';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.cookies?.token || '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Auth
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const saltRounds = 10;
  const password_hash = await bcrypt.hash(password, saltRounds);
  try {
    const [result] = await pool.query('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, password_hash]);
    const userId = result.insertId;
    const token = signToken({ userId, email });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7*24*3600*1000 });
    res.json({ token });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already registered' });
    console.error(e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const [rows] = await pool.query('SELECT id, password_hash FROM users WHERE email = ? LIMIT 1', [email]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signToken({ userId: user.id, email });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7*24*3600*1000 });
  res.json({ token });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// Deadlines CRUD
app.get('/api/deadlines', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const [rows] = await pool.query('SELECT * FROM deadlines WHERE user_id = ? ORDER BY datetime DESC', [userId]);
  res.json(rows);
});

app.post('/api/deadlines', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const { name, details, datetime, tags } = req.body || {};
  if (!name || !datetime) return res.status(400).json({ error: 'name and datetime required' });
  // Treat incoming datetime as a local naive value like 'YYYY-MM-DDTHH:mm'
  let dt = String(datetime).trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dt)) {
    dt = dt + ':00';
  }
  // Remove trailing Z if any (shouldn't be present from datetime-local)
  if (/Z$/.test(dt)) {
    dt = dt.replace(/Z$/, '');
  }
  const [result] = await pool.query(
    'INSERT INTO deadlines (user_id, name, details, datetime, tags) VALUES (?, ?, ?, ?, ?)',
    [userId, name, details || null, dt, JSON.stringify(tags || [])]
  );
  res.json({ id: result.insertId });
});

app.put('/api/deadlines/:id', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const id = Number(req.params.id);
  const { name, details, datetime, tags } = req.body || {};
  let dt = null;
  if (datetime) {
    dt = String(datetime).trim().replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dt)) {
      dt = dt + ':00';
    }
    if (/Z$/.test(dt)) {
      dt = dt.replace(/Z$/, '');
    }
  }
  await pool.query(
    'UPDATE deadlines SET name=?, details=?, datetime=?, tags=? WHERE id=? AND user_id=?',
    [name, details || null, dt, JSON.stringify(tags || []), id, userId]
  );
  res.json({ ok: true });
});

app.delete('/api/deadlines/:id', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const id = Number(req.params.id);
  await pool.query('DELETE FROM deadlines WHERE id=? AND user_id=?', [id, userId]);
  res.json({ ok: true });
});

initSchema()
  .then(() => app.listen(port, () => console.log(`API listening on ${port}`)))
  .catch((e) => { console.error(e); process.exit(1); });


