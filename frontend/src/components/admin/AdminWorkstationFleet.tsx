import type { Workstation } from '@/types'

type PowerAction = 'start' | 'stop'

interface AdminWorkstationFleetProps {
  workstations: Workstation[]
  isLoading: boolean
  pendingPower?: { id: string; action: PowerAction | 'reboot' }
  pendingTerminationId?: string
  onAddExisting: () => void
  onReconcile: () => void
  onPower: (workstation: Workstation, action: PowerAction) => void
  onAssign: (workstation: Workstation) => void
  onTerminate: (workstation: Workstation) => void
}

function statusClassName(status: Workstation['status']) {
  if (status === 'running') return 'bg-green-100 text-green-700'
  if (status === 'stopped') return 'bg-gray-100 text-gray-700'
  if (status === 'stopping' || status === 'terminating') return 'bg-orange-100 text-orange-700'
  return 'bg-yellow-100 text-yellow-700'
}

export default function AdminWorkstationFleet({
  workstations,
  isLoading,
  pendingPower,
  pendingTerminationId,
  onAddExisting,
  onReconcile,
  onPower,
  onAssign,
  onTerminate,
}: AdminWorkstationFleetProps) {
  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200" aria-labelledby="fleet-heading">
      <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap justify-between items-center gap-3">
        <h2 id="fleet-heading" className="text-sm font-semibold text-gray-900">
          ALL WORKSTATIONS ({workstations.length})
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={onAddExisting} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
            + Add Existing EC2
          </button>
          <button onClick={onReconcile} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700">
            🔄 Reconcile
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {['Instance ID', 'Owner', 'Type', 'Region', 'Status', 'IP'].map(label => (
                <th key={label} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{label}</th>
              ))}
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : workstations.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No workstations found</td></tr>
            ) : workstations.map(workstation => {
              const workstationId = workstation.workstationId || workstation.instanceId
              const pendingPowerAction = pendingPower?.id === workstationId ? pendingPower.action : null
              const isTerminatePending = pendingTerminationId === workstationId
              const isBusy = Boolean(pendingPowerAction || isTerminatePending)

              return (
                <tr key={workstation.instanceId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-gray-900">
                    <div>{workstation.instanceId}</div>
                    {workstation.friendlyName && <div className="text-xs text-gray-400 font-sans">{workstation.friendlyName}</div>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <div>{workstation.userId}</div>
                    {!!workstation.assignedUsers?.length && (
                      <div className="text-xs text-blue-600 mt-0.5" title={`Shared with: ${workstation.assignedUsers.join(', ')}`}>
                        +{workstation.assignedUsers.length} shared user{workstation.assignedUsers.length > 1 ? 's' : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{workstation.instanceType}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{workstation.region}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${statusClassName(workstation.status)}`}>{workstation.status}</span>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">{workstation.publicIp || '-'}</td>
                  <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      {workstation.status === 'stopped' && (
                        <button onClick={() => onPower(workstation, 'start')} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50" disabled={isBusy} title="Start the instance">
                          {pendingPowerAction === 'start' ? 'Starting…' : 'Start'}
                        </button>
                      )}
                      {workstation.status === 'running' && (
                        <button onClick={() => onPower(workstation, 'stop')} className="px-2 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50" disabled={isBusy} title="Shut down the instance — it can be started again later">
                          {pendingPowerAction === 'stop' ? 'Stopping…' : 'Stop'}
                        </button>
                      )}
                      <button onClick={() => onAssign(workstation)} className="px-2 py-1 text-xs border border-blue-300 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-50" disabled={isBusy} title="Reassign owner or share with other users">Assign</button>
                      {!['terminated', 'terminating'].includes(workstation.status) && (
                        <button onClick={() => onTerminate(workstation)} className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50" disabled={isBusy} title="Permanently destroy the instance and all data on it">
                          {isTerminatePending ? 'Terminating…' : 'Terminate'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
