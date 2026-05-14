export interface Workstation {
  PK: string;
  SK: string;
  workstationId?: string;
  instanceId: string;
  userId: string;
  userRole: string;
  region: string;
  availabilityZone: string;
  instanceType: string;
  osVersion: string;
  platform: 'windows' | 'linux';
  amiId: string;
  vpcId: string;
  subnetId: string;
  securityGroupId: string;
  publicIp?: string;
  privateIp?: string;
  authMethod: 'domain' | 'local';
  domainJoined?: boolean;
  domainName?: string;
  localAdminUser?: string;
  linuxAdminUser?: string;
  credentialsSecretArn?: string;
  status: 'launching' | 'running' | 'stopping' | 'stopped' | 'terminated';
  launchTime: string;
  lastStatusCheck: string;
  autoTerminateAt?: string;
  estimatedHourlyCost: number;
  estimatedMonthlyCost: number;
  actualCostToDate: number;
  tags: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  // User-editable instance name
  friendlyName?: string;
  // Ownership information
  ownerName?: string;
  ownerGroups?: string[];
}

export interface DashboardSummary {
  totalInstances: number;
  runningInstances: number;
  stoppedInstances: number;
  terminatingInstances: number;
  totalHourlyCost: number;
  estimatedMonthlyCost: number;
}

export interface InstanceStatusInfo {
  workstationId: string;
  instanceId: string;
  userId: string;
  status: string;
  publicIp?: string;
  instanceType: string;
  region: string;
  runTime: string;
  hourlyCost: number;
  cpuUtilization?: number;
  networkIn?: number;
  networkOut?: number;
}

export interface DashboardData {
  summary: DashboardSummary;
  instances: InstanceStatusInfo[];
  lastUpdated: string;
}

export interface CostBreakdown {
  byInstanceType: Record<string, number>;
  byUser: Record<string, number>;
  byRegion: Record<string, number>;
  byProject: Record<string, number>;
}

export interface CostTrends {
  dailyAverage: number;
  weeklyAverage: number;
  monthlyTotal: number;
  projectedMonthly: number;
}

export interface CostData {
  period: string;
  totalCost: number;
  breakdown: CostBreakdown;
  trends: CostTrends;
  costOptimizationSuggestions: string[];
  lastUpdated: string;
}

export interface LaunchWorkstationRequest {
  region: string;
  instanceType: string;
  osVersion: string;
  platform?: 'windows' | 'linux';
  authMethod: 'domain' | 'local';
  domainConfig?: {
    domainName: string;
    ouPath?: string;
  };
  localAdminConfig?: {
    username: string;
  };
  linuxConfig?: {
    adminUsername?: string;
  };
  autoTerminateHours?: number;
  tags?: Record<string, string>;
}

export interface RegionInfo {
  id: string;
  name: string;
  available: boolean;
  instanceTypes: string[];
}

export interface InstanceTypeInfo {
  type: string;
  vcpus: number;
  memory: string;
  gpu: string;
  storage: string;
  network: string;
  hourlyCost: number;
  monthlyCost: number;
}

// Re-export enhanced types for backward compatibility
export type { EnhancedUser as User } from './auth';
export type { AuthContext as AuthState } from './auth';

export interface ApiResponse<T> {
  data?: T;
  message?: string;
  error?: string;
}

// Connection type interfaces
export interface RdpConnection {
  port: number;
  protocol: 'RDP';
  enabled: boolean;
}

export interface DcvConnection {
  port: number;
  protocol: 'DCV';
  quicEnabled: boolean;
  webUrl: string;
  enabled: boolean;
}

export interface WorkstationCredentials {
  type: 'local' | 'domain';
  platform?: 'windows' | 'linux';
  username: string;
  password?: string;
  domain?: string;
  connectionInfo: {
    publicIp: string;
    rdpPort?: number;
    dcvPort?: number;
    dcvUrl?: string;
    quicEnabled?: boolean;
    protocol?: string;
    rdp?: RdpConnection;
    dcv?: DcvConnection;
  };
  expiresAt?: string;
  rdpFile?: string;
}

// Phase 4: Post-Boot Package Installation Types

export interface GroupPackageInfo {
  packageId: string;
  packageName: string;
  isMandatory: boolean;
  autoInstall: boolean;
  installOrder: number;
  groupName: string;
}

export interface PackageQueueItem {
  packageId: string;
  packageName: string;
  downloadUrl: string;
  installCommand: string;
  installArgs: string;
  status: 'pending' | 'installing' | 'completed' | 'failed';
  installOrder: number;
  required: boolean;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  estimatedInstallTimeMinutes?: number;
}

export interface GroupPackageBinding {
  packageId: string;
  packageName: string;
  packageDescription?: string;
  autoInstall: boolean;
  isMandatory: boolean;
  installOrder: number;
  createdAt: string;
  createdBy?: string;
}

export interface PackageInstallationStatusResponse {
  workstationId: string;
  packages: PackageQueueItem[];
  summary: {
    total: number;
    pending: number;
    installing: number;
    completed: number;
    failed: number;
  };
}

export interface AddPackageToGroupRequest {
  packageId: string;
  autoInstall: boolean;
  isMandatory: boolean;
  installOrder: number;
}

export interface UpdateGroupPackageRequest {
  autoInstall?: boolean;
  isMandatory?: boolean;
  installOrder?: number;
}

// ============================================
// Tag Templates
// ============================================

export interface TagFieldValidation {
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface TagField {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  allowedValues?: string[];
  defaultValue?: string;
  validation?: TagFieldValidation;
}

export interface TagTemplate {
  templateId: string;
  name: string;
  description?: string;
  category: string;
  isRequired: boolean;
  isEnabled: boolean;
  fields: TagField[];
  appliedCount?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TagTemplateListResponse {
  templates: TagTemplate[];
  summary: {
    total: number;
    required: number;
    optional: number;
    disabled: number;
    categories: string[];
  };
}

export interface ApplyTemplatesRequest {
  templateIds: string[];
  workstationIds: string[];
  tagValues?: Record<string, string>;
}

export interface WorkstationTagCompliance {
  workstationId: string;
  instanceId?: string;
  name: string;
  userId: string;
  osVersion?: string;
  platform?: 'windows' | 'linux';
  state?: string;
  overallCompliant: boolean;
  templateCompliance: {
    templateId: string;
    templateName: string;
    compliant: boolean;
    missingFields: string[];
    presentFields: string[];
  }[];
  ec2Tags: Record<string, string>;
  customTags: Record<string, string>;
}

export interface TagTemplateSummary {
  templateId: string;
  templateName: string;
  category: string;
  totalWorkstations: number;
  compliantCount: number;
  nonCompliantCount: number;
  compliancePercent: number;
}

export interface TagReportResponse {
  summary: {
    totalWorkstations: number;
    compliantCount: number;
    nonCompliantCount: number;
    compliancePercent: number;
    requiredTemplates: number;
    totalTemplates: number;
    generatedAt: string;
  };
  templateSummary: TagTemplateSummary[];
  workstations: WorkstationTagCompliance[];
  costByDimension: Record<string, Record<string, number>>;
}