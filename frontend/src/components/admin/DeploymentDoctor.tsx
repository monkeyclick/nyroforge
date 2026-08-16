import { useQuery } from '@tanstack/react-query'
import { apiClient, DeploymentDoctorCheck, DeploymentDoctorStatus } from '@/services/api'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import InlineNotice from '@/components/ui/InlineNotice'

interface DeploymentDoctorProps {
  onContinue: () => void
}

export interface DeploymentDoctorCounts {
  pass: number
  warning: number
  fail: number
  skipped: number
  total: number
}

const STATUS_DETAILS: Record<DeploymentDoctorStatus, {
  label: string
  symbol: string
  badge: 'success' | 'warning' | 'danger' | 'muted'
  border: string
}> = {
  pass: {
    label: 'Pass',
    symbol: '✓',
    badge: 'success',
    border: 'border-success/35',
  },
  warning: {
    label: 'Warning',
    symbol: '!',
    badge: 'warning',
    border: 'border-warning/40',
  },
  fail: {
    label: 'Fail',
    symbol: '×',
    badge: 'danger',
    border: 'border-destructive/40',
  },
  skipped: {
    label: 'Skipped',
    symbol: '–',
    badge: 'muted',
    border: 'border-border',
  },
}

export function countDeploymentDoctorStatuses(checks: DeploymentDoctorCheck[]): DeploymentDoctorCounts {
  return checks.reduce<DeploymentDoctorCounts>((counts, check) => {
    counts[check.status] += 1
    counts.total += 1
    return counts
  }, { pass: 0, warning: 0, fail: 0, skipped: 0, total: 0 })
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function CheckCard({ check }: { check: DeploymentDoctorCheck }) {
  const details = STATUS_DETAILS[check.status]

  return (
    <li className={`rounded-xl border bg-card p-4 ${details.border}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current font-black"
        >
          {details.symbol}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="section-label">{check.category}</p>
              <h3 className="mt-1 font-bold text-foreground">{check.title}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={details.badge}>{details.label}</Badge>
              {check.required && <Badge variant="default">Required</Badge>}
            </div>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{check.message}</p>
          {check.remediation && (
            <div className="mt-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
              <span className="font-bold text-foreground">Recommended action: </span>
              <span className="text-muted-foreground">{check.remediation}</span>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export default function DeploymentDoctor({ onContinue }: DeploymentDoctorProps) {
  const {
    data: report,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['admin-deployment-doctor'],
    queryFn: () => apiClient.getDeploymentDoctorReport(),
    retry: 1,
  })

  if (isLoading) {
    return (
      <Card className="p-6" role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-r-transparent" aria-hidden="true" />
          <div>
            <h2 className="font-bold text-foreground">Running deployment checks</h2>
            <p className="mt-1 text-sm text-muted-foreground">Reading the deployed environment. No AWS resources are changed.</p>
          </div>
        </div>
      </Card>
    )
  }

  if (error || !report) {
    return (
      <Card className="space-y-4 p-6">
        <InlineNotice tone="danger" title="Deployment checks could not be loaded" className="mb-0">
          <p role="alert">{error instanceof Error ? error.message : 'The admin API returned no deployment report.'}</p>
        </InlineNotice>
        <Button type="button" variant="primary" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? 'Trying again…' : 'Try again'}
        </Button>
      </Card>
    )
  }

  const counts = countDeploymentDoctorStatuses(report.checks)
  const passPercent = counts.total === 0 ? 0 : Math.round((counts.pass / counts.total) * 100)
  const hasFailures = counts.fail > 0

  return (
    <section className="space-y-5" aria-labelledby="deployment-doctor-title">
      <Card className="overflow-hidden" padded={false}>
        <div className="border-b border-border bg-gradient-to-r from-primary/12 to-accent/10 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="section-label">First-run guide</p>
              <h2 id="deployment-doctor-title" className="mt-1 text-2xl font-black text-foreground">Setup &amp; Health</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Review read-only checks of this NyroForge deployment, then use the recommended actions to resolve warnings or failures.
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? 'Running checks…' : 'Rerun checks'}
            </Button>
          </div>
        </div>

        <div className="space-y-5 p-6" aria-busy={isFetching}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={`${counts.pass} passed, ${counts.warning} warnings, ${counts.fail} failed, ${counts.skipped} skipped`}>
            {(['pass', 'warning', 'fail', 'skipped'] as const).map((status) => (
              <div key={status} className="rounded-xl border border-border bg-muted/35 p-3">
                <p className="text-2xl font-black text-foreground">{counts[status]}</p>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{STATUS_DETAILS[status].label}</p>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-bold text-foreground">{counts.pass} of {counts.total} checks passed</span>
              <span className="text-muted-foreground">{passPercent}% passing</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Deployment checks passing"
              aria-valuemin={0}
              aria-valuemax={counts.total}
              aria-valuenow={counts.pass}
            >
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${passPercent}%` }} />
            </div>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span>Region: <strong className="text-foreground">{report.region}</strong></span>
            <span>Checked: <strong className="text-foreground">{formatGeneratedAt(report.generatedAt)}</strong></span>
          </div>

          {hasFailures ? (
            <InlineNotice tone="danger" title="Required attention">
              One or more checks failed. Review each failed card and follow its recommended action before relying on the deployment.
            </InlineNotice>
          ) : counts.warning > 0 ? (
            <InlineNotice tone="warning" title="Deployment is usable with warnings">
              No checks failed, but review the warnings to understand optional or incomplete configuration.
            </InlineNotice>
          ) : (
            <InlineNotice tone="success" title="Checks passed">
              The deployment doctor found no failures or warnings in this report.
            </InlineNotice>
          )}
        </div>
      </Card>

      {counts.total === 0 ? (
        <InlineNotice tone="warning" title="No checks were returned">
          Rerun the checks. If the report remains empty, inspect the deployment-doctor service logs and API configuration.
        </InlineNotice>
      ) : (
        <ul className="space-y-3" aria-label="Deployment check results">
          {report.checks.map((check) => <CheckCard key={check.id} check={check} />)}
        </ul>
      )}

      <Card className="flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
        <div>
          <h3 className="font-bold text-foreground">Ready to leave setup?</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Continuing only saves a preference in this browser so future admin visits open the main admin view. It does not configure AWS or change the deployment.
          </p>
        </div>
        <Button type="button" variant="primary" onClick={onContinue} className="shrink-0">
          Continue to dashboard
        </Button>
      </Card>
    </section>
  )
}
