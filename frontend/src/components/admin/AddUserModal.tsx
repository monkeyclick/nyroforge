import React, { useState, useEffect } from 'react';
import { apiClient } from '@/services/api';
import { CognitoGroup } from '@/types/auth';

const ADMIN_GROUP = 'workstation-admin';

interface AddUserModalProps {
  onClose: () => void;
  /** Called after a user is successfully created (list should be refetched) */
  onCreated: () => void;
}

interface CreatedInfo {
  email: string;
  temporaryPassword?: string;
  warning?: string;
}

const AddUserModal: React.FC<AddUserModalProps> = ({ onClose, onCreated }) => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [availableGroups, setAvailableGroups] = useState<CognitoGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiClient.getCognitoGroups();
        if (!cancelled) {
          setAvailableGroups(
            (response.groups || []).filter(g => g.GroupName !== ADMIN_GROUP)
          );
        }
      } catch (err) {
        // Group list is a convenience — user creation still works without it
        console.error('Failed to load groups:', err);
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleGroup = (groupName: string) => {
    setSelectedGroups(prev =>
      prev.includes(groupName)
        ? prev.filter(g => g !== groupName)
        : [...prev, groupName]
    );
  };

  const handleCreate = async () => {
    setError(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!name.trim()) {
      setError('Please enter the user’s full name.');
      return;
    }
    if (temporaryPassword && temporaryPassword.length < 8) {
      setError('Temporary password must be at least 8 characters (or leave it blank to auto-generate one).');
      return;
    }

    setIsCreating(true);
    try {
      const groups = role === 'admin' ? [ADMIN_GROUP, ...selectedGroups] : selectedGroups;
      const result = await apiClient.createUser({
        email: email.trim(),
        name: name.trim(),
        temporaryPassword: temporaryPassword || undefined,
        groups,
      });

      setCreated({
        email: email.trim(),
        temporaryPassword: result.temporaryPassword || temporaryPassword || undefined,
        warning: result.message?.includes('failed') ? result.message : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    const text = created.temporaryPassword
      ? `Email: ${created.email}\nTemporary password: ${created.temporaryPassword}`
      : `Email: ${created.email}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard — please copy the credentials manually.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">
            {created ? 'User Created' : 'Add New User'}
          </h3>
          <button
            onClick={onClose}
            disabled={isCreating}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {created ? (
          /* Success view — show credentials exactly once */
          <div className="p-6 space-y-4">
            {created.warning && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800">
                {created.warning}
              </div>
            )}
            <div className="bg-green-50 border border-green-200 rounded-md p-4">
              <p className="text-sm text-green-800 font-medium mb-3">
                {created.temporaryPassword
                  ? 'Share these credentials with the user. They must set a new password on first login.'
                  : 'The user can now sign in.'}
              </p>
              <div className="bg-white border border-green-200 rounded p-3 font-mono text-sm space-y-1">
                <div><span className="text-gray-500">Email: </span>{created.email}</div>
                {created.temporaryPassword && (
                  <div><span className="text-gray-500">Temporary password: </span>{created.temporaryPassword}</div>
                )}
              </div>
              {created.temporaryPassword && (
                <p className="mt-2 text-xs text-green-700">
                  This password is shown only once — copy it before closing.
                </p>
              )}
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">{error}</div>
            )}
            <div className="flex justify-end space-x-3">
              <button
                onClick={handleCopy}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                {copied ? '✓ Copied' : 'Copy Credentials'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="user@example.com"
                  disabled={isCreating}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="John Doe"
                  disabled={isCreating}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role *
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  disabled={isCreating}
                >
                  <option value="user">User</option>
                  <option value="admin">Administrator</option>
                </select>
                {role === 'admin' && (
                  <p className="mt-1 text-xs text-gray-500">
                    Adds the user to the <span className="font-mono">{ADMIN_GROUP}</span> group
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Temporary Password
                </label>
                <input
                  type="text"
                  value={temporaryPassword}
                  onChange={(e) => setTemporaryPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                  placeholder="Leave blank to auto-generate"
                  disabled={isCreating}
                />
                <p className="mt-1 text-xs text-gray-500">
                  The user must change it on first login. Leave blank and a secure one is generated for you.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Groups
                </label>
                {loadingGroups ? (
                  <p className="text-sm text-gray-500 py-2">Loading groups…</p>
                ) : availableGroups.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">No additional groups available.</p>
                ) : (
                  <div className="space-y-1 max-h-36 overflow-y-auto border border-gray-200 rounded-md p-2">
                    {availableGroups.map((group) => (
                      <label
                        key={group.GroupName}
                        className="flex items-center space-x-2 p-1 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedGroups.includes(group.GroupName)}
                          onChange={() => toggleGroup(group.GroupName)}
                          disabled={isCreating}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-900">{group.GroupName}</span>
                        {group.Description && (
                          <span className="text-xs text-gray-500 truncate">— {group.Description}</span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={onClose}
                disabled={isCreating}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isCreating ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating…
                  </>
                ) : (
                  'Create User'
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AddUserModal;
