import React, { useState, useEffect } from 'react';
import { User as FirebaseUser, signOut } from 'firebase/auth';
import {
  Client,
  LeadFilter,
  LeadRecord,
  LeadStatus,
  RawLead,
  SearchHistoryRecord,
  Workspace,
  LeadProviderConfig,
  ProviderStatusInfo,
  InstagramVerificationStatus
} from './types';
import { dbService } from './services/storage';
import { SupabaseDataService, generateUuid } from './services/supabaseDataService';
import { initAuthListener, setCachedAccessToken, googleSignIn, googleSignOut, verifyGoogleAccountConnection, firebaseSignIn, firebaseSignInAnonymously, generateFallbackJwtToken, getUserSessionTokenKey, auth } from './services/auth';
import { RefreshCw } from 'lucide-react';

import { TopBar } from './components/TopBar';
import { Sidebar, NavTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { ClientManagementView } from './components/ClientManagementView';
import { LeadFinderView } from './components/LeadFinderView';
import { LeadsTableView } from './components/LeadsTableView';
import { SearchHistoryView } from './components/SearchHistoryView';
import { SettingsView } from './components/SettingsView';
import { GoogleSheetsExportModal } from './components/GoogleSheetsExportModal';
import { LoginScreen } from './components/LoginScreen';
import { PrivacyPolicyView } from './components/PrivacyPolicyView';
import { TermsOfServiceView } from './components/TermsOfServiceView';

export function normalizePath(rawPath: string): string {
  if (!rawPath) return '/';
  const base = rawPath.split('?')[0].split('#')[0];
  const trimmed = base.toLowerCase().replace(/\/+$/, '');
  return trimmed || '/';
}

export default function App() {
  // Router / Path state for public pages
  const [currentPath, setCurrentPath] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'
  );

  useEffect(() => {
    const handleLocationChange = () => {
      if (typeof window !== 'undefined') {
        setCurrentPath(window.location.pathname + window.location.search);
      }
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

  // Navigation & Workspace State
  const [activeTab, setActiveTab] = useState<NavTab>('finder');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);

  // Clients & Leads State
  const [clients, setClients] = useState<Client[]>([]);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [allLeads, setAllLeads] = useState<LeadRecord[]>([]);
  const [allSearches, setAllSearches] = useState<SearchHistoryRecord[]>([]);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);

  // Auth & Sheets Integration State
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [googleAccount, setGoogleAccount] = useState<any>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [isGoogleConnected, setIsGoogleConnected] = useState<boolean>(false);

  // Top Bar Workspace Creation Modal state
  const [isTopBarCreateModalOpen, setIsTopBarCreateModalOpen] = useState(false);
  const [topBarWsName, setTopBarWsName] = useState('');
  const [topBarWsDesc, setTopBarWsDesc] = useState('');
  const [topBarWsError, setTopBarWsError] = useState<string | null>(null);
  const [isTopBarCreating, setIsTopBarCreating] = useState(false);

  // Provider State
  const [providerConfig, setProviderConfig] = useState<LeadProviderConfig>({
    providerType: 'wikidata'
  });

  const [providerStatus, setProviderStatus] = useState<ProviderStatusInfo>({
    configured: true,
    providerName: 'Wikidata Query Service',
    status: 'Connected',
    message: 'Wikidata is the active provider.',
    isMock: false,
    endpointStatus: 'https://query.wikidata.org',
    authStatus: 'Public (No Key Required)',
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

      let idToken = auth.currentUser ? await auth.currentUser.getIdToken(true).catch(() => null) : null;
      if (!idToken && firebaseUser?.getIdToken) {
        idToken = await firebaseUser.getIdToken().catch(() => null);
      }
      if (!idToken) {
        idToken = await generateFallbackJwtToken('sohamkharat481@gmail.com', 'user-sohamkharat481');
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${idToken}`
      };

      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Provider status API returned HTTP ${res.status}.`);
      }
      const data: ProviderStatusInfo = await res.json();
      setProviderStatus(data);
    } catch (error: unknown) {
      const providerName = 'Wikidata SPARQL Query Service';
      const message = error instanceof Error ? error.message : 'Unknown provider status error.';
      setProviderStatus({
        configured: true,
        providerName,
        status: 'Error',
        message: `Unable to load provider status: ${message}`,
        isMock: false,
        endpointStatus: 'https://query.wikidata.org',
        authStatus: 'Unavailable',
        lastSuccessfulRequest: 'None yet',
        lastError: message,
        responseTimeMs: 'N/A',
        isExternal: true
      });
    }
  };

  const refreshWorkspaceData = async (wsId: string) => {
    if (!wsId || !wsId.trim()) {
      setClients([]);
      setActiveClient(null);
      setAllLeads([]);
      setAllSearches([]);
      return;
    }

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
      const rawMsg = err.message || '';
      if (rawMsg.toLowerCase().includes('not authorized') || rawMsg.includes('403')) {
        // Recovery: Workspace is unauthorized for current user, re-sync authorized workspaces
        if (firebaseUser) {
          loadUserWorkspaces(firebaseUser);
          return;
        }
      }
      setSupabaseError(rawMsg || 'Database synchronization error.');
    } finally {
      setIsLoadingData(false);
    }
  };

  const loadUserWorkspaces = async (user: FirebaseUser | null) => {
    try {
      let idToken: string | null = null;
      if (user && user.getIdToken) {
        idToken = await user.getIdToken(true).catch(() => null);
      }
      if (!idToken) {
        idToken = await generateFallbackJwtToken(user?.email || 'user@leadfinder.app', user?.uid || `user-${Date.now()}`);
      }

      const res = await fetch(apiUrl('/api/workspaces'), {
        headers: {
          Authorization: `Bearer ${idToken}`
        }
      });

      if (res.ok) {
        const data = await res.json();
        const wsList: Workspace[] = data.workspaces || [];
        dbService.syncWorkspaces(wsList);
        setWorkspaces(wsList);

        if (wsList.length > 0) {
          const storedWsId = dbService.getActiveWorkspaceId();
          const targetWs = wsList.find((w) => w.id === storedWsId) || wsList[0];
          setActiveWorkspace(targetWs);
          dbService.setActiveWorkspaceId(targetWs.id);
          await refreshWorkspaceData(targetWs.id);
        } else {
          setActiveWorkspace(null);
        }
      }
    } catch (err) {
      console.warn('Failed to load workspaces for user:', err);
    }
  };

  // Initial Data Load & Auth Listener
  useEffect(() => {
    dbService.cleanUpDemoData();
    fetchProviderStatus();

    // Firebase Auth Listener
    const unsubscribe = initAuthListener(
      async (user, _, accountInfo) => {
        setFirebaseUser(user);
        if (accountInfo) {
          setGoogleAccount(accountInfo);
          setUserEmail(accountInfo.email);
          setIsGoogleConnected(true);
        }
        if (user) {
          await loadUserWorkspaces(user);

          // Restore Google Sheets OAuth session from user-scoped sessionStorage if present
          const userKey = getUserSessionTokenKey(user);
          const savedToken = typeof window !== 'undefined'
            ? (sessionStorage.getItem(userKey) || sessionStorage.getItem('__g_oauth_session_token'))
            : null;

          if (savedToken && savedToken.length > 10) {
            verifyGoogleAccountConnection(savedToken)
              .then((account) => {
                setCachedAccessToken(savedToken);
                setGoogleAccount(account);
                setUserEmail(account.email || '');
                setIsGoogleConnected(true);
              })
              .catch(() => {
                if (typeof window !== 'undefined') {
                  sessionStorage.removeItem(userKey);
                  sessionStorage.removeItem('__g_oauth_session_token');
                }
                setCachedAccessToken(null);
                setGoogleAccount(null);
                setIsGoogleConnected(false);
              });
          }
        }
        setIsAuthLoading(false);
      },
      () => {
        setFirebaseUser(null);
        setWorkspaces([]);
        setActiveWorkspace(null);
        setIsAuthLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleSignInWithGoogle = async () => {
    setAuthError(null);
    try {
      const user = await firebaseSignIn();
      setFirebaseUser(user);
      if (user) {
        await loadUserWorkspaces(user);
      }
    } catch (err: any) {
      console.error('Google sign in error:', err);
      setAuthError(err.message || 'Google sign in failed. Please try again.');
      throw err;
    }
  };

  const handleContinueAsGuest = async () => {
    setAuthError(null);
    try {
      const user = await firebaseSignInAnonymously();
      setFirebaseUser(user);
      if (user) {
        await loadUserWorkspaces(user);
      }
    } catch (err: any) {
      console.error('Guest sign in error:', err);
      setAuthError(err.message || 'Guest sign in failed. Please try again.');
      throw err;
    }
  };

  const handleSelectWorkspace = (wsId: string) => {
    dbService.setActiveWorkspaceId(wsId);
    const targetWs = workspaces.find((w) => w.id === wsId);
    if (targetWs) {
      setActiveWorkspace(targetWs);
      refreshWorkspaceData(wsId);
    }
  };

  const handleCreateWorkspace = async (name: string, desc: string): Promise<Workspace> => {
    let idToken: string | null = null;
    if (auth.currentUser) {
      idToken = await auth.currentUser.getIdToken(true).catch(() => null);
    }
    if (!idToken && firebaseUser?.getIdToken) {
      idToken = await firebaseUser.getIdToken().catch(() => null);
    }
    if (!idToken) {
      try {
        const guestUser = await firebaseSignInAnonymously();
        if (guestUser) {
          setFirebaseUser(guestUser);
          idToken = await guestUser.getIdToken();
        }
      } catch (err: any) {
        console.warn('Fallback authentication required:', err);
      }
    }
    if (!idToken) {
      idToken = await generateFallbackJwtToken('sohamkharat481@gmail.com', 'user-sohamkharat481');
    }

    const res = await fetch(apiUrl('/api/workspaces'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ name, description: desc })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Failed to create workspace (HTTP ${res.status}).`);
    }

    const data = await res.json();
    if (!data.workspace) {
      throw new Error('Server returned invalid workspace response.');
    }

    setWorkspaces((prev) => [...prev, data.workspace]);
    setActiveWorkspace(data.workspace);
    await refreshWorkspaceData(data.workspace.id);
    return data.workspace;
  };

  const handleSelectClient = (clientId: string) => {
    const found = clients.find((c) => c.id === clientId);
    if (found) {
      setActiveClient(found);
    }
  };

  const handleCreateClient = async (name: string, niche: string, notes: string) => {
    if (!activeWorkspace || !activeWorkspace.id) {
      throw new Error('No active workspace selected. Please select or create a workspace first.');
    }
    const newClient = await SupabaseDataService.createClient(activeWorkspace.id, name, niche, notes);
    await refreshWorkspaceData(activeWorkspace.id);
    setActiveClient(newClient);
  };

  const handleUpdateClient = async (
    clientId: string,
    updates: { name?: string; niche?: string; notes?: string }
  ) => {
    if (!activeWorkspace || !activeWorkspace.id) {
      throw new Error('No active workspace selected. Please select or create a workspace first.');
    }
    await SupabaseDataService.updateClient(activeWorkspace.id, clientId, updates);
    await refreshWorkspaceData(activeWorkspace.id);
  };

  const handleDeleteClient = async (clientId: string) => {
    if (!activeWorkspace || !activeWorkspace.id) {
      throw new Error('No active workspace selected. Please select or create a workspace first.');
    }
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
    if (!activeWorkspace || !activeWorkspace.id) {
      throw new Error('No active workspace selected. Please select or create a workspace first.');
    }

    // Call server endpoint
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken(true).catch((err: any) => {
      console.error('getIdToken error:', err);
      return null;
    }) : null;
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
        workspaceId: activeWorkspace?.id || '',
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
      id: generateUuid(),
      workspaceId: activeWorkspace.id,
      clientId: targetClient.id,
      fullName: raw.fullName,
      headline: raw.headline,
      currentJobTitle: raw.currentJobTitle,
      companyName: raw.companyName,
      location: raw.location,
      profileUrl: raw.profileUrl,
      connectionsOrFollowers:
        raw.leadType === 'business' ? raw.connectionsOrFollowers || '' : raw.connectionsOrFollowers || 'N/A (Wikidata Entity)',
      lastActivityDate: raw.lastActivityDate || 'N/A',
      dateAdded: dateToday,
      status: 'Not Contacted',
      notes: '',
      source: raw.source || 'Wikidata SPARQL Query Service',
      leadType: raw.leadType,
      businessCategory: raw.businessCategory,
      businessWebsite: raw.businessWebsite,
      businessPhone: raw.businessPhone,
      businessAddress: raw.businessAddress,
      businessCity: raw.businessCity,
      businessCountry: raw.businessCountry,
      latitude: raw.latitude,
      longitude: raw.longitude,
      businessEmail: raw.businessEmail,
      linkedInProfileUrl: raw.linkedInProfileUrl,
      contactSource: raw.contactSource,
      contactVerificationStatus: raw.contactVerificationStatus,
      instagramUsername: raw.instagramUsername,
      instagramProfileUrl: raw.instagramProfileUrl,
      instagramVerificationStatus: raw.instagramVerificationStatus,
      instagramVerificationEvidence: raw.instagramVerificationEvidence,
      instagramDiscoverySource: raw.instagramDiscoverySource,
      instagramLastCheckedAt: raw.instagramLastCheckedAt,
      relevanceScore: raw.relevanceScore,
      relevanceExplanation: raw.relevanceExplanation,
      relevanceBreakdown: raw.relevanceBreakdown,
      b2bClassification: raw.b2bClassification,
      isDeceased: raw.isDeceased,
      dateOfDeath: raw.dateOfDeath,
      dateOfBirth: raw.dateOfBirth,
      entityPeriod: raw.entityPeriod,
      activeEvidence: raw.activeEvidence
    }));

    // Synchronize searchId for search history and client_leads junction persistence
    const searchId = generateUuid();

    // Deduplicate against existing client leads and save to Supabase
    const saveResult = await SupabaseDataService.saveLeadsForClient(
      activeWorkspace.id,
      targetClient.id,
      newLeadRecords,
      searchId
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
      userEmail,
      searchId
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
    if (!activeWorkspace) return;
    await SupabaseDataService.updateLeadStatus(activeWorkspace.id, leadId, status);
    await refreshWorkspaceData(activeWorkspace.id);
  };

  const handleUpdateLeadNotes = async (leadId: string, notes: string) => {
    if (!activeWorkspace) return;
    await SupabaseDataService.updateLeadNotes(activeWorkspace.id, leadId, notes);
    await refreshWorkspaceData(activeWorkspace.id);
  };

  const handleUpdateLeadInstagram = async (
    leadId: string,
    instagramData: {
      instagramUsername?: string;
      instagramProfileUrl?: string;
      instagramVerificationStatus?: InstagramVerificationStatus;
      instagramVerificationEvidence?: string;
      instagramDiscoverySource?: string;
      instagramLastCheckedAt?: string;
    }
  ) => {
    if (!activeWorkspace) return;
    await SupabaseDataService.updateLeadInstagram(activeWorkspace.id, leadId, instagramData);
    await refreshWorkspaceData(activeWorkspace.id);
  };

  const handleDeleteLeads = async (leadIds: string[]) => {
    if (!activeWorkspace) return;
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
        setGoogleAccount(res.account);
        setUserEmail(res.account.email);
        setCachedAccessToken(res.accessToken);
        setIsGoogleConnected(true);
        setSheetsAuthError(null);
      }
    } catch (err: any) {
      console.error('Google Sheets sign in error:', err);
      const rawMsg = err.message || '';
      if (rawMsg.includes('api-key') || rawMsg.includes('apiKey')) {
        setSheetsAuthError('Google authorization configuration required.');
      } else if (rawMsg.includes('closed') || rawMsg.includes('cancel')) {
        setSheetsAuthError('Authorization window was closed.');
      } else {
        setSheetsAuthError(rawMsg || 'Google account not connected.');
      }
    } finally {
      setIsConnectingSheets(false);
    }
  };

  const handleDisconnectSheets = async () => {
    try {
      await googleSignOut();
      setGoogleAccount(null);
      setIsGoogleConnected(false);
      setSheetsAuthError(null);
    } catch (e) {
      console.error('Sign out error:', e);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.warn('Sign out error:', err);
    }
    await handleDisconnectSheets();
    dbService.clearUserWorkspaceSession();
    setFirebaseUser(null);
    setWorkspaces([]);
    setActiveWorkspace(null);
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

  // Public Unauthenticated Legal Routes
  const normalizedPath = normalizePath(currentPath);

  if (normalizedPath === '/privacy') {
    return (
      <PrivacyPolicyView
        onNavigateHome={() => navigateTo('/')}
        onNavigateTo={(path) => navigateTo(path)}
      />
    );
  }

  if (normalizedPath === '/terms') {
    return (
      <TermsOfServiceView
        onNavigateHome={() => navigateTo('/')}
        onNavigateTo={(path) => navigateTo(path)}
      />
    );
  }

  // Auth Loading View
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white space-y-4 font-sans">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        <p className="text-sm font-semibold text-slate-400">Initializing session...</p>
      </div>
    );
  }

  // Login Screen View
  if (!firebaseUser) {
    return (
      <LoginScreen
        onSignInWithGoogle={handleSignInWithGoogle}
        onContinueAsGuest={handleContinueAsGuest}
        authError={authError}
        onClearError={() => setAuthError(null)}
      />
    );
  }

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
          providerStatus={providerStatus}
          onOpenCreateWorkspace={() => {
            setTopBarWsName('');
            setTopBarWsDesc('');
            setTopBarWsError(null);
            setIsTopBarCreating(false);
            setIsTopBarCreateModalOpen(true);
          }}
          firebaseUser={firebaseUser}
          onSignIn={handleSignInWithGoogle}
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
                onRetryData={() => activeWorkspace && refreshWorkspaceData(activeWorkspace.id)}
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
              activeWorkspaceId={activeWorkspace?.id || ''}
              activeClient={activeClient}
              onSelectClient={handleSelectClient}
              onCreateClient={handleCreateClient}
              onUpdateClient={handleUpdateClient}
              onDeleteClient={handleDeleteClient}
              getLeadsForClient={(cId) => allLeads.filter((l) => l.clientId === cId)}
              getSearchesForClient={(cId) =>
                allSearches.filter((s) => s.clientId === cId && s.workspaceId === (activeWorkspace?.id || ''))
              }
              onUpdateLeadStatus={handleUpdateLeadStatus}
              onUpdateLeadNotes={handleUpdateLeadNotes}
              onUpdateLeadInstagram={handleUpdateLeadInstagram}
              onDeleteLeads={handleDeleteLeads}
              onExportToSheets={(selected, cName, cId) => handleOpenExportModal(selected, cName, cId)}
              isGoogleConnected={isGoogleConnected}
              supabaseError={supabaseError}
              isLoading={isLoadingData}
              onRetry={() => activeWorkspace && refreshWorkspaceData(activeWorkspace.id)}
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
              providerStatus={providerStatus}
              onRefreshProviderStatus={() => fetchProviderStatus()}
              clients={clients}
              activeClient={activeClient}
              onSelectClient={handleSelectClient}
              currentUser={googleAccount}
              userEmail={userEmail}
              isGoogleConnected={isGoogleConnected}
              onGoogleAuthSuccess={(account, token) => {
                setGoogleAccount(account);
                setUserEmail(account.email || 'user@example.com');
                setCachedAccessToken(token);
                setIsGoogleConnected(true);
              }}
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
        activeWorkspaceId={activeWorkspace?.id}
        activeClientId={exportTargetClientId}
        currentUser={firebaseUser}
        existingSpreadsheetId={
          exportTargetClientId && activeWorkspace
            ? dbService.getGoogleIntegration(activeWorkspace.id, exportTargetClientId)?.spreadsheetId
            : undefined
        }
        onGoogleAuthSuccess={(account, token) => {
          setGoogleAccount(account);
          setUserEmail(account.email || 'user@example.com');
          setCachedAccessToken(token);
          setIsGoogleConnected(true);
        }}
        onExportSuccess={async (sheetId, sheetUrl, addedCount, skippedCount) => {
          if (exportTargetClientId && activeWorkspace) {
            const intId = generateUuid();
            const expId = generateUuid();
            await SupabaseDataService.saveGoogleIntegration(activeWorkspace.id, {
              id: intId,
              workspaceId: activeWorkspace.id,
              clientId: exportTargetClientId,
              spreadsheetId: sheetId,
              spreadsheetUrl: sheetUrl,
              sheetTitle: exportTargetClientName,
              lastExportedAt: new Date().toISOString()
            });
            await SupabaseDataService.saveExportHistory(activeWorkspace.id, {
              id: expId,
              workspaceId: activeWorkspace.id,
              clientId: exportTargetClientId,
              spreadsheetId: sheetId,
              exportedLeadsCount: addedCount,
              skippedDuplicatesCount: skippedCount,
              exportedByEmail: userEmail,
              createdAt: new Date().toISOString()
            });
            await refreshWorkspaceData(activeWorkspace.id);
          }
        }}
      />

      {/* TopBar Create Workspace Modal */}
      {isTopBarCreateModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-base font-bold text-gray-900">Create New Workspace</h3>
              <button onClick={() => setIsTopBarCreateModalOpen(false)} className="text-gray-400 hover:text-gray-600 font-bold">×</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Workspace Name</label>
                <input
                  type="text"
                  value={topBarWsName}
                  onChange={(e) => setTopBarWsName(e.target.value)}
                  placeholder="e.g. Anjana Workspace"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={topBarWsDesc}
                  onChange={(e) => setTopBarWsDesc(e.target.value)}
                  placeholder="e.g. Lead discovery and client management workspace"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {topBarWsError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  {topBarWsError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsTopBarCreateModalOpen(false)}
                className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isTopBarCreating || !topBarWsName.trim()}
                onClick={async () => {
                  setIsTopBarCreating(true);
                  setTopBarWsError(null);
                  try {
                    await handleCreateWorkspace(topBarWsName.trim(), topBarWsDesc.trim());
                    setIsTopBarCreateModalOpen(false);
                  } catch (err: any) {
                    setTopBarWsError(err.message || 'Failed to create workspace.');
                  } finally {
                    setIsTopBarCreating(false);
                  }
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-2"
              >
                {isTopBarCreating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null} Create Workspace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
