interface WorkstationStatusBadgeProps {
  status: string
}

export default function WorkstationStatusBadge({ status }: WorkstationStatusBadgeProps) {
  const className = status === 'running'
    ? 'bg-green-100 text-green-700'
    : status === 'stopped'
      ? 'bg-gray-100 text-gray-700'
      : ['stopping', 'shutting-down', 'terminating'].includes(status)
        ? 'bg-orange-100 text-orange-700'
        : 'bg-yellow-100 text-yellow-700'

  return <span className={`px-2 py-0.5 text-xs font-medium rounded ${className}`}>{status}</span>
}
