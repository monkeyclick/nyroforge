import { useState } from 'react';
import { BootstrapPackageSelector } from '../BootstrapPackageSelector';
import { LaunchFormValues, SECURITY_GROUP_TEMPLATES } from './types';

interface SecurityGroupInfo {
  groupId: string;
  groupName: string;
  ingressRules: number;
}

interface StepPackagesSecurityProps {
  values: LaunchFormValues;
  onChange: <K extends keyof LaunchFormValues>(key: K, value: LaunchFormValues[K]) => void;
  securityGroups: SecurityGroupInfo[];
  clientIp: string;
}

export function StepPackagesSecurity({ values, onChange, securityGroups, clientIp }: StepPackagesSecurityProps) {
  const [showAdvancedSecurity, setShowAdvancedSecurity] = useState(false);

  const handleAddCustomPort = () => {
    onChange('customPorts', [...values.customPorts, { port: '', protocol: 'tcp', description: '' }]);
  };

  const handleRemoveCustomPort = (index: number) => {
    onChange('customPorts', values.customPorts.filter((_, i) => i !== index));
  };

  const handleUpdateCustomPort = (index: number, field: 'port' | 'protocol' | 'description', value: string) => {
    const updated = [...values.customPorts];
    updated[index] = { ...updated[index], [field]: value };
    onChange('customPorts', updated);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Packages & Security</h2>
        <p className="mt-1 text-sm text-gray-500">Pick software to bootstrap and how network access is controlled.</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <BootstrapPackageSelector
          instanceType={values.instanceType}
          osVersion={values.osVersion}
          selectedPackages={values.bootstrapPackages}
          onSelectionChange={(packages) => onChange('bootstrapPackages', packages)}
        />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Security Group Configuration</h3>
          <button
            type="button"
            onClick={() => setShowAdvancedSecurity(!showAdvancedSecurity)}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            {showAdvancedSecurity ? 'Hide' : 'Show'} Details
          </button>
        </div>

        {clientIp && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
            <p className="text-xs text-blue-800">
              <strong>Your IP Address:</strong> {clientIp}
              <br />
              Security rules will be configured to allow access only from this IP by default.
            </p>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex gap-2">
            {(['template', 'existing', 'new'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChange('securityGroupMode', mode)}
                className={`flex-1 px-3 py-2.5 text-sm rounded-md border ${
                  values.securityGroupMode === mode
                    ? 'bg-blue-50 border-blue-500 text-blue-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {mode === 'template' ? 'Use Template' : mode === 'existing' ? 'Use Existing' : 'Create New'}
              </button>
            ))}
          </div>

          {values.securityGroupMode === 'template' && (
            <div className="space-y-3">
              <div>
                <label htmlFor="template" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Select Template *
                </label>
                <select
                  id="template"
                  value={values.selectedTemplate}
                  onChange={(e) => onChange('selectedTemplate', e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Choose a template...</option>
                  {SECURITY_GROUP_TEMPLATES.map((template) => (
                    <option key={template.name} value={template.name}>
                      {template.name} - {template.description}
                    </option>
                  ))}
                </select>
              </div>

              {values.selectedTemplate && showAdvancedSecurity && (
                <div className="p-3 bg-gray-50 rounded-md text-xs">
                  <strong>Ports that will be opened:</strong>
                  <ul className="mt-1 space-y-1">
                    {SECURITY_GROUP_TEMPLATES.find((t) => t.name === values.selectedTemplate)?.ports.map((port, idx) => (
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

              <div>
                <label htmlFor="templateGroupName" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Security Group Name (optional)
                </label>
                <input
                  id="templateGroupName"
                  type="text"
                  value={values.newSecurityGroupName}
                  onChange={(e) => onChange('newSecurityGroupName', e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
                  placeholder="Auto-generated if not provided"
                />
              </div>
            </div>
          )}

          {values.securityGroupMode === 'existing' && (
            <div>
              <label htmlFor="securityGroup" className="block text-sm font-medium text-gray-700 mb-1.5">
                Select Security Group *
              </label>
              <select
                id="securityGroup"
                value={values.selectedSecurityGroup}
                onChange={(e) => onChange('selectedSecurityGroup', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
              >
                <option value="">Choose a security group...</option>
                {securityGroups.map((sg) => (
                  <option key={sg.groupId} value={sg.groupId}>
                    {sg.groupName} ({sg.groupId}) - {sg.ingressRules} rules
                  </option>
                ))}
              </select>
              {values.selectedSecurityGroup && showAdvancedSecurity && (
                <p className="mt-1.5 text-xs text-gray-600">
                  The selected security group's existing rules will be applied to this workstation.
                </p>
              )}
            </div>
          )}

          {values.securityGroupMode === 'new' && (
            <div className="space-y-4">
              <div>
                <label htmlFor="newGroupName" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Security Group Name *
                </label>
                <input
                  id="newGroupName"
                  type="text"
                  value={values.newSecurityGroupName}
                  onChange={(e) => onChange('newSecurityGroupName', e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
                  placeholder="my-workstation-sg"
                />
              </div>
              <div>
                <label htmlFor="newGroupDesc" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Description *
                </label>
                <input
                  id="newGroupDesc"
                  type="text"
                  value={values.newSecurityGroupDescription}
                  onChange={(e) => onChange('newSecurityGroupDescription', e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
                  placeholder="Security group for my workstation"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">Ports to Open</label>
                  <button type="button" onClick={handleAddCustomPort} className="text-xs text-blue-600 hover:text-blue-800">
                    + Add Port
                  </button>
                </div>

                {values.customPorts.length === 0 && (
                  <p className="text-xs text-gray-500 mb-2">No ports configured. Add ports to allow network access.</p>
                )}

                {values.customPorts.map((port, index) => (
                  <div key={index} className="flex gap-2 mb-2">
                    <input
                      type="number"
                      value={port.port}
                      onChange={(e) => handleUpdateCustomPort(index, 'port', e.target.value)}
                      className="w-24 px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                      placeholder="Port"
                      min="1"
                      max="65535"
                    />
                    <select
                      value={port.protocol}
                      onChange={(e) => handleUpdateCustomPort(index, 'protocol', e.target.value)}
                      className="w-24 px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                      <option value="-1">All</option>
                    </select>
                    <input
                      type="text"
                      value={port.description}
                      onChange={(e) => handleUpdateCustomPort(index, 'description', e.target.value)}
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm"
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

                {showAdvancedSecurity && values.customPorts.length > 0 && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-md text-xs">
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
    </div>
  );
}

export default StepPackagesSecurity;
