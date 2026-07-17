import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Workstation } from '../../types';

interface ShareWorkstationModalProps {
  workstation: Workstation;
  isOpen: boolean;
  onClose: () => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Owner-facing sharing dialog: grant or revoke other users' access to a
 * workstation by email. Backend enforces that only the owner or an admin
 * can change the assignedUsers list.
 */
const ShareWorkstationModal: React.FC<ShareWorkstationModalProps> = ({
  workstation,
  isOpen,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const [emails, setEmails] = useState<string[]>(workstation.assignedUsers || []);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.updateWorkstationOwnership(workstation.workstationId || workstation.instanceId, {
        assignedUsers: emails,
      }),
    onSuccess: () => {
      toast.success('Sharing updated');
      queryClient.invalidateQueries({ queryKey: ['workstations'] });
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update sharing');
    },
  });

  if (!isOpen) return null;

  const handleAdd = () => {
    const email = input.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      setInputError('Enter a valid email address');
      return;
    }
    if (email === workstation.userId?.toLowerCase()) {
      setInputError('The owner already has access');
      return;
    }
    if (emails.some((e) => e.toLowerCase() === email)) {
      setInputError('That user is already on the list');
      return;
    }
    setEmails([...emails, email]);
    setInput('');
    setInputError(null);
  };

  const handleRemove = (email: string) => {
    setEmails(emails.filter((e) => e !== email));
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 py-8">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={onClose} />

        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">
              Share “{workstation.friendlyName || workstation.instanceId}”
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="Close">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-4 space-y-4">
            <p className="text-sm text-gray-600">
              People you share with get full access to this workstation, including
              credentials and power controls.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Add a user by email
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={input}
                  onChange={(e) => { setInput(e.target.value); setInputError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                  placeholder="colleague@example.com"
                  className="flex-1 shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  className="px-3 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                >
                  Add
                </button>
              </div>
              {inputError && <p className="mt-1 text-xs text-red-600">{inputError}</p>}
            </div>

            <div>
              <div className="text-sm font-medium text-gray-700 mb-1">
                Shared with {emails.length === 0 ? 'nobody yet' : `${emails.length} user${emails.length > 1 ? 's' : ''}`}
              </div>
              {emails.length > 0 && (
                <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md max-h-48 overflow-y-auto">
                  {emails.map((email) => (
                    <li key={email} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-gray-900 truncate">{email}</span>
                      <button
                        onClick={() => handleRemove(email)}
                        className="ml-2 text-red-500 hover:text-red-700 text-xs font-medium"
                        title={`Remove ${email}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={saveMutation.isPending}
              className="px-4 py-2 text-sm border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save sharing'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareWorkstationModal;
