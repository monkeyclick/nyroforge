import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/api';
import { LaunchWorkstationRequest } from '@/types';
import { WizardStepper } from './WizardStepper';
import { StepComputeAccess } from './StepComputeAccess';
import { StepPackagesSecurity } from './StepPackagesSecurity';
import { StepTagsDetails } from './StepTagsDetails';
import { StepReview } from './StepReview';
import { LaunchFormValues, SECURITY_GROUP_TEMPLATES, WIZARD_STEPS } from './types';

interface LaunchWizardProps {
  onCancel: () => void;
  onLaunched: () => void;
}

function getDefaultRegion(): string {
  try {
    const saved = localStorage.getItem('adminGeneralSettings');
    if (saved) return JSON.parse(saved).defaultRegion || 'us-east-1';
  } catch (e) {
    console.error('Failed to load admin settings:', e);
  }
  return 'us-east-1';
}

function getDefaultInstanceType(): string {
  try {
    const saved = localStorage.getItem('adminInstanceDefaults');
    if (saved) return JSON.parse(saved).defaultInstanceType || 'g5.xlarge';
  } catch (e) {
    console.error('Failed to load instance defaults:', e);
  }
  return 'g5.xlarge';
}

function getDefaultOsVersion(): string {
  try {
    const saved = localStorage.getItem('adminInstanceDefaults');
    if (saved) return JSON.parse(saved).defaultOsVersion || 'windows-server-2025';
  } catch (e) {
    console.error('Failed to load instance defaults:', e);
  }
  return 'windows-server-2025';
}

function getDefaultAutoTerminate(): number {
  try {
    const saved = localStorage.getItem('adminGeneralSettings');
    if (saved) {
      const hours = JSON.parse(saved).autoTerminateHours;
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
}

function getDefaultValues(): LaunchFormValues {
  return {
    friendlyName: '',
    region: getDefaultRegion(),
    instanceType: getDefaultInstanceType(),
    osVersion: getDefaultOsVersion(),
    authMethod: 'local',
    autoTerminateHours: getDefaultAutoTerminate(),
    bootstrapPackages: [],
    securityGroupMode: 'template',
    selectedSecurityGroup: '',
    newSecurityGroupName: '',
    newSecurityGroupDescription: '',
    selectedTemplate: '',
    customPorts: [],
    tagPurpose: 'workstation',
    tagDepartment: 'se',
    tagLongRunning: false,
  };
}

function resolveOwnerEmail(): string {
  try {
    const tokenKey = Object.keys(localStorage).find((k) => k.endsWith('.idToken'));
    if (tokenKey) {
      const payload64 = localStorage.getItem(tokenKey)?.split('.')[1] || '';
      return JSON.parse(atob(payload64))?.email || '';
    }
  } catch (_) {
    // ignore malformed token
  }
  return '';
}

export function LaunchWizard({ onCancel, onLaunched }: LaunchWizardProps) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<LaunchFormValues>(getDefaultValues);
  const [currentStep, setCurrentStep] = useState(0);
  const [error, setError] = useState('');
  const [clientIp, setClientIp] = useState('');

  const updateValue = <K extends keyof LaunchFormValues>(key: K, value: LaunchFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    fetch('https://api.ipify.org?format=json')
      .then((res) => res.json())
      .then((data) => setClientIp(data.ip))
      .catch((err) => console.error('Failed to detect IP:', err));
  }, []);

  const { data: instanceTypesData, isLoading: loadingInstanceTypes } = useQuery({
    queryKey: ['instance-types'],
    queryFn: () => apiClient.getInstanceTypes(),
    staleTime: 0,
  });
  const { data: securityGroupsData } = useQuery({ queryKey: ['security-groups'], queryFn: () => apiClient.getSecurityGroups() });

  const launchMutation = useMutation({
    mutationFn: (data: LaunchWorkstationRequest) => apiClient.launchWorkstation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workstations'] });
      setTimeout(() => onLaunched(), 1500);
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to launch workstation');
    },
  });

  const instanceTypes = Array.isArray((instanceTypesData as any)?.instanceTypes) ? (instanceTypesData as any).instanceTypes : [];
  const securityGroups = securityGroupsData?.securityGroups || [];

  const validateStep = (step: number): string => {
    if (step === 1) {
      if (values.securityGroupMode === 'existing' && !values.selectedSecurityGroup) {
        return 'Please select a security group';
      }
      if (values.securityGroupMode === 'new' && (!values.newSecurityGroupName || !values.newSecurityGroupDescription)) {
        return 'Please provide security group name and description';
      }
      if (values.securityGroupMode === 'template' && !values.selectedTemplate) {
        return 'Please select a security group template';
      }
    }
    return '';
  };

  const goNext = () => {
    const validationError = validateStep(currentStep);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setCurrentStep((step) => Math.min(step + 1, WIZARD_STEPS.length - 1));
  };

  const goBack = () => {
    if (currentStep === 0) {
      onCancel();
      return;
    }
    setError('');
    setCurrentStep((step) => Math.max(step - 1, 0));
  };

  const goToStep = (step: number) => {
    setError('');
    setCurrentStep(step);
  };

  const handleLaunch = () => {
    setError('');

    const payload: LaunchWorkstationRequest = {
      friendlyName: values.friendlyName.trim() || undefined,
      region: values.region,
      instanceType: values.instanceType,
      osVersion: values.osVersion,
      authMethod: values.authMethod,
      autoTerminateHours: values.autoTerminateHours,
      bootstrapPackages: values.bootstrapPackages,
      tags: {
        purpose: values.tagPurpose,
        department: values.tagDepartment,
        owner: resolveOwnerEmail(),
        long_running: String(values.tagLongRunning),
      },
    };

    if (values.securityGroupMode === 'existing') {
      payload.securityGroupId = values.selectedSecurityGroup;
    } else if (values.securityGroupMode === 'new') {
      payload.createSecurityGroup = {
        name: values.newSecurityGroupName,
        description: values.newSecurityGroupDescription,
        rules: values.customPorts
          .filter((p) => p.port && p.protocol)
          .map((p) => ({
            port: parseInt(p.port, 10),
            protocol: p.protocol,
            cidrIp: clientIp ? `${clientIp}/32` : '0.0.0.0/0',
            description: p.description || `Port ${p.port}`,
          })),
      };
    } else if (values.securityGroupMode === 'template') {
      const template = SECURITY_GROUP_TEMPLATES.find((t) => t.name === values.selectedTemplate);
      if (template) {
        payload.createSecurityGroup = {
          name: values.newSecurityGroupName || `workstation-${Date.now()}`,
          description: template.description,
          rules: template.ports.map((p) => ({
            port: p.port,
            protocol: p.protocol,
            cidrIp: clientIp ? `${clientIp}/32` : '0.0.0.0/0',
            description: p.description,
          })),
        };
      }
    }

    launchMutation.mutate(payload);
  };

  return (
    <div>
      <WizardStepper steps={WIZARD_STEPS} currentStep={currentStep} />

      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        {currentStep === 0 && (
          <StepComputeAccess
            values={values}
            onChange={updateValue}
            instanceTypes={instanceTypes}
            loadingInstanceTypes={loadingInstanceTypes}
          />
        )}
        {currentStep === 1 && (
          <StepPackagesSecurity values={values} onChange={updateValue} securityGroups={securityGroups} clientIp={clientIp} />
        )}
        {currentStep === 2 && <StepTagsDetails values={values} onChange={updateValue} />}
        {currentStep === 3 && (
          <StepReview
            values={values}
            instanceTypes={instanceTypes}
            securityGroups={securityGroups}
            clientIp={clientIp}
            error={error}
            isPending={launchMutation.isPending}
            isSuccess={launchMutation.isSuccess}
            onEditStep={goToStep}
            onBack={goBack}
            onLaunch={handleLaunch}
          />
        )}

        {currentStep < 3 && (
          <>
            {error && <div className="mt-6 bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">{error}</div>}
            <div className="flex justify-between pt-8 mt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={goBack}
                className="px-4 py-2.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              >
                {currentStep === 0 ? 'Cancel' : 'Back'}
              </button>
              <button
                type="button"
                onClick={goNext}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default LaunchWizard;
