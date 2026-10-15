import express from 'express';
import apiApp from '../src/server/lambda';

const app = express();
const originalApiPathParameter = '__vercel_api_path';

app.use((req, res, next) => {
  const rewrittenUrl = new URL(req.url || '/', 'http://vercel.local');
  const originalApiPath = rewrittenUrl.searchParams.get(originalApiPathParameter);

  if (originalApiPath === null) {
    next();
    return;
  }

  if (!/^\/api(?:\/|$)/.test(originalApiPath)) {
    res.status(400).json({ error: 'Invalid API route.' });
    return;
  }

  rewrittenUrl.searchParams.delete(originalApiPathParameter);
  req.url = `${originalApiPath}${rewrittenUrl.search}`;
  next();
});

app.use(apiApp);

export default app;
