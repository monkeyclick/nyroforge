export interface SecurityGroupTemplate {
  name: string;
  description: string;
  ports: Array<{ port: number; protocol: string; description: string }>;
}

export const SECURITY_GROUP_TEMPLATES: SecurityGroupTemplate[] = [
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

export type SecurityGroupMode = 'existing' | 'new' | 'template';

export interface CustomPort {
  port: string;
  protocol: string;
  description: string;
}

export interface LaunchFormValues {
  friendlyName: string;
  region: string;
  instanceType: string;
  osVersion: string;
  authMethod: 'local' | 'domain';
  autoTerminateHours: number;
  bootstrapPackages: string[];
  securityGroupMode: SecurityGroupMode;
  selectedSecurityGroup: string;
  newSecurityGroupName: string;
  newSecurityGroupDescription: string;
  selectedTemplate: string;
  customPorts: CustomPort[];
  tagPurpose: string;
  tagDepartment: string;
  tagLongRunning: boolean;
}

export const WIZARD_STEPS = ['Compute & Access', 'Packages & Security', 'Tags & Details', 'Review & Confirm'];
