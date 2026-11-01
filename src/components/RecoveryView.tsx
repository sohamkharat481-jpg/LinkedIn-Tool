import React, { useState } from 'react';
import { SupabaseDataService } from '../services/supabaseDataService';
import { LeadRecord } from '../types';

interface RecoveryProps {
  workspaceId: string;
  clientId: string;
  onClose: () => void;
}

export const RecoveryView: React.FC<RecoveryProps> = ({ workspaceId, clientId, onClose }) => {
  const [status, setStatus] = useState<string>('Ready to scan');
  const [leadsToMigrate, setLeadsToMigrate] = useState<LeadRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<string>('');

  const scanLocalStorage = () => {
    setStatus('Scan initiated...');
    setDiagnostics('');
    
    try {
      const leadsJson = localStorage.getItem('llf_leads_v1');
      const clientLeadsJson = localStorage.getItem('llf_client_leads_v1');
      
      const diag = `Keys exist: leads=${!!leadsJson}, clientLeads=${!!clientLeadsJson}.`;
      setDiagnostics(diag);

      if (!leadsJson) {
        setStatus('Error: Required LocalStorage key llf_leads_v1 missing.');
        return;
      }

      const allLeads: LeadRecord[] = JSON.parse(leadsJson);
      const clientLeads: { lead_id: string; client_id: string }[] = clientLeadsJson ? JSON.parse(clientLeadsJson) : [];
      
      if (!Array.isArray(allLeads)) {
        setStatus('Error: Invalid leads data format.');
        return;
      }
      
      const relevantLeads = allLeads.filter(l => {
          const hasClientLeadsKey = !!clientLeadsJson;
          const workspaceMatch = l.workspaceId === workspaceId;
          const clientMatch = hasClientLeadsKey 
              ? clientLeads.some(cl => cl.lead_id === l.id && cl.client_id === clientId)
              : (l.clientId === clientId);
          return workspaceMatch && clientMatch;
      });

      setLeadsToMigrate(relevantLeads);
      setStatus(`Scan complete. Found ${relevantLeads.length} leads in workspace ${workspaceId} for client ${clientId}.`);
      setDiagnostics(prev => prev + ` Parsed: leadsCount=${allLeads.length}, clientLeadsCount=${clientLeads.length}.`);
    } catch (e: any) {
      setStatus(`Scan error: ${e.message}`);
      console.error('Recovery scan error:', e);
    }
  };

  const migrate = async () => {
    if (leadsToMigrate.length === 0) return;
    setStatus('Migrating...');
    try {
        const result = await SupabaseDataService.saveLeadsForClient(workspaceId, clientId, leadsToMigrate);
        setStatus(`Migration complete: ${result.added} leads migrated.`);
    } catch (e: any) {
        setStatus(`Migration failed: ${e.message}`);
        console.error('Migration error:', e);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md max-w-lg w-full max-h-[80vh] overflow-y-auto">
      <h2 className="text-xl font-bold mb-4">Lead Recovery Utility</h2>
      <div className="text-xs text-gray-500 mb-4">
        <p>Workspace: {workspaceId}</p>
        <p>Client: {clientId}</p>
      </div>
      <div className="mb-4">
        <button onClick={scanLocalStorage} className="bg-blue-500 text-white px-4 py-2 rounded mr-2 hover:bg-blue-600">Scan LocalStorage</button>
        <button onClick={migrate} disabled={leadsToMigrate.length === 0} className="bg-green-500 text-white px-4 py-2 rounded disabled:opacity-50 hover:bg-green-600">Migrate to Supabase</button>
        <button onClick={onClose} className="ml-2 text-gray-500 hover:text-gray-700">Close</button>
      </div>
      <div className="font-mono text-xs bg-gray-50 p-3 rounded border border-gray-200 whitespace-pre-wrap">
        <p className="font-bold mb-1">Status:</p>
        <p className="mb-2">{status}</p>
        <p className="font-bold mb-1">Diagnostics:</p>
        <p>{diagnostics}</p>
      </div>
    </div>
  );
};
