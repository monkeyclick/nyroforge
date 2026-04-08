import React, { useState, useEffect } from 'react';
import { apiClient } from '@/services/api';

interface CognitoGroup {
  GroupName: string;
  Description?: string;
  RoleArn?: string;
  Precedence?: number;
  LastModifiedDate?: string;
  CreationDate?: string;
}

const CognitoGroupsList: React.FC = () => {
  const [groups, setGroups] = useState<CognitoGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get<{ groups: CognitoGroup[] }>('/admin/cognito-groups');
      setGroups(response.groups);
    } catch (err: any) {
      setError(err.message || 'Failed to load Cognito groups');
      console.error('Error loading Cognito groups:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async (groupData: { groupName: string; description?: string; precedence?: number }) => {
    setCreating(true);
    try {
      await apiClient.post('/admin/cognito-groups', groupData);
      await loadGroups();
      setShowCreateModal(false);
    } catch (err: any) {
      alert(`Failed to create group: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteGroup = async (groupName: string) => {
    if (!confirm(`Are you sure you want to delete the group "${groupName}"? This action cannot be undone.`)) {
      return;
    }

    setDeleting(groupName);
    try {
      await apiClient.delete(`/admin/cognito-groups/${groupName}`);
      await loadGroups();
    } catch (err: any) {
      alert(`Failed to delete group: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <div className="text-sm text-red-800">{error}</div>
        <button
          onClick={() => loadGroups()}
          className="mt-2 text-xs text-red-600 hover:text-red-800 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">No Cognito groups found</h3>
        <p className="mt-1 text-sm text-gray-500">
          Create groups in AWS Cognito User Pool to see them here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900">AWS Cognito Groups</h3>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          + Create Group
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-blue-800">AWS Cognito User Pool Groups</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                These are native AWS Cognito groups from your User Pool. To manage these groups (create, edit, delete),
                please use the AWS Console or AWS CLI.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map((group) => (
          <div
            key={group.GroupName}
            className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow relative"
          >
            <button
              onClick={() => handleDeleteGroup(group.GroupName)}
              disabled={deleting === group.GroupName}
              className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
              title="Delete group"
            >
              {deleting === group.GroupName ? (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )}
            </button>

            <div className="flex items-center justify-between mb-2 pr-8">
              <h4 className="text-lg font-semibold text-gray-900 flex items-center">
                <svg className="h-5 w-5 text-blue-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                {group.GroupName}
              </h4>
            </div>
            {group.Precedence !== undefined && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 mb-2">
                Precedence: {group.Precedence}
              </span>
            )}
            
            {group.Description && (
              <p className="text-sm text-gray-600 mb-3">{group.Description}</p>
            )}
            
            <div className="space-y-1 text-xs text-gray-500">
              {group.CreationDate && (
                <div className="flex items-center">
                  <span className="font-medium mr-1">Created:</span>
                  {new Date(group.CreationDate).toLocaleDateString()}
                </div>
              )}
              {group.RoleArn && (
                <div className="flex items-start">
                  <span className="font-medium mr-1">IAM Role:</span>
                  <span className="break-all font-mono text-xs">{group.RoleArn.split('/').pop()}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-sm text-gray-500 border-t border-gray-200 pt-4">
        <p className="flex items-center">
          <svg className="h-4 w-4 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Total: {groups.length} Cognito group{groups.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Create Group Modal */}
      {showCreateModal && (
        <CreateGroupModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateGroup}
          isCreating={creating}
        />
      )}
    </div>
  );
};

interface CreateGroupModalProps {
  onClose: () => void;
  onCreate: (data: { groupName: string; description?: string; precedence?: number }) => void;
  isCreating: boolean;
}

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ onClose, onCreate, isCreating }) => {
  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [precedence, setPrecedence] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) {
      alert('Group name is required');
      return;
    }

    onCreate({
      groupName: groupName.trim(),
      description: description.trim() || undefined,
      precedence: precedence ? parseInt(precedence) : undefined
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">Create Cognito Group</h3>
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Group Name *
            </label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., developers"
              required
              disabled={isCreating}
            />
            <p className="mt-1 text-xs text-gray-500">
              Group name must be unique within the User Pool
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Describe the purpose of this group"
              rows={3}
              disabled={isCreating}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Precedence
            </label>
            <input
              type="number"
              value={precedence}
              onChange={(e) => setPrecedence(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., 1"
              min="0"
              disabled={isCreating}
            />
            <p className="mt-1 text-xs text-gray-500">
              Lower numbers have higher priority (optional)
            </p>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {isCreating ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating...
                </>
              ) : (
                'Create Group'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CognitoGroupsList;