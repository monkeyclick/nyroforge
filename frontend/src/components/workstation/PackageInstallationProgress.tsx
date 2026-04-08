import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../services/api';
import type { PackageQueueItem } from '../../types';

interface PackageInstallationProgressProps {
  workstationId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const PackageInstallationProgress: React.FC<PackageInstallationProgressProps> = ({
  workstationId,
  isOpen,
  onClose,
}) => {
  const [retryingPackageId, setRetryingPackageId] = useState<string | null>(null);

  // Poll for installation status every 10 seconds
  const { data: statusData, isLoading, refetch } = useQuery({
    queryKey: ['package-installation-status', workstationId],
    queryFn: () => apiClient.getPackageInstallationStatus(workstationId),
    refetchInterval: 10000, // Poll every 10 seconds
    enabled: isOpen,
  });

  const handleRetry = async (packageId: string) => {
    setRetryingPackageId(packageId);
    try {
      await apiClient.retryPackageInstallation(workstationId, packageId);
      await refetch();
    } catch (error) {
      console.error('Failed to retry package installation:', error);
    } finally {
      setRetryingPackageId(null);
    }
  };

  if (!isOpen) return null;

  const packages = statusData?.packages || [];
  const summary = statusData?.summary || {
    total: 0,
    pending: 0,
    installing: 0,
    completed: 0,
    failed: 0,
  };

  const overallProgress = summary.total > 0
    ? Math.round((summary.completed / summary.total) * 100)
    : 0;

  const isComplete = summary.total > 0 && summary.completed === summary.total;
  const hasFailures = summary.failed > 0;
  const isActive = summary.installing > 0 || summary.pending > 0;

  const getStatusColor = (status: PackageQueueItem['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-100';
      case 'failed':
        return 'text-red-600 bg-red-100';
      case 'installing':
        return 'text-blue-600 bg-blue-100';
      case 'pending':
        return 'text-gray-600 bg-gray-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusIcon = (status: PackageQueueItem['status']) => {
    switch (status) {
      case 'completed':
        return '✓';
      case 'failed':
        return '✗';
      case 'installing':
        return '⟳';
      case 'pending':
        return '⋯';
      default:
        return '?';
    }
  };

  const getStatusLabel = (status: PackageQueueItem['status']) => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'installing':
        return 'Installing';
      case 'pending':
        return 'Pending';
      default:
        return 'Unknown';
    }
  };

  const formatDuration = (startedAt?: string, completedAt?: string) => {
    if (!startedAt) return null;
    
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const durationMs = end - start;
    const seconds = Math.floor(durationMs / 1000);
    
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              Package Installation Progress
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              title="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Overall Progress */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                Overall Progress
              </span>
              <span className="text-sm font-semibold text-gray-900">
                {overallProgress}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all duration-300 ${
                  isComplete
                    ? 'bg-green-600'
                    : hasFailures
                    ? 'bg-yellow-600'
                    : 'bg-blue-600'
                }`}
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-5 gap-2 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-900">{summary.total}</div>
              <div className="text-xs text-gray-600">Total</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-600">{summary.pending}</div>
              <div className="text-xs text-gray-600">Pending</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">{summary.installing}</div>
              <div className="text-xs text-gray-600">Installing</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{summary.completed}</div>
              <div className="text-xs text-gray-600">Completed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600">{summary.failed}</div>
              <div className="text-xs text-gray-600">Failed</div>
            </div>
          </div>
        </div>

        {/* Package List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-600">Loading status...</span>
            </div>
          ) : packages.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 text-5xl mb-4">📦</div>
              <p className="text-gray-600">No packages in installation queue</p>
            </div>
          ) : (
            <div className="space-y-3">
              {packages
                .sort((a, b) => a.installOrder - b.installOrder)
                .map((pkg) => (
                  <div
                    key={pkg.packageId}
                    className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getStatusColor(
                              pkg.status
                            )}`}
                          >
                            <span className="mr-1">{getStatusIcon(pkg.status)}</span>
                            {getStatusLabel(pkg.status)}
                          </span>
                          {pkg.required && (
                            <span className="inline-flex items-center px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium">
                              Required
                            </span>
                          )}
                        </div>

                        <h4 className="text-sm font-semibold text-gray-900 mb-1">
                          {pkg.packageName}
                        </h4>

                        <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                          <span>Order: #{pkg.installOrder}</span>
                          {pkg.estimatedInstallTimeMinutes && (
                            <span>Est. time: {pkg.estimatedInstallTimeMinutes} min</span>
                          )}
                          {pkg.status === 'installing' && pkg.startedAt && (
                            <span className="text-blue-600 font-medium">
                              Running: {formatDuration(pkg.startedAt)}
                            </span>
                          )}
                          {pkg.status === 'completed' && pkg.startedAt && pkg.completedAt && (
                            <span className="text-green-600">
                              Duration: {formatDuration(pkg.startedAt, pkg.completedAt)}
                            </span>
                          )}
                        </div>

                        {pkg.status === 'failed' && pkg.errorMessage && (
                          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
                            <div className="font-medium text-red-800 mb-1">Error:</div>
                            <div className="text-red-700">{pkg.errorMessage}</div>
                            {pkg.retryCount > 0 && (
                              <div className="text-red-600 mt-1">
                                Retry attempts: {pkg.retryCount} / {pkg.maxRetries}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {pkg.status === 'failed' && pkg.retryCount < pkg.maxRetries && (
                        <button
                          onClick={() => handleRetry(pkg.packageId)}
                          disabled={retryingPackageId === pkg.packageId}
                          className="ml-4 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                        >
                          {retryingPackageId === pkg.packageId ? (
                            <>
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                              <span>Retrying...</span>
                            </>
                          ) : (
                            <>
                              <span>🔄</span>
                              <span>Retry</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {pkg.status === 'installing' && (
                      <div className="mt-3">
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div className="bg-blue-600 h-1.5 rounded-full animate-pulse" style={{ width: '60%' }} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          {isComplete ? (
            <div className="flex items-center gap-3 text-green-700 bg-green-50 px-4 py-3 rounded-lg">
              <span className="text-2xl">✓</span>
              <div className="flex-1">
                <div className="font-semibold">All packages installed successfully!</div>
                <div className="text-sm text-green-600">
                  Your workstation is ready with all configured software.
                </div>
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                Done
              </button>
            </div>
          ) : hasFailures && !isActive ? (
            <div className="flex items-center gap-3 text-yellow-700 bg-yellow-50 px-4 py-3 rounded-lg">
              <span className="text-2xl">⚠️</span>
              <div className="flex-1">
                <div className="font-semibold">Some packages failed to install</div>
                <div className="text-sm text-yellow-600">
                  Use the Retry button to attempt failed installations again.
                </div>
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-blue-700 bg-blue-50 px-4 py-3 rounded-lg">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <div className="flex-1">
                <div className="font-semibold">Installation in progress...</div>
                <div className="text-sm text-blue-600">
                  You can safely close this dialog. Installations continue in the background.
                </div>
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Continue in Background
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PackageInstallationProgress;