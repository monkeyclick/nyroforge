import { EnhancedUser } from '@/types/auth'

interface DashboardInsightsProps {
  user: EnhancedUser
  isAdmin: boolean
  runningCount: number
  stoppedCount: number
  totalCount: number
  monthlyCost: number
  dailyAverage: number
  projectedMonthly: number
  costSuggestions: string[]
  onEditProfile: () => void
  onOpenAdmin: () => void
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {children}
    </section>
  )
}

export default function DashboardInsights({
  user,
  isAdmin,
  runningCount,
  stoppedCount,
  totalCount,
  monthlyCost,
  dailyAverage,
  projectedMonthly,
  costSuggestions,
  onEditProfile,
  onOpenAdmin,
}: DashboardInsightsProps) {
  const hasCostInsights = dailyAverage > 0 || costSuggestions.length > 0

  return (
    <aside className="space-y-4 lg:col-span-3" aria-label="Studio insights">
      <Panel>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">USER INFO</h2>
          <button onClick={onEditProfile} className="text-xs text-blue-600 hover:text-blue-700">
            Edit Profile
          </button>
        </div>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-gray-500">Name</dt>
            <dd className="font-medium text-gray-900">{user.name || 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Email</dt>
            <dd className="break-words font-medium text-gray-900">{user.email}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Role</dt>
            <dd className="font-medium text-gray-900">
              {user.roleIds?.includes('admin') ? 'Administrator' : 'User'}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">QUICK STATS</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Running</dt>
            <dd className="font-semibold text-green-600">{runningCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Stopped</dt>
            <dd className="font-semibold text-gray-600">{stoppedCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Total</dt>
            <dd className="font-semibold text-gray-900">{totalCount}</dd>
          </div>
          <div className="border-t border-gray-200 pt-2">
            <div className="flex justify-between">
              <dt className="text-gray-500">Monthly Cost</dt>
              <dd className="font-semibold text-gray-900">${monthlyCost.toFixed(2)}</dd>
            </div>
          </div>
        </dl>
      </Panel>

      {hasCostInsights && (
        <Panel>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">COST INSIGHTS</h2>
          <dl className="mb-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Daily average</dt>
              <dd className="font-medium text-gray-900">${dailyAverage.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Projected month</dt>
              <dd className="font-medium text-gray-900">${projectedMonthly.toFixed(2)}</dd>
            </div>
          </dl>
          {costSuggestions.length > 0 && (
            <ul className="space-y-2 border-t border-gray-100 pt-3">
              {costSuggestions.slice(0, 4).map((suggestion, index) => (
                <li key={`${suggestion}-${index}`} className="flex gap-2 text-xs text-gray-600">
                  <span aria-hidden="true">💡</span>
                  <span>{suggestion}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {isAdmin && (
        <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-blue-900">ADMIN ACCESS</h2>
          <p className="mb-3 text-xs text-blue-700">You have administrator privileges</p>
          <button
            onClick={onOpenAdmin}
            className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Open Admin Panel
          </button>
        </section>
      )}
    </aside>
  )
}
