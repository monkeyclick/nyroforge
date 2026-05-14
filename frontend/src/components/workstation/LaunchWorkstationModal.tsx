import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../services/api';
import { LaunchWorkstationRequest, TagTemplate } from '../../types';
import { BootstrapPackageSelector } from './BootstrapPackageSelector';

interface LaunchWorkstationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface SecurityGroupTemplate {
  name: string;
  description: string;
  ports: Array<{ port: number; protocol: string; description: string }>;
}

const SECURITY_GROUP_TEMPLATES: SecurityGroupTemplate[] = [
  {
    name: 'Remote Desktop (RDP)',
    description: 'Windows RDP access',
    ports: [{ port: 3389, protocol: 'tcp', description: 'RDP' }]
  },
  {
    name: 'SSH Access',
    description: 'Linux SSH access',
    ports: [{ port: 22, protocol: 'tcp', description: 'SSH' }]
  },
  {
    name: 'HP Anywhere (RGS)',
    description: 'HP Remote Graphics Software',
    ports: [
      { port: 42966, protocol: 'tcp', description: 'HP RGS Receiver' },
      { port: 42967, protocol: 'tcp', description: 'HP RGS Sender' }
    ]
  },
  {
    name: 'Amazon DCV',
    description: 'NICE DCV remote display',
    ports: [
      { port: 8443, protocol: 'tcp', description: 'DCV HTTPS' },
      { port: 8443, protocol: 'udp', description: 'DCV QUIC' }
    ]
  },
  {
    name: 'Full Remote Access',
    description: 'RDP, SSH, VNC, and HTTPS',
    ports: [
      { port: 3389, protocol: 'tcp', description: 'RDP' },
      { port: 22, protocol: 'tcp', description: 'SSH' },
      { port: 5900, protocol: 'tcp', description: 'VNC' },
      { port: 443, protocol: 'tcp', description: 'HTTPS' }
    ]
  },
  {
    name: 'Web Server',
    description: 'HTTP and HTTPS access',
    ports: [
      { port: 80, protocol: 'tcp', description: 'HTTP' },
      { port: 443, protocol: 'tcp', description: 'HTTPS' }
    ]
  }
];

interface TemplateFieldInputsProps {
  template: TagTemplate;
  values: Record<string, string>;
  onChange: (updated: Record<string, string>) => void;
  locked: boolean;
}

const TemplateFieldInputs: React.FC<TemplateFieldInputsProps> = ({ template, values, onChange, locked }) => (
  <div className={`p-3 rounded-lg border mb-2 ${locked ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
    <p className="text-xs font-medium text-gray-700 mb-2">{template.name}</p>
    <div className="grid grid-cols-1 gap-2">
      {template.fields.map(field => (
        <div key={field.key}>
          <label className="block text-xs text-gray-600 mb-0.5">
            {field.label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
            <span className="text-gray-400 ml-1 font-mono">({field.key})</span>
          </label>
          {field.allowedValues && field.allowedValues.length > 0 ? (
            <select
              value={values[field.key] ?? field.defaultValue ?? ''}
              onChange={e => onChange({ ...values, [field.key]: e.target.value })}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            >
              <option value="">— Select —</option>
              {field.allowedValues.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={values[field.key] ?? field.defaultValue ?? ''}
              onChange={e => onChange({ ...values, [field.key]: e.target.value })}
              placeholder={field.defaultValue || field.label}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
            />
          )}
        </div>
      ))}
    </div>
  </div>
);

export const LaunchWorkstationModal: React.FC<LaunchWorkstationModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  
  // Load admin defaults from localStorage
  const getDefaultRegion = () => {
    try {
      const savedSettings = localStorage.getItem('adminGeneralSettings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        return parsed.defaultRegion || 'us-east-1';
      }
    } catch (e) {
      console.error('Failed to load admin settings:', e);
    }
    return 'us-east-1';
  };

  const getDefaultInstanceType = () => {
    try {
      const savedDefaults = localStorage.getItem('adminInstanceDefaults');
      if (savedDefaults) {
        const parsed = JSON.parse(savedDefaults);
        return parsed.defaultInstanceType || 'g5.xlarge';
      }
    } catch (e) {
      console.error('Failed to load instance defaults:', e);
    }
    return 'g5.xlarge';
  };

  const getDefaultOsVersion = () => {
    try {
      const savedDefaults = localStorage.getItem('adminInstanceDefaults');
      if (savedDefaults) {
        const parsed = JSON.parse(savedDefaults);
        return parsed.defaultOsVersion || 'windows-server-2025';
      }
    } catch (e) {
      console.error('Failed to load instance defaults:', e);
    }
    return 'windows-server-2025';
  };

  const getDefaultAutoTerminate = () => {
    try {
      const savedSettings = localStorage.getItem('adminGeneralSettings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        const hours = parsed.autoTerminateHours;
        if (hours === 'Never') return 0;
        if (hours === 'After 1 hour') return 1;
        if (hours === 'After 4 hours') return 4;
        if (hours === 'After 8 hours') return 8;
        if (hours === 'After 24 hours') return 24;
      }
    } catch (e) {
      console.error('Failed to load auto-terminate setting:', e);
    }
    return 8;
  };
  
  const [region, setRegion] = useState(getDefaultRegion());
  const [instanceType, setInstanceType] = useState(getDefaultInstanceType());
  const [platform, setPlatform] = useState<'windows' | 'linux'>('windows');
  const [osVersion, setOsVersion] = useState(getDefaultOsVersion());
  const [authMethod, setAuthMethod] = useState('local');
  const [autoTerminateHours, setAutoTerminateHours] = useState(getDefaultAutoTerminate());
  const [bootstrapPackages, setBootstrapPackages] = useState<string[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [templateTagValues, setTemplateTagValues] = useState<Record<string, string>>({});
  const [customTags, setCustomTags] = useState<Array<{ key: string; value: string }>>([]);
  const [showTagSection, setShowTagSection] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Security group state
  const [securityGroupMode, setSecurityGroupMode] = useState<'existing' | 'new' | 'template'>('template');
  const [selectedSecurityGroup, setSelectedSecurityGroup] = useState('');
  const [newSecurityGroupName, setNewSecurityGroupName] = useState('');
  const [newSecurityGroupDescription, setNewSecurityGroupDescription] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [clientIp, setClientIp] = useState('');
  const [customPorts, setCustomPorts] = useState<Array<{ port: string; protocol: string; description: string }>>([]);
  const [showAdvancedSecurity, setShowAdvancedSecurity] = useState(false);

  // Detect client IP
  useEffect(() => {
    if (isOpen) {
      fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => setClientIp(data.ip))
        .catch(err => console.error('Failed to detect IP:', err));
    }
  }, [isOpen]);

  // Fetch available regions
  const { data: regionsData } = useQuery({
    queryKey: ['regions'],
    queryFn: () => apiClient.getRegions(),
    enabled: isOpen,
  });

  // Fetch allowed instance types (from admin configuration)
  // Use staleTime: 0 to always fetch fresh data when modal opens
  // This ensures users see the latest admin-configured instance types
  const { data: instanceTypesData, isLoading: loadingInstanceTypes, refetch: refetchInstanceTypes } = useQuery({
    queryKey: ['instance-types'],
    queryFn: () => apiClient.getInstanceTypes(),
    enabled: isOpen,
    staleTime: 0, // Always consider data stale to fetch latest config
    refetchOnMount: 'always', // Refetch when modal mounts
  });

  // Refetch instance types when modal opens to ensure fresh data
  useEffect(() => {
    if (isOpen) {
      refetchInstanceTypes();
    }
  }, [isOpen, refetchInstanceTypes]);

  // Fetch security groups
  const { data: securityGroupsData } = useQuery({
    queryKey: ['security-groups'],
    queryFn: () => apiClient.getSecurityGroups(),
    enabled: isOpen,
  });

  // Fetch tag templates
  const { data: tagTemplatesData } = useQuery({
    queryKey: ['tag-templates'],
    queryFn: () => apiClient.getTagTemplates(),
    enabled: isOpen,
  });
  const tagTemplates: TagTemplate[] = tagTemplatesData?.templates || [];
  const requiredTemplates = tagTemplates.filter(t => t.isRequired && t.isEnabled);
  const optionalTemplates = tagTemplates.filter(t => !t.isRequired && t.isEnabled);

  // Launch workstation mutation
  const launchMutation = useMutation({
    mutationFn: (data: LaunchWorkstationRequest) => apiClient.launchWorkstation(data),
    onSuccess: () => {
      setSuccess('Workstation launched successfully!');
      queryClient.invalidateQueries({ queryKey: ['workstations'] });
      setTimeout(() => {
        onSuccess();
        onClose();
        setSuccess('');
        setError('');
      }, 2000);
    },
    onError: (error: any) => {
      setError(error.message || 'Failed to launch workstation');
    },
  });

  const handlePlatformChange = (newPlatform: 'windows' | 'linux') => {
    setPlatform(newPlatform);
    if (newPlatform === 'windows') {
      setOsVersion('windows-server-2025');
      setAuthMethod('local');
    } else {
      setOsVersion('ubuntu-22-04');
      setAuthMethod('local'); // Linux only supports local auth in this system
    }
  };

  const handleAddCustomPort = () => {
    setCustomPorts([...customPorts, { port: '', protocol: 'tcp', description: '' }]);
  };

  const handleRemoveCustomPort = (index: number) => {
    setCustomPorts(customPorts.filter((_, i) => i !== index));
  };

  const handleUpdateCustomPort = (index: number, field: string, value: string) => {
    const updated = [...customPorts];
    updated[index] = { ...updated[index], [field]: value };
    setCustomPorts(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate security group selection
    if (securityGroupMode === 'existing' && !selectedSecurityGroup) {
      setError('Please select a security group');
      return;
    }

    if (securityGroupMode === 'new' && (!newSecurityGroupName || !newSecurityGroupDescription)) {
      setError('Please provide security group name and description');
      return;
    }

    if (securityGroupMode === 'template' && !selectedTemplate) {
      setError('Please select a security group template');
      return;
    }

    // Build merged tags from templates + custom pairs
    const mergedTags: Record<string, string> = {};
    const allSelectedTemplates = [...requiredTemplates, ...optionalTemplates.filter(t => selectedTemplateIds.includes(t.templateId))];
    for (const tmpl of allSelectedTemplates) {
      for (const field of tmpl.fields) {
        const val = templateTagValues[field.key] ?? field.defaultValue;
        if (val) mergedTags[field.key] = val;
      }
    }
    for (const ct of customTags) {
      if (ct.key.trim()) mergedTags[ct.key.trim()] = ct.value;
    }

    const payload: any = {
      region,
      instanceType,
      osVersion,
      platform,
      authMethod: platform === 'linux' ? 'local' : (authMethod as 'local' | 'domain'),
      autoTerminateHours,
      bootstrapPackages,
      tags: mergedTags,
    };

    // Add security group configuration
    if (securityGroupMode === 'existing') {
      payload.securityGroupId = selectedSecurityGroup;
    } else if (securityGroupMode === 'new') {
      payload.createSecurityGroup = {
        name: newSecurityGroupName,
        description: newSecurityGroupDescription,
        rules: customPorts
          .filter(p => p.port && p.protocol)
          .map(p => ({
            port: parseInt(p.port),
            protocol: p.protocol,
            cidrIp: clientIp ? `${clientIp}/32` : '0.0.0.0/0',
            description: p.description || `Port ${p.port}`
          }))
      };
    } else if (securityGroupMode === 'template') {
      const template = SECURITY_GROUP_TEMPLATES.find(t => t.name === selectedTemplate);
      if (template) {
        payload.createSecurityGroup = {
          name: `${newSecurityGroupName || `workstation-${Date.now()}`}`,
          description: template.description,
          rules: template.ports.map(p => ({
            port: p.port,
            protocol: p.protocol,
            cidrIp: clientIp ? `${clientIp}/32` : '0.0.0.0/0',
            description: p.description
          }))
        };
      }
    }

    launchMutation.mutate(payload);
  };

  if (!isOpen) return null;

  const regions = Array.isArray(regionsData) ? regionsData : [];
  const instanceTypes = Array.isArray((instanceTypesData as any)?.instanceTypes)
    ? (instanceTypesData as any).instanceTypes
    : [];
  const securityGroups = securityGroupsData?.securityGroups || [];

  // Group instance types by family for better organization
  const groupedInstanceTypes = instanceTypes.reduce((acc: Record<string, any[]>, type: any) => {
    const family = type.type.split('.')[0].toUpperCase();
    if (!acc[family]) {
      acc[family] = [];
    }
    acc[family].push(type);
    return acc;
  }, {});

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-semibold mb-5">Launch New Workstation</h3>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="region">Region</label>
            <select
              id="region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <optgroup label="US Regions">
                <option value="us-east-1">us-east-1 (N. Virginia)</option>
                <option value="us-east-2">us-east-2 (Ohio)</option>
                <option value="us-west-1">us-west-1 (N. California)</option>
                <option value="us-west-2">us-west-2 (Oregon)</option>
              </optgroup>
              <optgroup label="US Local Zones">
                <option value="us-east-1-bos-1">us-east-1-bos-1 (Boston)</option>
                <option value="us-east-1-chi-1">us-east-1-chi-1 (Chicago)</option>
                <option value="us-east-1-dfw-1">us-east-1-dfw-1 (Dallas)</option>
                <option value="us-east-1-iah-1">us-east-1-iah-1 (Houston)</option>
                <option value="us-east-1-mci-1">us-east-1-mci-1 (Kansas City)</option>
                <option value="us-east-1-mia-1">us-east-1-mia-1 (Miami)</option>
                <option value="us-east-1-msp-1">us-east-1-msp-1 (Minneapolis)</option>
                <option value="us-east-1-nyc-1">us-east-1-nyc-1 (New York)</option>
                <option value="us-east-1-phl-1">us-east-1-phl-1 (Philadelphia)</option>
                <option value="us-west-2-den-1">us-west-2-den-1 (Denver)</option>
                <option value="us-west-2-las-1">us-west-2-las-1 (Las Vegas)</option>
                <option value="us-west-2-lax-1">us-west-2-lax-1 (Los Angeles)</option>
                <option value="us-west-2-phx-1">us-west-2-phx-1 (Phoenix)</option>
                <option value="us-west-2-pdx-1">us-west-2-pdx-1 (Portland)</option>
                <option value="us-west-2-sea-1">us-west-2-sea-1 (Seattle)</option>
              </optgroup>
              <optgroup label="Europe Regions">
                <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
                <option value="eu-west-1">eu-west-1 (Ireland)</option>
                <option value="eu-west-2">eu-west-2 (London)</option>
                <option value="eu-west-3">eu-west-3 (Paris)</option>
                <option value="eu-north-1">eu-north-1 (Stockholm)</option>
                <option value="eu-south-1">eu-south-1 (Milan)</option>
                <option value="eu-south-2">eu-south-2 (Spain)</option>
                <option value="eu-central-2">eu-central-2 (Zurich)</option>
              </optgroup>
              <optgroup label="Europe Local Zones">
                <option value="eu-central-1-ham-1">eu-central-1-ham-1 (Hamburg)</option>
                <option value="eu-central-1-muc-1">eu-central-1-muc-1 (Munich)</option>
                <option value="eu-south-1-mxp-1">eu-south-1-mxp-1 (Milan)</option>
                <option value="eu-west-1-dub-1">eu-west-1-dub-1 (Dublin)</option>
                <option value="eu-west-2-lcy-1">eu-west-2-lcy-1 (London)</option>
                <option value="eu-west-2-man-1">eu-west-2-man-1 (Manchester)</option>
                <option value="eu-west-3-par-1">eu-west-3-par-1 (Paris)</option>
              </optgroup>
              <optgroup label="Asia Pacific Regions">
                <option value="ap-east-1">ap-east-1 (Hong Kong)</option>
                <option value="ap-south-1">ap-south-1 (Mumbai)</option>
                <option value="ap-south-2">ap-south-2 (Hyderabad)</option>
                <option value="ap-northeast-1">ap-northeast-1 (Tokyo)</option>
                <option value="ap-northeast-2">ap-northeast-2 (Seoul)</option>
                <option value="ap-northeast-3">ap-northeast-3 (Osaka)</option>
                <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
                <option value="ap-southeast-2">ap-southeast-2 (Sydney)</option>
                <option value="ap-southeast-3">ap-southeast-3 (Jakarta)</option>
                <option value="ap-southeast-4">ap-southeast-4 (Melbourne)</option>
              </optgroup>
              <optgroup label="Asia Pacific Local Zones">
                <option value="ap-northeast-1-tyo-1">ap-northeast-1-tyo-1 (Tokyo)</option>
                <option value="ap-northeast-2-icn-1">ap-northeast-2-icn-1 (Seoul)</option>
                <option value="ap-south-1-del-1">ap-south-1-del-1 (Delhi)</option>
                <option value="ap-southeast-1-sin-1">ap-southeast-1-sin-1 (Singapore)</option>
                <option value="ap-southeast-2-per-1">ap-southeast-2-per-1 (Perth)</option>
                <option value="ap-southeast-2-syd-1">ap-southeast-2-syd-1 (Sydney)</option>
              </optgroup>
              <optgroup label="Middle East & Africa">
                <option value="me-south-1">me-south-1 (Bahrain)</option>
                <option value="me-central-1">me-central-1 (UAE)</option>
                <option value="af-south-1">af-south-1 (Cape Town)</option>
              </optgroup>
              <optgroup label="South America">
                <option value="sa-east-1">sa-east-1 (São Paulo)</option>
              </optgroup>
              <optgroup label="Canada">
                <option value="ca-central-1">ca-central-1 (Central)</option>
              </optgroup>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="instanceType">
              Instance Type
              {loadingInstanceTypes && <span className="text-xs text-gray-500 ml-2">(Loading...)</span>}
            </label>
            <select
              id="instanceType"
              value={instanceType}
              onChange={(e) => setInstanceType(e.target.value)}
              required
              disabled={loadingInstanceTypes}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50"
            >
              {loadingInstanceTypes ? (
                <option>Loading instance types...</option>
              ) : instanceTypes.length === 0 ? (
                <option>No instance types available - Contact admin</option>
              ) : (
                <>
                  {Object.keys(groupedInstanceTypes).sort().map((family) => (
                    <optgroup key={family} label={`${family} Family`}>
                      {groupedInstanceTypes[family]
                        .sort((a: any, b: any) => a.hourlyCost - b.hourlyCost)
                        .map((type: any) => (
                          <option key={type.type} value={type.type}>
                            {type.type} ({type.vcpus} vCPU, {type.memory}, {type.gpu !== 'None' ? type.gpu : 'No GPU'}) - ${type.hourlyCost.toFixed(2)}/hr
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </>
              )}
            </select>
            {!loadingInstanceTypes && instanceTypes.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                ⚠️ No instance types configured. Please contact your administrator to configure allowed instance types.
              </p>
            )}
            {!loadingInstanceTypes && instanceTypes.length > 0 && (
              <p className="mt-1 text-xs text-gray-500">
                {instanceTypes.length} instance type{instanceTypes.length !== 1 ? 's' : ''} available (configured by admin)
              </p>
            )}
          </div>

          <div className="form-group">
            <label>Platform</label>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => handlePlatformChange('windows')}
                className={`flex-1 px-3 py-2 text-sm rounded border flex items-center justify-center gap-2 ${
                  platform === 'windows'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 font-medium'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.801"/>
                </svg>
                Windows
              </button>
              <button
                type="button"
                onClick={() => handlePlatformChange('linux')}
                className={`flex-1 px-3 py-2 text-sm rounded border flex items-center justify-center gap-2 ${
                  platform === 'linux'
                    ? 'bg-orange-50 border-orange-500 text-orange-700 font-medium'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Linux
              </button>
            </div>
            {platform === 'linux' && (
              <p className="mt-1 text-xs text-orange-600">
                Linux workstations use NICE DCV for remote desktop access.
              </p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="osVersion">{platform === 'windows' ? 'Windows Version' : 'Linux Distribution'}</label>
            <select
              id="osVersion"
              value={osVersion}
              onChange={(e) => setOsVersion(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              {platform === 'windows' ? (
                <>
                  <option value="windows-server-2025">Windows Server 2025</option>
                  <option value="windows-server-2022">Windows Server 2022</option>
                  <option value="windows-server-2019">Windows Server 2019</option>
                  <option value="windows-server-2016">Windows Server 2016</option>
                </>
              ) : (
                <>
                  <optgroup label="Ubuntu">
                    <option value="ubuntu-24-04">Ubuntu 24.04 LTS (Noble)</option>
                    <option value="ubuntu-22-04">Ubuntu 22.04 LTS (Jammy)</option>
                  </optgroup>
                  <optgroup label="Amazon Linux">
                    <option value="al2023">Amazon Linux 2023</option>
                  </optgroup>
                  <optgroup label="Rocky Linux">
                    <option value="rocky-linux-9">Rocky Linux 9</option>
                  </optgroup>
                </>
              )}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="authMethod">Authentication Method</label>
            <select
              id="authMethod"
              value={authMethod}
              onChange={(e) => setAuthMethod(e.target.value)}
              required
              disabled={platform === 'linux'}
            >
              <option value="local">Local Admin</option>
              {platform === 'windows' && <option value="domain">Domain Join</option>}
            </select>
            {platform === 'linux' && (
              <p className="mt-1 text-xs text-gray-500">
                Linux workstations use local authentication only.
              </p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="autoTerminate">Auto-Terminate</label>
            <select
              id="autoTerminate"
              value={autoTerminateHours}
              onChange={(e) => setAutoTerminateHours(parseInt(e.target.value))}
              required
            >
              <option value="0">Never Terminate</option>
              <option value="1">1 Hour</option>
              <option value="2">2 Hours</option>
              <option value="4">4 Hours</option>
              <option value="8">8 Hours</option>
              <option value="12">12 Hours</option>
              <option value="24">24 Hours</option>
            </select>
          </div>

          {/* Bootstrap Package Selection */}
          <div className="form-group">
            <BootstrapPackageSelector
              instanceType={instanceType}
              osVersion={osVersion}
              selectedPackages={bootstrapPackages}
              onSelectionChange={setBootstrapPackages}
            />
          </div>

          {/* Tag Configuration */}
          <div className="form-group border-t pt-4 mt-4">
            <div className="flex justify-between items-center mb-3">
              <div>
                <label className="font-medium">Tags</label>
                {requiredTemplates.length > 0 && (
                  <span className="ml-2 text-xs text-red-600 font-medium">
                    {requiredTemplates.length} required template{requiredTemplates.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowTagSection(!showTagSection)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                {showTagSection ? 'Hide' : 'Configure Tags'}
              </button>
            </div>

            {showTagSection && (
              <div className="space-y-4">
                {/* Required templates — always shown, fields editable */}
                {requiredTemplates.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-600 mb-2 uppercase tracking-wide">
                      Required Templates (Enforced)
                    </p>
                    {requiredTemplates.map(tmpl => (
                      <TemplateFieldInputs
                        key={tmpl.templateId}
                        template={tmpl}
                        values={templateTagValues}
                        onChange={setTemplateTagValues}
                        locked
                      />
                    ))}
                  </div>
                )}

                {/* Optional templates */}
                {optionalTemplates.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                      Optional Templates
                    </p>
                    {optionalTemplates.map(tmpl => {
                      const selected = selectedTemplateIds.includes(tmpl.templateId);
                      return (
                        <div key={tmpl.templateId} className="mb-3">
                          <label className="flex items-center gap-2 cursor-pointer mb-1">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={e => {
                                setSelectedTemplateIds(prev =>
                                  e.target.checked
                                    ? [...prev, tmpl.templateId]
                                    : prev.filter(id => id !== tmpl.templateId)
                                );
                              }}
                              className="h-4 w-4 text-blue-600 rounded"
                            />
                            <span className="text-sm font-medium text-gray-700">{tmpl.name}</span>
                            {tmpl.description && (
                              <span className="text-xs text-gray-400">{tmpl.description}</span>
                            )}
                          </label>
                          {selected && (
                            <div className="ml-6">
                              <TemplateFieldInputs
                                template={tmpl}
                                values={templateTagValues}
                                onChange={setTemplateTagValues}
                                locked={false}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Custom key/value tags */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Custom Tags</p>
                    <button
                      type="button"
                      onClick={() => setCustomTags(prev => [...prev, { key: '', value: '' }])}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      + Add Tag
                    </button>
                  </div>
                  {customTags.length === 0 ? (
                    <p className="text-xs text-gray-400">No custom tags added</p>
                  ) : (
                    <div className="space-y-2">
                      {customTags.map((ct, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={ct.key}
                            onChange={e => setCustomTags(prev => prev.map((t, idx) => idx === i ? { ...t, key: e.target.value } : t))}
                            placeholder="Key"
                            className="w-32 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                          <input
                            type="text"
                            value={ct.value}
                            onChange={e => setCustomTags(prev => prev.map((t, idx) => idx === i ? { ...t, value: e.target.value } : t))}
                            placeholder="Value"
                            className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => setCustomTags(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-red-500 hover:text-red-700 text-xs px-1"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Preview of merged tags */}
                {(() => {
                  const preview: Record<string, string> = {};
                  const allSel = [...requiredTemplates, ...optionalTemplates.filter(t => selectedTemplateIds.includes(t.templateId))];
                  for (const tmpl of allSel) {
                    for (const field of tmpl.fields) {
                      const val = templateTagValues[field.key] ?? field.defaultValue;
                      if (val) preview[field.key] = val;
                    }
                  }
                  for (const ct of customTags) {
                    if (ct.key.trim()) preview[ct.key.trim()] = ct.value;
                  }
                  const entries = Object.entries(preview);
                  if (!entries.length) return null;
                  return (
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <p className="text-xs font-medium text-gray-600 mb-1.5">Tag Preview ({entries.length})</p>
                      <div className="flex flex-wrap gap-1">
                        {entries.map(([k, v]) => (
                          <span key={k} className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full font-mono">
                            {k}={v}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Security Group Configuration */}
          <div className="form-group border-t pt-4 mt-4">
            <div className="flex justify-between items-center mb-3">
              <label className="font-medium">Security Group Configuration</label>
              <button
                type="button"
                onClick={() => setShowAdvancedSecurity(!showAdvancedSecurity)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                {showAdvancedSecurity ? 'Hide' : 'Show'} Details
              </button>
            </div>

            {clientIp && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3">
                <p className="text-xs text-blue-800">
                  <strong>Your IP Address:</strong> {clientIp}
                  <br />
                  Security rules will be configured to allow access only from this IP by default.
                </p>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSecurityGroupMode('template')}
                  className={`flex-1 px-3 py-2 text-sm rounded border ${
                    securityGroupMode === 'template'
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Use Template
                </button>
                <button
                  type="button"
                  onClick={() => setSecurityGroupMode('existing')}
                  className={`flex-1 px-3 py-2 text-sm rounded border ${
                    securityGroupMode === 'existing'
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Use Existing
                </button>
                <button
                  type="button"
                  onClick={() => setSecurityGroupMode('new')}
                  className={`flex-1 px-3 py-2 text-sm rounded border ${
                    securityGroupMode === 'new'
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Create New
                </button>
              </div>

              {securityGroupMode === 'template' && (
                <div>
                  <label htmlFor="template" className="block text-sm font-medium text-gray-700 mb-1">
                    Select Template *
                  </label>
                  <select
                    id="template"
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="">Choose a template...</option>
                    {SECURITY_GROUP_TEMPLATES.map((template) => (
                      <option key={template.name} value={template.name}>
                        {template.name} - {template.description}
                      </option>
                    ))}
                  </select>

                  {selectedTemplate && showAdvancedSecurity && (
                    <div className="mt-2 p-3 bg-gray-50 rounded text-xs">
                      <strong>Ports that will be opened:</strong>
                      <ul className="mt-1 space-y-1">
                        {SECURITY_GROUP_TEMPLATES.find(t => t.name === selectedTemplate)?.ports.map((port, idx) => (
                          <li key={idx}>
                            • Port {port.port}/{port.protocol.toUpperCase()} - {port.description}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-gray-600">
                        Source: {clientIp ? `${clientIp}/32 (your IP only)` : '0.0.0.0/0 (all IPs)'}
                      </p>
                    </div>
                  )}

                  <div className="mt-2">
                    <label htmlFor="templateGroupName" className="block text-sm font-medium text-gray-700 mb-1">
                      Security Group Name (optional)
                    </label>
                    <input
                      id="templateGroupName"
                      type="text"
                      value={newSecurityGroupName}
                      onChange={(e) => setNewSecurityGroupName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="Auto-generated if not provided"
                    />
                  </div>
                </div>
              )}

              {securityGroupMode === 'existing' && (
                <div>
                  <label htmlFor="securityGroup" className="block text-sm font-medium text-gray-700 mb-1">
                    Select Security Group *
                  </label>
                  <select
                    id="securityGroup"
                    value={selectedSecurityGroup}
                    onChange={(e) => setSelectedSecurityGroup(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="">Choose a security group...</option>
                    {securityGroups.map((sg: any) => (
                      <option key={sg.groupId} value={sg.groupId}>
                        {sg.groupName} ({sg.groupId}) - {sg.ingressRules} rules
                      </option>
                    ))}
                  </select>
                  {selectedSecurityGroup && showAdvancedSecurity && (
                    <p className="mt-1 text-xs text-gray-600">
                      The selected security group's existing rules will be applied to this workstation.
                    </p>
                  )}
                </div>
              )}

              {securityGroupMode === 'new' && (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="newGroupName" className="block text-sm font-medium text-gray-700 mb-1">
                      Security Group Name *
                    </label>
                    <input
                      id="newGroupName"
                      type="text"
                      value={newSecurityGroupName}
                      onChange={(e) => setNewSecurityGroupName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="my-workstation-sg"
                    />
                  </div>
                  <div>
                    <label htmlFor="newGroupDesc" className="block text-sm font-medium text-gray-700 mb-1">
                      Description *
                    </label>
                    <input
                      id="newGroupDesc"
                      type="text"
                      value={newSecurityGroupDescription}
                      onChange={(e) => setNewSecurityGroupDescription(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="Security group for my workstation"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Ports to Open
                      </label>
                      <button
                        type="button"
                        onClick={handleAddCustomPort}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        + Add Port
                      </button>
                    </div>

                    {customPorts.length === 0 && (
                      <p className="text-xs text-gray-500 mb-2">
                        No ports configured. Add ports to allow network access.
                      </p>
                    )}

                    {customPorts.map((port, index) => (
                      <div key={index} className="flex gap-2 mb-2">
                        <input
                          type="number"
                          value={port.port}
                          onChange={(e) => handleUpdateCustomPort(index, 'port', e.target.value)}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="Port"
                          min="1"
                          max="65535"
                        />
                        <select
                          value={port.protocol}
                          onChange={(e) => handleUpdateCustomPort(index, 'protocol', e.target.value)}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                        >
                          <option value="tcp">TCP</option>
                          <option value="udp">UDP</option>
                          <option value="-1">All</option>
                        </select>
                        <input
                          type="text"
                          value={port.description}
                          onChange={(e) => handleUpdateCustomPort(index, 'description', e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="Description"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomPort(index)}
                          className="px-2 py-1 text-red-600 hover:text-red-800 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    ))}

                    {showAdvancedSecurity && customPorts.length > 0 && (
                      <div className="mt-2 p-3 bg-gray-50 rounded text-xs">
                        <p className="text-gray-600">
                          Source IP: {clientIp ? `${clientIp}/32 (your IP only)` : '0.0.0.0/0 (all IPs)'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button 
              type="button" 
              onClick={onClose}
              className="btn-primary"
              style={{ background: '#666' }}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn-primary"
              disabled={launchMutation.isPending}
            >
              {launchMutation.isPending ? 'Launching...' : 'Launch Workstation'}
            </button>
          </div>

          {error && (
            <div className="alert-error mt-4">
              {error}
            </div>
          )}

          {success && (
            <div className="alert-success mt-4">
              {success}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default LaunchWorkstationModal;