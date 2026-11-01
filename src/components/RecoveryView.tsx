import React, { useState, useEffect } from 'react';
import { SupabaseDataService } from '../services/supabaseDataService';
import { LeadRecord, Client } from '../types';
import { Download, Search, RefreshCw, Database, AlertCircle, CheckCircle2, UserPlus } from 'lucide-react';

interface RecoveryProps {
  workspaceId: string;
  clientId: string;
  activeClient?: Client | null;
  onClose: () => void;
}

export const RecoveryView: React.FC<RecoveryProps> = ({ workspaceId, clientId, activeClient, onClose }) => {
  const [status, setStatus] = useState<string>('Ready to scan');
  const [leadsToMigrate, setLeadsToMigrate] = useState<LeadRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<string>('');
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState<string>('1f947cad-a738-4e81-8ad9-6ccd99c78033');
  const [isScanning, setIsScanning] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [stats, setStats] = useState<{total: number, sourceWs: number, currentWs: number, otherWs: number} | null>(null);
  const [useActiveClient, setUseActiveClient] = useState(true);

  const scanLocalStorage = () => {
    setIsScanning(true);
    setStatus('Scanning LocalStorage...');
    setDiagnostics('');
    
    // Brief delay to show loading state
    setTimeout(() => {
      try {
        const leadsJson = localStorage.getItem('llf_leads_v1');
        
        if (!leadsJson) {
          setStatus('No legacy leads found in LocalStorage (llf_leads_v1 missing).');
          setIsScanning(false);
          return;
        }

        const allLeads: any[] = JSON.parse(leadsJson);
        
        if (!Array.isArray(allLeads)) {
          setStatus('Error: Invalid data format in LocalStorage.');
          setIsScanning(false);
          return;
        }

        const sourceWsLeads = allLeads.filter(l => l.workspaceId === sourceWorkspaceId);
        const currentWsLeads = allLeads.filter(l => l.workspaceId === workspaceId);
        const otherWsLeads = allLeads.filter(l => l.workspaceId !== sourceWorkspaceId && l.workspaceId !== workspaceId);

        setStats({
          total: allLeads.length,
          sourceWs: sourceWsLeads.length,
          currentWs: currentWsLeads.length,
          otherWs: otherWsLeads.length
        });

        const relevantLeads = sourceWsLeads.map(l => ({
          ...l
        })) as LeadRecord[];

        setLeadsToMigrate(relevantLeads);
        setStatus(`Scan complete. Found ${sourceWsLeads.length} leads in source workspace.`);
        
        // Count unique client IDs in source leads
        const clientIds = new Set(sourceWsLeads.map(l => l.clientId).filter(Boolean));
        setDiagnostics(`Total: ${allLeads.length} | Source WS: ${sourceWsLeads.length} | Unique Client IDs: ${clientIds.size}`);
      } catch (e: any) {
        setStatus(`Scan error: ${e.message}`);
        console.error('Recovery scan error:', e);
      } finally {
        setIsScanning(false);
      }
    }, 500);
  };

  const [backupDownloaded, setBackupDownloaded] = useState(false);

  const migrate = async () => {
    if (leadsToMigrate.length === 0) return;
    if (!backupDownloaded) {
        setStatus('Error: Local backup must be downloaded before migration.');
        return;
    }
    
    setIsMigrating(true);
    setStatus('Migrating to Supabase...');
    
    try {
        let totalAdded = 0;
        
        if (useActiveClient && clientId) {
            // Map ALL found leads to the currently active client
            setStatus(`Mapping ${leadsToMigrate.length} leads to client ${activeClient?.name || clientId}...`);
            const result = await SupabaseDataService.saveLeadsForClient(workspaceId, clientId, leadsToMigrate);
            totalAdded = result.added;
        } else {
            // Group leads by original clientId to preserve associations
            const leadsByClient = leadsToMigrate.reduce((acc, lead) => {
                const cId = lead.clientId || 'unknown-client';
                if (!acc[cId]) acc[cId] = [];
                acc[cId].push(lead);
                return acc;
            }, {} as Record<string, LeadRecord[]>);

            for (const [cId, leads] of Object.entries(leadsByClient)) {
                setStatus(`Migrating group for client ${cId}...`);
                const result = await SupabaseDataService.saveLeadsForClient(workspaceId, cId, leads);
                totalAdded += result.added;
            }
        }
        
        setStatus(`Migration successful: ${totalAdded} leads restored to workspace ${workspaceId}.`);
        setLeadsToMigrate([]); 
        setStats(null);
    } catch (e: any) {
        setStatus(`Migration failed: ${e.message}`);
        console.error('Migration error:', e);
    } finally {
        setIsMigrating(false);
    }
  };

  const exportBackup = () => {
    try {
      const leadsJson = localStorage.getItem('llf_leads_v1');
      const clientLeadsJson = localStorage.getItem('llf_client_leads_v1');
      const allLeads = leadsJson ? JSON.parse(leadsJson) : [];
      
      const backupData = {
          manifest: {
              timestamp: new Date().toISOString(),
              exportedBy: workspaceId,
              recordCount: allLeads.length
          },
          leads: allLeads,
          clientLeads: clientLeadsJson ? JSON.parse(clientLeadsJson) : []
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `llf_full_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      setBackupDownloaded(true);
      setStatus('Backup downloaded successfully. Migration is now unlocked.');
    } catch (e: any) {
      setStatus(`Backup failed: ${e.message}`);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full border border-gray-100 overflow-hidden flex flex-col">
      <div className="bg-slate-900 p-6 text-white">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-400" />
            <h2 className="text-xl font-bold">Data Recovery Utility</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
        <p className="text-slate-400 text-xs">
          Identify and migrate orphaned leads from legacy global storage to your current isolated workspace.
        </p>
      </div>

      <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
        {/* Source Configuration */}
        <div className="space-y-3">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Source Workspace ID</label>
          <div className="flex gap-2">
            <input 
              type="text" 
              value={sourceWorkspaceId}
              onChange={(e) => setSourceWorkspaceId(e.target.value)}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Enter Workspace UUID..."
            />
            <button 
              onClick={scanLocalStorage}
              disabled={isScanning}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center gap-2"
            >
              {isScanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Scan
            </button>
          </div>
        </div>

        {/* Status & Stats */}
        <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 p-1 rounded-full ${status.includes('Error') || status.includes('failed') ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
              <AlertCircle className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-tighter">Current Status</p>
              <p className="text-sm font-medium text-slate-800 mt-1">{status}</p>
            </div>
          </div>

          {stats && (
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200">
              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Found in Source</p>
                <p className="text-lg font-bold text-blue-600">{stats.sourceWs}</p>
              </div>
              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Already Scoped</p>
                <p className="text-lg font-bold text-slate-600">{stats.currentWs}</p>
              </div>
            </div>
          )}
        </div>

        {/* Target Mapping Option */}
        {leadsToMigrate.length > 0 && activeClient && (
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-600" />
                <p className="text-sm font-bold text-blue-900">Target Client Mapping</p>
              </div>
              <input 
                type="checkbox" 
                checked={useActiveClient}
                onChange={(e) => setUseActiveClient(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
            </div>
            <p className="text-xs text-blue-700 leading-relaxed">
              {useActiveClient 
                ? `All ${leadsToMigrate.length} leads will be associated with "${activeClient.name}". This is recommended if orphaned leads belong to this client.` 
                : "Preserve original client associations from localStorage. Use this only if you are certain the original client IDs exist in Supabase."}
            </p>
          </div>
        )}

        {/* Diagnostics */}
        {diagnostics && (
          <div className="space-y-2">
             <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Storage Diagnostics</label>
             <div className="bg-gray-900 text-blue-400 p-3 rounded-xl font-mono text-[10px] break-all leading-relaxed border border-gray-800">
                {diagnostics}
             </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row gap-3">
        <button 
          onClick={exportBackup}
          className="flex-1 flex items-center justify-center gap-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 px-4 py-3 rounded-2xl font-bold text-sm transition-all"
        >
          <Download className="w-4 h-4" /> Download JSON Backup
        </button>
        <button 
          onClick={migrate}
          disabled={leadsToMigrate.length === 0 || isMigrating || !backupDownloaded}
          className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-4 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-green-600/20 transition-all"
        >
          {isMigrating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Migrate {leadsToMigrate.length} Leads
        </button>
      </div>
      
      <div className="px-6 pb-6 bg-gray-50 flex justify-center">
        <button onClick={onClose} className="text-xs font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest transition-colors">
          Dismiss Recovery
        </button>
      </div>
    </div>
  );
};
