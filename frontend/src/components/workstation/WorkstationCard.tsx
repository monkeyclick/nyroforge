import { useState } from 'react'
import { Workstation } from '@/types'
import WorkstationActions from './WorkstationActions'
import WorkstationStatusBadge from './WorkstationStatusBadge'

type PowerAction = 'start' | 'stop' | 'reboot'

interface WorkstationCardProps {
  workstation: Workstation
  canShare: boolean
  isEditingName: boolean
  editingNameValue: string
  isSavingName: boolean
  isExtending: boolean
  pendingPowerAction: PowerAction | null
  isTerminatePending: boolean
  onEditingNameChange: (value: string) => void
  onStartEditName: () => void
  onSaveName: () => void
  onCancelEditName: () => void
  onExtend: (hours: number) => void
  onSoftware: () => void
  onShare: () => void
  onRemoteDesktop: () => void
  onConnect: () => void
  onPower: (action: PowerAction) => void
  onTerminate: () => void
}

function formatTimeLeft(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export default function WorkstationCard(props: WorkstationCardProps) {
  const { workstation: ws } = props
  const [renderedAt] = useState(() => Date.now())
  const msLeft = ws.autoTerminateAt ? new Date(ws.autoTerminateAt).getTime() - renderedAt : null

  return (
    <article className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            {props.isEditingName ? (
              <div className="flex items-center gap-2">
                <input type="text" value={props.editingNameValue} onChange={(event) => props.onEditingNameChange(event.target.value)} className="px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Enter instance name" autoFocus onKeyDown={(event) => { if (event.key === 'Enter') props.onSaveName(); if (event.key === 'Escape') props.onCancelEditName() }} />
                <button onClick={props.onSaveName} disabled={props.isSavingName} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">{props.isSavingName ? '...' : 'Save'}</button>
                <button onClick={props.onCancelEditName} className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
              </div>
            ) : (
              <>
                <h3 className="font-medium text-gray-900">{ws.friendlyName || ws.instanceId}</h3>
                <button onClick={props.onStartEditName} className="text-gray-400 hover:text-gray-600" title="Edit name" aria-label={`Edit name for ${ws.friendlyName || ws.instanceId}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
                <WorkstationStatusBadge status={ws.status} />
              </>
            )}
          </div>

          {ws.friendlyName && !props.isEditingName && <div className="text-xs text-gray-400 mb-2 font-mono">{ws.instanceId}</div>}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div className="text-gray-500">Type: <span className="text-gray-900">{ws.instanceType}</span></div>
            <div className="text-gray-500">Region: <span className="text-gray-900">{ws.region}</span></div>
            {ws.publicIp && <div className="text-gray-500">IP: <span className="text-gray-900 font-mono text-xs">{ws.publicIp}</span></div>}
          </div>

          {msLeft !== null && !['terminated', 'terminating'].includes(ws.status) && (
            <div className={`mt-2 flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-xs ${msLeft < 3600000 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="font-medium">Auto-terminates {msLeft <= 0 ? 'imminently' : `in ${formatTimeLeft(msLeft)}`}</span>
              <span className="ml-auto flex items-center gap-1"><span className="hidden sm:inline">Extend:</span>{[1, 8, 24].map(hours => <button key={hours} onClick={() => props.onExtend(hours)} disabled={props.isExtending} className="px-1.5 py-0.5 rounded border border-current hover:bg-white disabled:opacity-50" title={`Extend auto-termination by ${hours} hour${hours > 1 ? 's' : ''}`}>+{hours}h</button>)}</span>
            </div>
          )}

          {(ws.ownerName || ws.ownerGroups?.length || ws.assignedUsers?.length) && (
            <div className="mt-2 pt-2 border-t border-gray-100"><div className="flex flex-wrap items-center gap-4 text-xs">
              {ws.ownerName && <div className="flex items-center gap-1 text-gray-500"><span aria-hidden="true">●</span><span>{ws.ownerName}</span></div>}
              {!!ws.ownerGroups?.length && <div className="flex items-center gap-1 text-gray-500"><span aria-hidden="true">◆</span><span className="flex flex-wrap gap-1">{ws.ownerGroups.map(group => <span key={group} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{group}</span>)}</span></div>}
              {!!ws.assignedUsers?.length && <div className="flex items-center gap-1 text-blue-600" title={`Shared with: ${ws.assignedUsers.join(', ')}`}><span aria-hidden="true">↗</span><span>Shared with {ws.assignedUsers.length} user{ws.assignedUsers.length > 1 ? 's' : ''}</span></div>}
            </div></div>
          )}
        </div>
        <WorkstationActions workstation={ws} canShare={props.canShare} pendingPowerAction={props.pendingPowerAction} isTerminatePending={props.isTerminatePending} onSoftware={props.onSoftware} onShare={props.onShare} onRemoteDesktop={props.onRemoteDesktop} onConnect={props.onConnect} onPower={props.onPower} onTerminate={props.onTerminate} />
      </div>
    </article>
  )
}
