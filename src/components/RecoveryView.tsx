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

  const scanLocalStorage = () => {
    try {
      setStatus('Scanning...');
      const leadsJson = localStorage.getItem('llf_leads_v1');
      const clientLeadsJson = localStorage.getItem('llf_client_leads_v1');
      
      if (!leadsJson || !clientLeadsJson) {
        setStatus('LocalStorage keys (llf_leads_v1 or llf_client_leads_v1) missing.');
        return;
      }

      const allLeads: LeadRecord[] = JSON.parse(leadsJson);
      const clientLeads: { lead_id: string; client_id: string }[] = JSON.parse(clientLeadsJson);
      
      if (!Array.isArray(allLeads) || !Array.isArray(clientLeads)) {
        setStatus('Invalid data format in LocalStorage.');
        return;
      }
      
      const relevantLeads = allLeads.filter(l => 
          l.workspaceId === workspaceId && 
          clientLeads.some(cl => cl.lead_id === l.id && cl.client_id === clientId)
      );

      if (relevantLeads.length === 0) {
        setStatus('No eligible leads found for this workspace/client combination.');
      } else {
        setLeadsToMigrate(relevantLeads);
        setStatus(`Found ${relevantLeads.length} leads eligible for migration.`);
      }
    } catch (e: any) {
      setStatus(`Scan error: ${e.message}`);
      console.error('Recovery scan error:', e);
    }
  };

  const migrate = async () => {
    if (leadsToMigrate.length === 0) return;
    setStatus('Migrating... please wait...');
    try {
        const result = await SupabaseDataService.saveLeadsForClient(workspaceId, clientId, leadsToMigrate);
        setStatus(`Migration complete: ${result.added} leads migrated successfully.`);
        // Don't auto-reload, allow user to verify
    } catch (e: any) {
        setStatus(`Migration failed: ${e.message}`);
        console.error('Migration error:', e);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">Lead Recovery Utility</h2>
      <p className="mb-4">Workspace: {workspaceId}</p>
      <p className="mb-4">Client: {clientId}</p>
      <div className="mb-4">
        <button onClick={scanLocalStorage} className="bg-blue-500 text-white px-4 py-2 rounded mr-2">Scan LocalStorage</button>
        <button onClick={migrate} disabled={leadsToMigrate.length === 0} className="bg-green-500 text-white px-4 py-2 rounded">Migrate to Supabase</button>
        <button onClick={onClose} className="ml-2 text-gray-500">Close</button>
      </div>
      <p className="font-mono text-sm">{status}</p>
      {leadsToMigrate.length > 0 && <pre className="text-xs bg-gray-100 p-2 mt-2">{JSON.stringify(leadsToMigrate, null, 2)}</pre>}
    </div>
  );
};
