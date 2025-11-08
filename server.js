// server.js
// Node/Express backend with session login + basic auth fallback
// Optimized for Render deployment

require('dotenv').config();

const express = require('express');
const basicAuth = require('express-basic-auth');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');

// Environment validation
const PORT = process.env.PORT || 8080;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Log environment status (without sensitive data)
console.log('Environment:', NODE_ENV);
console.log('Port:', PORT);
console.log('Discord Token:', process.env.DISCORD_TOKEN ? '✓ Set' : '✗ Missing');
console.log('Discord Guild ID:', process.env.DISCORD_GUILD_ID ? '✓ Set' : '✗ Missing');
console.log('Admin User:', ADMIN_USER ? '✓ Set' : '✗ Missing');
console.log('Session Secret:', SESSION_SECRET !== 'dev-secret-change-in-production' ? '✓ Set' : '⚠ Using default');

const app = express();

// Trust proxy - CRITICAL for Render (enables secure cookies, correct IPs)
app.set('trust proxy', 1);

// Directory structure
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const BLOG_FILE = path.join(DATA_DIR, 'blogs.json');
const FAQ_FILE = path.join(DATA_DIR, 'faqs.json');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

// Ensure all required folders exist
async function ensureFolders() {
  try {
    await fs.mkdir(PUBLIC_DIR, { recursive: true });
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    
    // Initialize blog file if it doesn't exist
    try {
      await fs.access(BLOG_FILE);
    } catch (err) {
      await fs.writeFile(BLOG_FILE, JSON.stringify([], null, 2), 'utf8');
      console.log('Created blogs.json');
    }
    
    // Initialize FAQ file if it doesn't exist
    try {
      await fs.access(FAQ_FILE);
    } catch (err) {
      await fs.writeFile(FAQ_FILE, JSON.stringify([], null, 2), 'utf8');
      console.log('Created faqs.json');
    }
  } catch (err) {
    console.error('Error ensuring folders:', err);
    throw err;
  }
}

// Data access functions with error handling
async function readBlogs() {
  try {
    const raw = await fs.readFile(BLOG_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('Error reading blogs:', err);
    return [];
  }
}

async function writeBlogs(posts) {
  await fs.writeFile(BLOG_FILE, JSON.stringify(posts, null, 2), 'utf8');
}

async function readFAQs() {
  try {
    const raw = await fs.readFile(FAQ_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('Error reading FAQs:', err);
    return [];
  }
}

async function writeFAQs(faqs) {
  await fs.writeFile(FAQ_FILE, JSON.stringify(faqs, null, 2), 'utf8');
}

// Middleware setup
app.use(express.static(PUBLIC_DIR));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Session configuration with Render-specific settings
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: NODE_ENV === 'production', // Enable secure cookies in production
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// Basic auth fallback
const basic = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'WayHaven Admin'
});

// Authentication check helper
function isAuthenticatedReq(req) {
  // Check session-based auth
  if (req.session && req.session.authenticated) {
    return true;
  }

  // Check basic auth header
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return false;
  }
  
  try {
    const b = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const [user, pass] = b.split(':');
    return user === ADMIN_USER && pass === ADMIN_PASS;
  } catch (err) {
    return false;
  }
}

// Admin protection middleware
function protect(req, res, next) {
  if (isAuthenticatedReq(req)) {
    return next();
  }
  
  // Redirect browsers to login page with error parameter
  const acceptsHtml = req.headers.accept && req.headers.accept.indexOf('text/html') !== -1;
  if (acceptsHtml) {
    return res.redirect('/admin/login?error=unauthorized');
  }
  
  // Return 401 for API requests
  res.status(401).json({ error: 'Unauthorized' });
}

/* ------------- Health Check for Render ------------- */
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/* ------------- Public API - Blogs ------------- */

// GET public list (newest-first)
app.get('/api/blogs', async (req, res) => {
  try {
    const posts = await readBlogs();
    posts.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.date);
      const dateB = new Date(b.createdAt || b.date);
      return dateB - dateA;
    });
    res.json(posts);
  } catch (err) {
    console.error('Error fetching blogs:', err);
    res.status(500).json({ error: 'Failed to read blogs' });
  }
});

/* ------------- Public API - FAQs ------------- */

// GET public FAQs list
app.get('/api/faqs', async (req, res) => {
  try {
    const faqs = await readFAQs();
    faqs.sort((a, b) => {
      const dateA = new Date(a.createdAt);
      const dateB = new Date(b.createdAt);
      return dateB - dateA;
    });
    res.json(faqs);
  } catch (err) {
    console.error('Error fetching FAQs:', err);
    res.status(500).json({ error: 'Failed to read FAQs' });
  }
});

/* ------------- Admin: Login/Logout ------------- */

// Check session status
app.get('/admin/status', (req, res) => {
  res.json({ 
    authenticated: isAuthenticatedReq(req),
    timestamp: new Date().toISOString()
  });
});

// POST /admin/login
app.post('/admin/login', async (req, res) => {
  const user = req.body.username || req.body.user;
  const pass = req.body.password || req.body.pass;
  
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.authenticated = true;
    return res.redirect('/admin');
  }
  
  res.status(401).send('Invalid credentials. Please try again.');
});

// GET /admin/logout
app.get('/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
    }
    res.redirect('/');
  });
});

/* ------------- Admin CRUD endpoints - Blogs ------------- */

// Create new blog
app.post('/api/blogs', protect, async (req, res) => {
  try {
    const { title, excerpt, content, image, createdAt, pinned } = req.body;
    
    if (!title || (!excerpt && !content)) {
      return res.status(400).json({ error: 'Title and excerpt/content required' });
    }
    
    const posts = await readBlogs();
    const id = uuidv4();
    const post = {
      id,
      title,
      excerpt: excerpt || content,
      content: content || excerpt,
      image: image || '',
      createdAt: createdAt || new Date().toISOString(),
      pinned: !!pinned
    };
    
    posts.unshift(post);
    await writeBlogs(posts);
    res.json(post);
  } catch (err) {
    console.error('Error creating blog:', err);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Update blog
app.put('/api/blogs/:id', protect, async (req, res) => {
  try {
    const id = req.params.id;
    const { title, excerpt, content, image, pinned } = req.body;
    const posts = await readBlogs();
    const idx = posts.findIndex(p => p.id === id);
    
    if (idx === -1) {
      return res.status(404).json({ error: 'Blog post not found' });
    }
    
    posts[idx] = {
      ...posts[idx],
      title: title ?? posts[idx].title,
      excerpt: excerpt ?? posts[idx].excerpt,
      content: content ?? posts[idx].content,
      image: image ?? posts[idx].image,
      pinned: pinned !== undefined ? !!pinned : posts[idx].pinned
    };
    
    await writeBlogs(posts);
    res.json(posts[idx]);
  } catch (err) {
    console.error('Error updating blog:', err);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Delete blog
app.delete('/api/blogs/:id', protect, async (req, res) => {
  try {
    const id = req.params.id;
    let posts = await readBlogs();
    const before = posts.length;
    posts = posts.filter(p => p.id !== id);
    
    if (posts.length === before) {
      return res.status(404).json({ error: 'Blog post not found' });
    }
    
    await writeBlogs(posts);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting blog:', err);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

/* ------------- Admin CRUD endpoints - FAQs ------------- */

// Create new FAQ
app.post('/api/faqs', protect, async (req, res) => {
  try {
    const { question, answer, createdAt } = req.body;
    
    if (!question || !answer) {
      return res.status(400).json({ error: 'Question and answer required' });
    }
    
    const faqs = await readFAQs();
    const id = uuidv4();
    const faq = {
      id,
      question,
      answer,
      createdAt: createdAt || new Date().toISOString()
    };
    
    faqs.unshift(faq);
    await writeFAQs(faqs);
    res.json(faq);
  } catch (err) {
    console.error('Error creating FAQ:', err);
    res.status(500).json({ error: 'Failed to create FAQ' });
  }
});

// Update FAQ
app.put('/api/faqs/:id', protect, async (req, res) => {
  try {
    const id = req.params.id;
    const { question, answer } = req.body;
    const faqs = await readFAQs();
    const idx = faqs.findIndex(f => f.id === id);
    
    if (idx === -1) {
      return res.status(404).json({ error: 'FAQ not found' });
    }
    
    faqs[idx] = {
      ...faqs[idx],
      question: question ?? faqs[idx].question,
      answer: answer ?? faqs[idx].answer
    };
    
    await writeFAQs(faqs);
    res.json(faqs[idx]);
  } catch (err) {
    console.error('Error updating FAQ:', err);
    res.status(500).json({ error: 'Failed to update FAQ' });
  }
});

// Delete FAQ
app.delete('/api/faqs/:id', protect, async (req, res) => {
  try {
    const id = req.params.id;
    let faqs = await readFAQs();
    const before = faqs.length;
    faqs = faqs.filter(f => f.id !== id);
    
    if (faqs.length === before) {
      return res.status(404).json({ error: 'FAQ not found' });
    }
    
    await writeFAQs(faqs);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting FAQ:', err);
    res.status(500).json({ error: 'Failed to delete FAQ' });
  }
});

/* ------------- File Uploads ------------- */

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 6 * 1024 * 1024 }, // 6MB limit
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  }
});

app.post('/api/upload', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filename = path.basename(req.file.path);
    const url = `/uploads/${filename}`;
    res.json({ url });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

/* ------------- Discord Integration ------------- */

let playercount = null;
try {
  playercount = require('./playercount');
  console.log('playercount module loaded');
} catch (err) {
  console.log('playercount module not found (Discord integration disabled)');
}

app.get('/api/discord/online', (req, res) => {
  try {
    if (!playercount) {
      return res.json({ enabled: false, count: 0, members: [] });
    }
    
    const summary = playercount.getSummary({ limit: 100 });
    res.json(summary);
  } catch (err) {
    console.error('Discord online endpoint error:', err);
    res.status(500).json({ error: 'Failed to fetch Discord data' });
  }
});

/* ------------- Route Handlers ------------- */

// Serve index.html for home and support routes
app.get(['/', '/home', '/support'], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Serve store page
app.get('/store', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'store.html'));
});

// Serve map page
app.get('/map', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'map.html'));
});

// Serve admin login page (redirect from old URL)
app.get('/admin-login.html', (req, res) => {
  res.redirect(301, '/admin/login');
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin-login.html'));
});

// Serve admin panel (redirect from old URL)
app.get('/admin.html', (req, res) => {
  res.redirect(301, '/admin');
});

// PROTECTED - Require authentication
app.get('/admin', protect, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ------------- Start Server ------------- */

async function startServer() {
  try {
    // Ensure folders exist
    await ensureFolders();
    console.log('Folders initialized');

    // Initialize Discord integration if configured
    const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
    const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
    
    if (playercount && DISCORD_TOKEN && DISCORD_GUILD_ID) {
      try {
        await playercount.init({ token: DISCORD_TOKEN, guildId: DISCORD_GUILD_ID });
        console.log('✓ Discord playercount initialized');
      } catch (err) {
        console.warn('⚠ Discord playercount init failed:', err.message);
      }
    } else {
      if (!playercount) {
        console.log('ℹ Discord integration disabled (playercount module not found)');
      } else {
        console.log('ℹ Discord integration disabled (missing DISCORD_TOKEN or DISCORD_GUILD_ID)');
      }
    }

    // Start listening
    app.listen(PORT, '0.0.0.0', () => {
      console.log('═══════════════════════════════════════');
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`✓ Environment: ${NODE_ENV}`);
      console.log(`✓ Local: http://localhost:${PORT}`);
      console.log('═══════════════════════════════════════');
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();