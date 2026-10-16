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
import { SupabaseDataService } from './services/supabaseDataService';
import type { LeadPersistenceStatus } from './services/supabaseDataService';
import { initAuthListener, setCachedAccessToken, googleSignIn, googleSignOut } from './services/auth';
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
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);

  // Auth & Provider State
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userEmail, setUserEmail] = useState<string>('anjanapadhi21@gmail.com');
  const [isGoogleConnected, setIsGoogleConnected] = useState<boolean>(false);

  const [providerConfig, setProviderConfig] = useState<LeadProviderConfig>({
    providerType: 'serper'
  });

  const [providerStatus, setProviderStatus] = useState<ProviderStatusInfo>({
    configured: false,
    providerName: 'Serper.dev Google Search API',
    status: 'Not Configured',
    message: 'Serper.dev API key is not configured. Please set SERPER_API_KEY.',
    isMock: false,
    endpointStatus: 'https://google.serper.dev/search',
    authStatus: 'Not Configured',
    lastSuccessfulRequest: 'None yet',
    lastError: 'None',
    responseTimeMs: 'N/A',
    isExternal: true
  });

  // Modal Export State
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportTargetLeads, setExportTargetLeads] = useState<LeadRecord[]>([]);
  const [exportTargetClientName, setExportTargetClientName] = useState<string>('');
  const [exportTargetClientId, setExportTargetClientId] = useState<string | undefined>(undefined);


  const fetchProviderStatus = async (
    cfg?: LeadProviderConfig,
    workspaceId?: string,
    clientId?: string
  ) => {
    const activeCfg = cfg || providerConfig;
    try {
      let url = apiUrl(`/api/provider-status?type=${activeCfg.providerType}`);
      if (activeCfg.providerType === 'instagram_business' && workspaceId && clientId) {
        url = apiUrl(`/api/instagram/status?workspaceId=${workspaceId}&clientId=${clientId}`);
      }

      const idToken = currentUser ? await currentUser.getIdToken().catch(() => null) : null;
      const headers: Record<string, string> = {};
      if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Provider status API returned HTTP ${res.status}.`);
      }
      const data: ProviderStatusInfo = await res.json();
      setProviderStatus(data);
    } catch (error: unknown) {
      const providerName =
        activeCfg.providerType === 'leadocean'
          ? 'LeadOcean B2B People Search API'
          : activeCfg.providerType === 'instagram_business'
          ? 'Instagram Graph API Business Discovery'
          : 'Serper.dev Google Search API';
      const message = error instanceof Error ? error.message : 'Unknown provider status error.';
      setProviderStatus({
        configured: false,
        providerName,
        status: 'Error',
        message: `Unable to load provider status: ${message}`,
        isMock: false,
        endpointStatus:
          activeCfg.providerType === 'leadocean'
            ? 'https://api.leadocean.io/v1/people/search'
            : activeCfg.providerType === 'instagram_business'
            ? 'https://graph.facebook.com'
            : 'https://google.serper.dev/search',
        authStatus: 'Unavailable',
        lastSuccessfulRequest: 'None yet',
        lastError: message,
        responseTimeMs: 'N/A',
        isExternal: true
      });
    }
  };

  const refreshWorkspaceData = async (wsId: string) => {
    setIsLoadingData(true);
    setSupabaseError(null);
    try {
      const clientList = await SupabaseDataService.getClients(wsId);
      setClients(clientList);

      if (clientList.length > 0) {
        setActiveClient((prev) => {
          if (!prev || !clientList.some((c) => c.id === prev.id)) {
            return clientList[0];
          }
          return clientList.find((c) => c.id === prev.id) || clientList[0];
        });
      } else {
        setActiveClient(null);
      }

      const leads = await SupabaseDataService.getAllLeads(wsId);
      setAllLeads(leads);

      const searches = await SupabaseDataService.getSearches(wsId);
      setAllSearches(searches);
    } catch (err: any) {
      console.warn('refreshWorkspaceData error:', err);
      setSupabaseError(err.message || 'Database synchronization in progress.');
    } finally {
      setIsLoadingData(false);
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

    // Auth listener setup with verified session restore
    const unsubscribe = initAuthListener(
      (user, _token, accountInfo) => {
        setCurrentUser(user);
        if (accountInfo?.email) {
          setUserEmail(accountInfo.email);
        } else if (user.email) {
          setUserEmail(user.email);
        }
        setIsGoogleConnected(true);
      },
      () => {
        setIsGoogleConnected(false);
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

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

  const handleCreateClient = async (name: string, niche: string, notes: string) => {
    const newClient = await SupabaseDataService.createClient(activeWorkspace.id, name, niche, notes);
    await refreshWorkspaceData(activeWorkspace.id);
    setActiveClient(newClient);
  };

  const handleUpdateClient = async (
    clientId: string,
    updates: { name?: string; niche?: string; notes?: string }
  ) => {
    await SupabaseDataService.updateClient(activeWorkspace.id, clientId, updates);
    await refreshWorkspaceData(activeWorkspace.id);
  };

  const handleDeleteClient = async (clientId: string) => {
    await SupabaseDataService.deleteClient(activeWorkspace.id, clientId);
    await refreshWorkspaceData(activeWorkspace.id);
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
    persistenceStatus: LeadPersistenceStatus;
    persistenceMessage: string;
  }> => {
    // Call server endpoint
    const idToken = currentUser ? await currentUser.getIdToken().catch(() => null) : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idToken) {
      headers['Authorization'] = `Bearer ${idToken}`;
    }

    const response = await fetch(apiUrl('/api/search-leads'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filters,
        clientId: targetClient.id,
        workspaceId: activeWorkspace.id,
        providerType: providerConfig.providerType
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
      connectionsOrFollowers:
        raw.leadType === 'business' ? raw.connectionsOrFollowers || '' : raw.connectionsOrFollowers || '500+ connections',
      lastActivityDate: raw.lastActivityDate || 'N/A',
      dateAdded: dateToday,
      status: 'Not Contacted',
      notes: '',
      source: raw.source || 'LeadOcean B2B People Search API',
      leadType: raw.leadType,
      businessCategory: raw.businessCategory,
      businessWebsite: raw.businessWebsite,
      businessPhone: raw.businessPhone,
      businessAddress: raw.businessAddress,
      businessCity: raw.businessCity,
      businessCountry: raw.businessCountry,
      latitude: raw.latitude,
      longitude: raw.longitude
    }));

    // Deduplicate against existing client leads and save to Supabase
    const saveResult = await SupabaseDataService.saveLeadsForClient(
      activeWorkspace.id,
      targetClient.id,
      newLeadRecords
    );

    // Record Search Audit History to Supabase
    await SupabaseDataService.saveSearchRecord(
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

    // Immediate state refresh so the dashboard and tables update synchronously
    await refreshWorkspaceData(activeWorkspace.id);

    return {
      uniqueLeads: rawLeads,
      candidatesFound: data.metrics.rawCandidatesCount,
      duplicatesRemoved: data.metrics.totalDuplicatesRemoved + saveResult.duplicatesSkipped,
      finalCount: saveResult.added,
      persistenceStatus: saveResult.persistenceStatus,
      persistenceMessage: saveResult.persistenceMessage
    };
  };

  // Lead Inline Updates
  const handleUpdateLeadStatus = async (leadId: string, status: LeadStatus) => {
    await SupabaseDataService.updateLeadStatus(activeWorkspace.id, leadId, status);
    await refreshWorkspaceData(activeWorkspace.id);
  };

  const handleUpdateLeadNotes = async (leadId: string, notes: string) => {
    await SupabaseDataService.updateLeadNotes(activeWorkspace.id, leadId, notes);
    await refreshWorkspaceData(activeWorkspace.id);
  };

  const handleDeleteLeads = async (leadIds: string[]) => {
    await SupabaseDataService.deleteSelectedLeads(activeWorkspace.id, leadIds);
    await refreshWorkspaceData(activeWorkspace.id);
  };

  // Google Sheets Export Trigger
  const handleOpenExportModal = (leadsToExport: LeadRecord[], clientName?: string, clientId?: string) => {
    const resolvedClientId =
      clientId || (clientName ? clients.find((c) => c.name === clientName)?.id : activeClient?.id);
    const resolvedClient = clients.find((c) => c.id === resolvedClientId) || activeClient;

    setExportTargetClientId(resolvedClientId);
    setExportTargetLeads(
      leadsToExport.length > 0
        ? leadsToExport
        : resolvedClient
        ? allLeads.filter((l) => l.clientId === resolvedClient.id)
        : allLeads
    );
    setExportTargetClientName(clientName || resolvedClient?.name || 'General Agency Client');
    setIsExportModalOpen(true);
  };

  const handleUpdateProviderConfig = (cfg: Partial<LeadProviderConfig>) => {
    const updated = { ...providerConfig, ...cfg };
    setProviderConfig(updated);
    fetchProviderStatus(updated);
  };

  const [isConnectingSheets, setIsConnectingSheets] = useState<boolean>(false);
  const [sheetsAuthError, setSheetsAuthError] = useState<string | null>(null);

  const handleConnectSheets = async () => {
    if (isConnectingSheets) return;
    setIsConnectingSheets(true);
    setSheetsAuthError(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setCurrentUser(res.user);
        setUserEmail(res.account.email);
        setCachedAccessToken(res.accessToken);
        setIsGoogleConnected(true);
        setSheetsAuthError(null);
      }
    } catch (err: any) {
      console.error('Google Sheets sign in error:', err);
      setSheetsAuthError(err.message || 'Google Sheets authorization failed.');
    } finally {
      setIsConnectingSheets(false);
    }
  };

  const handleDisconnectSheets = async () => {
    try {
      await googleSignOut();
      setCurrentUser(null);
      setIsGoogleConnected(false);
      setSheetsAuthError(null);
    } catch (e) {
      console.error('Sign out error:', e);
    }
  };

  const handleSignOut = async () => {
    await handleDisconnectSheets();
  };

  const handleStartLeadSearchFromDashboard = () => {
    if (activeTab !== 'finder') {
      setActiveTab('finder');
    }
    setTimeout(() => {
      const element = document.getElementById('lead-finder-section');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
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
            setUserEmail(user.email || 'anjanapadhi21@gmail.com');
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
                onSelectClient={handleSelectClient}
                onStartLeadSearch={handleStartLeadSearchFromDashboard}
                providerStatus={providerStatus}
                isGoogleConnected={isGoogleConnected}
                isConnectingSheets={isConnectingSheets}
                sheetsAuthError={sheetsAuthError}
                onConnectSheets={handleConnectSheets}
                onDisconnectSheets={handleDisconnectSheets}
                onOpenExportModal={(leads, cName) => handleOpenExportModal(leads, cName)}
                userEmail={userEmail}
                onSignOut={handleSignOut}
                isLoadingData={isLoadingData}
                supabaseError={supabaseError}
                onRetryData={() => refreshWorkspaceData(activeWorkspace.id)}
                onRefreshProviderStatus={() => fetchProviderStatus()}
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
                  providerType={providerConfig.providerType}
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
              getLeadsForClient={(cId) => allLeads.filter((l) => l.clientId === cId)}
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
                setUserEmail(user.email || 'anjanapadhi21@gmail.com');
                setCachedAccessToken(token);
                setIsGoogleConnected(true);
              }}
              providerStatus={providerStatus}
              onRefreshProviderStatus={() => fetchProviderStatus()}
              clients={clients}
              activeClient={activeClient}
              onSelectClient={handleSelectClient}
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
        existingSpreadsheetId={
          exportTargetClientId
            ? dbService.getGoogleIntegration(activeWorkspace.id, exportTargetClientId)?.spreadsheetId
            : undefined
        }
        onGoogleAuthSuccess={(user, token) => {
          setCurrentUser(user);
          setUserEmail(user.email || 'user@example.com');
          setCachedAccessToken(token);
          setIsGoogleConnected(true);
        }}
        onExportSuccess={(sheetId, sheetUrl, addedCount, skippedCount) => {
          if (exportTargetClientId) {
            dbService.saveGoogleIntegration({
              id: `gint-${Date.now()}`,
              workspaceId: activeWorkspace.id,
              clientId: exportTargetClientId,
              spreadsheetId: sheetId,
              spreadsheetUrl: sheetUrl,
              sheetTitle: exportTargetClientName,
              lastExportedAt: new Date().toISOString()
            });
            dbService.saveExportHistory({
              id: `exp-${Date.now()}`,
              workspaceId: activeWorkspace.id,
              clientId: exportTargetClientId,
              spreadsheetId: sheetId,
              exportedLeadsCount: addedCount,
              skippedDuplicatesCount: skippedCount,
              exportedByEmail: userEmail,
              createdAt: new Date().toISOString()
            });
            refreshWorkspaceData(activeWorkspace.id);
          }
        }}
      />
    </div>
  );
}
