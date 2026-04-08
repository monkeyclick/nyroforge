import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ShieldCheckIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import { Role, Permission, CreateRoleRequest } from '@/types/auth';
import { apiClient } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

const RoleManagement: React.FC = () => {
  const { hasPermission } = useAuthStore();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

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

  const permissionCategories = {
    'Workstations': allPermissions.filter(p => p.startsWith('workstations:')),
    'Users': allPermissions.filter(p => p.startsWith('users:')),
    'Groups': allPermissions.filter(p => p.startsWith('groups:')),
    'Roles': allPermissions.filter(p => p.startsWith('roles:')),
    'Analytics': allPermissions.filter(p => p.startsWith('analytics:')),
    'Settings': allPermissions.filter(p => p.startsWith('settings:')),
    'Admin': allPermissions.filter(p => p.startsWith('admin:')),
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const loadRoles = async () => {
    try {
      setLoading(true);
      const response = await apiClient.getRoles();
      setRoles(response.roles);
    } catch (err: any) {
      setError(err.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRole = () => {
    if (!hasPermission('roles:write')) {
      setError('You do not have permission to create roles');
      return;
    }
    setShowCreateModal(true);
  };

  const handleEditRole = (role: Role) => {
    if (!hasPermission('roles:write')) {
      setError('You do not have permission to edit roles');
      return;
    }
    setEditingRole(role);
  };

  const handleDeleteRole = async (roleId: string, roleName: string) => {
    if (!hasPermission('roles:delete')) {
      setError('You do not have permission to delete roles');
      return;
    }

    // TODO: Replace native confirm() with custom ConfirmationDialog component
    if (!confirm(`Are you sure you want to delete the role "${roleName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await apiClient.deleteRole(roleId);
      await loadRoles();
    } catch (err: any) {
      setError(err.message || 'Failed to delete role');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Role Management</h3>
          <p className="text-sm text-gray-500">
            Manage roles and their permissions
          </p>
        </div>
        {hasPermission('roles:write') && (
          <button
            onClick={handleCreateRole}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Create Role
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="text-sm text-red-800">{error}</div>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-xs text-red-600 hover:text-red-800"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => (
          <motion.div
            key={role.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white overflow-hidden shadow rounded-lg border border-gray-200"
          >
            <div className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h4 className="text-lg font-medium text-gray-900 truncate flex items-center">
                    <ShieldCheckIcon className="h-5 w-5 text-blue-500 mr-2" />
                    {role.name}
                    {role.isSystem && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                        System
                      </span>
                    )}
                  </h4>
                  <p className="mt-1 text-sm text-gray-500">{role.description}</p>
                </div>
                <div className="flex items-center space-x-2 ml-4">
                  {hasPermission('roles:write') && (
                    <button
                      onClick={() => handleEditRole(role)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                  )}
                  {hasPermission('roles:delete') && !role.isSystem && (
                    <button
                      onClick={() => handleDeleteRole(role.id, role.name)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <div className="text-xs font-medium text-gray-500 mb-2">
                  PERMISSIONS ({role.permissions.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {role.permissions.slice(0, 3).map((permission) => (
                    <span
                      key={permission}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800"
                    >
                      {permission}
                    </span>
                  ))}
                  {role.permissions.length > 3 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                      +{role.permissions.length - 3} more
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-4 text-xs text-gray-500">
                Created: {new Date(role.createdAt).toLocaleDateString()}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Create/Edit Role Modal */}
      {(showCreateModal || editingRole) && (
        <RoleFormModal
          role={editingRole}
          onSave={async () => {
            await loadRoles();
            setShowCreateModal(false);
            setEditingRole(null);
          }}
          onCancel={() => {
            setShowCreateModal(false);
            setEditingRole(null);
          }}
          allPermissions={allPermissions}
          permissionCategories={permissionCategories}
        />
      )}
    </div>
  );
};

interface RoleFormModalProps {
  role?: Role | null;
  onSave: () => void;
  onCancel: () => void;
  allPermissions: Permission[];
  permissionCategories: Record<string, Permission[]>;
}

const RoleFormModal: React.FC<RoleFormModalProps> = ({
  role,
  onSave,
  onCancel,
  allPermissions,
  permissionCategories,
}) => {
  const [formData, setFormData] = useState({
    name: role?.name || '',
    description: role?.description || '',
    permissions: role?.permissions || [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (role) {
        // Update existing role
        await apiClient.updateRole(role.id, formData);
      } else {
        // Create new role
        await apiClient.createRole(formData);
      }
      onSave();
    } catch (err: any) {
      setError(err.message || 'Failed to save role');
    } finally {
      setLoading(false);
    }
  };

  const handlePermissionToggle = (permission: Permission) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter(p => p !== permission)
        : [...prev.permissions, permission]
    }));
  };

  const handleCategoryToggle = (categoryPermissions: Permission[]) => {
    const allSelected = categoryPermissions.every(p => formData.permissions.includes(p));
    
    if (allSelected) {
      // Deselect all in category
      setFormData(prev => ({
        ...prev,
        permissions: prev.permissions.filter(p => !categoryPermissions.includes(p))
      }));
    } else {
      // Select all in category
      setFormData(prev => ({
        ...prev,
        permissions: Array.from(new Set([...prev.permissions, ...categoryPermissions]))
      }));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            {role ? 'Edit Role' : 'Create Role'}
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-500">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Role Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter role name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description *
              </label>
              <input
                type="text"
                required
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter role description"
              />
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Permissions ({formData.permissions.length} selected)
            </label>
            <div className="space-y-4">
              {Object.entries(permissionCategories).map(([category, permissions]) => {
                const allSelected = permissions.every(p => formData.permissions.includes(p));
                const someSelected = permissions.some(p => formData.permissions.includes(p));
                
                return (
                  <div key={category} className="border border-gray-200 rounded-md p-4">
                    <div className="flex items-center justify-between mb-3">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(input) => {
                            if (input) input.indeterminate = someSelected && !allSelected;
                          }}
                          onChange={() => handleCategoryToggle(permissions)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-medium text-gray-900">{category}</span>
                      </label>
                      <span className="text-xs text-gray-500">
                        {permissions.filter(p => formData.permissions.includes(p)).length}/{permissions.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {permissions.map((permission) => (
                        <label key={permission} className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.permissions.includes(permission)}
                            onChange={() => handlePermissionToggle(permission)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">{permission}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

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
              {loading ? 'Saving...' : role ? 'Update Role' : 'Create Role'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

export default RoleManagement;