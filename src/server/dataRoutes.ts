import crypto from 'node:crypto';
import express, { Request, Response } from 'express';
import { supabase as getSupabaseServerClient } from '../services/supabase';
import { 
    verifyServerAuthToken, 
    verifyWorkspaceAccess,
    verifyOrganizationAccess,
    getDeterministicOrganizationId, 
    getDeterministicWorkspaceId 
} from './serverAuthService';
import { Organization, Workspace, Client, LeadRecord, SearchHistoryRecord, GoogleIntegration, ExportHistoryRecord } from '../types';
import { logger } from '../services/loggerService';

export const dataRouter = express.Router();

/**
 * Onboarding: Idempotently creates an organization and default workspace for a new user.
 */
dataRouter.post('/onboard', async (req: Request, res: Response) => {
    const auth = await verifyServerAuthToken(req);
    if (auth.status !== 200 || !auth.user) return res.status(auth.status).json({ error: auth.error });

    const supabase = getSupabaseServerClient;
    if (!supabase) return res.status(503).json({ error: 'Database unavailable' });

    const userId = auth.user.userId;
    const email = auth.user.email || '';
    const orgId = getDeterministicOrganizationId(userId);
    const wsId = getDeterministicWorkspaceId(userId);

    try {
        // 1. Ensure Organization exists
        const { data: existingOrg } = await supabase
            .from('organizations')
            .select('*')
            .eq('id', orgId)
            .maybeSingle();

        let organization: Organization;

        if (!existingOrg) {
            const { data: newOrg, error: orgError } = await supabase
                .from('organizations')
                .insert({
                    id: orgId,
                    name: `${email.split('@')[0]}'s Organization`,
                    owner_id: userId
                })
                .select()
                .single();

            if (orgError) throw orgError;
            organization = newOrg;

            // Add owner to team_members
            await supabase.from('team_members').insert({
                organization_id: orgId,
                user_id: userId,
                role: 'owner'
            });
        } else {
            organization = existingOrg;
        }

        // 2. Ensure Default Workspace exists
        const { data: existingWs } = await supabase
            .from('workspaces')
            .select('*')
            .eq('id', wsId)
            .maybeSingle();

        let workspace: Workspace;

        if (!existingWs) {
            const { data: newWs, error: wsError } = await supabase
                .from('workspaces')
                .insert({
                    id: wsId,
                    organization_id: orgId,
                    name: 'Default Workspace',
                    description: 'Your primary lead research workspace.'
                })
                .select()
                .single();

            if (wsError) throw wsError;
            workspace = newWs;
        } else {
            workspace = existingWs;
        }

        logger.audit('User onboarded', { userId, organizationId: orgId, workspaceId: wsId });

        res.json({
            onboarded: true,
            organization,
            workspaces: [workspace]
        });
    } catch (err: any) {
        logger.error('Onboarding failed', { userId, error: err });
        res.status(500).json({ error: err.message });
    }
});

// --- CLIENTS ---

dataRouter.get('/workspaces/:workspaceId/clients', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { data, error } = await getSupabaseServerClient!
            .from('clients')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ clients: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.post('/workspaces/:workspaceId/clients', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { name, niche, notes } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { data, error } = await getSupabaseServerClient!
            .from('clients')
            .insert({
                organization_id: auth.user?.organizationId,
                workspace_id: workspaceId,
                name,
                niche,
                notes
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ client: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.put('/workspaces/:workspaceId/clients/:clientId', async (req: Request, res: Response) => {
    const { workspaceId, clientId } = req.params;
    const updates = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { data, error } = await getSupabaseServerClient!
            .from('clients')
            .update(updates)
            .eq('id', clientId)
            .eq('workspace_id', workspaceId)
            .select()
            .single();

        if (error) throw error;
        res.json({ client: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.delete('/workspaces/:workspaceId/clients/:clientId', async (req: Request, res: Response) => {
    const { workspaceId, clientId } = req.params;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { error } = await getSupabaseServerClient!
            .from('clients')
            .delete()
            .eq('id', clientId)
            .eq('workspace_id', workspaceId);

        if (error) throw error;
        res.status(204).end();
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// --- LEADS ---

dataRouter.get('/workspaces/:workspaceId/leads', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { clientId } = req.query;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        let query = getSupabaseServerClient!
            .from('leads')
            .select('*')
            .eq('workspace_id', workspaceId);

        if (clientId) {
            query = query.eq('client_id', clientId);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ leads: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.post('/workspaces/:workspaceId/leads', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { clientId, leads, searchId } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const orgId = auth.user?.organizationId;
        const leadsWithContext = leads.map((l: any) => ({
            ...l,
            organization_id: orgId,
            workspace_id: workspaceId,
            client_id: clientId,
            search_id: searchId
        }));

        // Batch upsert leads
        const { data, error } = await getSupabaseServerClient!
            .from('leads')
            .upsert(leadsWithContext, { onConflict: 'profile_url, workspace_id, client_id' })
            .select();

        if (error) throw error;

        logger.audit('Leads persisted', { 
            userId: auth.user?.userId, 
            organizationId: orgId, 
            workspaceId, 
            clientId, 
            count: data.length 
        });

        res.status(201).json({
            success: true,
            added: data.length,
            persistenceStatus: 'confirmed',
            persistenceMessage: `Successfully persisted ${data.length} leads.`
        });
    } catch (err: any) {
        logger.error('Lead save failed', { 
            userId: auth.user?.userId, 
            organizationId: auth.user?.organizationId, 
            workspaceId, 
            error: err 
        });
        res.status(500).json({ error: err.message });
    }
});

dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/status', async (req: Request, res: Response) => {
    const { workspaceId, leadId } = req.params;
    const { status } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { error } = await getSupabaseServerClient!
            .from('leads')
            .update({ status })
            .eq('id', leadId)
            .eq('workspace_id', workspaceId);

        if (error) throw error;
        res.status(204).end();
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/notes', async (req: Request, res: Response) => {
    const { workspaceId, leadId } = req.params;
    const { notes } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { error } = await getSupabaseServerClient!
            .from('leads')
            .update({ notes })
            .eq('id', leadId)
            .eq('workspace_id', workspaceId);

        if (error) throw error;
        res.status(204).end();
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/instagram', async (req: Request, res: Response) => {
    const { workspaceId, leadId } = req.params;
    const { instagramData } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { error } = await getSupabaseServerClient!
            .from('leads')
            .update(instagramData)
            .eq('id', leadId)
            .eq('workspace_id', workspaceId);

        if (error) throw error;
        res.status(204).end();
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.post('/workspaces/:workspaceId/leads/delete-selected', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { leadIds } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { error } = await getSupabaseServerClient!
            .from('leads')
            .delete()
            .in('id', leadIds)
            .eq('workspace_id', workspaceId);

        if (error) throw error;
        res.status(204).end();
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// --- SEARCHES ---

dataRouter.get('/workspaces/:workspaceId/searches', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { data, error } = await getSupabaseServerClient!
            .from('search_history')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ searches: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.post('/workspaces/:workspaceId/searches', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const payload = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { data, error } = await getSupabaseServerClient!
            .from('search_history')
            .insert({
                ...payload,
                organization_id: auth.user?.organizationId,
                workspace_id: workspaceId
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ search: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// --- GOOGLE INTEGRATIONS ---

dataRouter.get('/workspaces/:workspaceId/google-integrations', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { clientId } = req.query;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { data, error } = await getSupabaseServerClient!
            .from('google_integrations')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('client_id', clientId)
            .maybeSingle();

        if (error) throw error;
        res.json({ integration: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.post('/workspaces/:workspaceId/google-integrations', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const integration = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { data, error } = await getSupabaseServerClient!
            .from('google_integrations')
            .upsert({
                ...integration,
                organization_id: auth.user?.organizationId,
                workspace_id: workspaceId
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ integration: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// --- EXPORT HISTORY ---

dataRouter.get('/workspaces/:workspaceId/export-history', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { clientId } = req.query;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        let query = getSupabaseServerClient!
            .from('export_history')
            .select('*')
            .eq('workspace_id', workspaceId);

        if (clientId) {
            query = query.eq('client_id', clientId);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ history: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.post('/workspaces/:workspaceId/export-history', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const record = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { data, error } = await getSupabaseServerClient!
            .from('export_history')
            .insert({
                ...record,
                organization_id: auth.user?.organizationId,
                workspace_id: workspaceId
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ record: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// --- TEAM MANAGEMENT ---

dataRouter.get('/organizations/:orgId/members', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const auth = await verifyOrganizationAccess(req, orgId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { data, error } = await getSupabaseServerClient!
            .from('team_members')
            .select('*')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json({ members: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.get('/organizations/:orgId/invitations', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const auth = await verifyOrganizationAccess(req, orgId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { data, error } = await getSupabaseServerClient!
            .from('team_invitations')
            .select('*')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ invitations: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
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

        const { data, error } = await getSupabaseServerClient!
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

        if (error) throw error;
        res.status(201).json({ invitation: data });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

dataRouter.delete('/organizations/:orgId/invitations/:invId', async (req: Request, res: Response) => {
    const { orgId, invId } = req.params;
    const auth = await verifyOrganizationAccess(req, orgId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const { error } = await getSupabaseServerClient!
            .from('team_invitations')
            .delete()
            .eq('id', invId)
            .eq('organization_id', orgId);

        if (error) throw error;
        res.status(204).end();
    } catch (err: any) {
        res.status(500).json({ error: err.message });
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
