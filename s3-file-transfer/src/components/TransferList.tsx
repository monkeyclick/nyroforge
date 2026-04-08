//------------------------------------------------------------------------------
// Transfer List Component - Display Transfer Progress and Queue
//------------------------------------------------------------------------------

import React, { useMemo } from 'react';
import {
  Upload,
  Download,
  Pause,
  Play,
  X,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { useTransferStore, selectTransferStats } from '../stores/transferStore';
import { TransferItem, TransferStatus } from '../types';
import { formatBytes, formatSpeed, formatDuration, formatPercentage } from '../utils/formatters';

interface TransferListProps {
  className?: string;
  showCompleted?: boolean;
  showFailed?: boolean;
  maxItems?: number;
}

export const TransferList: React.FC<TransferListProps> = ({
  className = '',
  showCompleted = true,
  showFailed = true,
  maxItems,
}) => {
  const {
    transfers,
    isQueueRunning,
    isQueuePaused,
    startQueue,
    pauseQueue,
    resumeQueue,
    stopQueue,
    pauseItem,
    resumeItem,
    cancelItem,
    retryItem,
    removeItem,
    clearCompleted,
  } = useTransferStore();

  const stats = useTransferStore(selectTransferStats);

  // Filter and sort transfers
  const filteredTransfers = useMemo(() => {
    let filtered = transfers;

    if (!showCompleted) {
      filtered = filtered.filter((t) => t.status !== 'completed');
    }
    if (!showFailed) {
      filtered = filtered.filter((t) => t.status !== 'failed');
    }

    // Sort: active first, then pending, then completed/failed
    filtered = [...filtered].sort((a, b) => {
      const statusOrder: Record<TransferStatus, number> = {
        transferring: 0,
        preparing: 1,
        pending: 2,
        queued: 3,
        paused: 4,
        failed: 5,
        cancelled: 6,
        completed: 7,
      };
      return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
    });

    if (maxItems) {
      filtered = filtered.slice(0, maxItems);
    }

    return filtered;
  }, [transfers, showCompleted, showFailed, maxItems]);

  // Get status icon
  const getStatusIcon = (status: TransferStatus, direction: 'upload' | 'download') => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'cancelled':
        return <X className="w-4 h-4 text-gray-400" />;
      case 'paused':
        return <Pause className="w-4 h-4 text-yellow-500" />;
      case 'transferring':
        return direction === 'upload' ? (
          <Upload className="w-4 h-4 text-primary-500 animate-pulse" />
        ) : (
          <Download className="w-4 h-4 text-primary-500 animate-pulse" />
        );
      case 'preparing':
        return <RefreshCw className="w-4 h-4 text-primary-500 animate-spin" />;
      case 'pending':
      case 'queued':
        return <Clock className="w-4 h-4 text-gray-400" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  // Get status text
  const getStatusText = (item: TransferItem): string => {
    switch (item.status) {
      case 'completed':
        return 'Completed';
      case 'failed':
        return item.error?.message || 'Failed';
      case 'cancelled':
        return 'Cancelled';
      case 'paused':
        return 'Paused';
      case 'transferring':
        return `${formatPercentage(item.progress.percentage)} - ${formatSpeed(item.progress.speed)}`;
      case 'preparing':
        return 'Preparing...';
      case 'pending':
        return 'Pending';
      case 'queued':
        return 'Queued';
      default:
        return item.status;
    }
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header with stats */}
      <div className="flex items-center justify-between p-3 border-b bg-gray-50">
        <div className="flex items-center gap-4">
          <h3 className="font-medium text-gray-700">Transfers</h3>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>{stats.active} active</span>
            <span>•</span>
            <span>{stats.pending} pending</span>
            {stats.failed > 0 && (
              <>
                <span>•</span>
                <span className="text-red-500">{stats.failed} failed</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Queue controls */}
          {!isQueueRunning ? (
            <button
              onClick={startQueue}
              disabled={stats.pending === 0}
              className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Play className="w-4 h-4" />
              Start
            </button>
          ) : isQueuePaused ? (
            <button
              onClick={resumeQueue}
              className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 flex items-center gap-1"
            >
              <Play className="w-4 h-4" />
              Resume
            </button>
          ) : (
            <button
              onClick={pauseQueue}
              className="px-3 py-1.5 text-sm bg-yellow-500 text-white rounded hover:bg-yellow-600 flex items-center gap-1"
            >
              <Pause className="w-4 h-4" />
              Pause
            </button>
          )}

          {isQueueRunning && (
            <button
              onClick={stopQueue}
              className="px-3 py-1.5 text-sm bg-red-500 text-white rounded hover:bg-red-600 flex items-center gap-1"
            >
              <X className="w-4 h-4" />
              Stop
            </button>
          )}

          {stats.completed > 0 && (
            <button
              onClick={clearCompleted}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded flex items-center gap-1"
            >
              <Trash2 className="w-4 h-4" />
              Clear Completed
            </button>
          )}
        </div>
      </div>

      {/* Overall progress */}
      {stats.active > 0 && (
        <div className="p-3 border-b bg-primary-50">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-primary-700 font-medium">Overall Progress</span>
            <span className="text-primary-600">
              {formatBytes(stats.transferredSize)} / {formatBytes(stats.totalSize)}
            </span>
          </div>
          <div className="h-2 bg-primary-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 transition-all duration-300"
              style={{
                width: `${stats.totalSize > 0 ? (stats.transferredSize / stats.totalSize) * 100 : 0}%`,
              }}
            />
          </div>
          {stats.averageSpeed > 0 && (
            <div className="mt-1 text-xs text-primary-600 text-right">
              {formatSpeed(stats.averageSpeed)}
            </div>
          )}
        </div>
      )}

      {/* Transfer list */}
      <div className="flex-1 overflow-y-auto">
        {filteredTransfers.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <Upload className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No transfers</p>
              <p className="text-sm">Drop files to upload or select files from S3 to download</p>
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {filteredTransfers.map((item) => (
              <TransferItemRow
                key={item.id}
                item={item}
                onPause={() => pauseItem(item.id)}
                onResume={() => resumeItem(item.id)}
                onCancel={() => cancelItem(item.id)}
                onRetry={() => retryItem(item.id)}
                onRemove={() => removeItem(item.id)}
                getStatusIcon={getStatusIcon}
                getStatusText={getStatusText}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Individual transfer item row
interface TransferItemRowProps {
  item: TransferItem;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
  getStatusIcon: (status: TransferStatus, direction: 'upload' | 'download') => React.ReactNode;
  getStatusText: (item: TransferItem) => string;
}

const TransferItemRow: React.FC<TransferItemRowProps> = ({
  item,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onRemove,
  getStatusIcon,
  getStatusText,
}) => {
  const isActive = item.status === 'transferring' || item.status === 'preparing';
  const isPaused = item.status === 'paused';
  const isFailed = item.status === 'failed';
  const isComplete = item.status === 'completed';
  const isCancelled = item.status === 'cancelled';

  return (
    <div className="p-3 hover:bg-gray-50">
      <div className="flex items-start gap-3">
        {/* Status icon */}
        <div className="mt-0.5">{getStatusIcon(item.status, item.direction)}</div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700 truncate">{item.sourceName}</span>
            <span className="text-xs text-gray-500">{formatBytes(item.sourceSize)}</span>
          </div>
          
          {/* Destination */}
          <div className="text-xs text-gray-500 truncate">
            {item.direction === 'upload'
              ? `→ s3://${item.destinationBucket}/${item.destinationKey}`
              : `→ ${item.destinationPath}`}
          </div>

          {/* Progress bar */}
          {(isActive || isPaused) && (
            <div className="mt-2">
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    isPaused ? 'bg-yellow-500' : 'bg-primary-500'
                  }`}
                  style={{ width: `${item.progress.percentage}%` }}
                />
              </div>
            </div>
          )}

          {/* Status text */}
          <div className="mt-1 text-xs text-gray-500 flex items-center gap-2">
            <span>{getStatusText(item)}</span>
            {isActive && item.progress.remainingTime > 0 && (
              <span>• {formatDuration(item.progress.remainingTime)} remaining</span>
            )}
            {item.retryCount > 0 && (
              <span className="text-yellow-600">• Retry {item.retryCount}/{item.maxRetries}</span>
            )}
          </div>

          {/* Error message */}
          {isFailed && item.error && (
            <div className="mt-1 text-xs text-red-500">
              {item.error.message}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {isActive && (
            <button
              onClick={onPause}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Pause"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          {isPaused && (
            <button
              onClick={onResume}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Resume"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {isFailed && (
            <button
              onClick={onRetry}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Retry"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          {(isActive || isPaused || item.status === 'pending') && (
            <button
              onClick={onCancel}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-gray-100 rounded"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {(isComplete || isCancelled || isFailed) && (
            <button
              onClick={onRemove}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Remove"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TransferList;