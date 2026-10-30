import express, { Request, Response } from 'express';
import crypto from 'node:crypto';
import { supabase } from '../services/supabase';
import { dbService } from '../services/storage';
import { normalizeProfileUrl } from '../services/deduplication';
import {
  verifyServerAuthToken,
  verifyWorkspaceAccess,
  registerWorkspaceAuthorization,
  isUserAuthorizedForWorkspace,
  getDeterministicWorkspaceId
} from './serverAuthService';
import {
  Client,
  LeadRecord,
  LeadStatus,
  LeadFilter,
  SearchHistoryRecord,
  Workspace,
  InstagramVerificationStatus,
  GoogleIntegration,
  ExportHistoryRecord
} from '../types';

export const dataRouter = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const authorizedList: Workspace[] = [];
    const seenWsIds = new Set<string>();
    const deterministicWsId = getDeterministicWorkspaceId(auth.user.userId);
    registerWorkspaceAuthorization(auth.user.userId, deterministicWsId);

    const rawName = auth.user.email
      ? auth.user.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : 'User';
    const wsName = `${rawName}'s Workspace`;
    const wsDesc = `Primary workspace for ${auth.user.email || rawName}`;

    let deterministicWs = dbService.getWorkspaces().find(w => w.id === deterministicWsId);
    if (!deterministicWs) {
      deterministicWs = {
        id: deterministicWsId,
        name: wsName,
        description: wsDesc
      };
      dbService.addOrUpdateWorkspace(deterministicWs);
    }
    seenWsIds.add(deterministicWsId);
    authorizedList.push(deterministicWs);

    // 1. Query Supabase database for existing workspace associations for this user
    if (supabase) {
      try {
        const userFilter = auth.user.email && auth.user.email.includes('@')
          ? `id.eq.${auth.user.userId},email.eq.${auth.user.email}`
          : `id.eq.${auth.user.userId}`;

        const { data: dbUsers } = await supabase
          .from('users')
          .select('workspace_id')
          .or(userFilter);

        const linkedWsIds = new Set<string>();
        if (Array.isArray(dbUsers)) {
          dbUsers.forEach((u: any) => u.workspace_id && linkedWsIds.add(u.workspace_id));
        }

        const { data: dbWorkspaces } = await supabase
          .from('workspaces')
          .select('id, name, description, owner_id');

        if (Array.isArray(dbWorkspaces)) {
          for (const ws of dbWorkspaces) {
            if (ws.id === deterministicWsId || linkedWsIds.has(ws.id) || ws.owner_id === auth.user.userId || await isUserAuthorizedForWorkspace(auth.user.userId, ws.id, auth.user.email)) {
              registerWorkspaceAuthorization(auth.user.userId, ws.id);
              const formattedWs: Workspace = {
                id: ws.id,
                name: ws.name,
                description: ws.description || ''
              };
              dbService.addOrUpdateWorkspace(formattedWs);
              if (!seenWsIds.has(ws.id)) {
                seenWsIds.add(ws.id);
                authorizedList.push(formattedWs);
              }
            }
          }
        }

        // Ensure deterministic workspace is persisted in Supabase
        await supabase.from('workspaces').upsert([
          {
            id: deterministicWsId,
            name: wsName,
            description: wsDesc,
            owner_id: auth.user.userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ], { onConflict: 'id' });

        const userEmail = auth.user.email || `${auth.user.userId}@leadfinder.app`;
        await supabase.from('users').upsert(
          [
            {
              id: auth.user.userId,
              email: userEmail,
              full_name: rawName,
              workspace_id: deterministicWsId,
              role: 'owner',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ],
          { onConflict: 'id' }
        );
      } catch (dbErr) {
        console.warn('Supabase workspace lookup/sync error:', dbErr);
      }
    }

    // 2. Also check in-memory local dbService workspaces
    const localWorkspaces = dbService.getWorkspaces();
    for (const ws of localWorkspaces) {
      if (!seenWsIds.has(ws.id)) {
        const authorized = await isUserAuthorizedForWorkspace(
          auth.user.userId,
          ws.id,
          auth.user.email
        );
        if (authorized) {
          seenWsIds.add(ws.id);
          authorizedList.push(ws);
        }
      }
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
            owner_id: auth.user.userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]);

        const userEmail = auth.user.email || `${auth.user.userId}@leadfinder.app`;
        await supabase.from('users').upsert(
          [
            {
              id: auth.user.userId,
              email: userEmail,
              full_name: userEmail.split('@')[0],
              workspace_id: newWs.id,
              role: 'owner',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ],
          { onConflict: 'id' }
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
        const leadCountsByClient = new Map<string, number>();
        const searchCountsByClient = new Map<string, number>();

        try {
          const { data: clData } = await supabase
            .from('client_leads')
            .select('client_id')
            .eq('workspace_id', workspaceId);
          if (Array.isArray(clData)) {
            for (const item of clData) {
              leadCountsByClient.set(item.client_id, (leadCountsByClient.get(item.client_id) || 0) + 1);
            }
          }

          const { data: lsData } = await supabase
            .from('lead_searches')
            .select('client_id')
            .eq('workspace_id', workspaceId);
          if (Array.isArray(lsData)) {
            for (const item of lsData) {
              searchCountsByClient.set(item.client_id, (searchCountsByClient.get(item.client_id) || 0) + 1);
            }
          }
        } catch (cntErr) {
          console.warn('Failed to fetch counts from Supabase:', cntErr);
        }

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
          leadsCount: leadCountsByClient.has(c.id)
            ? leadCountsByClient.get(c.id)!
            : localLeads.filter((l) => l.clientId === c.id).length,
          searchesCount: searchCountsByClient.has(c.id)
            ? searchCountsByClient.get(c.id)!
            : localSearches.filter((s) => s.clientId === c.id).length
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
 * GET /api/workspaces/:workspaceId/clients/:clientId/export-leads
 * Retrieves authoritative export leads and diagnostics for a client.
 */
dataRouter.get('/workspaces/:workspaceId/clients/:clientId/export-leads', async (req: Request, res: Response) => {
  const { workspaceId, clientId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  try {
    let totalWorkspaceLeads = 0;
    let totalClientAssociations = 0;
    let exportLeads: LeadRecord[] = [];

    if (supabase) {
      // 1. Count total workspace leads
      const { count: wsCount } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);
      totalWorkspaceLeads = wsCount || 0;

      // 2. Count total client_leads for this client
      const { count: clCount } = await supabase
        .from('client_leads')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('client_id', clientId);
      totalClientAssociations = clCount || 0;

      // 3. Fetch leads for workspace
      const { data: leadsData } = await supabase
        .from('leads')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });

      // 4. Fetch client_leads for this client
      const { data: junctionData } = await supabase
        .from('client_leads')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('client_id', clientId);

      const junctionMap = new Map<string, any>();
      if (Array.isArray(junctionData)) {
        for (const j of junctionData) {
          junctionMap.set(j.lead_id, j);
        }
      }

      if (Array.isArray(leadsData)) {
        for (const item of leadsData) {
          let junction = junctionMap.get(item.id);

          // Safe auto-repair: If client_leads association was missing due to URL lookup mismatch or FK issue,
          // but lead_searches recorded search for this client and workspace has leads, re-associate.
          if (!junction && totalClientAssociations === 0 && leadsData.length > 0) {
            const { data: searchRows } = await supabase
              .from('lead_searches')
              .select('id')
              .eq('workspace_id', workspaceId)
              .eq('client_id', clientId);

            if (Array.isArray(searchRows) && searchRows.length > 0) {
              junction = { client_id: clientId, status: 'Not Contacted', notes: '' };
              try {
                await supabase.from('client_leads').upsert([
                  {
                    id: generateUuid(),
                    workspace_id: workspaceId,
                    client_id: clientId,
                    lead_id: item.id,
                    status: 'Not Contacted',
                    notes: '',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  }
                ], { onConflict: 'client_id,lead_id' });
              } catch {
                // ignore auto-repair failure
              }
            }
          }

          if (junction) {
            exportLeads.push({
              id: item.id,
              workspaceId: item.workspace_id,
              clientId: clientId,
              searchId: junction.search_id || undefined,
              fullName: item.full_name || 'N/A',
              headline: item.headline || '',
              currentJobTitle: item.current_job_title || 'N/A',
              companyName: item.company_name || 'N/A',
              location: item.location || 'N/A',
              profileUrl: item.profile_url || '',
              connectionsOrFollowers:
                item.lead_type === 'business'
                  ? item.connections_or_followers || ''
                  : item.connections_or_followers || '500+ connections',
              lastActivityDate: item.last_activity_date || 'N/A',
              dateAdded: (item.created_at || new Date().toISOString()).split('T')[0],
              status: (junction.status as LeadStatus) || 'Not Contacted',
              notes: junction.notes || '',
              source: item.source || 'Wikidata SPARQL Query Service',
              leadType: item.lead_type || undefined,
              businessCategory: item.business_category || undefined,
              businessWebsite: item.business_website || undefined,
              businessPhone: item.business_phone || undefined,
              businessAddress: item.business_address || undefined,
              businessCity: item.business_city || undefined,
              businessCountry: item.business_country || undefined,
              latitude: typeof item.latitude === 'number' ? item.latitude : undefined,
              longitude: typeof item.longitude === 'number' ? item.longitude : undefined,
              businessEmail: item.business_email || undefined,
              linkedInProfileUrl: item.linkedin_profile_url || undefined,
              contactSource: item.contact_source || undefined,
              contactVerificationStatus: item.contact_verification_status || undefined,
              instagramUsername: item.instagram_username || undefined,
              instagramProfileUrl: item.instagram_profile_url || undefined,
              instagramVerificationStatus: item.instagram_verification_status || undefined,
              instagramVerificationEvidence: item.instagram_verification_evidence || undefined,
              instagramDiscoverySource: item.instagram_discovery_source || undefined,
              instagramLastCheckedAt: item.instagram_last_checked_at || undefined,
              relevanceScore: typeof item.relevance_score === 'number' ? item.relevance_score : undefined,
              relevanceExplanation: item.relevance_explanation || undefined,
              relevanceBreakdown: item.relevance_breakdown || undefined,
              b2bClassification: item.b2b_classification || undefined,
              isDeceased: typeof item.is_deceased === 'boolean' ? item.is_deceased : undefined,
              dateOfDeath: item.date_of_death || undefined,
              dateOfBirth: item.date_of_birth || undefined,
              entityPeriod: item.entity_period || undefined,
              activeEvidence: item.active_evidence || undefined
            });
          }
        }
      }
    } else {
      const localLeads = dbService.getLeadsForClient(workspaceId, clientId);
      const allLocal = dbService.getAllLeads(workspaceId);
      totalWorkspaceLeads = allLocal.length;
      totalClientAssociations = localLeads.length;
      exportLeads = localLeads;
    }

    // Deduplicate exportLeads by canonical normalized profile URL
    const seenUrls = new Set<string>();
    const deduplicatedLeads: LeadRecord[] = [];
    for (const l of exportLeads) {
      const norm = normalizeProfileUrl(l.profileUrl).toLowerCase();
      if (!seenUrls.has(norm)) {
        seenUrls.add(norm);
        deduplicatedLeads.push(l);
      }
    }

    const diagnostics = {
      userId: access.user?.userId || 'unknown',
      workspaceId,
      clientId,
      totalWorkspaceLeads,
      totalClientAssociations,
      exportQueryReturnedCount: deduplicatedLeads.length
    };

    console.log(`[Export Diagnostics] User: ${diagnostics.userId} | Workspace: ${diagnostics.workspaceId} | Client: ${diagnostics.clientId} | Workspace Leads: ${diagnostics.totalWorkspaceLeads} | Client Links: ${diagnostics.totalClientAssociations} | Export Query Returned: ${diagnostics.exportQueryReturnedCount}`);

    res.json({
      success: true,
      workspaceId,
      clientId,
      leads: deduplicatedLeads,
      diagnostics
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to retrieve export leads.' });
  }
});

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
    if (supabase) {
      try {
        const { data: leadsData, error: leadsError } = await supabase
          .from('leads')
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false });

        if (!leadsError && Array.isArray(leadsData)) {
          let clQuery = supabase
            .from('client_leads')
            .select('*')
            .eq('workspace_id', workspaceId);

          if (clientId) {
            clQuery = clQuery.eq('client_id', clientId);
          }

          const { data: junctionData } = await clQuery;
          const junctionMap = new Map<string, any>();
          if (Array.isArray(junctionData)) {
            for (const j of junctionData) {
              junctionMap.set(j.lead_id, j);
            }
          }

          const records: LeadRecord[] = [];
          for (const item of leadsData) {
            let junction = junctionMap.get(item.id);

            // Auto-repair check: if junction wasn't found by item.id, check by normalized URL
            if (!junction && clientId && Array.isArray(junctionData)) {
              const normItemUrl = normalizeProfileUrl(item.profile_url).toLowerCase();
              const matchedJunction = junctionData.find(j => {
                const jLead = leadsData.find(ld => ld.id === j.lead_id);
                return jLead && normalizeProfileUrl(jLead.profile_url).toLowerCase() === normItemUrl;
              });
              if (matchedJunction) {
                junction = matchedJunction;
                try {
                  await supabase.from('client_leads').upsert([
                    {
                      id: matchedJunction.id || generateUuid(),
                      workspace_id: workspaceId,
                      client_id: clientId,
                      lead_id: item.id,
                      status: matchedJunction.status || 'Not Contacted',
                      notes: matchedJunction.notes || '',
                      updated_at: new Date().toISOString()
                    }
                  ], { onConflict: 'client_id,lead_id' });
                } catch {
                  // ignore auto-repair failure
                }
              }
            }

            if (clientId && !junction) {
              continue;
            }

            records.push({
              id: item.id,
              workspaceId: item.workspace_id,
              clientId: junction?.client_id || clientId || '',
              searchId: junction?.search_id || undefined,
              fullName: item.full_name || 'N/A',
              headline: item.headline || '',
              currentJobTitle: item.current_job_title || 'N/A',
              companyName: item.company_name || 'N/A',
              location: item.location || 'N/A',
              profileUrl: item.profile_url || '',
              connectionsOrFollowers:
                item.lead_type === 'business'
                  ? item.connections_or_followers || ''
                  : item.connections_or_followers || '500+ connections',
              lastActivityDate: item.last_activity_date || 'N/A',
              dateAdded: (item.created_at || new Date().toISOString()).split('T')[0],
              status: (junction?.status as LeadStatus) || 'Not Contacted',
              notes: junction?.notes || '',
              source: item.source || 'Wikidata SPARQL Query Service',
              leadType: item.lead_type || undefined,
              businessCategory: item.business_category || undefined,
              businessWebsite: item.business_website || undefined,
              businessPhone: item.business_phone || undefined,
              businessAddress: item.business_address || undefined,
              businessCity: item.business_city || undefined,
              businessCountry: item.business_country || undefined,
              latitude: typeof item.latitude === 'number' ? item.latitude : undefined,
              longitude: typeof item.longitude === 'number' ? item.longitude : undefined,
              businessEmail: item.business_email || undefined,
              linkedInProfileUrl: item.linkedin_profile_url || undefined,
              contactSource: item.contact_source || undefined,
              contactVerificationStatus: item.contact_verification_status || undefined,
              instagramUsername: item.instagram_username || undefined,
              instagramProfileUrl: item.instagram_profile_url || undefined,
              instagramVerificationStatus: item.instagram_verification_status || undefined,
              instagramVerificationEvidence: item.instagram_verification_evidence || undefined,
              instagramDiscoverySource: item.instagram_discovery_source || undefined,
              instagramLastCheckedAt: item.instagram_last_checked_at || undefined,
              relevanceScore: typeof item.relevance_score === 'number' ? item.relevance_score : undefined,
              relevanceExplanation: item.relevance_explanation || undefined,
              relevanceBreakdown: item.relevance_breakdown || undefined,
              b2bClassification: item.b2b_classification || undefined,
              isDeceased: typeof item.is_deceased === 'boolean' ? item.is_deceased : undefined,
              dateOfDeath: item.date_of_death || undefined,
              dateOfBirth: item.date_of_birth || undefined,
              entityPeriod: item.entity_period || undefined,
              activeEvidence: item.active_evidence || undefined
            });
          }

          if (!clientId) {
            dbService.syncLeadsForWorkspace(workspaceId, records);
          }
          res.json({ leads: records });
          return;
        }
      } catch (dbErr) {
        console.warn('Database lead fetch error, falling back to cache:', dbErr);
      }
    }

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
      const now = new Date().toISOString();
      const leadRows = leads.map((l: LeadRecord) => ({
        id: l.id && UUID_REGEX.test(l.id) ? l.id : generateUuid(),
        workspace_id: workspaceId,
        full_name: l.fullName || 'N/A',
        headline: l.headline || '',
        current_job_title: l.currentJobTitle || 'N/A',
        company_name: l.companyName || 'N/A',
        location: l.location || 'N/A',
        profile_url: normalizeProfileUrl(l.profileUrl),
        connections_or_followers: l.connectionsOrFollowers || null,
        last_activity_date: l.lastActivityDate || null,
        source: l.source || 'Wikidata SPARQL Query Service',
        lead_type: l.leadType || null,
        business_category: l.businessCategory || null,
        business_website: l.businessWebsite || null,
        business_phone: l.businessPhone || null,
        business_address: l.businessAddress || null,
        business_city: l.businessCity || null,
        business_country: l.businessCountry || null,
        latitude: typeof l.latitude === 'number' ? l.latitude : null,
        longitude: typeof l.longitude === 'number' ? l.longitude : null,
        business_email: l.businessEmail || null,
        linkedin_profile_url: l.linkedInProfileUrl || null,
        contact_source: l.contactSource || null,
        contact_verification_status: l.contactVerificationStatus || null,
        instagram_username: l.instagramUsername || null,
        instagram_profile_url: l.instagramProfileUrl || null,
        instagram_verification_status: l.instagramVerificationStatus || null,
        instagram_verification_evidence: l.instagramVerificationEvidence || null,
        instagram_discovery_source: l.instagramDiscoverySource || null,
        instagram_last_checked_at: l.instagramLastCheckedAt || null,
        relevance_score: typeof l.relevanceScore === 'number' ? l.relevanceScore : null,
        relevance_explanation: l.relevanceExplanation || null,
        relevance_breakdown: l.relevanceBreakdown || null,
        b2b_classification: l.b2bClassification || null,
        is_deceased: typeof l.isDeceased === 'boolean' ? l.isDeceased : null,
        date_of_death: l.dateOfDeath || null,
        date_of_birth: l.dateOfBirth || null,
        entity_period: l.entityPeriod || null,
        active_evidence: l.activeEvidence || null,
        created_at: now,
        updated_at: now
      }));

      const { data: upsertedLeads, error: upsertLeadErr } = await supabase.from('leads').upsert(leadRows, {
        onConflict: 'workspace_id,profile_url',
        ignoreDuplicates: false
      }).select('id, profile_url');

      if (upsertLeadErr) {
        console.error('Supabase lead upsert error:', upsertLeadErr.message);
        throw new Error(`Database rejected leads persistence: ${upsertLeadErr.message}`);
      }

      const { data: existingLeads } = await supabase
        .from('leads')
        .select('id, profile_url')
        .eq('workspace_id', workspaceId);

      const urlToId = new Map<string, string>();
      if (Array.isArray(existingLeads)) {
        existingLeads.forEach((el: any) => {
          if (el.profile_url) {
            urlToId.set(normalizeProfileUrl(el.profile_url).toLowerCase(), el.id);
            urlToId.set(el.profile_url.toLowerCase(), el.id);
          }
        });
      }
      if (Array.isArray(upsertedLeads)) {
        upsertedLeads.forEach((el: any) => {
          if (el.profile_url) {
            urlToId.set(normalizeProfileUrl(el.profile_url).toLowerCase(), el.id);
            urlToId.set(el.profile_url.toLowerCase(), el.id);
          }
        });
      }

      const clientLeadRows = leads.map((l: LeadRecord) => {
        const normUrl = normalizeProfileUrl(l.profileUrl).toLowerCase();
        const rawUrl = (l.profileUrl || '').toLowerCase();
        const leadId = urlToId.get(normUrl) || urlToId.get(rawUrl) || (l.id && UUID_REGEX.test(l.id) ? l.id : generateUuid());
        return {
          id: generateUuid(),
          workspace_id: workspaceId,
          client_id: clientId,
          lead_id: leadId,
          search_id: (searchId && UUID_REGEX.test(searchId)) ? searchId : null,
          status: l.status || 'Not Contacted',
          notes: l.notes || '',
          created_at: now,
          updated_at: now
        };
      });

      const { error: linkErr } = await supabase.from('client_leads').upsert(clientLeadRows, {
        onConflict: 'client_id,lead_id',
        ignoreDuplicates: true
      });

      if (linkErr) {
        console.error('Supabase client_leads upsert error:', linkErr.message);
        throw new Error(`Database rejected client links: ${linkErr.message}`);
      }
    }

    res.json({
      success: true,
      added: localResult.added,
      duplicatesSkipped: localResult.duplicatesSkipped,
      persistenceStatus: supabase ? 'confirmed' : 'local_only',
      persistenceMessage: supabase
        ? 'Leads persisted securely to workspace database.'
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
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('lead_searches')
          .select('*, clients(name)')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data)) {
          const searches: SearchHistoryRecord[] = data.map((s: any) => ({
            id: s.id,
            workspaceId: s.workspace_id,
            clientId: s.client_id,
            clientName: s.clients?.name || 'Client',
            searchDate: s.created_at,
            filters: s.filters,
            candidatesFound: s.candidates_found || 0,
            validLeads: s.valid_leads || 0,
            duplicatesRemoved: s.duplicates_removed || 0,
            finalLeadCount: s.final_lead_count || 0,
            createdBy: s.created_by_user_email || 'User'
          }));

          dbService.syncSearchesForWorkspace(workspaceId, searches);
          res.json({ searches });
          return;
        }
      } catch (dbErr) {
        console.warn('Database searches lookup error, falling back to cache:', dbErr);
      }
    }

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

// ==========================================
// 5. GOOGLE INTEGRATION ENDPOINTS
// ==========================================

/**
 * GET /api/workspaces/:workspaceId/google-integrations
 */
dataRouter.get('/workspaces/:workspaceId/google-integrations', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const clientId = req.query.clientId as string | undefined;

  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  try {
    if (supabase && clientId) {
      const { data, error } = await supabase
        .from('google_integrations')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('client_id', clientId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        const integration: GoogleIntegration = {
          id: data.id,
          workspaceId: data.workspace_id,
          clientId: data.client_id,
          spreadsheetId: data.spreadsheet_id,
          spreadsheetUrl: data.spreadsheet_url,
          sheetTitle: data.sheet_title,
          lastExportedAt: data.last_exported_at
        };
        dbService.saveGoogleIntegration(integration);
        res.json({ integration });
        return;
      }
    }

    if (clientId) {
      const integration = dbService.getGoogleIntegration(workspaceId, clientId);
      res.json({ integration });
      return;
    }

    res.json({ integration: undefined });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch Google integration.' });
  }
});

/**
 * POST /api/workspaces/:workspaceId/google-integrations
 */
dataRouter.post('/workspaces/:workspaceId/google-integrations', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const { clientId, spreadsheetId, spreadsheetUrl, sheetTitle, lastExportedAt, id } = req.body;
  if (!clientId || !spreadsheetId) {
    res.status(400).json({ error: 'clientId and spreadsheetId are required.' });
    return;
  }

  try {
    const integrationId = id && UUID_REGEX.test(id) ? id : generateUuid();
    const now = lastExportedAt || new Date().toISOString();

    const integration: GoogleIntegration = {
      id: integrationId,
      workspaceId,
      clientId,
      spreadsheetId,
      spreadsheetUrl: spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      sheetTitle: sheetTitle || 'Leads Export',
      lastExportedAt: now
    };

    if (supabase) {
      await supabase.from('google_integrations').upsert([
        {
          id: integrationId,
          workspace_id: workspaceId,
          client_id: clientId,
          spreadsheet_id: spreadsheetId,
          spreadsheet_url: integration.spreadsheetUrl,
          sheet_title: integration.sheetTitle,
          last_exported_at: now,
          updated_at: now
        }
      ]);
    }

    dbService.saveGoogleIntegration(integration);
    res.status(201).json({ integration });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save Google integration.' });
  }
});

// ==========================================
// 6. EXPORT HISTORY ENDPOINTS
// ==========================================

/**
 * GET /api/workspaces/:workspaceId/export-history
 */
dataRouter.get('/workspaces/:workspaceId/export-history', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const clientId = req.query.clientId as string | undefined;

  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  try {
    if (supabase) {
      let query = supabase
        .from('export_history')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });

      if (clientId) {
        query = query.eq('client_id', clientId);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        const history: ExportHistoryRecord[] = data.map((d: any) => ({
          id: d.id,
          workspaceId: d.workspace_id,
          clientId: d.client_id,
          spreadsheetId: d.spreadsheet_id,
          exportedLeadsCount: d.exported_leads_count,
          skippedDuplicatesCount: d.skipped_duplicates_count || 0,
          exportedByEmail: d.exported_by_email,
          createdAt: d.created_at
        }));
        res.json({ history });
        return;
      }
    }

    const history = dbService.getExportHistory(workspaceId, clientId);
    res.json({ history });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch export history.' });
  }
});

/**
 * POST /api/workspaces/:workspaceId/export-history
 */
dataRouter.post('/workspaces/:workspaceId/export-history', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const access = await verifyWorkspaceAccess(req, workspaceId);
  if (!access.authorized) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const { clientId, spreadsheetId, exportedLeadsCount, skippedDuplicatesCount, exportedByEmail, createdAt, id } = req.body;
  if (!clientId || !spreadsheetId) {
    res.status(400).json({ error: 'clientId and spreadsheetId are required.' });
    return;
  }

  try {
    const recordId = id && UUID_REGEX.test(id) ? id : generateUuid();
    const now = createdAt || new Date().toISOString();

    const record: ExportHistoryRecord = {
      id: recordId,
      workspaceId,
      clientId,
      spreadsheetId,
      exportedLeadsCount: exportedLeadsCount || 0,
      skippedDuplicatesCount: skippedDuplicatesCount || 0,
      exportedByEmail: exportedByEmail || access.user?.email || 'User',
      createdAt: now
    };

    if (supabase) {
      await supabase.from('export_history').insert([
        {
          id: recordId,
          workspace_id: workspaceId,
          client_id: clientId,
          spreadsheet_id: spreadsheetId,
          exported_leads_count: record.exportedLeadsCount,
          skipped_duplicates_count: record.skippedDuplicatesCount,
          exported_by_email: record.exportedByEmail,
          created_at: now
        }
      ]);
    }

    dbService.saveExportHistory(record);
    res.status(201).json({ record });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save export history.' });
  }
});
