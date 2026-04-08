import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../../services/api';

interface DiscoveredInstance {
  instanceId: string;
  name: string;
  instanceType: string;
  instanceFamily: string;
  state: string;
  publicIp?: string;
  privateIp?: string;
  vpcId?: string;
  subnetId?: string;
  availabilityZone?: string;
  launchTime?: string;
  platform?: string;
  tags: Record<string, string>;
  isManaged: boolean;
  workstationId?: string;
}

interface InstanceFamily {
  family: string;
  name: string;
  description: string;
  typeCount: number;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
}

interface AddExistingInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type SearchTab = 'name' | 'family' | 'type';

const AddExistingInstanceModal: React.FC<AddExistingInstanceModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  // Search state
  const [activeTab, setActiveTab] = useState<SearchTab>('name');
  const [nameSearch, setNameSearch] = useState('');
  const [selectedFamily, setSelectedFamily] = useState('');
  const [typeSearch, setTypeSearch] = useState('');
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
  const [typeSuggestions, setTypeSuggestions] = useState<string[]>([]);
  const [families, setFamilies] = useState<InstanceFamily[]>([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [showTypeSuggestions, setShowTypeSuggestions] = useState(false);
  
  // Results state
  const [instances, setInstances] = useState<DiscoveredInstance[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 15,
    totalCount: 0,
    totalPages: 0,
    hasMore: false,
  });
  const [selectedInstances, setSelectedInstances] = useState<Set<string>>(new Set());
  
  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Filter state
  const [excludeManaged, setExcludeManaged] = useState(true);
  const [instanceStates, setInstanceStates] = useState<string[]>(['running', 'stopped']);
  
  const nameInputRef = useRef<HTMLInputElement>(null);
  const typeInputRef = useRef<HTMLInputElement>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

  // Fetch instance families on mount
  useEffect(() => {
    if (isOpen) {
      fetchFamilies();
    }
  }, [isOpen]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab('name');
      setNameSearch('');
      setSelectedFamily('');
      setTypeSearch('');
      setInstances([]);
      setSelectedInstances(new Set());
      setError(null);
      setSuccessMessage(null);
    }
  }, [isOpen]);

  const fetchFamilies = async () => {
    try {
      // Use Admin API for EC2 discovery
      const data = await apiClient.get<{ families: InstanceFamily[] }>('/ec2/families', true);
      setFamilies(data.families || []);
    } catch (err) {
      console.error('Failed to fetch instance families:', err);
    }
  };

  const fetchNameSuggestions = async (prefix: string) => {
    if (prefix.length < 2) {
      setNameSuggestions([]);
      return;
    }

    try {
      // Use Admin API for EC2 discovery
      const data = await apiClient.get<{ suggestions: string[] }>(
        `/ec2/suggestions/names?prefix=${encodeURIComponent(prefix)}`, true
      );
      setNameSuggestions(data.suggestions || []);
    } catch (err) {
      console.error('Failed to fetch name suggestions:', err);
    }
  };

  const fetchTypeSuggestions = async (prefix: string) => {
    if (prefix.length < 1) {
      setTypeSuggestions([]);
      return;
    }

    try {
      // Use Admin API for EC2 discovery
      const data = await apiClient.get<{ suggestions: string[] }>(
        `/ec2/suggestions/types?prefix=${encodeURIComponent(prefix)}`, true
      );
      setTypeSuggestions(data.suggestions || []);
    } catch (err) {
      console.error('Failed to fetch type suggestions:', err);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setNameSearch(value);
    setShowNameSuggestions(true);

    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }

    debounceTimeout.current = setTimeout(() => {
      fetchNameSuggestions(value);
    }, 300);
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTypeSearch(value);
    setShowTypeSuggestions(true);

    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }

    debounceTimeout.current = setTimeout(() => {
      fetchTypeSuggestions(value);
    }, 300);
  };

  const discoverInstances = useCallback(async (page: number = 1) => {
    setIsLoading(true);
    setError(null);

    try {
      let searchType: 'name' | 'family' | 'type' | 'all' = activeTab;
      let searchValue = '';

      switch (activeTab) {
        case 'name':
          searchValue = nameSearch;
          if (!searchValue) searchType = 'all';
          break;
        case 'family':
          searchValue = selectedFamily;
          break;
        case 'type':
          searchValue = typeSearch;
          break;
      }

      // Use Admin API for EC2 discovery
      const data = await apiClient.post<{
        instances: DiscoveredInstance[];
        pagination: Pagination;
      }>('/ec2/discover', {
        searchType,
        searchValue,
        page,
        pageSize: pagination.pageSize,
        filters: {
          states: instanceStates,
          excludeManaged,
        },
      }, true);

      setInstances(data.instances || []);
      setPagination(data.pagination || {
        page: 1,
        pageSize: 15,
        totalCount: 0,
        totalPages: 0,
        hasMore: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover instances');
      setInstances([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, nameSearch, selectedFamily, typeSearch, instanceStates, excludeManaged, pagination.pageSize]);

  const handleSearch = () => {
    setSelectedInstances(new Set());
    discoverInstances(1);
  };

  const handlePageChange = (newPage: number) => {
    discoverInstances(newPage);
  };

  const toggleInstanceSelection = (instanceId: string) => {
    const newSelected = new Set(selectedInstances);
    if (newSelected.has(instanceId)) {
      newSelected.delete(instanceId);
    } else {
      newSelected.add(instanceId);
    }
    setSelectedInstances(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedInstances.size === instances.length) {
      setSelectedInstances(new Set());
    } else {
      setSelectedInstances(new Set(instances.map(i => i.instanceId)));
    }
  };

  const importSelectedInstances = async () => {
    if (selectedInstances.size === 0) return;

    setIsImporting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // Use Admin API for EC2 import
      const data = await apiClient.post<{
        message: string;
        summary: { requested: number; imported: number; errors: number };
        results: Array<{ instanceId: string; workstationId: string; status: string; error?: string }>;
      }>('/ec2/import', {
        instances: Array.from(selectedInstances).map(instanceId => ({
          instanceId,
        })),
      }, true);

      const { summary } = data;
      setSuccessMessage(
        `Successfully imported ${summary.imported} instance(s). ${summary.errors > 0 ? `${summary.errors} failed.` : ''}`
      );

      // Refresh the list
      setSelectedInstances(new Set());
      discoverInstances(pagination.page);

      // Notify parent
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import instances');
    } finally {
      setIsImporting(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case 'running':
        return 'bg-green-100 text-green-800';
      case 'stopped':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'stopping':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="inline-block w-full max-w-6xl px-4 pt-5 pb-4 overflow-hidden text-left align-bottom transition-all transform bg-white rounded-lg shadow-xl sm:my-8 sm:align-middle sm:p-6">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b">
            <h3 className="text-lg font-medium text-gray-900">
              Add Existing EC2 Instances
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search Tabs */}
          <div className="mt-4">
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8">
                <button
                  onClick={() => setActiveTab('name')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'name'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Search by Name
                </button>
                <button
                  onClick={() => setActiveTab('family')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'family'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Search by Family
                </button>
                <button
                  onClick={() => setActiveTab('type')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'type'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Search by Type
                </button>
              </nav>
            </div>

            {/* Search Input */}
            <div className="mt-4 flex items-end gap-4">
              {activeTab === 'name' && (
                <div className="flex-1 relative">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Instance Name or ID
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={nameSearch}
                    onChange={handleNameChange}
                    onFocus={() => setShowNameSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowNameSuggestions(false), 200)}
                    placeholder="Enter instance name or ID..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                  {showNameSuggestions && nameSuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                      {nameSuggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setNameSearch(suggestion);
                            setShowNameSuggestions(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'family' && (
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Instance Family
                  </label>
                  <select
                    value={selectedFamily}
                    onChange={(e) => setSelectedFamily(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select a family...</option>
                    {families.map((family) => (
                      <option key={family.family} value={family.family}>
                        {family.name} - {family.description}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {activeTab === 'type' && (
                <div className="flex-1 relative">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Instance Type (supports wildcards: g4dn.*, *.xlarge)
                  </label>
                  <input
                    ref={typeInputRef}
                    type="text"
                    value={typeSearch}
                    onChange={handleTypeChange}
                    onFocus={() => setShowTypeSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowTypeSuggestions(false), 200)}
                    placeholder="e.g., g4dn.xlarge, m5.*, *.2xlarge"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                  {showTypeSuggestions && typeSuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                      {typeSuggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setTypeSearch(suggestion);
                            setShowTypeSuggestions(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Filters */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={excludeManaged}
                    onChange={(e) => setExcludeManaged(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Hide managed instances
                </label>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">States:</span>
                  {['running', 'stopped'].map((state) => (
                    <label key={state} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={instanceStates.includes(state)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setInstanceStates([...instanceStates, state]);
                          } else {
                            setInstanceStates(instanceStates.filter(s => s !== state));
                          }
                        }}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      {state}
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={handleSearch}
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          {/* Error / Success Messages */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700">
              {error}
            </div>
          )}

          {successMessage && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700">
              {successMessage}
            </div>
          )}

          {/* Results Table */}
          <div className="mt-4 border rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input
                        type="checkbox"
                        checked={instances.length > 0 && selectedInstances.size === instances.length}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Instance ID
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      State
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      IP Address
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      AZ
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Launch Time
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                        <div className="flex items-center justify-center gap-2">
                          <svg className="animate-spin h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Searching for instances...
                        </div>
                      </td>
                    </tr>
                  ) : instances.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                        {pagination.totalCount === 0 
                          ? 'No instances found. Try adjusting your search criteria.'
                          : 'Click "Search" to discover EC2 instances.'
                        }
                      </td>
                    </tr>
                  ) : (
                    instances.map((instance) => (
                      <tr 
                        key={instance.instanceId}
                        className={`hover:bg-gray-50 ${selectedInstances.has(instance.instanceId) ? 'bg-blue-50' : ''}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedInstances.has(instance.instanceId)}
                            onChange={() => toggleInstanceSelection(instance.instanceId)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-3 py-2 text-sm font-medium text-gray-900 max-w-[200px] truncate" title={instance.name}>
                          {instance.name || '-'}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-500 font-mono">
                          {instance.instanceId}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-500">
                          {instance.instanceType}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStateColor(instance.state)}`}>
                            {instance.state}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-500">
                          {instance.publicIp || instance.privateIp || '-'}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-500">
                          {instance.availabilityZone?.split('-').pop() || '-'}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-500 whitespace-nowrap">
                          {formatDate(instance.launchTime)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing {((pagination.page - 1) * pagination.pageSize) + 1} to{' '}
                {Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of{' '}
                {pagination.totalCount} instances
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="px-3 py-1 border rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={!pagination.hasMore}
                  className="px-3 py-1 border rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-6 pt-4 border-t flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {selectedInstances.size} instance(s) selected
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={importSelectedInstances}
                disabled={selectedInstances.size === 0 || isImporting}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isImporting 
                  ? 'Importing...' 
                  : `Import ${selectedInstances.size > 0 ? `(${selectedInstances.size})` : ''}`
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddExistingInstanceModal;