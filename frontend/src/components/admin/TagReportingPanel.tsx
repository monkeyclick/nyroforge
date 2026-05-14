import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../services/api';
import { TagReportResponse, WorkstationTagCompliance } from '../../types';

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportWorkstationsCsv(workstations: WorkstationTagCompliance[]) {
  const headers = ['Workstation ID', 'Instance ID', 'Name', 'User', 'Platform', 'OS', 'State', 'Compliant', 'Non-compliant Templates', 'Missing Fields'];
  const rows = workstations.map(w => [
    w.workstationId,
    w.instanceId || '',
    w.name,
    w.userId,
    w.platform || '',
    w.osVersion || '',
    w.state || '',
    w.overallCompliant ? 'Yes' : 'No',
    w.templateCompliance.filter(tc => !tc.compliant).map(tc => tc.templateName).join('; '),
    w.templateCompliance.flatMap(tc => tc.missingFields).join('; '),
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tag-compliance-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PercentBar({ value }: { value: number }) {
  const color = value >= 90 ? 'bg-green-500' : value >= 60 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-sm font-medium text-gray-700 w-10 text-right">{value}%</span>
    </div>
  );
}

function ComplianceBadge({ compliant }: { compliant: boolean }) {
  return compliant ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
      Compliant
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
      Non-compliant
    </span>
  );
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ report }: { report: TagReportResponse }) {
  const { summary } = report;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
        <div className="text-sm font-medium text-gray-600">Total Workstations</div>
        <div className="mt-2 text-3xl font-bold text-gray-900">{summary.totalWorkstations}</div>
      </div>
      <div className="bg-green-50 p-4 rounded-lg border border-green-200 shadow-sm">
        <div className="text-sm font-medium text-green-600">Compliant</div>
        <div className="mt-2 text-3xl font-bold text-green-900">{summary.compliantCount}</div>
      </div>
      <div className="bg-red-50 p-4 rounded-lg border border-red-200 shadow-sm">
        <div className="text-sm font-medium text-red-600">Non-compliant</div>
        <div className="mt-2 text-3xl font-bold text-red-900">{summary.nonCompliantCount}</div>
      </div>
      <div className={`p-4 rounded-lg border shadow-sm ${
        summary.compliancePercent >= 90 ? 'bg-green-50 border-green-200' :
        summary.compliancePercent >= 60 ? 'bg-yellow-50 border-yellow-200' :
        'bg-red-50 border-red-200'
      }`}>
        <div className={`text-sm font-medium ${
          summary.compliancePercent >= 90 ? 'text-green-600' :
          summary.compliancePercent >= 60 ? 'text-yellow-600' : 'text-red-600'
        }`}>Overall Compliance</div>
        <div className={`mt-2 text-3xl font-bold ${
          summary.compliancePercent >= 90 ? 'text-green-900' :
          summary.compliancePercent >= 60 ? 'text-yellow-900' : 'text-red-900'
        }`}>{summary.compliancePercent}%</div>
      </div>
    </div>
  );
}

// ─── Template Compliance Table ────────────────────────────────────────────────

function TemplateSummaryTable({ report }: { report: TagReportResponse }) {
  if (!report.templateSummary.length) {
    return (
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm text-center text-gray-500">
        No required templates defined
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="font-semibold text-gray-800">Required Template Compliance</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
          <tr>
            <th className="px-4 py-3 text-left">Template</th>
            <th className="px-4 py-3 text-left">Category</th>
            <th className="px-4 py-3 text-center">Compliant</th>
            <th className="px-4 py-3 text-center">Non-compliant</th>
            <th className="px-4 py-3 text-left">Coverage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {report.templateSummary.map(t => (
            <tr key={t.templateId} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">{t.templateName}</td>
              <td className="px-4 py-3 text-gray-500 capitalize">{t.category}</td>
              <td className="px-4 py-3 text-center text-green-700 font-medium">{t.compliantCount}</td>
              <td className="px-4 py-3 text-center text-red-700 font-medium">{t.nonCompliantCount}</td>
              <td className="px-4 py-3 min-w-[160px]">
                <PercentBar value={t.compliancePercent} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Cost by Dimension ────────────────────────────────────────────────────────

function CostDimensionBreakdown({ costByDimension }: { costByDimension: Record<string, Record<string, number>> }) {
  const dims = Object.entries(costByDimension);
  if (!dims.length) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="font-semibold text-gray-800">Workstations by Tag Dimension</h3>
        <p className="text-sm text-gray-500 mt-0.5">Distribution of running/stopped workstations by EC2 tag values</p>
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {dims.map(([dim, groups]) => {
          const total = Object.values(groups).reduce((a, b) => a + b, 0);
          const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]);
          return (
            <div key={dim} className="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <div className="text-xs font-semibold text-gray-500 uppercase mb-2">{dim}</div>
              <div className="space-y-1.5">
                {sorted.map(([val, count]) => (
                  <div key={val} className="flex items-center gap-2">
                    <span className="text-xs text-gray-700 truncate flex-1" title={val}>{val}</span>
                    <span className="text-xs text-gray-500 tabular-nums">{count}</span>
                    <div className="w-16 bg-gray-200 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full bg-blue-500"
                        style={{ width: `${Math.round((count / total) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Workstation Detail Table ─────────────────────────────────────────────────

function WorkstationTable({ workstations }: { workstations: WorkstationTagCompliance[] }) {
  const [showNonCompliantOnly, setShowNonCompliantOnly] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = workstations
    .filter(w => !showNonCompliantOnly || !w.overallCompliant)
    .filter(w =>
      !search ||
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.userId.toLowerCase().includes(search.toLowerCase()) ||
      (w.instanceId || '').toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center gap-4 flex-wrap">
        <h3 className="font-semibold text-gray-800">Workstation Tag Status</h3>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showNonCompliantOnly}
              onChange={e => setShowNonCompliantOnly(e.target.checked)}
              className="h-4 w-4 text-red-600 rounded"
            />
            Non-compliant only
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-8 text-center text-gray-500">No workstations to display</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left">Workstation</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Platform / OS</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Compliance</th>
                <th className="px-4 py-3 text-left">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(w => {
                const nonCompliantTemplates = w.templateCompliance.filter(tc => !tc.compliant);
                const missingKeys = nonCompliantTemplates.flatMap(tc => tc.missingFields);
                return (
                  <tr key={w.workstationId} className={`hover:bg-gray-50 ${!w.overallCompliant ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{w.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{w.instanceId || w.workstationId}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{w.userId}</td>
                    <td className="px-4 py-3">
                      {w.platform && (
                        <span className={`px-2 py-0.5 text-xs rounded-full mr-1 ${
                          w.platform === 'linux' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                        }`}>{w.platform}</span>
                      )}
                      <span className="text-xs text-gray-500">{w.osVersion}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                        w.state === 'running' ? 'bg-green-100 text-green-700' :
                        w.state === 'stopped' ? 'bg-gray-100 text-gray-600' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{w.state || 'unknown'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <ComplianceBadge compliant={w.overallCompliant} />
                    </td>
                    <td className="px-4 py-3">
                      {missingKeys.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {missingKeys.slice(0, 4).map(k => (
                            <span key={k} className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded font-mono">{k}</span>
                          ))}
                          {missingKeys.length > 4 && (
                            <span className="text-xs text-gray-400">+{missingKeys.length - 4}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export const TagReportingPanel: React.FC = () => {
  const { data: report, isLoading, refetch } = useQuery<TagReportResponse>({
    queryKey: ['tag-report'],
    queryFn: () => apiClient.getTagReport(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="bg-white p-12 rounded-lg border border-gray-200 text-center">
        <p className="text-gray-500">Failed to load tag report</p>
        <button onClick={() => refetch()} className="mt-4 text-blue-600 hover:underline text-sm">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Tag Compliance Report</h2>
          <p className="mt-1 text-sm text-gray-500">
            Generated {new Date(report.summary.generatedAt).toLocaleString()}
            {' · '}{report.summary.requiredTemplates} required template{report.summary.requiredTemplates !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportWorkstationsCsv(report.workstations)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            Export CSV
          </button>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      <SummaryCards report={report} />
      <TemplateSummaryTable report={report} />
      <CostDimensionBreakdown costByDimension={report.costByDimension} />
      <WorkstationTable workstations={report.workstations} />
    </div>
  );
};
