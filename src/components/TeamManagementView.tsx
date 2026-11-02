import React, { useState, useEffect } from 'react';
import { Organization, TeamMember, TeamInvitation } from '../types';
import { SupabaseDataService } from '../services/supabaseDataService';
import { Users, UserPlus, Shield, Mail, Trash2, Clock, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';

interface TeamManagementViewProps {
  organization: Organization | null;
  currentUser: any;
}

export const TeamManagementView: React.FC<TeamManagementViewProps> = ({ organization, currentUser }) => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite Form State
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  useEffect(() => {
    if (organization) {
      loadTeamData();
    }
  }, [organization?.id]);

  const loadTeamData = async () => {
    if (!organization) return;
    setIsLoading(true);
    setError(null);
    try {
      const [membersData, invitationsData] = await Promise.all([
        SupabaseDataService.getTeamMembers(organization.id),
        SupabaseDataService.getTeamInvitations(organization.id)
      ]);
      setMembers(membersData);
      setInvitations(invitationsData);
    } catch (err: any) {
      setError(err.message || 'Failed to load team data.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !inviteEmail.trim()) return;

    setIsInviting(true);
    setInviteSuccess(false);
    setError(null);

    try {
      await SupabaseDataService.inviteTeamMember(organization.id, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setInviteSuccess(true);
      await loadTeamData();
      setTimeout(() => setInviteSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to send invitation.');
    } finally {
      setIsInviting(false);
    }
  };

  const handleRevokeInvitation = async (invId: string) => {
    if (!organization) return;
    try {
      await SupabaseDataService.revokeInvitation(organization.id, invId);
      await loadTeamData();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke invitation.');
    }
  };

  if (!organization) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-gray-200">
        <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900">No Organization Context</h2>
        <p className="text-sm text-gray-500 mt-2">Please ensure you are onboarded to an organization.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Team Management</h1>
          <p className="text-xs text-gray-500 mt-1">
            Manage your organization's members and pending invitations.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Invite Member Form */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2 mb-4">
              <UserPlus className="w-5 h-5 text-blue-600" /> Invite New Member
            </h2>
            
            <form onSubmit={handleSendInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    type="email"
                    required
                    placeholder="teammate@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  Assign Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                >
                  <option value="member">Member (Can search & manage leads)</option>
                  <option value="admin">Admin (Can manage team & settings)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={isInviting}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm py-3 px-6 rounded-xl transition-all shadow-md shadow-blue-600/20"
              >
                {isInviting ? 'Sending...' : 'Send Invitation'}
              </button>

              {inviteSuccess && (
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                  <CheckCircle2 className="w-4 h-4" /> Invitation sent successfully!
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-xs font-bold text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
            </form>
          </div>

          <div className="bg-slate-900 p-6 rounded-2xl text-white shadow-sm overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl" />
            <h3 className="text-sm font-bold flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-blue-400" /> Multi-Tenant Security
            </h3>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Invitations generate secure, unique tokens. Once accepted, members will have access only to this organization's workspaces and leads.
            </p>
          </div>
        </div>

        {/* Right: Members & Invitations List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Members List */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" /> Active Team Members
              </h2>
              <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                {members.length} Total
              </span>
            </div>

            {isLoading ? (
              <div className="p-12 flex justify-center">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 text-gray-500 text-[10px] font-bold uppercase tracking-widest border-b border-gray-100">
                    <tr>
                      <th className="px-6 py-3">Member</th>
                      <th className="px-6 py-3">Role</th>
                      <th className="px-6 py-3">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {members.map((member) => (
                      <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center font-bold text-slate-600 text-xs uppercase">
                              {member.email?.charAt(0) || 'U'}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-gray-900">{member.email || 'System User'}</p>
                              <p className="text-[10px] text-gray-500">{member.userId}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            member.role === 'owner' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 
                            member.role === 'admin' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                            'bg-gray-50 text-gray-700 border border-gray-200'
                          }`}>
                            <Shield className="w-3 h-3" /> {member.role}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-500 font-medium">
                          {new Date(member.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pending Invitations */}
          {invitations.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-amber-50/30">
                <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-600" /> Pending Invitations
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-500 text-[10px] font-bold uppercase tracking-widest border-b border-gray-100">
                    <tr>
                      <th className="px-6 py-3">Email</th>
                      <th className="px-6 py-3">Role</th>
                      <th className="px-6 py-3">Expires</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {invitations.map((inv) => (
                      <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 font-bold text-gray-900">{inv.email}</td>
                        <td className="px-6 py-4 capitalize">{inv.role}</td>
                        <td className="px-6 py-4 text-gray-500">
                          {new Date(inv.expiresAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleRevokeInvitation(inv.id)}
                            className="text-red-600 hover:text-red-800 p-2 hover:bg-red-50 rounded-lg transition-colors"
                            title="Revoke Invitation"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
