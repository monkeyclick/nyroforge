import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { signOut } from 'aws-amplify/auth'
import toast from 'react-hot-toast'
import LaunchWorkstationModal from '@/components/workstation/LaunchWorkstationModal'
import RdpCredentialsModal from '@/components/workstation/RdpCredentialsModal'
import DcvConnectionModal from '@/components/workstation/DcvConnectionModal'
import PackageInstallationProgress from '@/components/workstation/PackageInstallationProgress'
import ShareWorkstationModal from '@/components/workstation/ShareWorkstationModal'
import ConfirmDialog, { ConfirmDialogProps } from '@/components/ConfirmDialog'
import { apiClient } from '@/services/api'
import { analyticsService } from '@/services/analytics'
import { useAuthStore } from '@/stores/authStore'
import { Workstation } from '@/types'

function formatTimeLeft(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

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
  const [packagesWorkstationId, setPackagesWorkstationId] = useState<string | null>(null)
  const [shareWorkstation, setShareWorkstation] = useState<Workstation | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<Omit<ConfirmDialogProps, 'isOpen' | 'onCancel'> | null>(null)
  
  useEffect(() => {
    if (!user) {
      router.push('/login')
    }
  }, [user, router])

  const { data: workstationsData, isLoading } = useQuery({
    queryKey: ['workstations'],
    queryFn: () => apiClient.getWorkstations(),
    enabled: !!user,
    // Poll fast while any workstation is mid-transition so state changes
    // show up in seconds, and settle back to 30s when everything is steady.
    refetchInterval: (query) => {
      const list = query.state.data?.workstations || []
      const transitional = ['launching', 'pending', 'starting', 'stopping', 'rebooting', 'shutting-down', 'terminating']
      return list.some(ws => transitional.includes(ws.status as string)) ? 5000 : 30000
    },
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
      toast.error('Failed to update name: ' + error.message)
    }
  })

  // Optimistically flip a workstation's status in the cache so the UI reacts
  // instantly; the poll then converges on the real state. Returns a snapshot
  // for rollback on error.
  const optimisticStatus = async (id: string, status: string) => {
    await queryClient.cancelQueries({ queryKey: ['workstations'] })
    const previous = queryClient.getQueryData<{ workstations: Workstation[] }>(['workstations'])
    queryClient.setQueryData<{ workstations: Workstation[] }>(['workstations'], (old) =>
      old ? {
        ...old,
        workstations: old.workstations.map(ws =>
          (ws.workstationId || ws.instanceId) === id ? { ...ws, status: status as Workstation['status'] } : ws
        ),
      } : old
    )
    return previous
  }

  // Power actions (start / stop / reboot) — the instance is preserved
  const powerMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'stop' | 'reboot' }) =>
      apiClient.setWorkstationPower(id, action),
    onMutate: ({ id, action }) =>
      optimisticStatus(id, action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'rebooting'),
    onSuccess: (_data, { action, id }) => {
      toast.success(
        action === 'start' ? 'Workstation is starting' :
        action === 'stop' ? 'Workstation is stopping' :
        'Workstation is rebooting'
      )
      analyticsService.trackWorkstationAction(action, id)
    },
    onError: (error: any, { action }, previous) => {
      if (previous) queryClient.setQueryData(['workstations'], previous)
      toast.error(error.message || `Failed to ${action} workstation`)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
  })

  const terminateMutation = useMutation({
    mutationFn: (id: string) => apiClient.terminateWorkstation(id),
    onMutate: (id) => optimisticStatus(id, 'terminating'),
    onSuccess: (_data, id) => {
      toast.success('Workstation is being terminated')
      analyticsService.trackWorkstationAction('terminate', id)
    },
    onError: (error: any, _id, previous) => {
      if (previous) queryClient.setQueryData(['workstations'], previous)
      toast.error(error.message || 'Failed to terminate workstation')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
  })

  const extendMutation = useMutation({
    mutationFn: ({ id, hours }: { id: string; hours: number }) =>
      apiClient.extendWorkstationAutoTerminate(id, hours),
    onSuccess: (_data, { hours }) => {
      toast.success(`Auto-termination pushed out by ${hours}h`)
      queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to extend auto-termination')
    },
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
  // The costs API returns { totalCost, trends, costOptimizationSuggestions }
  const monthlyCost = costData?.totalCost ?? 0
  const projectedMonthly = costData?.trends?.projectedMonthly ?? 0
  const dailyAverage = costData?.trends?.dailyAverage ?? 0
  const costSuggestions = costData?.costOptimizationSuggestions ?? []

  const handleLogout = async () => {
    await signOut()
    logout()
    router.push('/login')
  }

  const handlePower = (ws: Workstation, action: 'start' | 'stop' | 'reboot') => {
    const name = ws.friendlyName || ws.instanceId
    const id = ws.workstationId || ws.instanceId
    if (action === 'start') {
      powerMutation.mutate({ id, action })
      return
    }
    setConfirmDialog({
      title: action === 'stop' ? `Stop ${name}?` : `Reboot ${name}?`,
      message: action === 'stop'
        ? 'The instance shuts down but is NOT destroyed — you can start it again later.'
        : 'Anyone using this workstation will be disconnected while it restarts.',
      confirmLabel: action === 'stop' ? 'Stop workstation' : 'Reboot workstation',
      variant: 'warning',
      onConfirm: () => {
        setConfirmDialog(null)
        powerMutation.mutate({ id, action })
      },
    })
  }

  const handleTerminate = (ws: Workstation) => {
    const name = ws.friendlyName || ws.instanceId
    const id = ws.workstationId || ws.instanceId
    setConfirmDialog({
      title: `Terminate ${name}?`,
      message: 'This permanently destroys the instance and ALL data on it.\nThis cannot be undone.',
      confirmLabel: 'Terminate permanently',
      variant: 'danger',
      onConfirm: () => {
        setConfirmDialog(null)
        terminateMutation.mutate(id)
      },
    })
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          
          {/* LEFT: Actions */}
          <div className="space-y-4 lg:col-span-2">
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
                {['all', 'running', 'stopped', 'launching', 'stopping', 'terminating'].map(status => (
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
          <div className="space-y-6 lg:col-span-7">
            {/* Stats */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                <div className="text-xs text-gray-500 mt-1">
                  Cost This Month
                  {projectedMonthly > 0 && (
                    <span className="text-gray-400"> · projected ${projectedMonthly.toFixed(0)}</span>
                  )}
                </div>
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
                  <div className="space-y-3" aria-label="Loading workstations">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="border border-gray-200 rounded-lg p-4 animate-pulse">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="h-4 w-40 bg-gray-200 rounded" />
                          <div className="h-4 w-14 bg-gray-100 rounded" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="h-3 w-32 bg-gray-100 rounded" />
                          <div className="h-3 w-28 bg-gray-100 rounded" />
                        </div>
                        <div className="mt-3 flex gap-2 justify-end">
                          <div className="h-6 w-16 bg-gray-100 rounded" />
                          <div className="h-6 w-16 bg-gray-100 rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
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
                      const pendingPowerAction = powerMutation.isPending && powerMutation.variables?.id === wsId
                        ? powerMutation.variables.action
                        : null
                      const isTerminatePending = terminateMutation.isPending && terminateMutation.variables === wsId
                      const isBusy = !!pendingPowerAction || isTerminatePending

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
                                      ['stopping', 'shutting-down', 'terminating'].includes(ws.status) ? 'bg-orange-100 text-orange-700' :
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

                              {/* Auto-termination countdown + extend */}
                              {ws.autoTerminateAt && !['terminated', 'terminating'].includes(ws.status) && (() => {
                                const msLeft = new Date(ws.autoTerminateAt).getTime() - Date.now()
                                const urgent = msLeft < 60 * 60 * 1000
                                return (
                                  <div className={`mt-2 flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                                    urgent ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                                  }`}>
                                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span className="font-medium">
                                      Auto-terminates {msLeft <= 0 ? 'imminently' : `in ${formatTimeLeft(msLeft)}`}
                                    </span>
                                    <span className="ml-auto flex items-center gap-1">
                                      <span className="hidden sm:inline">Extend:</span>
                                      {[1, 8, 24].map(h => (
                                        <button
                                          key={h}
                                          onClick={() => extendMutation.mutate({ id: wsId, hours: h })}
                                          disabled={extendMutation.isPending}
                                          className="px-1.5 py-0.5 rounded border border-current hover:bg-white disabled:opacity-50"
                                          title={`Extend auto-termination by ${h} hour${h > 1 ? 's' : ''}`}
                                        >
                                          +{h}h
                                        </button>
                                      ))}
                                    </span>
                                  </div>
                                )
                              })()}

                              {/* Ownership Information */}
                              {(ws.ownerName || ws.ownerGroups?.length || ws.assignedUsers?.length) && (
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
                                    {ws.assignedUsers && ws.assignedUsers.length > 0 && (
                                      <div
                                        className="flex items-center gap-1 text-blue-600"
                                        title={`Shared with: ${ws.assignedUsers.join(', ')}`}
                                      >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                        </svg>
                                        <span>Shared with {ws.assignedUsers.length} user{ws.assignedUsers.length > 1 ? 's' : ''}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2 justify-end">
                              {!['terminated', 'terminating'].includes(ws.status) && (
                                <button
                                  onClick={() => setPackagesWorkstationId(wsId)}
                                  className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50"
                                  title="View software installation progress"
                                >
                                  📦 Packages
                                </button>
                              )}
                              {!['terminated', 'terminating'].includes(ws.status) && (isAdmin || ws.userId === user.email) && (
                                <button
                                  onClick={() => setShareWorkstation(ws)}
                                  className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50"
                                  title="Share this workstation with other users"
                                >
                                  👥 Share
                                </button>
                              )}
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
                                        toast.error(error.message || 'Failed to get credentials');
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
                                        toast.error(error.message || 'Failed to get credentials');
                                      }
                                    }}
                                    className="px-3 py-1.5 text-xs border border-blue-300 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                                    title="Connect via Amazon DCV (low latency with QUIC)"
                                  >
                                    ⚡ DCV
                                  </button>
                                  <button
                                    onClick={() => handlePower(ws, 'reboot')}
                                    disabled={isBusy}
                                    className="px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
                                    title="Reboot the instance"
                                  >
                                    {pendingPowerAction === 'reboot' ? 'Rebooting…' : '↻ Reboot'}
                                  </button>
                                  <button
                                    onClick={() => handlePower(ws, 'stop')}
                                    disabled={isBusy}
                                    className="px-3 py-1.5 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
                                    title="Shut down the instance — it can be started again later"
                                  >
                                    {pendingPowerAction === 'stop' ? 'Stopping…' : '⏸ Stop'}
                                  </button>
                                </>
                              )}
                              {ws.status === 'stopped' && (
                                <button
                                  onClick={() => handlePower(ws, 'start')}
                                  disabled={isBusy}
                                  className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                                  title="Start the instance"
                                >
                                  {pendingPowerAction === 'start' ? 'Starting…' : '▶ Start'}
                                </button>
                              )}
                              {!['terminated', 'terminating'].includes(ws.status as string) && (
                                <button
                                  onClick={() => handleTerminate(ws)}
                                  disabled={isBusy}
                                  className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                                  title="Permanently destroy the instance and all data on it"
                                >
                                  {isTerminatePending ? 'Terminating…' : '🗑 Terminate'}
                                </button>
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
          <div className="space-y-4 lg:col-span-3">
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

            {(dailyAverage > 0 || costSuggestions.length > 0) && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">COST INSIGHTS</h2>
                <div className="space-y-2 text-sm mb-3">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Daily average</span>
                    <span className="font-medium text-gray-900">${dailyAverage.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Projected month</span>
                    <span className="font-medium text-gray-900">${projectedMonthly.toFixed(2)}</span>
                  </div>
                </div>
                {costSuggestions.length > 0 && (
                  <ul className="space-y-2 border-t border-gray-100 pt-3">
                    {costSuggestions.slice(0, 4).map((suggestion, idx) => (
                      <li key={idx} className="flex gap-2 text-xs text-gray-600">
                        <span aria-hidden="true">💡</span>
                        <span>{suggestion}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

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
          analyticsService.trackWorkstationAction('launch')
          queryClient.invalidateQueries({ queryKey: ['workstations'] })
        }}
      />

      {confirmDialog && (
        <ConfirmDialog
          {...confirmDialog}
          isOpen
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {packagesWorkstationId && (
        <PackageInstallationProgress
          workstationId={packagesWorkstationId}
          isOpen={!!packagesWorkstationId}
          onClose={() => setPackagesWorkstationId(null)}
        />
      )}

      {shareWorkstation && (
        <ShareWorkstationModal
          key={shareWorkstation.workstationId || shareWorkstation.instanceId}
          workstation={shareWorkstation}
          isOpen={!!shareWorkstation}
          onClose={() => setShareWorkstation(null)}
        />
      )}

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