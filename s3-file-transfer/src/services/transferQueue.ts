//------------------------------------------------------------------------------
// Transfer Queue Service - Queue Management with Retry Logic
//------------------------------------------------------------------------------

import { v4 as uuidv4 } from 'uuid';
import {
  TransferItem,
  TransferStatus,
  TransferDirection,
  TransferProgress,
  TransferError,
  TransferBatch,
  QueueSettings,
  UploadOptions,
  DownloadOptions,
  StorageClass,
  EncryptionConfig,
} from '../types';

// Event types for the queue
export type QueueEventType =
  | 'itemAdded'
  | 'itemStarted'
  | 'itemProgress'
  | 'itemCompleted'
  | 'itemFailed'
  | 'itemCancelled'
  | 'itemPaused'
  | 'itemResumed'
  | 'queueStarted'
  | 'queuePaused'
  | 'queueResumed'
  | 'queueCompleted';

export interface QueueEvent {
  type: QueueEventType;
  item?: TransferItem;
  batch?: TransferBatch;
  error?: TransferError;
}

type QueueEventHandler = (event: QueueEvent) => void;

const DEFAULT_SETTINGS: QueueSettings = {
  maxConcurrentTransfers: 3,
  maxConcurrentUploads: 2,
  maxConcurrentDownloads: 2,
  autoRetry: true,
  maxRetries: 3,
  retryDelayMs: 1000,
  pauseOnError: false,
};

export class TransferQueue {
  private items: Map<string, TransferItem> = new Map();
  private batches: Map<string, TransferBatch> = new Map();
  private settings: QueueSettings;
  private eventHandlers: Set<QueueEventHandler> = new Set();
  private isProcessing: boolean = false;
  private isPaused: boolean = false;
  private activeTransfers: Set<string> = new Set();
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(settings?: Partial<QueueSettings>) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  //----------------------------------------------------------------------------
  // Configuration
  //----------------------------------------------------------------------------

  updateSettings(settings: Partial<QueueSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  getSettings(): QueueSettings {
    return { ...this.settings };
  }

  //----------------------------------------------------------------------------
  // Event Handling
  //----------------------------------------------------------------------------

  addEventListener(handler: QueueEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: QueueEvent): void {
    this.eventHandlers.forEach((handler) => handler(event));
  }

  //----------------------------------------------------------------------------
  // Item Management
  //----------------------------------------------------------------------------

  addUpload(
    file: File,
    bucket: string,
    keyPrefix: string,
    options: Partial<UploadOptions> = {}
  ): TransferItem {
    const key = `${keyPrefix}${keyPrefix.endsWith('/') ? '' : '/'}${file.name}`;

    const item: TransferItem = {
      id: uuidv4(),
      direction: 'upload',
      status: 'pending',
      sourcePath: file.name,
      sourceName: file.name,
      sourceSize: file.size,
      destinationBucket: bucket,
      destinationKey: key,
      progress: this.createInitialProgress(),
      bytesTransferred: 0,
      isMultipart: file.size > (options.multipartThreshold || 100 * 1024 * 1024),
      storageClass: options.storageClass || 'STANDARD',
      encryption: options.encryption || { type: 'none' },
      metadata: options.metadata,
      contentType: file.type || 'application/octet-stream',
      retryCount: 0,
      maxRetries: this.settings.maxRetries,
      createdAt: new Date(),
    };

    this.items.set(item.id, item);
    this.emit({ type: 'itemAdded', item });

    if (this.isProcessing && !this.isPaused) {
      this.processQueue();
    }

    return item;
  }

  addDownload(
    bucket: string,
    key: string,
    size: number,
    destinationPath: string,
    options: Partial<DownloadOptions> = {}
  ): TransferItem {
    const filename = key.split('/').pop() || key;

    const item: TransferItem = {
      id: uuidv4(),
      direction: 'download',
      status: 'pending',
      sourcePath: `s3://${bucket}/${key}`,
      sourceName: filename,
      sourceSize: size,
      destinationBucket: bucket,
      destinationKey: key,
      destinationPath,
      progress: this.createInitialProgress(),
      bytesTransferred: 0,
      isMultipart: false,
      storageClass: 'STANDARD',
      encryption: { type: 'none' },
      retryCount: 0,
      maxRetries: this.settings.maxRetries,
      createdAt: new Date(),
    };

    this.items.set(item.id, item);
    this.emit({ type: 'itemAdded', item });

    if (this.isProcessing && !this.isPaused) {
      this.processQueue();
    }

    return item;
  }

  addBatchUpload(
    files: File[],
    bucket: string,
    keyPrefix: string,
    options: Partial<UploadOptions> = {}
  ): TransferBatch {
    const batchId = uuidv4();
    const items: TransferItem[] = [];

    files.forEach((file) => {
      const item = this.addUpload(file, bucket, keyPrefix, options);
      items.push(item);
    });

    const batch: TransferBatch = {
      id: batchId,
      name: `Upload ${files.length} files`,
      items,
      status: 'pending',
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      transferredSize: 0,
      createdAt: new Date(),
    };

    this.batches.set(batchId, batch);
    return batch;
  }

  private createInitialProgress(): TransferProgress {
    return {
      loaded: 0,
      total: 0,
      percentage: 0,
      speed: 0,
      remainingTime: 0,
      startTime: new Date(),
      elapsedTime: 0,
    };
  }

  //----------------------------------------------------------------------------
  // Item Retrieval
  //----------------------------------------------------------------------------

  getItem(id: string): TransferItem | undefined {
    return this.items.get(id);
  }

  getAllItems(): TransferItem[] {
    return Array.from(this.items.values());
  }

  getItemsByStatus(status: TransferStatus): TransferItem[] {
    return this.getAllItems().filter((item) => item.status === status);
  }

  getItemsByDirection(direction: TransferDirection): TransferItem[] {
    return this.getAllItems().filter((item) => item.direction === direction);
  }

  getPendingItems(): TransferItem[] {
    return this.getItemsByStatus('pending');
  }

  getActiveItems(): TransferItem[] {
    return this.getAllItems().filter(
      (item) => item.status === 'transferring' || item.status === 'preparing'
    );
  }

  getCompletedItems(): TransferItem[] {
    return this.getItemsByStatus('completed');
  }

  getFailedItems(): TransferItem[] {
    return this.getItemsByStatus('failed');
  }

  getBatch(id: string): TransferBatch | undefined {
    return this.batches.get(id);
  }

  //----------------------------------------------------------------------------
  // Queue Control
  //----------------------------------------------------------------------------

  start(): void {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.isPaused = false;
    this.emit({ type: 'queueStarted' });
    this.processQueue();
  }

  pause(): void {
    this.isPaused = true;
    this.emit({ type: 'queuePaused' });
  }

  resume(): void {
    if (!this.isPaused) return;

    this.isPaused = false;
    this.emit({ type: 'queueResumed' });
    this.processQueue();
  }

  stop(): void {
    this.isProcessing = false;
    this.isPaused = false;

    // Cancel all active transfers
    this.activeTransfers.forEach((id) => {
      this.cancelItem(id);
    });
  }

  //----------------------------------------------------------------------------
  // Individual Item Control
  //----------------------------------------------------------------------------

  pauseItem(id: string): void {
    const item = this.items.get(id);
    if (!item || item.status !== 'transferring') return;

    item.status = 'paused';
    item.pausedAt = new Date();
    this.items.set(id, item);
    this.emit({ type: 'itemPaused', item });
  }

  resumeItem(id: string): void {
    const item = this.items.get(id);
    if (!item || item.status !== 'paused') return;

    item.status = 'pending';
    item.pausedAt = undefined;
    this.items.set(id, item);
    this.emit({ type: 'itemResumed', item });

    if (this.isProcessing && !this.isPaused) {
      this.processQueue();
    }
  }

  cancelItem(id: string): void {
    const item = this.items.get(id);
    if (!item) return;

    // Abort if active
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }

    this.activeTransfers.delete(id);

    item.status = 'cancelled';
    this.items.set(id, item);
    this.emit({ type: 'itemCancelled', item });
  }

  retryItem(id: string): void {
    const item = this.items.get(id);
    if (!item || item.status !== 'failed') return;

    item.status = 'pending';
    item.error = undefined;
    item.retryCount = 0;
    item.progress = this.createInitialProgress();
    item.bytesTransferred = 0;
    this.items.set(id, item);

    if (this.isProcessing && !this.isPaused) {
      this.processQueue();
    }
  }

  removeItem(id: string): void {
    this.cancelItem(id);
    this.items.delete(id);
  }

  clearCompleted(): void {
    const completedItems = this.getCompletedItems();
    completedItems.forEach((item) => this.items.delete(item.id));
  }

  clearAll(): void {
    this.stop();
    this.items.clear();
    this.batches.clear();
  }

  //----------------------------------------------------------------------------
  // Progress Updates
  //----------------------------------------------------------------------------

  updateItemProgress(
    id: string,
    loaded: number,
    total: number,
    startTime?: Date
  ): void {
    const item = this.items.get(id);
    if (!item) return;

    const now = new Date();
    const start = startTime || item.progress.startTime;
    const elapsedMs = now.getTime() - start.getTime();
    const elapsedSec = elapsedMs / 1000;
    const speed = elapsedSec > 0 ? loaded / elapsedSec : 0;
    const remaining = total - loaded;
    const remainingTime = speed > 0 ? remaining / speed : 0;

    item.progress = {
      loaded,
      total,
      percentage: total > 0 ? Math.round((loaded / total) * 100) : 0,
      speed,
      remainingTime,
      startTime: start,
      elapsedTime: elapsedSec,
    };
    item.bytesTransferred = loaded;

    this.items.set(id, item);
    this.emit({ type: 'itemProgress', item });
  }

  completeItem(id: string, etag?: string): void {
    const item = this.items.get(id);
    if (!item) return;

    item.status = 'completed';
    item.completedAt = new Date();
    item.progress.percentage = 100;
    item.progress.loaded = item.sourceSize;
    item.remoteChecksum = etag;

    this.activeTransfers.delete(id);
    this.abortControllers.delete(id);
    this.items.set(id, item);
    this.emit({ type: 'itemCompleted', item });

    // Process next items
    this.processQueue();
  }

  failItem(id: string, error: TransferError): void {
    const item = this.items.get(id);
    if (!item) return;

    this.activeTransfers.delete(id);
    this.abortControllers.delete(id);

    // Check for retry
    if (this.settings.autoRetry && error.retryable && item.retryCount < item.maxRetries) {
      item.retryCount++;
      item.status = 'pending';
      item.error = error;
      this.items.set(id, item);

      // Exponential backoff
      const delay = this.settings.retryDelayMs * Math.pow(2, item.retryCount - 1);
      setTimeout(() => {
        if (this.isProcessing && !this.isPaused) {
          this.processQueue();
        }
      }, delay);
    } else {
      item.status = 'failed';
      item.error = error;
      this.items.set(id, item);
      this.emit({ type: 'itemFailed', item, error });

      if (this.settings.pauseOnError) {
        this.pause();
      }
    }

    // Process next items
    this.processQueue();
  }

  //----------------------------------------------------------------------------
  // Queue Processing
  //----------------------------------------------------------------------------

  private async processQueue(): Promise<void> {
    if (!this.isProcessing || this.isPaused) return;

    const pendingItems = this.getPendingItems();
    const activeCount = this.activeTransfers.size;

    // Calculate available slots
    const availableSlots = this.settings.maxConcurrentTransfers - activeCount;
    if (availableSlots <= 0) return;

    // Get items to process
    const itemsToProcess = pendingItems.slice(0, availableSlots);

    // Start processing each item
    for (const item of itemsToProcess) {
      // Check concurrent limits by direction
      const activeUploads = this.getActiveItems().filter(
        (i) => i.direction === 'upload'
      ).length;
      const activeDownloads = this.getActiveItems().filter(
        (i) => i.direction === 'download'
      ).length;

      if (
        item.direction === 'upload' &&
        activeUploads >= this.settings.maxConcurrentUploads
      ) {
        continue;
      }

      if (
        item.direction === 'download' &&
        activeDownloads >= this.settings.maxConcurrentDownloads
      ) {
        continue;
      }

      // Mark as transferring and add to active
      item.status = 'transferring';
      item.startedAt = new Date();
      item.progress.startTime = new Date();
      this.items.set(item.id, item);
      this.activeTransfers.add(item.id);

      // Create abort controller
      const controller = new AbortController();
      this.abortControllers.set(item.id, controller);

      this.emit({ type: 'itemStarted', item });
    }

    // Check if queue is complete
    if (
      this.getPendingItems().length === 0 &&
      this.activeTransfers.size === 0
    ) {
      this.isProcessing = false;
      this.emit({ type: 'queueCompleted' });
    }
  }

  getAbortSignal(id: string): AbortSignal | undefined {
    return this.abortControllers.get(id)?.signal;
  }

  //----------------------------------------------------------------------------
  // Statistics
  //----------------------------------------------------------------------------

  getStats(): {
    total: number;
    pending: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
    paused: number;
    totalSize: number;
    transferredSize: number;
    averageSpeed: number;
  } {
    const items = this.getAllItems();
    const activeItems = this.getActiveItems();

    const totalSize = items.reduce((sum, item) => sum + item.sourceSize, 0);
    const transferredSize = items.reduce(
      (sum, item) => sum + item.bytesTransferred,
      0
    );
    const totalSpeed = activeItems.reduce(
      (sum, item) => sum + item.progress.speed,
      0
    );

    return {
      total: items.length,
      pending: this.getItemsByStatus('pending').length,
      active: activeItems.length,
      completed: this.getItemsByStatus('completed').length,
      failed: this.getItemsByStatus('failed').length,
      cancelled: this.getItemsByStatus('cancelled').length,
      paused: this.getItemsByStatus('paused').length,
      totalSize,
      transferredSize,
      averageSpeed: activeItems.length > 0 ? totalSpeed / activeItems.length : 0,
    };
  }
}

// Create singleton instance
export const transferQueue = new TransferQueue();