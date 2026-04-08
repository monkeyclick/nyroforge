import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ComputerDesktopIcon,
  PlusIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  XMarkIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';

interface InstanceTypeDetails {
  type: string;
  family: string;
  vcpus: number;
  memory: string;
  gpu: string;
  gpuMemory: string;
  storage: string;
  network: string;
  hourlyCost: number;
  monthlyCost: number;
  enabled: boolean;
}

interface DiscoverResponse {
  instanceTypes: InstanceTypeDetails[];
  byFamily: Record<string, InstanceTypeDetails[]>;
  totalTypes: number;
  families: string[];
  region: string;
  currentlyAllowed: string[];
}

export const InstanceTypeManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFamily, setSelectedFamily] = useState<string>('all');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [showDiscovery, setShowDiscovery] = useState(false);

  // Fetch currently allowed instance types
  const { data: allowedData, isLoading: loadingAllowed } = useQuery<{ instanceTypes: InstanceTypeDetails[]; totalTypes: number }>({
    queryKey: ['admin-instance-types'],
    queryFn: () => apiClient.get<{ instanceTypes: InstanceTypeDetails[]; totalTypes: number }>('/admin/instance-types'),
    refetchInterval: 30000,
  });

  // Discover available instance types
  const { data: discoveryData, isLoading: loadingDiscovery, refetch: refetchDiscovery } = useQuery<DiscoverResponse>({
    queryKey: ['discover-instance-types'],
    queryFn: () => apiClient.post<DiscoverResponse>('/admin/instance-types/discover', {}),
    enabled: showDiscovery,
  });

  // Update allowed instance types mutation
  const updateInstanceTypes = useMutation({
    mutationFn: (instanceTypes: string[]) =>
      apiClient.put('/admin/instance-types', { instanceTypes }),
    onSuccess: () => {
      // Invalidate all instance type related queries to ensure consistency
      // between admin panel and user-facing frontend
      queryClient.invalidateQueries({ queryKey: ['admin-instance-types'] });
      queryClient.invalidateQueries({ queryKey: ['discover-instance-types'] });
      queryClient.invalidateQueries({ queryKey: ['instance-types'] }); // User-facing cache
      toast.success('Instance types updated successfully');
      setShowDiscovery(false);
      setSelectedTypes(new Set());
    },
    onError: (error: any) => {
      toast.error(`Failed to update: ${error.message}`);
    },
  });

  const allowedTypes = allowedData?.instanceTypes || [];
  const allDiscovered = discoveryData?.instanceTypes || [];
  const families = discoveryData?.families || [];

  // Filter instance types based on search and family
  const filteredTypes = allDiscovered.filter(type => {
    const matchesSearch = searchTerm === '' ||
      type.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      type.family.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFamily = selectedFamily === 'all' || type.family === selectedFamily;
    return matchesSearch && matchesFamily;
  });

  const handleToggleType = (type: string) => {
    const newSelected = new Set(selectedTypes);
    if (newSelected.has(type)) {
      newSelected.delete(type);
    } else {
      newSelected.add(type);
    }
    setSelectedTypes(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedTypes.size === filteredTypes.length) {
      setSelectedTypes(new Set());
    } else {
      setSelectedTypes(new Set(filteredTypes.map(t => t.type)));
    }
  };

  const handleApplyChanges = () => {
    const enabledTypes = allDiscovered
      .filter(t => t.enabled || selectedTypes.has(t.type))
      .filter(t => !(!t.enabled && selectedTypes.has(t.type) && t.enabled === false))
      .map(t => t.type);
    
    // Combine currently enabled with newly selected, remove deselected
    const currentlyEnabled = new Set(discoveryData?.currentlyAllowed || []);
    const finalTypes = new Set<string>();
    
    // Add all currently enabled that weren't explicitly deselected
    currentlyEnabled.forEach(type => {
      if (!allDiscovered.find(t => t.type === type && !selectedTypes.has(type))) {
        finalTypes.add(type);
      }
    });
    
    // Add all newly selected
    selectedTypes.forEach(type => {
      finalTypes.add(type);
    });
    
    updateInstanceTypes.mutate(Array.from(finalTypes));
  };

  const handleRemoveType = (typeToRemove: string) => {
    const updatedTypes = allowedTypes
      .filter((t: InstanceTypeDetails) => t.type !== typeToRemove)
      .map((t: InstanceTypeDetails) => t.type);
    updateInstanceTypes.mutate(updatedTypes);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Instance Type Management</h2>
          <p className="mt-1 text-sm text-gray-600">
            Configure which EC2 instance types users can deploy
          </p>
        </div>
        <button
          onClick={() => {
            setShowDiscovery(!showDiscovery);
            if (!showDiscovery) {
              refetchDiscovery();
            }
          }}
          className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
        >
          {showDiscovery ? (
            <>
              <XMarkIcon className="h-5 w-5 mr-2" />
              Cancel Discovery
            </>
          ) : (
            <>
              <MagnifyingGlassIcon className="h-5 w-5 mr-2" />
              Discover New Types
            </>
          )}
        </button>
      </div>

      {/* Currently Allowed Types */}
      {!showDiscovery && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
            <h3 className="text-lg font-medium text-gray-900">
              Currently Allowed Instance Types
              <span className="ml-2 text-sm text-gray-500">
                ({allowedTypes.length})
              </span>
            </h3>
          </div>
          <div className="px-4 py-5 sm:p-6">
            {loadingAllowed ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : allowedTypes.length === 0 ? (
              <div className="text-center py-12">
                <ComputerDesktopIcon className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No instance types configured</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Click "Discover New Types" to add instance types.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {allowedTypes.map((type: InstanceTypeDetails) => (
                  <div
                    key={type.type}
                    className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900">{type.type}</h4>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          {type.family}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemoveType(type.type)}
                        className="text-red-600 hover:text-red-800"
                        title="Remove"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                    <dl className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-gray-500">vCPUs:</dt>
                        <dd className="text-gray-900 font-medium">{type.vcpus}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Memory:</dt>
                        <dd className="text-gray-900 font-medium">{type.memory}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-500">GPU:</dt>
                        <dd className="text-gray-900 font-medium">{type.gpu}</dd>
                      </div>
                      {type.gpu !== 'None' && type.gpuMemory !== 'N/A' && (
                        <div className="flex justify-between">
                          <dt className="text-gray-500">GPU Memory:</dt>
                          <dd className="text-gray-900 font-medium">{type.gpuMemory}</dd>
                        </div>
                      )}
                      <div className="flex justify-between pt-2 border-t border-gray-200 mt-2">
                        <dt className="text-gray-500">Hourly:</dt>
                        <dd className="text-gray-900 font-bold">${type.hourlyCost.toFixed(2)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Monthly:</dt>
                        <dd className="text-gray-900 font-bold">${type.monthlyCost.toFixed(0)}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Discovery Mode */}
      {showDiscovery && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white shadow rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Search Instance Types
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by type or family..."
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Filter by Family
                </label>
                <select
                  value={selectedFamily}
                  onChange={(e) => setSelectedFamily(e.target.value)}
                  className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                >
                  <option value="all">All Families</option>
                  {families.map(family => (
                    <option key={family} value={family}>{family}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Actions Bar */}
          <div className="bg-white shadow rounded-lg p-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleSelectAll}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  {selectedTypes.size === filteredTypes.length ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  onClick={() => refetchDiscovery()}
                  disabled={loadingDiscovery}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  <ArrowPathIcon className={`h-4 w-4 mr-2 ${loadingDiscovery ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <span className="text-sm text-gray-600">
                  {selectedTypes.size} selected
                </span>
              </div>
              <button
                onClick={handleApplyChanges}
                disabled={selectedTypes.size === 0 || updateInstanceTypes.isPending}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckIcon className="h-5 w-5 mr-2" />
                {updateInstanceTypes.isPending ? 'Applying...' : 'Apply Changes'}
              </button>
            </div>
          </div>

          {/* Instance Types Grid */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
              <h3 className="text-lg font-medium text-gray-900">
                Available Instance Types
                <span className="ml-2 text-sm text-gray-500">
                  ({filteredTypes.length} of {allDiscovered.length})
                </span>
              </h3>
            </div>
            <div className="px-4 py-5 sm:p-6">
              {loadingDiscovery ? (
                <div className="flex flex-col items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                  <p className="text-gray-600">Discovering instance types...</p>
                </div>
              ) : filteredTypes.length === 0 ? (
                <div className="text-center py-12">
                  <ComputerDesktopIcon className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No instance types found</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Try adjusting your search or filters.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredTypes.map((type) => {
                    const isSelected = selectedTypes.has(type.type);
                    const isCurrentlyEnabled = type.enabled;
                    
                    return (
                      <div
                        key={type.type}
                        onClick={() => handleToggleType(type.type)}
                        className={`
                          border-2 rounded-lg p-4 cursor-pointer transition-all
                          ${isCurrentlyEnabled ? 'bg-green-50 border-green-500' : 
                            isSelected ? 'bg-blue-50 border-blue-500' : 
                            'border-gray-200 hover:border-blue-300'}
                        `}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <h4 className="text-base font-semibold text-gray-900">{type.type}</h4>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              isCurrentlyEnabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {type.family}
                            </span>
                          </div>
                          <div className="ml-2">
                            {isCurrentlyEnabled ? (
                              <div className="bg-green-500 rounded-full p-1">
                                <CheckIcon className="h-4 w-4 text-white" />
                              </div>
                            ) : isSelected ? (
                              <div className="bg-blue-500 rounded-full p-1">
                                <CheckIcon className="h-4 w-4 text-white" />
                              </div>
                            ) : (
                              <div className="border-2 border-gray-300 rounded-full w-6 h-6" />
                            )}
                          </div>
                        </div>
                        <dl className="space-y-0.5 text-xs">
                          <div className="flex justify-between">
                            <dt className="text-gray-500">vCPUs:</dt>
                            <dd className="text-gray-900 font-medium">{type.vcpus}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">RAM:</dt>
                            <dd className="text-gray-900 font-medium">{type.memory}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">GPU:</dt>
                            <dd className="text-gray-900 font-medium truncate" title={type.gpu}>
                              {type.gpu.length > 15 ? type.gpu.substring(0, 15) + '...' : type.gpu}
                            </dd>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-gray-200 mt-1">
                            <dt className="text-gray-500">$/hr:</dt>
                            <dd className="text-gray-900 font-bold">${type.hourlyCost.toFixed(2)}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-gray-500">$/mo:</dt>
                            <dd className="text-gray-900 font-bold">${type.monthlyCost.toFixed(0)}</dd>
                          </div>
                        </dl>
                        {isCurrentlyEnabled && (
                          <div className="mt-2 pt-2 border-t border-green-200">
                            <p className="text-xs text-green-700 font-medium">Currently Enabled</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InstanceTypeManagement;