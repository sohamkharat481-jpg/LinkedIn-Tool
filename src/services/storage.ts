import {
  Client,
  LeadRecord,
  LeadStatus,
  SearchHistoryRecord,
  Workspace,
  GoogleIntegration,
  ExportHistoryRecord,
  LeadFilter
} from '../types';

const BASE_STORAGE_KEYS = {
  WORKSPACES: 'llf_workspaces_v1',
  ACTIVE_WORKSPACE_ID: 'llf_active_workspace_id_v1',
  CLIENTS: 'llf_clients_v1',
  SEARCHES: 'llf_searches_v1',
  LEADS: 'llf_leads_v1',
  GOOGLE_INTEGRATIONS: 'llf_google_integrations_v1',
  EXPORT_HISTORY: 'llf_export_history_v1',
  SUPABASE_CONFIG: 'llf_supabase_config_v1'
};

const getScopedKey = (keyBase: string, workspaceId: string) => `${keyBase}_${workspaceId}`;

// In-Memory Storage & LocalStorage Synchronization
class StorageService {
  constructor() {}

  private memoryStore = new Map<string, string>();

  private getItem<T>(key: string, defaultValue: T): T {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : defaultValue;
      }
      const mem = this.memoryStore.get(key);
      return mem ? JSON.parse(mem) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private setItem<T>(key: string, value: T): void {
    try {
      const serialized = JSON.stringify(value);
      this.memoryStore.set(key, serialized);
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(key, serialized);
      }
    } catch (e) {
      console.error('Storage write error:', e);
    }
  }

  // Workspaces (Global)
  getWorkspaces(): Workspace[] {
    return this.getItem<Workspace[]>(BASE_STORAGE_KEYS.WORKSPACES, []);
  }

  syncWorkspaces(syncedWorkspaces: Workspace[]): void {
    this.setItem(BASE_STORAGE_KEYS.WORKSPACES, syncedWorkspaces);
  }

  addOrUpdateWorkspace(ws: Workspace): void {
    const list = this.getWorkspaces();
    const index = list.findIndex((w) => w.id === ws.id);
    if (index !== -1) {
      list[index] = ws;
    } else {
      list.push(ws);
    }
    this.setItem(BASE_STORAGE_KEYS.WORKSPACES, list);
  }

  getActiveWorkspaceId(): string {
    return this.getItem<string>(BASE_STORAGE_KEYS.ACTIVE_WORKSPACE_ID, '');
  }

  setActiveWorkspaceId(id: string): void {
    this.setItem(BASE_STORAGE_KEYS.ACTIVE_WORKSPACE_ID, id);
  }

  createWorkspace(organizationId: string, name: string, description: string): Workspace {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `ws-${Date.now()}`;
    const newWs: Workspace = { id, organizationId, name, description };
    const list = this.getWorkspaces();
    list.push(newWs);
    this.setItem(BASE_STORAGE_KEYS.WORKSPACES, list);
    this.setActiveWorkspaceId(newWs.id);
    return newWs;
  }

  clearUserWorkspaceSession(): void {
    this.setItem(BASE_STORAGE_KEYS.WORKSPACES, []);
    this.setItem(BASE_STORAGE_KEYS.ACTIVE_WORKSPACE_ID, '');
  }

  // Clients (Isolated per Workspace)
  getClients(workspaceId: string): Client[] {
    const key = getScopedKey(BASE_STORAGE_KEYS.CLIENTS, workspaceId);
    const clients = this.getItem<Client[]>(key, []) || [];
    const allLeads = this.getAllLeads(workspaceId);
    const allSearches = this.getSearches(workspaceId);
    
    return clients.map(c => ({
      ...c,
      leadsCount: allLeads.filter(l => l.clientId === c.id).length,
      searchesCount: allSearches.filter(s => s.clientId === c.id).length
    }));
  }

  syncClientsForWorkspace(workspaceId: string, syncedClients: Client[]): void {
    const key = getScopedKey(BASE_STORAGE_KEYS.CLIENTS, workspaceId);
    this.setItem(key, syncedClients);
  }

  createClientWithId(id: string, organizationId: string, workspaceId: string, name: string, niche: string, notes: string, createdAt?: string): Client {
    const key = getScopedKey(BASE_STORAGE_KEYS.CLIENTS, workspaceId);
    const newClient: Client = {
      id, organizationId, workspaceId, name, niche, notes, 
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: createdAt || new Date().toISOString(),
      leadsCount: 0, searchesCount: 0
    };
    const clients = this.getClients(workspaceId);
    clients.unshift(newClient);
    this.setItem(key, clients);
    return newClient;
  }

  addClient(workspaceId: string, name: string, niche: string, notes: string): Client {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `client-${Date.now()}`;
    return this.createClientWithId(id, '', workspaceId, name, niche, notes);
  }

  updateClient(workspaceId: string, clientId: string, updates: { name?: string; niche?: string; notes?: string }): Client {
    const key = getScopedKey(BASE_STORAGE_KEYS.CLIENTS, workspaceId);
    const clients = this.getClients(workspaceId);
    const index = clients.findIndex((c) => c.id === clientId);
    if (index === -1) throw new Error('Client not found or access denied.');
    clients[index] = { ...clients[index], ...updates, updatedAt: new Date().toISOString() };
    this.setItem(key, clients);
    return clients[index];
  }

  deleteClient(workspaceId: string, clientId: string): void {
    const key = getScopedKey(BASE_STORAGE_KEYS.CLIENTS, workspaceId);
    const clients = this.getClients(workspaceId);
    this.setItem(key, clients.filter(c => c.id !== clientId));
    this.deleteLeadsForClient(workspaceId, clientId);
    this.deleteSearchesForClient(workspaceId, clientId);
  }

  // Searches
  getSearches(workspaceId: string): SearchHistoryRecord[] {
    const key = getScopedKey(BASE_STORAGE_KEYS.SEARCHES, workspaceId);
    return this.getItem<SearchHistoryRecord[]>(key, []) || [];
  }

  syncSearchesForWorkspace(workspaceId: string, syncedSearches: SearchHistoryRecord[]): void {
    const key = getScopedKey(BASE_STORAGE_KEYS.SEARCHES, workspaceId);
    this.setItem(key, syncedSearches);
  }

  deleteSearchesForClient(workspaceId: string, clientId: string): void {
    const key = getScopedKey(BASE_STORAGE_KEYS.SEARCHES, workspaceId);
    const searches = this.getSearches(workspaceId);
    this.setItem(key, searches.filter(s => s.clientId !== clientId));
  }

  saveSearchRecord(organizationId: string, workspaceId: string, clientId: string, clientName: string, filters: LeadFilter, candidatesFound: number, validLeads: number, duplicatesRemoved: number, finalLeadCount: number, createdBy: string, searchId?: string): SearchHistoryRecord {
    const key = getScopedKey(BASE_STORAGE_KEYS.SEARCHES, workspaceId);
    const newSearch: SearchHistoryRecord = {
      id: searchId || `search-${Date.now()}`,
      organizationId, workspaceId, clientId, clientName, searchDate: new Date().toISOString(),
      filters, candidatesFound, validLeads, duplicatesRemoved, finalLeadCount, createdBy
    };
    const searches = this.getSearches(workspaceId);
    searches.unshift(newSearch);
    this.setItem(key, searches);
    return newSearch;
  }

  // Leads
  getAllLeads(workspaceId: string): LeadRecord[] {
    const key = getScopedKey(BASE_STORAGE_KEYS.LEADS, workspaceId);
    return this.getItem<LeadRecord[]>(key, []) || [];
  }

  saveLeadsForClient(organizationId: string, workspaceId: string, clientId: string, newLeads: LeadRecord[]): { added: number; duplicatesSkipped: number } {
    const key = getScopedKey(BASE_STORAGE_KEYS.LEADS, workspaceId);
    const allLeads = this.getAllLeads(workspaceId);
    const existingClientLeads = allLeads.filter((l) => l.clientId === clientId);
    const existingUrls = new Set(existingClientLeads.map((l) => l.profileUrl.toLowerCase()));

    let added = 0;
    let duplicatesSkipped = 0;

    for (const lead of newLeads) {
      if (existingUrls.has(lead.profileUrl.toLowerCase())) {
        duplicatesSkipped++;
      } else {
        allLeads.unshift({ ...lead, id: lead.id || `lead-${Date.now()}`, organizationId, workspaceId, clientId });
        existingUrls.add(lead.profileUrl.toLowerCase());
        added++;
      }
    }
    this.setItem(key, allLeads);
    return { added, duplicatesSkipped };
  }

  updateLeadStatus(workspaceId: string, leadId: string, newStatus: LeadStatus): void {
    const key = getScopedKey(BASE_STORAGE_KEYS.LEADS, workspaceId);
    const allLeads = this.getAllLeads(workspaceId);
    const index = allLeads.findIndex((l) => l.id === leadId);
    if (index !== -1) {
      allLeads[index].status = newStatus;
      this.setItem(key, allLeads);
    }
  }

  updateLeadNotes(workspaceId: string, leadId: string, notes: string): void {
    const key = getScopedKey(BASE_STORAGE_KEYS.LEADS, workspaceId);
    const allLeads = this.getAllLeads(workspaceId);
    const index = allLeads.findIndex((l) => l.id === leadId);
    if (index !== -1) {
      allLeads[index].notes = notes;
      this.setItem(key, allLeads);
    }
  }

  getLeadsForClient(workspaceId: string, clientId: string): LeadRecord[] {
    const allLeads = this.getAllLeads(workspaceId);
    return allLeads.filter((l) => l.clientId === clientId);
  }
  
  deleteLeadsForClient(workspaceId: string, clientId: string): void {
    const key = getScopedKey(BASE_STORAGE_KEYS.LEADS, workspaceId);
    const allLeads = this.getAllLeads(workspaceId);
    this.setItem(key, allLeads.filter((l) => l.clientId !== clientId));
  }
  
  syncLeadsForWorkspace(workspaceId: string, syncedLeads: LeadRecord[]): void {
    const key = getScopedKey(BASE_STORAGE_KEYS.LEADS, workspaceId);
    this.setItem(key, syncedLeads);
  }

  deleteSelectedLeads(workspaceId: string, leadIds: string[]): void {
    const key = getScopedKey(BASE_STORAGE_KEYS.LEADS, workspaceId);
    const idSet = new Set(leadIds);
    const allLeads = this.getAllLeads(workspaceId);
    this.setItem(key, allLeads.filter((l) => !idSet.has(l.id)));
  }

  updateLeadInstagram(
    workspaceId: string,
    leadId: string,
    instagramData: any
  ): LeadRecord | undefined {
    const key = getScopedKey(BASE_STORAGE_KEYS.LEADS, workspaceId);
    const allLeads = this.getAllLeads(workspaceId);
    const index = allLeads.findIndex((l) => l.id === leadId);
    if (index !== -1) {
      allLeads[index] = { ...allLeads[index], ...instagramData };
      this.setItem(key, allLeads);
      return allLeads[index];
    }
    return undefined;
  }

  cleanUpDemoData(): void {
    // No-op
  }

  clearAllData(): void {
    this.memoryStore.clear();
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  }

  getGoogleIntegration(workspaceId: string, clientId: string): GoogleIntegration | undefined {
    const key = getScopedKey(BASE_STORAGE_KEYS.GOOGLE_INTEGRATIONS, workspaceId);
    const list = this.getItem<GoogleIntegration[]>(key, []) || [];
    return list.find((g) => g.clientId === clientId);
  }

  saveGoogleIntegration(integration: GoogleIntegration): void {
    const key = getScopedKey(BASE_STORAGE_KEYS.GOOGLE_INTEGRATIONS, integration.workspaceId);
    const list = this.getItem<GoogleIntegration[]>(key, []) || [];
    const index = list.findIndex((g) => g.clientId === integration.clientId);
    if (index !== -1) {
      list[index] = integration;
    } else {
      list.push(integration);
    }
    this.setItem(key, list);
  }

  getExportHistory(workspaceId: string, clientId?: string): ExportHistoryRecord[] {
    const key = getScopedKey(BASE_STORAGE_KEYS.EXPORT_HISTORY, workspaceId);
    const list = this.getItem<ExportHistoryRecord[]>(key, []) || [];
    return clientId ? list.filter((e) => e.clientId === clientId) : list;
  }

  saveExportHistory(record: ExportHistoryRecord): void {
    const key = getScopedKey(BASE_STORAGE_KEYS.EXPORT_HISTORY, record.workspaceId);
    const list = this.getItem<ExportHistoryRecord[]>(key, []) || [];
    list.unshift(record);
    this.setItem(key, list);
  }
}

export const dbService = new StorageService();
