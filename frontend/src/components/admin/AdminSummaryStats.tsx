export interface AdminSystemSummary {
  totalInstances: number
  runningInstances: number
  stoppedInstances: number
  totalHourlyCost: number
  estimatedMonthlyCost: number
}

interface AdminSummaryStatsProps {
  summary: AdminSystemSummary
}

export default function AdminSummaryStats({ summary }: AdminSummaryStatsProps) {
  const stats = [
    { label: 'Total', value: summary.totalInstances, valueClassName: 'text-gray-900' },
    { label: 'Running', value: summary.runningInstances, valueClassName: 'text-green-600' },
    { label: 'Stopped', value: summary.stoppedInstances, valueClassName: 'text-gray-600' },
    { label: 'Monthly', value: `$${summary.estimatedMonthlyCost.toFixed(0)}`, valueClassName: 'text-gray-900' },
  ]

  return (
    <section className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label="System summary">
      {stats.map(stat => (
        <div key={stat.label} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className={`text-2xl font-bold ${stat.valueClassName}`}>{stat.value}</div>
          <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
        </div>
      ))}
    </section>
  )
}
