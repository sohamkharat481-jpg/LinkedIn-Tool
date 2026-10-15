import type { Request, Response } from 'express';
import app from '../src/server/lambda';

const originalApiPathParameter = '__vercel_api_path';

export default function handler(req: Request, res: Response) {
  const rewrittenUrl = new URL(req.url, 'http://vercel.local');
  const originalApiPath = rewrittenUrl.searchParams.get(originalApiPathParameter);

  if (originalApiPath !== null) {
    if (!/^\/api(?:\/|$)/.test(originalApiPath)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Invalid API route.' }));
      return;
    }

    rewrittenUrl.searchParams.delete(originalApiPathParameter);
    req.url = `${originalApiPath}${rewrittenUrl.search}`;
  }

  return app(req, res);
}
