import { LaunchFormValues } from './types';

interface InstanceTypeInfo {
  type: string;
  vcpus: number;
  memory: string;
  gpu: string;
  hourlyCost: number;
}

interface StepComputeAccessProps {
  values: LaunchFormValues;
  onChange: <K extends keyof LaunchFormValues>(key: K, value: LaunchFormValues[K]) => void;
  instanceTypes: InstanceTypeInfo[];
  loadingInstanceTypes: boolean;
}

const REGION_GROUPS: Array<{ label: string; regions: Array<{ value: string; label: string }> }> = [
  {
    label: 'US Regions',
    regions: [
      { value: 'us-east-1', label: 'us-east-1 (N. Virginia)' },
      { value: 'us-east-2', label: 'us-east-2 (Ohio)' },
      { value: 'us-west-1', label: 'us-west-1 (N. California)' },
      { value: 'us-west-2', label: 'us-west-2 (Oregon)' },
    ],
  },
  {
    label: 'US Local Zones',
    regions: [
      { value: 'us-east-1-bos-1', label: 'us-east-1-bos-1 (Boston)' },
      { value: 'us-east-1-chi-1', label: 'us-east-1-chi-1 (Chicago)' },
      { value: 'us-east-1-dfw-1', label: 'us-east-1-dfw-1 (Dallas)' },
      { value: 'us-east-1-iah-1', label: 'us-east-1-iah-1 (Houston)' },
      { value: 'us-east-1-mci-1', label: 'us-east-1-mci-1 (Kansas City)' },
      { value: 'us-east-1-mia-1', label: 'us-east-1-mia-1 (Miami)' },
      { value: 'us-east-1-msp-1', label: 'us-east-1-msp-1 (Minneapolis)' },
      { value: 'us-east-1-nyc-1', label: 'us-east-1-nyc-1 (New York)' },
      { value: 'us-east-1-phl-1', label: 'us-east-1-phl-1 (Philadelphia)' },
      { value: 'us-west-2-den-1', label: 'us-west-2-den-1 (Denver)' },
      { value: 'us-west-2-las-1', label: 'us-west-2-las-1 (Las Vegas)' },
      { value: 'us-west-2-lax-1', label: 'us-west-2-lax-1 (Los Angeles)' },
      { value: 'us-west-2-phx-1', label: 'us-west-2-phx-1 (Phoenix)' },
      { value: 'us-west-2-pdx-1', label: 'us-west-2-pdx-1 (Portland)' },
      { value: 'us-west-2-sea-1', label: 'us-west-2-sea-1 (Seattle)' },
    ],
  },
  {
    label: 'Europe Regions',
    regions: [
      { value: 'eu-central-1', label: 'eu-central-1 (Frankfurt)' },
      { value: 'eu-west-1', label: 'eu-west-1 (Ireland)' },
      { value: 'eu-west-2', label: 'eu-west-2 (London)' },
      { value: 'eu-west-3', label: 'eu-west-3 (Paris)' },
      { value: 'eu-north-1', label: 'eu-north-1 (Stockholm)' },
      { value: 'eu-south-1', label: 'eu-south-1 (Milan)' },
      { value: 'eu-south-2', label: 'eu-south-2 (Spain)' },
      { value: 'eu-central-2', label: 'eu-central-2 (Zurich)' },
    ],
  },
  {
    label: 'Europe Local Zones',
    regions: [
      { value: 'eu-central-1-ham-1', label: 'eu-central-1-ham-1 (Hamburg)' },
      { value: 'eu-central-1-muc-1', label: 'eu-central-1-muc-1 (Munich)' },
      { value: 'eu-south-1-mxp-1', label: 'eu-south-1-mxp-1 (Milan)' },
      { value: 'eu-west-1-dub-1', label: 'eu-west-1-dub-1 (Dublin)' },
      { value: 'eu-west-2-lcy-1', label: 'eu-west-2-lcy-1 (London)' },
      { value: 'eu-west-2-man-1', label: 'eu-west-2-man-1 (Manchester)' },
      { value: 'eu-west-3-par-1', label: 'eu-west-3-par-1 (Paris)' },
    ],
  },
  {
    label: 'Asia Pacific Regions',
    regions: [
      { value: 'ap-east-1', label: 'ap-east-1 (Hong Kong)' },
      { value: 'ap-south-1', label: 'ap-south-1 (Mumbai)' },
      { value: 'ap-south-2', label: 'ap-south-2 (Hyderabad)' },
      { value: 'ap-northeast-1', label: 'ap-northeast-1 (Tokyo)' },
      { value: 'ap-northeast-2', label: 'ap-northeast-2 (Seoul)' },
      { value: 'ap-northeast-3', label: 'ap-northeast-3 (Osaka)' },
      { value: 'ap-southeast-1', label: 'ap-southeast-1 (Singapore)' },
      { value: 'ap-southeast-2', label: 'ap-southeast-2 (Sydney)' },
      { value: 'ap-southeast-3', label: 'ap-southeast-3 (Jakarta)' },
      { value: 'ap-southeast-4', label: 'ap-southeast-4 (Melbourne)' },
    ],
  },
  {
    label: 'Asia Pacific Local Zones',
    regions: [
      { value: 'ap-northeast-1-tyo-1', label: 'ap-northeast-1-tyo-1 (Tokyo)' },
      { value: 'ap-northeast-2-icn-1', label: 'ap-northeast-2-icn-1 (Seoul)' },
      { value: 'ap-south-1-del-1', label: 'ap-south-1-del-1 (Delhi)' },
      { value: 'ap-southeast-1-sin-1', label: 'ap-southeast-1-sin-1 (Singapore)' },
      { value: 'ap-southeast-2-per-1', label: 'ap-southeast-2-per-1 (Perth)' },
      { value: 'ap-southeast-2-syd-1', label: 'ap-southeast-2-syd-1 (Sydney)' },
    ],
  },
  {
    label: 'Middle East & Africa',
    regions: [
      { value: 'me-south-1', label: 'me-south-1 (Bahrain)' },
      { value: 'me-central-1', label: 'me-central-1 (UAE)' },
      { value: 'af-south-1', label: 'af-south-1 (Cape Town)' },
    ],
  },
  { label: 'South America', regions: [{ value: 'sa-east-1', label: 'sa-east-1 (São Paulo)' }] },
  { label: 'Canada', regions: [{ value: 'ca-central-1', label: 'ca-central-1 (Central)' }] },
];

export function StepComputeAccess({ values, onChange, instanceTypes, loadingInstanceTypes }: StepComputeAccessProps) {
  const groupedInstanceTypes = instanceTypes.reduce((acc: Record<string, InstanceTypeInfo[]>, type) => {
    const family = type.type.split('.')[0].toUpperCase();
    if (!acc[family]) acc[family] = [];
    acc[family].push(type);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Compute & Access</h2>
        <p className="mt-1 text-sm text-gray-500">Choose where your workstation runs and how you'll sign in.</p>
      </div>

      <div>
        <label htmlFor="friendlyName" className="block text-sm font-medium text-gray-700 mb-1.5">
          Workstation Name
        </label>
        <input
          id="friendlyName"
          type="text"
          value={values.friendlyName}
          onChange={(e) => onChange('friendlyName', e.target.value)}
          placeholder="e.g. Alice's Render Box"
          maxLength={100}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
        />
        <p className="mt-1.5 text-xs text-gray-500">
          Shown on your dashboard and as the EC2 instance's Name tag, so you can tell it apart from other workstations. Optional — defaults to an auto-generated ID.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="region" className="block text-sm font-medium text-gray-700 mb-1.5">
            Region
          </label>
          <select
            id="region"
            value={values.region}
            onChange={(e) => onChange('region', e.target.value)}
            required
            className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
          >
            {REGION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.regions.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="instanceType" className="block text-sm font-medium text-gray-700 mb-1.5">
            Instance Type
            {loadingInstanceTypes && <span className="text-xs text-gray-500 ml-2">(Loading...)</span>}
          </label>
          <select
            id="instanceType"
            value={values.instanceType}
            onChange={(e) => onChange('instanceType', e.target.value)}
            required
            disabled={loadingInstanceTypes}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm disabled:opacity-50"
          >
            {loadingInstanceTypes ? (
              <option>Loading instance types...</option>
            ) : instanceTypes.length === 0 ? (
              <option>No instance types available - Contact admin</option>
            ) : (
              Object.keys(groupedInstanceTypes)
                .sort()
                .map((family) => (
                  <optgroup key={family} label={`${family} Family`}>
                    {groupedInstanceTypes[family]
                      .sort((a, b) => a.hourlyCost - b.hourlyCost)
                      .map((type) => (
                        <option key={type.type} value={type.type}>
                          {type.type} ({type.vcpus} vCPU, {type.memory}, {type.gpu !== 'None' ? type.gpu : 'No GPU'}) - $
                          {type.hourlyCost.toFixed(2)}/hr
                        </option>
                      ))}
                  </optgroup>
                ))
            )}
          </select>
          {!loadingInstanceTypes && instanceTypes.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-600">
              No instance types configured. Please contact your administrator to configure allowed instance types.
            </p>
          )}
          {!loadingInstanceTypes && instanceTypes.length > 0 && (
            <p className="mt-1.5 text-xs text-gray-500">
              {instanceTypes.length} instance type{instanceTypes.length !== 1 ? 's' : ''} available (configured by admin)
            </p>
          )}
        </div>

        <div>
          <label htmlFor="osVersion" className="block text-sm font-medium text-gray-700 mb-1.5">
            Windows Version
          </label>
          <select
            id="osVersion"
            value={values.osVersion}
            onChange={(e) => onChange('osVersion', e.target.value)}
            required
            className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
          >
            <option value="windows-server-2025">Windows Server 2025</option>
            <option value="windows-server-2022">Windows Server 2022</option>
            <option value="windows-server-2019">Windows Server 2019</option>
            <option value="windows-server-2016">Windows Server 2016</option>
          </select>
        </div>

        <div>
          <label htmlFor="authMethod" className="block text-sm font-medium text-gray-700 mb-1.5">
            Authentication Method
          </label>
          <select
            id="authMethod"
            value={values.authMethod}
            onChange={(e) => onChange('authMethod', e.target.value as 'local' | 'domain')}
            required
            className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
          >
            <option value="local">Local Admin</option>
            <option value="domain">Domain Join</option>
          </select>
        </div>

        <div>
          <label htmlFor="autoTerminate" className="block text-sm font-medium text-gray-700 mb-1.5">
            Auto-Terminate
          </label>
          <select
            id="autoTerminate"
            value={values.autoTerminateHours}
            onChange={(e) => onChange('autoTerminateHours', parseInt(e.target.value, 10))}
            required
            className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
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
      </div>
    </div>
  );
}

export default StepComputeAccess;
