import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { useQuery } from '@tanstack/react-query'
import AppShell from '@/layouts/AppShell'
import PackageUploadWizard, { formatBytes } from '@/components/admin/PackageUploadWizard'
import { apiClient } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'

/**
 * User-facing software submission page.
 *
 * Uploading is open to any authenticated user — the API scopes each upload to
 * its uploader and admins approve before anything can install. The admin
 * console is the wrong home for that: /admin bounces non-admins, so without
 * this page the "users upload, admins approve" model has no user half.
 */

const STATUS_COPY: Record<string, { label: string; className: string; detail: string }> = {
  uploading: {
    label: 'Uploading',
    className: 'bg-gray-100 text-gray-700',
    detail: 'The transfer has not finished yet.',
  },
  analyzing: {
    label: 'Analyzing',
    className: 'bg-blue-100 text-blue-800',
    detail: 'Working out how to install it. This usually takes about a minute.',
  },
  needs_review: {
    label: 'Awaiting approval',
    className: 'bg-amber-100 text-amber-800',
    detail: 'An administrator needs to approve this before it can be installed.',
  },
  analysis_failed: {
    label: 'Needs attention',
    className: 'bg-red-100 text-red-800',
    detail: 'It could not be identified automatically; an administrator will set it up by hand.',
  },
  approved: {
    label: 'Approved',
    className: 'bg-green-100 text-green-800',
    detail: 'Available to select when launching a workstation.',
  },
  rejected: {
    label: 'Not approved',
    className: 'bg-gray-200 text-gray-600',
    detail: 'An administrator declined this submission.',
  },
}

export default function PackagesPage() {
  const router = useRouter()
  const { user, isAdmin, logout } = useAuthStore()
  const [showUpload, setShowUpload] = useState(false)

  useEffect(() => {
    if (!user) router.push('/login')
  }, [user, router])

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['my-bootstrap-packages'],
    queryFn: () => apiClient.getAdminBootstrapPackages(),
    enabled: !!user,
    // Poll while anything is still uploading or being analyzed.
    refetchInterval: (query) => {
      const packages = ((query.state.data as any)?.packages || []) as any[]
      const busy = packages.some(
        (pkg) => pkg.status === 'analyzing' || pkg.status === 'uploading'
      )
      return busy ? 5000 : false
    },
  })

  const mine = useMemo(() => {
    const email = user?.email
    const packages = ((data as any)?.packages || []) as any[]
    return packages
      .filter((pkg) => pkg.source === 's3' && pkg.uploadedBy && pkg.uploadedBy === email)
      .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
  }, [data, user?.email])

  if (!user) return null

  const handleSignOut = async () => {
    await logout()
    router.push('/login')
  }

  return (
    <>
      <Head>
        <title>Software | NyroForge</title>
      </Head>
      <AppShell title="Software" isAdmin={isAdmin} onSignOut={handleSignOut}>
        <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
          {showUpload ? (
            <PackageUploadWizard
              onClose={() => {
                setShowUpload(false)
                refetch()
              }}
              onUploaded={() => {
                setShowUpload(false)
                refetch()
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Software submissions</h1>
                  <p className="mt-1 max-w-2xl text-sm text-gray-600">
                    Upload an installer to make it available on workstations. It goes to your
                    organisation&apos;s own storage and is checked over by an administrator before
                    anyone can install it.
                  </p>
                </div>
                <button
                  onClick={() => setShowUpload(true)}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
                >
                  Upload an installer
                </button>
              </div>

              <div className="mt-8">
                {isLoading ? (
                  <p className="text-sm text-gray-600">Loading your submissions…</p>
                ) : mine.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
                    <p className="text-sm text-gray-600">
                      You have not submitted any software yet.
                    </p>
                    <button
                      onClick={() => setShowUpload(true)}
                      className="mt-3 text-sm font-medium text-blue-700 underline"
                    >
                      Upload your first installer
                    </button>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {mine.map((pkg) => {
                      const status = STATUS_COPY[pkg.status] || {
                        label: pkg.status,
                        className: 'bg-gray-100 text-gray-700',
                        detail: '',
                      }
                      return (
                        <li
                          key={pkg.packageId}
                          className="rounded-lg border border-gray-200 bg-white p-5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900">{pkg.name}</p>
                              <p className="mt-0.5 truncate text-sm text-gray-600">
                                {pkg.fileName}
                                {pkg.fileSizeBytes
                                  ? ` · ${formatBytes(Number(pkg.fileSizeBytes))}`
                                  : ''}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.className}`}
                            >
                              {status.label}
                            </span>
                          </div>

                          <p className="mt-2 text-xs text-gray-600">{status.detail}</p>

                          {pkg.analysis?.installerType && (
                            <p className="mt-2 text-xs text-gray-500">
                              Detected as {pkg.analysis.installerType}
                              {pkg.analysis.detectedVersion
                                ? ` ${pkg.analysis.detectedVersion}`
                                : ''}
                              {pkg.analysis.confidence
                                ? ` (${pkg.analysis.confidence} confidence)`
                                : ''}
                            </p>
                          )}

                          {/* Rejection is the case a user most needs explained. */}
                          {pkg.reviewNotes && (
                            <p
                              className={`mt-3 rounded-lg p-3 text-xs ${
                                pkg.status === 'rejected'
                                  ? 'bg-red-50 text-red-900'
                                  : 'bg-gray-50 text-gray-700'
                              }`}
                            >
                              <span className="font-medium">
                                {pkg.status === 'rejected' ? 'Reason: ' : 'Note: '}
                              </span>
                              {pkg.reviewNotes}
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </main>
      </AppShell>
    </>
  )
}
