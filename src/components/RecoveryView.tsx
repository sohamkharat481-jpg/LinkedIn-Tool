import React, { useState, useEffect } from 'react';
import { SupabaseDataService, resolveAuthToken } from '../services/supabaseDataService';
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

  const [progress, setProgress] = useState<{current: number, total: number, failed: number, batch: number} | null>(null);
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());

  // Load progress from localStorage on mount or when leads change
  useEffect(() => {
    const saved = localStorage.getItem('llf_recovery_progress_ids');
    if (saved) {
      try {
        const ids = JSON.parse(saved);
        if (Array.isArray(ids)) {
          setProcessedIds(new Set(ids));
        }
      } catch (e) {
        console.error('Failed to parse recovery progress:', e);
      }
    }
  }, []);

  // Update localStorage when processedIds changes
  useEffect(() => {
    if (processedIds.size > 0) {
      localStorage.setItem('llf_recovery_progress_ids', JSON.stringify(Array.from(processedIds)));
    }
  }, [processedIds]);

  const clearProgress = () => {
    localStorage.removeItem('llf_recovery_progress_ids');
    setProcessedIds(new Set());
    setProgress(null);
    setStatus('Recovery progress cleared. Ready for fresh scan.');
  };

  const migrate = async () => {
    if (leadsToMigrate.length === 0) return;
    if (!backupDownloaded) {
        setStatus('Error: Local backup must be downloaded before migration.');
        return;
    }
    
    setIsMigrating(true);
    setStatus('Initializing batch migration...');
    
    // Filter out already processed leads to support resumption
    const remainingLeads = leadsToMigrate.filter(l => !processedIds.has(l.id));
    const totalToMigrate = leadsToMigrate.length;
    let successfulCount = processedIds.size;
    let failedCount = 0;
    
    if (remainingLeads.length === 0 && totalToMigrate > 0) {
      setStatus(`All ${totalToMigrate} leads have already been migrated.`);
      setIsMigrating(false);
      return;
    }

    const BATCH_SIZE = 20;
    const totalBatches = Math.ceil(remainingLeads.length / BATCH_SIZE);
    
    setProgress({
      current: successfulCount,
      total: totalToMigrate,
      failed: 0,
      batch: 1
    });

    try {
        for (let i = 0; i < remainingLeads.length; i += BATCH_SIZE) {
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const batch = remainingLeads.slice(i, i + BATCH_SIZE);
            const batchIds = batch.map(l => l.id);
            
            setStatus(`Processing Batch ${batchNum}/${totalBatches} (${batch.length} leads)...`);
            setProgress(prev => prev ? { ...prev, batch: batchNum } : null);

            try {
                let batchResult;
                if (useActiveClient && clientId) {
                    batchResult = await SupabaseDataService.saveLeadsForClient(workspaceId, clientId, batch);
                } else {
                    // Group leads by original clientId to preserve associations if needed
                    const leadsByClient = batch.reduce((acc, lead) => {
                        const cId = lead.clientId || 'unknown-client';
                        if (!acc[cId]) acc[cId] = [];
                        acc[cId].push(lead);
                        return acc;
                    }, {} as Record<string, LeadRecord[]>);

                    let subTotal = 0;
                    for (const [cId, leads] of Object.entries(leadsByClient)) {
                        const res = await SupabaseDataService.saveLeadsForClient(workspaceId, cId, leads);
                        subTotal += res.added;
                    }
                    batchResult = { added: subTotal, persistenceMessage: 'Batch partial groups completed' };
                }

                // Update processed state for resumption
                batchIds.forEach(id => processedIds.add(id));
                setProcessedIds(new Set(processedIds));
                
                successfulCount += batch.length;
                setProgress(prev => prev ? { ...prev, current: successfulCount } : null);
                
            } catch (batchErr: any) {
                console.error(`Batch ${batchNum} failed:`, batchErr);
                failedCount += batch.length;
                setProgress(prev => prev ? { ...prev, failed: failedCount } : null);
                
                const proceed = confirm(`Batch ${batchNum} failed: ${batchErr.message}. \n\nSuccessfully migrated so far: ${successfulCount}/${totalToMigrate}. \n\nDo you want to continue with the next batch?`);
                if (!proceed) {
                    setStatus(`Migration paused at batch ${batchNum}. ${successfulCount} leads migrated, ${failedCount} failed in current session.`);
                    setIsMigrating(false);
                    return;
                }
            }
        }
        
        const finalMsg = failedCount > 0 
          ? `Migration completed with issues. ${successfulCount} leads verified in cloud, ${failedCount} leads failed.`
          : `Migration successful: All ${totalToMigrate} leads verified in cloud database.`;
          
        setStatus('Verifying final database state...');
        
        // Perform a final audit call to get the authoritative count
        try {
            const token = await resolveAuthToken();
            const auditRes = await fetch(`/api/production-audit?workspaceId=${workspaceId}&clientId=${clientId}`, {
                headers: { 'Authorization': `Bearer ${token || ''}` }
            });
            const auditData = await auditRes.json();
            if (auditData.clientAssocCount !== undefined) {
                setStatus(`${finalMsg} Authoritative database count: ${auditData.clientAssocCount} leads.`);
            } else {
                setStatus(finalMsg);
            }
        } catch (auditErr) {
            console.warn('Final audit failed:', auditErr);
            setStatus(finalMsg);
        }
        
        if (failedCount === 0) {
          localStorage.removeItem('llf_recovery_progress_ids');
          setProcessedIds(new Set());
          setLeadsToMigrate([]); 
          setStats(null);
          setProgress(null);
        }

        alert('Migration Complete!\n\n' + finalMsg + '\n\nPlease refresh your browser to see the restored leads.');
    } catch (e: any) {
        setStatus(`Migration encountered a fatal error: ${e.message}`);
        console.error('Migration error:', e);
        alert('Migration Failed: ' + e.message);
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
            <div className={`mt-0.5 p-1 rounded-full ${status.includes('Error') || status.includes('failed') || status.includes('fatal') ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
              <AlertCircle className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-tighter">Current Status</p>
              <p className="text-sm font-medium text-slate-800 mt-1">{status}</p>
            </div>
            {processedIds.size > 0 && !isMigrating && (
              <button 
                onClick={clearProgress}
                className="text-[10px] font-bold text-red-500 hover:text-red-700 uppercase tracking-widest border border-red-200 px-2 py-1 rounded-lg"
              >
                Clear Progress
              </button>
            )}
          </div>

          {progress && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase text-slate-400">
                <span>Migration Progress</span>
                <span>{Math.round((progress.current / progress.total) * 100)}%</span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden flex">
                 <div 
                   className="h-full bg-green-500 transition-all duration-500" 
                   style={{ width: `${(progress.current / progress.total) * 100}%` }}
                 />
                 <div 
                   className="h-full bg-red-500 transition-all duration-500" 
                   style={{ width: `${(progress.failed / progress.total) * 100}%` }}
                 />
              </div>
              <div className="flex justify-between text-[10px] font-medium text-slate-500">
                 <span>Migrated: {progress.current}</span>
                 <span>Batch: {progress.batch}</span>
                 {progress.failed > 0 && <span className="text-red-500">Failed: {progress.failed}</span>}
                 <span>Total: {progress.total}</span>
              </div>
            </div>
          )}

          {stats && !progress && (
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200">
              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Found in Source</p>
                <p className="text-lg font-bold text-blue-600">{stats.sourceWs}</p>
              </div>
              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Already Scoped</p>
                <p className="text-lg font-bold text-slate-600">{stats.currentWs}</p>
                {processedIds.size > 0 && (
                  <div className="absolute top-0 right-0 bg-green-100 text-green-700 text-[8px] font-bold px-1.5 py-0.5 rounded-bl-lg">
                    {processedIds.size} Recovered
                  </div>
                )}
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
