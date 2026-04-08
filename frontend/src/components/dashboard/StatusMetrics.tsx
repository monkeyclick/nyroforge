import React from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { InstanceStatusInfo } from '../../types';

interface StatusMetricsProps {
  data: InstanceStatusInfo[];
}

const COLORS = {
  running: '#10B981',
  launching: '#F59E0B',
  stopping: '#F97316',
  stopped: '#6B7280',
  terminated: '#EF4444',
};

export const StatusMetrics: React.FC<StatusMetricsProps> = ({ data }) => {
  // Group instances by status
  const statusData = data.reduce((acc, instance) => {
    const status = instance.status;
    if (!acc[status]) {
      acc[status] = 0;
    }
    acc[status]++;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.entries(statusData).map(([status, count]) => ({
    name: status.charAt(0).toUpperCase() + status.slice(1),
    value: count,
    color: COLORS[status as keyof typeof COLORS] || '#6B7280',
  }));

  // Group instances by region
  const regionData = data.reduce((acc, instance) => {
    const region = instance.region;
    if (!acc[region]) {
      acc[region] = {
        region,
        running: 0,
        stopped: 0,
        total: 0,
      };
    }
    acc[region][instance.status as 'running' | 'stopped']++;
    acc[region].total++;
    return acc;
  }, {} as Record<string, { region: string; running: number; stopped: number; total: number }>);

  const barData = Object.values(regionData);

  // Performance metrics for running instances
  const runningInstances = data.filter(instance => instance.status === 'running');
  const avgCpuUtilization = runningInstances.length > 0 
    ? runningInstances.reduce((sum, instance) => sum + (instance.cpuUtilization || 0), 0) / runningInstances.length
    : 0;

  const totalNetworkIn = runningInstances.reduce((sum, instance) => sum + (instance.networkIn || 0), 0);
  const totalNetworkOut = runningInstances.reduce((sum, instance) => sum + (instance.networkOut || 0), 0);

  return (
    <div className="space-y-6">
      {/* Status Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded-lg border">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Instance Status Distribution</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Instances by Region</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="region" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="running" stackId="a" fill="#10B981" name="Running" />
                <Bar dataKey="stopped" stackId="a" fill="#6B7280" name="Stopped" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      {runningInstances.length > 0 && (
        <div className="bg-white p-4 rounded-lg border">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Performance Metrics (Running Instances)</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {avgCpuUtilization.toFixed(1)}%
              </div>
              <div className="text-sm text-gray-500">Avg CPU Utilization</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {totalNetworkIn.toFixed(1)} MB
              </div>
              <div className="text-sm text-gray-500">Total Network In</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {totalNetworkOut.toFixed(1)} MB
              </div>
              <div className="text-sm text-gray-500">Total Network Out</div>
            </div>
          </div>
        </div>
      )}

      {/* Instance List */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h4 className="text-sm font-medium text-gray-900">Instance Details</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Instance
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Region
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Runtime
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cost/Hour
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.map((instance) => (
                <tr key={instance.instanceId}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div>
                      <div className="font-medium">{instance.workstationId}</div>
                      <div className="text-gray-500">{instance.instanceId}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        instance.status === 'running'
                          ? 'bg-green-100 text-green-800'
                          : instance.status === 'launching'
                          ? 'bg-yellow-100 text-yellow-800'
                          : instance.status === 'stopping'
                          ? 'bg-orange-100 text-orange-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {instance.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {instance.instanceType}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {instance.region}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {instance.runTime}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${instance.hourlyCost.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default StatusMetrics;