import React, { useState, useEffect } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import {
  Client,
  LeadFilter,
  LeadRecord,
  LeadStatus,
  RawLead,
  SearchHistoryRecord,
  Workspace,
  LeadProviderConfig,
  ProviderStatusInfo
} from './types';
import { dbService } from './services/storage';
import { initAuthListener, setCachedAccessToken } from './services/auth';
import { ProviderFactory } from './services/leadProviders/ProviderFactory';
import { apiUrl } from './services/apiClient';

import { TopBar } from './components/TopBar';
import { Sidebar, NavTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { ClientManagementView } from './components/ClientManagementView';
import { LeadFinderView } from './components/LeadFinderView';
import { LeadsTableView } from './components/LeadsTableView';
import { SearchHistoryView } from './components/SearchHistoryView';
import { SettingsView } from './components/SettingsView';
import { GoogleSheetsExportModal } from './components/GoogleSheetsExportModal';

export default function App() {
  // Navigation & Workspace State
  const [activeTab, setActiveTab] = useState<NavTab>('finder');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>({
    id: 'ws-default-01',
    name: 'Acme Growth Agency',
    description: 'Primary agency workspace'
  });

  // Clients & Leads State
  const [clients, setClients] = useState<Client[]>([]);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [allLeads, setAllLeads] = useState<LeadRecord[]>([]);
  const [allSearches, setAllSearches] = useState<SearchHistoryRecord[]>([]);

  // Auth & Provider State
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userEmail, setUserEmail] = useState<string>('sohamkharat481@gmail.com');
  const [isGoogleConnected, setIsGoogleConnected] = useState<boolean>(false);
  
  const [providerConfig, setProviderConfig] = useState<LeadProviderConfig>({
    providerType: 'mock'
  });

  const [providerStatus, setProviderStatus] = useState<ProviderStatusInfo>({
    configured: true,
    providerName: 'Demo / Mock Data Provider',
    status: 'Connected',
    message: 'Mock Lead Provider active for development.',
    isMock: true,
    endpointStatus: 'Internal Simulation',
    authStatus: 'Mock Credentials Active',
    lastSuccessfulRequest: 'None yet',
    lastError: 'None',
    responseTimeMs: 'N/A',
    isExternal: false
  });

  // Modal Export State
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportTargetLeads, setExportTargetLeads] = useState<LeadRecord[]>([]);
  const [exportTargetClientName, setExportTargetClientName] = useState<string>('');

  const fetchProviderStatus = async (cfg?: LeadProviderConfig) => {
    const activeCfg = cfg || providerConfig;
    try {
      const modeParam = activeCfg.providerType === 'mock' ? '?mode=mock' : '';
      const res = await fetch(apiUrl(`/api/provider-status${modeParam}`), {
        headers: {
          'X-Provider-Api-Key': activeCfg.apiKey || ''
        }
      });
      if (res.ok) {
        const data: ProviderStatusInfo = await res.json();
        setProviderStatus(data);
      }
    } catch {
      // Fallback
      setProviderStatus({
        configured: activeCfg.providerType === 'mock',
        providerName: activeCfg.providerType === 'mock' ? 'Demo Provider' : 'Production API Provider',
        status: activeCfg.providerType === 'mock' ? 'Connected' : 'Not Configured',
        message: activeCfg.providerType === 'mock' ? 'Demo mode active' : 'No real lead provider configured.',
        isMock: activeCfg.providerType === 'mock',
        endpointStatus: 'Internal Endpoint',
        authStatus: activeCfg.apiKey ? 'Configured' : 'Missing Key',
        lastSuccessfulRequest: 'None yet',
        lastError: 'None',
        responseTimeMs: 'N/A',
        isExternal: false
      });
    }
  };

  // Initial Data Load
  useEffect(() => {
    const wsList = dbService.getWorkspaces();
    setWorkspaces(wsList);
    const activeWsId = dbService.getActiveWorkspaceId();
    const currentWs = wsList.find((w) => w.id === activeWsId) || wsList[0];
    setActiveWorkspace(currentWs);

    refreshWorkspaceData(currentWs.id);
    fetchProviderStatus();

    // Auth listener setup
    const unsubscribe = initAuthListener(
      (user, token) => {
        setCurrentUser(user);
        setUserEmail(user.email || 'sohamkharat481@gmail.com');
        setIsGoogleConnected(true);
      },
      () => {
        setCurrentUser(null);
        setIsGoogleConnected(false);
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const refreshWorkspaceData = (wsId: string) => {
    const clientList = dbService.getClients(wsId);
    setClients(clientList);

    if (clientList.length > 0) {
      if (!activeClient || !clientList.some((c) => c.id === activeClient.id)) {
        setActiveClient(clientList[0]);
      }
    } else {
      setActiveClient(null);
    }

    const leads = dbService.getAllLeads(wsId);
    setAllLeads(leads);

    const searches = dbService.getSearches(wsId);
    setAllSearches(searches);
  };

  const handleSelectWorkspace = (wsId: string) => {
    dbService.setActiveWorkspaceId(wsId);
    const targetWs = workspaces.find((w) => w.id === wsId);
    if (targetWs) {
      setActiveWorkspace(targetWs);
      refreshWorkspaceData(wsId);
    }
  };

  const handleCreateWorkspace = (name: string, desc: string) => {
    const newWs = dbService.createWorkspace(name, desc);
    setWorkspaces(dbService.getWorkspaces());
    setActiveWorkspace(newWs);
    refreshWorkspaceData(newWs.id);
  };

  const handleSelectClient = (clientId: string) => {
    const found = clients.find((c) => c.id === clientId);
    if (found) {
      setActiveClient(found);
    }
  };

  const handleCreateClient = (name: string, niche: string, notes: string) => {
    const newClient = dbService.createClient(activeWorkspace.id, name, niche, notes);
    refreshWorkspaceData(activeWorkspace.id);
    setActiveClient(newClient);
  };

  const handleUpdateClient = (
    clientId: string,
    updates: { name?: string; niche?: string; notes?: string }
  ) => {
    dbService.updateClient(activeWorkspace.id, clientId, updates);
    refreshWorkspaceData(activeWorkspace.id);
  };

  const handleDeleteClient = (clientId: string) => {
    dbService.deleteClient(activeWorkspace.id, clientId);
    refreshWorkspaceData(activeWorkspace.id);
  };

  // Lead Search Execution handler
  const handleExecuteSearch = async (
    filters: LeadFilter,
    targetClient: Client
  ): Promise<{
    uniqueLeads: RawLead[];
    candidatesFound: number;
    duplicatesRemoved: number;
    finalCount: number;
  }> => {
    // Call server endpoint
    const response = await fetch(apiUrl('/api/search-leads'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters,
        clientId: targetClient.id,
        workspaceId: activeWorkspace.id,
        providerType: providerConfig.providerType,
        apiKey: providerConfig.apiKey,
        customEndpoint: providerConfig.customEndpoint,
        searchEngineId: providerConfig.customEndpoint
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || err.message || 'Failed to search leads.');
    }

    const data = await response.json();
    const rawLeads: RawLead[] = data.leads || [];

    // Convert to LeadRecords
    const dateToday = new Date().toISOString().split('T')[0];
    const newLeadRecords: LeadRecord[] = rawLeads.map((raw) => ({
      id: `lead-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      workspaceId: activeWorkspace.id,
      clientId: targetClient.id,
      fullName: raw.fullName,
      headline: raw.headline,
      currentJobTitle: raw.currentJobTitle,
      companyName: raw.companyName,
      location: raw.location,
      profileUrl: raw.profileUrl,
      connectionsOrFollowers: raw.connectionsOrFollowers || '500+ connections',
      lastActivityDate: raw.lastActivityDate || 'N/A',
      dateAdded: dateToday,
      status: 'Not Contacted',
      notes: '',
      source: raw.source || 'Public Search API'
    }));

    // Deduplicate against existing client leads and save
    const saveResult = dbService.saveLeadsForClient(
      activeWorkspace.id,
      targetClient.id,
      newLeadRecords
    );

    // Record Search Audit History
    dbService.saveSearchRecord(
      activeWorkspace.id,
      targetClient.id,
      targetClient.name,
      filters,
      data.metrics.rawCandidatesCount,
      data.metrics.validRecordsCount,
      data.metrics.totalDuplicatesRemoved + saveResult.duplicatesSkipped,
      saveResult.added,
      userEmail
    );

    refreshWorkspaceData(activeWorkspace.id);

    return {
      uniqueLeads: rawLeads,
      candidatesFound: data.metrics.rawCandidatesCount,
      duplicatesRemoved: data.metrics.totalDuplicatesRemoved + saveResult.duplicatesSkipped,
      finalCount: saveResult.added
    };
  };

  // Lead Inline Updates
  const handleUpdateLeadStatus = (leadId: string, status: LeadStatus) => {
    dbService.updateLeadStatus(activeWorkspace.id, leadId, status);
    refreshWorkspaceData(activeWorkspace.id);
  };

  const handleUpdateLeadNotes = (leadId: string, notes: string) => {
    dbService.updateLeadNotes(activeWorkspace.id, leadId, notes);
    refreshWorkspaceData(activeWorkspace.id);
  };

  const handleDeleteLeads = (leadIds: string[]) => {
    dbService.deleteSelectedLeads(activeWorkspace.id, leadIds);
    refreshWorkspaceData(activeWorkspace.id);
  };

  // Google Sheets Export Trigger
  const handleOpenExportModal = (leadsToExport: LeadRecord[], clientName?: string) => {
    setExportTargetLeads(
      leadsToExport.length > 0
        ? leadsToExport
        : activeClient
        ? dbService.getLeadsForClient(activeWorkspace.id, activeClient.id)
        : []
    );
    setExportTargetClientName(clientName || activeClient?.name || 'General Agency Client');
    setIsExportModalOpen(true);
  };

  const handleUpdateProviderConfig = (cfg: Partial<LeadProviderConfig>) => {
    const updated = { ...providerConfig, ...cfg };
    setProviderConfig(updated);
    ProviderFactory.configure(updated);
    fetchProviderStatus(updated);
  };

  const handleEnableMockMode = () => {
    handleUpdateProviderConfig({ providerType: 'mock' });
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeClient={activeClient}
        providerStatus={providerStatus}
      />

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* TopBar */}
        <TopBar
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          onSelectWorkspace={handleSelectWorkspace}
          clients={clients}
          activeClient={activeClient}
          onSelectClient={handleSelectClient}
          currentUser={currentUser}
          userEmail={userEmail}
          isGoogleConnected={isGoogleConnected}
          onGoogleAuthSuccess={(user, token) => {
            setCurrentUser(user);
            setUserEmail(user.email || 'sohamkharat481@gmail.com');
            setCachedAccessToken(token);
            setIsGoogleConnected(true);
          }}
          providerStatus={providerStatus}
        />

        {/* Dynamic Main Workspace Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'finder' && (
            <div className="space-y-8">
              <DashboardView
                clients={clients}
                activeClient={activeClient}
                allLeads={allLeads}
                allSearches={allSearches}
                onNavigate={setActiveTab}
                onOpenClient={(client) => {
                  setActiveClient(client);
                  setActiveTab('clients');
                }}
                providerIsMock={providerStatus.isMock}
              />

              <div className="pt-4 border-t border-gray-200">
                <LeadFinderView
                  clients={clients}
                  activeClient={activeClient}
                  onSelectClient={handleSelectClient}
                  onExecuteSearch={handleExecuteSearch}
                  onNavigateToLeads={() => setActiveTab('clients')}
                  onNavigateToSettings={() => setActiveTab('settings')}
                  providerStatus={providerStatus}
                  onEnableMockMode={handleEnableMockMode}
                />
              </div>
            </div>
          )}

          {activeTab === 'clients' && (
            <ClientManagementView
              clients={clients}
              activeWorkspaceId={activeWorkspace.id}
              activeClient={activeClient}
              onSelectClient={handleSelectClient}
              onCreateClient={handleCreateClient}
              onUpdateClient={handleUpdateClient}
              onDeleteClient={handleDeleteClient}
              getLeadsForClient={(cId) => dbService.getLeadsForClient(activeWorkspace.id, cId)}
              getSearchesForClient={(cId) =>
                allSearches.filter((s) => s.clientId === cId && s.workspaceId === activeWorkspace.id)
              }
              onUpdateLeadStatus={handleUpdateLeadStatus}
              onUpdateLeadNotes={handleUpdateLeadNotes}
              onDeleteLeads={handleDeleteLeads}
              onExportToSheets={(selected, cName) => handleOpenExportModal(selected, cName)}
              isGoogleConnected={isGoogleConnected}
            />
          )}

          {activeTab === 'history' && (
            <SearchHistoryView searches={allSearches} />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              onCreateWorkspace={handleCreateWorkspace}
              providerConfig={providerConfig}
              onUpdateProviderConfig={handleUpdateProviderConfig}
              currentUser={currentUser}
              userEmail={userEmail}
              isGoogleConnected={isGoogleConnected}
              onGoogleAuthSuccess={(user, token) => {
                setCurrentUser(user);
                setUserEmail(user.email || 'sohamkharat481@gmail.com');
                setCachedAccessToken(token);
                setIsGoogleConnected(true);
              }}
              providerStatus={providerStatus}
              onRefreshProviderStatus={() => fetchProviderStatus()}
            />
          )}
        </main>
      </div>

      {/* Google Sheets Export Modal */}
      <GoogleSheetsExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        clientName={exportTargetClientName}
        leadsToExport={exportTargetLeads}
        currentUser={currentUser}
        onGoogleAuthSuccess={(user, token) => {
          setCurrentUser(user);
          setUserEmail(user.email || 'sohamkharat481@gmail.com');
          setCachedAccessToken(token);
          setIsGoogleConnected(true);
        }}
      />
    </div>
  );
}
