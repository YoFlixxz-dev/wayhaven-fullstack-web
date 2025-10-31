// server.js
// Node/Express backend with session login + basic auth fallback
// Load .env as early as possible
require('dotenv').config();

const express = require('express');
const basicAuth = require('express-basic-auth');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');

// quick env debug (safe: does NOT print the token)
console.log('ENV:', 'DISCORD_TOKEN', process.env.DISCORD_TOKEN ? 'OK' : 'MISSING', 'DISCORD_GUILD_ID', process.env.DISCORD_GUILD_ID ? process.env.DISCORD_GUILD_ID : 'MISSING');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const SESSION_SECRET = process.env.SESSION_SECRET;

const app = express();

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const BLOG_FILE = path.join(DATA_DIR, 'blogs.json');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

async function ensureFolders() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  try {
    await fs.access(BLOG_FILE);
  } catch (err) {
    await fs.writeFile(BLOG_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

async function readBlogs() {
  const raw = await fs.readFile(BLOG_FILE, 'utf8');
  return JSON.parse(raw || '[]');
}
async function writeBlogs(posts) {
  await fs.writeFile(BLOG_FILE, JSON.stringify(posts, null, 2), 'utf8');
}

// static + json
app.use(express.static(PUBLIC_DIR));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// sessions for admin login
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // secure: true // enable on HTTPS
  }
}));

// basic auth fallback (for API clients)
const basic = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'WayHaven Admin'
});

// helper: isAuthenticated checks session OR Basic auth header (valid creds)
function isAuthenticatedReq(req) {
  // session-based
  if (req.session && req.session.authenticated) return true;

  // basic auth header fallback
  const auth = req.headers.authorization;
  if (!auth) return false;
  if (!auth.startsWith('Basic ')) return false;
  const b = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const [user, pass] = b.split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASS) return true;
  return false;
}

// admin-protect middleware
function protect(req, res, next) {
  if (isAuthenticatedReq(req)) return next();
  // if request comes from browser, redirect to login
  // else, respond 401
  if (req.headers.accept && req.headers.accept.indexOf('text/html') !== -1) {
    return res.redirect('/admin-login.html');
  }
  res.status(401).json({ error: 'Unauthorized' });
}

/* ------------- Public API ------------- */

// GET public list (newest-first)
app.get('/api/blogs', async (req, res) => {
  try {
    const posts = await readBlogs();
    posts.sort((a,b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    res.json(posts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to read blogs' });
  }
});

/* ------------- Admin: login page uses session ------------- */

// POST /admin/login  (expects application/x-www-form-urlencoded or json)
app.post('/admin/login', express.urlencoded({ extended: true }), async (req, res) => {
  const user = req.body.username || req.body.user;
  const pass = req.body.password || req.body.pass;
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.authenticated = true;
    // redirect to admin panel
    return res.redirect('/admin.html');
  }
  // invalid -> back to login with 401
  res.status(401).send('Invalid credentials');
});

// GET /admin/logout
app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

/* ------------- Admin CRUD endpoints ------------- */

// create new blog (admin only)
app.post('/api/blogs', protect, async (req, res) => {
  try {
    const { title, excerpt, image, createdAt } = req.body;
    if (!title || !excerpt) return res.status(400).json({ error: 'title and excerpt required' });
    const posts = await readBlogs();
    const id = uuidv4();
    const post = {
      id,
      title,
      excerpt,
      image: image || '',
      createdAt: createdAt || new Date().toISOString()
    };
    // put newest first
    posts.unshift(post);
    // No enforcement of max posts - allow all
    await writeBlogs(posts);
    res.json(post);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to create post' });
  }
});

// update
app.put('/api/blogs/:id', protect, async (req, res) => {
  try {
    const id = req.params.id;
    const { title, excerpt, image } = req.body;
    const posts = await readBlogs();
    const idx = posts.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    posts[idx] = {
      ...posts[idx],
      title: title ?? posts[idx].title,
      excerpt: excerpt ?? posts[idx].excerpt,
      image: image ?? posts[idx].image
    };
    await writeBlogs(posts);
    res.json(posts[idx]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to update' });
  }
});

// delete
app.delete('/api/blogs/:id', protect, async (req, res) => {
  try {
    const id = req.params.id;
    let posts = await readBlogs();
    const before = posts.length;
    posts = posts.filter(p => p.id !== id);
    if (posts.length === before) return res.status(404).json({ error: 'not found' });
    await writeBlogs(posts);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete' });
  }
});

/* ------------- Uploads ------------- */
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 6 * 1024 * 1024 }
});

app.post('/api/upload', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    const filename = path.basename(req.file.path);
    const url = `/uploads/${filename}`;
    res.json({ url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'upload failed' });
  }
});

/* ------------- Discord online endpoint (delegates to playercount) ------------- */

let playercount = null;
try {
  playercount = require('./playercount');
} catch (e) {
  // playercount may not exist yet — we'll log later
  playercount = null;
}

app.get('/api/discord/online', (req, res) => {
  try {
    if (!playercount) return res.json({ enabled: false, count: 0, members: [] });
    const summary = playercount.getSummary({ limit: 100 });
    return res.json(summary);
  } catch (err) {
    console.error('discord online endpoint error', err);
    res.status(500).json({ error: 'failed' });
  }
});

/* start */
(async () => {
  await ensureFolders();

  // initialize playercount if possible
  const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
  const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
  if (playercount && DISCORD_TOKEN && DISCORD_GUILD_ID) {
    try {
      await playercount.init({ token: DISCORD_TOKEN, guildId: DISCORD_GUILD_ID });
      console.log('playercount initialized');
    } catch (e) {
      console.warn('playercount init failed:', e && e.message);
    }
  } else {
    if (!playercount) console.log('playercount module not found (skipping Discord integration).');
    else console.log('playercount not initialized (missing DISCORD_TOKEN or DISCORD_GUILD_ID).');
  }

// Serve index.html for home and support routes
app.get(['/', '/home', '/support'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve Tebex store and map pages
app.get('/store', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'store.html'));
});

app.get('/map', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'map.html'));
});

  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
})();