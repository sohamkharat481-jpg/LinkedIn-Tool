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

  const [stats, setStats] = useState<{total: number, stale: number, current: number, status: string} | null>(null);

  const exportBackup = () => {
    const leadsJson = localStorage.getItem('llf_leads_v1');
    const clientLeadsJson = localStorage.getItem('llf_client_leads_v1');
    const allLeads: LeadRecord[] = leadsJson ? JSON.parse(leadsJson) : [];
    
    const staleWorkspaceId = '1f947cad-a738-4e81-8ad9-6ccd99c78033';
    const staleLeads = allLeads.filter(l => l.workspaceId === staleWorkspaceId);
    const currentLeads = allLeads.filter(l => l.workspaceId !== staleWorkspaceId);
    
    const backupData = {
        manifest: {
            timestamp: new Date().toISOString(),
            totalCount: allLeads.length,
            staleCount: staleLeads.length,
            currentCount: currentLeads.length
        },
        leads: allLeads,
        clientLeads: clientLeadsJson ? JSON.parse(clientLeadsJson) : []
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `llf_backup_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    setStats({
        total: allLeads.length,
        stale: staleLeads.length,
        current: currentLeads.length,
        status: 'Export Verified & Downloaded'
    });
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md max-w-lg w-full max-h-[80vh] overflow-y-auto">
      <h2 className="text-xl font-bold mb-4">Lead Recovery Utility</h2>
      <div className="text-xs text-gray-500 mb-4">
        <p>Current Workspace: {workspaceId}</p>
        <p>Stale Workspace: 1f947cad-a738-4e81-8ad9-6ccd99c78033</p>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={scanLocalStorage} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Scan LocalStorage</button>
        <button onClick={exportBackup} className="bg-amber-600 text-white px-4 py-2 rounded hover:bg-amber-700">Download Backup</button>
        <button onClick={migrate} disabled={leadsToMigrate.length === 0} className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50 hover:bg-green-700">Migrate to Supabase</button>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700 ml-auto">Close</button>
      </div>
      
      <div className="font-mono text-xs bg-gray-50 p-3 rounded border border-gray-200 whitespace-pre-wrap">
        <p className="font-bold mb-1">Status:</p>
        <p className="mb-2">{status}</p>
        {stats && (
            <>
                <p className="font-bold mb-1">Export Statistics:</p>
                <p>Total Records: {stats.total}</p>
                <p>Stale Workspace Records: {stats.stale}</p>
                <p>Current Workspace Records: {stats.current}</p>
                <p className="mt-1 text-green-700">{stats.status}</p>
            </>
        )}
        <p className="font-bold mt-2 mb-1">Diagnostics:</p>
        <p>{diagnostics}</p>
      </div>
    </div>
  );
};
