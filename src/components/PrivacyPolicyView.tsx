import React from 'react';
import { ShieldCheck, ArrowLeft, Mail, FileText, CheckCircle2, Lock, Database, Globe } from 'lucide-react';

interface PrivacyPolicyViewProps {
  onNavigateHome?: () => void;
}

export const PrivacyPolicyView: React.FC<PrivacyPolicyViewProps> = ({ onNavigateHome }) => {
  const handleHomeClick = () => {
    if (onNavigateHome) {
      onNavigateHome();
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-blue-500 selection:text-white flex flex-col">
      {/* Background Glow */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-slate-900 to-slate-950 pointer-events-none" />

      {/* Header Bar */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 sm:px-8 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-base shadow-md shadow-blue-500/20">
              in
            </div>
            <div>
              <a href="/" onClick={(e) => { e.preventDefault(); handleHomeClick(); }} className="text-base font-bold text-white hover:text-blue-400 transition-colors tracking-tight">
                LinkedIn Lead Finder
              </a>
              <span className="text-slate-500 text-xs block">Privacy Policy</span>
            </div>
          </div>

          <button
            onClick={handleHomeClick}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white transition-all border border-slate-700 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to App</span>
          </button>
        </div>
      </header>

      {/* Main Legal Content Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 relative z-10 space-y-8">
        
        {/* Title Banner */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-6 sm:p-8 space-y-3 shadow-xl">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-400 uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            <span>Official Legal Documentation</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-2xl">
            This Privacy Policy describes how <strong className="text-slate-200">LinkedIn Lead Finder</strong> collects, uses, stores, and protects your information when you interact with our application at <code className="text-blue-300 bg-slate-900/60 px-1.5 py-0.5 rounded text-xs">https://linked-in-tool-beta.vercel.app</code>.
          </p>
          <div className="pt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500 font-medium border-t border-slate-700/60">
            <span>Application: <strong>LinkedIn Lead Finder</strong></span>
            <span>·</span>
            <span>Effective Date: <strong>October 25, 2026</strong></span>
            <span>·</span>
            <span>Last Updated: <strong>October 25, 2026</strong></span>
          </div>
        </div>

        {/* Quick Navigation Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <a href="#info-collected" className="p-4 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 rounded-xl transition-all block">
            <Database className="w-4 h-4 text-blue-400 mb-2" />
            <div className="text-xs font-bold text-white mb-0.5">1. Data Collected</div>
            <div className="text-[11px] text-slate-400">Account profiles, sessions & lead records.</div>
          </a>
          <a href="#google-sheets" className="p-4 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 rounded-xl transition-all block">
            <Lock className="w-4 h-4 text-emerald-400 mb-2" />
            <div className="text-xs font-bold text-white mb-0.5">2. Google OAuth Use</div>
            <div className="text-[11px] text-slate-400">Google Sheets integration & permissions.</div>
          </a>
          <a href="#data-retention" className="p-4 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 rounded-xl transition-all block">
            <Globe className="w-4 h-4 text-blue-400 mb-2" />
            <div className="text-xs font-bold text-white mb-0.5">3. Rights & Deletion</div>
            <div className="text-[11px] text-slate-400">How to request data export or purge.</div>
          </a>
        </div>

        {/* Policy Body Sections */}
        <div className="space-y-8 text-sm text-slate-300 leading-relaxed bg-slate-800/40 border border-slate-800 rounded-2xl p-6 sm:p-10">
          
          {/* Section 1 */}
          <section id="purpose" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>1. Application Purpose & Services</span>
            </h2>
            <p>
              LinkedIn Lead Finder is a business-to-business (B2B) lead discovery, executive profile mapping, and agency client management application. The platform enables sales professionals, business development executives, and marketing agencies to discover publicly accessible executive profiles, verify contact parameters, manage isolated client target lists, and export leads directly to Google Sheets.
            </p>
          </section>

          {/* Section 2 */}
          <section id="info-collected" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>2. Information We Collect</span>
            </h2>
            <p>We collect only the minimum required information to provide, maintain, and secure our services:</p>
            
            <div className="space-y-3 pl-2">
              <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-1">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Google Account & Identity Information</span>
                </div>
                <p className="text-xs text-slate-400">
                  When you sign in using Google Authentication (via Firebase Auth), we collect your primary email address, display name, profile picture URL, and unique authentication identifier (UID).
                </p>
              </div>

              <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-1">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Authentication & Session Tokens</span>
                </div>
                <p className="text-xs text-slate-400">
                  To keep you signed in securely, we manage Firebase ID tokens and temporary Google OAuth tokens stored strictly in client-side browser memory or session storage.
                </p>
              </div>

              <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-1">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Workspace, Client & Lead Data</span>
                </div>
                <p className="text-xs text-slate-400">
                  We store user-created workspace names, target agency client records, saved lead profiles, status tags, notes, search history audits, and export logs in our secure cloud database (Supabase PostgreSQL).
                </p>
              </div>

              <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 space-y-1">
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Public B2B Record Mapping</span>
                </div>
                <p className="text-xs text-slate-400">
                  Lead searches query open, public knowledge bases (such as the Wikidata SPARQL Query Service) and authorized public business APIs. No personal account details or private search filters are shared with upstream public providers.
                </p>
              </div>
            </div>
          </section>

          {/* Section 3 */}
          <section id="google-sheets" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>3. Google OAuth & Sheets Integration Compliance</span>
            </h2>
            <p>
              LinkedIn Lead Finder offers direct export of discovered leads into Google Sheets. To support this functionality, the application requests access to the following OAuth scope:
            </p>
            <div className="p-3 bg-slate-900/80 border border-blue-500/30 rounded-xl font-mono text-xs text-blue-300">
              https://www.googleapis.com/auth/spreadsheets
            </div>
            
            <div className="space-y-2 text-xs text-slate-300">
              <p className="font-semibold text-white">How Google User Data Is Used:</p>
              <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
                <li><strong className="text-slate-200">Export Execution:</strong> OAuth tokens are used solely to create new Google Spreadsheets or append lead rows to an existing spreadsheet explicitly selected by you.</li>
                <li><strong className="text-slate-200">No Unrelated Access:</strong> We do NOT read, modify, or delete any unrelated Google Drive files, Google Docs, or spreadsheets outside of those generated or designated for lead exports.</li>
                <li><strong className="text-slate-200">No Sale or Advertising Use:</strong> Your Google account information and Google Sheets tokens are NEVER sold, rented, or transferred to advertisers, data brokers, or third parties.</li>
                <li><strong className="text-slate-200">No AI/ML Training:</strong> Information obtained through Google APIs is NEVER used to train generalized artificial intelligence or machine learning models.</li>
              </ul>
            </div>
          </section>

          {/* Section 4 */}
          <section id="data-storage" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>4. Data Storage, Processing & Infrastructure</span>
            </h2>
            <p>
              We implement industry-standard technical and organizational security measures to protect your data. Key service providers involved in hosting and processing application data include:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-400">
              <li><strong className="text-slate-200">Firebase (Google Cloud Platform):</strong> Managed authentication, user identity verification, and access security.</li>
              <li><strong className="text-slate-200">Supabase (PostgreSQL):</strong> Encrypted cloud database for workspace isolation, client lists, saved leads, and audit logs.</li>
              <li><strong className="text-slate-200">Vercel Inc.:</strong> Application web hosting, edge distribution, and serverless API execution.</li>
              <li><strong className="text-slate-200">Wikidata Query Service:</strong> Public SPARQL endpoint queries for non-private B2B executive lead discovery.</li>
            </ul>
          </section>

          {/* Section 5 */}
          <section id="isolation-security" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>5. Multi-Tenant Workspace Security</span>
            </h2>
            <p>
              LinkedIn Lead Finder enforces strict multi-tenant workspace isolation. Each user account or guest session operates in a strictly isolated workspace environment. Cross-tenant access to another user's workspace, agency clients, lead profiles, or search history is explicitly blocked by server-side token validation and database Row-Level Security (RLS) policies.
            </p>
          </section>

          {/* Section 6 */}
          <section id="data-retention" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>6. Data Retention, Deletion & User Rights</span>
            </h2>
            <p>
              Your data is retained for as long as your workspace account remains active. You maintain full control over your saved data:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-400">
              <li><strong className="text-slate-200">In-App Deletion:</strong> You can delete individual lead records, client profiles, or search histories at any time directly within the application interface.</li>
              <li><strong className="text-slate-200">Full Account Purge Request:</strong> You may request the permanent deletion of your account, workspace, and all associated leads by submitting a request to <a href="mailto:sohamkharat481@gmail.com" className="text-blue-400 underline">sohamkharat481@gmail.com</a>. Account purges are processed within 30 days.</li>
              <li><strong className="text-slate-200">Privacy Rights (GDPR / CCPA):</strong> Users have the right to inspect, export, rectify, or restrict processing of their personal information.</li>
            </ul>
          </section>

          {/* Section 7 */}
          <section id="children" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>7. Children's Privacy</span>
            </h2>
            <p>
              Our application is strictly designed for business professionals and is not directed to individuals under the age of 18. We do not knowingly collect personal data from children.
            </p>
          </section>

          {/* Section 8 */}
          <section id="updates" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>8. Policy Updates</span>
            </h2>
            <p>
              We may update this Privacy Policy from time to time to reflect changes in application features, legal regulations, or service providers. The updated policy will be posted on this page with an updated "Last Updated" date.
            </p>
          </section>

          {/* Section 9 */}
          <section id="contact" className="space-y-3 pt-4 border-t border-slate-700/80">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-400" />
              <span>9. Privacy Contact Information</span>
            </h2>
            <p>
              If you have any questions, privacy concerns, or data deletion requests regarding LinkedIn Lead Finder, please contact us:
            </p>
            <div className="p-4 bg-slate-900/80 rounded-xl border border-slate-800 space-y-1 text-xs">
              <div><strong>Application:</strong> LinkedIn Lead Finder</div>
              <div><strong>Contact Email:</strong> <a href="mailto:sohamkharat481@gmail.com" className="text-blue-400 font-semibold underline">sohamkharat481@gmail.com</a></div>
              <div><strong>Production URL:</strong> <a href="https://linked-in-tool-beta.vercel.app/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">https://linked-in-tool-beta.vercel.app/privacy</a></div>
            </div>
          </section>

        </div>

        {/* Footer */}
        <footer className="pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 pb-12">
          <div>
            © 2026 LinkedIn Lead Finder. All rights reserved.
          </div>
          <div className="flex items-center gap-4">
            <a href="/privacy" className="text-blue-400 font-semibold hover:underline">Privacy Policy</a>
            <span>·</span>
            <a href="/terms" className="text-slate-400 hover:text-white transition-colors">Terms of Service</a>
            <span>·</span>
            <button onClick={handleHomeClick} className="text-slate-400 hover:text-white transition-colors">
              Return to App
            </button>
          </div>
        </footer>

      </main>
    </div>
  );
};
