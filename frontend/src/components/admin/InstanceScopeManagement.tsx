import React, { useState, useEffect, useCallback } from 'react';
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
  scope: 'in-scope' | 'out-of-scope' | 'unassigned';
  scopeSetAt?: string;
  scopeSetBy?: string;
}

interface ScopeSummary {
  total: number;
  inScope: number;
  outOfScope: number;
  unassigned: number;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
}

type ScopeFilter = 'all' | 'in-scope' | 'out-of-scope' | 'unassigned';

const InstanceScopeManagement: React.FC = () => {
  const [instances, setInstances] = useState<DiscoveredInstance[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 25,
    totalCount: 0,
    totalPages: 0,
    hasMore: false,
  });
  const [scopeSummary, setScopeSummary] = useState<ScopeSummary>({
    total: 0,
    inScope: 0,
    outOfScope: 0,
    unassigned: 0,
  });
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [searchValue, setSearchValue] = useState('');
  const [stateFilter, setStateFilter] = useState<string[]>(['running', 'stopped']);
  const [selectedInstances, setSelectedInstances] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showBulkActions, setShowBulkActions] = useState(false);

  // Fetch instances with scope status
  const fetchInstances = useCallback(async (page: number = 1) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pagination.pageSize.toString(),
        scopeFilter,
        states: stateFilter.join(','),
      });
      if (searchValue) {
        params.append('search', searchValue);
      }

      const data = await apiClient.get<{
        instances: DiscoveredInstance[];
        pagination: Pagination;
        scopeSummary: ScopeSummary;
      }>(`/ec2/scope/status?${params.toString()}`, true);

      setInstances(data.instances || []);
      setPagination(data.pagination || pagination);
      setScopeSummary(data.scopeSummary || scopeSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch instances');
    } finally {
      setIsLoading(false);
    }
  }, [scopeFilter, stateFilter, searchValue, pagination.pageSize]);

  // Initial load
  useEffect(() => {
    fetchInstances(1);
  }, [scopeFilter, stateFilter]);

  // Handle search
  const handleSearch = () => {
    setSelectedInstances(new Set());
    fetchInstances(1);
  };

  // Handle scope change for selected instances
  const handleSetScope = async (scope: 'in-scope' | 'out-of-scope') => {
    if (selectedInstances.size === 0) return;

    setIsUpdating(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await apiClient.post<{
        message: string;
        summary: { requested: number; success: number; errors: number };
      }>('/ec2/scope/set', {
        instanceIds: Array.from(selectedInstances),
        scope,
      }, true);

      setSuccessMessage(data.message);
      setSelectedInstances(new Set());
      fetchInstances(pagination.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update scope');
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle removing instances from management
  const handleRemoveFromManagement = async () => {
    if (selectedInstances.size === 0) return;

    const managedSelected = instances.filter(
      i => selectedInstances.has(i.instanceId) && i.scope === 'in-scope'
    );

    if (managedSelected.length === 0) {
      setError('No managed instances selected');
      return;
    }

    // TODO: Replace native confirm() with custom ConfirmationDialog component
    if (!confirm(`Are you sure you want to remove ${managedSelected.length} instance(s) from management? They will become unassigned. This action cannot be undone.`)) {
      return;
    }

    setIsUpdating(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await apiClient.post<{
        message: string;
        summary: { requested: number; removed: number; errors: number };
      }>('/ec2/scope/remove', {
        instanceIds: managedSelected.map(i => i.instanceId),
      }, true);

      setSuccessMessage(data.message);
      setSelectedInstances(new Set());
      fetchInstances(pagination.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove from management');
    } finally {
      setIsUpdating(false);
    }
  };

  // Toggle instance selection
  const toggleInstanceSelection = (instanceId: string) => {
    const newSelected = new Set(selectedInstances);
    if (newSelected.has(instanceId)) {
      newSelected.delete(instanceId);
    } else {
      newSelected.add(instanceId);
    }
    setSelectedInstances(newSelected);
  };

  // Toggle select all
  const toggleSelectAll = () => {
    if (selectedInstances.size === instances.length) {
      setSelectedInstances(new Set());
    } else {
      setSelectedInstances(new Set(instances.map(i => i.instanceId)));
    }
  };

  // Get scope badge
  const getScopeBadge = (scope: string) => {
    switch (scope) {
      case 'in-scope':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
            ✓ In Scope
          </span>
        );
      case 'out-of-scope':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
            ✗ Out of Scope
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
            ? Unassigned
          </span>
        );
    }
  };

  // Get state badge
  const getStateBadge = (state: string) => {
    const colors: Record<string, string> = {
      running: 'bg-green-100 text-green-800',
      stopped: 'bg-red-100 text-red-800',
      pending: 'bg-yellow-100 text-yellow-800',
      stopping: 'bg-orange-100 text-orange-800',
    };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[state] || 'bg-gray-100 text-gray-800'}`}>
        {state}
      </span>
    );
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Instance Scope Management</h2>
            <p className="text-sm text-gray-500">
              Manage which EC2 instances are in scope for workstation management
            </p>
          </div>
          <button
            onClick={() => fetchInstances(1)}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
          >
            {isLoading ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div 
            className={`p-3 rounded-lg cursor-pointer transition-colors ${
              scopeFilter === 'all' ? 'bg-blue-100 border-2 border-blue-500' : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
            }`}
            onClick={() => setScopeFilter('all')}
          >
            <div className="text-2xl font-bold text-gray-900">{scopeSummary.total}</div>
            <div className="text-xs text-gray-500">Total Instances</div>
          </div>
          <div 
            className={`p-3 rounded-lg cursor-pointer transition-colors ${
              scopeFilter === 'in-scope' ? 'bg-green-100 border-2 border-green-500' : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
            }`}
            onClick={() => setScopeFilter('in-scope')}
          >
            <div className="text-2xl font-bold text-green-600">{scopeSummary.inScope}</div>
            <div className="text-xs text-gray-500">In Scope (Managed)</div>
          </div>
          <div 
            className={`p-3 rounded-lg cursor-pointer transition-colors ${
              scopeFilter === 'out-of-scope' ? 'bg-red-100 border-2 border-red-500' : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
            }`}
            onClick={() => setScopeFilter('out-of-scope')}
          >
            <div className="text-2xl font-bold text-red-600">{scopeSummary.outOfScope}</div>
            <div className="text-xs text-gray-500">Out of Scope (Excluded)</div>
          </div>
          <div 
            className={`p-3 rounded-lg cursor-pointer transition-colors ${
              scopeFilter === 'unassigned' ? 'bg-yellow-100 border-2 border-yellow-500' : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
            }`}
            onClick={() => setScopeFilter('unassigned')}
          >
            <div className="text-2xl font-bold text-yellow-600">{scopeSummary.unassigned}</div>
            <div className="text-xs text-gray-500">Unassigned</div>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search by name, ID, or type..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">States:</span>
            {['running', 'stopped'].map((state) => (
              <label key={state} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={stateFilter.includes(state)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setStateFilter([...stateFilter, state]);
                    } else {
                      setStateFilter(stateFilter.filter(s => s !== state));
                    }
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {state}
              </label>
            ))}
          </div>

          <button
            onClick={handleSearch}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Search
          </button>
        </div>
      </div>

      {/* Error / Success Messages */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
          {successMessage}
        </div>
      )}

      {/* Bulk Actions */}
      {selectedInstances.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-blue-800">
              {selectedInstances.size} instance(s) selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSetScope('in-scope')}
                disabled={isUpdating}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                ✓ Set In Scope
              </button>
              <button
                onClick={() => handleSetScope('out-of-scope')}
                disabled={isUpdating}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                ✗ Set Out of Scope
              </button>
              <button
                onClick={handleRemoveFromManagement}
                disabled={isUpdating}
                className="px-3 py-1.5 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
              >
                Remove from Management
              </button>
              <button
                onClick={() => setSelectedInstances(new Set())}
                className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
              >
                Clear Selection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instance Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  <input
                    type="checkbox"
                    checked={instances.length > 0 && selectedInstances.size === instances.length}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Scope
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Name
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Instance ID
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Type
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  State
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  IP Address
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Launch Date
                </th>
                <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                    <div className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Loading instances...
                    </div>
                  </td>
                </tr>
              ) : instances.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                    No instances found matching the current filters.
                  </td>
                </tr>
              ) : (
                instances.map((instance) => (
                  <tr 
                    key={instance.instanceId}
                    className={`hover:bg-gray-50 ${selectedInstances.has(instance.instanceId) ? 'bg-blue-50' : ''}`}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedInstances.has(instance.instanceId)}
                        onChange={() => toggleInstanceSelection(instance.instanceId)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-3 py-3">
                      {getScopeBadge(instance.scope)}
                    </td>
                    <td className="px-3 py-3 text-sm font-medium text-gray-900 max-w-[180px] truncate" title={instance.name}>
                      {instance.name || '-'}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500 font-mono">
                      {instance.instanceId}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">
                      {instance.instanceType}
                    </td>
                    <td className="px-3 py-3">
                      {getStateBadge(instance.state)}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">
                      {instance.publicIp || instance.privateIp || '-'}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">
                      {formatDate(instance.launchTime)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {instance.scope !== 'in-scope' && (
                          <button
                            onClick={() => {
                              setSelectedInstances(new Set([instance.instanceId]));
                              handleSetScope('in-scope');
                            }}
                            disabled={isUpdating}
                            className="p-1 text-green-600 hover:bg-green-50 rounded"
                            title="Add to scope"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                        )}
                        {instance.scope !== 'out-of-scope' && (
                          <button
                            onClick={() => {
                              if (instance.scope === 'in-scope') {
                                setSelectedInstances(new Set([instance.instanceId]));
                                handleRemoveFromManagement();
                              } else {
                                setSelectedInstances(new Set([instance.instanceId]));
                                handleSetScope('out-of-scope');
                              }
                            }}
                            disabled={isUpdating}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                            title={instance.scope === 'in-scope' ? 'Remove from management' : 'Exclude from scope'}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="text-sm text-gray-600">
              Showing {((pagination.page - 1) * pagination.pageSize) + 1} to{' '}
              {Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of{' '}
              {pagination.totalCount} instances
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchInstances(pagination.page - 1)}
                disabled={pagination.page <= 1 || isLoading}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => fetchInstances(pagination.page + 1)}
                disabled={!pagination.hasMore || isLoading}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Help Text */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-900 mb-2">About Instance Scope</h3>
        <div className="text-sm text-gray-600 space-y-1">
          <p><span className="font-medium text-green-600">In Scope:</span> Instances that are managed by this workstation system. Users can start, stop, and manage these workstations.</p>
          <p><span className="font-medium text-red-600">Out of Scope:</span> Instances that are explicitly excluded from management. They won't appear in user dashboards.</p>
          <p><span className="font-medium text-yellow-600">Unassigned:</span> New instances that haven't been classified yet. Review these and decide their scope.</p>
        </div>
      </div>
    </div>
  );
};

export default InstanceScopeManagement;