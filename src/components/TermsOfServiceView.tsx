import React from 'react';
import { FileText, ArrowLeft, ShieldAlert, Mail, CheckCircle2, AlertTriangle, Scale, Lock } from 'lucide-react';

interface TermsOfServiceViewProps {
  onNavigateHome?: () => void;
  onNavigateTo?: (path: string) => void;
}

export const TermsOfServiceView: React.FC<TermsOfServiceViewProps> = ({ onNavigateHome, onNavigateTo }) => {
  const handleHomeClick = () => {
    if (onNavigateHome) {
      onNavigateHome();
    } else {
      window.location.href = '/';
    }
  };

  const handleNavTo = (path: string) => {
    if (onNavigateTo) {
      onNavigateTo(path);
    } else {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new Event('popstate'));
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
              <span className="text-slate-500 text-xs block">Terms of Service</span>
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
            <Scale className="w-4 h-4 text-blue-400" />
            <span>Official Terms Agreement</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Terms of Service
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-2xl">
            Please read these Terms of Service carefully before accessing or using <strong className="text-slate-200">LinkedIn Lead Finder</strong> located at <code className="text-blue-300 bg-slate-900/60 px-1.5 py-0.5 rounded text-xs">https://linked-in-tool-beta.vercel.app</code>.
          </p>
          <div className="pt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500 font-medium border-t border-slate-700/60">
            <span>Application: <strong>LinkedIn Lead Finder</strong></span>
            <span>·</span>
            <span>Effective Date: <strong>October 25, 2026</strong></span>
            <span>·</span>
            <span>Last Updated: <strong>October 25, 2026</strong></span>
          </div>
        </div>

        {/* Quick Jump Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <a href="#acceptance" className="p-4 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 rounded-xl transition-all block">
            <CheckCircle2 className="w-4 h-4 text-blue-400 mb-2" />
            <div className="text-xs font-bold text-white mb-0.5">1. Acceptance & Use</div>
            <div className="text-[11px] text-slate-400">Account responsibilities & terms.</div>
          </a>
          <a href="#acceptable-use" className="p-4 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 rounded-xl transition-all block">
            <ShieldAlert className="w-4 h-4 text-amber-400 mb-2" />
            <div className="text-xs font-bold text-white mb-0.5">2. Anti-Spam & Rules</div>
            <div className="text-[11px] text-slate-400">Scraper prohibitions & regulations.</div>
          </a>
          <a href="#liability" className="p-4 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 rounded-xl transition-all block">
            <AlertTriangle className="w-4 h-4 text-rose-400 mb-2" />
            <div className="text-xs font-bold text-white mb-0.5">3. Disclaimers</div>
            <div className="text-[11px] text-slate-400">Limitation of liability & warranties.</div>
          </a>
        </div>

        {/* Terms Body Sections */}
        <div className="space-y-8 text-sm text-slate-300 leading-relaxed bg-slate-800/40 border border-slate-800 rounded-2xl p-6 sm:p-10">
          
          {/* Section 1 */}
          <section id="acceptance" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>1. Acceptance of Terms</span>
            </h2>
            <p>
              By signing in, accessing, or using LinkedIn Lead Finder ("the Application"), you agree to be legally bound by these Terms of Service and our Privacy Policy. If you do not agree to these terms, you must not access or use the Application.
            </p>
          </section>

          {/* Section 2 */}
          <section id="description" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>2. Description of Application</span>
            </h2>
            <p>
              LinkedIn Lead Finder provides automated B2B lead discovery tools, public executive mapping, target agency client list management, and direct export integrations to Google Sheets. The Application queries open public databases (including Wikidata SPARQL endpoints) and authorized APIs to help businesses find public professional contacts for legitimate business development purposes.
            </p>
          </section>

          {/* Section 3 */}
          <section id="user-accounts" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>3. User Accounts & Workspace Security</span>
            </h2>
            <p>
              You are responsible for maintaining the confidentiality of your Google sign-in credentials and for all activities that occur under your workspace session. You agree to:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-400">
              <li>Use the Application solely for lawful commercial and professional lead discovery.</li>
              <li>Maintain accurate account and client information.</li>
              <li>Not attempt to gain unauthorized access to other users' isolated workspaces, agency clients, or lead lists.</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section id="acceptable-use" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>4. Acceptable Lead Discovery & Compliance with Sales Laws</span>
            </h2>
            <p>
              When utilizing lead records discovered through the Application for email outreach, calling, or sales networking, you expressly agree to comply with all applicable communication and privacy laws, including but not limited to:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-400">
              <li><strong className="text-slate-200">United States:</strong> The CAN-SPAM Act of 2003 and state privacy statutes.</li>
              <li><strong className="text-slate-200">European Union / UK:</strong> The General Data Protection Regulation (GDPR) and ePrivacy Directive requirements regarding B2B communications and opt-out processing.</li>
              <li><strong className="text-slate-200">General Compliance:</strong> Honor opt-out or "Do Not Contact" requests immediately, include valid sender physical addresses, and never send deceptive or misleading email subjects.</li>
            </ul>
          </section>

          {/* Section 5 */}
          <section id="prohibited" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>5. Prohibited Activities & System Abuse</span>
            </h2>
            <p>You agree not to engage in any of the following prohibited conduct:</p>
            <div className="space-y-2 text-xs text-slate-400">
              <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
                <strong className="text-rose-300">Scraping & System Abuse:</strong> Reverse-engineering, decompiling, or executing automated denial-of-service or flooding attacks against the Application's API or upstream SPARQL services.
              </div>
              <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
                <strong className="text-rose-300">Cross-Tenant Tampering:</strong> Attempting to bypass multi-tenant security filters or exploit database endpoints to inspect another user's leads or clients.
              </div>
              <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
                <strong className="text-rose-300">Unsolicited Mass Spamming:</strong> Using exported lead lists to execute unlawful mass email campaigns or harass contacts.
              </div>
            </div>
          </section>

          {/* Section 6 */}
          <section id="integrations" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>6. Google Sheets & Third-Party Integrations</span>
            </h2>
            <p>
              LinkedIn Lead Finder offers optional integration with Google Sheets via official OAuth 2.0 flows. By using the Google Sheets export feature, you agree to Google's Terms of Service and Privacy Policy. The Application connects to Google APIs strictly to create export spreadsheets or append exported lead rows as authorized by you.
            </p>
          </section>

          {/* Section 7 */}
          <section id="availability" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>7. Service Availability & Modifications</span>
            </h2>
            <p>
              The Application is provided on an "AS IS" and "AS AVAILABLE" basis. We reserve the right to modify, update, suspend, or discontinue any feature, lead provider endpoint, or access to the Application at any time without prior notice or liability.
            </p>
          </section>

          {/* Section 8 */}
          <section id="liability" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>8. Limitation of Liability & Disclaimer of Warranties</span>
            </h2>
            <p className="text-xs text-slate-300">
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-400">
              <li>LINKEDIN LEAD FINDER AND ITS OPERATORS DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND ACCURACY OF PUBLIC LEAD DATA.</li>
              <li>WE DO NOT GUARANTEE THAT LEAD SEARCHES WILL BE ERROR-FREE, UNINTERRUPTED, OR ABSOLUTELY UP TO DATE, AS DATA DEPENDS ON PUBLIC THIRD-PARTY REPOSITORIES.</li>
              <li>IN NO EVENT SHALL LINKEDIN LEAD FINDER OR ITS OPERATORS BE LIABLE FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL, OR SPECIAL DAMAGES ARISING OUT OF YOUR USE OF THE APPLICATION OR DISCOVERED LEADS.</li>
              <li>OUR TOTAL AGGREGATE LIABILITY SHALL NOT EXCEED $100 USD OR THE TOTAL AMOUNT PAID BY YOU TO US IN THE PAST 12 MONTHS.</li>
            </ul>
          </section>

          {/* Section 9 */}
          <section id="termination" className="space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700/80 pb-2">
              <span>9. Suspension & Termination</span>
            </h2>
            <p>
              We reserve the right to suspend or terminate your access to the Application immediately, without notice, if we reasonably believe you have violated these Terms of Service, engaged in system abuse, or engaged in unlawful email spamming.
            </p>
          </section>

          {/* Section 10 */}
          <section id="contact" className="space-y-3 pt-4 border-t border-slate-700/80">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-400" />
              <span>10. Contact Information</span>
            </h2>
            <p>
              For questions regarding these Terms of Service or legal inquiries, please contact:
            </p>
            <div className="p-4 bg-slate-900/80 rounded-xl border border-slate-800 space-y-1 text-xs">
              <div><strong>Application:</strong> LinkedIn Lead Finder</div>
              <div><strong>Contact Email:</strong> <a href="mailto:sohamkharat481@gmail.com" className="text-blue-400 font-semibold underline">sohamkharat481@gmail.com</a></div>
              <div><strong>Production Terms URL:</strong> <a href="https://linked-in-tool-beta.vercel.app/terms" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">https://linked-in-tool-beta.vercel.app/terms</a></div>
            </div>
          </section>

        </div>

        {/* Footer */}
        <footer className="pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 pb-12">
          <div>
            © 2026 LinkedIn Lead Finder. All rights reserved.
          </div>
          <div className="flex items-center gap-4">
            <a href="/privacy" onClick={(e) => { e.preventDefault(); handleNavTo('/privacy'); }} className="text-slate-400 hover:text-white transition-colors">Privacy Policy</a>
            <span>·</span>
            <a href="/terms" onClick={(e) => { e.preventDefault(); handleNavTo('/terms'); }} className="text-blue-400 font-semibold hover:underline">Terms of Service</a>
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
