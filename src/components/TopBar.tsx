import { Building2 } from 'lucide-react';
import { Client, Workspace, ProviderStatusInfo } from '../types';

interface TopBarProps {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  onSelectWorkspace: (wsId: string) => void;
  clients: Client[];
  activeClient: Client | null;
  onSelectClient: (clientId: string) => void;
  providerStatus: ProviderStatusInfo;
  onOpenCreateWorkspace?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  clients,
  activeClient,
  onSelectClient,
  providerStatus,
  onOpenCreateWorkspace
}) => {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30 px-4 py-3 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        
        {/* Workspace & Client Context Switcher */}
        <div className="flex items-center gap-3 sm:gap-6 flex-wrap">
          {/* Workspace Switcher */}
          <div className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200/80 transition-colors px-3 py-1.5 rounded-lg border border-gray-200">
            <Building2 className="w-4 h-4 text-blue-600" />
            <select
              value={activeWorkspace?.id || ''}
              onChange={(e) => {
                if (e.target.value === '__create_new__') {
                  if (onOpenCreateWorkspace) onOpenCreateWorkspace();
                } else {
                  onSelectWorkspace(e.target.value);
                }
              }}
              className="bg-transparent text-xs font-semibold text-gray-800 focus:outline-none cursor-pointer pr-1"
            >
              {workspaces.length === 0 ? (
                <option value="">No Workspace</option>
              ) : (
                workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))
              )}
              <option value="__create_new__">+ Create New Workspace...</option>
            </select>
          </div>

          {/* Active Client Selector */}
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg">
            <span className="text-xs font-medium text-blue-700">Active Client:</span>
            <select
              value={activeClient?.id || ''}
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
      </div>
    </header>
  );
};
