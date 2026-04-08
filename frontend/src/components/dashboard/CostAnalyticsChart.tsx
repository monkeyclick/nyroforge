import React from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar 
} from 'recharts';
import { CostData } from '../../types';

interface CostAnalyticsChartProps {
  data: CostData | null;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

export const CostAnalyticsChart: React.FC<CostAnalyticsChartProps> = ({ data }) => {
  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <div className="text-center">
          <div className="text-lg font-medium">No cost data available</div>
          <div className="text-sm">Cost data will appear once workstations are launched</div>
        </div>
      </div>
    );
  }

  // Prepare data for charts
  const instanceTypeData = Object.entries(data.breakdown.byInstanceType).map(([type, cost]) => ({
    name: type,
    value: cost,
  }));

  const userCostData = Object.entries(data.breakdown.byUser).map(([user, cost]) => ({
    name: user.split('@')[0], // Just show username part
    value: cost,
  }));

  const regionData = Object.entries(data.breakdown.byRegion).map(([region, cost]) => ({
    name: region,
    cost: cost,
  }));

  // Mock trend data for demonstration
  const trendData = [
    { date: '2024-01-01', cost: data.trends.dailyAverage * 0.8 },
    { date: '2024-01-02', cost: data.trends.dailyAverage * 0.9 },
    { date: '2024-01-03', cost: data.trends.dailyAverage * 1.1 },
    { date: '2024-01-04', cost: data.trends.dailyAverage * 1.0 },
    { date: '2024-01-05', cost: data.trends.dailyAverage * 1.2 },
    { date: '2024-01-06', cost: data.trends.dailyAverage * 1.1 },
    { date: '2024-01-07', cost: data.trends.dailyAverage },
  ];

  return (
    <div className="space-y-6">
      {/* Cost Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-blue-600">
            ${data.totalCost.toFixed(2)}
          </div>
          <div className="text-sm text-blue-700">Total Cost</div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-green-600">
            ${data.trends.dailyAverage.toFixed(2)}
          </div>
          <div className="text-sm text-green-700">Daily Average</div>
        </div>
        <div className="bg-yellow-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-yellow-600">
            ${data.trends.weeklyAverage.toFixed(2)}
          </div>
          <div className="text-sm text-yellow-700">Weekly Average</div>
        </div>
        <div className="bg-purple-50 p-4 rounded-lg">
          <div className="text-2xl font-bold text-purple-600">
            ${data.trends.projectedMonthly.toFixed(0)}
          </div>
          <div className="text-sm text-purple-700">Monthly Projection</div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost Trend */}
        <div className="bg-white p-4 rounded-lg border">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Cost Trend</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(date) => new Date(date).toLocaleDateString()}
                />
                <YAxis tickFormatter={(value) => `$${value.toFixed(0)}`} />
                <Tooltip 
                  formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Cost']}
                  labelFormatter={(date) => new Date(date).toLocaleDateString()}
                />
                <Line 
                  type="monotone" 
                  dataKey="cost" 
                  stroke="#0088FE" 
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost by Instance Type */}
        <div className="bg-white p-4 rounded-lg border">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Cost by Instance Type</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={instanceTypeData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {instanceTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `$${Number(value).toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost by User */}
        <div className="bg-white p-4 rounded-lg border">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Cost by User</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={userCostData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  type="number" 
                  tickFormatter={(value) => `$${value.toFixed(0)}`}
                />
                <YAxis dataKey="name" type="category" width={80} />
                <Tooltip formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Cost']} />
                <Bar dataKey="value" fill="#00C49F" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost by Region */}
        <div className="bg-white p-4 rounded-lg border">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Cost by Region</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={regionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(value) => `$${value.toFixed(0)}`} />
                <Tooltip formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Cost']} />
                <Bar dataKey="cost" fill="#FFBB28" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Cost Optimization Suggestions */}
      {data.costOptimizationSuggestions.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-yellow-800 mb-3">
            💡 Cost Optimization Suggestions
          </h4>
          <ul className="space-y-2">
            {data.costOptimizationSuggestions.map((suggestion, index) => (
              <li key={index} className="flex items-start">
                <div className="flex-shrink-0 w-4 h-4 bg-yellow-400 rounded-full mt-0.5 mr-3" />
                <span className="text-sm text-yellow-700">{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Detailed Breakdown Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h4 className="text-sm font-medium text-gray-900">Detailed Cost Breakdown</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Item
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cost
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Percentage
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {Object.entries(data.breakdown.byInstanceType).map(([type, cost]) => (
                <tr key={`instance-${type}`}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    Instance Type
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {type}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${cost.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {((cost / data.totalCost) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
              {Object.entries(data.breakdown.byRegion).map(([region, cost]) => (
                <tr key={`region-${region}`}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    Region
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {region}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${cost.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {((cost / data.totalCost) * 100).toFixed(1)}%
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

export default CostAnalyticsChart;