import { KeyboardEvent, useEffect, useId, useRef } from 'react'

export type ActivityStatus = 'queued' | 'in_progress' | 'succeeded' | 'failed'

export interface ActivityItem {
  id: string
  title: string
  description?: string
  status: ActivityStatus
  createdAt: string | Date
  progress?: number
  resourceName?: string
  errorMessage?: string
}

export interface ActivityCenterProps {
  isOpen: boolean
  activities: ActivityItem[]
  onClose: () => void
  onRetry?: (activity: ActivityItem) => void
  onDismiss?: (activity: ActivityItem) => void
  onClearCompleted?: () => void
  title?: string
}

const statusPresentation: Record<ActivityStatus, { label: string; dot: string; badge: string }> = {
  queued: { label: 'Queued', dot: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700' },
  in_progress: { label: 'In progress', dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700' },
  succeeded: { label: 'Completed', dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'Needs attention', dot: 'bg-red-500', badge: 'bg-red-50 text-red-700' },
}

function formatTimestamp(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time unavailable'
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

function toDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function ActivityRow({ activity, onRetry, onDismiss }: {
  activity: ActivityItem
  onRetry?: ActivityCenterProps['onRetry']
  onDismiss?: ActivityCenterProps['onDismiss']
}) {
  const presentation = statusPresentation[activity.status]
  const progress = Math.min(100, Math.max(0, activity.progress ?? 0))

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${presentation.dot} ${activity.status === 'in_progress' ? 'animate-pulse' : ''}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-950">{activity.title}</h3>
              {activity.resourceName && <p className="mt-0.5 truncate text-xs text-gray-500">{activity.resourceName}</p>}
            </div>
            <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${presentation.badge}`}>
              {presentation.label}
            </span>
          </div>
          {activity.description && <p className="mt-2 text-sm leading-5 text-gray-600">{activity.description}</p>}
          {activity.status === 'in_progress' && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-gray-500"><span>Progress</span><span>{progress}%</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-label={`${activity.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          {activity.errorMessage && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{activity.errorMessage}</p>}
          <div className="mt-3 flex items-center justify-between gap-3">
            <time className="text-xs text-gray-400" dateTime={toDateTime(activity.createdAt)}>{formatTimestamp(activity.createdAt)}</time>
            <div className="flex gap-2">
              {activity.status === 'failed' && onRetry && <button type="button" onClick={() => onRetry(activity)} className="rounded-lg bg-gray-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800">Retry</button>}
              {(activity.status === 'failed' || activity.status === 'succeeded') && onDismiss && <button type="button" onClick={() => onDismiss(activity)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">Dismiss</button>}
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}

export default function ActivityCenter({ isOpen, activities, onClose, onRetry, onDismiss, onClearCompleted, title = 'Activity center' }: ActivityCenterProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const priorFocusRef = useRef<HTMLElement | null>(null)
  const activeCount = activities.filter((activity) => activity.status === 'queued' || activity.status === 'in_progress').length
  const completedCount = activities.filter((activity) => activity.status === 'succeeded').length

  useEffect(() => {
    if (!isOpen) return
    priorFocusRef.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => priorFocusRef.current?.focus()
  }, [isOpen])

  if (!isOpen) return null

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !panelRef.current) return
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown} className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-white/10 bg-gray-50 shadow-2xl">
        <header className="border-b border-gray-200 bg-white px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Studio operations</p><h2 id={titleId} className="mt-1 text-xl font-bold text-gray-950">{title}</h2><p className="mt-1 text-sm text-gray-500">{activeCount ? `${activeCount} operation${activeCount === 1 ? '' : 's'} underway` : 'Your studio is up to date'}</p></div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close activity center" className="rounded-full border border-gray-200 p-2 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500"><svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" /></svg></button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="sr-only" aria-live="polite">{activeCount} active operations. {completedCount} completed operations.</div>
          {activities.length ? <ul className="space-y-3" aria-label="Recent activity">{activities.map((activity) => <ActivityRow key={activity.id} activity={activity} onRetry={onRetry} onDismiss={onDismiss} />)}</ul> : <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white px-8 text-center"><span className="mb-4 rounded-full bg-violet-50 p-4 text-2xl" aria-hidden="true">✦</span><h3 className="font-semibold text-gray-900">Nothing in the queue</h3><p className="mt-2 text-sm leading-5 text-gray-500">Launches, software installs, and workstation changes will appear here.</p></div>}
        </div>
        {completedCount > 0 && onClearCompleted && <footer className="border-t border-gray-200 bg-white px-5 py-4"><button type="button" onClick={onClearCompleted} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">Clear completed</button></footer>}
      </aside>
    </div>
  )
}
