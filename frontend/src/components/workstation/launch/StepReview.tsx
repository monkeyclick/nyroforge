import { LaunchFormValues, SECURITY_GROUP_TEMPLATES } from './types';

interface InstanceTypeInfo {
  type: string;
  vcpus: number;
  memory: string;
  gpu: string;
  hourlyCost: number;
}

interface SecurityGroupInfo {
  groupId: string;
  groupName: string;
}

interface ReviewCardProps {
  title: string;
  stepIndex: number;
  onEditStep: (step: number) => void;
  children: React.ReactNode;
}

function ReviewCard({ title, stepIndex, onEditStep, children }: ReviewCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <button type="button" onClick={() => onEditStep(stepIndex)} className="text-xs text-blue-600 hover:text-blue-800">
          Edit
        </button>
      </div>
      <dl className="space-y-2 text-sm">{children}</dl>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 text-right">{value}</dd>
    </div>
  );
}

interface StepReviewProps {
  values: LaunchFormValues;
  instanceTypes: InstanceTypeInfo[];
  securityGroups: SecurityGroupInfo[];
  clientIp: string;
  error: string;
  isPending: boolean;
  isSuccess: boolean;
  onEditStep: (step: number) => void;
  onBack: () => void;
  onLaunch: () => void;
}

export function StepReview({
  values,
  instanceTypes,
  securityGroups,
  clientIp,
  error,
  isPending,
  isSuccess,
  onEditStep,
  onBack,
  onLaunch,
}: StepReviewProps) {
  const instanceInfo = instanceTypes.find((t) => t.type === values.instanceType);
  const existingSecurityGroup = securityGroups.find((sg) => sg.groupId === values.selectedSecurityGroup);
  const template = SECURITY_GROUP_TEMPLATES.find((t) => t.name === values.selectedTemplate);
  const sourceIp = clientIp ? `${clientIp}/32 (your IP only)` : '0.0.0.0/0 (all IPs)';

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Review & Confirm</h2>
        <p className="mt-1 text-sm text-gray-500">Double-check everything before this workstation is launched.</p>
      </div>

      <div className="space-y-4">
        <ReviewCard title="Compute & Access" stepIndex={0} onEditStep={onEditStep}>
          <ReviewRow label="Name" value={values.friendlyName.trim() || 'Auto-generated'} />
          <ReviewRow label="Region" value={values.region} />
          <ReviewRow
            label="Instance Type"
            value={
              instanceInfo
                ? `${instanceInfo.type} (${instanceInfo.vcpus} vCPU, ${instanceInfo.memory}, ${
                    instanceInfo.gpu !== 'None' ? instanceInfo.gpu : 'No GPU'
                  }) - $${instanceInfo.hourlyCost.toFixed(2)}/hr`
                : values.instanceType
            }
          />
          <ReviewRow label="Windows Version" value={values.osVersion} />
          <ReviewRow label="Authentication" value={values.authMethod === 'local' ? 'Local Admin' : 'Domain Join'} />
          <ReviewRow
            label="Auto-Terminate"
            value={values.autoTerminateHours === 0 ? 'Never' : `${values.autoTerminateHours} hour${values.autoTerminateHours === 1 ? '' : 's'}`}
          />
        </ReviewCard>

        <ReviewCard title="Packages & Security" stepIndex={1} onEditStep={onEditStep}>
          <ReviewRow
            label="Bootstrap Packages"
            value={values.bootstrapPackages.length === 0 ? 'None selected' : `${values.bootstrapPackages.length} selected`}
          />
          {values.securityGroupMode === 'template' && (
            <>
              <ReviewRow label="Security Group" value={`Template: ${values.selectedTemplate || '—'}`} />
              {template && (
                <ReviewRow
                  label="Ports"
                  value={template.ports.map((p) => `${p.port}/${p.protocol.toUpperCase()}`).join(', ')}
                />
              )}
              <ReviewRow label="Source" value={sourceIp} />
            </>
          )}
          {values.securityGroupMode === 'existing' && (
            <ReviewRow
              label="Security Group"
              value={existingSecurityGroup ? `${existingSecurityGroup.groupName} (${existingSecurityGroup.groupId})` : '—'}
            />
          )}
          {values.securityGroupMode === 'new' && (
            <>
              <ReviewRow label="Security Group" value={`New: ${values.newSecurityGroupName || '—'}`} />
              <ReviewRow
                label="Ports"
                value={
                  values.customPorts.length === 0
                    ? 'None configured'
                    : values.customPorts.map((p) => `${p.port}/${p.protocol.toUpperCase()}`).join(', ')
                }
              />
              <ReviewRow label="Source" value={sourceIp} />
            </>
          )}
        </ReviewCard>

        <ReviewCard title="Tags & Details" stepIndex={2} onEditStep={onEditStep}>
          <ReviewRow label="Purpose" value={values.tagPurpose || '—'} />
          <ReviewRow label="Department" value={values.tagDepartment || '—'} />
          <ReviewRow label="Long-running" value={values.tagLongRunning ? 'Yes' : 'No'} />
        </ReviewCard>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">{error}</div>
      )}

      {isSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4 text-sm text-green-700">
          Workstation launched successfully! Redirecting to your dashboard...
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={isPending || isSuccess}
          className="px-4 py-2.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onLaunch}
          disabled={isPending || isSuccess}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? 'Launching...' : 'Launch Workstation'}
        </button>
      </div>
    </div>
  );
}

export default StepReview;
