import React, { useState } from 'react';
import {
  UserGroupIcon,
  ComputerDesktopIcon,
  ChartBarIcon,
  ShieldCheckIcon,
  CurrencyDollarIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import LaunchWorkstationModal from '../workstation/LaunchWorkstationModal';
import { UserManagementModal } from '../admin/UserManagementModal';
import SecurityManagement from '../admin/SecurityManagement';
import InstanceTypeManagement from '../admin/InstanceTypeManagement';
import { CostAnalyticsChart } from '../dashboard/CostAnalyticsChart';
import { StatusMetrics } from '../dashboard/StatusMetrics';
import { apiClient } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { Workstation } from '../../types';

interface AdminDashboardProps {
  className?: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ className }) => {
  const { user, isAdmin } = useAuthStore();
  const queryClient = useQueryClient();
  
  const [activeTab, setActiveTab] = useState<'overview' | 'costs' | 'users' | 'security' | 'instance-types'>('overview');
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [filterUserId, setFilterUserId] = useState<string>('');

  // Fetch dashboard data
  const { data: dashboardData, isLoading: loadingDashboard } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => apiClient.getDashboardStatus(),
    refetchInterval: 30000,
    retry: 3,
  });

  // Fetch cost analytics
  const { data: costData, isLoading: loadingCosts } = useQuery({
    queryKey: ['cost-analytics', selectedPeriod, filterUserId],
    queryFn: () => apiClient.getCostAnalytics(selectedPeriod, filterUserId || undefined),
    refetchInterval: 300000,
    retry: 2,
  });

  // Fetch all workstations
  const { data: workstations, isLoading: loadingWorkstations } = useQuery({
    queryKey: ['admin-workstations', filterUserId],
    queryFn: () => apiClient.getWorkstations(filterUserId || undefined),
    refetchInterval: 30000,
    retry: 3,
  });

  // Terminate workstation mutation
  const terminateWorkstation = useMutation({
    mutationFn: (workstationId: string) => apiClient.terminateWorkstation(workstationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-workstations'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
      toast.success('Workstation terminated successfully');
    },
    onError: (error: any) => {
      toast.error(`Failed to terminate: ${error.message}`);
    },
  });

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <svg className="mx-auto h-12 w-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h3 className="mt-2 text-lg font-medium text-gray-900">Access Denied</h3>
          <p className="mt-1 text-sm text-gray-500">You need admin privileges to access this page.</p>
        </div>
      </div>
    );
  }

  const summary = dashboardData?.summary || {
    totalInstances: 0,
    runningInstances: 0,
    stoppedInstances: 0,
    terminatingInstances: 0,
    totalHourlyCost: 0,
    estimatedMonthlyCost: 0,
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage workstations and monitor system metrics
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowUserModal(true)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <UserGroupIcon className="h-4 w-4 mr-2" />
            Users
          </button>
          <button
            onClick={() => setShowLaunchModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            <ComputerDesktopIcon className="h-4 w-4 mr-2" />
            Launch
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('overview')}
            className={`${
              activeTab === 'overview'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm inline-flex items-center`}
          >
            <ChartBarIcon className="h-5 w-5 mr-2" />
            Overview
          </button>
          <button
            onClick={() => setActiveTab('costs')}
            className={`${
              activeTab === 'costs'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm inline-flex items-center`}
          >
            <CurrencyDollarIcon className="h-5 w-5 mr-2" />
            Costs
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`${
              activeTab === 'users'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm inline-flex items-center`}
          >
            <UserGroupIcon className="h-5 w-5 mr-2" />
            Users
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`${
              activeTab === 'security'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm inline-flex items-center`}
          >
            <ShieldCheckIcon className="h-5 w-5 mr-2" />
            Security
          </button>
          <button
            onClick={() => setActiveTab('instance-types')}
            className={`${
              activeTab === 'instance-types'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm inline-flex items-center`}
          >
            <CpuChipIcon className="h-5 w-5 mr-2" />
            Instance Types
          </button>
        </nav>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <ComputerDesktopIcon className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Instances</dt>
                      <dd className="text-2xl font-semibold text-gray-900">{summary.totalInstances}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-6 w-6 rounded-full bg-green-100 flex items-center justify-center">
                      <div className="h-2 w-2 rounded-full bg-green-600"></div>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Running</dt>
                      <dd className="text-2xl font-semibold text-green-600">{summary.runningInstances}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <CurrencyDollarIcon className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Hourly Cost</dt>
                      <dd className="text-2xl font-semibold text-gray-900">${summary.totalHourlyCost.toFixed(2)}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <CurrencyDollarIcon className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Monthly Est.</dt>
                      <dd className="text-2xl font-semibold text-gray-900">${summary.estimatedMonthlyCost.toFixed(0)}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white shadow rounded-lg p-4">
            <div className="flex flex-wrap gap-4 items-center">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value as any)}
                  className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Filter by User</label>
                <input
                  type="text"
                  placeholder="Enter user email..."
                  value={filterUserId}
                  onChange={(e) => setFilterUserId(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
              {filterUserId && (
                <div className="flex items-end">
                  <button
                    onClick={() => setFilterUserId('')}
                    className="px-3 py-2 text-sm text-blue-600 hover:text-blue-800"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Cost Breakdown</h3>
              {loadingCosts ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <CostAnalyticsChart data={costData || null} />
              )}
            </div>

            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Instance Status</h3>
              {loadingDashboard ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <StatusMetrics data={dashboardData?.instances || []} />
              )}
            </div>
          </div>

          {/* Workstations Table */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
              <h3 className="text-lg font-medium text-gray-900">
                All Workstations
                {workstations?.workstations && (
                  <span className="ml-2 text-sm text-gray-500">
                    ({workstations.workstations.length})
                  </span>
                )}
              </h3>
            </div>
            <div className="px-4 py-5 sm:p-6">
              {loadingWorkstations ? (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : workstations?.workstations?.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Instance</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {workstations.workstations.map((ws: Workstation) => (
                        <tr key={ws.PK} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {ws.instanceId}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {ws.userId}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {ws.instanceType}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {ws.region}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 text-xs font-semibold rounded-full ${
                              ws.status === 'running' ? 'bg-green-100 text-green-800' :
                              ws.status === 'stopped' ? 'bg-gray-100 text-gray-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {ws.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                            {ws.publicIp || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => terminateWorkstation.mutate(ws.instanceId)}
                              disabled={terminateWorkstation.isPending}
                              className="text-red-600 hover:text-red-900 disabled:opacity-50"
                            >
                              {terminateWorkstation.isPending ? 'Terminating...' : 'Terminate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <ComputerDesktopIcon className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No workstations</h3>
                  <p className="mt-1 text-sm text-gray-500">Get started by launching a new workstation.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Costs Tab */}
      {activeTab === 'costs' && (
        <div className="space-y-6">
          {/* Live Cost Summary */}
          <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
            <h2 className="text-2xl font-bold mb-4">Live Cost Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white bg-opacity-20 rounded-lg p-4">
                <div className="text-3xl font-bold">${summary.totalHourlyCost.toFixed(2)}</div>
                <div className="text-sm opacity-90">Current Hourly Rate</div>
                <div className="text-xs opacity-75 mt-1">
                  Based on {summary.runningInstances} running instance{summary.runningInstances !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="bg-white bg-opacity-20 rounded-lg p-4">
                <div className="text-3xl font-bold">${(summary.totalHourlyCost * 24).toFixed(2)}</div>
                <div className="text-sm opacity-90">Daily Projection</div>
                <div className="text-xs opacity-75 mt-1">If current usage continues</div>
              </div>
              <div className="bg-white bg-opacity-20 rounded-lg p-4">
                <div className="text-3xl font-bold">${(summary.totalHourlyCost * 24 * 7).toFixed(2)}</div>
                <div className="text-sm opacity-90">Weekly Projection</div>
                <div className="text-xs opacity-75 mt-1">Based on current rate</div>
              </div>
              <div className="bg-white bg-opacity-20 rounded-lg p-4">
                <div className="text-3xl font-bold">${summary.estimatedMonthlyCost.toFixed(0)}</div>
                <div className="text-sm opacity-90">Monthly Estimate</div>
                <div className="text-xs opacity-75 mt-1">30-day projection</div>
              </div>
            </div>
          </div>

          {/* Cost Analytics Filters */}
          <div className="bg-white shadow rounded-lg p-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Historic Cost Analytics</h3>
            <div className="flex flex-wrap gap-4 items-center">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Time Period</label>
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value as any)}
                  className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                >
                  <option value="daily">Last 7 Days</option>
                  <option value="weekly">Last 4 Weeks</option>
                  <option value="monthly">Last 12 Months</option>
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Filter by User</label>
                <input
                  type="text"
                  placeholder="Enter user email to filter costs..."
                  value={filterUserId}
                  onChange={(e) => setFilterUserId(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                />
              </div>
              {filterUserId && (
                <div className="flex items-end">
                  <button
                    onClick={() => setFilterUserId('')}
                    className="px-3 py-2 text-sm text-blue-600 hover:text-blue-800"
                  >
                    Clear Filter
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Historic Cost Charts */}
          <div className="bg-white shadow rounded-lg p-6">
            {loadingCosts ? (
              <div className="flex items-center justify-center h-96">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-4 text-gray-600">Loading cost analytics...</p>
                </div>
              </div>
            ) : costData ? (
              <CostAnalyticsChart data={costData} />
            ) : (
              <div className="flex items-center justify-center h-96">
                <div className="text-center">
                  <CurrencyDollarIcon className="mx-auto h-16 w-16 text-gray-400" />
                  <h3 className="mt-4 text-lg font-medium text-gray-900">No Cost Data Available</h3>
                  <p className="mt-2 text-sm text-gray-500">
                    Cost analytics will appear once workstations have been launched and used.
                  </p>
                  <div className="mt-6">
                    <button
                      onClick={() => setShowLaunchModal(true)}
                      className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                    >
                      <ComputerDesktopIcon className="h-5 w-5 mr-2" />
                      Launch First Workstation
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Cost Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Cost Insights</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Most Expensive Instance Type</span>
                  <span className="text-sm text-gray-900">
                    {costData && Object.keys(costData.breakdown.byInstanceType).length > 0
                      ? Object.entries(costData.breakdown.byInstanceType).sort((a, b) => b[1] - a[1])[0][0]
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Highest Cost Region</span>
                  <span className="text-sm text-gray-900">
                    {costData && Object.keys(costData.breakdown.byRegion).length > 0
                      ? Object.entries(costData.breakdown.byRegion).sort((a, b) => b[1] - a[1])[0][0]
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Average Daily Cost</span>
                  <span className="text-sm text-gray-900">
                    ${costData?.trends.dailyAverage.toFixed(2) || '0.00'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-700">Total Users with Costs</span>
                  <span className="text-sm text-gray-900">
                    {costData ? Object.keys(costData.breakdown.byUser).length : 0}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <button
                  onClick={() => {
                    setSelectedPeriod('daily');
                    setFilterUserId('');
                  }}
                  className="w-full flex items-center justify-between p-3 text-left border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <span className="text-sm font-medium text-gray-700">View Daily Costs</span>
                  <ChartBarIcon className="h-5 w-5 text-gray-400" />
                </button>
                <button
                  onClick={() => {
                    setSelectedPeriod('weekly');
                    setFilterUserId('');
                  }}
                  className="w-full flex items-center justify-between p-3 text-left border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <span className="text-sm font-medium text-gray-700">View Weekly Costs</span>
                  <ChartBarIcon className="h-5 w-5 text-gray-400" />
                </button>
                <button
                  onClick={() => {
                    setSelectedPeriod('monthly');
                    setFilterUserId('');
                  }}
                  className="w-full flex items-center justify-between p-3 text-left border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <span className="text-sm font-medium text-gray-700">View Monthly Costs</span>
                  <ChartBarIcon className="h-5 w-5 text-gray-400" />
                </button>
                <button
                  onClick={() => setActiveTab('overview')}
                  className="w-full flex items-center justify-between p-3 text-left border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <span className="text-sm font-medium text-gray-700">Back to Overview</span>
                  <ChartBarIcon className="h-5 w-5 text-gray-400" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="text-center py-12">
            <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">User Management</h3>
            <p className="mt-1 text-sm text-gray-500">
              Manage users, roles, and permissions
            </p>
            <div className="mt-6">
              <button
                onClick={() => setShowUserModal(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                <UserGroupIcon className="h-5 w-5 mr-2" />
                Open User Management
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <SecurityManagement />
      )}

      {/* Instance Types Tab */}
      {activeTab === 'instance-types' && (
        <InstanceTypeManagement />
      )}

      {/* Modals */}
      {showLaunchModal && (
        <LaunchWorkstationModal
          isOpen={showLaunchModal}
          onClose={() => setShowLaunchModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['admin-workstations'] });
            queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
            setShowLaunchModal(false);
          }}
        />
      )}

      {showUserModal && (
        <UserManagementModal
          isOpen={showUserModal}
          onClose={() => setShowUserModal(false)}
        />
      )}
    </div>
  );
};

export default AdminDashboard;