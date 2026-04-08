import React, { useState, useEffect } from 'react';
import { apiClient } from '@/services/api';

interface User {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  roleIds?: string[];
  status?: string;
}

interface CognitoGroup {
  GroupName: string;
  Description?: string;
}

interface EnhancedUserEditModalProps {
  user: User;
  onClose: () => void;
  onSave: () => void;
}

const EnhancedUserEditModal: React.FC<EnhancedUserEditModalProps> = ({ user, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    role: user.roleIds?.includes('admin') ? 'admin' : 'user',
  });
  
  const [allGroups, setAllGroups] = useState<CognitoGroup[]>([]);
  const [userGroups, setUserGroups] = useState<string[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [settingPassword, setSettingPassword] = useState(false);

  useEffect(() => {
    loadUserGroups();
  }, []);

  const loadUserGroups = async () => {
    try {
      setLoadingGroups(true);
      
      // Load all available Cognito groups
      const groupsResponse = await apiClient.get<{ groups: CognitoGroup[] }>('/admin/cognito-groups');
      setAllGroups(groupsResponse.groups);
      
      // Load user's current groups
      const userGroupsResponse = await apiClient.get<{ groups: CognitoGroup[] }>(`admin/cognito-users/${user.email}/groups`);
      setUserGroups(userGroupsResponse.groups.map(g => g.GroupName));
    } catch (err: any) {
      console.error('Error loading groups:', err);
    } finally {
      setLoadingGroups(false);
    }
  };

  const handleGroupToggle = (groupName: string) => {
    setUserGroups(prev => 
      prev.includes(groupName) 
        ? prev.filter(g => g !== groupName)
        : [...prev, groupName]
    );
  };

  const handleResetPassword = async () => {
    if (!newPassword || !confirmPassword) {
      console.error('Validation failed: Please enter and confirm the new password');
      return;
    }

    if (newPassword !== confirmPassword) {
      console.error('Validation failed: Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      console.error('Validation failed: Password must be at least 8 characters long');
      return;
    }

    // TODO: Replace native confirm() with custom ConfirmationDialog component
    if (!confirm(`Are you sure you want to reset the password for "${user.email}"? This action cannot be undone.`)) {
      return;
    }

    setSettingPassword(true);
    try {
      await apiClient.post(`admin/cognito-users/${user.email}/reset-password`, {
        password: newPassword,
        permanent: true
      });
      
      console.log('Password reset successfully for:', user.email);
      setShowPasswordSection(false);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error('Failed to reset password:', err);
    } finally {
      setSettingPassword(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      console.error('Validation failed: Name is required');
      return;
    }

    if (!formData.email.trim()) {
      console.error('Validation failed: Email is required');
      return;
    }

    setSaving(true);
    try {
      // Update user basic info in DynamoDB
      await apiClient.updateUser(user.id, {
        name: formData.name,
        phone: formData.phone || undefined,
        roleIds: formData.role === 'admin' ? ['admin'] : ['user'],
      });

      // Get current groups to determine what changed
      const currentUserGroups = await apiClient.get<{ groups: CognitoGroup[] }>(`admin/cognito-users/${user.email}/groups`);
      const currentGroupNames = currentUserGroups.groups.map(g => g.GroupName);

      // Add to new groups
      for (const groupName of userGroups) {
        if (!currentGroupNames.includes(groupName)) {
          try {
            await apiClient.post(`admin/cognito-users/${user.email}/groups`, { groupName });
          } catch (err) {
            console.error(`Error adding to group ${groupName}:`, err);
          }
        }
      }

      // Remove from old groups
      for (const groupName of currentGroupNames) {
        if (!userGroups.includes(groupName)) {
          try {
            await apiClient.delete(`admin/cognito-users/${user.email}/groups/${groupName}`);
          } catch (err) {
            console.error(`Error removing from group ${groupName}:`, err);
          }
        }
      }

      console.log('User updated successfully:', user.email);
      onSave();
      onClose();
    } catch (err: any) {
      console.error('Failed to update user:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 my-8">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">Edit User</h3>
          <button
            onClick={onClose}
            disabled={saving || settingPassword}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[calc(100vh-200px)] overflow-y-auto">
          {/* Basic Information */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-3">Basic Information</h4>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="John Doe"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address * (Username)
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                  disabled={true}
                  title="Email cannot be changed"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Email/username cannot be changed in Cognito
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="+1 (555) 123-4567"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role *
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={saving}
                >
                  <option value="user">User</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
            </div>
          </div>

          {/* Password Section */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-900">Password Management</h4>
              <button
                onClick={() => setShowPasswordSection(!showPasswordSection)}
                className="text-sm text-blue-600 hover:text-blue-700"
                disabled={saving || settingPassword}
              >
                {showPasswordSection ? 'Cancel' : 'Reset Password'}
              </button>
            </div>

            {showPasswordSection && (
              <div className="space-y-4 bg-gray-50 p-4 rounded-md">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    New Password *
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Minimum 8 characters"
                    disabled={settingPassword}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Confirm Password *
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Re-enter password"
                    disabled={settingPassword}
                  />
                </div>

                <button
                  onClick={handleResetPassword}
                  disabled={settingPassword || !newPassword || !confirmPassword}
                  className="w-full px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {settingPassword ? 'Resetting Password...' : 'Reset Password'}
                </button>
              </div>
            )}
          </div>

          {/* Groups Section */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-medium text-gray-900 mb-3">
              Cognito Groups ({userGroups.length} selected)
            </h4>

            {loadingGroups ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              </div>
            ) : allGroups.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">No groups available. Create groups first.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-md p-3">
                {allGroups.map((group) => (
                  <label
                    key={group.GroupName}
                    className="flex items-start space-x-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={userGroups.includes(group.GroupName)}
                      onChange={() => handleGroupToggle(group.GroupName)}
                      disabled={saving}
                      className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">{group.GroupName}</div>
                      {group.Description && (
                        <div className="text-xs text-gray-500">{group.Description}</div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={saving || settingPassword}
            className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || settingPassword}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {saving ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnhancedUserEditModal;