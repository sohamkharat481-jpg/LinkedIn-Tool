import React, { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import {
  Client,
  LeadFilter,
  LeadRecord,
  SearchHistoryRecord,
  Workspace,
  Organization,
  ProviderStatusInfo
} from './types';
import { SupabaseDataService } from './services/supabaseDataService';
import { 
    initAuthListener, 
    supabaseSignOut
} from './services/auth';
import { RefreshCw } from 'lucide-react';
import { supabase } from './services/supabase';
import { useAuthStartup } from './hooks/useAuthStartup';

import { apiUrl } from './services/apiClient';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TopBar } from './components/TopBar';
import { Sidebar, NavTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { ClientManagementView } from './components/ClientManagementView';
import { LeadFinderView } from './components/LeadFinderView';
import { SearchHistoryView } from './components/SearchHistoryView';
import { SettingsView } from './components/SettingsView';
import { GoogleSheetsExportModal } from './components/GoogleSheetsExportModal';
import { AuthPage } from './components/AuthPage';
import { TeamManagementView } from './components/TeamManagementView';
import { PrivacyPolicyView } from './components/PrivacyPolicyView';
import { TermsOfServiceView } from './components/TermsOfServiceView';

export function normalizePath(rawPath: string): string {
  if (!rawPath) return '/';
  const base = rawPath.split('?')[0].split('#')[0];
  const trimmed = base.toLowerCase().replace(/\/+$/, '');
  return trimmed || '/';
}

export default function App() {
  const startup = useAuthStartup();

  const [currentPath, setCurrentPath] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'
  );

  useEffect(() => {
    const handleLocationChange = () => {
      if (typeof window !== 'undefined') setCurrentPath(window.location.pathname + window.location.search);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const navigateTo = (path: string) => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
      setCurrentPath(path);
    }
  };

  // Auth State
  const user = startup.user;
  const organization = startup.organization;
  const workspaces = startup.workspaces;
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const activeWorkspace = selectedWorkspace || startup.activeWorkspace;
  const isAuthLoading = startup.state === 'INITIALIZING' || startup.state === 'AUTHENTICATING' || startup.state === 'RESOLVING_ORGANIZATION' || startup.state === 'RESOLVING_WORKSPACE';
  const onboarded = startup.state === 'READY';
  
  // Data State
  const [activeTab, setActiveTab] = useState<NavTab>('finder');
  const [clients, setClients] = useState<Client[]>([]);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [allLeads, setAllLeads] = useState<LeadRecord[]>([]);
  const [allSearches, setAllSearches] = useState<SearchHistoryRecord[]>([]);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Google Integration State
  const [isGoogleConnected, setIsGoogleConnected] = useState<boolean>(false);

  // Provider State
  const [providerStatus, setProviderStatus] = useState<ProviderStatusInfo>({
    configured: true,
    providerName: 'Wikidata Query Service',
    status: 'Connected',
    message: 'Active and ready.',
    isMock: false,
    endpointStatus: 'OK',
    authStatus: 'Public',
    lastSuccessfulRequest: 'None',
    lastError: 'None',
    responseTimeMs: 0,
    isExternal: true
  });

  // Modal State
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportLeads, setExportLeads] = useState<LeadRecord[]>([]);
  
  // Load workspace data when activeWorkspace changes
  useEffect(() => {
    if (activeWorkspace) {
        loadWorkspaceData(activeWorkspace.id);
    }
  }, [activeWorkspace?.id]);

  // Clean up /auth/callback URL path after successful OAuth startup
  useEffect(() => {
    if (startup.state === 'READY' && typeof window !== 'undefined' && window.location.pathname.startsWith('/auth/callback')) {
      window.history.replaceState({}, '', '/');
      setCurrentPath('/');
    }
  }, [startup.state]);

  // Early returns AFTER all hooks are unconditionally declared
  if (!supabase) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white space-y-4 font-sans">
        <p className="text-xl font-bold">Database Configuration Missing</p>
        <p className="text-sm text-slate-400">Please check your environment variables (SUPABASE_URL, SUPABASE_ANON_KEY).</p>
      </div>
    );
  }

  if (startup.state === 'ERROR') {
      return (
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-8 font-sans text-center">
          <p className="text-xl font-bold mb-2">Startup Error</p>
          <div className="bg-slate-800 p-4 rounded text-sm text-left font-mono w-full max-w-md mb-4">
              <p>Failed phase: {startup.failedPhase || 'Unknown'}</p>
              <p>Error: {startup.error}</p>
              <p>Duration: {startup.phaseDuration}ms</p>
          </div>
          <button className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded font-bold cursor-pointer transition-colors" onClick={() => window.location.reload()}>Retry</button>
        </div>
      );
  }

  const loadWorkspaceData = async (wsId: string) => {
    setIsLoadingData(true);
    setDataError(null);
    try {
      const [cList, leads, searches] = await Promise.all([
        SupabaseDataService.getClients(wsId),
        SupabaseDataService.getAllLeads(wsId),
        SupabaseDataService.getSearches(wsId)
      ]);
      setClients(cList);
      setAllLeads(leads);
      setAllSearches(searches);
      if (cList.length > 0 && !activeClient) setActiveClient(cList[0]);
    } catch (err: any) {
      setDataError(err.message);
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleSignOut = async () => {
    await supabaseSignOut();
    navigateTo('/');
  };

  const handleSelectWorkspace = (wsId: string) => {
    const ws = workspaces.find(w => w.id === wsId);
    if (ws) {
      setSelectedWorkspace(ws);
      loadWorkspaceData(wsId);
    }
  };

  const handleSelectClient = (clientId: string) => {
      const client = clients.find(c => c.id === clientId) || null;
      setActiveClient(client);
  };

  // Actions
  const handleCreateClient = async (name: string, niche: string, notes: string) => {
    if (!activeWorkspace) return;
    const newClient = await SupabaseDataService.createClient(activeWorkspace.id, name, niche, notes);
    setClients(prev => [...prev, newClient]);
    setActiveClient(newClient);
  };

  const handleExecuteSearch = async (filters: LeadFilter, targetClient: Client) => {
    if (!activeWorkspace) throw new Error('No active workspace');
    const res = await SupabaseDataService.saveLeadsForClient(activeWorkspace.id, targetClient.id, []); 
    await loadWorkspaceData(activeWorkspace.id);
    return { 
        uniqueLeads: [], 
        candidatesFound: 0, 
        duplicatesRemoved: 0, 
        finalCount: 0, 
        persistenceStatus: 'confirmed' as any, 
        persistenceMessage: 'Search completed' 
    };
  };

  // Render Logic
  const normalizedPath = normalizePath(currentPath);

  if (normalizedPath === '/privacy') {
    return <PrivacyPolicyView onBack={() => navigateTo('/')} />;
  }
  if (normalizedPath === '/terms') {
    return <TermsOfServiceView onBack={() => navigateTo('/')} />;
  }

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white space-y-4 font-sans">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        <p className="text-sm font-semibold text-slate-400">Initializing secure session...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthPage onSuccess={() => {}} />;
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} activeClient={activeClient} providerStatus={providerStatus} />
      
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <TopBar 
          workspaces={workspaces} 
          activeWorkspace={activeWorkspace} 
          onSelectWorkspace={handleSelectWorkspace} 
          clients={clients} 
          activeClient={activeClient} 
          onSelectClient={handleSelectClient}
          onOpenCreateWorkspace={() => {}} 
          user={user} 
          onSignIn={async () => { navigateTo('/'); }}
          providerStatus={providerStatus}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'finder' && (
            <div className="space-y-8">
              <DashboardView
                clients={clients}
                activeClient={activeClient}
                allLeads={allLeads}
                allSearches={allSearches}
                onNavigate={setActiveTab}
                onOpenClient={(client) => { setActiveClient(client); setActiveTab('clients'); }}
                onSelectClient={handleSelectClient}
                onStartLeadSearch={() => setActiveTab('finder')}
                providerStatus={providerStatus}
                isGoogleConnected={isGoogleConnected}
                isConnectingSheets={false}
                sheetsAuthError={null}
                onConnectSheets={() => {}}
                onDisconnectSheets={() => {}}
                onOpenExportModal={(leads) => { setExportLeads(leads); setIsExportModalOpen(true); }}
                userEmail={user.email || ''}
                onSignOut={handleSignOut}
                isLoadingData={isLoadingData}
                supabaseError={dataError}
                onRetryData={() => activeWorkspace && loadWorkspaceData(activeWorkspace.id)}
                onRefreshProviderStatus={() => {}}
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
                  providerType="wikidata"
                />
              </div>
            </div>
          )}

          {activeTab === 'clients' && (
            <ErrorBoundary>
              <ClientManagementView
                clients={clients}
                activeWorkspaceId={activeWorkspace?.id || ''}
                activeClient={activeClient}
                onSelectClient={handleSelectClient}
                onCreateClient={handleCreateClient}
                onUpdateClient={async (clientId, updates) => {
                    if (!activeWorkspace) return;
                    await SupabaseDataService.updateClient(activeWorkspace.id, clientId, updates);
                    await loadWorkspaceData(activeWorkspace.id);
                }}
                onDeleteClient={async (clientId) => {
                    if (!activeWorkspace) return;
                    await SupabaseDataService.deleteClient(activeWorkspace.id, clientId);
                    await loadWorkspaceData(activeWorkspace.id);
                }}
                getLeadsForClient={(cId) => allLeads.filter(l => l.clientId === cId)}
                getSearchesForClient={(cId) => allSearches.filter(s => s.clientId === cId)}
                onUpdateLeadStatus={async (leadId, status) => {
                    if (!activeWorkspace) return;
                    await SupabaseDataService.updateLeadStatus(activeWorkspace.id, leadId, status);
                    await loadWorkspaceData(activeWorkspace.id);
                }}
                onUpdateLeadNotes={async (leadId, notes) => {
                    if (!activeWorkspace) return;
                    await SupabaseDataService.updateLeadNotes(activeWorkspace.id, leadId, notes);
                    await loadWorkspaceData(activeWorkspace.id);
                }}
                onUpdateLeadInstagram={async (leadId, data) => {
                    if (!activeWorkspace) return;
                    await SupabaseDataService.updateLeadInstagram(activeWorkspace.id, leadId, data);
                    await loadWorkspaceData(activeWorkspace.id);
                }}
                onDeleteLeads={async (leadIds) => {
                    if (!activeWorkspace) return;
                    await SupabaseDataService.deleteSelectedLeads(activeWorkspace.id, leadIds);
                    await loadWorkspaceData(activeWorkspace.id);
                }}
                onExportToSheets={(selected) => { setExportLeads(selected); setIsExportModalOpen(true); }}
                isGoogleConnected={isGoogleConnected}
                supabaseError={dataError}
                isLoading={isLoadingData}
                onRetry={() => activeWorkspace && loadWorkspaceData(activeWorkspace.id)}
              />
            </ErrorBoundary>
          )}

          {activeTab === 'history' && <SearchHistoryView searches={allSearches} />}

          {activeTab === 'team' && (
            <TeamManagementView
              organization={organization}
              currentUser={user}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              onCreateWorkspace={async () => ({} as any)}
              providerConfig={{ providerType: 'wikidata' }}
              onUpdateProviderConfig={() => {}}
              providerStatus={providerStatus}
              onRefreshProviderStatus={() => {}}
              clients={clients}
              activeClient={activeClient}
              onSelectClient={handleSelectClient}
              currentUser={user}
              userEmail={user.email || ''}
              isGoogleConnected={isGoogleConnected}
              onGoogleAuthSuccess={() => {}}
            />
          )}
        </main>
      </div>

      <GoogleSheetsExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        clientName={activeClient?.name || 'Client'}
        leadsToExport={exportLeads}
        activeWorkspaceId={activeWorkspace?.id}
        activeClientId={activeClient?.id}
        currentUser={user}
        onGoogleAuthSuccess={() => {}}
        onExportSuccess={async () => {}}
      />
    </div>
  );
}
