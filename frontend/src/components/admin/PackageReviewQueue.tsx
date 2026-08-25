import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../services/api'
import { formatBytes } from './PackageUploadWizard'

/**
 * Admin review of uploaded installers.
 *
 * Nothing an end user uploads can be installed anywhere until it is approved
 * here — approval is what promotes the object out of the quarantine prefix,
 * which is the only prefix workstations cannot read. The admin approves a
 * specific command line, not merely a binary, so the command and arguments are
 * editable right up to the moment of approval.
 */

const ALLOWED_COMMANDS = ['{installer}', 'msiexec.exe', 'powershell.exe', 'cmd.exe']

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  uploading: { label: 'Uploading', className: 'bg-gray-100 text-gray-700' },
  analyzing: { label: 'Analyzing', className: 'bg-blue-100 text-blue-800' },
  needs_review: { label: 'Needs review', className: 'bg-amber-100 text-amber-800' },
  analysis_failed: { label: 'Analysis failed', className: 'bg-red-100 text-red-800' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rejected', className: 'bg-gray-200 text-gray-600' },
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-red-100 text-red-800',
}

interface ReviewCardProps {
  pkg: any
  workstations: Array<{ workstationId: string; name?: string; instanceId?: string; status?: string }>
  onDone: () => void
}

const ReviewCard: React.FC<ReviewCardProps> = ({ pkg, workstations, onDone }) => {
  const analysis = pkg.analysis
  const [installCommand, setInstallCommand] = useState<string>(
    pkg.installCommand || analysis?.suggestedInstallCommand || '{installer}'
  )
  const [installArgs, setInstallArgs] = useState<string>(
    pkg.installArgs ?? analysis?.suggestedInstallArgs ?? ''
  )
  const [reviewNotes, setReviewNotes] = useState('')
  const [verifyWorkstation, setVerifyWorkstation] = useState('')
  const [error, setError] = useState<string | null>(null)

  const edited =
    installCommand !== (analysis?.suggestedInstallCommand ?? pkg.installCommand) ||
    installArgs !== (analysis?.suggestedInstallArgs ?? pkg.installArgs ?? '')

  const review = useMutation({
    mutationFn: (input: {
      action: 'approve' | 'reject' | 'verify' | 'reanalyze'
      workstationId?: string
    }) =>
      apiClient.reviewBootstrapPackage(pkg.packageId, {
        ...input,
        installCommand,
        installArgs,
        reviewNotes,
      }),
    onSuccess: () => {
      setError(null)
      onDone()
    },
    onError: (err: Error) => setError(err.message),
  })

  const verification = pkg.verification
  const commandAllowed = ALLOWED_COMMANDS.includes(installCommand.trim().toLowerCase())

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{pkg.name}</h3>
          <p className="mt-0.5 text-sm text-gray-600">
            {pkg.fileName} · {formatBytes(Number(pkg.fileSizeBytes || 0))} · uploaded by{' '}
            {pkg.uploadedBy || 'unknown'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              STATUS_BADGES[pkg.status]?.className || 'bg-gray-100 text-gray-700'
            }`}
          >
            {STATUS_BADGES[pkg.status]?.label || pkg.status}
          </span>
          {analysis?.confidence && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                CONFIDENCE_STYLES[analysis.confidence]
              }`}
            >
              {analysis.confidence} confidence
            </span>
          )}
        </div>
      </div>

      {/* What was detected */}
      {analysis && (
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium text-gray-500">Installer type</dt>
            <dd className="text-gray-900">{analysis.installerType}</dd>
          </div>
          {analysis.detectedVendor && (
            <div>
              <dt className="text-xs font-medium text-gray-500">Vendor</dt>
              <dd className="text-gray-900">{analysis.detectedVendor}</dd>
            </div>
          )}
          {analysis.detectedVersion && (
            <div>
              <dt className="text-xs font-medium text-gray-500">Version</dt>
              <dd className="text-gray-900">{analysis.detectedVersion}</dd>
            </div>
          )}
          {analysis.recipeId && (
            <div>
              <dt className="text-xs font-medium text-gray-500">Recipe</dt>
              <dd className="font-mono text-xs text-gray-900">{analysis.recipeId}</dd>
            </div>
          )}
        </dl>
      )}

      <div>
        <p className="text-xs font-medium text-gray-500">SHA-256 (computed server-side)</p>
        <p className="break-all font-mono text-xs text-gray-700">{pkg.expectedSha256 || '—'}</p>
      </div>

      {analysis?.warnings?.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {analysis.warnings.map((warning: string, i: number) => (
            <li key={i}>• {warning}</li>
          ))}
        </ul>
      )}

      {/* The command that will run as SYSTEM */}
      <div className="space-y-3 rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-900">Command that will run as SYSTEM</p>
          {!edited && analysis && (
            <span className="text-xs text-blue-700">auto-generated — edit before approving</span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Install command</label>
            <select
              value={ALLOWED_COMMANDS.includes(installCommand) ? installCommand : ''}
              onChange={(e) => setInstallCommand(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
            >
              {!ALLOWED_COMMANDS.includes(installCommand) && (
                <option value="">{installCommand || 'Select…'}</option>
              )}
              {ALLOWED_COMMANDS.map((command) => (
                <option key={command} value={command}>
                  {command}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-700">Arguments</label>
            <textarea
              rows={3}
              value={installArgs}
              onChange={(e) => setInstallArgs(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
            />
          </div>
        </div>

        {!commandAllowed && (
          <p className="text-xs text-red-700">
            The install command must be one of {ALLOWED_COMMANDS.join(', ')}. Anything else is
            refused server-side.
          </p>
        )}
      </div>

      {/* Trial install */}
      <div className="space-y-2 rounded-lg border border-gray-200 p-4">
        <p className="text-sm font-medium text-gray-900">Trial install (optional)</p>
        <p className="text-xs text-gray-600">
          Runs this exact command on one workstation and reports the exit code. Worth doing
          whenever confidence is not high — silent-install switches are only ever a guess until
          something runs them.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={verifyWorkstation}
            onChange={(e) => setVerifyWorkstation(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Choose a workstation…</option>
            {workstations.map((ws) => (
              <option key={ws.workstationId} value={ws.workstationId}>
                {ws.name || ws.instanceId || ws.workstationId}
              </option>
            ))}
          </select>
          <button
            disabled={!verifyWorkstation || review.isPending}
            onClick={() => review.mutate({ action: 'verify', workstationId: verifyWorkstation })}
            className="rounded-lg border border-blue-300 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            Run trial install
          </button>
        </div>

        {verification && (
          <div
            className={`rounded-lg p-3 text-xs ${
              verification.status === 'passed'
                ? 'bg-green-50 text-green-900'
                : verification.status === 'failed'
                  ? 'bg-red-50 text-red-900'
                  : 'bg-blue-50 text-blue-900'
            }`}
          >
            <p className="font-medium">
              Trial install on {verification.workstationId}: {verification.status}
            </p>
            {verification.exitCodeMessage && (
              <p className="mt-1 break-all font-mono">{verification.exitCodeMessage}</p>
            )}
            {verification.status === 'running' && (
              <p className="mt-1">
                The installer service polls every 30 seconds; this page refreshes automatically.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Notes + decision */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">Review notes</label>
        <input
          type="text"
          value={reviewNotes}
          onChange={(e) => setReviewNotes(e.target.value)}
          placeholder="Optional — recorded against the package"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {!pkg.expectedSha256 && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          No verified SHA-256 yet, so this package cannot be approved. Re-run analysis to compute
          one — the installer service refuses to execute an artifact it cannot verify.
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-3 border-t pt-4">
        {pkg.status === 'analysis_failed' && (
          <button
            disabled={review.isPending}
            onClick={() => review.mutate({ action: 'reanalyze' })}
            className="mr-auto rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Re-run analysis
          </button>
        )}
        <button
          disabled={review.isPending}
          onClick={() => review.mutate({ action: 'reject' })}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Reject and delete
        </button>
        <button
          disabled={review.isPending || !commandAllowed || !pkg.expectedSha256}
          title={!pkg.expectedSha256 ? 'No verified hash yet' : undefined}
          onClick={() => review.mutate({ action: 'approve' })}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
        >
          {review.isPending ? 'Working…' : 'Approve'}
        </button>
      </div>
    </div>
  )
}

export const PackageReviewQueue: React.FC = () => {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-bootstrap-packages'],
    queryFn: () => apiClient.getAdminBootstrapPackages(),
    // A trial install reports back through the package queue, so keep polling
    // while anything is mid-flight.
    refetchInterval: 15000,
  })

  const { data: workstationData } = useQuery({
    queryKey: ['admin-workstations-for-verify'],
    queryFn: () => apiClient.getWorkstations(),
  })

  const pending = useMemo(() => {
    const packages = (data?.packages || []) as any[]
    return packages.filter(
      (pkg) =>
        pkg.status === 'needs_review' ||
        pkg.status === 'analysis_failed' ||
        pkg.status === 'analyzing' ||
        pkg.status === 'uploading'
    )
  }, [data])

  const workstations = useMemo(() => {
    const list = (workstationData as any)?.workstations || workstationData || []
    return (Array.isArray(list) ? list : []).filter(
      (ws: any) => ws.status === 'running' || ws.state === 'running'
    )
  }, [workstationData])

  const refresh = (): void => {
    queryClient.invalidateQueries({ queryKey: ['admin-bootstrap-packages'] })
  }

  if (isLoading) {
    return <p className="text-sm text-gray-600">Loading review queue…</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Package review</h2>
        <p className="mt-1 text-sm text-gray-600">
          Uploaded installers waiting on approval. Until a package is approved its binary stays in
          the quarantine prefix, which no workstation can read.
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">Nothing waiting for review.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.map((pkg) =>
            pkg.status === 'uploading' || pkg.status === 'analyzing' ? (
              <div
                key={pkg.packageId}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4"
              >
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{pkg.name}</p>
                  <p className="text-xs text-gray-600">
                    {pkg.status === 'uploading' ? 'Upload in progress' : 'Hashing and identifying'} ·{' '}
                    {pkg.uploadedBy}
                  </p>
                </div>
              </div>
            ) : (
              <ReviewCard
                key={pkg.packageId}
                pkg={pkg}
                workstations={workstations}
                onDone={refresh}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}

export default PackageReviewQueue
