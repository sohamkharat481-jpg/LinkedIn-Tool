import React, { useState } from 'react';
import { Client, LeadRecord, SearchHistoryRecord } from '../types';
import { Plus, Edit2, Trash2, FolderOpen, Users, Search, FileText, X, Check, FileSpreadsheet } from 'lucide-react';
import { LeadsTableView } from './LeadsTableView';

interface ClientManagementViewProps {
  clients: Client[];
  activeWorkspaceId: string;
  activeClient: Client | null;
  onSelectClient: (clientId: string) => void;
  onCreateClient: (name: string, niche: string, notes: string) => void;
  onUpdateClient: (clientId: string, updates: { name?: string; niche?: string; notes?: string }) => void;
  onDeleteClient: (clientId: string) => void;
  getLeadsForClient: (clientId: string) => LeadRecord[];
  getSearchesForClient: (clientId: string) => SearchHistoryRecord[];
  onUpdateLeadStatus: (leadId: string, status: any) => void;
  onUpdateLeadNotes: (leadId: string, notes: string) => void;
  onDeleteLeads: (leadIds: string[]) => void;
  onExportToSheets: (leadsToExport: LeadRecord[], clientName: string) => void;
  isGoogleConnected: boolean;
}

export const ClientManagementView: React.FC<ClientManagementViewProps> = ({
  clients,
  activeWorkspaceId,
  activeClient,
  onSelectClient,
  onCreateClient,
  onUpdateClient,
  onDeleteClient,
  getLeadsForClient,
  getSearchesForClient,
  onUpdateLeadStatus,
  onUpdateLeadNotes,
  onDeleteLeads,
  onExportToSheets,
  isGoogleConnected
}) => {
  const [selectedDetailClient, setSelectedDetailClient] = useState<Client | null>(activeClient);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null);

  // Form State
  const [nameInput, setNameInput] = useState('');
  const [nicheInput, setNicheInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const handleOpenCreateModal = () => {
    setNameInput('');
    setNicheInput('');
    setNotesInput('');
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  const handleOpenEditModal = (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingClient(client);
    setNameInput(client.name);
    setNicheInput(client.niche);
    setNotesInput(client.notes);
    setFormError(null);
  };

  const handleSaveClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) {
      setFormError('Client name is required.');
      return;
    }
    if (!nicheInput.trim()) {
      setFormError('Business / Niche is required.');
      return;
    }

    if (editingClient) {
      onUpdateClient(editingClient.id, {
        name: nameInput.trim(),
        niche: nicheInput.trim(),
        notes: notesInput.trim()
      });
      setEditingClient(null);
    } else {
      onCreateClient(nameInput.trim(), nicheInput.trim(), notesInput.trim());
      setIsCreateModalOpen(false);
    }
  };

  const handleConfirmDelete = () => {
    if (deletingClientId) {
      onDeleteClient(deletingClientId);
      if (selectedDetailClient?.id === deletingClientId) {
        setSelectedDetailClient(null);
      }
      setDeletingClientId(null);
    }
  };

  const currentLeads = selectedDetailClient ? getLeadsForClient(selectedDetailClient.id) : [];
  const currentSearches = selectedDetailClient ? getSearchesForClient(selectedDetailClient.id) : [];

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Client Directory</h1>
          <p className="text-xs text-gray-500 mt-1">
            Manage agency clients. Lead data and search history are completely isolated per client.
          </p>
        </div>
        <button
          onClick={handleOpenCreateModal}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all shadow-xs"
        >
          <Plus className="w-4 h-4" /> Create New Client
        </button>
      </div>

      {/* Client Selection Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {clients.map((client) => {
          const isSelected = selectedDetailClient?.id === client.id;
          const isActive = activeClient?.id === client.id;
          const leads = getLeadsForClient(client.id);
          const searches = getSearchesForClient(client.id);

          return (
            <div
              key={client.id}
              onClick={() => {
                setSelectedDetailClient(client);
                onSelectClient(client.id);
              }}
              className={`p-5 rounded-2xl border transition-all cursor-pointer bg-white relative ${
                isSelected
                  ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-md'
                  : 'border-gray-200/90 hover:border-blue-300 shadow-xs'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-gray-900">{client.name}</h3>
                    {isActive && (
                      <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                        Active Target
                      </span>
                    )}
                  </div>
                  <span className="inline-block mt-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md">
                    {client.niche}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => handleOpenEditModal(client, e)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Edit client"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingClientId(client.id);
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete client"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {client.notes && (
                <p className="text-xs text-gray-600 mt-3 line-clamp-2 bg-gray-50 p-2 rounded-lg border border-gray-100">
                  {client.notes}
                </p>
              )}

              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                <span className="font-medium text-gray-900">{leads.length} Leads</span>
                <span>•</span>
                <span>{searches.length} Searches</span>
                <span>•</span>
                <span className="text-blue-600 font-semibold flex items-center gap-1">
                  Open Leads <FolderOpen className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Client Detailed Workstation */}
      {selectedDetailClient ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden mt-6">
          <div className="p-6 border-b border-gray-100 bg-slate-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-blue-400 font-semibold uppercase tracking-wider">Client Workspace</span>
                <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">
                  ID: {selectedDetailClient.id}
                </span>
              </div>
              <h2 className="text-xl font-bold mt-0.5">{selectedDetailClient.name}</h2>
              <p className="text-xs text-slate-300 mt-1">
                Niche: <span className="font-semibold text-white">{selectedDetailClient.niche}</span> • Isolated Lead Database
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => onExportToSheets(currentLeads, selectedDetailClient.name)}
                disabled={currentLeads.length === 0}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all shadow-xs"
              >
                <FileSpreadsheet className="w-4 h-4" /> Export Client Sheet
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Leads Table for this Client */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-gray-900">
                  Isolated Leads for {selectedDetailClient.name} ({currentLeads.length})
                </h3>
              </div>

              <LeadsTableView
                leads={currentLeads}
                clientName={selectedDetailClient.name}
                onUpdateStatus={onUpdateLeadStatus}
                onUpdateNotes={onUpdateLeadNotes}
                onDeleteLeads={onDeleteLeads}
                onExportToSheets={(selected) => onExportToSheets(selected, selectedDetailClient.name)}
                isGoogleConnected={isGoogleConnected}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center text-gray-500">
          Select a client above to view their isolated lead database and search history.
        </div>
      )}

      {/* Create / Edit Client Modal */}
      {(isCreateModalOpen || editingClient) && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-md w-full overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h3 className="text-base font-bold text-gray-900">
                {editingClient ? 'Edit Client' : 'Create New Client'}
              </h3>
              <button
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setEditingClient(null);
                }}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClient} className="p-5 space-y-4">
              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 p-3 rounded-lg">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  Client Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Dr. Sharma, Apex Software Labs"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  Business / Niche *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Doctor, Dental Clinic, SaaS, Real Estate"
                  value={nicheInput}
                  onChange={(e) => setNicheInput(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  Notes / Search Instructions
                </label>
                <textarea
                  rows={3}
                  placeholder="Target job titles, preferred locations, ICP specifics..."
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    setEditingClient(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-all shadow-xs"
                >
                  {editingClient ? 'Save Changes' : 'Create Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingClientId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-sm w-full p-6 text-center">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-gray-900">Delete Client?</h3>
            <p className="text-xs text-gray-500 mt-2">
              This will permanently delete this client and all associated leads and search history. This action cannot be undone.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={() => setDeletingClientId(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-xs font-semibold rounded-xl hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-xl hover:bg-red-700"
              >
                Delete Client
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
