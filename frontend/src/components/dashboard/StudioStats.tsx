interface StudioStatsProps {
  total: number
  running: number
  monthlyCost: number
  projectedMonthly: number
}

export default function StudioStats({ total, running, monthlyCost, projectedMonthly }: StudioStatsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="Studio summary">
      <Metric value={total} label="Total workstations" />
      <Metric value={running} label="Live sessions" accent />
      <Metric value={`$${monthlyCost.toFixed(0)}`} label="Cost this month" detail={projectedMonthly > 0 ? `projected $${projectedMonthly.toFixed(0)}` : undefined} />
    </div>
  )
}

function Metric({ value, label, detail, accent = false }: { value: string | number; label: string; detail?: string; accent?: boolean }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className={`text-2xl font-bold ${accent ? 'text-green-600' : 'text-gray-900'}`}>{value}</div>
      <div className="mt-1 text-xs text-gray-500">{label}{detail && <span className="text-gray-400"> · {detail}</span>}</div>
    </div>
  )
}
