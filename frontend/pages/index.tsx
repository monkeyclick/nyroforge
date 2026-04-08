import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { signOut } from 'aws-amplify/auth'
import LaunchWorkstationModal from '@/components/workstation/LaunchWorkstationModal'
import RdpCredentialsModal from '@/components/workstation/RdpCredentialsModal'
import DcvConnectionModal from '@/components/workstation/DcvConnectionModal'
import { apiClient } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { Workstation } from '@/types'

export default function DashboardPage() {
  const router = useRouter()
  const { user, logout, isAdmin } = useAuthStore()
  const queryClient = useQueryClient()
  const [showLaunchModal, setShowLaunchModal] = useState(false)
  const [showRdpModal, setShowRdpModal] = useState(false)
  const [showDcvModal, setShowDcvModal] = useState(false)
  const [rdpCredentials, setRdpCredentials] = useState<any>(null)
  const [dcvConnection, setDcvConnection] = useState<any>(null)
  const [selectedWorkstation, setSelectedWorkstation] = useState<any>(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  
  useEffect(() => {
    if (!user) {
      router.push('/login')
    }
  }, [user, router])

  const { data: workstationsData, isLoading } = useQuery({
    queryKey: ['workstations'],
    queryFn: () => apiClient.getWorkstations(),
    enabled: !!user,
    refetchInterval: 30000,
  })

  const { data: costData } = useQuery({
    queryKey: ['costs'],
    queryFn: () => apiClient.getCostAnalytics('monthly'),
    enabled: !!user,
  })

  // Mutation for updating workstation name
  const updateNameMutation = useMutation({
    mutationFn: async ({ workstationId, friendlyName }: { workstationId: string; friendlyName: string }) => {
      return apiClient.updateWorkstationName(workstationId, friendlyName)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workstations'] })
      setEditingNameId(null)
      setEditingNameValue('')
    },
    onError: (error: any) => {
      alert('Failed to update name: ' + error.message)
    }
  })

  const handleStartEditName = useCallback((ws: Workstation) => {
    const id = ws.workstationId || ws.instanceId
    setEditingNameId(id)
    setEditingNameValue(ws.friendlyName || '')
  }, [])

  const handleSaveName = useCallback((workstationId: string) => {
    updateNameMutation.mutate({ workstationId, friendlyName: editingNameValue })
  }, [editingNameValue, updateNameMutation])

  const handleCancelEditName = useCallback(() => {
    setEditingNameId(null)
    setEditingNameValue('')
  }, [])

  const workstations = workstationsData?.workstations || []
  const filteredWorkstations = workstations.filter(ws => 
    filterStatus === 'all' || ws.status === filterStatus
  )

  const runningCount = workstations.filter(ws => ws.status === 'running').length
  const stoppedCount = workstations.filter(ws => ws.status === 'stopped').length
  const monthlyCost = (costData as any)?.total || (costData as any)?.monthlyTotal || 0

  const handleLogout = async () => {
    await signOut()
    logout()
    router.push('/login')
  }

  const handleTerminate = async (instanceId: string, workstationId?: string) => {
    if (!confirm('Terminate this workstation?')) return
    try {
      // Use workstationId if available, otherwise fall back to instanceId
      const id = workstationId || instanceId
      await apiClient.terminateWorkstation(id)
      queryClient.invalidateQueries({ queryKey: ['workstations'] })
    } catch (error: any) {
      alert('Failed to terminate: ' + error.message)
    }
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Nav */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-full mx-auto px-6">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">Workstation Manager</h1>
            </div>
            <div className="flex items-center space-x-4">
              {isAdmin && (
                <button
                  onClick={() => router.push('/admin')}
                  className="text-sm text-gray-700 hover:text-gray-900"
                >
                  Admin
                </button>
              )}
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

      {/* Three Column Layout */}
      <div className="max-w-full mx-auto px-6 py-6">
        <div className="grid grid-cols-12 gap-6">
          
          {/* LEFT: Actions */}
          <div className="col-span-2 space-y-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">ACTIONS</h2>
              <div className="space-y-2">
                <button
                  onClick={() => setShowLaunchModal(true)}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
                >
                  + New Workstation
                </button>
                <button
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['workstations'] })}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">FILTER</h2>
              <div className="space-y-1">
                {['all', 'running', 'stopped', 'launching'].map(status => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={`w-full text-left px-3 py-2 text-sm rounded ${
                      filterStatus === status
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* CENTER: Environment View */}
          <div className="col-span-7 space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-900">{workstations.length}</div>
                <div className="text-xs text-gray-500 mt-1">Total Workstations</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-2xl font-bold text-green-600">{runningCount}</div>
                <div className="text-xs text-gray-500 mt-1">Running</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-900">${monthlyCost.toFixed(0)}</div>
                <div className="text-xs text-gray-500 mt-1">Monthly Cost</div>
              </div>
            </div>

            {/* Workstations List */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-900">
                  ACTIVE WORKSTATIONS ({filteredWorkstations.length})
                </h2>
              </div>
              <div className="p-4">
                {isLoading ? (
                  <div className="text-center py-8 text-gray-500">Loading...</div>
                ) : filteredWorkstations.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-gray-400 mb-2">No workstations</div>
                    <button
                      onClick={() => setShowLaunchModal(true)}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      Launch your first workstation
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredWorkstations.map(ws => {
                      const wsId = ws.workstationId || ws.instanceId
                      const isEditingName = editingNameId === wsId
                      
                      return (
                        <div
                          key={ws.instanceId}
                          className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              {/* Instance Name Header */}
                              <div className="flex items-center gap-2 mb-2">
                                {isEditingName ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={editingNameValue}
                                      onChange={(e) => setEditingNameValue(e.target.value)}
                                      className="px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      placeholder="Enter instance name"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveName(wsId)
                                        if (e.key === 'Escape') handleCancelEditName()
                                      }}
                                    />
                                    <button
                                      onClick={() => handleSaveName(wsId)}
                                      disabled={updateNameMutation.isPending}
                                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                    >
                                      {updateNameMutation.isPending ? '...' : 'Save'}
                                    </button>
                                    <button
                                      onClick={handleCancelEditName}
                                      className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <h3 className="font-medium text-gray-900">
                                      {ws.friendlyName || ws.instanceId}
                                    </h3>
                                    <button
                                      onClick={() => handleStartEditName(ws)}
                                      className="text-gray-400 hover:text-gray-600"
                                      title="Edit name"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                      </svg>
                                    </button>
                                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                                      ws.status === 'running' ? 'bg-green-100 text-green-700' :
                                      ws.status === 'stopped' ? 'bg-gray-100 text-gray-700' :
                                      'bg-yellow-100 text-yellow-700'
                                    }`}>
                                      {ws.status}
                                    </span>
                                  </>
                                )}
                              </div>
                              
                              {/* Instance ID (shown if friendly name exists) */}
                              {ws.friendlyName && !isEditingName && (
                                <div className="text-xs text-gray-400 mb-2 font-mono">{ws.instanceId}</div>
                              )}
                              
                              {/* Instance Details Grid */}
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                                <div className="text-gray-500">Type: <span className="text-gray-900">{ws.instanceType}</span></div>
                                <div className="text-gray-500">Region: <span className="text-gray-900">{ws.region}</span></div>
                                {ws.publicIp && (
                                  <div className="text-gray-500">IP: <span className="text-gray-900 font-mono text-xs">{ws.publicIp}</span></div>
                                )}
                              </div>
                              
                              {/* Ownership Information */}
                              {(ws.ownerName || ws.ownerGroups?.length) && (
                                <div className="mt-2 pt-2 border-t border-gray-100">
                                  <div className="flex items-center gap-4 text-xs">
                                    {ws.ownerName && (
                                      <div className="flex items-center gap-1 text-gray-500">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                        <span>{ws.ownerName}</span>
                                      </div>
                                    )}
                                    {ws.ownerGroups && ws.ownerGroups.length > 0 && (
                                      <div className="flex items-center gap-1 text-gray-500">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                        </svg>
                                        <span className="flex gap-1">
                                          {ws.ownerGroups.map((group, idx) => (
                                            <span key={group} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                                              {group}
                                            </span>
                                          ))}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              {ws.status === 'running' && (
                                <>
                                  <button
                                    onClick={async () => {
                                      try {
                                        const workstationId = ws.workstationId || ws.instanceId;
                                        const creds = await apiClient.getWorkstationCredentials(workstationId);
                                        setRdpCredentials(creds);
                                        setSelectedWorkstation(ws);
                                        setShowRdpModal(true);
                                      } catch (error: any) {
                                        console.error('Credentials error:', error);
                                        alert(error.message || 'Failed to get credentials');
                                      }
                                    }}
                                    className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50"
                                    title="Connect via RDP"
                                  >
                                    🖥️ RDP
                                  </button>
                                  <button
                                    onClick={async () => {
                                      try {
                                        const workstationId = ws.workstationId || ws.instanceId;
                                        const creds = await apiClient.getWorkstationCredentials(workstationId);
                                        setDcvConnection({
                                          url: `https://${ws.publicIp}:8443`,
                                          quicEnabled: true,
                                          username: creds.username,
                                          password: creds.password
                                        });
                                        setSelectedWorkstation(ws);
                                        setShowDcvModal(true);
                                      } catch (error: any) {
                                        console.error('Credentials error:', error);
                                        alert(error.message || 'Failed to get credentials');
                                      }
                                    }}
                                    className="px-3 py-1.5 text-xs border border-blue-300 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                                    title="Connect via Amazon DCV (low latency with QUIC)"
                                  >
                                    ⚡ DCV
                                  </button>
                                  <button
                                    onClick={() => handleTerminate(ws.instanceId, ws.workstationId)}
                                    className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                  >
                                    Stop
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: User Management */}
          <div className="col-span-3 space-y-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-sm font-semibold text-gray-900">USER INFO</h2>
                <button
                  onClick={() => router.push('/profile')}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  Edit Profile
                </button>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <div className="text-gray-500">Name</div>
                  <div className="font-medium text-gray-900">{user.name || 'Not set'}</div>
                </div>
                <div>
                  <div className="text-gray-500">Email</div>
                  <div className="font-medium text-gray-900">{user.email}</div>
                </div>
                <div>
                  <div className="text-gray-500">Role</div>
                  <div className="font-medium text-gray-900">
                    {user.roleIds?.includes('admin') ? 'Administrator' : 'User'}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">QUICK STATS</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Running</span>
                  <span className="font-semibold text-green-600">{runningCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Stopped</span>
                  <span className="font-semibold text-gray-600">{stoppedCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Total</span>
                  <span className="font-semibold text-gray-900">{workstations.length}</span>
                </div>
                <div className="pt-2 border-t border-gray-200">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Monthly Cost</span>
                    <span className="font-semibold text-gray-900">${monthlyCost.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {isAdmin && (
              <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
                <h2 className="text-sm font-semibold text-blue-900 mb-2">ADMIN ACCESS</h2>
                <p className="text-xs text-blue-700 mb-3">
                  You have administrator privileges
                </p>
                <button
                  onClick={() => router.push('/admin')}
                  className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
                >
                  Open Admin Panel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <LaunchWorkstationModal
        isOpen={showLaunchModal}
        onClose={() => setShowLaunchModal(false)}
        onSuccess={() => {
          setShowLaunchModal(false)
          queryClient.invalidateQueries({ queryKey: ['workstations'] })
        }}
      />

      {rdpCredentials && selectedWorkstation && (
        <RdpCredentialsModal
          isOpen={showRdpModal}
          onClose={() => {
            setShowRdpModal(false)
            setRdpCredentials(null)
            setSelectedWorkstation(null)
          }}
          credentials={{
            hostname: selectedWorkstation.publicIp || selectedWorkstation.instanceId,
            username: rdpCredentials.username,
            password: rdpCredentials.password,
            rdpFile: rdpCredentials.rdpFile
          }}
          workstationName={selectedWorkstation.instanceId}
        />
      )}

      {dcvConnection && selectedWorkstation && (
        <DcvConnectionModal
          isOpen={showDcvModal}
          onClose={() => {
            setShowDcvModal(false)
            setDcvConnection(null)
            setSelectedWorkstation(null)
          }}
          connection={{
            url: dcvConnection.url,
            quicEnabled: dcvConnection.quicEnabled,
            username: dcvConnection.username,
            password: dcvConnection.password
          }}
          workstationName={selectedWorkstation.instanceId}
        />
      )}
    </div>
  )
}