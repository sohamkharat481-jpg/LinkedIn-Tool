import express, { Request, Response } from 'express';
import { verifyServerAuthToken } from './serverAuthService';
import { GoogleAuthService } from './googleAuthService';
import { logger } from '../services/loggerService';

export const googleAuthRouter = express.Router();

/**
 * Endpoint to exchange an auth code for tokens and save the refresh token.
 */
googleAuthRouter.post('/auth/google/callback', async (req: Request, res: Response) => {
  const auth = await verifyServerAuthToken(req);
  if (auth.status !== 200 || !auth.user) {
    return res.status(auth.status).json({ error: auth.error || 'Authentication required.' });
  }

  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Authorization code is required.' });
  }

  try {
    const { accessToken } = await GoogleAuthService.exchangeCodeAndSaveToken(
      auth.user.userId,
      auth.user.organizationId,
      code
    );
    
    res.json({ success: true, accessToken });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Token exchange failed' });
  }
});

/**
 * Endpoint to get a fresh access token using the stored refresh token.
 */
googleAuthRouter.get('/auth/google/token', async (req: Request, res: Response) => {
  const auth = await verifyServerAuthToken(req);
  if (auth.status !== 200 || !auth.user) {
    return res.status(auth.status).json({ error: auth.error || 'Authentication required.' });
  }

  try {
    const accessToken = await GoogleAuthService.getAccessToken(auth.user.userId);
    if (!accessToken) {
      return res.status(401).json({ error: 'Google account not connected or session expired.' });
    }
    
    res.json({ success: true, accessToken });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Token refresh failed' });
  }
});

/**
 * Endpoint to disconnect Google account.
 */
googleAuthRouter.post('/auth/google/disconnect', async (req: Request, res: Response) => {
  const auth = await verifyServerAuthToken(req);
  if (auth.status !== 200 || !auth.user) {
    return res.status(auth.status).json({ error: auth.error || 'Authentication required.' });
  }

  try {
    await GoogleAuthService.revokeToken(auth.user.userId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Disconnect failed' });
  }
});
