import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowDownTrayIcon,
  ClockIcon,
  UserIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

interface AuditLog {
  auditId: string;
  userId: string;
  userEmail?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: string;
  timestamp: string;
  ipAddress: string;
  success?: boolean;
}

interface AuditFilters {
  userId?: string;
  action?: string;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
  success?: boolean;
}

const AuditLogsViewer: React.FC = () => {
  const { hasPermission } = useAuthStore();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  // Check permissions
  if (!hasPermission('analytics:read')) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ExclamationCircleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600">Access denied. Analytics permissions required.</p>
        </div>
      </div>
    );
  }

  // Fetch audit logs
  const { data: auditData, isLoading, error } = useQuery({
    queryKey: ['audit-logs', filters, searchTerm, currentPage],
    queryFn: () => fetchAuditLogs({ ...filters, search: searchTerm }, currentPage),
    refetchOnWindowFocus: false,
  });

  // Mock function - replace with actual API call
  async function fetchAuditLogs(filters: AuditFilters & { search?: string }, page: number = 1) {
    // This would be replaced with actual API call
    // For now, return mock data
    const mockLogs: AuditLog[] = [
      {
        auditId: '1',
        userId: 'admin@company.com',
        userEmail: 'admin@company.com',
        action: 'CREATE_USER',
        resourceType: 'user',
        resourceId: 'john@company.com',
        details: JSON.stringify({ roles: ['workstation-user'], groups: ['default'] }),
        timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        ipAddress: '192.168.1.100',
        success: true,
      },
      {
        auditId: '2', 
        userId: 'john@company.com',
        userEmail: 'john@company.com',
        action: 'CREATE_WORKSTATION',
        resourceType: 'workstation',
        resourceId: 'ws-12345',
        details: JSON.stringify({ instanceType: 'g4dn.xlarge', region: 'us-east-1' }),
        timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        ipAddress: '192.168.1.101',
        success: true,
      },
      {
        auditId: '3',
        userId: 'admin@company.com', 
        userEmail: 'admin@company.com',
        action: 'UPDATE_ROLE',
        resourceType: 'role',
        resourceId: 'workstation-user',
        details: JSON.stringify({ added_permissions: ['workstations:read'], removed_permissions: [] }),
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
        ipAddress: '192.168.1.100',
        success: true,
      },
      {
        auditId: '4',
        userId: 'jane@company.com',
        userEmail: 'jane@company.com', 
        action: 'DENIED_ACCESS',
        resourceType: 'workstation',
        resourceId: 'ws-67890',
        details: JSON.stringify({ reason: 'insufficient_permissions' }),
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
        ipAddress: '192.168.1.102',
        success: false,
      }
    ];

    return {
      logs: mockLogs,
      pagination: {
        total: mockLogs.length,
        page: 1,
        limit: 50,
        pages: 1
      }
    };
  }

  const handleFilterChange = (key: keyof AuditFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value || undefined
    }));
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilters({});
    setSearchTerm('');
    setCurrentPage(1);
  };

  const exportLogs = async () => {
    try {
      // This would call an API to export logs as CSV/Excel
      console.log('Exporting audit logs...');
      // For now, just download current view as JSON
      const dataStr = JSON.stringify(auditData?.logs || [], null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      
      const url = window.URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-logs-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getActionColor = (action: string, success?: boolean) => {
    if (success === false) return 'text-red-600 bg-red-50';
    
    if (action.startsWith('CREATE')) return 'text-green-600 bg-green-50';
    if (action.startsWith('UPDATE')) return 'text-blue-600 bg-blue-50';
    if (action.startsWith('DELETE')) return 'text-red-600 bg-red-50';
    if (action.startsWith('DENIED')) return 'text-orange-600 bg-orange-50';
    
    return 'text-gray-600 bg-gray-50';
  };

  const getActionIcon = (action: string, success?: boolean) => {
    if (success === false) {
      return <XCircleIcon className="h-4 w-4 text-red-500" />;
    }
    
    if (action.startsWith('CREATE') || action.startsWith('UPDATE')) {
      return <CheckCircleIcon className="h-4 w-4 text-green-500" />;
    }
    
    if (action.startsWith('DELETE')) {
      return <XCircleIcon className="h-4 w-4 text-red-500" />;
    }
    
    if (action.startsWith('DENIED')) {
      return <ExclamationCircleIcon className="h-4 w-4 text-orange-500" />;
    }
    
    return <ClockIcon className="h-4 w-4 text-gray-500" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Audit Logs</h3>
          <p className="text-sm text-gray-500">
            System activity and security audit trail
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <FunnelIcon className="h-4 w-4 mr-2" />
            Filters
          </button>
          <button
            onClick={exportLogs}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
            Export
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border">
        <div className="flex items-center space-x-4 mb-4">
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search logs by user, action, or resource..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User</label>
              <input
                type="text"
                placeholder="Filter by user email"
                value={filters.userId || ''}
                onChange={(e) => handleFilterChange('userId', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
              <select
                value={filters.action || ''}
                onChange={(e) => handleFilterChange('action', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Actions</option>
                <option value="CREATE_USER">Create User</option>
                <option value="UPDATE_USER">Update User</option>
                <option value="DELETE_USER">Delete User</option>
                <option value="CREATE_WORKSTATION">Create Workstation</option>
                <option value="DELETE_WORKSTATION">Delete Workstation</option>
                <option value="DENIED_ACCESS">Access Denied</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Resource Type</label>
              <select
                value={filters.resourceType || ''}
                onChange={(e) => handleFilterChange('resourceType', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Resources</option>
                <option value="user">User</option>
                <option value="role">Role</option>
                <option value="group">Group</option>
                <option value="workstation">Workstation</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
              <div className="flex space-x-2">
                <input
                  type="date"
                  value={filters.startDate || ''}
                  onChange={(e) => handleFilterChange('startDate', e.target.value)}
                  className="flex-1 px-2 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="date"
                  value={filters.endDate || ''}
                  onChange={(e) => handleFilterChange('endDate', e.target.value)}
                  className="flex-1 px-2 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </motion.div>
        )}

        {(Object.keys(filters).some(key => filters[key as keyof AuditFilters]) || searchTerm) && (
          <div className="mt-4 pt-4 border-t">
            <button
              onClick={clearFilters}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Audit Logs List */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="px-6 py-4 border-b border-gray-200">
          <h4 className="text-lg font-medium text-gray-900">
            Activity Log
            {auditData?.logs && (
              <span className="text-sm text-gray-500 ml-2">
                ({auditData.logs.length} events)
              </span>
            )}
          </h4>
        </div>

        <div className="divide-y divide-gray-200">
          {auditData?.logs?.map((log) => (
            <motion.div
              key={log.auditId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-6 hover:bg-gray-50"
            >
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  {getActionIcon(log.action, log.success)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getActionColor(log.action, log.success)}`}>
                        {log.action.replace(/_/g, ' ')}
                      </span>
                      <span className="text-sm text-gray-500">
                        on {log.resourceType}
                      </span>
                    </div>
                    <time className="text-sm text-gray-500 flex items-center">
                      <ClockIcon className="h-4 w-4 mr-1" />
                      {formatTimestamp(log.timestamp)}
                    </time>
                  </div>

                  <div className="mt-1">
                    <div className="flex items-center text-sm text-gray-600">
                      <UserIcon className="h-4 w-4 mr-1" />
                      <span className="font-medium">{log.userEmail || log.userId}</span>
                      <span className="mx-2">•</span>
                      <span>Resource: {log.resourceId}</span>
                      <span className="mx-2">•</span>
                      <span>IP: {log.ipAddress}</span>
                    </div>
                  </div>

                  {log.details && (
                    <div className="mt-2">
                      <details className="text-sm text-gray-600">
                        <summary className="cursor-pointer text-blue-600 hover:text-blue-800">
                          Show details
                        </summary>
                        <pre className="mt-2 p-3 bg-gray-100 rounded text-xs overflow-x-auto">
                          {JSON.stringify(JSON.parse(log.details), null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}

          {auditData?.logs?.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No audit logs found matching the current filters.
            </div>
          )}
        </div>

        {/* Pagination */}
        {auditData?.pagination && auditData.pagination.pages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing {((currentPage - 1) * (auditData.pagination.limit || 50)) + 1} to{' '}
                {Math.min(currentPage * (auditData.pagination.limit || 50), auditData.pagination.total)} of{' '}
                {auditData.pagination.total} logs
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setCurrentPage(Math.min(auditData.pagination.pages, currentPage + 1))}
                  disabled={currentPage === auditData.pagination.pages}
                  className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLogsViewer;