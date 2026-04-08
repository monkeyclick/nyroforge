import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../services/api';
import { LaunchWorkstationRequest } from '../../types';
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
  const [osVersion, setOsVersion] = useState(getDefaultOsVersion());
  const [authMethod, setAuthMethod] = useState('local');
  const [autoTerminateHours, setAutoTerminateHours] = useState(getDefaultAutoTerminate());
  const [bootstrapPackages, setBootstrapPackages] = useState<string[]>([]);
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

    const payload: any = {
      region,
      instanceType,
      osVersion,
      authMethod: authMethod as 'local' | 'domain',
      autoTerminateHours,
      bootstrapPackages,
      tags: {},
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
            <label htmlFor="osVersion">Windows Version</label>
            <select
              id="osVersion"
              value={osVersion}
              onChange={(e) => setOsVersion(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="windows-server-2025">Windows Server 2025</option>
              <option value="windows-server-2022">Windows Server 2022</option>
              <option value="windows-server-2019">Windows Server 2019</option>
              <option value="windows-server-2016">Windows Server 2016</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="authMethod">Authentication Method</label>
            <select
              id="authMethod"
              value={authMethod}
              onChange={(e) => setAuthMethod(e.target.value)}
              required
            >
              <option value="local">Local Admin</option>
              <option value="domain">Domain Join</option>
            </select>
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