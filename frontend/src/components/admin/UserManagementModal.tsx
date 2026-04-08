import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  XMarkIcon,
  UserIcon,
  UserGroupIcon,
  ShieldCheckIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentListIcon,
  KeyIcon,
  ArrowPathIcon,
  EllipsisVerticalIcon,
} from '@heroicons/react/24/outline';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { EnhancedUser, Role, Group, UserFilters, UsersListResponse, RolesListResponse, GroupsListResponse } from '../../types/auth';
import { useAuthStore } from '../../stores/authStore';
import UserForm from './UserForm';
import RoleManagement from './RoleManagement';
import GroupManagement from './GroupManagement';
import AuditLogsViewer from './AuditLogsViewer';
import DeleteUserDialog from './DeleteUserDialog';
import PasswordManagementDialog from './PasswordManagementDialog';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'users' | 'roles' | 'groups' | 'audit' | 'settings';

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { hasPermission, user: currentUser } = useAuthStore();
  const queryClient = useQueryClient();
  
  const [activeTab, setActiveTab] = useState<TabType>('users');
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<EnhancedUser | null>(null);
  const [userFilters, setUserFilters] = useState<UserFilters>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  
  // New state for delete and password dialogs
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [selectedUserForAction, setSelectedUserForAction] = useState<EnhancedUser | null>(null);
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);

  // Fetch users
  const { data: usersData, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin-users', userFilters, searchTerm, currentPage],
    queryFn: () => apiClient.getUsers({ ...userFilters, search: searchTerm }, currentPage),
    enabled: isOpen && activeTab === 'users',
    refetchOnWindowFocus: false,
  });

  // Fetch roles
  const { data: rolesData, isLoading: loadingRoles } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => apiClient.getRoles(),
    enabled: isOpen,
    refetchOnWindowFocus: false,
  });

  // Fetch groups
  const { data: groupsData, isLoading: loadingGroups } = useQuery({
    queryKey: ['admin-groups'],
    queryFn: () => apiClient.getGroups(),
    enabled: isOpen,
    refetchOnWindowFocus: false,
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => apiClient.deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User deleted successfully');
    },
    onError: (error: any) => {
      toast.error(`Failed to delete user: ${error.message}`);
    },
  });

  // Suspend/Activate user mutations
  const suspendUserMutation = useMutation({
    mutationFn: (userId: string) => apiClient.suspendUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User suspended');
    },
    onError: (error: any) => {
      toast.error(`Failed to suspend user: ${error.message}`);
    },
  });

  const activateUserMutation = useMutation({
    mutationFn: (userId: string) => apiClient.activateUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User activated');
    },
    onError: (error: any) => {
      toast.error(`Failed to activate user: ${error.message}`);
    },
  });

  const handleCreateUser = () => {
    setEditingUser(null);
    setShowUserForm(true);
  };

  const handleEditUser = (user: EnhancedUser) => {
    setEditingUser(user);
    setShowUserForm(true);
    setOpenActionMenu(null);
  };

  const handleDeleteUser = (user: EnhancedUser) => {
    setSelectedUserForAction(user);
    setShowDeleteDialog(true);
    setOpenActionMenu(null);
  };

  const handleManagePassword = (user: EnhancedUser) => {
    setSelectedUserForAction(user);
    setShowPasswordDialog(true);
    setOpenActionMenu(null);
  };

  const handleToggleUserStatus = (user: EnhancedUser) => {
    if (user.status === 'active') {
      suspendUserMutation.mutate(user.id);
    } else {
      activateUserMutation.mutate(user.id);
    }
    setOpenActionMenu(null);
  };

  const handleRestoreUser = async (user: EnhancedUser) => {
    try {
      await apiClient.restoreUser(user.id);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User restored successfully');
    } catch (error: any) {
      toast.error(`Failed to restore user: ${error.message}`);
    }
    setOpenActionMenu(null);
  };

  const toggleActionMenu = (userId: string) => {
    setOpenActionMenu(openActionMenu === userId ? null : userId);
  };

  const tabs: { id: TabType; label: string; icon: React.ComponentType<any>; permission?: string }[] = [
    { id: 'users', label: 'Users', icon: UserIcon, permission: 'users:read' },
    { id: 'roles', label: 'Roles', icon: ShieldCheckIcon, permission: 'roles:read' },
    { id: 'groups', label: 'Groups', icon: UserGroupIcon, permission: 'groups:read' },
    { id: 'audit', label: 'Audit Logs', icon: ClipboardDocumentListIcon, permission: 'analytics:read' },
    { id: 'settings', label: 'Settings', icon: Cog6ToothIcon, permission: 'settings:read' },
  ];

  const visibleTabs = tabs.filter(tab => 
    !tab.permission || hasPermission(tab.permission as any)
  );

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex min-h-screen items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative w-full max-w-6xl max-h-[90vh] bg-white rounded-lg shadow-xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-2xl font-bold text-gray-900">User Management</h2>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="border-b">
              <nav className="flex space-x-8 px-6">
                {visibleTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                        activeTab === tab.id
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <Icon className="h-5 w-5 mr-2" />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'users' && (
                <div className="space-y-6">
                  {/* Users Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="relative">
                        <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search users..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10 pr-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      
                      {/* Status Filter */}
                      <select
                        value={userFilters.status || ''}
                        onChange={(e) => setUserFilters({ ...userFilters, status: e.target.value as any })}
                        className="border rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">All Status</option>
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                        <option value="pending">Pending</option>
                        <option value="deleted">Deleted</option>
                      </select>
                    </div>

                    {hasPermission('users:write') && (
                      <button
                        onClick={handleCreateUser}
                        className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                      >
                        <PlusIcon className="h-4 w-4 mr-2" />
                        Add User
                      </button>
                    )}
                  </div>

                  {/* Users List */}
                  {loadingUsers ? (
                    <div className="flex items-center justify-center h-32">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {usersData?.users?.map((user: EnhancedUser) => (
                        <div
                          key={user.id}
                          className="border rounded-lg p-4 hover:bg-gray-50"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-3">
                                <div className="h-10 w-10 bg-gray-300 rounded-full flex items-center justify-center">
                                  <UserIcon className="h-6 w-6 text-gray-600" />
                                </div>
                                <div>
                                  <h3 className="font-medium text-gray-900">{user.name}</h3>
                                  <p className="text-sm text-gray-500">{user.email}</p>
                                </div>
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    user.status === 'active'
                                      ? 'bg-green-100 text-green-800'
                                      : user.status === 'suspended'
                                      ? 'bg-red-100 text-red-800'
                                      : user.status === 'deleted'
                                      ? 'bg-gray-100 text-gray-800'
                                      : 'bg-yellow-100 text-yellow-800'
                                  }`}
                                >
                                  {user.status}
                                </span>
                                {user.status === 'deleted' && user.scheduledPurgeDate && (
                                  <span className="text-xs text-gray-500 ml-2">
                                    (Purge: {new Date(user.scheduledPurgeDate).toLocaleDateString()})
                                  </span>
                                )}
                              </div>
                              
                              {user.roleIds.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {user.roleIds?.map((roleId: string) => {
                                    const role = rolesData?.roles?.find((r: Role) => r.id === roleId);
                                    return role ? (
                                      <span
                                        key={roleId}
                                        className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-blue-100 text-blue-800"
                                      >
                                        {role.name}
                                      </span>
                                    ) : null;
                                  })}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center space-x-2">
                              {hasPermission('users:write') && (
                                <>
                                  <button
                                    onClick={() => handleEditUser(user)}
                                    className="p-2 text-gray-400 hover:text-blue-600 rounded-full hover:bg-blue-50"
                                    title="Edit user"
                                  >
                                    <PencilIcon className="h-5 w-5" />
                                  </button>
                                  
                                  <button
                                    onClick={() => handleManagePassword(user)}
                                    className="p-2 text-gray-400 hover:text-amber-600 rounded-full hover:bg-amber-50"
                                    title="Manage password"
                                  >
                                    <KeyIcon className="h-5 w-5" />
                                  </button>
                                </>
                              )}

                              {/* Action dropdown menu */}
                              <div className="relative">
                                <button
                                  onClick={() => toggleActionMenu(user.id)}
                                  className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                                  title="More actions"
                                >
                                  <EllipsisVerticalIcon className="h-5 w-5" />
                                </button>

                                {openActionMenu === user.id && (
                                  <>
                                    {/* Backdrop to close menu */}
                                    <div
                                      className="fixed inset-0 z-10"
                                      onClick={() => setOpenActionMenu(null)}
                                    />
                                    
                                    <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border z-20 py-1">
                                      {user.status === 'deleted' ? (
                                        <button
                                          onClick={() => handleRestoreUser(user)}
                                          className="w-full px-4 py-2 text-left text-sm text-green-600 hover:bg-green-50 flex items-center"
                                        >
                                          <ArrowPathIcon className="h-4 w-4 mr-2" />
                                          Restore User
                                        </button>
                                      ) : (
                                        <>
                                          {hasPermission('users:write') && (
                                            <button
                                              onClick={() => handleToggleUserStatus(user)}
                                              className={`w-full px-4 py-2 text-left text-sm flex items-center ${
                                                user.status === 'active'
                                                  ? 'text-orange-600 hover:bg-orange-50'
                                                  : 'text-green-600 hover:bg-green-50'
                                              }`}
                                            >
                                              {user.status === 'active' ? (
                                                <>
                                                  <ExclamationTriangleIcon className="h-4 w-4 mr-2" />
                                                  Suspend User
                                                </>
                                              ) : (
                                                <>
                                                  <ArrowPathIcon className="h-4 w-4 mr-2" />
                                                  Activate User
                                                </>
                                              )}
                                            </button>
                                          )}
                                          
                                          {hasPermission('users:delete') && (
                                            <button
                                              onClick={() => handleDeleteUser(user)}
                                              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center"
                                            >
                                              <TrashIcon className="h-4 w-4 mr-2" />
                                              Delete User
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}

                      {usersData?.users.length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                          No users found.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Pagination */}
                  {usersData?.pagination && usersData.pagination.pages > 1 && (
                    <div className="flex items-center justify-between border-t pt-4">
                      <div className="text-sm text-gray-700">
                        Showing {((currentPage - 1) * 20) + 1} to {Math.min(currentPage * 20, usersData.pagination.total)} of {usersData.pagination.total} users
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                          disabled={currentPage === 1}
                          className="px-3 py-1 border rounded disabled:opacity-50"
                        >
                          Previous
                        </button>
                        <button
                          onClick={() => setCurrentPage(Math.min(usersData.pagination.pages, currentPage + 1))}
                          disabled={currentPage === usersData.pagination.pages}
                          className="px-3 py-1 border rounded disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'roles' && <RoleManagement />}

              {activeTab === 'groups' && <GroupManagement />}

              {activeTab === 'audit' && <AuditLogsViewer />}

              {activeTab === 'settings' && (
                <div className="text-center py-8 text-gray-500">
                  Settings panel coming soon...
                </div>
              )}
            </div>
          </motion.div>
        </div>

        {/* User Form Modal */}
        {showUserForm && (
          <UserForm
            user={editingUser || undefined}
            onSave={() => {
              setShowUserForm(false);
              setEditingUser(null);
              queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            }}
            onCancel={() => {
              setShowUserForm(false);
              setEditingUser(null);
            }}
          />
        )}

        {/* Delete User Dialog */}
        <DeleteUserDialog
          isOpen={showDeleteDialog}
          onClose={() => {
            setShowDeleteDialog(false);
            setSelectedUserForAction(null);
          }}
          user={selectedUserForAction}
          onDeleteSuccess={() => {
            setShowDeleteDialog(false);
            setSelectedUserForAction(null);
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            toast.success('User deleted successfully');
          }}
          currentUserId={currentUser?.id || ''}
        />

        {/* Password Management Dialog */}
        <PasswordManagementDialog
          isOpen={showPasswordDialog}
          onClose={() => {
            setShowPasswordDialog(false);
            setSelectedUserForAction(null);
          }}
          user={selectedUserForAction}
          onSuccess={() => {
            setShowPasswordDialog(false);
            setSelectedUserForAction(null);
            toast.success('Password updated successfully');
          }}
          currentUserId={currentUser?.id || ''}
        />
      </div>
    </AnimatePresence>
  );
};

export default UserManagementModal;