import express from 'express';
import { apiRouter } from './apiHandler';

const app = express();

app.set('trust proxy', 1);

app.use(express.json());

// CORS Middleware for Vercel serverless environment
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

// 1. Isolated Health check endpoints
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



// Mount apiRouter
app.use('/api', apiRouter);
app.use('/', apiRouter);

// 404 fallback for unmatched API routes returning JSON
app.use((req, res) => {
  res.status(404).json({ error: 'API endpoint not found', path: req.url });
});

// Global JSON error handling middleware preventing plain text/HTML error responses
app.use((err: any, req: any, res: any, _next: any) => {
  console.error('Unhandled serverless error:', err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      error: err.message || 'A server error occurred.',
      path: req.url
    });
  }
});

export default app;
