import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/api';

interface CostData {
  period: string;
  totalCost: number;
  breakdown: {
    byInstanceType: Record<string, number>;
    byUser: Record<string, number>;
    byRegion: Record<string, number>;
    byProject: Record<string, number>;
  };
  trends: {
    dailyAverage: number;
    weeklyAverage: number;
    monthlyTotal: number;
    projectedMonthly: number;
  };
  costOptimizationSuggestions: string[];
  dailyCosts?: Array<{ date: string; amount: number }>;
  lastUpdated: string;
}

interface CostAnalyticsProps {
  summary: {
    totalHourlyCost: number;
    estimatedMonthlyCost: number;
    runningInstances: number;
  };
}

export default function CostAnalytics({ summary }: CostAnalyticsProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [showAlertConfig, setShowAlertConfig] = useState(false);
  const [alertThreshold, setAlertThreshold] = useState('1000');
  const [alertEmail, setAlertEmail] = useState('');

  const { data: costData, isLoading: loadingCosts } = useQuery({
    queryKey: ['cost-analytics', selectedPeriod, filterUserId],
    queryFn: () => apiClient.getCostAnalytics(selectedPeriod, filterUserId || undefined),
    refetchInterval: 300000,
    retry: 2,
  });

  const exportToCSV = () => {
    if (!costData) return;

    const rows = [
      ['Cost Analytics Report'],
      ['Period', selectedPeriod],
      ['Generated', new Date().toISOString()],
      ['Total Cost', `$${costData.totalCost.toFixed(2)}`],
      [''],
      ['Instance Type', 'Cost'],
      ...Object.entries(costData.breakdown.byInstanceType).map(([type, cost]) => [
        type,
        `$${cost.toFixed(2)}`
      ]),
      [''],
      ['Region', 'Cost'],
      ...Object.entries(costData.breakdown.byRegion).map(([region, cost]) => [
        region,
        `$${cost.toFixed(2)}`
      ]),
      [''],
      ['User', 'Cost'],
      ...Object.entries(costData.breakdown.byUser).map(([user, cost]) => [
        user,
        `$${cost.toFixed(2)}`
      ]),
    ];

    const csvContent = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cost-analytics-${selectedPeriod}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const saveAlertConfig = () => {
    // Save to localStorage for now
    localStorage.setItem('costAlertConfig', JSON.stringify({
      threshold: parseFloat(alertThreshold),
      email: alertEmail,
      enabled: true,
    }));
    alert('Cost alert configured successfully!');
    setShowAlertConfig(false);
  };

  return (
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

      {/* Cost Analytics Filters & Actions */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="flex flex-wrap gap-4 items-center">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Time Period</label>
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value as any)}
                className="block w-full pl-3 pr-10 py-2 text-sm border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 rounded-md"
              >
                <option value="daily">Last 7 Days</option>
                <option value="weekly">Last 4 Weeks</option>
                <option value="monthly">Last 12 Months</option>
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Filter by User</label>
              <input
                type="text"
                placeholder="Enter user email..."
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            {filterUserId && (
              <div className="flex items-end">
                <button
                  onClick={() => setFilterUserId('')}
                  className="px-3 py-2 text-xs text-blue-600 hover:text-blue-800"
                >
                  Clear Filter
                </button>
              </div>
            )}
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => setShowAlertConfig(true)}
              className="px-3 py-2 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              Alerts
            </button>
            <button
              onClick={exportToCSV}
              disabled={!costData}
              className="px-3 py-2 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Cost Data Display */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        {loadingCosts ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-sm text-gray-600">Loading cost analytics...</p>
            </div>
          </div>
        ) : costData ? (
          <div className="space-y-6">
            {/* Cost Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  ${costData.totalCost.toFixed(2)}
                </div>
                <div className="text-xs text-blue-700">Total Cost</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  ${costData.trends.dailyAverage.toFixed(2)}
                </div>
                <div className="text-xs text-green-700">Daily Average</div>
              </div>
              <div className="bg-yellow-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">
                  ${costData.trends.weeklyAverage.toFixed(2)}
                </div>
                <div className="text-xs text-yellow-700">Weekly Average</div>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">
                  ${costData.trends.projectedMonthly.toFixed(0)}
                </div>
                <div className="text-xs text-purple-700">Monthly Projection</div>
              </div>
            </div>

            {/* Cost Optimization Suggestions */}
            {costData.costOptimizationSuggestions && costData.costOptimizationSuggestions.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-amber-900 mb-2">Cost Optimization Suggestions</h4>
                    <ul className="space-y-1">
                      {costData.costOptimizationSuggestions.map((suggestion, idx) => (
                        <li key={idx} className="text-xs text-amber-800 flex items-start gap-2">
                          <span className="text-amber-600">•</span>
                          <span>{suggestion}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Cost Breakdown Table */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Cost Breakdown</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Percentage</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {Object.entries(costData.breakdown.byInstanceType).map(([type, cost]) => (
                      <tr key={`instance-${type}`}>
                        <td className="px-4 py-3 text-sm text-gray-500">Instance Type</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{type}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">${cost.toFixed(2)}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {((cost / costData.totalCost) * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                    {Object.entries(costData.breakdown.byRegion).map(([region, cost]) => (
                      <tr key={`region-${region}`}>
                        <td className="px-4 py-3 text-sm text-gray-500">Region</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{region}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">${cost.toFixed(2)}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {((cost / costData.totalCost) * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Cost Insights */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Cost Insights</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Most Expensive Type</span>
                    <span className="text-gray-900 font-medium">
                      {Object.keys(costData.breakdown.byInstanceType).length > 0
                        ? Object.entries(costData.breakdown.byInstanceType).sort((a, b) => b[1] - a[1])[0][0]
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Highest Cost Region</span>
                    <span className="text-gray-900 font-medium">
                      {Object.keys(costData.breakdown.byRegion).length > 0
                        ? Object.entries(costData.breakdown.byRegion).sort((a, b) => b[1] - a[1])[0][0]
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Users with Costs</span>
                    <span className="text-gray-900 font-medium">
                      {Object.keys(costData.breakdown.byUser).length}
                    </span>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h4>
                <div className="space-y-2">
                  <button
                    onClick={() => { setSelectedPeriod('daily'); setFilterUserId(''); }}
                    className="w-full text-left px-3 py-2 text-sm border border-gray-300 rounded hover:bg-white"
                  >
                    View Daily Costs
                  </button>
                  <button
                    onClick={() => { setSelectedPeriod('weekly'); setFilterUserId(''); }}
                    className="w-full text-left px-3 py-2 text-sm border border-gray-300 rounded hover:bg-white"
                  >
                    View Weekly Costs
                  </button>
                  <button
                    onClick={() => { setSelectedPeriod('monthly'); setFilterUserId(''); }}
                    className="w-full text-left px-3 py-2 text-sm border border-gray-300 rounded hover:bg-white"
                  >
                    View Monthly Costs
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="mt-4 text-sm font-medium text-gray-900">No Cost Data Available</h3>
              <p className="mt-2 text-xs text-gray-500">
                Cost analytics will appear once workstations have been launched and used.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Alert Configuration Modal */}
      {showAlertConfig && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Configure Cost Alerts</h3>
              <button
                onClick={() => setShowAlertConfig(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Monthly Cost Threshold ($)
                </label>
                <input
                  type="number"
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="1000"
                />
                <p className="mt-1 text-xs text-gray-500">
                  You'll be alerted when monthly costs exceed this amount
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Alert Email (Optional)
                </label>
                <input
                  type="email"
                  value={alertEmail}
                  onChange={(e) => setAlertEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="admin@example.com"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Leave blank to use your account email
                </p>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => setShowAlertConfig(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveAlertConfig}
                className="px-4 py-2 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700"
              >
                Save Alert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}