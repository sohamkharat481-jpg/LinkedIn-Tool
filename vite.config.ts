import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import express from 'express';
import path from 'path';
import {defineConfig} from 'vite';
import { apiRouter } from './src/server/apiHandler';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'express-api-plugin',
        configureServer(server) {
          const app = express();
          app.use('/api', apiRouter);

          server.middlewares.use((req, res, next) => {
            if (req.url && req.url.startsWith('/api')) {
              app(req as any, res as any, next);
            } else {
              next();
            }
          });
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
