'use client';

import React, { useState, useEffect, useCallback } from 'react';

// --- Types ---

interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  permissions: string[];
  lastSignIn: string | null;
  createdAt: string | null;
}

interface WorkflowRun {
  id: string;
  workflow_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
}

const ROLE_LABELS: Record<string, string> = {
  vp_revops: 'VP RevOps',
  cs_manager: 'CS Manager',
  support_agent: 'Support Agent',
  account_executive: 'Account Executive',
  cmo: 'CMO',
  ceo: 'CEO',
};

const ROLE_COLORS: Record<string, string> = {
  vp_revops: 'bg-indigo-100 text-indigo-700',
  cs_manager: 'bg-blue-100 text-blue-700',
  support_agent: 'bg-emerald-100 text-emerald-700',
  account_executive: 'bg-amber-100 text-amber-700',
  cmo: 'bg-purple-100 text-purple-700',
  ceo: 'bg-rose-100 text-rose-700',
};

// --- Main Component ---

export function AdminUsersView() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add user form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addDisplayName, setAddDisplayName] = useState('');
  const [addRole, setAddRole] = useState('support_agent');
  const [addPassword, setAddPassword] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Change password
  const [changingPasswordFor, setChangingPasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // Delete confirmation
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setUsers(json.users || []);
      setWorkflowRuns(json.workflowRuns || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddUser = async () => {
    setAddError(null);
    if (!addEmail || !addPassword) {
      setAddError('Email and password are required');
      return;
    }
    if (addPassword.length < 6) {
      setAddError('Password must be at least 6 characters');
      return;
    }

    setAdding(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: addEmail,
          displayName: addDisplayName || undefined,
          role: addRole,
          password: addPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAddError(json.error || 'Failed to create user');
        return;
      }
      setUsers((prev) => [...prev, json.user]);
      setShowAddForm(false);
      setAddEmail('');
      setAddDisplayName('');
      setAddRole('support_agent');
      setAddPassword('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setAdding(false);
    }
  };

  const handleChangePassword = async (userId: string) => {
    setPasswordError(null);
    if (!newPassword || newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    setUpdatingPassword(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        const json = await res.json();
        setPasswordError(json.error || 'Failed to update password');
        return;
      }
      setChangingPasswordFor(null);
      setNewPassword('');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        alert(json.error || 'Failed to delete user');
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      setDeletingUser(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  // --- Render ---

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-4 bg-gray-200 rounded w-32" />
          <div className="space-y-2 mt-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 bg-gray-100 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-medium">Error loading admin data</p>
          <p className="text-red-600 text-sm mt-1">{error}</p>
          <button onClick={fetchData} className="mt-3 px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <p className="text-sm text-gray-500 mt-1">{users.length} users</p>
      </div>

      {/* Add User */}
      <div>
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            + Add User
          </button>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">New User</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder="Email address"
                className="px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
              />
              <input
                type="text"
                value={addDisplayName}
                onChange={(e) => setAddDisplayName(e.target.value)}
                placeholder="Display name (optional)"
                className="px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
              />
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
              >
                <option value="support_agent">Support Agent</option>
                <option value="cs_manager">CS Manager</option>
                <option value="account_executive">Account Executive</option>
                <option value="cmo">CMO</option>
                <option value="ceo">CEO</option>
                <option value="vp_revops">VP RevOps</option>
              </select>
              <input
                type="password"
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
                placeholder="Password (min 6 chars)"
                className="px-3 py-2 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
              />
            </div>
            {addError && <p className="text-red-600 text-xs">{addError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleAddUser}
                disabled={adding}
                className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {adding ? 'Creating...' : 'Create User'}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setAddError(null); }}
                className="px-4 py-2 text-gray-600 text-sm hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Permissions</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Last Sign In</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map((user) => (
              <React.Fragment key={user.id}>
                <tr className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                    {user.displayName || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {user.email}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABELS[user.role] || user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.role === 'vp_revops' ? (
                      <span className="text-xs text-gray-400 italic">Full access</span>
                    ) : user.permissions.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {user.permissions.map((p) => (
                          <span key={p} className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-[10px] text-gray-600">
                            {p}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {user.lastSignIn ? formatRelative(user.lastSignIn) : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => {
                          setChangingPasswordFor(changingPasswordFor === user.id ? null : user.id);
                          setNewPassword('');
                          setPasswordError(null);
                        }}
                        className="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                        title="Change password"
                      >
                        Password
                      </button>
                      <button
                        onClick={() => setDeletingUser(deletingUser === user.id ? null : user.id)}
                        className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete user"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Change password inline form */}
                {changingPasswordFor === user.id && (
                  <tr>
                    <td colSpan={6} className="px-4 py-3 bg-indigo-50 border-t border-indigo-100">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-600">New password for {user.email}:</span>
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Min 6 characters"
                          className="px-3 py-1.5 border border-gray-300 rounded text-xs w-48 focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                          onKeyDown={(e) => { if (e.key === 'Enter') handleChangePassword(user.id); }}
                        />
                        <button
                          onClick={() => handleChangePassword(user.id)}
                          disabled={updatingPassword}
                          className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {updatingPassword ? 'Updating...' : 'Update'}
                        </button>
                        <button
                          onClick={() => { setChangingPasswordFor(null); setPasswordError(null); }}
                          className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                        {passwordError && <span className="text-xs text-red-600">{passwordError}</span>}
                      </div>
                    </td>
                  </tr>
                )}

                {/* Delete confirmation */}
                {deletingUser === user.id && (
                  <tr>
                    <td colSpan={6} className="px-4 py-3 bg-red-50 border-t border-red-100">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-red-700 font-medium">
                          Delete {user.displayName || user.email}? This cannot be undone.
                        </span>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700"
                        >
                          Yes, Delete
                        </button>
                        <button
                          onClick={() => setDeletingUser(null)}
                          className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Workflow Runs / Activity Log */}
      {workflowRuns.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent System Activity</h2>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Job</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Started</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {workflowRuns.map((run) => {
                  const duration = run.completed_at && run.started_at
                    ? Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)
                    : null;

                  return (
                    <tr key={run.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 text-xs text-gray-900 font-medium">
                        {run.workflow_name}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                          run.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
                          run.status === 'failed' ? 'bg-red-100 text-red-700' :
                          run.status === 'running' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {formatRelative(run.started_at)}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {duration !== null ? `${duration}s` : '-'}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500 max-w-xs truncate">
                        {run.error_message || formatMetadata(run.metadata) || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Helpers ---

function formatMetadata(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  // Format analyze-support results
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = metadata.results as any;
  if (results?.trainer && results?.manager) {
    const parts: string[] = [];
    if (results.trainer.total > 0) {
      parts.push(`Trainer: ${results.trainer.success}/${results.trainer.total}`);
    }
    if (results.manager.total > 0) {
      parts.push(`Manager: ${results.manager.success}/${results.manager.total}`);
    }
    if (parts.length > 0) return parts.join(', ');
  }
  // Generic: show mode if present
  if (metadata.mode) return `mode: ${metadata.mode}`;
  return null;
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
