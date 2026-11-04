import { OAuth2Client } from 'google-auth-library';
import { supabase as rawSupabaseServerClient } from '../services/supabase';
const getSupabaseServerClient = process.env.NODE_ENV === 'test' ? null : rawSupabaseServerClient;
import { encryptAccessToken, decryptAccessToken } from './cryptoService';
import { logger } from '../services/loggerService';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

// Redirect URI for code exchange in GIS popup flow is usually 'postmessage'
const REDIRECT_URI = 'postmessage';

export class GoogleAuthService {
  private static client = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );

  /**
   * Exchanges an authorization code for tokens and saves the refresh token.
   */
  static async exchangeCodeAndSaveToken(
    userId: string,
    organizationId: string | undefined,
    code: string
  ): Promise<{ accessToken: string }> {
    try {
      const { tokens } = await this.client.getToken(code);
      
      if (tokens.refresh_token) {
        const encryptedToken = encryptAccessToken(tokens.refresh_token);
        
        const supabase = getSupabaseServerClient;
        if (supabase) {
          await supabase
            .from('google_tokens')
            .upsert({
              user_id: userId,
              organization_id: organizationId,
              encrypted_refresh_token: encryptedToken,
              updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
        }
        
        logger.audit('Google refresh token saved', { userId, organizationId });
      }

      return {
        accessToken: tokens.access_token || ''
      };
    } catch (error: any) {
      logger.error('Failed to exchange Google auth code', { userId, error: error.message });
      throw new Error(`Google token exchange failed: ${error.message}`);
    }
  }

  /**
   * Retrieves a fresh access token for a user, using the saved refresh token if necessary.
   */
  static async getAccessToken(userId: string): Promise<string | null> {
    const supabase = getSupabaseServerClient;
    if (!supabase) return null;

    try {
      const { data, error } = await supabase
        .from('google_tokens')
        .select('encrypted_refresh_token')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !data?.encrypted_refresh_token) return null;

      const refreshToken = decryptAccessToken(data.encrypted_refresh_token);
      
      this.client.setCredentials({ refresh_token: refreshToken });
      const { token } = await this.client.getAccessToken();
      
      return token || null;
    } catch (error: any) {
      logger.error('Failed to refresh Google access token', { userId, error: error.message });
      return null;
    }
  }
  
  /**
   * Revokes the stored token for a user.
   */
  static async revokeToken(userId: string): Promise<void> {
    const supabase = getSupabaseServerClient;
    if (!supabase) return;
    
    await supabase
        .from('google_tokens')
        .delete()
        .eq('user_id', userId);
        
    logger.audit('Google token revoked', { userId });
  }
}
