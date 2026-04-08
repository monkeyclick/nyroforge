//------------------------------------------------------------------------------
// S3 File Transfer Application - Main App Component
//------------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import {
  CloudIcon,
  Settings,
  History,
  Bell,
  HardDrive,
  FolderOpen,
  Upload,
  Download,
} from 'lucide-react';
import { useTransferStore, selectUnreadNotifications } from './stores/transferStore';
import { S3Browser } from './components/S3Browser';
import { UploadDropzone } from './components/UploadDropzone';
import { TransferList } from './components/TransferList';
import { CredentialManager } from './components/CredentialManager';
import { BucketSelector } from './components/BucketSelector';

type Tab = 'browser' | 'upload' | 'transfers' | 'history' | 'settings';

const App: React.FC = () => {
  const {
    initialize,
    initialized,
    isConnected,
    selectedBucket,
    notifications,
  } = useTransferStore();

  const unreadNotifications = useTransferStore(selectUnreadNotifications);

  const [activeTab, setActiveTab] = useState<Tab>('browser');
  const [showCredentials, setShowCredentials] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  // Initialize on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Show credentials modal if not connected
  useEffect(() => {
    if (initialized && !isConnected) {
      setShowCredentials(true);
    }
  }, [initialized, isConnected]);

  const tabs = [
    { id: 'browser' as Tab, label: 'Browse S3', icon: FolderOpen },
    { id: 'upload' as Tab, label: 'Upload', icon: Upload },
    { id: 'transfers' as Tab, label: 'Transfers', icon: Download },
    { id: 'history' as Tab, label: 'History', icon: History },
    { id: 'settings' as Tab, label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <CloudIcon className="w-8 h-8 text-primary-600" />
            <h1 className="text-xl font-bold text-gray-800">S3 File Transfer</h1>
          </div>

          <div className="flex items-center gap-4">
            {/* Connection status */}
            <button
              onClick={() => setShowCredentials(true)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                isConnected
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              <HardDrive className="w-4 h-4" />
              <span className="text-sm font-medium">
                {isConnected ? 'Connected' : 'Not Connected'}
              </span>
            </button>

            {/* Notifications */}
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              <Bell className="w-5 h-5" />
              {unreadNotifications.length > 0 && (
                <span className="absolute top-0 right-0 w-4 h-4 text-xs bg-red-500 text-white rounded-full flex items-center justify-center">
                  {unreadNotifications.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Bucket selector */}
        {isConnected && (
          <div className="px-4 py-2 border-t bg-gray-50">
            <BucketSelector />
          </div>
        )}
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-56 bg-white border-r flex-shrink-0">
          <ul className="p-2 space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <li key={tab.id}>
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left ${
                      activeTab === tab.id
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {tab.label}
                    {tab.id === 'transfers' && (
                      <TransferBadge />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Content area */}
        <main className="flex-1 overflow-hidden">
          {activeTab === 'browser' && (
            <S3Browser className="h-full" />
          )}
          {activeTab === 'upload' && (
            <div className="h-full p-6 overflow-auto">
              <UploadDropzone className="max-w-3xl mx-auto" />
            </div>
          )}
          {activeTab === 'transfers' && (
            <TransferList className="h-full" />
          )}
          {activeTab === 'history' && (
            <TransferHistory className="h-full" />
          )}
          {activeTab === 'settings' && (
            <SettingsPanel className="h-full" />
          )}
        </main>
      </div>

      {/* Credential Manager Modal */}
      {showCredentials && (
        <CredentialManager onClose={() => setShowCredentials(false)} />
      )}

      {/* Notifications Panel */}
      {showNotifications && (
        <NotificationsPanel
          notifications={notifications}
          onClose={() => setShowNotifications(false)}
        />
      )}
    </div>
  );
};

// Transfer count badge
const TransferBadge: React.FC = () => {
  const transfers = useTransferStore((state) => state.transfers);
  const activeCount = transfers.filter(
    (t) => t.status === 'transferring' || t.status === 'pending'
  ).length;

  if (activeCount === 0) return null;

  return (
    <span className="ml-auto px-2 py-0.5 text-xs bg-primary-500 text-white rounded-full">
      {activeCount}
    </span>
  );
};

// Transfer History Component (placeholder)
const TransferHistory: React.FC<{ className?: string }> = ({ className }) => {
  const history = useTransferStore((state) => state.history);
  const clearHistory = useTransferStore((state) => state.clearHistory);

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-medium text-gray-700">Transfer History</h2>
        {history.length > 0 && (
          <button
            onClick={clearHistory}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear History
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {history.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No transfer history</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((entry) => (
              <div key={entry.id} className="p-3 bg-white rounded-lg border">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{entry.sourcePath}</span>
                  <span className={`text-sm ${
                    entry.status === 'completed' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {entry.status}
                  </span>
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  {new Date(entry.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Settings Panel Component (placeholder)
const SettingsPanel: React.FC<{ className?: string }> = ({ className }) => {
  const settings = useTransferStore((state) => state.settings);
  const updateSettings = useTransferStore((state) => state.updateSettings);

  return (
    <div className={`overflow-auto p-6 ${className}`}>
      <h2 className="text-lg font-medium text-gray-700 mb-6">Settings</h2>
      
      <div className="max-w-2xl space-y-6">
        {/* Queue Settings */}
        <section className="bg-white rounded-lg border p-4">
          <h3 className="font-medium text-gray-700 mb-4">Queue Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Max Concurrent Transfers
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={settings.queue.maxConcurrentTransfers}
                onChange={(e) => updateSettings({
                  queue: { ...settings.queue, maxConcurrentTransfers: parseInt(e.target.value) }
                })}
                className="w-24 px-3 py-2 border rounded"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoRetry"
                checked={settings.queue.autoRetry}
                onChange={(e) => updateSettings({
                  queue: { ...settings.queue, autoRetry: e.target.checked }
                })}
                className="rounded"
              />
              <label htmlFor="autoRetry" className="text-sm text-gray-600">
                Auto-retry failed transfers
              </label>
            </div>
          </div>
        </section>

        {/* Checksum Settings */}
        <section className="bg-white rounded-lg border p-4">
          <h3 className="font-medium text-gray-700 mb-4">Integrity Verification</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="checksumEnabled"
                checked={settings.checksum.enabled}
                onChange={(e) => updateSettings({
                  checksum: { ...settings.checksum, enabled: e.target.checked }
                })}
                className="rounded"
              />
              <label htmlFor="checksumEnabled" className="text-sm text-gray-600">
                Verify file integrity with checksums
              </label>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Checksum Algorithm
              </label>
              <select
                value={settings.checksum.algorithm}
                onChange={(e) => updateSettings({
                  checksum: { ...settings.checksum, algorithm: e.target.value as 'MD5' | 'SHA256' }
                })}
                className="px-3 py-2 border rounded"
              >
                <option value="MD5">MD5</option>
                <option value="SHA256">SHA-256</option>
              </select>
            </div>
          </div>
        </section>

        {/* Notification Settings */}
        <section className="bg-white rounded-lg border p-4">
          <h3 className="font-medium text-gray-700 mb-4">Notifications</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="notifyComplete"
                checked={settings.notifications.onComplete}
                onChange={(e) => updateSettings({
                  notifications: { ...settings.notifications, onComplete: e.target.checked }
                })}
                className="rounded"
              />
              <label htmlFor="notifyComplete" className="text-sm text-gray-600">
                Notify on transfer complete
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="notifyError"
                checked={settings.notifications.onError}
                onChange={(e) => updateSettings({
                  notifications: { ...settings.notifications, onError: e.target.checked }
                })}
                className="rounded"
              />
              <label htmlFor="notifyError" className="text-sm text-gray-600">
                Notify on transfer error
              </label>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

// Notifications Panel
const NotificationsPanel: React.FC<{
  notifications: any[];
  onClose: () => void;
}> = ({ notifications, onClose }) => {
  const clearNotifications = useTransferStore((state) => state.clearNotifications);
  const markNotificationRead = useTransferStore((state) => state.markNotificationRead);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute top-16 right-4 w-80 bg-white rounded-lg shadow-xl border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b">
          <h3 className="font-medium text-gray-700">Notifications</h3>
          {notifications.length > 0 && (
            <button
              onClick={clearNotifications}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-auto">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No notifications
            </div>
          ) : (
            notifications.map((notification) => (
              <div
                key={notification.id}
                className={`p-3 border-b hover:bg-gray-50 cursor-pointer ${
                  !notification.read ? 'bg-blue-50' : ''
                }`}
                onClick={() => markNotificationRead(notification.id)}
              >
                <div className="flex items-start gap-2">
                  <div className={`w-2 h-2 mt-1.5 rounded-full ${
                    notification.type === 'success' ? 'bg-green-500' :
                    notification.type === 'error' ? 'bg-red-500' :
                    notification.type === 'warning' ? 'bg-yellow-500' :
                    'bg-blue-500'
                  }`} />
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-700">
                      {notification.title}
                    </div>
                    <div className="text-xs text-gray-500">
                      {notification.message}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(notification.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default App;