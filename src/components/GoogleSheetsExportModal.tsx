import React, { useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { LeadRecord } from '../types';
import { exportLeadsToGoogleSheet } from '../services/sheetsExport';
import { googleSignIn, getCachedAccessToken } from '../services/auth';
import { FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, ExternalLink, X, ShieldCheck } from 'lucide-react';

interface GoogleSheetsExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientName: string;
  leadsToExport: LeadRecord[];
  currentUser: FirebaseUser | null;
  onGoogleAuthSuccess: (user: FirebaseUser, token: string) => void;
}

export const GoogleSheetsExportModal: React.FC<GoogleSheetsExportModalProps> = ({
  isOpen,
  onClose,
  clientName,
  leadsToExport,
  currentUser,
  onGoogleAuthSuccess
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportStepMessage, setExportStepMessage] = useState('');
  const [exportResult, setExportResult] = useState<{
    addedCount: number;
    skippedDuplicatesCount: number;
    spreadsheetUrl: string;
    message: string;
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStartExport = async () => {
    setIsExporting(true);
    setExportError(null);
    setExportResult(null);

    try {
      // Check for OAuth Token
      let token = getCachedAccessToken();
      if (!token) {
        setExportStepMessage('Connecting Google Account via OAuth...');
        const authRes = await googleSignIn();
        if (!authRes) throw new Error('Google authentication cancelled or failed.');
        onGoogleAuthSuccess(authRes.user, authRes.accessToken);
        token = authRes.accessToken;
      }

      setExportStepMessage('Opening Google Sheets REST API connection...');
      await new Promise((r) => setTimeout(r, 400));

      setExportStepMessage('Scanning existing rows to prevent duplicate profile insertion...');
      await new Promise((r) => setTimeout(r, 400));

      setExportStepMessage('Writing lead records to Google Sheet...');
      const res = await exportLeadsToGoogleSheet(token, clientName, leadsToExport);

      setExportResult({
        addedCount: res.addedCount,
        skippedDuplicatesCount: res.skippedDuplicatesCount,
        spreadsheetUrl: res.spreadsheetUrl,
        message: res.message
      });
    } catch (err: any) {
      console.error('Export modal error:', err);
      setExportError(err.message || 'Failed to export leads to Google Sheets.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-lg w-full overflow-hidden space-y-4">
        {/* Modal Header */}
        <div className="p-5 border-b border-gray-100 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-emerald-500 text-white rounded-xl flex items-center justify-center font-bold">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold">Export to Google Sheets</h3>
              <p className="text-xs text-slate-300">Client: <span className="text-white font-semibold">{clientName}</span></p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {!exportResult && !isExporting && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl space-y-2">
                <p className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" /> Automated Duplicate Prevention Active
                </p>
                <p className="text-xs text-emerald-800">
                  Ready to export <span className="font-bold">{leadsToExport.length}</span> lead(s) for client <span className="font-bold">{clientName}</span>.
                </p>
                <p className="text-[11px] text-emerald-700">
                  Existing LinkedIn profiles in the target Google Sheet will be automatically detected and skipped to prevent duplicates.
                </p>
              </div>

              <div className="text-xs space-y-1 text-gray-600 bg-gray-50 p-3 rounded-xl border border-gray-200">
                <p className="font-bold text-gray-800">Export Column Sequence:</p>
                <p className="text-[11px] text-gray-500 font-mono">
                  Full Name | Headline | Current Job Title | Company Name | Location | LinkedIn Profile | Connections | Last Activity | Date Added | Status | Notes
                </p>
              </div>

              {exportError && (
                <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-xl font-medium">
                  {exportError}
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleStartExport}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-600/20"
                >
                  Export Now
                </button>
              </div>
            </div>
          )}

          {/* Exporting Progress */}
          {isExporting && (
            <div className="py-8 text-center space-y-3">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
              <h4 className="text-sm font-bold text-gray-900">{exportStepMessage}</h4>
              <p className="text-xs text-gray-500">Please keep this window open while writing rows...</p>
            </div>
          )}

          {/* Export Completed Result */}
          {exportResult && (
            <div className="space-y-4 text-center py-2">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>

              <div>
                <h3 className="text-base font-bold text-gray-900">{exportResult.message}</h3>
                <p className="text-xs text-gray-500 mt-1">Google Sheet updated successfully for {clientName}.</p>
              </div>

              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-semibold block">Leads Inserted</span>
                  <span className="font-bold text-emerald-600 text-base">+{exportResult.addedCount}</span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-semibold block">Duplicates Skipped</span>
                  <span className="font-bold text-amber-600 text-base">{exportResult.skippedDuplicatesCount}</span>
                </div>
              </div>

              <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3">
                <a
                  href={exportResult.spreadsheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all"
                >
                  Open Google Sheet ↗ <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto px-4 py-2.5 bg-gray-100 text-gray-700 text-xs font-bold rounded-xl hover:bg-gray-200"
                >
                  Close Window
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
