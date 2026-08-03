import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { signOut } from 'aws-amplify/auth'
import toast from 'react-hot-toast'
import RdpCredentialsModal from '@/components/workstation/RdpCredentialsModal'
import DcvConnectionModal from '@/components/workstation/DcvConnectionModal'
import PackageInstallationProgress from '@/components/workstation/PackageInstallationProgress'
import ShareWorkstationModal from '@/components/workstation/ShareWorkstationModal'
import ConfirmDialog, { ConfirmDialogProps } from '@/components/ConfirmDialog'
import { apiClient } from '@/services/api'
import { analyticsService } from '@/services/analytics'
import { useAuthStore } from '@/stores/authStore'
import { Workstation } from '@/types'
import AppShell from '@/layouts/AppShell'
import WorkstationCard from '@/components/workstation/WorkstationCard'
import StudioHero from '@/components/dashboard/StudioHero'
import StudioStats from '@/components/dashboard/StudioStats'
import StudioFilters from '@/components/dashboard/StudioFilters'
import DashboardInsights from '@/components/dashboard/DashboardInsights'
import { useActivityStore } from '@/stores/activityStore'

export default function DashboardPage() {
  const router = useRouter()
  const { user, logout, isAdmin } = useAuthStore()
  const queryClient = useQueryClient()
  const { addActivity, updateActivity } = useActivityStore()
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
    onMutate: async ({ id, action }) => {
      const previous = await optimisticStatus(id, action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'rebooting')
      const activityId = addActivity({ title: `${action.charAt(0).toUpperCase() + action.slice(1)} workstation`, description: 'Request sent to the studio infrastructure.', status: 'in_progress', category: 'workstation', resourceId: id })
      return { previous, activityId }
    },
    onSuccess: (_data, { action, id }, context) => {
      toast.success(
        action === 'start' ? 'Workstation is starting' :
        action === 'stop' ? 'Workstation is stopping' :
        'Workstation is rebooting'
      )
      analyticsService.trackWorkstationAction(action, id)
      if (context?.activityId) updateActivity(context.activityId, { status: 'succeeded', description: `Workstation ${action} request accepted.` })
    },
    onError: (error: any, { action }, context) => {
      if (context?.previous) queryClient.setQueryData(['workstations'], context.previous)
      if (context?.activityId) updateActivity(context.activityId, { status: 'failed', description: error.message || `Failed to ${action} workstation.` })
      toast.error(error.message || `Failed to ${action} workstation`)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
  })

  const terminateMutation = useMutation({
    mutationFn: (id: string) => apiClient.terminateWorkstation(id),
    onMutate: async (id) => {
      const previous = await optimisticStatus(id, 'terminating')
      const activityId = addActivity({ title: 'Terminate workstation', description: 'Permanent termination requested.', status: 'in_progress', category: 'workstation', resourceId: id })
      return { previous, activityId }
    },
    onSuccess: (_data, id, context) => {
      toast.success('Workstation is being terminated')
      analyticsService.trackWorkstationAction('terminate', id)
      if (context?.activityId) updateActivity(context.activityId, { status: 'succeeded', description: 'Termination request accepted.' })
    },
    onError: (error: any, _id, context) => {
      if (context?.previous) queryClient.setQueryData(['workstations'], context.previous)
      if (context?.activityId) updateActivity(context.activityId, { status: 'failed', description: error.message || 'Failed to terminate workstation.' })
      toast.error(error.message || 'Failed to terminate workstation')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
  })

  const extendMutation = useMutation({
    mutationFn: ({ id, hours }: { id: string; hours: number }) =>
      apiClient.extendWorkstationAutoTerminate(id, hours),
    onSuccess: (_data, { id, hours }) => {
      toast.success(`Auto-termination pushed out by ${hours}h`)
      addActivity({ title: 'Session extended', description: `Session lifetime extended by ${hours} hour${hours === 1 ? '' : 's'}.`, status: 'succeeded', category: 'workstation', resourceId: id })
      queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error: any, { id }) => {
      addActivity({ title: 'Session extension failed', description: error.message || 'The session could not be extended.', status: 'failed', category: 'workstation', resourceId: id })
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
    <AppShell isAdmin={isAdmin} onSignOut={handleLogout}>
      <div className="max-w-[1600px] mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <StudioHero onLaunch={() => router.push('/workstations/launch')} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">

          {/* LEFT: Actions */}
          <StudioFilters activeStatus={filterStatus} onStatusChange={setFilterStatus} onLaunch={() => router.push('/workstations/launch')} onRefresh={() => queryClient.invalidateQueries({ queryKey: ['workstations'] })} />

          {/* CENTER: Environment View */}
          <div className="space-y-6 lg:col-span-7">
            {/* Stats */}
            <StudioStats total={workstations.length} running={runningCount} monthlyCost={monthlyCost} projectedMonthly={projectedMonthly} />

            {/* Workstations List */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-900">
                  CREATIVE WORKSTATIONS ({filteredWorkstations.length})
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
                    <div className="text-gray-400 mb-2">Your creative studio is ready</div>
                    <button
                      onClick={() => router.push('/workstations/launch')}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      Launch your first creative workstation
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

                      return <WorkstationCard
                        key={ws.instanceId}
                        workstation={ws}
                        canShare={isAdmin || ws.userId === user.email}
                        isEditingName={isEditingName}
                        editingNameValue={editingNameValue}
                        isSavingName={updateNameMutation.isPending}
                        isExtending={extendMutation.isPending}
                        pendingPowerAction={pendingPowerAction}
                        isTerminatePending={isTerminatePending}
                        onEditingNameChange={setEditingNameValue}
                        onStartEditName={() => handleStartEditName(ws)}
                        onSaveName={() => handleSaveName(wsId)}
                        onCancelEditName={handleCancelEditName}
                        onExtend={(hours) => extendMutation.mutate({ id: wsId, hours })}
                        onSoftware={() => setPackagesWorkstationId(wsId)}
                        onShare={() => setShareWorkstation(ws)}
                        onPower={(action) => handlePower(ws, action)}
                        onTerminate={() => handleTerminate(ws)}
                        onRemoteDesktop={async () => {
                          const activityId = addActivity({ title: 'Prepare remote desktop', description: `Retrieving secure credentials for ${ws.friendlyName || ws.instanceId}.`, status: 'in_progress', category: 'connection', resourceId: wsId, resourceName: ws.friendlyName })
                          try {
                            const creds = await apiClient.getWorkstationCredentials(wsId)
                            setRdpCredentials(creds)
                            setSelectedWorkstation(ws)
                            setShowRdpModal(true)
                            updateActivity(activityId, { status: 'succeeded', description: 'Remote desktop credentials are ready.' })
                          } catch (error: any) {
                            updateActivity(activityId, { status: 'failed', description: error.message || 'Failed to retrieve remote desktop credentials.' })
                            toast.error(error.message || 'Failed to get credentials')
                          }
                        }}
                        onConnect={async () => {
                          const activityId = addActivity({ title: 'Prepare studio connection', description: `Opening a low-latency session for ${ws.friendlyName || ws.instanceId}.`, status: 'in_progress', category: 'connection', resourceId: wsId, resourceName: ws.friendlyName })
                          try {
                            const creds = await apiClient.getWorkstationCredentials(wsId)
                            setDcvConnection({ url: `https://${ws.publicIp}:8443`, quicEnabled: true, username: creds.username, password: creds.password })
                            setSelectedWorkstation(ws)
                            setShowDcvModal(true)
                            updateActivity(activityId, { status: 'succeeded', description: 'Studio connection credentials are ready.' })
                          } catch (error: any) {
                            updateActivity(activityId, { status: 'failed', description: error.message || 'Failed to prepare studio connection.' })
                            toast.error(error.message || 'Failed to get credentials')
                          }
                        }}
                      />
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <DashboardInsights
            user={user}
            isAdmin={isAdmin}
            runningCount={runningCount}
            stoppedCount={stoppedCount}
            totalCount={workstations.length}
            monthlyCost={monthlyCost}
            dailyAverage={dailyAverage}
            projectedMonthly={projectedMonthly}
            costSuggestions={costSuggestions}
            onEditProfile={() => router.push('/profile')}
            onOpenAdmin={() => router.push('/admin')}
          />
        </div>
      </div>


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
    </AppShell>
  )
}
