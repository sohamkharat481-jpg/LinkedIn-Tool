import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './src/server/apiHandler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API Routes
app.use('/api', apiRouter);

// Serve static frontend assets from dist in production
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`LinkedIn Lead Finder server running on http://localhost:${PORT}`);
});
