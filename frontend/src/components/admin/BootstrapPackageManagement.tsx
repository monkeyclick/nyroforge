import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../services/api';

interface BootstrapPackage {
  packageId: string;
  name: string;
  description: string;
  type: 'driver' | 'application';
  category: 'graphics' | 'utility' | 'productivity' | 'media' | 'development';
  downloadUrl: string;
  installCommand: string;
  installArgs?: string;
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
  createdAt: string;
  updatedAt: string;
}

export const BootstrapPackageManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingPackage, setEditingPackage] = useState<BootstrapPackage | null>(null);
  const [filter, setFilter] = useState<'all' | 'required' | 'optional' | 'disabled'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch packages
  const { data: packagesData, isLoading } = useQuery({
    queryKey: ['admin-bootstrap-packages'],
    queryFn: () => apiClient.getAdminBootstrapPackages(),
  });

  const packages = (packagesData?.packages || []) as BootstrapPackage[];
  const summary = packagesData?.summary;

  // Filter packages
  const filteredPackages = packages
    .filter(pkg => {
      if (filter === 'required') return pkg.isRequired;
      if (filter === 'optional') return !pkg.isRequired && pkg.isEnabled;
      if (filter === 'disabled') return !pkg.isEnabled;
      return true;
    })
    .filter(pkg => 
      pkg.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pkg.description.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => a.order - b.order);

  // Mutations
  const deleteMutation = useMutation({
    mutationFn: (packageId: string) => apiClient.deleteBootstrapPackage(packageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-bootstrap-packages'] });
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: ({ packageId, isEnabled }: { packageId: string; isEnabled: boolean }) =>
      apiClient.updateBootstrapPackage(packageId, { isEnabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-bootstrap-packages'] });
    },
  });

  const toggleRequiredMutation = useMutation({
    mutationFn: ({ packageId, isRequired }: { packageId: string; isRequired: boolean }) =>
      apiClient.updateBootstrapPackage(packageId, { isRequired }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-bootstrap-packages'] });
    },
  });

  const handleEdit = (pkg: BootstrapPackage) => {
    setEditingPackage(pkg);
    setShowForm(true);
  };

  const handleNew = () => {
    setEditingPackage(null);
    setShowForm(true);
  };

  const handleDelete = (packageId: string, name: string) => {
    // TODO: Replace native confirm() with custom ConfirmationDialog component
    if (confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
      deleteMutation.mutate(packageId);
    }
  };

  if (showForm) {
    return (
      <BootstrapPackageForm
        package={editingPackage}
        onClose={() => {
          setShowForm(false);
          setEditingPackage(null);
        }}
        onSuccess={() => {
          setShowForm(false);
          setEditingPackage(null);
          queryClient.invalidateQueries({ queryKey: ['admin-bootstrap-packages'] });
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Bootstrap Package Management</h2>
          <p className="mt-1 text-sm text-gray-600">
            Manage drivers and applications available during workstation setup
          </p>
        </div>
        <button
          onClick={handleNew}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Add Package
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="text-sm font-medium text-gray-600">Total Packages</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{summary.total}</div>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 shadow-sm">
            <div className="text-sm font-medium text-blue-600">Required</div>
            <div className="mt-2 text-3xl font-bold text-blue-900">{summary.required}</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg border border-green-200 shadow-sm">
            <div className="text-sm font-medium text-green-600">Optional</div>
            <div className="mt-2 text-3xl font-bold text-green-900">{summary.optional}</div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="text-sm font-medium text-gray-600">Disabled</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{summary.disabled}</div>
          </div>
        </div>
      )}

      {/* Filters and Search */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search packages..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('required')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === 'required'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Required
            </button>
            <button
              onClick={() => setFilter('optional')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === 'optional'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Optional
            </button>
            <button
              onClick={() => setFilter('disabled')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === 'disabled'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Disabled
            </button>
          </div>
        </div>
      </div>

      {/* Package List */}
      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : filteredPackages.length === 0 ? (
        <div className="bg-white p-8 rounded-lg border border-gray-200 text-center">
          <p className="text-gray-500">No packages found matching your criteria</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPackages.map((pkg) => (
            <div
              key={pkg.packageId}
              className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-lg font-semibold text-gray-900">{pkg.name}</h3>
                    {pkg.metadata?.version && (
                      <span className="text-sm text-gray-500">v{pkg.metadata.version}</span>
                    )}
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      pkg.type === 'driver' 
                        ? 'bg-purple-100 text-purple-800' 
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {pkg.type}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      pkg.category === 'graphics' ? 'bg-blue-100 text-blue-800' :
                      pkg.category === 'productivity' ? 'bg-green-100 text-green-800' :
                      pkg.category === 'media' ? 'bg-purple-100 text-purple-800' :
                      pkg.category === 'development' ? 'bg-orange-100 text-orange-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {pkg.category}
                    </span>
                    {pkg.isRequired && (
                      <span className="text-xs px-2 py-1 rounded-full font-medium bg-red-100 text-red-800">
                        Required
                      </span>
                    )}
                    {!pkg.isEnabled && (
                      <span className="text-xs px-2 py-1 rounded-full font-medium bg-gray-200 text-gray-600">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-gray-600">{pkg.description}</p>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-500">
                    <span>Order: {pkg.order}</span>
                    <span>Install Time: {pkg.estimatedInstallTimeMinutes} min</span>
                    {pkg.metadata?.size && <span>Size: {pkg.metadata.size}</span>}
                    {pkg.metadata?.vendor && <span>Vendor: {pkg.metadata.vendor}</span>}
                    {pkg.requiresGpu && <span className="text-purple-600">Requires GPU</span>}
                  </div>
                  {pkg.metadata?.notes && (
                    <p className="mt-2 text-xs text-gray-500 italic">{pkg.metadata.notes}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 ml-4">
                  <button
                    onClick={() => handleEdit(pkg)}
                    className="px-3 py-1 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() =>
                      toggleEnabledMutation.mutate({
                        packageId: pkg.packageId,
                        isEnabled: !pkg.isEnabled,
                      })
                    }
                    className={`px-3 py-1 text-sm rounded transition-colors ${
                      pkg.isEnabled
                        ? 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                        : 'text-green-600 hover:text-green-800 hover:bg-green-50'
                    }`}
                  >
                    {pkg.isEnabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() =>
                      toggleRequiredMutation.mutate({
                        packageId: pkg.packageId,
                        isRequired: !pkg.isRequired,
                      })
                    }
                    className={`px-3 py-1 text-sm rounded transition-colors ${
                      pkg.isRequired
                        ? 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                        : 'text-orange-600 hover:text-orange-800 hover:bg-orange-50'
                    }`}
                  >
                    {pkg.isRequired ? 'Make Optional' : 'Make Required'}
                  </button>
                  <button
                    onClick={() => handleDelete(pkg.packageId, pkg.name)}
                    className="px-3 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                    disabled={deleteMutation.isPending}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Package Form Component
interface BootstrapPackageFormProps {
  package: BootstrapPackage | null;
  onClose: () => void;
  onSuccess: () => void;
}

const BootstrapPackageForm: React.FC<BootstrapPackageFormProps> = ({
  package: pkg,
  onClose,
  onSuccess,
}) => {
  const [formData, setFormData] = useState({
    name: pkg?.name || '',
    description: pkg?.description || '',
    type: pkg?.type || 'application',
    category: pkg?.category || 'utility',
    downloadUrl: pkg?.downloadUrl || '',
    installCommand: pkg?.installCommand || 'Start-Process',
    installArgs: pkg?.installArgs || '',
    requiresGpu: pkg?.requiresGpu || false,
    supportedGpuFamilies: pkg?.supportedGpuFamilies || [],
    osVersions: pkg?.osVersions || ['windows-server-2022', 'windows-server-2025'],
    isRequired: pkg?.isRequired || false,
    isEnabled: pkg?.isEnabled !== undefined ? pkg.isEnabled : true,
    order: pkg?.order || 100,
    estimatedInstallTimeMinutes: pkg?.estimatedInstallTimeMinutes || 5,
    metadata: {
      version: pkg?.metadata?.version || '',
      vendor: pkg?.metadata?.vendor || '',
      size: pkg?.metadata?.size || '',
      notes: pkg?.metadata?.notes || '',
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.createBootstrapPackage(data),
    onSuccess: () => {
      onSuccess();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiClient.updateBootstrapPackage(pkg!.packageId, data),
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pkg) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleOsVersionToggle = (version: string) => {
    setFormData(prev => ({
      ...prev,
      osVersions: prev.osVersions.includes(version)
        ? prev.osVersions.filter(v => v !== version)
        : [...prev.osVersions, version],
    }));
  };

  const handleGpuFamilyToggle = (family: string) => {
    setFormData(prev => ({
      ...prev,
      supportedGpuFamilies: prev.supportedGpuFamilies.includes(family)
        ? prev.supportedGpuFamilies.filter(f => f !== family)
        : [...prev.supportedGpuFamilies, family],
    }));
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          {pkg ? 'Edit Package' : 'Add New Package'}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Configure driver or application package for automatic installation
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg border border-gray-200 space-y-6">
        {/* Basic Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Package Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="e.g., NVIDIA GRID Driver"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Version
            </label>
            <input
              type="text"
              value={formData.metadata.version}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                metadata: { ...prev.metadata, version: e.target.value }
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="e.g., 550.x"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description *
          </label>
          <textarea
            required
            rows={3}
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            placeholder="Brief description of the package"
          />
        </div>

        {/* Type and Category */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type *
            </label>
            <select
              required
              value={formData.type}
              onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as any }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="driver">Driver</option>
              <option value="application">Application</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category *
            </label>
            <select
              required
              value={formData.category}
              onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value as any }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="graphics">Graphics</option>
              <option value="utility">Utility</option>
              <option value="productivity">Productivity</option>
              <option value="media">Media</option>
              <option value="development">Development</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Install Order *
            </label>
            <input
              type="number"
              required
              min="1"
              value={formData.order}
              onChange={(e) => setFormData(prev => ({ ...prev, order: parseInt(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>

        {/* Download and Installation */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Download URL *
          </label>
          <input
            type="url"
            required
            value={formData.downloadUrl}
            onChange={(e) => setFormData(prev => ({ ...prev, downloadUrl: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            placeholder="https://..."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Install Command *
            </label>
            <input
              type="text"
              required
              value={formData.installCommand}
              onChange={(e) => setFormData(prev => ({ ...prev, installCommand: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="Start-Process"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Estimated Install Time (minutes) *
            </label>
            <input
              type="number"
              required
              min="1"
              value={formData.estimatedInstallTimeMinutes}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                estimatedInstallTimeMinutes: parseInt(e.target.value) 
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Install Arguments
          </label>
          <textarea
            rows={2}
            value={formData.installArgs}
            onChange={(e) => setFormData(prev => ({ ...prev, installArgs: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
            placeholder='-FilePath "C:\\Temp\\installer.exe" -ArgumentList "/S" -Wait'
          />
        </div>

        {/* OS Versions */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Supported Windows Versions *
          </label>
          <div className="flex flex-wrap gap-2">
            {['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'].map(version => (
              <label key={version} className="inline-flex items-center">
                <input
                  type="checkbox"
                  checked={formData.osVersions.includes(version)}
                  onChange={() => handleOsVersionToggle(version)}
                  className="rounded border-gray-300"
                />
                <span className="ml-2 text-sm text-gray-700">{version}</span>
              </label>
            ))}
          </div>
        </div>

        {/* GPU Requirements */}
        <div className="border-t pt-4">
          <div className="flex items-center gap-4 mb-3">
            <label className="inline-flex items-center">
              <input
                type="checkbox"
                checked={formData.requiresGpu}
                onChange={(e) => setFormData(prev => ({ ...prev, requiresGpu: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <span className="ml-2 text-sm font-medium text-gray-700">Requires GPU</span>
            </label>
          </div>
          {formData.requiresGpu && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Supported GPU Families
              </label>
              <div className="flex gap-4">
                {['NVIDIA', 'AMD'].map(family => (
                  <label key={family} className="inline-flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.supportedGpuFamilies.includes(family)}
                      onChange={() => handleGpuFamilyToggle(family)}
                      className="rounded border-gray-300"
                    />
                    <span className="ml-2 text-sm text-gray-700">{family}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Flags */}
        <div className="flex gap-6 border-t pt-4">
          <label className="inline-flex items-center">
            <input
              type="checkbox"
              checked={formData.isRequired}
              onChange={(e) => setFormData(prev => ({ ...prev, isRequired: e.target.checked }))}
              className="rounded border-gray-300"
            />
            <span className="ml-2 text-sm font-medium text-gray-700">Required Package</span>
          </label>
          <label className="inline-flex items-center">
            <input
              type="checkbox"
              checked={formData.isEnabled}
              onChange={(e) => setFormData(prev => ({ ...prev, isEnabled: e.target.checked }))}
              className="rounded border-gray-300"
            />
            <span className="ml-2 text-sm font-medium text-gray-700">Enabled</span>
          </label>
        </div>

        {/* Additional Metadata */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vendor
            </label>
            <input
              type="text"
              value={formData.metadata.vendor}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                metadata: { ...prev.metadata, vendor: e.target.value }
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="e.g., NVIDIA"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              File Size
            </label>
            <input
              type="text"
              value={formData.metadata.size}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                metadata: { ...prev.metadata, size: e.target.value }
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="e.g., ~700MB"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Additional Notes
          </label>
          <textarea
            rows={2}
            value={formData.metadata.notes}
            onChange={(e) => setFormData(prev => ({ 
              ...prev, 
              metadata: { ...prev.metadata, notes: e.target.value }
            }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            placeholder="Any additional information about this package"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending || updateMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save Package'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default BootstrapPackageManagement;