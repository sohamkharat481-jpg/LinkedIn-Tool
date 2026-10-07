import React from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { Client, Workspace, ProviderStatusInfo } from '../types';
import { googleSignIn, googleSignOut } from '../services/auth';
import { Building2, User, LogOut, CheckCircle, AlertCircle, RefreshCw, Database, Sparkles, ShieldCheck, XCircle } from 'lucide-react';

interface TopBarProps {
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  onSelectWorkspace: (wsId: string) => void;
  clients: Client[];
  activeClient: Client | null;
  onSelectClient: (clientId: string) => void;
  currentUser: FirebaseUser | null;
  userEmail: string;
  isGoogleConnected: boolean;
  onGoogleAuthSuccess: (user: FirebaseUser, token: string) => void;
  providerStatus: ProviderStatusInfo;
}

export const TopBar: React.FC<TopBarProps> = ({
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  clients,
  activeClient,
  onSelectClient,
  currentUser,
  userEmail,
  isGoogleConnected,
  onGoogleAuthSuccess,
  providerStatus
}) => {
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const res = await googleSignIn();
      if (res) {
        onGoogleAuthSuccess(res.user, res.accessToken);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Google authentication failed.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await googleSignOut();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30 px-4 py-3 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        
        {/* Workspace & Client Context Switcher */}
        <div className="flex items-center gap-3 sm:gap-6 flex-wrap">
          {/* Workspace Switcher */}
          <div className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200/80 transition-colors px-3 py-1.5 rounded-lg border border-gray-200">
            <Building2 className="w-4 h-4 text-blue-600" />
            <select
              value={activeWorkspace.id}
              onChange={(e) => onSelectWorkspace(e.target.value)}
              className="bg-transparent text-xs font-semibold text-gray-800 focus:outline-none cursor-pointer pr-1"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>

          {/* Active Client Selector */}
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg">
            <span className="text-xs font-medium text-blue-700">Active Client:</span>
            <select
              value={activeClient ? activeClient.id : ''}
              onChange={(e) => onSelectClient(e.target.value)}
              className="bg-transparent text-xs font-semibold text-blue-900 focus:outline-none cursor-pointer"
            >
              <option value="" disabled>
                -- Select Client --
              </option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} ({client.niche})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status Badges & User Profile */}
        <div className="flex items-center gap-3">
          
          {/* Provider Status Badge */}
          <div className="hidden lg:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border">
            {providerStatus.isMock ? (
              <span className="flex items-center gap-1 text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" /> Provider: Demo / Mock
              </span>
            ) : providerStatus.status === 'Connected' ? (
              <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Provider: Connected
              </span>
            ) : providerStatus.status === 'Not Configured' ? (
              <span className="flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Provider: Not Configured
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full font-semibold">
                <XCircle className="w-3.5 h-3.5 text-red-600" /> Provider: Error
              </span>
            )}
          </div>

          {/* Google Sheets Auth Badge */}
          <div className="hidden md:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border">
            {isGoogleConnected ? (
              <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Google Sheets
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Connect Sheets
              </span>
            )}
          </div>

          {currentUser || userEmail ? (
            <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg p-1.5 pl-3">
              <div className="flex flex-col text-right">
                <span className="text-xs font-semibold text-gray-800">
                  {currentUser?.displayName || userEmail.split('@')[0]}
                </span>
                <span className="text-[10px] text-gray-500 truncate max-w-[140px]">
                  {currentUser?.email || userEmail}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleSignIn}
              disabled={isSigningIn}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3.5 py-2 rounded-lg transition-all shadow-xs disabled:opacity-50"
            >
              {isSigningIn ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Signing in...
                </>
              ) : (
                <>
                  <User className="w-3.5 h-3.5" /> Sign in with Google
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {authError && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5 rounded-md flex items-center justify-between">
          <span>{authError}</span>
          <button onClick={() => setAuthError(null)} className="text-red-800 font-bold ml-2">×</button>
        </div>
      )}
    </header>
  );
};
