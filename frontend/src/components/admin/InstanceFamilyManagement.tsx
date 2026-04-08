import React, { useState, useEffect, useRef } from 'react';
import { apiClient } from '../../services/api';

interface InstanceFamilyOption {
  family: string;
  description: string;
  category: 'gpu' | 'compute' | 'memory' | 'storage' | 'general' | 'burstable';
  isAllowed: boolean;
}

// All available EC2 instance families with descriptions
const ALL_INSTANCE_FAMILIES: Omit<InstanceFamilyOption, 'isAllowed'>[] = [
  // GPU Instances
  { family: 'g5', description: 'NVIDIA A10G Tensor Core GPUs', category: 'gpu' },
  { family: 'g6', description: 'NVIDIA L4 Tensor Core GPUs', category: 'gpu' },
  { family: 'g4dn', description: 'NVIDIA T4 Tensor Core GPUs', category: 'gpu' },
  { family: 'g4ad', description: 'AMD Radeon Pro V520 GPUs', category: 'gpu' },
  { family: 'p3', description: 'NVIDIA V100 Tensor Core GPUs', category: 'gpu' },
  { family: 'p4d', description: 'NVIDIA A100 Tensor Core GPUs', category: 'gpu' },
  { family: 'p5', description: 'NVIDIA H100 Tensor Core GPUs', category: 'gpu' },
  { family: 'inf1', description: 'AWS Inferentia chips', category: 'gpu' },
  { family: 'inf2', description: 'AWS Inferentia2 chips', category: 'gpu' },
  { family: 'trn1', description: 'AWS Trainium chips', category: 'gpu' },
  { family: 'dl1', description: 'Gaudi HPU for deep learning', category: 'gpu' },
  
  // Compute Optimized
  { family: 'c5', description: 'Intel Xeon Platinum 8000 (Skylake)', category: 'compute' },
  { family: 'c5a', description: 'AMD EPYC 7002 series', category: 'compute' },
  { family: 'c5ad', description: 'AMD EPYC 7002 with NVMe SSD', category: 'compute' },
  { family: 'c5d', description: 'Intel Xeon Platinum with NVMe SSD', category: 'compute' },
  { family: 'c5n', description: 'Intel Xeon Platinum with 100 Gbps networking', category: 'compute' },
  { family: 'c6a', description: 'AMD EPYC 7R13 (Milan)', category: 'compute' },
  { family: 'c6i', description: 'Intel Xeon (Ice Lake)', category: 'compute' },
  { family: 'c6id', description: 'Intel Xeon (Ice Lake) with NVMe SSD', category: 'compute' },
  { family: 'c6in', description: 'Intel Xeon (Ice Lake) with 200 Gbps networking', category: 'compute' },
  { family: 'c7a', description: 'AMD EPYC 9R14 (Genoa)', category: 'compute' },
  { family: 'c7i', description: 'Intel Xeon (Sapphire Rapids)', category: 'compute' },
  { family: 'c7i-flex', description: 'Intel Xeon (Sapphire Rapids) flex', category: 'compute' },
  { family: 'c7g', description: 'AWS Graviton3', category: 'compute' },
  { family: 'c7gd', description: 'AWS Graviton3 with NVMe SSD', category: 'compute' },
  { family: 'c7gn', description: 'AWS Graviton3 with 200 Gbps networking', category: 'compute' },
  
  // Memory Optimized
  { family: 'r5', description: 'Intel Xeon Platinum 8000 (Skylake)', category: 'memory' },
  { family: 'r5a', description: 'AMD EPYC 7002 series', category: 'memory' },
  { family: 'r5ad', description: 'AMD EPYC 7002 with NVMe SSD', category: 'memory' },
  { family: 'r5b', description: 'Intel Xeon Platinum with EBS optimized', category: 'memory' },
  { family: 'r5d', description: 'Intel Xeon Platinum with NVMe SSD', category: 'memory' },
  { family: 'r5dn', description: 'Intel Xeon Platinum with NVMe & 100 Gbps', category: 'memory' },
  { family: 'r5n', description: 'Intel Xeon Platinum with 100 Gbps networking', category: 'memory' },
  { family: 'r6a', description: 'AMD EPYC 7R13 (Milan)', category: 'memory' },
  { family: 'r6i', description: 'Intel Xeon (Ice Lake)', category: 'memory' },
  { family: 'r6id', description: 'Intel Xeon (Ice Lake) with NVMe SSD', category: 'memory' },
  { family: 'r6in', description: 'Intel Xeon (Ice Lake) with 200 Gbps networking', category: 'memory' },
  { family: 'r6idn', description: 'Intel Xeon (Ice Lake) with NVMe & 200 Gbps', category: 'memory' },
  { family: 'r7a', description: 'AMD EPYC 9R14 (Genoa)', category: 'memory' },
  { family: 'r7i', description: 'Intel Xeon (Sapphire Rapids)', category: 'memory' },
  { family: 'r7iz', description: 'Intel Xeon (Sapphire Rapids) high frequency', category: 'memory' },
  { family: 'r7g', description: 'AWS Graviton3', category: 'memory' },
  { family: 'r7gd', description: 'AWS Graviton3 with NVMe SSD', category: 'memory' },
  { family: 'x1', description: 'Intel Xeon E7 8880 v3 (Haswell)', category: 'memory' },
  { family: 'x1e', description: 'Intel Xeon E7 8880 v3 extended memory', category: 'memory' },
  { family: 'x2idn', description: 'Intel Xeon (Ice Lake) with NVMe & 100 Gbps', category: 'memory' },
  { family: 'x2iedn', description: 'Intel Xeon (Ice Lake) extended with NVMe', category: 'memory' },
  { family: 'x2iezn', description: 'Intel Xeon (Cascade Lake) high frequency', category: 'memory' },
  { family: 'u-3tb1', description: 'High Memory 3 TB', category: 'memory' },
  { family: 'u-6tb1', description: 'High Memory 6 TB', category: 'memory' },
  { family: 'u-9tb1', description: 'High Memory 9 TB', category: 'memory' },
  { family: 'u-12tb1', description: 'High Memory 12 TB', category: 'memory' },
  { family: 'u-18tb1', description: 'High Memory 18 TB', category: 'memory' },
  { family: 'u-24tb1', description: 'High Memory 24 TB', category: 'memory' },
  { family: 'z1d', description: 'Intel Xeon (Skylake) high frequency', category: 'memory' },
  
  // Storage Optimized
  { family: 'd2', description: 'Intel Xeon E5-2676 v3 with HDD', category: 'storage' },
  { family: 'd3', description: 'Intel Xeon Platinum 8259CL with HDD', category: 'storage' },
  { family: 'd3en', description: 'Intel Xeon Platinum 8259CL with HDD dense', category: 'storage' },
  { family: 'h1', description: 'Intel Xeon E5-2686 v4 with HDD', category: 'storage' },
  { family: 'i3', description: 'Intel Xeon E5-2686 v4 with NVMe SSD', category: 'storage' },
  { family: 'i3en', description: 'Intel Xeon (Cascade Lake) with NVMe SSD', category: 'storage' },
  { family: 'i4i', description: 'Intel Xeon (Ice Lake) with NVMe SSD', category: 'storage' },
  { family: 'i4g', description: 'AWS Graviton2 with NVMe SSD', category: 'storage' },
  { family: 'im4gn', description: 'AWS Graviton2 with NVMe balanced', category: 'storage' },
  { family: 'is4gen', description: 'AWS Graviton2 with NVMe dense', category: 'storage' },
  
  // General Purpose
  { family: 'm5', description: 'Intel Xeon Platinum 8175M (Skylake)', category: 'general' },
  { family: 'm5a', description: 'AMD EPYC 7002 series', category: 'general' },
  { family: 'm5ad', description: 'AMD EPYC 7002 with NVMe SSD', category: 'general' },
  { family: 'm5d', description: 'Intel Xeon Platinum with NVMe SSD', category: 'general' },
  { family: 'm5dn', description: 'Intel Xeon Platinum with NVMe & 100 Gbps', category: 'general' },
  { family: 'm5n', description: 'Intel Xeon Platinum with 100 Gbps networking', category: 'general' },
  { family: 'm5zn', description: 'Intel Xeon Platinum high frequency', category: 'general' },
  { family: 'm6a', description: 'AMD EPYC 7R13 (Milan)', category: 'general' },
  { family: 'm6i', description: 'Intel Xeon (Ice Lake)', category: 'general' },
  { family: 'm6id', description: 'Intel Xeon (Ice Lake) with NVMe SSD', category: 'general' },
  { family: 'm6in', description: 'Intel Xeon (Ice Lake) with 200 Gbps networking', category: 'general' },
  { family: 'm6idn', description: 'Intel Xeon (Ice Lake) with NVMe & 200 Gbps', category: 'general' },
  { family: 'm7a', description: 'AMD EPYC 9R14 (Genoa)', category: 'general' },
  { family: 'm7i', description: 'Intel Xeon (Sapphire Rapids)', category: 'general' },
  { family: 'm7i-flex', description: 'Intel Xeon (Sapphire Rapids) flex', category: 'general' },
  { family: 'm7g', description: 'AWS Graviton3', category: 'general' },
  { family: 'm7gd', description: 'AWS Graviton3 with NVMe SSD', category: 'general' },
  { family: 'mac1', description: 'Apple Mac mini (Intel)', category: 'general' },
  { family: 'mac2', description: 'Apple Mac mini (M1)', category: 'general' },
  { family: 'mac2-m2pro', description: 'Apple Mac mini (M2 Pro)', category: 'general' },
  
  // Burstable
  { family: 't2', description: 'Intel Xeon (Haswell/Broadwell)', category: 'burstable' },
  { family: 't3', description: 'Intel Xeon (Skylake)', category: 'burstable' },
  { family: 't3a', description: 'AMD EPYC 7002 series', category: 'burstable' },
  { family: 't4g', description: 'AWS Graviton2', category: 'burstable' },
];

const getCategoryIcon = (category: string) => {
  const icons: Record<string, string> = {
    gpu: '🎮',
    compute: '⚡',
    memory: '🧠',
    storage: '💾',
    general: '📦',
    burstable: '💨',
  };
  return icons[category] || '📦';
};

const getCategoryColor = (category: string) => {
  const colors: Record<string, string> = {
    gpu: 'bg-purple-100 text-purple-800 border-purple-200',
    compute: 'bg-blue-100 text-blue-800 border-blue-200',
    memory: 'bg-green-100 text-green-800 border-green-200',
    storage: 'bg-orange-100 text-orange-800 border-orange-200',
    general: 'bg-gray-100 text-gray-800 border-gray-200',
    burstable: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  };
  return colors[category] || 'bg-gray-100 text-gray-800 border-gray-200';
};

const InstanceFamilyManagement: React.FC = () => {
  const [families, setFamilies] = useState<InstanceFamilyOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Initialize families with API data
  useEffect(() => {
    loadConfiguration();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadConfiguration = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.getInstanceFamilies();
      
      // Handle the nested response structure: { config: { allowedFamilies: [...] } }
      // or { allowedFamilies: [...] } for direct format
      let allowedFamilies: string[] = [];
      
      if (response && typeof response === 'object') {
        // Check for nested config structure (backend format)
        const data = response as any;
        if (data.config && data.config.allowedFamilies) {
          allowedFamilies = data.config.allowedFamilies;
        } else if (data.defaults && data.defaults.allowedFamilies) {
          // No config saved yet, use defaults
          allowedFamilies = data.defaults.allowedFamilies;
        } else if (data.allowedFamilies) {
          // Direct format
          allowedFamilies = data.allowedFamilies;
        }
      }
      
      // Merge with all families, marking which are allowed
      const mergedFamilies = ALL_INSTANCE_FAMILIES.map(family => ({
        ...family,
        isAllowed: allowedFamilies.includes(family.family),
      }));
      
      setFamilies(mergedFamilies);
    } catch (err) {
      console.error('Failed to load configuration:', err);
      // Initialize with defaults if API fails
      setFamilies(ALL_INSTANCE_FAMILIES.map(f => ({ ...f, isAllowed: false })));
      setError('Failed to load configuration. Using defaults.');
    } finally {
      setIsLoading(false);
    }
  };

  const saveConfiguration = async (updatedFamilies: InstanceFamilyOption[]) => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const allowedFamilies = updatedFamilies
        .filter(f => f.isAllowed)
        .map(f => f.family);

      await apiClient.updateInstanceFamilies(allowedFamilies);
      
      setSuccessMessage('Configuration saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleFamily = (familyName: string) => {
    const updatedFamilies = families.map(family => 
      family.family === familyName 
        ? { ...family, isAllowed: !family.isAllowed }
        : family
    );
    setFamilies(updatedFamilies);
    saveConfiguration(updatedFamilies);
  };

  const enableAll = (category?: string) => {
    const updatedFamilies = families.map(family => ({
      ...family,
      isAllowed: category ? (family.category === category ? true : family.isAllowed) : true,
    }));
    setFamilies(updatedFamilies);
    saveConfiguration(updatedFamilies);
  };

  const disableAll = (category?: string) => {
    const updatedFamilies = families.map(family => ({
      ...family,
      isAllowed: category ? (family.category === category ? false : family.isAllowed) : false,
    }));
    setFamilies(updatedFamilies);
    saveConfiguration(updatedFamilies);
  };

  // Filter families for dropdown
  const filteredFamilies = families.filter(family => {
    const matchesSearch = searchTerm === '' || 
      family.family.toLowerCase().includes(searchTerm.toLowerCase()) ||
      family.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || family.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Get enabled families
  const enabledFamilies = families.filter(f => f.isAllowed);

  // Group families by category
  const groupedFamilies = filteredFamilies.reduce((acc, family) => {
    if (!acc[family.category]) {
      acc[family.category] = [];
    }
    acc[family.category].push(family);
    return acc;
  }, {} as Record<string, InstanceFamilyOption[]>);

  const categoryOrder = ['gpu', 'compute', 'memory', 'storage', 'general', 'burstable'];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">🖥️ Instance Family Management</h2>
            <p className="text-sm text-gray-500">
              Select which EC2 instance families are available for user deployments
            </p>
          </div>
          <button
            onClick={loadConfiguration}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
          >
            {isLoading ? '⏳ Loading...' : '🔄 Refresh'}
          </button>
        </div>

        {/* Summary */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg">
            <span className="text-2xl font-bold text-blue-600">{enabledFamilies.length}</span>
            <span className="text-sm text-gray-600">Enabled</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
            <span className="text-2xl font-bold text-gray-600">{families.length - enabledFamilies.length}</span>
            <span className="text-sm text-gray-600">Disabled</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
            <span className="text-2xl font-bold text-gray-600">{families.length}</span>
            <span className="text-sm text-gray-600">Total</span>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            ❌ {error}
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
            ✅ {successMessage}
          </div>
        )}

        {isSaving && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-700 text-sm">
            ⏳ Saving changes...
          </div>
        )}

        {/* Multi-Select Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Instance Families
          </label>
          
          {/* Selected Items Display / Dropdown Trigger */}
          <div
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="min-h-[42px] p-2 border border-gray-300 rounded-lg cursor-pointer bg-white hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {enabledFamilies.length === 0 ? (
              <span className="text-gray-400">Click to select instance families...</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {enabledFamilies.map(family => (
                  <span
                    key={family.family}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${getCategoryColor(family.category)}`}
                  >
                    {getCategoryIcon(family.category)} {family.family}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFamily(family.family);
                      }}
                      className="ml-1 hover:text-red-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
              <svg className={`w-5 h-5 text-gray-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {/* Dropdown Panel */}
          {isDropdownOpen && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-hidden">
              {/* Search and Filter */}
              <div className="p-3 border-b border-gray-200 bg-gray-50">
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search families..."
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="all">All</option>
                    <option value="gpu">🎮 GPU</option>
                    <option value="compute">⚡ Compute</option>
                    <option value="memory">🧠 Memory</option>
                    <option value="storage">💾 Storage</option>
                    <option value="general">📦 General</option>
                    <option value="burstable">💨 Burstable</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); enableAll(categoryFilter === 'all' ? undefined : categoryFilter); }}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    ✓ Enable {categoryFilter === 'all' ? 'All' : categoryFilter}
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); disableAll(categoryFilter === 'all' ? undefined : categoryFilter); }}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    ✗ Disable {categoryFilter === 'all' ? 'All' : categoryFilter}
                  </button>
                </div>
              </div>

              {/* Options List */}
              <div className="max-h-64 overflow-y-auto">
                {categoryOrder.map(category => {
                  const categoryFamilies = groupedFamilies[category];
                  if (!categoryFamilies || categoryFamilies.length === 0) return null;
                  
                  return (
                    <div key={category}>
                      <div className="px-3 py-2 bg-gray-100 text-xs font-semibold text-gray-500 uppercase sticky top-0">
                        {getCategoryIcon(category)} {category} ({categoryFamilies.filter(f => f.isAllowed).length}/{categoryFamilies.length})
                      </div>
                      {categoryFamilies.map(family => (
                        <div
                          key={family.family}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFamily(family.family);
                          }}
                          className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50 ${
                            family.isAllowed ? 'bg-blue-50' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={family.isAllowed}
                              onChange={() => {}}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <div>
                              <span className="font-medium text-gray-900">{family.family}</span>
                              <span className="ml-2 text-sm text-gray-500">{family.description}</span>
                            </div>
                          </div>
                          {family.isAllowed && (
                            <span className="text-green-600 text-sm">✓</span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
                
                {filteredFamilies.length === 0 && (
                  <div className="p-4 text-center text-gray-500">
                    No families match your search
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Enabled Families by Category */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Enabled Families by Category</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {categoryOrder.map(category => {
            const categoryFamilies = families.filter(f => f.category === category && f.isAllowed);
            const totalInCategory = families.filter(f => f.category === category).length;
            
            return (
              <div key={category} className={`p-3 rounded-lg border ${getCategoryColor(category)}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{getCategoryIcon(category)}</span>
                  <span className="font-medium capitalize">{category}</span>
                  <span className="text-xs">({categoryFamilies.length}/{totalInCategory})</span>
                </div>
                {categoryFamilies.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {categoryFamilies.map(f => (
                      <span key={f.family} className="text-xs font-mono bg-white/50 px-1.5 py-0.5 rounded">
                        {f.family}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs opacity-60">None enabled</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Help Text */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-900 mb-2">Quick Reference</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-gray-600">
          <div><span className="font-medium text-purple-600">🎮 GPU:</span> Graphics & ML workloads</div>
          <div><span className="font-medium text-blue-600">⚡ Compute:</span> CPU-intensive tasks</div>
          <div><span className="font-medium text-green-600">🧠 Memory:</span> Memory-intensive apps</div>
          <div><span className="font-medium text-orange-600">💾 Storage:</span> High I/O workloads</div>
          <div><span className="font-medium text-gray-600">📦 General:</span> Balanced workloads</div>
          <div><span className="font-medium text-yellow-600">💨 Burstable:</span> Variable workloads</div>
        </div>
      </div>
    </div>
  );
};

export default InstanceFamilyManagement;