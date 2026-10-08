import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './src/server/apiHandler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// CORS Middleware for multi-origin/Vercel support
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Provider-Api-Key, X-Provider-Engine-Id'
  );
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// API Routes
app.use('/api', apiRouter);

// Serve static frontend assets from dist in production (only when not running on Vercel serverless)
if (!process.env.VERCEL) {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // Fallback 404 handler for unmatched API routes on Vercel
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });
}

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`LinkedIn Lead Finder production backend running on port ${PORT}`);
  });
}

export default app;

