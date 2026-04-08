import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../services/api';
import type { GroupPackageInfo } from '../../types';

interface BootstrapPackage {
  packageId: string;
  name: string;
  description: string;
  type: 'driver' | 'application';
  category: 'graphics' | 'utility' | 'productivity' | 'media' | 'development';
  requiresGpu?: boolean;
  supportedGpuFamilies?: string[];
  osVersions: string[];
  isRequired: boolean;
  isEnabled: boolean;
  order: number;
  estimatedInstallTimeMinutes: number;
  metadata?: {
    version?: string;
    vendor?: string;
    size?: string;
    notes?: string;
  };
}

interface EnhancedPackage extends BootstrapPackage {
  source: 'system' | 'group' | 'user';
  isMandatory?: boolean;
  groupName?: string;
}

interface BootstrapPackageSelectorProps {
  instanceType: string;
  osVersion: string;
  selectedPackages: string[];
  onSelectionChange: (packageIds: string[]) => void;
}

const CATEGORY_INFO = {
  graphics: { label: 'Graphics & Drivers', icon: '🎨', color: 'blue' },
  utility: { label: 'Utilities', icon: '🔧', color: 'gray' },
  productivity: { label: 'Productivity', icon: '📝', color: 'green' },
  media: { label: 'Media & Entertainment', icon: '🎬', color: 'purple' },
  development: { label: 'Development Tools', icon: '💻', color: 'orange' },
};

export const BootstrapPackageSelector: React.FC<BootstrapPackageSelectorProps> = ({
  instanceType,
  osVersion,
  selectedPackages,
  onSelectionChange,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [expanded, setExpanded] = useState(true);
  const [expandedPackage, setExpandedPackage] = useState<string | null>(null);

  // Fetch available packages
  const { data: packagesData, isLoading: packagesLoading } = useQuery({
    queryKey: ['bootstrap-packages'],
    queryFn: () => apiClient.getBootstrapPackages(),
  });

  // Fetch group packages
  const { data: groupPackagesData, isLoading: groupPackagesLoading } = useQuery({
    queryKey: ['user-group-packages'],
    queryFn: () => apiClient.getUserGroupPackages(),
  });

  const systemPackages = (packagesData?.packages || []) as BootstrapPackage[];
  const groupPackages = (groupPackagesData?.packages || []) as GroupPackageInfo[];

  // Combine and enhance packages
  const enhancedPackages: EnhancedPackage[] = React.useMemo(() => {
    const packageMap = new Map<string, EnhancedPackage>();

    // Add system packages first
    systemPackages.forEach(pkg => {
      packageMap.set(pkg.packageId, {
        ...pkg,
        source: pkg.isRequired ? 'system' : 'user',
      });
    });

    // Overlay group packages
    groupPackages.forEach(groupPkg => {
      const existing = packageMap.get(groupPkg.packageId);
      if (existing) {
        // Enhance existing package with group info
        packageMap.set(groupPkg.packageId, {
          ...existing,
          source: 'group',
          isMandatory: groupPkg.isMandatory,
          groupName: groupPkg.groupName,
        });
      } else {
        // Add new package from group (shouldn't happen but handle gracefully)
        packageMap.set(groupPkg.packageId, {
          packageId: groupPkg.packageId,
          name: groupPkg.packageName,
          description: '',
          type: 'application',
          category: 'utility',
          osVersions: [osVersion],
          isRequired: false,
          isEnabled: true,
          order: groupPkg.installOrder || 999,
          estimatedInstallTimeMinutes: 5,
          source: 'group',
          isMandatory: groupPkg.isMandatory,
          groupName: groupPkg.groupName,
        });
      }
    });

    return Array.from(packageMap.values());
  }, [systemPackages, groupPackages, osVersion]);

  // Filter packages based on instance type and OS
  const isGpuInstance = instanceType.startsWith('g4') || instanceType.startsWith('g5') || instanceType.startsWith('g6');
  
  const filteredPackages = enhancedPackages.filter(pkg => {
    // Check OS compatibility
    if (!pkg.osVersions.includes(osVersion)) return false;
    
    // Check GPU requirement
    if (pkg.requiresGpu && !isGpuInstance) return false;
    
    // Check GPU family
    if (pkg.supportedGpuFamilies && pkg.supportedGpuFamilies.length > 0) {
      if (!isGpuInstance) return false;
      // Assume NVIDIA for g-series instances
      if (!pkg.supportedGpuFamilies.includes('NVIDIA')) return false;
    }
    
    return pkg.isEnabled;
  });

  // Separate packages by type
  const requiredPackages = filteredPackages.filter(pkg => pkg.isRequired);
  const mandatoryGroupPackages = filteredPackages.filter(pkg => pkg.source === 'group' && pkg.isMandatory && !pkg.isRequired);
  const optionalGroupPackages = filteredPackages.filter(pkg => pkg.source === 'group' && !pkg.isMandatory && !pkg.isRequired);
  const userPackages = filteredPackages.filter(pkg => pkg.source === 'user');

  // Combine optional packages for display
  const optionalPackages = [...optionalGroupPackages, ...userPackages];

  // Group by category
  const packagesByCategory = optionalPackages.reduce((acc, pkg) => {
    if (!acc[pkg.category]) {
      acc[pkg.category] = [];
    }
    acc[pkg.category].push(pkg);
    return acc;
  }, {} as Record<string, EnhancedPackage[]>);

  // Get all mandatory package IDs
  const mandatoryPackageIds = [
    ...requiredPackages.map(p => p.packageId),
    ...mandatoryGroupPackages.map(p => p.packageId),
  ];

  // Auto-select mandatory packages on mount and when they change
  useEffect(() => {
    if (mandatoryPackageIds.length > 0) {
      const currentMandatorySelected = mandatoryPackageIds.filter(id => selectedPackages.includes(id));
      if (currentMandatorySelected.length !== mandatoryPackageIds.length) {
        // Add missing mandatory packages to selection
        const newSelection = Array.from(new Set([...selectedPackages, ...mandatoryPackageIds]));
        onSelectionChange(newSelection);
      }
    }
  }, [mandatoryPackageIds.join(','), selectedPackages.join(',')]);

  // Calculate total estimated time
  const totalEstimatedMinutes = [
    ...requiredPackages,
    ...mandatoryGroupPackages,
    ...optionalPackages.filter(pkg => selectedPackages.includes(pkg.packageId))
  ].reduce((sum, pkg) => sum + pkg.estimatedInstallTimeMinutes, 0);

  const handlePackageToggle = (pkg: EnhancedPackage) => {
    // Prevent deselection of mandatory packages
    if (pkg.isMandatory || pkg.isRequired) {
      return;
    }

    if (selectedPackages.includes(pkg.packageId)) {
      onSelectionChange(selectedPackages.filter(id => id !== pkg.packageId));
    } else {
      onSelectionChange([...selectedPackages, pkg.packageId]);
    }
  };

  const handleSelectAll = () => {
    const allOptionalIds = optionalPackages.map(pkg => pkg.packageId);
    const allIds = Array.from(new Set([...mandatoryPackageIds, ...allOptionalIds]));
    onSelectionChange(allIds);
  };

  const handleDeselectAll = () => {
    // Keep mandatory packages selected
    onSelectionChange(mandatoryPackageIds);
  };

  const isLoading = packagesLoading || groupPackagesLoading;

  if (isLoading) {
    return (
      <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Loading bootstrap packages...</span>
        </div>
      </div>
    );
  }

  if (filteredPackages.length === 0) {
    return null;
  }

  const PackageBadge: React.FC<{ type: 'required' | 'mandatory' | 'group' }> = ({ type }) => {
    const badges = {
      required: { label: 'Required', color: 'bg-blue-100 text-blue-800', icon: '🔒' },
      mandatory: { label: 'Mandatory', color: 'bg-purple-100 text-purple-800', icon: '⚡' },
      group: { label: 'Group', color: 'bg-green-100 text-green-800', icon: '👥' },
    };
    const badge = badges[type];
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded ${badge.color}`}>
        <span>{badge.icon}</span>
        <span>{badge.label}</span>
      </span>
    );
  };

  const PackageItem: React.FC<{ pkg: EnhancedPackage }> = ({ pkg }) => {
    const isChecked = selectedPackages.includes(pkg.packageId);
    const isDisabled = pkg.isMandatory || pkg.isRequired;

    return (
      <div key={pkg.packageId}>
        <div className="flex items-center gap-2 py-1 hover:bg-white rounded px-1 group">
          <input
            type="checkbox"
            id={pkg.packageId}
            checked={isChecked}
            disabled={isDisabled}
            onChange={() => handlePackageToggle(pkg)}
            className={`${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            title={isDisabled ? 'This package is required and cannot be deselected' : ''}
          />
          <label
            htmlFor={pkg.packageId}
            className={`flex-1 text-xs cursor-pointer select-none ${
              isDisabled ? 'text-gray-700 cursor-not-allowed' : 'text-gray-900'
            }`}
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <span>{pkg.name}</span>
              {pkg.metadata?.version && (
                <span className="text-gray-500">v{pkg.metadata.version}</span>
              )}
              {pkg.isRequired && <PackageBadge type="required" />}
              {pkg.isMandatory && !pkg.isRequired && <PackageBadge type="mandatory" />}
              {pkg.source === 'group' && !pkg.isRequired && !pkg.isMandatory && (
                <PackageBadge type="group" />
              )}
            </div>
            {pkg.groupName && (
              <div className="text-xs text-gray-500 mt-0.5">From group: {pkg.groupName}</div>
            )}
          </label>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpandedPackage(expandedPackage === pkg.packageId ? null : pkg.packageId);
            }}
            className="text-xs text-blue-600 hover:text-blue-800 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Show details"
          >
            {expandedPackage === pkg.packageId ? '▲' : 'ⓘ'}
          </button>
        </div>
        {expandedPackage === pkg.packageId && (
          <div className="ml-6 mr-2 mt-1 mb-2 p-2 bg-white rounded border border-gray-200 text-xs">
            <p className="text-gray-700 mb-2">{pkg.description}</p>
            <div className="flex flex-wrap gap-2 text-gray-600">
              {pkg.metadata?.size && <span>Size: {pkg.metadata.size}</span>}
              <span>Install time: {pkg.estimatedInstallTimeMinutes} min</span>
              {pkg.metadata?.vendor && <span>By: {pkg.metadata.vendor}</span>}
            </div>
            {pkg.source === 'group' && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <p className="text-gray-600">
                  📦 This package is configured for your group
                  {pkg.isMandatory && ' and is mandatory for all group members'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="border border-gray-300 rounded p-3 bg-white">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Software Installation</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">
            Setup time: <strong className="text-gray-900">{totalEstimatedMinutes} min</strong>
          </span>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            {expanded ? 'Hide ▲' : 'Show ▼'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3">
          {/* Information Banner */}
          <div className="bg-blue-50 border border-blue-200 rounded p-2.5 text-xs">
            <div className="flex items-start gap-2">
              <span className="text-lg">ℹ️</span>
              <div className="flex-1">
                <p className="text-gray-700 font-medium mb-1">Package Installation Phases:</p>
                <ul className="text-gray-600 space-y-0.5 ml-4 list-disc">
                  <li><strong>Phase 1 (Boot):</strong> Critical packages (drivers, DCV, monitoring) install during boot</li>
                  <li><strong>Phase 2 (Post-boot):</strong> Applications install in background after login</li>
                  <li>You can monitor post-boot progress from your workstation dashboard</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Required Packages */}
          {requiredPackages.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <h4 className="text-xs font-semibold text-gray-700">System Required (Auto-installed)</h4>
              </div>
              <div className="bg-blue-50 rounded p-2 space-y-1">
                {requiredPackages.map(pkg => (
                  <PackageItem key={pkg.packageId} pkg={pkg} />
                ))}
              </div>
            </div>
          )}

          {/* Mandatory Group Packages */}
          {mandatoryGroupPackages.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <h4 className="text-xs font-semibold text-gray-700">Group Required (Auto-installed)</h4>
                <span className="text-xs text-gray-600" title="These packages are required by your group administrator">
                  ⓘ
                </span>
              </div>
              <div className="bg-purple-50 rounded p-2 space-y-1">
                {mandatoryGroupPackages.map(pkg => (
                  <PackageItem key={pkg.packageId} pkg={pkg} />
                ))}
              </div>
            </div>
          )}

          {/* Optional Packages */}
          {optionalPackages.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-xs font-semibold text-gray-700">
                  Optional Software ({selectedPackages.filter(id => !mandatoryPackageIds.includes(id)).length} selected)
                </h4>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-blue-600 hover:underline"
                  >
                    Select All
                  </button>
                  <span className="text-gray-400">|</span>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="text-gray-600 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Categories */}
              {Object.keys(packagesByCategory).length > 1 && (
                <div className="flex gap-1 mb-2 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setActiveCategory('all')}
                    className={`px-2 py-0.5 text-xs rounded whitespace-nowrap ${
                      activeCategory === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    All
                  </button>
                  {Object.entries(packagesByCategory).map(([category, pkgs]) => {
                    const info = CATEGORY_INFO[category as keyof typeof CATEGORY_INFO];
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setActiveCategory(category)}
                        className={`px-2 py-0.5 text-xs rounded whitespace-nowrap ${
                          activeCategory === category
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        {info?.icon} {info?.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Package List */}
              <div className="bg-gray-50 rounded p-2 max-h-48 overflow-y-auto space-y-0.5">
                {(activeCategory === 'all' ? optionalPackages : packagesByCategory[activeCategory] || [])
                  .sort((a, b) => a.order - b.order)
                  .map(pkg => (
                    <PackageItem key={pkg.packageId} pkg={pkg} />
                  ))}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="bg-gray-50 rounded p-2.5 text-xs">
            <div className="font-semibold text-gray-700 mb-1.5">Legend:</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              <div className="flex items-center gap-1.5">
                <PackageBadge type="required" />
                <span className="text-gray-600">System required</span>
              </div>
              <div className="flex items-center gap-1.5">
                <PackageBadge type="mandatory" />
                <span className="text-gray-600">Group required</span>
              </div>
              <div className="flex items-center gap-1.5">
                <PackageBadge type="group" />
                <span className="text-gray-600">From your group</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BootstrapPackageSelector;