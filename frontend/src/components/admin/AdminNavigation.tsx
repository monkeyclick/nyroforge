export const ADMIN_TABS = ['workstations', 'instance-scope', 'instance-families', 'costs', 'user-management', 'security', 'storage', 'analytics', 'settings', 'bootstrap'] as const
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
}

interface AdminNavigationProps {
  activeTab: AdminTab
  onChange: (tab: AdminTab) => void
}

export default function AdminNavigation({ activeTab, onChange }: AdminNavigationProps) {
  return (
    <aside className="lg:col-span-2" aria-label="Operations navigation">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h2 className="eyebrow mb-3">Operations</h2>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
          {ADMIN_TABS.map(tab => (
            <button key={tab} onClick={() => onChange(tab)} aria-current={activeTab === tab ? 'page' : undefined}
              className={`w-full text-left px-3 py-2 text-sm rounded ${activeTab === tab ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
              {LABELS[tab]}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
