const STATUSES = ['all', 'running', 'stopped', 'launching', 'stopping', 'terminating']

interface StudioFiltersProps {
  activeStatus: string
  onStatusChange: (status: string) => void
  onLaunch: () => void
  onRefresh: () => void
}

export default function StudioFilters({ activeStatus, onStatusChange, onLaunch, onRefresh }: StudioFiltersProps) {
  return (
    <aside className="space-y-4 lg:col-span-2" aria-label="Studio controls">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h2 className="eyebrow mb-3">Create</h2>
        <div className="space-y-2">
          <button onClick={onLaunch} className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700">+ New workstation</button>
          <button onClick={onRefresh} className="w-full px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50">Refresh</button>
        </div>
      </div>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h2 className="eyebrow mb-3">Workspace</h2>
        <div className="space-y-1">
          {STATUSES.map(status => (
            <button key={status} onClick={() => onStatusChange(status)} aria-pressed={activeStatus === status}
              className={`w-full text-left px-3 py-2 text-sm rounded ${activeStatus === status ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
