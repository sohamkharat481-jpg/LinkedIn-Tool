import crypto from 'node:crypto';
import express, { Request, Response } from 'express';
import { supabase as rawSupabaseServerClient, getSupabaseAdminClient } from '../services/supabase';
const getSupabaseServerClient = process.env.NODE_ENV === 'test' ? null : rawSupabaseServerClient;
import { 
    verifyServerAuthToken, 
    verifyWorkspaceAccess,
    verifyOrganizationAccess,
    getDeterministicOrganizationId, 
    getDeterministicWorkspaceId 
} from './serverAuthService';
import { Organization, Workspace, Client, LeadRecord, SearchHistoryRecord, GoogleIntegration, ExportHistoryRecord } from '../types';
import { logger } from '../services/loggerService';
import { dbService } from '../services/storage';

export const dataRouter = express.Router();

/**
 * SCHEMA DEFINITIONS
 * These constants allow us to handle cases where the production database is missing newer enrichment columns.
 */
const CORE_LEAD_COLUMNS = 'id, workspace_id, full_name, headline, current_job_title, company_name, location, profile_url, source, created_at, updated_at';
const ALL_LEAD_COLUMNS = '*'; // Default to *, but we handle downgrades

/**
 * Shared helper to handle lead fetching with multi-tenant isolation and automatic schema fallback.
 */
const fetchLeadsWithSchemaFallback = async (wsId: string, leadIds: string[], selectCols: string): Promise<any[]> => {
    const supabase = getSupabaseServerClient;
    if (!supabase) return [];
    
    const query = supabase
        .from('leads')
        .select(selectCols)
        .eq('workspace_id', wsId)
        .order('created_at', { ascending: false });
    
    if (leadIds.length > 0) {
        query.in('id', leadIds);
    }
    
    const { data, error } = await query;
    if (error) {
        const isSchemaError = error.message?.includes('column') || 
                             error.message?.includes('cache') || 
                             error.message?.includes('not found');

        // Automatically downgrade to CORE columns if the schema is out of sync
        if (selectCols === ALL_LEAD_COLUMNS && isSchemaError) {
            console.warn(`[Schema Fallback] Downgrading to CORE_LEAD_COLUMNS for workspace ${wsId} due to: ${error.message}`);
            return fetchLeadsWithSchemaFallback(wsId, leadIds, CORE_LEAD_COLUMNS);
        }
        throw error;
    }
    return data || [];
};


/**
 * Onboarding: Idempotently creates an organization and default workspace for a new user.
 */
dataRouter.post('/onboard', async (req: Request, res: Response) => {
    const auth = await verifyServerAuthToken(req);
    if (auth.status !== 200 || !auth.user) return res.status(auth.status).json({ error: auth.error });

    const userId = auth.user.userId;
    const email = auth.user.email || '';
    const orgId = getDeterministicOrganizationId(userId);
    const wsId = getDeterministicWorkspaceId(userId);

    let organization: Organization = {
        id: orgId,
        name: `${email.split('@')[0] || 'User'}'s Organization`,
        ownerId: userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    let workspace: Workspace = {
        id: wsId,
        organizationId: orgId,
        name: 'Default Workspace',
        description: 'Your primary lead research workspace.'
    };

    const supabase = getSupabaseServerClient;
    if (!supabase) {
        return res.json({
            onboarded: true,
            organization,
            workspaces: [workspace]
        });
    }

    try {
        // 1. Ensure Default Workspace exists in public.workspaces
        try {
            const { data: existingWs } = await supabase
                .from('workspaces')
                .select('*')
                .eq('id', wsId)
                .maybeSingle();

            if (!existingWs) {
                const { data: newWs } = await supabase
                    .from('workspaces')
                    .insert({
                        id: wsId,
                        organization_id: orgId,
                        owner_id: userId,
                        name: 'Default Workspace',
                        description: 'Your primary lead research workspace.'
                    })
                    .select()
                    .single();

                if (newWs) {
                    workspace = {
                        id: newWs.id,
                        organizationId: newWs.organization_id || orgId,
                        name: newWs.name || 'Default Workspace',
                        description: newWs.description || 'Your primary lead research workspace.'
                    };
                }
            } else {
                workspace = {
                    id: existingWs.id,
                    organizationId: existingWs.organization_id || orgId,
                    name: existingWs.name || 'Default Workspace',
                    description: existingWs.description || 'Your primary lead research workspace.'
                };
            }
        } catch (wsErr) {
            console.warn('[Onboard Warning] Workspace check exception:', wsErr);
        }

        // 2. Ensure Organization exists in public.organizations if table exists
        try {
            const { data: existingOrg } = await supabase
                .from('organizations')
                .select('*')
                .eq('id', orgId)
                .maybeSingle();

            if (!existingOrg) {
                const { data: newOrg, error: orgError } = await supabase
                    .from('organizations')
                    .insert({
                        id: orgId,
                        name: `${email.split('@')[0] || 'User'}'s Organization`,
                        owner_id: userId
                    })
                    .select()
                    .single();

                if (!orgError && newOrg) {
                    organization = {
                        id: newOrg.id,
                        name: newOrg.name,
                        ownerId: newOrg.owner_id,
                        createdAt: newOrg.created_at || new Date().toISOString(),
                        updatedAt: newOrg.updated_at || new Date().toISOString()
                    };
                    await supabase.from('team_members').insert({
                        organization_id: orgId,
                        user_id: userId,
                        role: 'owner'
                    });
                }
            } else {
                organization = {
                    id: existingOrg.id,
                    name: existingOrg.name,
                    ownerId: existingOrg.owner_id,
                    createdAt: existingOrg.created_at || new Date().toISOString(),
                    updatedAt: existingOrg.updated_at || new Date().toISOString()
                };
            }
        } catch (orgErr: any) {
            console.warn('[Onboard Info] Skipping organizations table query due to schema state:', orgErr?.message || orgErr);
        }

        // 3. Ensure User exists in public.users
        try {
            const { data: existingUser } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .maybeSingle();

            if (!existingUser) {
                await supabase.from('users').insert({
                    id: userId,
                    email: email,
                    full_name: email.split('@')[0] || 'User',
                    workspace_id: wsId,
                    role: 'owner'
                });
            } else if (!existingUser.workspace_id) {
                await supabase.from('users').update({ workspace_id: wsId }).eq('id', userId);
            }
        } catch (userErr: any) {
            console.warn('[Onboard Info] Skipping users table query or update:', userErr?.message || userErr);
        }

        logger.audit('User onboarded', { userId, organizationId: orgId, workspaceId: wsId });

        res.json({
            onboarded: true,
            organization,
            workspaces: [workspace]
        });
    } catch (err: any) {
        logger.error('Onboarding failed', { userId, error: err });
        res.status(500).json({ error: err.message || 'Onboarding error' });
    }
});

async function isAuthorizedAdmin(req: Request): Promise<boolean> {
  const adminHeader = (req.headers['x-admin-secret'] as string) || (req.headers['x-admin-key'] as string) || '';
  const expectedSecret = process.env.ADMIN_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (expectedSecret && adminHeader.trim() === expectedSecret.trim()) {
    return true;
  }

  const auth = await verifyServerAuthToken(req);
  if (auth.status === 200 && auth.user && auth.user.role === 'owner') {
    return true;
  }

  return false;
}

/**
 * Admin API: Inspect user status (server-side only via service_role key)
 */
dataRouter.post('/admin/check-user', async (req: Request, res: Response) => {
    if (!(await isAuthorizedAdmin(req))) {
        return res.status(401).json({ error: 'Unauthorized admin access.' });
    }

    const email = req.body?.email?.trim();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
        return res.status(503).json({ 
            error: 'Server service_role key is not configured on this environment.',
            hasServiceRoleKey: false
        });
    }

    try {
        const { data, error } = await adminClient.auth.admin.listUsers();
        if (error) return res.status(500).json({ error: error.message });

        const targetUser = data.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (!targetUser) {
            return res.json({ found: false, email });
        }

        return res.json({
            found: true,
            user: {
                id: targetUser.id,
                email: targetUser.email,
                emailConfirmedAt: targetUser.email_confirmed_at,
                isConfirmed: Boolean(targetUser.email_confirmed_at),
                createdAt: targetUser.created_at,
                lastSignInAt: targetUser.last_sign_in_at,
                bannedUntil: targetUser.banned_until
            }
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message || 'Failed to inspect user' });
    }
});

/**
 * Admin API: Confirm user email server-side using service_role key
 */
dataRouter.post('/admin/confirm-user', async (req: Request, res: Response) => {
    if (!(await isAuthorizedAdmin(req))) {
        return res.status(401).json({ error: 'Unauthorized admin access.' });
    }

    const email = req.body?.email?.trim();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
        return res.status(503).json({ 
            error: 'Server service_role key is not configured on this environment.',
            hasServiceRoleKey: false
        });
    }

    try {
        const { data, error } = await adminClient.auth.admin.listUsers();
        if (error) return res.status(500).json({ error: error.message });

        const targetUser = data.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (!targetUser) {
            return res.status(404).json({ error: `User with email ${email} not found in Supabase Auth.` });
        }

        const { data: updatedData, error: updateError } = await adminClient.auth.admin.updateUserById(
            targetUser.id,
            { email_confirm: true }
        );

        if (updateError) return res.status(500).json({ error: updateError.message });

        logger.audit('User email confirmed via admin endpoint', { userId: targetUser.id, email: targetUser.email });

        return res.json({
            success: true,
            user: {
                id: updatedData.user.id,
                email: updatedData.user.email,
                emailConfirmedAt: updatedData.user.email_confirmed_at,
                isConfirmed: true
            }
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message || 'Failed to confirm user' });
    }
});

// --- WORKSPACES ---

// --- WORKSPACES ---

dataRouter.get('/workspaces', async (req: Request, res: Response) => {
    const auth = await verifyServerAuthToken(req);
    if (auth.status !== 200 || !auth.user) {
        return res.status(auth.status).json({ error: auth.error || 'Authentication required.' });
    }

    const userId = auth.user.userId;
    const email = auth.user.email || '';
    const namePrefix = email.split('@')[0] || 'User';
    const formattedName = namePrefix.charAt(0).toUpperCase() + namePrefix.slice(1);
    const workspaceName = `${formattedName}'s Workspace`;

    const userWsId = getDeterministicWorkspaceId(userId);
    const userOrgId = auth.user.organizationId || getDeterministicOrganizationId(userId);

    const defaultWorkspace: Workspace = {
        id: userWsId,
        organizationId: userOrgId,
        name: workspaceName,
        description: 'Your primary lead research workspace.'
    };

    try {
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('workspaces')
                .select('*')
                .or(`owner_id.eq.${userId},organization_id.eq.${userOrgId}`);

            if (!error && Array.isArray(data) && data.length > 0) {
                const workspaces = data.map((w: any) => ({
                    id: w.id,
                    organizationId: w.organization_id || userOrgId,
                    name: w.name || workspaceName,
                    description: w.description || ''
                }));
                if (!workspaces.some(w => w.id === userWsId)) {
                    workspaces.unshift(defaultWorkspace);
                }
                return res.json({ workspaces });
            }
            if (error) {
                logger.error('Failed to fetch workspaces from Supabase', { userId, error });
                if (process.env.NODE_ENV !== 'test') {
                    return res.status(500).json({ error: 'Failed to fetch workspaces' });
                }
            }
        }
        res.json({ workspaces: [defaultWorkspace] });
    } catch (err: any) {
        logger.error('Workspace fetch exception', { userId, error: err.message });
        if (process.env.NODE_ENV === 'test') {
            return res.json({ workspaces: [defaultWorkspace] });
        }
        res.status(500).json({ error: 'Internal server error fetching workspaces' });
    }
});

dataRouter.post('/workspaces', async (req: Request, res: Response) => {
    const auth = await verifyServerAuthToken(req);
    if (auth.status !== 200 || !auth.user) {
        return res.status(auth.status).json({ error: auth.error || 'Authentication required.' });
    }

    const { name, description } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Workspace name is required.' });
    }

    const userId = auth.user.userId;
    const userOrgId = auth.user.organizationId || getDeterministicOrganizationId(userId);

    try {
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('workspaces')
                .insert({
                    organization_id: userOrgId,
                    owner_id: userId,
                    name: name.trim(),
                    description: description || ''
                })
                .select()
                .single();

            if (!error && data) {
                return res.status(201).json({
                    workspace: {
                        id: data.id,
                        organizationId: data.organization_id || userOrgId,
                        name: data.name,
                        description: data.description
                    }
                });
            }
            if (error) throw error;
        }

        if (process.env.NODE_ENV === 'test') {
            const newWs = dbService.createWorkspace(userOrgId, name.trim(), description || '');
            return res.status(201).json({ workspace: newWs });
        }
        
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            const newWs = dbService.createWorkspace(userOrgId, name.trim(), description || '');
            return res.status(201).json({ workspace: newWs });
        }
        logger.error('Workspace creation failed', { userId, error: err.message });
        res.status(500).json({ error: err.message || 'Failed to create workspace' });
    }
});

// --- CLIENTS ---

dataRouter.get('/workspaces/:workspaceId/clients', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('clients')
                .select('*')
                .eq('workspace_id', workspaceId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return res.json({ clients: data || [] });
        }
        if (process.env.NODE_ENV === 'test') {
            return res.json({ clients: dbService.getClients(workspaceId) });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            return res.json({ clients: dbService.getClients(workspaceId) });
        }
        logger.error('Client fetch failed', { workspaceId, error: err.message });
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});

dataRouter.post('/workspaces/:workspaceId/clients', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { name, niche, notes } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('clients')
                .insert({
                    workspace_id: workspaceId,
                    name,
                    niche,
                    notes
                })
                .select()
                .single();

            if (error) throw error;
            return res.status(201).json({ client: data });
        }
        if (process.env.NODE_ENV === 'test') {
            const client = dbService.addClient(workspaceId, name, niche, notes);
            if (auth.user?.organizationId) client.organizationId = auth.user.organizationId;
            return res.status(201).json({ client });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            const client = dbService.addClient(workspaceId, name, niche, notes);
            if (auth.user?.organizationId) client.organizationId = auth.user.organizationId;
            return res.status(201).json({ client });
        }
        logger.error('Client creation failed', { workspaceId, error: err.message });
        res.status(500).json({ error: err.message || 'Failed to create client' });
    }
});

dataRouter.put('/workspaces/:workspaceId/clients/:clientId', async (req: Request, res: Response) => {
    const { workspaceId, clientId } = req.params;
    const { organization_id, ...validUpdates } = req.body || {};
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('clients')
                .update(validUpdates)
                .eq('id', clientId)
                .eq('workspace_id', workspaceId)
                .select()
                .single();

            if (error) throw error;
            return res.json({ client: data });
        }
        if (process.env.NODE_ENV === 'test') {
            const client = dbService.updateClient(workspaceId, clientId, validUpdates);
            return res.json({ client });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            try {
                const client = dbService.updateClient(workspaceId, clientId, validUpdates);
                return res.json({ client });
            } catch (innerErr) {
                return res.status(500).json({ error: 'Failed to update mock client' });
            }
        }
        logger.error('Client update failed', { workspaceId, clientId, error: err.message });
        res.status(500).json({ error: err.message || 'Failed to update client' });
    }
});

dataRouter.delete('/workspaces/:workspaceId/clients/:clientId', async (req: Request, res: Response) => {
    const { workspaceId, clientId } = req.params;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { error } = await getSupabaseServerClient
                .from('clients')
                .delete()
                .eq('id', clientId)
                .eq('workspace_id', workspaceId);
            
            if (error) throw error;
            return res.status(200).json({ success: true });
        }
        if (process.env.NODE_ENV === 'test') {
            dbService.deleteClient(workspaceId, clientId);
            return res.status(200).json({ success: true });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            dbService.deleteClient(workspaceId, clientId);
            return res.status(200).json({ success: true });
        }
        logger.error('Client deletion failed', { workspaceId, clientId, error: err.message });
        res.status(500).json({ error: err.message || 'Failed to delete client' });
    }
});

// --- LEADS ---

dataRouter.get('/workspaces/:workspaceId/leads', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { clientId } = req.query;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            if (clientId && typeof clientId === 'string' && clientId.trim()) {
                // Fetch leads for a specific client
                const { data: clData, error: clError } = await getSupabaseServerClient
                    .from('client_leads')
                    .select('lead_id, status, notes')
                    .eq('workspace_id', workspaceId)
                    .eq('client_id', clientId.trim());

                if (clError) throw clError;

                const leadIds = (clData || []).map((row: any) => row.lead_id).filter(Boolean);
                if (leadIds.length === 0) {
                    return res.json({ leads: [] });
                }

                const leadsData = await fetchLeadsWithSchemaFallback(workspaceId, leadIds, ALL_LEAD_COLUMNS);
                
                // Map the clientId back onto the leads for the frontend
                const leadsWithClientId = (leadsData || []).map((l: any) => {
                    const clRow = (clData || []).find(r => r.lead_id === l.id);
                    return {
                        ...l,
                        clientId: clientId.trim(),
                        status: clRow?.status || 'Not Contacted',
                        notes: clRow?.notes || '',
                        dateAdded: l.created_at || new Date().toISOString()
                    };
                });

                return res.json({ leads: leadsWithClientId });
            } else {
                // Fetch all leads for the workspace with their client associations
                const { data: clData, error: clError } = await getSupabaseServerClient
                    .from('client_leads')
                    .select('lead_id, client_id, status, notes')
                    .eq('workspace_id', workspaceId);

                if (clError) throw clError;

                const leadClientMap = new Map<string, string>();
                const leadIds: string[] = [];
                (clData || []).forEach(row => {
                    if (row.lead_id && row.client_id) {
                        leadClientMap.set(row.lead_id, row.client_id);
                        leadIds.push(row.lead_id);
                    }
                });

                if (leadIds.length === 0) {
                    return res.json({ leads: [] });
                }

                const data = await fetchLeadsWithSchemaFallback(workspaceId, leadIds, ALL_LEAD_COLUMNS);

                // Map the clientId onto each lead record
                const leadsWithClientId = (data || []).map((l: any) => {
                    const clRow = (clData || []).find(r => r.lead_id === l.id);
                    return {
                        ...l,
                        clientId: leadClientMap.get(l.id),
                        status: clRow?.status || 'Not Contacted',
                        notes: clRow?.notes || '',
                        dateAdded: l.created_at || new Date().toISOString()
                    };
                });

                return res.json({ leads: leadsWithClientId });
            }
        }
        if (process.env.NODE_ENV === 'test') {
            const leads = clientId ? dbService.getLeadsForClient(workspaceId, clientId as string) : dbService.getAllLeads(workspaceId);
            return res.json({ leads });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            const leads = clientId ? dbService.getLeadsForClient(workspaceId, clientId as string) : dbService.getAllLeads(workspaceId);
            return res.json({ leads });
        }
        logger.error('Lead fetch failed', { workspaceId, error: err.message });
        res.status(500).json({ error: 'Failed to fetch leads' });
    }
});

dataRouter.get('/workspaces/:workspaceId/clients/:clientId/export-leads', async (req: Request, res: Response) => {
    const { workspaceId, clientId } = req.params;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { data: clData, error: clError } = await getSupabaseServerClient
                .from('client_leads')
                .select('lead_id, status, notes')
                .eq('workspace_id', workspaceId)
                .eq('client_id', clientId);

            if (clError) throw clError;

            const leadIds = (clData || []).map((row: any) => row.lead_id).filter(Boolean);
            if (leadIds.length === 0) {
                return res.json({
                    success: true,
                    clientId,
                    leads: [],
                    diagnostics: { exportQueryReturnedCount: 0 }
                });
            }

            const leadsData = await fetchLeadsWithSchemaFallback(workspaceId, leadIds, ALL_LEAD_COLUMNS);

            if (leadsData) {
                const leadsWithMeta = leadsData.map((l: any) => {
                    const clRow = (clData || []).find(r => r.lead_id === l.id);
                    return {
                        ...l,
                        status: clRow?.status || 'Not Contacted',
                        notes: clRow?.notes || '',
                        dateAdded: l.created_at || new Date().toISOString()
                    };
                });
                return res.json({
                    success: true,
                    clientId,
                    leads: leadsWithMeta,
                    diagnostics: { exportQueryReturnedCount: leadsData.length }
                });
            }
        }
        if (process.env.NODE_ENV === 'test') {
            const leads = dbService.getLeadsForClient(workspaceId, clientId);
            return res.json({
                success: true,
                clientId,
                leads,
                diagnostics: { exportQueryReturnedCount: leads.length }
            });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            const leads = dbService.getLeadsForClient(workspaceId, clientId);
            return res.json({
                success: true,
                clientId,
                leads,
                diagnostics: { exportQueryReturnedCount: leads.length }
            });
        }
        logger.error('Export leads retrieval failed', { workspaceId, clientId, error: err.message });
        res.status(500).json({ error: 'Failed to retrieve leads for export' });
    }
});

dataRouter.post('/workspaces/:workspaceId/leads', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { clientId, leads } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const leadList = Array.isArray(leads) ? leads : [];
        if (getSupabaseServerClient) {
            // 1. Resolve existing IDs to prevent changing them during upsert
            const profileUrls = leadList
                .map((l: any) => (l.profile_url || l.profileUrl || l.linkedin_url || l.linkedinUrl))
                .filter(Boolean);
            
            const existingIdMap = new Map<string, string>();
            if (profileUrls.length > 0) {
                const { data: existingLeads } = await getSupabaseServerClient
                    .from('leads')
                    .select('id, profile_url')
                    .eq('workspace_id', workspaceId)
                    .in('profile_url', profileUrls);
                
                (existingLeads || []).forEach(row => {
                    existingIdMap.set(row.profile_url, row.id);
                });
            }

            // 2. Prepare leads with valid IDs and full field mapping
            const prepareLeadPayload = (l: any, minimal = false) => {
                const profileUrl = l.profile_url || l.profileUrl || l.linkedin_url || l.linkedinUrl || `https://www.linkedin.com/in/lead-${Math.random().toString(36).substr(2, 9)}`;
                
                const base = {
                    id: l.id || existingIdMap.get(profileUrl) || crypto.randomUUID(),
                    workspace_id: workspaceId,
                    full_name: l.full_name || l.fullName || l.name || 'Anonymous Lead',
                    headline: l.headline || l.job_title || l.title || l.headlineRole || '',
                    seniority: l.seniority || 'Entry',
                    current_job_title: l.current_job_title || l.currentJobTitle || l.job_title || l.title || '',
                    company_name: l.company_name || l.companyName || l.company || '',
                    location: l.location || l.country || '',
                    profile_url: profileUrl,
                    source: l.source || 'Wikidata',
                    organization_id: auth.user?.organizationId
                };

                if (minimal) return base;

                return {
                    ...base,
                    // Expanded professional fields
                    lead_type: l.lead_type || l.leadType || 'business',
                    business_category: l.business_category || l.businessCategory,
                    business_website: l.business_website || l.businessWebsite,
                    business_phone: l.business_phone || l.businessPhone,
                    business_address: l.business_address || l.businessAddress,
                    business_city: l.business_city || l.businessCity,
                    business_country: l.business_country || l.businessCountry,
                    latitude: l.latitude,
                    longitude: l.longitude,
                    business_email: l.business_email || l.businessEmail,
                    linkedin_profile_url: l.linkedin_profile_url || l.linkedInProfileUrl || l.profileUrl,
                    contact_source: l.contact_source || l.contactSource || l.source || 'Wikidata',
                    contact_verification_status: l.contact_verification_status || l.contactVerificationStatus || 'Not checked',
                    
                    // Instagram Discovery fields
                    instagram_username: l.instagram_username || l.instagramUsername,
                    instagram_profile_url: l.instagram_profile_url || l.instagramProfileUrl,
                    instagram_verification_status: l.instagram_verification_status || l.instagramVerificationStatus,
                    instagram_verification_evidence: l.instagram_verification_evidence || l.instagramVerificationEvidence,
                    instagram_discovery_source: l.instagram_discovery_source || l.instagramDiscoverySource,
                    instagram_last_checked_at: l.instagram_last_checked_at || l.instagramLastCheckedAt,
                    
                    // B2B Relevance & Intelligence fields
                    relevance_score: l.relevance_score || l.relevanceScore,
                    relevance_explanation: l.relevance_explanation || l.relevanceExplanation,
                    relevance_breakdown: l.relevance_breakdown || l.relevanceBreakdown,
                    b2b_classification: l.b2b_classification || l.b2bClassification || 'Discovered',
                    is_deceased: l.is_deceased ?? l.isDeceased,
                    date_of_death: l.date_of_death || l.dateOfDeath,
                    date_of_birth: l.date_of_birth || l.dateOfBirth,
                    entity_period: l.entity_period || l.entityPeriod,
                    active_evidence: l.active_evidence || l.activeEvidence
                };
            };

            let leadsToUpsert = leadList.map(l => prepareLeadPayload(l));
            let persistenceResult: any;

            try {
                // Try full payload first
                persistenceResult = await getSupabaseServerClient
                    .from('leads')
                    .upsert(leadsToUpsert, { onConflict: 'profile_url, workspace_id' })
                    .select(ALL_LEAD_COLUMNS);
                
                if (persistenceResult.error) throw persistenceResult.error;
            } catch (upsertErr: any) {
                // Handle various forms of 'column not found' errors
                const isSchemaError = upsertErr.message?.includes('column') || 
                                     upsertErr.message?.includes('cache') || 
                                     upsertErr.message?.includes('not found');

                if (isSchemaError) {
                    console.warn('[Persistence Warning] Production schema mismatch detected. Retrying with minimal core columns...', upsertErr.message);
                    leadsToUpsert = leadList.map(l => prepareLeadPayload(l, true));
                    persistenceResult = await getSupabaseServerClient
                        .from('leads')
                        .upsert(leadsToUpsert, { onConflict: 'profile_url, workspace_id' })
                        .select(CORE_LEAD_COLUMNS);
                    
                    if (persistenceResult.error) throw persistenceResult.error;
                } else {
                    throw upsertErr;
                }
            }

            const savedLeads = persistenceResult.data;

            if (clientId && savedLeads && savedLeads.length > 0) {
                // 3. Resolve existing client_leads IDs to prevent changing them
                const { data: existingCl } = await getSupabaseServerClient
                    .from('client_leads')
                    .select('id, lead_id')
                    .eq('client_id', clientId)
                    .in('lead_id', savedLeads.map((l: any) => l.id));
                
                const clIdMap = new Map<string, string>();
                (existingCl || []).forEach(row => {
                    clIdMap.set(row.lead_id, row.id);
                });

                const clientLeadsToUpsert = savedLeads.map((sl: any) => ({
                    id: clIdMap.get(sl.id) || crypto.randomUUID(),
                    client_id: clientId,
                    lead_id: sl.id,
                    workspace_id: workspaceId,
                    organization_id: auth.user?.organizationId
                }));

                const { error: clError } = await getSupabaseServerClient
                    .from('client_leads')
                    .upsert(clientLeadsToUpsert, { onConflict: 'client_id, lead_id' });

                if (clError) {
                    logger.warn('Failed to upsert client_leads junction records', { error: clError.message });
                }
            }

            logger.audit('Leads persisted', { 
                userId: auth.user?.userId, 
                workspaceId, 
                clientId, 
                count: savedLeads?.length || 0 
            });

            return res.status(200).json({
                success: true,
                added: savedLeads?.length || 0,
                persistenceStatus: 'confirmed',
                persistenceMessage: `Successfully persisted ${savedLeads?.length || 0} leads.`
            });
        }
        if (process.env.NODE_ENV === 'test') {
            const saveRes = dbService.saveLeadsForClient(auth.user?.organizationId || '', workspaceId, clientId, leadList);
            return res.status(200).json({
                success: true,
                added: saveRes.added,
                duplicatesSkipped: saveRes.duplicatesSkipped,
                persistenceStatus: 'confirmed',
                persistenceMessage: `Successfully persisted ${saveRes.added} leads.`
            });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            const saveRes = dbService.saveLeadsForClient(auth.user?.organizationId || '', workspaceId, clientId, Array.isArray(leads) ? leads : []);
            return res.status(200).json({
                success: true,
                added: saveRes.added,
                duplicatesSkipped: saveRes.duplicatesSkipped,
                persistenceStatus: 'confirmed',
                persistenceMessage: `Successfully persisted ${saveRes.added} leads.`
            });
        }
        logger.error('Lead persistence failed', { workspaceId, clientId, error: err.message });
        res.status(500).json({ error: err.message || 'Failed to save leads' });
    }
});

dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/status', async (req: Request, res: Response) => {
    const { workspaceId, leadId } = req.params;
    const { status, clientId } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            if (clientId) {
                // Update the status in the junction table for this specific client
                const { error } = await getSupabaseServerClient
                    .from('client_leads')
                    .update({ status, updated_at: new Date().toISOString() })
                    .eq('lead_id', leadId)
                    .eq('client_id', clientId)
                    .eq('workspace_id', workspaceId);
                
                if (error) throw error;
            } else {
                // Fallback or global update (if the leads table ever gets these columns, 
                // but the schema says they are in client_leads)
                const { error } = await getSupabaseServerClient
                    .from('leads')
                    .update({ status, updated_at: new Date().toISOString() })
                    .eq('id', leadId)
                    .eq('workspace_id', workspaceId);
                
                // If it fails because column doesn't exist, we don't throw if we updated at least one client_lead
                if (error && !error.message.includes('column')) throw error;
            }
            return res.status(200).json({ success: true });
        }
        
        if (process.env.NODE_ENV === 'test') {
            dbService.updateLeadStatus(workspaceId, leadId, status);
            return res.status(200).json({ success: true });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        logger.error('Lead status update failed', { workspaceId, leadId, error: err.message });
        res.status(500).json({ error: 'Failed to update lead status' });
    }
});

dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/notes', async (req: Request, res: Response) => {
    const { workspaceId, leadId } = req.params;
    const { notes, clientId } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            if (clientId) {
                await getSupabaseServerClient
                    .from('client_leads')
                    .update({ notes, updated_at: new Date().toISOString() })
                    .eq('lead_id', leadId)
                    .eq('client_id', clientId)
                    .eq('workspace_id', workspaceId);
            } else {
                await getSupabaseServerClient
                    .from('leads')
                    .update({ notes, updated_at: new Date().toISOString() })
                    .eq('id', leadId)
                    .eq('workspace_id', workspaceId);
            }
        }
        if (process.env.NODE_ENV === 'test') {
            dbService.updateLeadNotes(workspaceId, leadId, notes);
        }
        res.status(200).json({ success: true });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            dbService.updateLeadNotes(workspaceId, leadId, notes);
            return res.status(200).json({ success: true });
        }
        logger.error('Lead notes update failed', { workspaceId, leadId, error: err.message });
        res.status(500).json({ error: 'Failed to update lead notes' });
    }
});

dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/instagram', async (req: Request, res: Response) => {
    const { workspaceId, leadId } = req.params;
    const { instagramData } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { error } = await getSupabaseServerClient
                .from('leads')
                .update(instagramData)
                .eq('id', leadId)
                .eq('workspace_id', workspaceId);
            if (error) throw error;
            return res.status(200).json({ success: true });
        }
        
        if (process.env.NODE_ENV === 'test') {
            dbService.updateLeadInstagram(workspaceId, leadId, instagramData);
            return res.status(200).json({ success: true });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        logger.error('Lead Instagram update failed', { workspaceId, leadId, error: err.message });
        res.status(500).json({ error: 'Failed to update Instagram data' });
    }
});

dataRouter.post('/workspaces/:workspaceId/leads/delete-selected', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { leadIds } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            await getSupabaseServerClient
                .from('leads')
                .delete()
                .in('id', leadIds)
                .eq('workspace_id', workspaceId);
        }
        if (process.env.NODE_ENV === 'test') {
            dbService.deleteSelectedLeads(workspaceId, leadIds);
        }
        res.status(200).json({ success: true });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            dbService.deleteSelectedLeads(workspaceId, leadIds);
            return res.status(200).json({ success: true });
        }
        logger.error('Batch lead deletion failed', { workspaceId, error: err.message });
        res.status(500).json({ error: 'Failed to delete selected leads' });
    }
});

// --- SEARCHES ---

dataRouter.get('/workspaces/:workspaceId/searches', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            let { data, error } = await getSupabaseServerClient
                .from('lead_searches')
                .select('*')
                .eq('workspace_id', workspaceId)
                .order('created_at', { ascending: false });

            if (error) {
                const fallback = await getSupabaseServerClient
                    .from('search_history')
                    .select('*')
                    .eq('workspace_id', workspaceId)
                    .order('created_at', { ascending: false });
                data = fallback.data;
                error = fallback.error;
            }

            if (error) throw error;
            return res.json({ searches: data || [] });
        }
        if (process.env.NODE_ENV === 'test') {
            return res.json({ searches: dbService.getSearches(workspaceId) });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            return res.json({ searches: dbService.getSearches(workspaceId) });
        }
        logger.error('Searches fetch failed', { workspaceId, error: err.message });
        res.status(500).json({ error: 'Failed to fetch search history' });
    }
});

dataRouter.post('/workspaces/:workspaceId/searches', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const payload = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    const searchId = payload.searchId || payload.id;

    try {
        if (getSupabaseServerClient) {
            const cleanSearchRecord = {
                id: searchId || undefined,
                workspace_id: workspaceId,
                client_id: payload.clientId || payload.client_id || null,
                filters: payload.filters || {}
            };

            let { data, error } = await getSupabaseServerClient
                .from('lead_searches')
                .insert(cleanSearchRecord)
                .select()
                .maybeSingle();

            if (error) {
                const fallback = await getSupabaseServerClient
                    .from('search_history')
                    .insert({
                        ...payload,
                        id: searchId,
                        organization_id: auth.user?.organizationId,
                        workspace_id: workspaceId
                    })
                    .select()
                    .maybeSingle();
                data = fallback.data;
                error = fallback.error;
            }

            if (!error && data) return res.status(201).json({ search: data });
            if (error) throw error;
        }
        if (process.env.NODE_ENV === 'test') {
            const record = dbService.saveSearchRecord(
                auth.user?.organizationId || '',
                workspaceId,
                payload.clientId || '',
                payload.clientName || '',
                payload.filters || {},
                payload.candidatesFound || 0,
                payload.validLeads || 0,
                payload.duplicatesRemoved || 0,
                payload.finalLeadCount || 0,
                auth.user?.email || payload.createdBy || '',
                searchId
            );
            return res.status(201).json({ search: record });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            const record = dbService.saveSearchRecord(
                auth.user?.organizationId || '',
                workspaceId,
                payload.clientId || '',
                payload.clientName || '',
                payload.filters || {},
                payload.candidatesFound || 0,
                payload.validLeads || 0,
                payload.duplicatesRemoved || 0,
                payload.finalLeadCount || 0,
                auth.user?.email || payload.createdBy || '',
                searchId
            );
            return res.status(201).json({ search: record });
        }
        logger.error('Search record creation failed', { workspaceId, error: err.message });
        res.status(500).json({ error: err.message || 'Failed to save search history' });
    }
});

// --- GOOGLE INTEGRATIONS ---

dataRouter.get('/workspaces/:workspaceId/google-integrations', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { clientId } = req.query;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('google_integrations')
                .select('*')
                .eq('workspace_id', workspaceId)
                .eq('client_id', clientId)
                .maybeSingle();

            if (!error && data) return res.json({ integration: data });
        }
        if (process.env.NODE_ENV === 'test') {
            const integration = dbService.getGoogleIntegration(workspaceId, clientId as string);
            return res.json({ integration: integration || null });
        }
        return res.json({ integration: null });
    } catch {
        if (process.env.NODE_ENV === 'test') {
            const integration = dbService.getGoogleIntegration(workspaceId, clientId as string);
            return res.json({ integration: integration || null });
        }
        res.json({ integration: null });
    }
});

dataRouter.post('/workspaces/:workspaceId/google-integrations', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const integration = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('google_integrations')
                .upsert({
                    ...integration,
                    organization_id: auth.user?.organizationId,
                    workspace_id: workspaceId
                })
                .select()
                .single();

            if (!error && data) return res.status(201).json({ integration: data });
            if (error) throw error;
        }
        if (process.env.NODE_ENV === 'test') {
            dbService.saveGoogleIntegration({ ...integration, workspaceId, organizationId: auth.user?.organizationId });
            return res.status(201).json({ integration: { ...integration, workspaceId } });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            dbService.saveGoogleIntegration({ ...integration, workspaceId, organizationId: auth.user?.organizationId });
            return res.status(201).json({ integration: { ...integration, workspaceId } });
        }
        logger.error('Google integration save failed', { workspaceId, error: err.message });
        res.status(500).json({ error: 'Failed to save Google integration' });
    }
});

// --- EXPORT HISTORY ---

dataRouter.get('/workspaces/:workspaceId/export-history', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { clientId } = req.query;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            let query = getSupabaseServerClient
                .from('export_history')
                .select('*')
                .eq('workspace_id', workspaceId);

            if (clientId) {
                query = query.eq('client_id', clientId);
            }

            const { data, error } = await query.order('created_at', { ascending: false });
            if (!error && data) return res.json({ history: data });
        }
        if (process.env.NODE_ENV === 'test') {
            return res.json({ history: dbService.getExportHistory(workspaceId, clientId as string) });
        }
        return res.json({ history: [] });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            return res.json({ history: dbService.getExportHistory(workspaceId, clientId as string) });
        }
        logger.error('Export history fetch failed', { workspaceId, error: err.message });
        res.json({ history: [] });
    }
});

dataRouter.post('/workspaces/:workspaceId/export-history', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const record = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('export_history')
                .insert({
                    ...record,
                    organization_id: auth.user?.organizationId,
                    workspace_id: workspaceId
                })
                .select()
                .single();

            if (!error && data) return res.status(201).json({ record: data });
        }
        if (process.env.NODE_ENV === 'test') {
            const rec = {
                ...record,
                id: record.id || `export-${Date.now()}`,
                workspaceId,
                organizationId: auth.user?.organizationId,
                createdAt: new Date().toISOString()
            };
            dbService.saveExportHistory(rec);
            return res.status(201).json({ record: rec });
        }
        return res.status(503).json({ error: 'Database service unavailable' });
    } catch (err: any) {
        if (process.env.NODE_ENV === 'test') {
            const rec = {
                ...record,
                id: record.id || `export-${Date.now()}`,
                workspaceId,
                organizationId: auth.user?.organizationId,
                createdAt: new Date().toISOString()
            };
            dbService.saveExportHistory(rec);
            return res.status(201).json({ record: rec });
        }
        logger.error('Export history save failed', { workspaceId, error: err.message });
        res.status(500).json({ error: 'Failed to save export history' });
    }
});

// --- TEAM MANAGEMENT ---

dataRouter.get('/organizations/:orgId/members', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const auth = await verifyOrganizationAccess(req, orgId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('team_members')
                .select('*')
                .eq('organization_id', orgId)
                .order('created_at', { ascending: true });

            if (!error && data) return res.json({ members: data });
        }
        res.json({ members: [{ id: `member-${auth.user?.userId}`, organization_id: orgId, user_id: auth.user?.userId, role: auth.user?.role || 'owner', email: auth.user?.email }] });
    } catch {
        res.json({ members: [{ id: `member-${auth.user?.userId}`, organization_id: orgId, user_id: auth.user?.userId, role: auth.user?.role || 'owner', email: auth.user?.email }] });
    }
});

dataRouter.get('/organizations/:orgId/invitations', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const auth = await verifyOrganizationAccess(req, orgId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('team_invitations')
                .select('*')
                .eq('organization_id', orgId)
                .order('created_at', { ascending: false });

            if (!error && data) return res.json({ invitations: data });
        }
        res.json({ invitations: [] });
    } catch {
        res.json({ invitations: [] });
    }
});

dataRouter.post('/organizations/:orgId/invitations', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const { email, role } = req.body;
    const auth = await verifyOrganizationAccess(req, orgId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });
    if (auth.user?.role !== 'owner' && auth.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Only owners and admins can invite members.' });
    }

    try {
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('team_invitations')
                .insert({
                    organization_id: orgId,
                    email,
                    role,
                    invited_by: auth.user.userId,
                    token,
                    expires_at: expiresAt
                })
                .select()
                .single();

            if (!error && data) return res.status(201).json({ invitation: data });
        }
        res.status(201).json({
            invitation: {
                id: `inv-${Date.now()}`,
                organization_id: orgId,
                email,
                role,
                invited_by: auth.user.userId,
                token,
                expires_at: expiresAt
            }
        });
    } catch {
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        res.status(201).json({
            invitation: {
                id: `inv-${Date.now()}`,
                organization_id: orgId,
                email,
                role,
                invited_by: auth.user.userId,
                token,
                expires_at: expiresAt
            }
        });
    }
});

dataRouter.delete('/organizations/:orgId/invitations/:invId', async (req: Request, res: Response) => {
    const { orgId, invId } = req.params;
    const auth = await verifyOrganizationAccess(req, orgId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            await getSupabaseServerClient
                .from('team_invitations')
                .delete()
                .eq('id', invId)
                .eq('organization_id', orgId);
        }
        res.status(200).json({ success: true });
    } catch {
        res.status(200).json({ success: true });
    }
});

dataRouter.get('/production-audit', async (req: Request, res: Response) => {
    const auth = await verifyServerAuthToken(req);
    if (auth.status !== 200 || !auth.user?.organizationId) return res.status(auth.status).json({ error: 'Unauthorized' });

    try {
        const supabase = getSupabaseServerClient;
        if (!supabase) return res.status(503).json({ error: 'Database unavailable' });

        const { count: orgLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('organization_id', auth.user.organizationId);
        const { count: globalLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true });
        
        res.json({
            organizationId: auth.user.organizationId,
            orgLeadCount: orgLeads || 0,
            globalLeads
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
