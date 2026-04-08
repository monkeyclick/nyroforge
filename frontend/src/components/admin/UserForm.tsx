import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { EnhancedUser, Role, Group, Permission } from '@/types/auth';
import { apiClient } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

interface UserFormProps {
  user?: EnhancedUser;
  onSave: () => void;
  onCancel: () => void;
}

const UserForm: React.FC<UserFormProps> = ({ user, onSave, onCancel }) => {
  const { hasPermission } = useAuthStore();
  const [formData, setFormData] = useState({
    email: user?.email || '',
    name: user?.name || '',
    status: user?.status || 'active' as const,
    roleIds: user?.roleIds || [],
    groupIds: user?.groupIds || [],
    directPermissions: user?.directPermissions || [],
  });

  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [availableGroups, setAvailableGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // All available permissions
  const allPermissions: Permission[] = [
    'workstations:read',
    'workstations:write',
    'workstations:delete',
    'workstations:manage-all',
    'users:read',
    'users:write',
    'users:delete',
    'groups:read',
    'groups:write',
    'groups:delete',
    'roles:read',
    'roles:write',
    'roles:delete',
    'analytics:read',
    'settings:read',
    'settings:write',
    'admin:full-access',
  ];

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [rolesRes, groupsRes] = await Promise.all([
          apiClient.getRoles(),
          apiClient.getGroups(),
        ]);
        setAvailableRoles(rolesRes.roles);
        setAvailableGroups(groupsRes.groups);
      } catch (err) {
        console.error('Error fetching roles and groups:', err);
        // Don't show error, just use empty arrays
        setAvailableRoles([]);
        setAvailableGroups([]);
      }
    };

    fetchData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Check API configuration first
    const configCheck = apiClient.checkConfiguration();
    if (!configCheck.isValid) {
      setError(configCheck.message);
      setLoading(false);
      return;
    }

    // Validate form data
    if (!formData.email || !formData.email.includes('@')) {
      setError('Please enter a valid email address');
      setLoading(false);
      return;
    }

    if (!formData.name || formData.name.trim().length < 2) {
      setError('Please enter a valid name (at least 2 characters)');
      setLoading(false);
      return;
    }

    try {
      if (user) {
        // Update existing user
        console.log('Updating user:', user.id, formData);
        // Only send valid status values to the API
        const validStatus = (formData.status === 'pending' || formData.status === 'deleted')
          ? undefined
          : formData.status as 'active' | 'suspended';
        await apiClient.updateUser(user.id, {
          name: formData.name,
          status: validStatus,
          roleIds: formData.roleIds,
          groupIds: formData.groupIds,
        });
      } else {
        // Create new user
        console.log('Creating user:', formData);
        await apiClient.createUser({
          email: formData.email,
          name: formData.name,
          roleIds: formData.roleIds,
          groupIds: formData.groupIds,
        });
      }
      onSave();
    } catch (err: any) {
      console.error('Error saving user:', err);
      let errorMessage = err.message || 'Failed to save user';
      
      // Provide more helpful error messages
      if (errorMessage.includes('XML') || errorMessage.includes('HTML')) {
        errorMessage = 'API configuration error: The server returned an invalid response. Please check that NEXT_PUBLIC_API_ENDPOINT is set to your API Gateway URL in the environment configuration.';
      } else if (errorMessage.includes('Network error')) {
        errorMessage = 'Network error: Could not connect to the server. Please check your internet connection and API endpoint configuration.';
      } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        errorMessage = 'Authentication error: Please try logging out and logging back in.';
      } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        errorMessage = 'Permission denied: You do not have permission to perform this action.';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleToggle = (roleId: string) => {
    setFormData(prev => ({
      ...prev,
      roleIds: prev.roleIds.includes(roleId)
        ? prev.roleIds.filter(id => id !== roleId)
        : [...prev.roleIds, roleId]
    }));
  };

  const handleGroupToggle = (groupId: string) => {
    setFormData(prev => ({
      ...prev,
      groupIds: prev.groupIds.includes(groupId)
        ? prev.groupIds.filter(id => id !== groupId)
        : [...prev.groupIds, groupId]
    }));
  };

  const handlePermissionToggle = (permission: Permission) => {
    setFormData(prev => ({
      ...prev,
      directPermissions: prev.directPermissions.includes(permission)
        ? prev.directPermissions.filter(p => p !== permission)
        : [...prev.directPermissions, permission]
    }));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            {user ? 'Edit User' : 'Create User'}
          </h2>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-500"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email *
              </label>
              <input
                type="email"
                required
                disabled={!!user} // Can't change email for existing users
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="pending">Pending</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Full Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter full name"
              />
            </div>
          </div>

          {/* Roles */}
          {availableRoles.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Roles
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-32 overflow-y-auto border border-gray-200 rounded-md p-3">
                {availableRoles.map((role) => (
                  <label key={role.id} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.roleIds.includes(role.id)}
                      onChange={() => handleRoleToggle(role.id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">
                      {role.name}
                      {role.isSystem && (
                        <span className="ml-1 text-xs text-blue-600">(System)</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Groups */}
          {availableGroups.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Groups
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-32 overflow-y-auto border border-gray-200 rounded-md p-3">
                {availableGroups.map((group) => (
                  <label key={group.id} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.groupIds.includes(group.id)}
                      onChange={() => handleGroupToggle(group.id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{group.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Direct Permissions */}
          {hasPermission('admin:full-access') && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Direct Permissions
                <span className="text-xs text-gray-500 ml-2">
                  (Advanced: Grant permissions directly without roles/groups)
                </span>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded-md p-3">
                {allPermissions.map((permission) => (
                  <label key={permission} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.directPermissions.includes(permission)}
                      onChange={() => handlePermissionToggle(permission)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-700">{permission}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex justify-end space-x-4 pt-6 border-t">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : user ? 'Update User' : 'Create User'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

export default UserForm;