export const ADMIN_TABS = ['workstations', 'instance-scope', 'instance-families', 'costs', 'user-management', 'security', 'storage', 'analytics', 'settings', 'bootstrap', 'package-review'] as const
export type AdminTab = typeof ADMIN_TABS[number]

const LABELS: Record<AdminTab, string> = {
  workstations: 'Workstations',
  'instance-scope': 'Instance scope',
  'instance-families': 'Instance catalog',
  costs: 'Costs',
  'user-management': 'People & teams',
  security: 'Security',
  storage: 'Storage',
  analytics: 'Usage analytics',
  settings: 'Settings',
  bootstrap: 'Software packages',
  'package-review': 'Package review',
}

interface AdminNavigationProps {
  activeTab: AdminTab
  onChange: (tab: AdminTab) => void
  /**
   * Counts to surface beside a section, e.g. packages waiting on review.
   * Without this an admin has no way to know work is queued short of opening
   * the tab and looking.
   */
  badges?: Partial<Record<AdminTab, number>>
}

export default function AdminNavigation({ activeTab, onChange, badges }: AdminNavigationProps) {
  return (
    <aside className="lg:col-span-2" aria-label="Operations navigation">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h2 className="eyebrow mb-3">Operations</h2>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
          {ADMIN_TABS.map(tab => {
            const badge = badges?.[tab] ?? 0
            return (
              <button key={tab} onClick={() => onChange(tab)} aria-current={activeTab === tab ? 'page' : undefined}
                className={`flex w-full items-center justify-between gap-2 text-left px-3 py-2 text-sm rounded ${activeTab === tab ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
                <span>{LABELS[tab]}</span>
                {badge > 0 && (
                  <span
                    className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white"
                    aria-label={`${badge} awaiting attention`}
                  >
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
