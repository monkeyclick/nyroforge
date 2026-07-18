import { Workstation } from '@/types'

type PowerAction = 'start' | 'stop' | 'reboot'

interface WorkstationActionsProps {
  workstation: Workstation
  canShare: boolean
  pendingPowerAction: PowerAction | null
  isTerminatePending: boolean
  onSoftware: () => void
  onShare: () => void
  onRemoteDesktop: () => void
  onConnect: () => void
  onPower: (action: PowerAction) => void
  onTerminate: () => void
}

export default function WorkstationActions({ workstation, canShare, pendingPowerAction, isTerminatePending, onSoftware, onShare, onRemoteDesktop, onConnect, onPower, onTerminate }: WorkstationActionsProps) {
  const unavailable = ['terminated', 'terminating'].includes(workstation.status)
  const isBusy = Boolean(pendingPowerAction) || isTerminatePending

  return (
    <div className="flex flex-wrap gap-2 justify-end" aria-label={`Actions for ${workstation.friendlyName || workstation.instanceId}`}>
      {!unavailable && <SecondaryAction onClick={onSoftware} title="View software installation progress">Software</SecondaryAction>}
      {!unavailable && canShare && <SecondaryAction onClick={onShare} title="Share this workstation with other users">Collaborators</SecondaryAction>}
      {workstation.status === 'running' && (
        <>
          <SecondaryAction onClick={onRemoteDesktop} title="Connect via remote desktop">Remote desktop</SecondaryAction>
          <button onClick={onConnect} className="px-3 py-1.5 text-xs border border-blue-300 bg-blue-50 text-blue-700 rounded hover:bg-blue-100" title="Connect via Amazon DCV with low-latency QUIC">Connect</button>
          <SecondaryAction onClick={() => onPower('reboot')} disabled={isBusy} title="Reboot the workstation">{pendingPowerAction === 'reboot' ? 'Rebooting…' : '↻ Reboot'}</SecondaryAction>
          <button onClick={() => onPower('stop')} disabled={isBusy} className="px-3 py-1.5 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50" title="Shut down the workstation; it can be started later">{pendingPowerAction === 'stop' ? 'Stopping…' : '⏸ Stop'}</button>
        </>
      )}
      {workstation.status === 'stopped' && (
        <button onClick={() => onPower('start')} disabled={isBusy} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50" title="Start the workstation">{pendingPowerAction === 'start' ? 'Starting…' : '▶ Start'}</button>
      )}
      {!unavailable && (
        <button onClick={onTerminate} disabled={isBusy} className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50" title="Permanently destroy the workstation and all its data">{isTerminatePending ? 'Terminating…' : 'Terminate'}</button>
      )}
    </div>
  )
}

function SecondaryAction({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50">{children}</button>
}
