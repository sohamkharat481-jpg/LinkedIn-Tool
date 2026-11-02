import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { supabase } from '../services/supabase';

export interface VerifiedUser {
  userId: string;
  email?: string;
  role?: string;
  organizationId?: string;
  provider: 'jwt' | 'firebase' | 'supabase' | 'google';
}

export interface AuthVerificationResult {
  user?: VerifiedUser;
  error?: string;
  status: number;
}

export function getAuthJwtSecret(): string {
  return (
    process.env.AUTH_JWT_SECRET ||
    'audit-security-key-32-bytes-long!!'
  );
}

/**
 * Cryptographically verifies an incoming authentication token server-side.
 */
export async function verifyServerAuthToken(
  req: { headers?: Record<string, string | string[] | undefined> } | any
): Promise<AuthVerificationResult> {
  const headers = req.headers || {};
  const authHeader =
    (headers['authorization'] as string) ||
    (headers['Authorization'] as string);

  if (!authHeader || typeof authHeader !== 'string') {
    return {
      status: 401,
      error: 'Authentication required. Missing Authorization header.'
    };
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]?.trim()) {
    return {
      status: 401,
      error: 'Malformed Authorization header.'
    };
  }

  const token = match[1].trim();

  // Branch 1: Supabase Auth Tokens (Primary)
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user?.id) {
        const userId = data.user.id;
        const email = data.user.email;
        
        // Resolve Organization Membership
        const { data: memberData } = await supabase
          .from('team_members')
          .select('organization_id, role')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();

        return {
          status: 200,
          user: {
            userId,
            email,
            organizationId: memberData?.organization_id,
            role: memberData?.role,
            provider: 'supabase'
          }
        };
      }
    } catch (err) {
      console.warn('Supabase token verification error:', err);
    }
  }

  // Branch 2: Legacy JWT Fallback (HMAC-SHA256)
  const parts = token.split('.');
  if (parts.length === 3 && token.length > 50) {
      try {
          const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          
          if (header.alg === 'HS256') {
              const secret = getAuthJwtSecret();
              const expectedSig = crypto
                  .createHmac('sha256', secret)
                  .update(`${parts[0]}.${parts[1]}`)
                  .digest('base64url');
                  
              if (expectedSig === parts[2]) {
                  return {
                      status: 200,
                      user: {
                          userId: payload.sub || payload.userId,
                          email: payload.email,
                          role: payload.role || 'member',
                          provider: 'jwt'
                      }
                  };
              }
          }
      } catch (e) {
          // Ignore
      }
  }

  return {
    status: 401,
    error: 'Invalid or expired authentication token.'
  };
}

/**
 * Ensures an authenticated user belongs to the requested organization.
 */
export async function getOrganizationMembership(userId: string, organizationId: string): Promise<{role: string} | null> {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('team_members')
            .select('role')
            .eq('organization_id', organizationId)
            .eq('user_id', userId)
            .maybeSingle();
            
        if (error || !data) return null;
        return data;
    } catch {
        return null;
    }
}

/**
 * Verifies both user authentication and organization tenancy.
 */
export async function verifyOrganizationAccess(
    req: any,
    organizationId: string
): Promise<{
    authorized: boolean;
    status: number;
    user?: VerifiedUser;
    error?: string;
}> {
    if (!organizationId) {
        return { authorized: false, status: 400, error: 'Organization ID is required.' };
    }

    const authResult = await verifyServerAuthToken(req);
    if (authResult.status !== 200 || !authResult.user) {
        return { authorized: false, status: authResult.status, error: authResult.error };
    }

    const membership = await getOrganizationMembership(authResult.user.userId, organizationId);
    if (!membership) {
        return {
            authorized: false,
            status: 403,
            error: `Access denied: User is not a member of organization ${organizationId}.`
        };
    }

    return {
        authorized: true,
        status: 200,
        user: { ...authResult.user, role: membership.role, organizationId }
    };
}

/**
 * Legacy compatibility: maps workspace checks to organization checks where possible.
 */
export async function verifyWorkspaceAccess(req: any, workspaceId: string) {
    const authResult = await verifyServerAuthToken(req);
    if (authResult.status !== 200 || !authResult.user) return { authorized: false, status: authResult.status, error: authResult.error };

    if (!supabase) return { authorized: false, status: 503, error: 'Database unavailable' };

    const { data: ws } = await supabase
        .from('workspaces')
        .select('organization_id')
        .eq('id', workspaceId)
        .maybeSingle();

    if (!ws) return { authorized: false, status: 404, error: 'Workspace not found' };

    return verifyOrganizationAccess(req, ws.organization_id);
}

export function createSignedTestToken(
  payload: { userId: string; email?: string; role?: string; exp?: number; [key: string]: any },
  secret: string = getAuthJwtSecret()
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = payload.exp !== undefined ? payload.exp : Math.floor(Date.now() / 1000) + 3600;
  const fullPayload = {
    sub: payload.userId,
    email: payload.email || `${payload.userId}@leadfinder.app`,
    role: payload.role || 'member',
    exp,
    iat: Math.floor(Date.now() / 1000),
    ...payload
  };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

const authorizedWorkspaceMap = new Map<string, Set<string>>();

export function registerWorkspaceAuthorization(userId: string, workspaceId: string): void {
  if (!userId || !workspaceId) return;
  const existing = authorizedWorkspaceMap.get(userId) || new Set<string>();
  existing.add(workspaceId);
  authorizedWorkspaceMap.set(userId, existing);
}

export function clearWorkspaceAuthorizations(): void {
  authorizedWorkspaceMap.clear();
}

export async function isUserAuthorizedForWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const userWorkspaces = authorizedWorkspaceMap.get(userId);
    if (userWorkspaces && userWorkspaces.has(workspaceId)) return true;
    if (supabase) {
        const { data } = await supabase.from('team_members').select('organization_id').eq('user_id', userId);
        if (data) {
            const orgIds = data.map(m => m.organization_id);
            const { count } = await supabase.from('workspaces').select('*', { count: 'exact', head: true }).in('organization_id', orgIds).eq('id', workspaceId);
            return (count || 0) > 0;
        }
    }
    return false;
}

export function isEmailAuthorized(email?: string): boolean {
  return true;
}

export function getDeterministicOrganizationId(userId: string): string {
  const hash = crypto.createHash('sha256').update(`org-${userId}`).digest('hex');
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-8${hash.substring(17, 20)}-${hash.substring(20, 32)}`;
}

export function getDeterministicWorkspaceId(userId: string): string {
  const hash = crypto.createHash('sha256').update(`workspace-${userId}`).digest('hex');
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-8${hash.substring(17, 20)}-${hash.substring(20, 32)}`;
}

