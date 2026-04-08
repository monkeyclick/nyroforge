import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon,
  UserGroupIcon,
  XMarkIcon,
  TagIcon,
  CubeIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import { Group, Role, Permission, CreateGroupRequest } from '@/types/auth';
import { GroupPackageBinding, AddPackageToGroupRequest } from '@/types';
import { apiClient } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

type TabType = 'members' | 'packages';

const GroupManagement: React.FC = () => {
  const { hasPermission } = useAuthStore();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('members');

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      setLoading(true);
      const response = await apiClient.getGroups();
      setGroups(response.groups);
    } catch (err: any) {
      setError(err.message || 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = () => {
    if (!hasPermission('groups:write')) {
      setError('You do not have permission to create groups');
      return;
    }
    setShowCreateModal(true);
  };

  const handleEditGroup = (group: Group) => {
    if (!hasPermission('groups:write')) {
      setError('You do not have permission to edit groups');
      return;
    }
    setEditingGroup(group);
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    if (!hasPermission('groups:delete')) {
      setError('You do not have permission to delete groups');
      return;
    }

    // TODO: Replace native confirm() with custom ConfirmationDialog component
    if (!confirm(`Are you sure you want to delete the group "${groupName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await apiClient.deleteGroup(groupId);
      if (selectedGroup?.id === groupId) {
        setSelectedGroup(null);
      }
      await loadGroups();
    } catch (err: any) {
      setError(err.message || 'Failed to delete group');
    }
  };

  const handleViewPackages = (group: Group) => {
    setSelectedGroup(group);
    setActiveTab('packages');
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
          <h3 className="text-lg font-medium text-gray-900">Group Management</h3>
          <p className="text-sm text-gray-500">
            Manage user groups, role assignments, and software packages
          </p>
        </div>
        {hasPermission('groups:write') && (
          <button
            onClick={handleCreateGroup}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Create Group
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

      {/* Tabs */}
      {selectedGroup && (
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('members')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'members'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <UserGroupIcon className="inline-block h-5 w-5 mr-2" />
              Members & Settings
            </button>
            <button
              onClick={() => setActiveTab('packages')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'packages'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <CubeIcon className="inline-block h-5 w-5 mr-2" />
              Software Packages
            </button>
          </nav>
        </div>
      )}

      {/* Content based on tab */}
      {!selectedGroup || activeTab === 'members' ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <motion.div
              key={group.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-white overflow-hidden shadow rounded-lg border-2 cursor-pointer transition-all ${
                selectedGroup?.id === group.id
                  ? 'border-blue-500 shadow-lg'
                  : 'border-gray-200 hover:border-blue-300'
              }`}
              onClick={() => {
                setSelectedGroup(group);
                setActiveTab('members');
              }}
            >
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-lg font-medium text-gray-900 truncate flex items-center">
                      <UserGroupIcon className="h-5 w-5 text-green-500 mr-2" />
                      {group.name}
                      {group.isDefault && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          Default
                        </span>
                      )}
                    </h4>
                    <p className="mt-1 text-sm text-gray-500">{group.description}</p>
                  </div>
                  <div className="flex items-center space-x-2 ml-4">
                    {hasPermission('groups:write') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditGroup(group);
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                    )}
                    {hasPermission('groups:delete') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteGroup(group.id, group.name);
                        }}
                        className="text-gray-400 hover:text-red-600"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-xs font-medium text-gray-500 mb-2">
                    ROLES ({group.roleIds.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {group.roleIds.slice(0, 2).map((roleId) => (
                      <span
                        key={roleId}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                      >
                        {roleId}
                      </span>
                    ))}
                    {group.roleIds.length > 2 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                        +{group.roleIds.length - 2} more
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-xs font-medium text-gray-500 mb-2">
                    MEMBERS ({group.members.length})
                  </div>
                  {group.members.length > 0 ? (
                    <div className="text-xs text-gray-600">
                      {group.members.slice(0, 3).join(', ')}
                      {group.members.length > 3 && ` and ${group.members.length - 3} more`}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400">No members</div>
                  )}
                </div>

                {Object.keys(group.tags || {}).length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-2 flex items-center">
                      <TagIcon className="h-3 w-3 mr-1" />
                      TAGS
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(group.tags || {}).slice(0, 2).map(([key, value]) => (
                        <span
                          key={key}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
                        >
                          {key}: {value}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
                  <div className="text-xs text-gray-500">
                    Created: {new Date(group.createdAt).toLocaleDateString()}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleViewPackages(group);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center"
                  >
                    <CubeIcon className="h-3 w-3 mr-1" />
                    Packages
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <GroupPackagesPanel group={selectedGroup} />
      )}

      {/* Create/Edit Group Modal */}
      {(showCreateModal || editingGroup) && (
        <GroupFormModal
          group={editingGroup}
          onSave={async () => {
            await loadGroups();
            setShowCreateModal(false);
            setEditingGroup(null);
          }}
          onCancel={() => {
            setShowCreateModal(false);
            setEditingGroup(null);
          }}
        />
      )}
    </div>
  );
};

// Group Packages Panel Component
interface GroupPackagesPanelProps {
  group: Group;
}

const GroupPackagesPanel: React.FC<GroupPackagesPanelProps> = ({ group }) => {
  const [packages, setPackages] = useState<GroupPackageBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPackage, setEditingPackage] = useState<GroupPackageBinding | null>(null);

  useEffect(() => {
    loadPackages();
  }, [group.id]);

  const loadPackages = async () => {
    try {
      setLoading(true);
      const response = await apiClient.getGroupPackages(group.id);
      setPackages(response.packages || []);
    } catch (err) {
      console.error('Failed to load group packages:', err);
      setPackages([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRemovePackage = async (packageId: string, packageName: string) => {
    // TODO: Replace native confirm() with custom ConfirmationDialog component
    if (!confirm(`Remove "${packageName}" from this group? This action cannot be undone.`)) {
      return;
    }

    try {
      await apiClient.removePackageFromGroup(group.id, packageId);
      await loadPackages();
    } catch (err: any) {
      console.error('Failed to remove package:', err);
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-md font-medium text-gray-900">
            Software Packages for {group.name}
          </h4>
          <p className="text-sm text-gray-500">
            Manage packages that will be automatically installed for group members
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          Add Package
        </button>
      </div>

      {packages.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <CubeIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No packages configured</h3>
          <p className="mt-1 text-sm text-gray-500">
            Add packages that should be automatically installed for this group's members
          </p>
          <div className="mt-6">
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add First Package
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {packages
            .sort((a, b) => a.installOrder - b.installOrder)
            .map((pkg) => (
              <div
                key={pkg.packageId}
                className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h5 className="text-sm font-semibold text-gray-900">{pkg.packageName}</h5>
                      {pkg.isMandatory && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                          ⚡ Mandatory
                        </span>
                      )}
                      {pkg.autoInstall && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          🔄 Auto-Install
                        </span>
                      )}
                    </div>
                    {pkg.packageDescription && (
                      <p className="text-sm text-gray-600 mb-2">{pkg.packageDescription}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>Install Order: #{pkg.installOrder}</span>
                      <span>Added: {new Date(pkg.createdAt).toLocaleDateString()}</span>
                      {pkg.createdBy && <span>By: {pkg.createdBy}</span>}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={() => setEditingPackage(pkg)}
                      className="text-gray-400 hover:text-blue-600"
                      title="Edit package settings"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleRemovePackage(pkg.packageId, pkg.packageName)}
                      className="text-gray-400 hover:text-red-600"
                      title="Remove package"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Add/Edit Package Modal */}
      {(showAddModal || editingPackage) && (
        <PackageFormModal
          group={group}
          package={editingPackage}
          onSave={async () => {
            await loadPackages();
            setShowAddModal(false);
            setEditingPackage(null);
          }}
          onCancel={() => {
            setShowAddModal(false);
            setEditingPackage(null);
          }}
        />
      )}
    </div>
  );
};

// Package Form Modal Component
interface PackageFormModalProps {
  group: Group;
  package?: GroupPackageBinding | null;
  onSave: () => void;
  onCancel: () => void;
}

const PackageFormModal: React.FC<PackageFormModalProps> = ({
  group,
  package: pkg,
  onSave,
  onCancel,
}) => {
  const [availablePackages, setAvailablePackages] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    packageId: pkg?.packageId || '',
    autoInstall: pkg?.autoInstall ?? true,
    isMandatory: pkg?.isMandatory ?? false,
    installOrder: pkg?.installOrder ?? 50,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPackages = async () => {
      try {
        const response = await apiClient.getBootstrapPackages();
        setAvailablePackages(response.packages || []);
      } catch (err) {
        console.error('Error fetching packages:', err);
      }
    };

    if (!pkg) {
      fetchPackages();
    }
  }, [pkg]);

  const filteredPackages = availablePackages.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (pkg) {
        // Update existing package
        await apiClient.updateGroupPackage(group.id, formData.packageId, {
          autoInstall: formData.autoInstall,
          isMandatory: formData.isMandatory,
          installOrder: formData.installOrder,
        });
      } else {
        // Add new package
        await apiClient.addPackageToGroup(group.id, formData);
      }
      onSave();
    } catch (err: any) {
      setError(err.message || 'Failed to save package');
    } finally {
      setLoading(false);
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
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            {pkg ? 'Edit Package Settings' : 'Add Package to Group'}
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

          {!pkg && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Package *
              </label>
              <div className="relative mb-3">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search packages..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="border border-gray-300 rounded-md max-h-60 overflow-y-auto">
                {filteredPackages.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">No packages found</div>
                ) : (
                  filteredPackages.map((p) => (
                    <label
                      key={p.packageId}
                      className={`flex items-start p-3 cursor-pointer hover:bg-gray-50 border-b last:border-b-0 ${
                        formData.packageId === p.packageId ? 'bg-blue-50' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="packageId"
                        value={p.packageId}
                        checked={formData.packageId === p.packageId}
                        onChange={(e) => setFormData(prev => ({ ...prev, packageId: e.target.value }))}
                        className="mt-1 mr-3"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{p.name}</div>
                        {p.description && (
                          <div className="text-sm text-gray-600 mt-1">{p.description}</div>
                        )}
                        <div className="flex gap-2 mt-1">
                          {p.metadata?.version && (
                            <span className="text-xs text-gray-500">v{p.metadata.version}</span>
                          )}
                          {p.type && (
                            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                              {p.type}
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {pkg && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <div className="font-medium text-gray-900">{pkg.packageName}</div>
              {pkg.packageDescription && (
                <div className="text-sm text-gray-600 mt-1">{pkg.packageDescription}</div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Install Order (0-100)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                required
                value={formData.installOrder}
                onChange={(e) => setFormData(prev => ({ ...prev, installOrder: parseInt(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="50"
              />
              <p className="mt-1 text-xs text-gray-500">
                Lower numbers install first. System packages typically use 0-20.
              </p>
            </div>

            <div className="space-y-3">
              <label className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  checked={formData.autoInstall}
                  onChange={(e) => setFormData(prev => ({ ...prev, autoInstall: e.target.checked }))}
                  className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">Auto-Install</span>
                  <p className="text-xs text-gray-500">
                    Automatically include this package when group members launch workstations
                  </p>
                </div>
              </label>

              <label className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  checked={formData.isMandatory}
                  onChange={(e) => setFormData(prev => ({ ...prev, isMandatory: e.target.checked }))}
                  className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">Mandatory</span>
                  <p className="text-xs text-gray-500">
                    Prevent group members from deselecting this package (requires auto-install)
                  </p>
                </div>
              </label>
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
              disabled={loading || (!pkg && !formData.packageId)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : pkg ? 'Update Package' : 'Add Package'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

interface GroupFormModalProps {
  group?: Group | null;
  onSave: () => void;
  onCancel: () => void;
}

const GroupFormModal: React.FC<GroupFormModalProps> = ({
  group,
  onSave,
  onCancel,
}) => {
  const [formData, setFormData] = useState({
    name: group?.name || '',
    description: group?.description || '',
    roleIds: group?.roleIds || [],
    isDefault: group?.isDefault || false,
    tags: group?.tags || {},
  });
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const response = await apiClient.getRoles();
        setAvailableRoles(response.roles);
      } catch (err) {
        console.error('Error fetching roles:', err);
      }
    };

    fetchRoles();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (group) {
        // Update existing group
        await apiClient.updateGroup(group.id, formData);
      } else {
        // Create new group
        await apiClient.createGroup(formData);
      }
      onSave();
    } catch (err: any) {
      setError(err.message || 'Failed to save group');
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

  const handleAddTag = () => {
    if (newTagKey && newTagValue) {
      setFormData(prev => ({
        ...prev,
        tags: { ...prev.tags, [newTagKey]: newTagValue }
      }));
      setNewTagKey('');
      setNewTagValue('');
    }
  };

  const handleRemoveTag = (key: string) => {
    setFormData(prev => ({
      ...prev,
      tags: Object.fromEntries(Object.entries(prev.tags).filter(([k]) => k !== key))
    }));
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
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            {group ? 'Edit Group' : 'Create Group'}
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
                Group Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter group name"
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
                placeholder="Enter group description"
              />
            </div>
          </div>

          <div className="mb-6">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.isDefault}
                onChange={(e) => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">
                Default Group
              </span>
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Automatically assign new users to this group
            </p>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Roles ({formData.roleIds.length} selected)
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded-md p-3">
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

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Tags
            </label>
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Tag key"
                  value={newTagKey}
                  onChange={(e) => setNewTagKey(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="Tag value"
                  value={newTagValue}
                  onChange={(e) => setNewTagValue(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(formData.tags).map(([key, value]) => (
                  <span
                    key={key}
                    className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                  >
                    {key}: {value}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(key)}
                      className="ml-2 text-blue-600 hover:text-blue-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
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
              {loading ? 'Saving...' : group ? 'Update Group' : 'Create Group'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

export default GroupManagement;