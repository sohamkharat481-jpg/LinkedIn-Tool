import dotenv from 'dotenv';
// Load environment variables with override so local .env takes precedence
dotenv.config({ override: true });

// Purge container placeholder values if present in process.env so they never mask configured credentials
if (process.env.SUPABASE_URL?.includes('your-project') || process.env.SUPABASE_URL?.includes('placeholder')) {
  delete process.env.SUPABASE_URL;
}
if (process.env.VITE_SUPABASE_URL?.includes('your-project') || process.env.VITE_SUPABASE_URL?.includes('placeholder')) {
  delete process.env.VITE_SUPABASE_URL;
}
if (process.env.SUPABASE_ANON_KEY?.startsWith('your-') || process.env.SUPABASE_ANON_KEY?.includes('placeholder')) {
  delete process.env.SUPABASE_ANON_KEY;
}
if (process.env.VITE_SUPABASE_ANON_KEY?.startsWith('your-') || process.env.VITE_SUPABASE_ANON_KEY?.includes('placeholder')) {
  delete process.env.VITE_SUPABASE_ANON_KEY;
}

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './src/server/apiHandler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
console.log('Using port:', PORT);

app.set('trust proxy', 1);

// CORS Middleware for multi-origin/Vercel support
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Provider-Api-Key, X-Provider-Engine-Id, X-Goog-Api-Key'
  );
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '5mb' }));

// Health check endpoints
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'LinkedIn Lead Finder API',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'LinkedIn Lead Finder API',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api', apiRouter);

// Frontend integration: Vite middleware in development, static dist in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));

    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`LinkedIn Lead Finder running on port ${PORT}`);
    });
  }
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;

