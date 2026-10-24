import express, { Request, Response } from 'express';
import { supabase } from '../services/supabase';
import { dbService } from '../services/storage';
import {
  verifyServerAuthToken,
  verifyWorkspaceAccess,
  registerWorkspaceAuthorization,
  isUserAuthorizedForWorkspace
} from './serverAuthService';
import {
  Client,
  LeadRecord,
  LeadStatus,
  LeadFilter,
  SearchHistoryRecord,
  Workspace,
  InstagramVerificationStatus
} from '../types';

export const dataRouter = express.Router();

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ==========================================
// 1. WORKSPACE ENDPOINTS
// ==========================================

/**
 * GET /api/workspaces
 * Retrieves all workspaces accessible to the authenticated user.
 */
dataRouter.get('/workspaces', async (req: Request, res: Response) => {
  const auth = await verifyServerAuthToken(req);
  if (auth.status !== 200 || !auth.user) {
    res.status(auth.status).json({ error: auth.error || 'Authentication required.' });
    return;
  }

  try {
    const allWorkspaces = dbService.getWorkspaces();
    const authorizedList: Workspace[] = [];

    for (const ws of allWorkspaces) {
      const authorized = await isUserAuthorizedForWorkspace(
        auth.user.userId,
        ws.id,
        auth.user.email
      );
      if (authorized) {
        authorizedList.push(ws);
      }
    }

    // If user has no workspaces authorized yet, automatically initialize a personalized workspace
    if (authorizedList.length === 0) {
      const rawName = auth.user.email
        ? auth.user.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : 'User';
      const wsName = `${rawName}'s Workspace`;
      const wsDesc = `Primary workspace for ${auth.user.email || rawName}`;

      const newWs = dbService.createWorkspace(wsName, wsDesc);
      registerWorkspaceAuthorization(auth.user.userId, newWs.id);

      if (supabase) {
        try {
          await supabase.from('workspaces').insert([
            {
              id: newWs.id,
              name: newWs.name,
              description: newWs.description || null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ]);

          await supabase.from('users').upsert(
            [
              {
                id: auth.user.userId,
                email: auth.user.email || `${auth.user.userId}@leadfinder.app`,
                full_name: rawName,
                workspace_id: newWs.id,
                role: 'owner',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }
            ],
            { onConflict: 'email' }
          );
        } catch (dbErr) {
          console.warn('Database workspace sync error during auto-initialization:', dbErr);
        }
      }

      authorizedList.push(newWs);
    }

    res.json({ workspaces: authorizedList });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to retrieve workspaces.' });
  }
});

/**
 * POST /api/workspaces
 * Creates a new isolated workspace for the authenticated user.
 */
dataRouter.post('/workspaces', async (req: Request, res: Response) => {
  const auth = await verifyServerAuthToken(req);
  if (auth.status !== 200 || !auth.user) {
    res.status(auth.status).json({ error: auth.error || 'Authentication required.' });
    return;
  }

  const { name, description } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Workspace name is required.' });
    return;
  }

  try {
    const newWs = dbService.createWorkspace(name.trim(), (description || '').trim());
    registerWorkspaceAuthorization(auth.user.userId, newWs.id);

    if (supabase) {
      try {
        await supabase.from('workspaces').insert([
          {
            id: newWs.id,
            name: newWs.name,
            description: newWs.description || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]);

        await supabase.from('users').upsert(
          [
            {
              id: auth.user.userId,
              email: auth.user.email || `${auth.user.userId}@leadfinder.app`,
              full_name: auth.user.email?.split('@')[0] || 'User',
              workspace_id: newWs.id,
              role: 'owner',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ],
          { onConflict: 'email' }
        );
      } catch (dbErr) {
        console.warn('Database workspace sync error:', dbErr);
      }
    }

    res.status(201).json({ workspace: newWs });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create workspace.' });
  }
});

// ==========================================
// 2. CLIENT ENDPOINTS
// ==========================================

/**
 * GET /api/workspaces/:workspaceId/clients
 * Lists all clients for an authorized workspace.
 */
dataRouter.get('/workspaces/:workspaceId/clients', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        const localLeads = dbService.getAllLeads(workspaceId);
        const localSearches = dbService.getSearches(workspaceId);

        const clients: Client[] = data.map((c: any) => ({
          id: c.id,
          workspaceId: c.workspace_id,
          name: c.name,
          niche: c.niche || '',
          notes: c.notes || '',
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          leadsCount: localLeads.filter((l) => l.clientId === c.id).length,
          searchesCount: localSearches.filter((s) => s.clientId === c.id).length
        }));

        dbService.syncClientsForWorkspace(workspaceId, clients);
        res.json({ clients });
        return;
      }
    }

    const clients = dbService.getClients(workspaceId);
    res.json({ clients });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch clients.' });
  }
});

/**
 * POST /api/workspaces/:workspaceId/clients
 * Creates a new client within the specified workspace.
 */
dataRouter.post('/workspaces/:workspaceId/clients', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const { name, niche, notes } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Cannot create client: Client name is required.' });
    return;
  }
  if (!niche || typeof niche !== 'string' || !niche.trim()) {
    res.status(400).json({ error: 'Cannot create client: Business / Niche is required.' });
    return;
  }

  const id = generateUuid();
  const now = new Date().toISOString();

  const newClient: Client = {
    id,
    workspaceId,
    name: name.trim(),
    niche: niche.trim(),
    notes: (notes || '').trim(),
    createdAt: now,
    updatedAt: now,
    leadsCount: 0,
    searchesCount: 0
  };

  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('clients')
        .insert([
          {
            id,
            workspace_id: workspaceId,
            name: name.trim(),
            niche: niche.trim(),
            notes: (notes || '').trim(),
            created_at: now,
            updated_at: now
          }
        ])
        .select();

      if (error) {
        console.error('Supabase server createClient error:', error.message);
        throw new Error(`Database rejected client creation: ${error.message}`);
      }

      if (!data || data.length === 0) {
        throw new Error('Database did not return confirmed client record.');
      }
    }

    dbService.createClientWithId(id, workspaceId, name.trim(), niche.trim(), (notes || '').trim(), now);
    res.status(201).json({ client: newClient });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create client.' });
  }
});

/**
 * PUT /api/workspaces/:workspaceId/clients/:clientId
 * Updates client details within workspace.
 */
dataRouter.put('/workspaces/:workspaceId/clients/:clientId', async (req: Request, res: Response) => {
  const { workspaceId, clientId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const { name, niche, notes } = req.body;
  const now = new Date().toISOString();

  try {
    if (supabase) {
      const dbUpdates: any = { updated_at: now };
      if (name !== undefined) dbUpdates.name = name.trim();
      if (niche !== undefined) dbUpdates.niche = niche.trim();
      if (notes !== undefined) dbUpdates.notes = notes.trim();

      const { error } = await supabase
        .from('clients')
        .update(dbUpdates)
        .eq('id', clientId)
        .eq('workspace_id', workspaceId);

      if (error) {
        throw new Error(`Failed to update client in database: ${error.message}`);
      }
    }

    const updated = dbService.updateClient(workspaceId, clientId, { name, niche, notes });
    res.json({ client: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update client.' });
  }
});

/**
 * DELETE /api/workspaces/:workspaceId/clients/:clientId
 * Deletes a client and cascaded relationships within workspace.
 */
dataRouter.delete('/workspaces/:workspaceId/clients/:clientId', async (req: Request, res: Response) => {
  const { workspaceId, clientId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  try {
    if (supabase) {
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', clientId)
        .eq('workspace_id', workspaceId);

      if (error) {
        throw new Error(`Failed to delete client from database: ${error.message}`);
      }
    }

    dbService.deleteClient(workspaceId, clientId);
    res.json({ success: true, clientId });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete client.' });
  }
});

// ==========================================
// 3. LEADS ENDPOINTS
// ==========================================

/**
 * GET /api/workspaces/:workspaceId/leads
 * Retrieves leads for a workspace, optionally filtered by clientId.
 */
dataRouter.get('/workspaces/:workspaceId/leads', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const clientId = req.query.clientId as string | undefined;

  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  try {
    if (clientId) {
      const leads = dbService.getLeadsForClient(workspaceId, clientId);
      res.json({ leads });
      return;
    }
    const leads = dbService.getAllLeads(workspaceId);
    res.json({ leads });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch leads.' });
  }
});

/**
 * POST /api/workspaces/:workspaceId/leads
 * Saves leads discovered for a client into the authorized workspace.
 */
dataRouter.post('/workspaces/:workspaceId/leads', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const { clientId, leads, searchId } = req.body;
  if (!clientId || !Array.isArray(leads)) {
    res.status(400).json({ error: 'clientId and leads array are required.' });
    return;
  }

  try {
    const localResult = dbService.saveLeadsForClient(workspaceId, clientId, leads);

    if (supabase && leads.length > 0) {
      const leadRows = leads.map((l: LeadRecord) => ({
        id: l.id && l.id.length > 20 ? l.id : generateUuid(),
        workspace_id: workspaceId,
        full_name: l.fullName,
        headline: l.headline,
        current_job_title: l.currentJobTitle,
        company_name: l.companyName,
        location: l.location,
        profile_url: l.profileUrl,
        connections_or_followers: l.connectionsOrFollowers,
        last_activity_date: l.lastActivityDate,
        source: l.source || 'Wikidata SPARQL Query Service',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      await supabase.from('leads').upsert(leadRows, {
        onConflict: 'workspace_id,profile_url',
        ignoreDuplicates: true
      });

      const clientLeadRows = leadRows.map((lead: any) => ({
        id: generateUuid(),
        workspace_id: workspaceId,
        client_id: clientId,
        lead_id: lead.id,
        search_id: searchId || null,
        status: 'Not Contacted',
        notes: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      await supabase.from('client_leads').upsert(clientLeadRows, {
        onConflict: 'client_id,lead_id',
        ignoreDuplicates: true
      });
    }

    res.json({
      success: true,
      added: localResult.added,
      duplicatesSkipped: localResult.duplicatesSkipped,
      persistenceStatus: supabase ? 'confirmed' : 'local_only',
      persistenceMessage: supabase
        ? 'Leads persisted securely to workspace.'
        : 'Leads saved in local workspace cache.'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save leads.' });
  }
});

/**
 * PATCH /api/workspaces/:workspaceId/leads/:leadId/status
 * Updates lead status.
 */
dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/status', async (req: Request, res: Response) => {
  const { workspaceId, leadId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const { status } = req.body;
  if (!status) {
    res.status(400).json({ error: 'Status is required.' });
    return;
  }

  try {
    if (supabase) {
      await supabase
        .from('client_leads')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('lead_id', leadId)
        .eq('workspace_id', workspaceId);
    }

    dbService.updateLeadStatus(workspaceId, leadId, status as LeadStatus);
    res.json({ success: true, leadId, status });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update lead status.' });
  }
});

/**
 * PATCH /api/workspaces/:workspaceId/leads/:leadId/notes
 * Updates lead notes.
 */
dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/notes', async (req: Request, res: Response) => {
  const { workspaceId, leadId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const { notes } = req.body;

  try {
    if (supabase) {
      await supabase
        .from('client_leads')
        .update({ notes: notes || '', updated_at: new Date().toISOString() })
        .eq('lead_id', leadId)
        .eq('workspace_id', workspaceId);
    }

    dbService.updateLeadNotes(workspaceId, leadId, notes || '');
    res.json({ success: true, leadId, notes });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update lead notes.' });
  }
});

/**
 * PATCH /api/workspaces/:workspaceId/leads/:leadId/instagram
 * Updates lead Instagram verification details.
 */
dataRouter.patch('/workspaces/:workspaceId/leads/:leadId/instagram', async (req: Request, res: Response) => {
  const { workspaceId, leadId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const { instagramData } = req.body;
  if (!instagramData || typeof instagramData !== 'object') {
    res.status(400).json({ error: 'instagramData object is required.' });
    return;
  }

  try {
    if (supabase) {
      await supabase
        .from('leads')
        .update({
          instagram_username: instagramData.instagramUsername || null,
          instagram_profile_url: instagramData.instagramProfileUrl || null,
          instagram_verification_status: instagramData.instagramVerificationStatus || null,
          instagram_verification_evidence: instagramData.instagramVerificationEvidence || null,
          instagram_discovery_source: instagramData.instagramDiscoverySource || null,
          instagram_last_checked_at: instagramData.instagramLastCheckedAt || new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', leadId)
        .eq('workspace_id', workspaceId);
    }

    dbService.updateLeadInstagram(workspaceId, leadId, instagramData);
    res.json({ success: true, leadId, instagramData });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update lead Instagram.' });
  }
});

/**
 * POST /api/workspaces/:workspaceId/leads/delete-selected
 * Deletes selected leads from workspace.
 */
dataRouter.post('/workspaces/:workspaceId/leads/delete-selected', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const { leadIds } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    res.status(400).json({ error: 'leadIds array is required.' });
    return;
  }

  try {
    if (supabase) {
      await supabase
        .from('client_leads')
        .delete()
        .in('lead_id', leadIds)
        .eq('workspace_id', workspaceId);
    }

    dbService.deleteSelectedLeads(workspaceId, leadIds);
    res.json({ success: true, deletedCount: leadIds.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete selected leads.' });
  }
});

// ==========================================
// 4. SEARCH HISTORY ENDPOINTS
// ==========================================

/**
 * GET /api/workspaces/:workspaceId/searches
 * Retrieves search history for the authorized workspace.
 */
dataRouter.get('/workspaces/:workspaceId/searches', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  try {
    const searches = dbService.getSearches(workspaceId);
    res.json({ searches });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch search history.' });
  }
});

/**
 * POST /api/workspaces/:workspaceId/searches
 * Records a lead search in the authorized workspace.
 */
dataRouter.post('/workspaces/:workspaceId/searches', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const {
    clientId,
    clientName,
    filters,
    candidatesFound,
    validLeads,
    duplicatesRemoved,
    finalLeadCount,
    createdBy
  } = req.body;

  if (!clientId || !clientName || !filters) {
    res.status(400).json({ error: 'clientId, clientName, and filters are required.' });
    return;
  }

  try {
    const searchId = generateUuid();
    const now = new Date().toISOString();

    const record: SearchHistoryRecord = {
      id: searchId,
      workspaceId,
      clientId,
      clientName,
      searchDate: now,
      filters: filters as LeadFilter,
      candidatesFound: candidatesFound || 0,
      validLeads: validLeads || 0,
      duplicatesRemoved: duplicatesRemoved || 0,
      finalLeadCount: finalLeadCount || 0,
      createdBy: createdBy || access.user?.email || 'User'
    };

    if (supabase) {
      await supabase.from('lead_searches').insert([
        {
          id: searchId,
          workspace_id: workspaceId,
          client_id: clientId,
          filters,
          candidates_found: record.candidatesFound,
          valid_leads: record.validLeads,
          duplicates_removed: record.duplicatesRemoved,
          final_lead_count: record.finalLeadCount,
          created_by_user_email: record.createdBy,
          created_at: now,
          updated_at: now
        }
      ]);
    }

    dbService.saveSearchRecord(
      workspaceId,
      clientId,
      clientName,
      filters,
      record.candidatesFound,
      record.validLeads,
      record.duplicatesRemoved,
      record.finalLeadCount,
      record.createdBy,
      searchId
    );


    res.status(201).json({ search: record });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to record search.' });
  }
});
