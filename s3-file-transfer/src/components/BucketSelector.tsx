//------------------------------------------------------------------------------
// Bucket Selector Component - S3 Bucket Selection and Management
//------------------------------------------------------------------------------

import React, { useState, useEffect, useRef } from 'react';
import {
  FolderOpen,
  ChevronDown,
  Plus,
  RefreshCw,
  Search,
  Globe,
  Lock,
  CheckCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useTransferStore } from '../stores/transferStore';
import { s3Service } from '../services/s3Service';

interface BucketInfo {
  name: string;
  creationDate?: Date;
  region?: string;
}

interface BucketSelectorProps {
  className?: string;
}

export const BucketSelector: React.FC<BucketSelectorProps> = ({ className }) => {
  const { currentBucket, setCurrentBucket, isConnected } = useTransferStore();
  
  const [isOpen, setIsOpen] = useState(false);
  const [buckets, setBuckets] = useState<BucketInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load buckets when connected
  useEffect(() => {
    if (isConnected) {
      loadBuckets();
    }
  }, [isConnected]);

  const loadBuckets = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const bucketList = await s3Service.listBuckets();
      setBuckets(bucketList.map(b => ({
        name: b.Name || '',
        creationDate: b.CreationDate,
      })));
    } catch (err: any) {
      setError(err.message || 'Failed to load buckets');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredBuckets = buckets.filter(bucket =>
    bucket.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectBucket = async (bucketName: string) => {
    await setCurrentBucket(bucketName);
    setIsOpen(false);
    setSearchQuery('');
  };

  if (!isConnected) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg text-gray-400 ${className}`}>
        <FolderOpen className="w-4 h-4" />
        <span className="text-sm">Not connected</span>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Selector Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-white border rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 min-w-[200px]"
      >
        <FolderOpen className="w-4 h-4 text-primary-600" />
        <span className="flex-1 text-left text-sm truncate">
          {currentBucket || 'Select bucket...'}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 mt-1 w-80 bg-white border rounded-lg shadow-lg overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search buckets..."
                className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
            </div>
          </div>

          {/* Bucket List */}
          <div className="max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : error ? (
              <div className="p-4 text-center">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <p className="text-sm text-red-600">{error}</p>
                <button
                  onClick={loadBuckets}
                  className="mt-2 text-sm text-primary-600 hover:underline"
                >
                  Retry
                </button>
              </div>
            ) : filteredBuckets.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                {searchQuery ? 'No buckets match your search' : 'No buckets found'}
              </div>
            ) : (
              filteredBuckets.map((bucket) => (
                <button
                  key={bucket.name}
                  onClick={() => handleSelectBucket(bucket.name)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 ${
                    currentBucket === bucket.name ? 'bg-primary-50' : ''
                  }`}
                >
                  <FolderOpen className={`w-4 h-4 ${
                    currentBucket === bucket.name ? 'text-primary-600' : 'text-gray-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${
                      currentBucket === bucket.name ? 'text-primary-700 font-medium' : 'text-gray-700'
                    }`}>
                      {bucket.name}
                    </p>
                    {bucket.creationDate && (
                      <p className="text-xs text-gray-400">
                        Created {bucket.creationDate.toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {currentBucket === bucket.name && (
                    <CheckCircle className="w-4 h-4 text-primary-600" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Actions */}
          <div className="p-2 border-t bg-gray-50 flex gap-2">
            <button
              onClick={loadBuckets}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded"
            >
              <Plus className="w-4 h-4" />
              Create Bucket
            </button>
          </div>
        </div>
      )}

      {/* Create Bucket Modal */}
      {showCreateModal && (
        <CreateBucketModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(bucketName) => {
            setShowCreateModal(false);
            loadBuckets();
            handleSelectBucket(bucketName);
          }}
        />
      )}
    </div>
  );
};

// Create Bucket Modal Component
interface CreateBucketModalProps {
  onClose: () => void;
  onCreated: (bucketName: string) => void;
}

const CreateBucketModal: React.FC<CreateBucketModalProps> = ({ onClose, onCreated }) => {
  const [bucketName, setBucketName] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [isPublic, setIsPublic] = useState(false);
  const [versioning, setVersioning] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regions = [
    { value: 'us-east-1', label: 'US East (N. Virginia)' },
    { value: 'us-east-2', label: 'US East (Ohio)' },
    { value: 'us-west-1', label: 'US West (N. California)' },
    { value: 'us-west-2', label: 'US West (Oregon)' },
    { value: 'eu-west-1', label: 'Europe (Ireland)' },
    { value: 'eu-west-2', label: 'Europe (London)' },
    { value: 'eu-central-1', label: 'Europe (Frankfurt)' },
    { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
    { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
    { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
  ];

  const validateBucketName = (name: string): string | null => {
    if (name.length < 3 || name.length > 63) {
      return 'Bucket name must be between 3 and 63 characters';
    }
    if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) {
      return 'Bucket name must start and end with a letter or number';
    }
    if (/\.\./.test(name)) {
      return 'Bucket name cannot contain consecutive periods';
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) {
      return 'Bucket name cannot be formatted as an IP address';
    }
    return null;
  };

  const handleCreate = async () => {
    const validationError = validateBucketName(bucketName);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      await s3Service.createBucket(bucketName, region);
      onCreated(bucketName);
    } catch (err: any) {
      setError(err.message || 'Failed to create bucket');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-800">Create New Bucket</h3>
        </div>

        <div className="p-4 space-y-4">
          {/* Bucket Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bucket Name
            </label>
            <input
              type="text"
              value={bucketName}
              onChange={(e) => setBucketName(e.target.value.toLowerCase())}
              placeholder="my-bucket-name"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Bucket names must be globally unique across all AWS accounts
            </p>
          </div>

          {/* Region */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Globe className="w-4 h-4 inline mr-1" />
              Region
            </label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {regions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Options */}
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={versioning}
                onChange={(e) => setVersioning(e.target.checked)}
                className="rounded text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Enable versioning</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="rounded text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Allow public access</span>
            </label>
            {isPublic && (
              <div className="ml-6 p-2 bg-yellow-50 rounded text-xs text-yellow-700">
                <AlertCircle className="w-3 h-3 inline mr-1" />
                Public buckets can be accessed by anyone on the internet
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating || !bucketName}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
          >
            {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Bucket
          </button>
        </div>
      </div>
    </div>
  );
};

export default BucketSelector;