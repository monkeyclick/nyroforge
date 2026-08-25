import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../services/api'
import { useMultipartUpload, ResumeRecord } from '../../hooks/useMultipartUpload'

interface PackageUploadWizardProps {
  onClose: () => void
  onUploaded: (packageId: string) => void
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-green-100 text-green-800 border-green-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-red-100 text-red-800 border-red-200',
}

const INSTALLER_TYPE_LABELS: Record<string, string> = {
  msi: 'Windows Installer (MSI)',
  inno: 'Inno Setup',
  nsis: 'NSIS',
  installshield: 'InstallShield',
  'wix-burn': 'WiX bundle',
  msix: 'MSIX / AppX',
  'sfx-7z': '7-Zip self-extractor',
  squirrel: 'Squirrel',
  zip: 'ZIP archive',
  unknown: 'Unrecognised',
}

export const PackageUploadWizard: React.FC<PackageUploadWizardProps> = ({ onClose, onUploaded }) => {
  const queryClient = useQueryClient()
  const { state, upload, cancel, reset, findResumable, discardResumable } = useMultipartUpload()
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [resumable, setResumable] = useState<ResumeRecord | null>(null)
  const [analyzedPackageId, setAnalyzedPackageId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setResumable(findResumable())
  }, [findResumable])

  // Poll while the analyzer streams and fingerprints the artifact. It runs
  // asynchronously precisely because hashing multiple GB takes far longer than
  // an HTTP request should wait.
  const { data: analyzedPackage } = useQuery({
    queryKey: ['bootstrap-package', analyzedPackageId],
    queryFn: () => apiClient.getBootstrapPackage(analyzedPackageId as string),
    enabled: Boolean(analyzedPackageId),
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.status
      return status === 'analyzing' || status === 'uploading' ? 3000 : false
    },
  })

  const handleFile = useCallback((selected: File | null) => {
    if (!selected) return
    setFile(selected)
    reset()
  }, [reset])

  const startUpload = useCallback(
    async (resume?: ResumeRecord) => {
      if (!file) return
      const packageId = await upload(file, { resume })
      if (packageId) {
        setAnalyzedPackageId(packageId)
        setResumable(null)
        queryClient.invalidateQueries({ queryKey: ['admin-bootstrap-packages'] })
      }
    },
    [file, upload, queryClient]
  )

  const analysis = analyzedPackage?.analysis
  const status = analyzedPackage?.status
  const isAnalyzing = state.phase === 'done' && (status === 'analyzing' || !status)

  const remainingSeconds =
    state.bytesPerSecond > 0
      ? (state.totalBytes - state.uploadedBytes) / state.bytesPerSecond
      : NaN

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Upload an installer</h2>
          <p className="mt-1 text-sm text-gray-600">
            The file is uploaded straight to your own S3 bucket, then scanned to work out how to
            install it. An administrator reviews it before it can be installed on any workstation.
          </p>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
        >
          Close
        </button>
      </div>

      {/* Resume banner */}
      {resumable && state.phase === 'idle' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-900">
            An unfinished upload of <strong>{resumable.fileName}</strong> was interrupted —{' '}
            {resumable.completedParts.length} of {resumable.partCount} parts already transferred.
          </p>
          <p className="mt-1 text-xs text-blue-800">
            Select the same file to carry on from where it stopped.
          </p>
          <button
            onClick={() => {
              discardResumable()
              setResumable(null)
            }}
            className="mt-2 text-xs font-medium text-blue-700 underline"
          >
            Discard it and start over
          </button>
        </div>
      )}

      {/* Drop zone */}
      {state.phase === 'idle' || state.phase === 'error' || state.phase === 'cancelled' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            handleFile(e.dataTransfer.files?.[0] ?? null)
          }}
          className={`rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-sm text-gray-700">
            {file ? (
              <>
                <span className="font-medium">{file.name}</span> · {formatBytes(file.size)}
              </>
            ) : (
              'Drop an .exe, .msi, .msix or .zip here'
            )}
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {file ? 'Choose a different file' : 'Choose a file'}
          </button>

          {file && (
            <div className="mt-4 flex justify-center gap-3">
              <button
                onClick={() => startUpload()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Upload
              </button>
              {resumable && resumable.fileSizeBytes === file.size && (
                <button
                  onClick={() => startUpload(resumable)}
                  className="px-4 py-2 bg-white border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50"
                >
                  Resume ({resumable.completedParts.length}/{resumable.partCount} parts done)
                </button>
              )}
            </div>
          )}

          {state.phase === 'error' && (
            <p className="mt-4 text-sm text-red-700" role="alert">
              {state.error} — the parts already uploaded were kept, so choosing Resume will not
              re-send them.
            </p>
          )}
        </div>
      ) : null}

      {/* Progress */}
      {(state.phase === 'preparing' ||
        state.phase === 'uploading' ||
        state.phase === 'finalizing') && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-gray-900">{state.fileName}</span>
            <span className="text-sm text-gray-600">{Math.round(state.progress)}%</span>
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${state.progress}%` }}
              role="progressbar"
              aria-valuenow={Math.round(state.progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-4 text-xs text-gray-600 sm:grid-cols-4">
            <div>
              <dt className="font-medium text-gray-500">Transferred</dt>
              <dd>{formatBytes(state.uploadedBytes)} / {formatBytes(state.totalBytes)}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-500">Parts</dt>
              <dd>{state.partsCompleted} / {state.partCount}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-500">Speed</dt>
              <dd>{state.bytesPerSecond > 0 ? `${formatBytes(state.bytesPerSecond)}/s` : '—'}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-500">Remaining</dt>
              <dd>{formatDuration(remainingSeconds)}</dd>
            </div>
          </dl>

          <p className="mt-4 text-xs text-gray-500">
            {state.phase === 'finalizing'
              ? 'Assembling the parts in S3…'
              : 'You can leave this page — the upload resumes from the last completed part.'}
          </p>

          <button
            onClick={cancel}
            className="mt-4 px-3 py-1.5 text-sm text-red-700 border border-red-200 rounded-lg hover:bg-red-50"
          >
            Cancel upload
          </button>
        </div>
      )}

      {/* Analysis */}
      {state.phase === 'done' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          {isAnalyzing ? (
            <div className="flex items-center gap-3">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <p className="text-sm text-gray-700">
                Hashing and identifying the installer… this takes about a minute for a large file.
              </p>
            </div>
          ) : status === 'analysis_failed' ? (
            <div>
              <h3 className="text-sm font-semibold text-amber-900">
                Automatic analysis did not succeed
              </h3>
              <p className="mt-1 text-sm text-gray-700">
                {analyzedPackage?.reviewNotes ||
                  'The install parameters need to be filled in by hand before an admin can approve it.'}
              </p>
            </div>
          ) : analysis ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">
                  Detected: {INSTALLER_TYPE_LABELS[analysis.installerType] || analysis.installerType}
                </h3>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                    CONFIDENCE_STYLES[analysis.confidence] || CONFIDENCE_STYLES.low
                  }`}
                >
                  {analysis.confidence} confidence
                </span>
                {analysis.architecture && (
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
                    {analysis.architecture}
                  </span>
                )}
              </div>

              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                {analysis.detectedProductName && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Product</dt>
                    <dd className="text-gray-900">{analysis.detectedProductName}</dd>
                  </div>
                )}
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
                {analysis.archiveEntry && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Installer inside archive</dt>
                    <dd className="font-mono text-xs text-gray-900">{analysis.archiveEntry}</dd>
                  </div>
                )}
              </dl>

              <div>
                <dt className="text-xs font-medium text-gray-500">SHA-256</dt>
                <dd className="break-all font-mono text-xs text-gray-700">
                  {analyzedPackage?.expectedSha256}
                </dd>
              </div>

              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs font-medium text-gray-500">Suggested command</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-gray-900">
                  {analysis.suggestedInstallCommand} {analysis.suggestedInstallArgs}
                </pre>
              </div>

              {analysis.warnings?.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  {analysis.warnings.map((warning: string, i: number) => (
                    <li key={i}>• {warning}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {!isAnalyzing && (
            <div className="mt-6 flex justify-end gap-3 border-t pt-4">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Done
              </button>
              <button
                onClick={() => analyzedPackageId && onUploaded(analyzedPackageId)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Go to review
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default PackageUploadWizard
