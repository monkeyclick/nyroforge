import type { AdminSystemSummary } from './AdminSummaryStats'

interface AdminSystemInfoProps {
  summary: AdminSystemSummary
}

export default function AdminSystemInfo({ summary }: AdminSystemInfoProps) {
  return (
    <aside className="space-y-4 lg:col-span-3" aria-label="System information">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">SYSTEM STATUS</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Total Instances</dt>
            <dd className="font-semibold text-gray-900">{summary.totalInstances}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Running</dt>
            <dd className="font-semibold text-green-600">{summary.runningInstances}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Stopped</dt>
            <dd className="font-semibold text-gray-600">{summary.stoppedInstances}</dd>
          </div>
          <div className="pt-2 border-t border-gray-200 mt-2 space-y-1">
            <div className="flex justify-between">
              <dt className="text-gray-500">Hourly Cost</dt>
              <dd className="font-semibold text-gray-900">${summary.totalHourlyCost.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Monthly Est.</dt>
              <dd className="font-semibold text-gray-900">${summary.estimatedMonthlyCost.toFixed(0)}</dd>
            </div>
          </div>
        </dl>
      </div>

      <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
        <h2 className="text-sm font-semibold text-blue-900 mb-2">ADMIN PRIVILEGES</h2>
        <p className="text-xs text-blue-700">
          You have full system access. All workstations and users are visible.
        </p>
      </div>
    </aside>
  )
}
