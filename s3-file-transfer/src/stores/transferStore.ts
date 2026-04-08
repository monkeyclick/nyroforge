//------------------------------------------------------------------------------
// Transfer Store - Zustand State Management
//------------------------------------------------------------------------------

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  TransferItem,
  TransferBatch,
  TransferStatus,
  TransferDirection,
  QueueSettings,
  AWSCredentials,
  S3Bucket,
  S3Object,
  AppSettings,
  StorageClass,
  EncryptionConfig,
  TransferHistoryEntry,
  Notification,
  NotificationType,
} from '../types';
import { s3Service } from '../services/s3Service';
import { transferQueue, QueueEvent } from '../services/transferQueue';
import { credentialManager } from '../services/credentialManager';

//------------------------------------------------------------------------------
// Store State Interface
//------------------------------------------------------------------------------

interface TransferState {
  // Initialization
  initialized: boolean;
  initializing: boolean;
  
  // Credentials
  credentials: AWSCredentials | null;
  isConnected: boolean;
  connectionError: string | null;
  
  // Buckets
  buckets: S3Bucket[];
  bucketsLoading: boolean;
  selectedBucket: string | null;
  
  // S3 Browser
  s3CurrentPrefix: string;
  s3Objects: S3Object[];
  s3Loading: boolean;
  s3Error: string | null;
  s3SelectedKeys: string[];
  
  // Transfer Queue
  transfers: TransferItem[];
  activeBatches: TransferBatch[];
  queueSettings: QueueSettings;
  isQueueRunning: boolean;
  isQueuePaused: boolean;
  
  // History
  history: TransferHistoryEntry[];
  
  // Notifications
  notifications: Notification[];
  
  // Settings
  settings: AppSettings;
}

//------------------------------------------------------------------------------
// Store Actions Interface
//------------------------------------------------------------------------------

interface TransferActions {
  // Initialization
  initialize: () => Promise<void>;
  
  // Credentials
  setCredentials: (credentials: AWSCredentials) => Promise<boolean>;
  disconnect: () => void;
  testConnection: () => Promise<boolean>;
  
  // Buckets
  loadBuckets: () => Promise<void>;
  selectBucket: (bucket: string) => void;
  createBucket: (name: string, region?: string) => Promise<boolean>;
  
  // S3 Browser
  navigateToPrefix: (prefix: string) => Promise<void>;
  navigateUp: () => void;
  refreshS3: () => Promise<void>;
  selectS3Objects: (keys: string[]) => void;
  toggleS3Selection: (key: string) => void;
  clearS3Selection: () => void;
  
  // Uploads
  uploadFiles: (files: File[], options?: {
    keyPrefix?: string;
    storageClass?: StorageClass;
    encryption?: EncryptionConfig;
    metadata?: Record<string, string>;
  }) => void;
  uploadFolder: (files: FileList, basePath: string, options?: {
    storageClass?: StorageClass;
    encryption?: EncryptionConfig;
  }) => void;
  
  // Downloads
  downloadFiles: (objects: S3Object[], destinationPath?: string) => void;
  downloadPrefix: (prefix: string, destinationPath?: string) => void;
  
  // Queue Control
  startQueue: () => void;
  pauseQueue: () => void;
  resumeQueue: () => void;
  stopQueue: () => void;
  
  // Item Control
  pauseItem: (id: string) => void;
  resumeItem: (id: string) => void;
  cancelItem: (id: string) => void;
  retryItem: (id: string) => void;
  removeItem: (id: string) => void;
  clearCompleted: () => void;
  
  // Queue Settings
  updateQueueSettings: (settings: Partial<QueueSettings>) => void;
  
  // History
  clearHistory: () => void;
  
  // Notifications
  addNotification: (type: NotificationType, title: string, message: string) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;
  
  // Settings
  updateSettings: (settings: Partial<AppSettings>) => void;
}

//------------------------------------------------------------------------------
// Default Settings
//------------------------------------------------------------------------------

const defaultSettings: AppSettings = {
  credentials: [],
  defaultStorageClass: 'STANDARD',
  defaultEncryption: { type: 'none' },
  queue: {
    maxConcurrentTransfers: 3,
    maxConcurrentUploads: 2,
    maxConcurrentDownloads: 2,
    autoRetry: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    pauseOnError: false,
  },
  upload: {
    multipartThreshold: 100 * 1024 * 1024, // 100 MB
    partSize: 10 * 1024 * 1024, // 10 MB
    maxConcurrentParts: 4,
  },
  download: {
    defaultPath: '',
    maxConcurrentDownloads: 3,
  },
  checksum: {
    enabled: true,
    algorithm: 'MD5',
  },
  notifications: {
    enabled: true,
    onComplete: true,
    onError: true,
  },
  theme: 'system',
};

//------------------------------------------------------------------------------
// Store Implementation
//------------------------------------------------------------------------------

export const useTransferStore = create<TransferState & TransferActions>()(
  subscribeWithSelector((set, get) => {
    // Subscribe to queue events
    transferQueue.addEventListener((event: QueueEvent) => {
      handleQueueEvent(event, set, get);
    });

    return {
      // Initial State
      initialized: false,
      initializing: false,
      credentials: null,
      isConnected: false,
      connectionError: null,
      buckets: [],
      bucketsLoading: false,
      selectedBucket: null,
      s3CurrentPrefix: '',
      s3Objects: [],
      s3Loading: false,
      s3Error: null,
      s3SelectedKeys: [],
      transfers: [],
      activeBatches: [],
      queueSettings: defaultSettings.queue,
      isQueueRunning: false,
      isQueuePaused: false,
      history: [],
      notifications: [],
      settings: defaultSettings,

      //------------------------------------------------------------------------
      // Initialization
      //------------------------------------------------------------------------

      initialize: async () => {
        const state = get();
        if (state.initialized || state.initializing) return;

        set({ initializing: true });

        try {
          await credentialManager.initialize();
          
          const activeProfile = credentialManager.getActiveProfile();
          if (activeProfile) {
            const credentials = activeProfile.credentials;
            s3Service.initialize(credentials);
            set({ 
              credentials,
              isConnected: true,
            });

            // Load buckets
            await get().loadBuckets();
          }

          set({ initialized: true, initializing: false });
        } catch (error) {
          console.error('Failed to initialize:', error);
          set({ initializing: false });
        }
      },

      //------------------------------------------------------------------------
      // Credentials
      //------------------------------------------------------------------------

      setCredentials: async (credentials: AWSCredentials) => {
        try {
          s3Service.initialize(credentials);
          
          // Test connection
          await s3Service.listBuckets();
          
          set({ 
            credentials,
            isConnected: true,
            connectionError: null,
          });

          // Load buckets
          await get().loadBuckets();

          return true;
        } catch (error: any) {
          set({
            isConnected: false,
            connectionError: error.message || 'Failed to connect',
          });
          return false;
        }
      },

      disconnect: () => {
        set({
          credentials: null,
          isConnected: false,
          connectionError: null,
          buckets: [],
          selectedBucket: null,
          s3CurrentPrefix: '',
          s3Objects: [],
          s3SelectedKeys: [],
        });
      },

      testConnection: async () => {
        const { credentials } = get();
        if (!credentials) return false;

        try {
          s3Service.initialize(credentials);
          await s3Service.listBuckets();
          set({ isConnected: true, connectionError: null });
          return true;
        } catch (error: any) {
          set({
            isConnected: false,
            connectionError: error.message || 'Connection failed',
          });
          return false;
        }
      },

      //------------------------------------------------------------------------
      // Buckets
      //------------------------------------------------------------------------

      loadBuckets: async () => {
        set({ bucketsLoading: true });

        try {
          const buckets = await s3Service.listBuckets();
          set({ buckets, bucketsLoading: false });
        } catch (error: any) {
          console.error('Failed to load buckets:', error);
          set({ bucketsLoading: false });
          get().addNotification('error', 'Failed to load buckets', error.message);
        }
      },

      selectBucket: (bucket: string) => {
        set({ 
          selectedBucket: bucket,
          s3CurrentPrefix: '',
          s3Objects: [],
          s3SelectedKeys: [],
        });
        get().navigateToPrefix('');
      },

      createBucket: async (name: string, region?: string) => {
        try {
          await s3Service.createBucket(name, region);
          await get().loadBuckets();
          get().addNotification('success', 'Bucket created', `Bucket "${name}" created successfully`);
          return true;
        } catch (error: any) {
          get().addNotification('error', 'Failed to create bucket', error.message);
          return false;
        }
      },

      //------------------------------------------------------------------------
      // S3 Browser
      //------------------------------------------------------------------------

      navigateToPrefix: async (prefix: string) => {
        const { selectedBucket } = get();
        if (!selectedBucket) return;

        set({ s3Loading: true, s3Error: null });

        try {
          const response = await s3Service.listObjects(selectedBucket, prefix);
          set({
            s3CurrentPrefix: prefix,
            s3Objects: response.objects,
            s3Loading: false,
            s3SelectedKeys: [],
          });
        } catch (error: any) {
          set({
            s3Loading: false,
            s3Error: error.message || 'Failed to load objects',
          });
        }
      },

      navigateUp: () => {
        const { s3CurrentPrefix } = get();
        if (!s3CurrentPrefix) return;

        const parts = s3CurrentPrefix.split('/').filter(Boolean);
        parts.pop();
        const newPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
        get().navigateToPrefix(newPrefix);
      },

      refreshS3: async () => {
        const { s3CurrentPrefix } = get();
        await get().navigateToPrefix(s3CurrentPrefix);
      },

      selectS3Objects: (keys: string[]) => {
        set({ s3SelectedKeys: keys });
      },

      toggleS3Selection: (key: string) => {
        const { s3SelectedKeys } = get();
        if (s3SelectedKeys.includes(key)) {
          set({ s3SelectedKeys: s3SelectedKeys.filter(k => k !== key) });
        } else {
          set({ s3SelectedKeys: [...s3SelectedKeys, key] });
        }
      },

      clearS3Selection: () => {
        set({ s3SelectedKeys: [] });
      },

      //------------------------------------------------------------------------
      // Uploads
      //------------------------------------------------------------------------

      uploadFiles: (files: File[], options = {}) => {
        const { selectedBucket, s3CurrentPrefix, settings } = get();
        if (!selectedBucket) return;

        const keyPrefix = options.keyPrefix ?? s3CurrentPrefix;
        const storageClass = options.storageClass ?? settings.defaultStorageClass;
        const encryption = options.encryption ?? settings.defaultEncryption;

        files.forEach(file => {
          transferQueue.addUpload(file, selectedBucket, keyPrefix, {
            storageClass,
            encryption,
            metadata: options.metadata,
            multipartThreshold: settings.upload.multipartThreshold,
          });
        });

        // Auto-start queue if not running
        if (!get().isQueueRunning) {
          get().startQueue();
        }
      },

      uploadFolder: (files: FileList, basePath: string, options = {}) => {
        const { selectedBucket, s3CurrentPrefix, settings } = get();
        if (!selectedBucket) return;

        const storageClass = options.storageClass ?? settings.defaultStorageClass;
        const encryption = options.encryption ?? settings.defaultEncryption;

        Array.from(files).forEach(file => {
          // Get relative path from webkitRelativePath
          const relativePath = (file as any).webkitRelativePath || file.name;
          const keyPrefix = s3CurrentPrefix + relativePath.substring(0, relativePath.lastIndexOf('/') + 1);

          transferQueue.addUpload(file, selectedBucket, keyPrefix, {
            storageClass,
            encryption,
            multipartThreshold: settings.upload.multipartThreshold,
          });
        });

        if (!get().isQueueRunning) {
          get().startQueue();
        }
      },

      //------------------------------------------------------------------------
      // Downloads
      //------------------------------------------------------------------------

      downloadFiles: (objects: S3Object[], destinationPath?: string) => {
        const { selectedBucket, settings } = get();
        if (!selectedBucket) return;

        const destPath = destinationPath || settings.download.defaultPath;

        objects.forEach(obj => {
          if (!obj.isFolder) {
            transferQueue.addDownload(
              selectedBucket,
              obj.key,
              obj.size,
              destPath
            );
          }
        });

        if (!get().isQueueRunning) {
          get().startQueue();
        }
      },

      downloadPrefix: async (prefix: string, destinationPath?: string) => {
        const { selectedBucket, settings } = get();
        if (!selectedBucket) return;

        const destPath = destinationPath || settings.download.defaultPath;

        // List all objects under prefix
        let continuationToken: string | undefined;
        do {
          const response = await s3Service.listObjects(
            selectedBucket,
            prefix,
            continuationToken,
            1000
          );

          response.objects.forEach(obj => {
            if (!obj.isFolder) {
              transferQueue.addDownload(
                selectedBucket,
                obj.key,
                obj.size,
                destPath
              );
            }
          });

          continuationToken = response.continuationToken;
        } while (continuationToken);

        if (!get().isQueueRunning) {
          get().startQueue();
        }
      },

      //------------------------------------------------------------------------
      // Queue Control
      //------------------------------------------------------------------------

      startQueue: () => {
        transferQueue.start();
        set({ isQueueRunning: true, isQueuePaused: false });
      },

      pauseQueue: () => {
        transferQueue.pause();
        set({ isQueuePaused: true });
      },

      resumeQueue: () => {
        transferQueue.resume();
        set({ isQueuePaused: false });
      },

      stopQueue: () => {
        transferQueue.stop();
        set({ isQueueRunning: false, isQueuePaused: false });
      },

      //------------------------------------------------------------------------
      // Item Control
      //------------------------------------------------------------------------

      pauseItem: (id: string) => transferQueue.pauseItem(id),
      resumeItem: (id: string) => transferQueue.resumeItem(id),
      cancelItem: (id: string) => transferQueue.cancelItem(id),
      retryItem: (id: string) => transferQueue.retryItem(id),
      removeItem: (id: string) => transferQueue.removeItem(id),

      clearCompleted: () => {
        transferQueue.clearCompleted();
        set({ transfers: transferQueue.getAllItems() });
      },

      //------------------------------------------------------------------------
      // Queue Settings
      //------------------------------------------------------------------------

      updateQueueSettings: (settings: Partial<QueueSettings>) => {
        transferQueue.updateSettings(settings);
        set({ 
          queueSettings: transferQueue.getSettings(),
          settings: {
            ...get().settings,
            queue: transferQueue.getSettings(),
          },
        });
      },

      //------------------------------------------------------------------------
      // History
      //------------------------------------------------------------------------

      clearHistory: () => {
        set({ history: [] });
      },

      //------------------------------------------------------------------------
      // Notifications
      //------------------------------------------------------------------------

      addNotification: (type: NotificationType, title: string, message: string) => {
        const notification: Notification = {
          id: crypto.randomUUID(),
          type,
          title,
          message,
          timestamp: new Date(),
          read: false,
        };
        set({ notifications: [...get().notifications, notification] });
      },

      markNotificationRead: (id: string) => {
        set({
          notifications: get().notifications.map(n =>
            n.id === id ? { ...n, read: true } : n
          ),
        });
      },

      clearNotifications: () => {
        set({ notifications: [] });
      },

      //------------------------------------------------------------------------
      // Settings
      //------------------------------------------------------------------------

      updateSettings: (settings: Partial<AppSettings>) => {
        set({ settings: { ...get().settings, ...settings } });
      },
    };
  })
);

//------------------------------------------------------------------------------
// Queue Event Handler
//------------------------------------------------------------------------------

function handleQueueEvent(
  event: QueueEvent,
  set: (state: Partial<TransferState>) => void,
  get: () => TransferState & TransferActions
) {
  // Update transfers list
  set({ transfers: transferQueue.getAllItems() });

  switch (event.type) {
    case 'itemCompleted':
      if (event.item) {
        // Add to history
        const historyEntry: TransferHistoryEntry = {
          id: event.item.id,
          direction: event.item.direction,
          sourcePath: event.item.sourcePath,
          destinationPath: event.item.direction === 'upload'
            ? `s3://${event.item.destinationBucket}/${event.item.destinationKey}`
            : event.item.destinationPath || '',
          size: event.item.sourceSize,
          status: 'completed',
          duration: event.item.progress.elapsedTime * 1000,
          averageSpeed: event.item.progress.speed,
          timestamp: new Date(),
          bucket: event.item.destinationBucket || '',
          checksumVerified: event.item.checksumVerified || false,
        };
        set({ history: [...get().history, historyEntry] });

        // Notification
        if (get().settings.notifications.onComplete) {
          get().addNotification(
            'success',
            'Transfer Complete',
            `${event.item.sourceName} ${event.item.direction === 'upload' ? 'uploaded' : 'downloaded'} successfully`
          );
        }

        // Refresh S3 on upload complete
        if (event.item.direction === 'upload') {
          get().refreshS3();
        }
      }
      break;

    case 'itemFailed':
      if (event.item && event.error) {
        // Add to history
        const historyEntry: TransferHistoryEntry = {
          id: event.item.id,
          direction: event.item.direction,
          sourcePath: event.item.sourcePath,
          destinationPath: event.item.direction === 'upload'
            ? `s3://${event.item.destinationBucket}/${event.item.destinationKey}`
            : event.item.destinationPath || '',
          size: event.item.sourceSize,
          status: 'failed',
          error: event.error,
          duration: event.item.progress.elapsedTime * 1000,
          averageSpeed: event.item.progress.speed,
          timestamp: new Date(),
          bucket: event.item.destinationBucket || '',
          checksumVerified: false,
        };
        set({ history: [...get().history, historyEntry] });

        // Notification
        if (get().settings.notifications.onError) {
          get().addNotification(
            'error',
            'Transfer Failed',
            `${event.item.sourceName}: ${event.error.message}`
          );
        }
      }
      break;

    case 'queueCompleted':
      get().addNotification('info', 'Queue Complete', 'All transfers have finished');
      set({ isQueueRunning: false });
      break;
  }
}

//------------------------------------------------------------------------------
// Selectors
//------------------------------------------------------------------------------

export const selectActiveTransfers = (state: TransferState) =>
  state.transfers.filter(t => t.status === 'transferring' || t.status === 'preparing');

export const selectPendingTransfers = (state: TransferState) =>
  state.transfers.filter(t => t.status === 'pending' || t.status === 'queued');

export const selectCompletedTransfers = (state: TransferState) =>
  state.transfers.filter(t => t.status === 'completed');

export const selectFailedTransfers = (state: TransferState) =>
  state.transfers.filter(t => t.status === 'failed');

export const selectUnreadNotifications = (state: TransferState) =>
  state.notifications.filter(n => !n.read);

export const selectTransferStats = (state: TransferState) => {
  const stats = transferQueue.getStats();
  return stats;
};