import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { signOut, fetchAuthSession } from 'aws-amplify/auth'
import { apiClient } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import SecurityManagement from '@/components/admin/SecurityManagement'
import CostAnalytics from '@/components/admin/CostAnalytics'
import BootstrapPackageManagement from '@/components/admin/BootstrapPackageManagement'
import AnalyticsDashboard from '@/components/admin/AnalyticsDashboard'
import CognitoGroupsList from '@/components/admin/CognitoGroupsList'
import EnhancedUserEditModal from '@/components/admin/EnhancedUserEditModal'
import StorageManagement from '@/components/admin/StorageManagement'
import AddExistingInstanceModal from '@/components/admin/AddExistingInstanceModal'
import InstanceScopeManagement from '@/components/admin/InstanceScopeManagement'
import InstanceFamilyManagement from '@/components/admin/InstanceFamilyManagement'
import DeleteUserDialog from '@/components/admin/DeleteUserDialog'
import PasswordManagementDialog from '@/components/admin/PasswordManagementDialog'

interface AmiValidationResult {
  available: boolean;
  ami?: {
    id: string;
    name: string;
    description?: string;
    creationDate?: string;
  };
  message: string;
}

export default function AdminPage() {
  const router = useRouter()
  const { user, logout, isAdmin } = useAuthStore()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('workstations')
  const [userManagementSubTab, setUserManagementSubTab] = useState<'users' | 'groups'>('users')
  const [securityGroups, setSecurityGroups] = useState<any[]>([])
  const [selectedOsVersion, setSelectedOsVersion] = useState('windows-server-2025')
  const [selectedRegion, setSelectedRegion] = useState('us-east-1')
  const [amiValidationResult, setAmiValidationResult] = useState<AmiValidationResult | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [isSavingDefaults, setIsSavingDefaults] = useState(false)
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [newUserData, setNewUserData] = useState({
    email: '',
    name: '',
    role: 'user',
    temporaryPassword: '',
  })
  const [isCreatingUser, setIsCreatingUser] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)
  const [showAddExistingInstanceModal, setShowAddExistingInstanceModal] = useState(false)
  
  // User deletion and password management state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [selectedUserForAction, setSelectedUserForAction] = useState<any>(null)
  
  // General Settings State
  const [generalSettings, setGeneralSettings] = useState({
    defaultRegion: 'us-east-1',
    defaultSubnet: 'auto',
    autoTerminateHours: 'Never',
    notifications: false,
    costAlerts: false,
  })
  
  // Instance Defaults State
  const [instanceDefaults, setInstanceDefaults] = useState({
    defaultInstanceType: 'g5.xlarge',
    defaultOsVersion: 'windows-server-2025',
  })
  
  // Load saved settings on mount
  useEffect(() => {
    const savedGeneralSettings = localStorage.getItem('adminGeneralSettings');
    const savedInstanceDefaults = localStorage.getItem('adminInstanceDefaults');
    
    if (savedGeneralSettings) {
      try {
        const parsed = JSON.parse(savedGeneralSettings);
        setGeneralSettings(parsed);
        setSelectedRegion(parsed.defaultRegion);
      } catch (e) {
        console.error('Failed to parse saved general settings:', e);
      }
    }
    
    if (savedInstanceDefaults) {
      try {
        const parsed = JSON.parse(savedInstanceDefaults);
        setInstanceDefaults(parsed);
        setSelectedOsVersion(parsed.defaultOsVersion);
      } catch (e) {
        console.error('Failed to parse saved instance defaults:', e);
      }
    }
  }, []);

  useEffect(() => {
    if (!user) {
      router.push('/login')
    } else if (!isAdmin) {
      router.push('/')
    }
  }, [user, isAdmin, router])

  const { data: workstationsData, isLoading } = useQuery({
    queryKey: ['admin-workstations'],
    queryFn: () => apiClient.getWorkstations(),
    enabled: !!user && isAdmin,
    refetchInterval: 30000,
  })

  const { data: dashboardData } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => apiClient.getDashboardStatus(),
    enabled: !!user && isAdmin,
    refetchInterval: 30000,
  })

  const { data: usersData, refetch: refetchUsers } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiClient.getUsers(),
    enabled: !!user && isAdmin && activeTab === 'user-management',
  })

  const terminateWorkstation = useMutation({
    mutationFn: (workstationId: string) => apiClient.terminateWorkstation(workstationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-workstations'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
    },
  });

  const handleLogout = async () => {
    await signOut()
    logout()
    router.push('/login')
  }

  if (!user || !isAdmin) return null

  const workstations = workstationsData?.workstations || []
  const summary = dashboardData?.summary || {
    totalInstances: 0,
    runningInstances: 0,
    stoppedInstances: 0,
    totalHourlyCost: 0,
    estimatedMonthlyCost: 0,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Nav */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-full mx-auto px-6">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-6">
              <h1 className="text-xl font-bold text-gray-900">Admin Panel</h1>
              <button
                onClick={() => router.push('/')}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                ← Back to Dashboard
              </button>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">{user.email}</span>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-full mx-auto px-6 py-6">
        <div className="grid grid-cols-12 gap-6">
          
          {/* LEFT: Navigation */}
          <div className="col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">ADMIN MENU</h2>
              <div className="space-y-1">
                {['workstations', 'instance-scope', 'instance-families', 'costs', 'user-management', 'security', 'storage', 'analytics', 'settings', 'bootstrap'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`w-full text-left px-3 py-2 text-sm rounded ${
                      activeTab === tab
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {tab === 'bootstrap' ? 'Bootstrap Packages' :
                     tab === 'analytics' ? 'Analytics' :
                     tab === 'user-management' ? 'User Management' :
                     tab === 'storage' ? '💾 Storage' :
                     tab === 'instance-scope' ? '🎯 Instance Scope' :
                     tab === 'instance-families' ? '🖥️ Instance Families' :
                     tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* CENTER: Content */}
          <div className="col-span-7 space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-900">{summary.totalInstances}</div>
                <div className="text-xs text-gray-500 mt-1">Total</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-2xl font-bold text-green-600">{summary.runningInstances}</div>
                <div className="text-xs text-gray-500 mt-1">Running</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-600">{summary.stoppedInstances}</div>
                <div className="text-xs text-gray-500 mt-1">Stopped</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-900">${summary.estimatedMonthlyCost.toFixed(0)}</div>
                <div className="text-xs text-gray-500 mt-1">Monthly</div>
              </div>
            </div>

            {/* Content Area */}
            {activeTab === 'workstations' && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                  <h2 className="text-sm font-semibold text-gray-900">
                    ALL WORKSTATIONS ({workstations.length})
                  </h2>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setShowAddExistingInstanceModal(true)}
                      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      + Add Existing EC2
                    </button>
                    <button
                      onClick={async () => {
                      if (!confirm('Reconcile EC2 instances with DynamoDB? This will create records for any orphaned instances.')) return;
                      try {
                        console.log('Starting reconciliation...');
                        const session = await fetchAuthSession();
                        const token = session.tokens?.idToken?.toString();
                        console.log('Token obtained:', token ? 'Yes' : 'No');
                        
                        const url = `${process.env.NEXT_PUBLIC_API_ENDPOINT}/workstations/reconcile`;
                        console.log('Calling URL:', url);
                        
                        const response = await fetch(url, {
                          method: 'PUT',
                          headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json',
                          },
                        });
                        
                        console.log('Response status:', response.status);
                        const data = await response.json();
                        console.log('Response data:', data);
                        
                        if (response.ok) {
                          alert(`Reconciliation complete!\n\nReconciled: ${data.summary.reconciledCount}\nTotal EC2: ${data.summary.totalEC2Instances}\nTotal DB: ${data.summary.totalDynamoRecords}`);
                          queryClient.invalidateQueries({ queryKey: ['admin-workstations'] });
                        } else {
                          const errorMsg = `Reconciliation failed!\n\nStatus: ${response.status}\nError: ${data.message || data.error || 'Unknown error'}\n\nCheck browser console for details.`;
                          console.error('Reconciliation failed:', data);
                          alert(errorMsg);
                        }
                      } catch (error) {
                        console.error('Reconciliation error:', error);
                        const errorMsg = `Failed to reconcile workstations:\n${error instanceof Error ? error.message : String(error)}\n\nCheck browser console for details.`;
                        alert(errorMsg);
                      }
                    }}
                      className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      🔄 Reconcile
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Instance ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Region</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {isLoading ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                            Loading...
                          </td>
                        </tr>
                      ) : workstations.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                            No workstations found
                          </td>
                        </tr>
                      ) : (
                        workstations.map((ws: any) => (
                          <tr key={ws.instanceId} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-mono text-gray-900">{ws.instanceId}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{ws.userId}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{ws.instanceType}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{ws.region}</td>
                            <td className="px-4 py-3 text-sm">
                              <span className={`px-2 py-1 text-xs font-medium rounded ${
                                ws.status === 'running' ? 'bg-green-100 text-green-700' :
                                ws.status === 'stopped' ? 'bg-gray-100 text-gray-700' :
                                'bg-yellow-100 text-yellow-700'
                              }`}>
                                {ws.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm font-mono text-gray-600">{ws.publicIp || '-'}</td>
                            <td className="px-4 py-3 text-sm text-right">
                              <button
                                onClick={() => terminateWorkstation.mutate(ws.instanceId)}
                                className="text-red-600 hover:text-red-800 text-xs"
                                disabled={terminateWorkstation.isPending}
                              >
                                {terminateWorkstation.isPending ? 'Terminating...' : 'Terminate'}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'user-management' && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-4 py-3 border-b border-gray-200">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-900">USER MANAGEMENT</h2>
                    {userManagementSubTab === 'users' && (
                      <button
                        onClick={() => setShowAddUserModal(true)}
                        className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        + Add User
                      </button>
                    )}
                  </div>
                  
                  {/* Sub-tab switcher */}
                  <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
                    <button
                      onClick={() => setUserManagementSubTab('users')}
                      className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                        userManagementSubTab === 'users'
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Users
                    </button>
                    <button
                      onClick={() => setUserManagementSubTab('groups')}
                      className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                        userManagementSubTab === 'groups'
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Groups
                    </button>
                  </div>
                </div>

                {userManagementSubTab === 'users' && (
                <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Workstations</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {!usersData ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                            Loading users...
                          </td>
                        </tr>
                      ) : usersData.users && usersData.users.length > 0 ? (
                        usersData.users.map((dbUser: any) => (
                          <tr key={dbUser.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">{dbUser.name || 'No Name'}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{dbUser.email}</td>
                            <td className="px-4 py-3 text-sm">
                              <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-700">
                                {dbUser.roleIds?.includes('admin') ? 'Admin' : 'User'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <span className={`px-2 py-1 text-xs font-medium rounded ${
                                dbUser.status === 'active' ? 'bg-green-100 text-green-700' :
                                dbUser.status === 'suspended' ? 'bg-red-100 text-red-700' :
                                'bg-yellow-100 text-yellow-700'
                              }`}>
                                {dbUser.status || 'active'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {workstations.filter(w => w.userId === dbUser.email).length}
                            </td>
                            <td className="px-4 py-3 text-sm text-right">
                              <div className="flex items-center justify-end space-x-1">
                                {/* Edit Button */}
                                <button
                                  onClick={() => {
                                    setEditingUser(dbUser);
                                    setShowEditModal(true);
                                  }}
                                  className="p-2 text-gray-400 hover:text-blue-600 rounded-full hover:bg-blue-50"
                                  title="Edit user"
                                >
                                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                                  </svg>
                                </button>
                                
                                {/* Password Management Button */}
                                <button
                                  onClick={() => {
                                    setSelectedUserForAction(dbUser);
                                    setShowPasswordDialog(true);
                                  }}
                                  className="p-2 text-gray-400 hover:text-amber-600 rounded-full hover:bg-amber-50"
                                  title="Manage password"
                                >
                                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                                  </svg>
                                </button>
                                
                                {/* Delete Button */}
                                <button
                                  onClick={() => {
                                    setSelectedUserForAction(dbUser);
                                    setShowDeleteDialog(true);
                                  }}
                                  className="p-2 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-50"
                                  title="Delete user"
                                >
                                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                            No users found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                  <p className="text-xs text-gray-500">
                    Total Users: {usersData?.users?.length || 0}
                  </p>
                </div>
                </>
                )}

                {userManagementSubTab === 'groups' && (
                  <div className="p-6">
                    <CognitoGroupsList />
                  </div>
                )}
              </div>
            )}

            {activeTab === 'costs' && (
              <CostAnalytics summary={summary} />
            )}

            {activeTab === 'security' && (
              <SecurityManagement />
            )}

            {activeTab === 'settings' && (
              <div className="space-y-6">
                {/* General Settings */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <h2 className="text-sm font-semibold text-gray-900">GENERAL SETTINGS</h2>
                  </div>
                  <div className="p-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Default Region
                      </label>
                      <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        value={generalSettings.defaultRegion}
                        onChange={(e) => {
                          setGeneralSettings({ ...generalSettings, defaultRegion: e.target.value });
                          setSelectedRegion(e.target.value);
                          setAmiValidationResult(null);
                        }}
                      >
                        <optgroup label="US Regions">
                          <option value="us-east-1">us-east-1 (N. Virginia)</option>
                          <option value="us-east-2">us-east-2 (Ohio)</option>
                          <option value="us-west-1">us-west-1 (N. California)</option>
                          <option value="us-west-2">us-west-2 (Oregon)</option>
                        </optgroup>
                        <optgroup label="US Local Zones">
                          <option value="us-east-1-bos-1">us-east-1-bos-1 (Boston)</option>
                          <option value="us-east-1-chi-1">us-east-1-chi-1 (Chicago)</option>
                          <option value="us-east-1-dfw-1">us-east-1-dfw-1 (Dallas)</option>
                          <option value="us-east-1-iah-1">us-east-1-iah-1 (Houston)</option>
                          <option value="us-east-1-mci-1">us-east-1-mci-1 (Kansas City)</option>
                          <option value="us-east-1-mia-1">us-east-1-mia-1 (Miami)</option>
                          <option value="us-east-1-msp-1">us-east-1-msp-1 (Minneapolis)</option>
                          <option value="us-east-1-nyc-1">us-east-1-nyc-1 (New York)</option>
                          <option value="us-east-1-phl-1">us-east-1-phl-1 (Philadelphia)</option>
                          <option value="us-west-2-den-1">us-west-2-den-1 (Denver)</option>
                          <option value="us-west-2-las-1">us-west-2-las-1 (Las Vegas)</option>
                          <option value="us-west-2-lax-1">us-west-2-lax-1 (Los Angeles)</option>
                          <option value="us-west-2-phx-1">us-west-2-phx-1 (Phoenix)</option>
                          <option value="us-west-2-pdx-1">us-west-2-pdx-1 (Portland)</option>
                          <option value="us-west-2-sea-1">us-west-2-sea-1 (Seattle)</option>
                        </optgroup>
                        <optgroup label="Europe Regions">
                          <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
                          <option value="eu-west-1">eu-west-1 (Ireland)</option>
                          <option value="eu-west-2">eu-west-2 (London)</option>
                          <option value="eu-west-3">eu-west-3 (Paris)</option>
                          <option value="eu-north-1">eu-north-1 (Stockholm)</option>
                          <option value="eu-south-1">eu-south-1 (Milan)</option>
                          <option value="eu-south-2">eu-south-2 (Spain)</option>
                          <option value="eu-central-2">eu-central-2 (Zurich)</option>
                        </optgroup>
                        <optgroup label="Europe Local Zones">
                          <option value="eu-central-1-ham-1">eu-central-1-ham-1 (Hamburg)</option>
                          <option value="eu-central-1-muc-1">eu-central-1-muc-1 (Munich)</option>
                          <option value="eu-south-1-mxp-1">eu-south-1-mxp-1 (Milan)</option>
                          <option value="eu-west-1-dub-1">eu-west-1-dub-1 (Dublin)</option>
                          <option value="eu-west-2-lcy-1">eu-west-2-lcy-1 (London)</option>
                          <option value="eu-west-2-man-1">eu-west-2-man-1 (Manchester)</option>
                          <option value="eu-west-3-par-1">eu-west-3-par-1 (Paris)</option>
                        </optgroup>
                        <optgroup label="Asia Pacific Regions">
                          <option value="ap-east-1">ap-east-1 (Hong Kong)</option>
                          <option value="ap-south-1">ap-south-1 (Mumbai)</option>
                          <option value="ap-south-2">ap-south-2 (Hyderabad)</option>
                          <option value="ap-northeast-1">ap-northeast-1 (Tokyo)</option>
                          <option value="ap-northeast-2">ap-northeast-2 (Seoul)</option>
                          <option value="ap-northeast-3">ap-northeast-3 (Osaka)</option>
                          <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
                          <option value="ap-southeast-2">ap-southeast-2 (Sydney)</option>
                          <option value="ap-southeast-3">ap-southeast-3 (Jakarta)</option>
                          <option value="ap-southeast-4">ap-southeast-4 (Melbourne)</option>
                        </optgroup>
                        <optgroup label="Asia Pacific Local Zones">
                          <option value="ap-northeast-1-tyo-1">ap-northeast-1-tyo-1 (Tokyo)</option>
                          <option value="ap-northeast-2-icn-1">ap-northeast-2-icn-1 (Seoul)</option>
                          <option value="ap-south-1-del-1">ap-south-1-del-1 (Delhi)</option>
                          <option value="ap-southeast-1-sin-1">ap-southeast-1-sin-1 (Singapore)</option>
                          <option value="ap-southeast-2-per-1">ap-southeast-2-per-1 (Perth)</option>
                          <option value="ap-southeast-2-syd-1">ap-southeast-2-syd-1 (Sydney)</option>
                        </optgroup>
                        <optgroup label="Middle East & Africa">
                          <option value="me-south-1">me-south-1 (Bahrain)</option>
                          <option value="me-central-1">me-central-1 (UAE)</option>
                          <option value="af-south-1">af-south-1 (Cape Town)</option>
                        </optgroup>
                        <optgroup label="South America">
                          <option value="sa-east-1">sa-east-1 (São Paulo)</option>
                        </optgroup>
                        <optgroup label="Canada">
                          <option value="ca-central-1">ca-central-1 (Central)</option>
                        </optgroup>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Default Subnet
                      </label>
                      <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        value={generalSettings.defaultSubnet}
                        onChange={(e) => setGeneralSettings({ ...generalSettings, defaultSubnet: e.target.value })}
                      >
                        <option value="auto">Auto-select (Recommended)</option>
                        <option value="public">Public Subnet</option>
                        <option value="private">Private Subnet</option>
                        <option value="custom">Custom Subnet ID</option>
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        Choose which subnet to deploy workstations into by default
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Auto-Terminate Idle Workstations
                      </label>
                      <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        value={generalSettings.autoTerminateHours}
                        onChange={(e) => setGeneralSettings({ ...generalSettings, autoTerminateHours: e.target.value })}
                      >
                        <option>Never</option>
                        <option>After 1 hour</option>
                        <option>After 4 hours</option>
                        <option>After 8 hours</option>
                        <option>After 24 hours</option>
                      </select>
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="notifications"
                        className="mr-2"
                        checked={generalSettings.notifications}
                        onChange={(e) => setGeneralSettings({ ...generalSettings, notifications: e.target.checked })}
                      />
                      <label htmlFor="notifications" className="text-sm text-gray-700">
                        Send email notifications for workstation events
                      </label>
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="cost-alerts"
                        className="mr-2"
                        checked={generalSettings.costAlerts}
                        onChange={(e) => setGeneralSettings({ ...generalSettings, costAlerts: e.target.checked })}
                      />
                      <label htmlFor="cost-alerts" className="text-sm text-gray-700">
                        Enable cost alerts when monthly spend exceeds threshold
                      </label>
                    </div>

                    <div className="pt-4">
                      <button
                        onClick={async () => {
                          setIsSavingSettings(true);
                          try {
                            // Save to localStorage for now (can be connected to backend later)
                            localStorage.setItem('adminGeneralSettings', JSON.stringify(generalSettings));
                            alert('Settings saved successfully!');
                          } catch (error) {
                            console.error('Failed to save settings:', error);
                            alert('Failed to save settings');
                          } finally {
                            setIsSavingSettings(false);
                          }
                        }}
                        disabled={isSavingSettings}
                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSavingSettings ? 'Saving...' : 'Save Settings'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Instance Defaults */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <h2 className="text-sm font-semibold text-gray-900">DEFAULT INSTANCE SETTINGS</h2>
                  </div>
                  <div className="p-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Default Instance Type
                      </label>
                      <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        value={instanceDefaults.defaultInstanceType}
                        onChange={(e) => setInstanceDefaults({ ...instanceDefaults, defaultInstanceType: e.target.value })}
                      >
                        <optgroup label="G5 - GPU Optimized (NVIDIA A10G)">
                          <option value="g5.xlarge" selected>g5.xlarge (4 vCPU, 16GB, 1 GPU) - Default</option>
                          <option value="g5.2xlarge">g5.2xlarge (8 vCPU, 32GB, 1 GPU)</option>
                          <option value="g5.4xlarge">g5.4xlarge (16 vCPU, 64GB, 1 GPU)</option>
                          <option value="g5.8xlarge">g5.8xlarge (32 vCPU, 128GB, 1 GPU)</option>
                          <option value="g5.12xlarge">g5.12xlarge (48 vCPU, 192GB, 4 GPU)</option>
                          <option value="g5.16xlarge">g5.16xlarge (64 vCPU, 256GB, 1 GPU)</option>
                          <option value="g5.24xlarge">g5.24xlarge (96 vCPU, 384GB, 4 GPU)</option>
                          <option value="g5.48xlarge">g5.48xlarge (192 vCPU, 768GB, 8 GPU)</option>
                        </optgroup>
                        <optgroup label="G6 - GPU Optimized (NVIDIA L4)">
                          <option value="g6.xlarge">g6.xlarge (4 vCPU, 16GB, 1 GPU)</option>
                          <option value="g6.2xlarge">g6.2xlarge (8 vCPU, 32GB, 1 GPU)</option>
                          <option value="g6.4xlarge">g6.4xlarge (16 vCPU, 64GB, 1 GPU)</option>
                          <option value="g6.8xlarge">g6.8xlarge (32 vCPU, 128GB, 1 GPU)</option>
                          <option value="g6.12xlarge">g6.12xlarge (48 vCPU, 192GB, 4 GPU)</option>
                          <option value="g6.16xlarge">g6.16xlarge (64 vCPU, 256GB, 1 GPU)</option>
                          <option value="g6.24xlarge">g6.24xlarge (96 vCPU, 384GB, 4 GPU)</option>
                          <option value="g6.48xlarge">g6.48xlarge (192 vCPU, 768GB, 8 GPU)</option>
                        </optgroup>
                        <optgroup label="G4dn - GPU Optimized (NVIDIA T4)">
                          <option value="g4dn.xlarge">g4dn.xlarge (4 vCPU, 16GB, 1 GPU)</option>
                          <option value="g4dn.2xlarge">g4dn.2xlarge (8 vCPU, 32GB, 1 GPU)</option>
                          <option value="g4dn.4xlarge">g4dn.4xlarge (16 vCPU, 64GB, 1 GPU)</option>
                          <option value="g4dn.8xlarge">g4dn.8xlarge (32 vCPU, 128GB, 1 GPU)</option>
                          <option value="g4dn.12xlarge">g4dn.12xlarge (48 vCPU, 192GB, 4 GPU)</option>
                          <option value="g4dn.16xlarge">g4dn.16xlarge (64 vCPU, 256GB, 1 GPU)</option>
                          <option value="g4dn.metal">g4dn.metal (96 vCPU, 384GB, 8 GPU)</option>
                        </optgroup>
                        <optgroup label="G5g - GPU ARM (AWS Graviton2)">
                          <option value="g5g.xlarge">g5g.xlarge (4 vCPU, 8GB, 1 GPU)</option>
                          <option value="g5g.2xlarge">g5g.2xlarge (8 vCPU, 16GB, 1 GPU)</option>
                          <option value="g5g.4xlarge">g5g.4xlarge (16 vCPU, 32GB, 1 GPU)</option>
                          <option value="g5g.8xlarge">g5g.8xlarge (32 vCPU, 64GB, 1 GPU)</option>
                          <option value="g5g.16xlarge">g5g.16xlarge (64 vCPU, 128GB, 2 GPU)</option>
                          <option value="g5g.metal">g5g.metal (64 vCPU, 128GB, 2 GPU)</option>
                        </optgroup>
                        <optgroup label="C7i - Compute Optimized (Intel)">
                          <option value="c7i.large">c7i.large (2 vCPU, 4GB)</option>
                          <option value="c7i.xlarge">c7i.xlarge (4 vCPU, 8GB)</option>
                          <option value="c7i.2xlarge">c7i.2xlarge (8 vCPU, 16GB)</option>
                          <option value="c7i.4xlarge">c7i.4xlarge (16 vCPU, 32GB)</option>
                          <option value="c7i.8xlarge">c7i.8xlarge (32 vCPU, 64GB)</option>
                          <option value="c7i.12xlarge">c7i.12xlarge (48 vCPU, 96GB)</option>
                          <option value="c7i.16xlarge">c7i.16xlarge (64 vCPU, 128GB)</option>
                          <option value="c7i.24xlarge">c7i.24xlarge (96 vCPU, 192GB)</option>
                          <option value="c7i.48xlarge">c7i.48xlarge (192 vCPU, 384GB)</option>
                          <option value="c7i.metal-24xl">c7i.metal-24xl (96 vCPU, 192GB)</option>
                          <option value="c7i.metal-48xl">c7i.metal-48xl (192 vCPU, 384GB)</option>
                        </optgroup>
                        <optgroup label="C7a - Compute Optimized (AMD)">
                          <option value="c7a.medium">c7a.medium (1 vCPU, 2GB)</option>
                          <option value="c7a.large">c7a.large (2 vCPU, 4GB)</option>
                          <option value="c7a.xlarge">c7a.xlarge (4 vCPU, 8GB)</option>
                          <option value="c7a.2xlarge">c7a.2xlarge (8 vCPU, 16GB)</option>
                          <option value="c7a.4xlarge">c7a.4xlarge (16 vCPU, 32GB)</option>
                          <option value="c7a.8xlarge">c7a.8xlarge (32 vCPU, 64GB)</option>
                          <option value="c7a.12xlarge">c7a.12xlarge (48 vCPU, 96GB)</option>
                          <option value="c7a.16xlarge">c7a.16xlarge (64 vCPU, 128GB)</option>
                          <option value="c7a.24xlarge">c7a.24xlarge (96 vCPU, 192GB)</option>
                          <option value="c7a.32xlarge">c7a.32xlarge (128 vCPU, 256GB)</option>
                          <option value="c7a.48xlarge">c7a.48xlarge (192 vCPU, 384GB)</option>
                          <option value="c7a.metal-48xl">c7a.metal-48xl (192 vCPU, 384GB)</option>
                        </optgroup>
                        <optgroup label="C7g - Compute ARM (AWS Graviton3)">
                          <option value="c7g.medium">c7g.medium (1 vCPU, 2GB)</option>
                          <option value="c7g.large">c7g.large (2 vCPU, 4GB)</option>
                          <option value="c7g.xlarge">c7g.xlarge (4 vCPU, 8GB)</option>
                          <option value="c7g.2xlarge">c7g.2xlarge (8 vCPU, 16GB)</option>
                          <option value="c7g.4xlarge">c7g.4xlarge (16 vCPU, 32GB)</option>
                          <option value="c7g.8xlarge">c7g.8xlarge (32 vCPU, 64GB)</option>
                          <option value="c7g.12xlarge">c7g.12xlarge (48 vCPU, 96GB)</option>
                          <option value="c7g.16xlarge">c7g.16xlarge (64 vCPU, 128GB)</option>
                          <option value="c7g.metal">c7g.metal (64 vCPU, 128GB)</option>
                        </optgroup>
                        <optgroup label="C6i - Compute Optimized (Intel)">
                          <option value="c6i.large">c6i.large (2 vCPU, 4GB)</option>
                          <option value="c6i.xlarge">c6i.xlarge (4 vCPU, 8GB)</option>
                          <option value="c6i.2xlarge">c6i.2xlarge (8 vCPU, 16GB)</option>
                          <option value="c6i.4xlarge">c6i.4xlarge (16 vCPU, 32GB)</option>
                          <option value="c6i.8xlarge">c6i.8xlarge (32 vCPU, 64GB)</option>
                          <option value="c6i.12xlarge">c6i.12xlarge (48 vCPU, 96GB)</option>
                          <option value="c6i.16xlarge">c6i.16xlarge (64 vCPU, 128GB)</option>
                          <option value="c6i.24xlarge">c6i.24xlarge (96 vCPU, 192GB)</option>
                          <option value="c6i.32xlarge">c6i.32xlarge (128 vCPU, 256GB)</option>
                          <option value="c6i.metal">c6i.metal (128 vCPU, 256GB)</option>
                        </optgroup>
                        <optgroup label="C6a - Compute Optimized (AMD)">
                          <option value="c6a.large">c6a.large (2 vCPU, 4GB)</option>
                          <option value="c6a.xlarge">c6a.xlarge (4 vCPU, 8GB)</option>
                          <option value="c6a.2xlarge">c6a.2xlarge (8 vCPU, 16GB)</option>
                          <option value="c6a.4xlarge">c6a.4xlarge (16 vCPU, 32GB)</option>
                          <option value="c6a.8xlarge">c6a.8xlarge (32 vCPU, 64GB)</option>
                          <option value="c6a.12xlarge">c6a.12xlarge (48 vCPU, 96GB)</option>
                          <option value="c6a.16xlarge">c6a.16xlarge (64 vCPU, 128GB)</option>
                          <option value="c6a.24xlarge">c6a.24xlarge (96 vCPU, 192GB)</option>
                          <option value="c6a.32xlarge">c6a.32xlarge (128 vCPU, 256GB)</option>
                          <option value="c6a.48xlarge">c6a.48xlarge (192 vCPU, 384GB)</option>
                          <option value="c6a.metal">c6a.metal (192 vCPU, 384GB)</option>
                        </optgroup>
                        <optgroup label="C6g - Compute ARM (AWS Graviton2)">
                          <option value="c6g.medium">c6g.medium (1 vCPU, 2GB)</option>
                          <option value="c6g.large">c6g.large (2 vCPU, 4GB)</option>
                          <option value="c6g.xlarge">c6g.xlarge (4 vCPU, 8GB)</option>
                          <option value="c6g.2xlarge">c6g.2xlarge (8 vCPU, 16GB)</option>
                          <option value="c6g.4xlarge">c6g.4xlarge (16 vCPU, 32GB)</option>
                          <option value="c6g.8xlarge">c6g.8xlarge (32 vCPU, 64GB)</option>
                          <option value="c6g.12xlarge">c6g.12xlarge (48 vCPU, 96GB)</option>
                          <option value="c6g.16xlarge">c6g.16xlarge (64 vCPU, 128GB)</option>
                          <option value="c6g.metal">c6g.metal (64 vCPU, 128GB)</option>
                        </optgroup>
                        <optgroup label="C5 - Compute Optimized">
                          <option value="c5.large">c5.large (2 vCPU, 4GB)</option>
                          <option value="c5.xlarge">c5.xlarge (4 vCPU, 8GB)</option>
                          <option value="c5.2xlarge">c5.2xlarge (8 vCPU, 16GB)</option>
                          <option value="c5.4xlarge">c5.4xlarge (16 vCPU, 32GB)</option>
                          <option value="c5.9xlarge">c5.9xlarge (36 vCPU, 72GB)</option>
                          <option value="c5.12xlarge">c5.12xlarge (48 vCPU, 96GB)</option>
                          <option value="c5.18xlarge">c5.18xlarge (72 vCPU, 144GB)</option>
                          <option value="c5.24xlarge">c5.24xlarge (96 vCPU, 192GB)</option>
                          <option value="c5.metal">c5.metal (96 vCPU, 192GB)</option>
                        </optgroup>
                        <optgroup label="C5n - Compute Optimized Network">
                          <option value="c5n.large">c5n.large (2 vCPU, 5.25GB)</option>
                          <option value="c5n.xlarge">c5n.xlarge (4 vCPU, 10.5GB)</option>
                          <option value="c5n.2xlarge">c5n.2xlarge (8 vCPU, 21GB)</option>
                          <option value="c5n.4xlarge">c5n.4xlarge (16 vCPU, 42GB)</option>
                          <option value="c5n.9xlarge">c5n.9xlarge (36 vCPU, 96GB)</option>
                          <option value="c5n.18xlarge">c5n.18xlarge (72 vCPU, 192GB)</option>
                          <option value="c5n.metal">c5n.metal (72 vCPU, 192GB)</option>
                        </optgroup>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Default OS Version
                      </label>
                      <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        value={instanceDefaults.defaultOsVersion}
                        onChange={(e) => {
                          setInstanceDefaults({ ...instanceDefaults, defaultOsVersion: e.target.value });
                          setSelectedOsVersion(e.target.value);
                          setAmiValidationResult(null);
                        }}
                      >
                        <option value="windows-server-2025">Windows Server 2025</option>
                        <option value="windows-server-2022">Windows Server 2022</option>
                        <option value="windows-server-2019">Windows Server 2019</option>
                        <option value="windows-server-2016">Windows Server 2016</option>
                      </select>
                      <div className="mt-2">
                        <button
                          type="button"
                          className="text-xs text-blue-600 hover:text-blue-700 flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={isValidating}
                          onClick={async () => {
                            setIsValidating(true);
                            setAmiValidationResult(null);
                            try {
                              const session = await fetchAuthSession();
                              const token = session.tokens?.idToken?.toString();
                              
                              const response = await fetch(`${process.env.NEXT_PUBLIC_API_ENDPOINT}/admin/validate-ami`, {
                                method: 'POST',
                                headers: {
                                  'Content-Type': 'application/json',
                                  'Authorization': `Bearer ${token}`,
                                },
                                body: JSON.stringify({
                                  osVersion: selectedOsVersion,
                                  region: selectedRegion,
                                }),
                              });
                              const data = await response.json();
                              setAmiValidationResult(data);
                            } catch (error) {
                              console.error('AMI validation error:', error);
                              setAmiValidationResult({
                                available: false,
                                message: 'Failed to validate AMI. Please check your connection and try again.',
                              });
                            } finally {
                              setIsValidating(false);
                            }
                          }}
                        >
                          {isValidating ? (
                            <>
                              <svg className="animate-spin w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Validating...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Validate AMI Availability
                            </>
                          )}
                        </button>
                        {amiValidationResult && (
                          <div className={`mt-2 p-2 rounded text-xs ${
                            amiValidationResult.available
                              ? 'bg-green-50 border border-green-200 text-green-800'
                              : 'bg-red-50 border border-red-200 text-red-800'
                          }`}>
                            <div className="font-medium mb-1">
                              {amiValidationResult.available ? '✓ AMI Available' : '✗ AMI Not Found'}
                            </div>
                            <div>{amiValidationResult.message}</div>
                            {amiValidationResult.ami && (
                              <div className="mt-1 space-y-0.5 text-xs opacity-75">
                                <div>ID: {amiValidationResult.ami.id}</div>
                                <div>Name: {amiValidationResult.ami.name}</div>
                              </div>
                            )}
                          </div>
                        )}
                        <p className="mt-1 text-xs text-gray-500">
                          Verifies the AMI exists in your AWS account before deployment
                        </p>
                      </div>
                    </div>

                    <div className="pt-4">
                      <button
                        onClick={async () => {
                          setIsSavingDefaults(true);
                          try {
                            // Save to localStorage for now (can be connected to backend later)
                            localStorage.setItem('adminInstanceDefaults', JSON.stringify(instanceDefaults));
                            alert('Instance defaults saved successfully!');
                          } catch (error) {
                            console.error('Failed to save defaults:', error);
                            alert('Failed to save defaults');
                          } finally {
                            setIsSavingDefaults(false);
                          }
                        }}
                        disabled={isSavingDefaults}
                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSavingDefaults ? 'Saving...' : 'Save Defaults'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'analytics' && (
              <AnalyticsDashboard />
            )}

            {activeTab === 'storage' && (
              <StorageManagement />
            )}

            {activeTab === 'instance-scope' && (
              <InstanceScopeManagement />
            )}

            {activeTab === 'instance-families' && (
              <InstanceFamilyManagement />
            )}

            {activeTab === 'bootstrap' && (
              <BootstrapPackageManagement />
            )}
          </div>

          {/* RIGHT: System Info */}
          <div className="col-span-3 space-y-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">SYSTEM STATUS</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Total Instances</span>
                  <span className="font-semibold text-gray-900">{summary.totalInstances}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Running</span>
                  <span className="font-semibold text-green-600">{summary.runningInstances}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Stopped</span>
                  <span className="font-semibold text-gray-600">{summary.stoppedInstances}</span>
                </div>
                <div className="pt-2 border-t border-gray-200 mt-2">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Hourly Cost</span>
                    <span className="font-semibold text-gray-900">${summary.totalHourlyCost.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-gray-500">Monthly Est.</span>
                    <span className="font-semibold text-gray-900">${summary.estimatedMonthlyCost.toFixed(0)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
              <h2 className="text-sm font-semibold text-blue-900 mb-2">ADMIN PRIVILEGES</h2>
              <p className="text-xs text-blue-700">
                You have full system access. All workstations and users are visible.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Add New User</h3>
              <button
                onClick={() => {
                  setShowAddUserModal(false);
                  setNewUserData({ email: '', name: '', role: 'user', temporaryPassword: '' });
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={newUserData.email}
                  onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="user@example.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={newUserData.name}
                  onChange={(e) => setNewUserData({ ...newUserData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="John Doe"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role *
                </label>
                <select
                  value={newUserData.role}
                  onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="user">User</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Temporary Password *
                </label>
                <input
                  type="password"
                  value={newUserData.temporaryPassword}
                  onChange={(e) => setNewUserData({ ...newUserData, temporaryPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="Minimum 8 characters"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  User will be required to change this password on first login
                </p>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowAddUserModal(false);
                  setNewUserData({ email: '', name: '', role: 'user', temporaryPassword: '' });
                }}
                disabled={isCreatingUser}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!newUserData.email || !newUserData.name || !newUserData.temporaryPassword) {
                    alert('Please fill in all required fields');
                    return;
                  }

                  if (newUserData.temporaryPassword.length < 8) {
                    alert('Password must be at least 8 characters');
                    return;
                  }

                  setIsCreatingUser(true);
                  try {
                    console.log('Creating user with data:', {
                      email: newUserData.email,
                      name: newUserData.name,
                      role: newUserData.role,
                    });
                    
                    // Use the API client instead of direct fetch
                    await apiClient.createUser({
                      email: newUserData.email,
                      name: newUserData.name,
                      roleIds: newUserData.role === 'admin' ? ['admin'] : ['user'],
                      groupIds: [],
                    });

                    alert('User created successfully! They can now log in with their email.');
                    setShowAddUserModal(false);
                    setNewUserData({ email: '', name: '', role: 'user', temporaryPassword: '' });
                    
                    // Refresh the users list
                    queryClient.invalidateQueries({ queryKey: ['admin-users'] });
                  } catch (error) {
                    console.error('Error creating user:', error);
                    alert(`Failed to create user: ${error instanceof Error ? error.message : 'Network error'}\n\nCheck browser console for more details.`);
                  } finally {
                    setIsCreatingUser(false);
                  }
                }}
                disabled={isCreatingUser}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreatingUser ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && editingUser && (
        <EnhancedUserEditModal
          user={editingUser}
          onClose={() => {
            setShowEditModal(false);
            setEditingUser(null);
          }}
          onSave={() => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            refetchUsers();
          }}
        />
      )}

      {/* Add Existing EC2 Instance Modal */}
      <AddExistingInstanceModal
        isOpen={showAddExistingInstanceModal}
        onClose={() => setShowAddExistingInstanceModal(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['admin-workstations'] });
          queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
        }}
      />

      {/* Delete User Dialog */}
      {showDeleteDialog && selectedUserForAction && (
        <DeleteUserDialog
          isOpen={showDeleteDialog}
          onClose={() => {
            setShowDeleteDialog(false);
            setSelectedUserForAction(null);
          }}
          user={{
            id: selectedUserForAction.id,
            email: selectedUserForAction.email,
            name: selectedUserForAction.name || 'No Name',
            status: selectedUserForAction.status || 'active',
          }}
          onDeleteSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            refetchUsers();
            setShowDeleteDialog(false);
            setSelectedUserForAction(null);
          }}
          currentUserId={user?.id || ''}
        />
      )}

      {/* Password Management Dialog */}
      {showPasswordDialog && selectedUserForAction && (
        <PasswordManagementDialog
          isOpen={showPasswordDialog}
          onClose={() => {
            setShowPasswordDialog(false);
            setSelectedUserForAction(null);
          }}
          user={{
            id: selectedUserForAction.id,
            email: selectedUserForAction.email,
            name: selectedUserForAction.name || 'No Name',
            status: selectedUserForAction.status || 'active',
          }}
          onSuccess={() => {
            setShowPasswordDialog(false);
            setSelectedUserForAction(null);
          }}
          currentUserId={user?.id || ''}
        />
      )}
    </div>
  )
}