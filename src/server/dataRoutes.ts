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
import { dbService } from '../services/storage';

export const dataRouter = express.Router();

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
        }
        res.json({ workspaces: [defaultWorkspace] });
    } catch {
        res.json({ workspaces: [defaultWorkspace] });
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
        }

        const newWs = dbService.createWorkspace(userOrgId, name.trim(), description || '');
        res.status(201).json({ workspace: newWs });
    } catch (err: any) {
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

            if (!error && data) return res.json({ clients: data });
        }
        res.json({ clients: dbService.getClients(workspaceId) });
    } catch {
        res.json({ clients: dbService.getClients(workspaceId) });
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
                    organization_id: auth.user?.organizationId,
                    workspace_id: workspaceId,
                    name,
                    niche,
                    notes
                })
                .select()
                .single();

            if (!error && data) return res.status(201).json({ client: data });
        }
        const client = dbService.addClient(workspaceId, name, niche, notes);
        if (auth.user?.organizationId) client.organizationId = auth.user.organizationId;
        res.status(201).json({ client });
    } catch {
        const client = dbService.addClient(workspaceId, name, niche, notes);
        res.status(201).json({ client });
    }
});

dataRouter.put('/workspaces/:workspaceId/clients/:clientId', async (req: Request, res: Response) => {
    const { workspaceId, clientId } = req.params;
    const updates = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('clients')
                .update(updates)
                .eq('id', clientId)
                .eq('workspace_id', workspaceId)
                .select()
                .single();

            if (!error && data) return res.json({ client: data });
        }
        const client = dbService.updateClient(workspaceId, clientId, updates);
        res.json({ client });
    } catch (err: any) {
        try {
            const client = dbService.updateClient(workspaceId, clientId, updates);
            res.json({ client });
        } catch (innerErr: any) {
            res.status(500).json({ error: innerErr.message });
        }
    }
});

dataRouter.delete('/workspaces/:workspaceId/clients/:clientId', async (req: Request, res: Response) => {
    const { workspaceId, clientId } = req.params;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            await getSupabaseServerClient
                .from('clients')
                .delete()
                .eq('id', clientId)
                .eq('workspace_id', workspaceId);
        }
        dbService.deleteClient(workspaceId, clientId);
        res.status(200).json({ success: true });
    } catch {
        dbService.deleteClient(workspaceId, clientId);
        res.status(200).json({ success: true });
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
            let query = getSupabaseServerClient
                .from('leads')
                .select('*')
                .eq('workspace_id', workspaceId);

            if (clientId) {
                query = query.eq('client_id', clientId);
            }

            const { data, error } = await query.order('created_at', { ascending: false });
            if (!error && data) return res.json({ leads: data });
        }
        const leads = clientId ? dbService.getLeadsForClient(workspaceId, clientId as string) : dbService.getAllLeads(workspaceId);
        res.json({ leads });
    } catch {
        const leads = clientId ? dbService.getLeadsForClient(workspaceId, clientId as string) : dbService.getAllLeads(workspaceId);
        res.json({ leads });
    }
});

dataRouter.get('/workspaces/:workspaceId/clients/:clientId/export-leads', async (req: Request, res: Response) => {
    const { workspaceId, clientId } = req.params;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        let leads: any[] = [];
        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('leads')
                .select('*')
                .eq('workspace_id', workspaceId)
                .eq('client_id', clientId)
                .order('created_at', { ascending: false });

            if (!error && data) {
                leads = data;
            } else {
                leads = dbService.getLeadsForClient(workspaceId, clientId);
            }
        } else {
            leads = dbService.getLeadsForClient(workspaceId, clientId);
        }

        res.json({
            success: true,
            clientId,
            leads,
            diagnostics: {
                exportQueryReturnedCount: leads.length
            }
        });
    } catch {
        const leads = dbService.getLeadsForClient(workspaceId, clientId);
        res.json({
            success: true,
            clientId,
            leads,
            diagnostics: {
                exportQueryReturnedCount: leads.length
            }
        });
    }
});

dataRouter.post('/workspaces/:workspaceId/leads', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { clientId, leads, searchId } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        const orgId = auth.user?.organizationId;
        const leadList = Array.isArray(leads) ? leads : [];
        const leadsWithContext = leadList.map((l: any) => ({
            ...l,
            organization_id: orgId,
            workspace_id: workspaceId,
            client_id: clientId,
            search_id: searchId
        }));

        if (getSupabaseServerClient) {
            const { data, error } = await getSupabaseServerClient
                .from('leads')
                .upsert(leadsWithContext, { onConflict: 'profile_url, workspace_id, client_id' })
                .select();

            if (!error && data) {
                logger.audit('Leads persisted', { 
                    userId: auth.user?.userId, 
                    organizationId: orgId, 
                    workspaceId, 
                    clientId, 
                    count: data.length 
                });

                return res.status(200).json({
                    success: true,
                    added: data.length,
                    persistenceStatus: 'confirmed',
                    persistenceMessage: `Successfully persisted ${data.length} leads.`
                });
            }
        }

        const saveRes = dbService.saveLeadsForClient(orgId || '', workspaceId, clientId, leadList);
        res.status(200).json({
            success: true,
            added: saveRes.added,
            duplicatesSkipped: saveRes.duplicatesSkipped,
            persistenceStatus: 'confirmed',
            persistenceMessage: `Successfully persisted ${saveRes.added} leads.`
        });
    } catch {
        const orgId = auth.user?.organizationId;
        const saveRes = dbService.saveLeadsForClient(orgId || '', workspaceId, clientId, Array.isArray(leads) ? leads : []);
        res.status(200).json({
            success: true,
            added: saveRes.added,
            duplicatesSkipped: saveRes.duplicatesSkipped,
            persistenceStatus: 'confirmed',
            persistenceMessage: `Successfully persisted ${saveRes.added} leads.`
        });
    }
});

dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/status', async (req: Request, res: Response) => {
    const { workspaceId, leadId } = req.params;
    const { status } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            await getSupabaseServerClient
                .from('leads')
                .update({ status })
                .eq('id', leadId)
                .eq('workspace_id', workspaceId);
        }
        dbService.updateLeadStatus(workspaceId, leadId, status);
        res.status(200).json({ success: true });
    } catch {
        dbService.updateLeadStatus(workspaceId, leadId, status);
        res.status(200).json({ success: true });
    }
});

dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/notes', async (req: Request, res: Response) => {
    const { workspaceId, leadId } = req.params;
    const { notes } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            await getSupabaseServerClient
                .from('leads')
                .update({ notes })
                .eq('id', leadId)
                .eq('workspace_id', workspaceId);
        }
        dbService.updateLeadNotes(workspaceId, leadId, notes);
        res.status(200).json({ success: true });
    } catch {
        dbService.updateLeadNotes(workspaceId, leadId, notes);
        res.status(200).json({ success: true });
    }
});

dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/instagram', async (req: Request, res: Response) => {
    const { workspaceId, leadId } = req.params;
    const { instagramData } = req.body;
    const auth = await verifyWorkspaceAccess(req, workspaceId);
    if (!auth.authorized) return res.status(auth.status).json({ error: auth.error });

    try {
        if (getSupabaseServerClient) {
            await getSupabaseServerClient
                .from('leads')
                .update(instagramData)
                .eq('id', leadId)
                .eq('workspace_id', workspaceId);
        }
        dbService.updateLeadInstagram(workspaceId, leadId, instagramData);
        res.status(200).json({ success: true });
    } catch {
        dbService.updateLeadInstagram(workspaceId, leadId, instagramData);
        res.status(200).json({ success: true });
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
        dbService.deleteSelectedLeads(workspaceId, leadIds);
        res.status(200).json({ success: true });
    } catch {
        dbService.deleteSelectedLeads(workspaceId, leadIds);
        res.status(200).json({ success: true });
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

            if (!error && data) return res.json({ searches: data || [] });
        }
        res.json({ searches: dbService.getSearches(workspaceId) });
    } catch {
        res.json({ searches: dbService.getSearches(workspaceId) });
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
            let { data, error } = await getSupabaseServerClient
                .from('lead_searches')
                .insert({
                    ...payload,
                    id: searchId,
                    organization_id: auth.user?.organizationId,
                    workspace_id: workspaceId
                })
                .select()
                .single();

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
                    .single();
                data = fallback.data;
                error = fallback.error;
            }

            if (!error && data) return res.status(201).json({ search: data });
        }
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
        res.status(201).json({ search: record });
    } catch {
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
        res.status(201).json({ search: record });
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
        const integration = dbService.getGoogleIntegration(workspaceId, clientId as string);
        res.json({ integration: integration || null });
    } catch {
        const integration = dbService.getGoogleIntegration(workspaceId, clientId as string);
        res.json({ integration: integration || null });
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
        }
        dbService.saveGoogleIntegration({ ...integration, workspaceId, organizationId: auth.user?.organizationId });
        res.status(201).json({ integration: { ...integration, workspaceId } });
    } catch {
        dbService.saveGoogleIntegration({ ...integration, workspaceId, organizationId: auth.user?.organizationId });
        res.status(201).json({ integration: { ...integration, workspaceId } });
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
        res.json({ history: dbService.getExportHistory(workspaceId, clientId as string) });
    } catch {
        res.json({ history: dbService.getExportHistory(workspaceId, clientId as string) });
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
        const rec = {
            ...record,
            id: record.id || `export-${Date.now()}`,
            workspaceId,
            organizationId: auth.user?.organizationId,
            createdAt: new Date().toISOString()
        };
        dbService.saveExportHistory(rec);
        res.status(201).json({ record: rec });
    } catch {
        const rec = {
            ...record,
            id: record.id || `export-${Date.now()}`,
            workspaceId,
            organizationId: auth.user?.organizationId,
            createdAt: new Date().toISOString()
        };
        dbService.saveExportHistory(rec);
        res.status(201).json({ record: rec });
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
