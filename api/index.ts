import express from 'express';
import { apiRouter } from '../src/server/apiHandler';

const app = express();

app.use(express.json());

// CORS Middleware for Vercel serverless environment
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

// Mount apiRouter on both /api and root for robust Vercel serverless routing
app.use('/api', apiRouter);
app.use('/', apiRouter);

// 404 fallback for unmatched API routes
app.use((_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

export default app;

