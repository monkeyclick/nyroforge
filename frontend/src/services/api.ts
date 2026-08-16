import {
  LaunchWorkstationRequest,
  Workstation,
  DashboardData,
  CostData,
  RegionInfo,
  InstanceTypeInfo,
  WorkstationCredentials,
  GroupPackageInfo,
  PackageQueueItem,
  PackageInstallationStatusResponse,
  GroupPackageBinding,
  AddPackageToGroupRequest,
  UpdateGroupPackageRequest
} from '../types';
import {
  EnhancedUser,
  Role,
  Group,
  CognitoGroup,
  CreateUserRequest,
  UpdateUserRequest,
  CreateRoleRequest,
  CreateGroupRequest,
  UsersListResponse,
  RolesListResponse,
  GroupsListResponse,
  UserFilters,
  AuditLog,
  UserInvitation,
  Permission
} from '../types/auth';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import { useAuthStore } from '../stores/authStore';

export type DeploymentDoctorStatus = 'pass' | 'warning' | 'fail' | 'skipped';

export interface DeploymentDoctorCheck {
  id: string;
  category: string;
  title: string;
  status: DeploymentDoctorStatus;
  required: boolean;
  message: string;
  remediation?: string;
}

export interface DeploymentDoctorSummary {
  pass: number;
  warning: number;
  fail: number;
  skipped: number;
  total: number;
}

export interface DeploymentDoctorReport {
  generatedAt: string;
  region: string;
  status: DeploymentDoctorStatus;
  summary: DeploymentDoctorSummary;
  checks: DeploymentDoctorCheck[];
}

class ApiClient {
  private baseUrl: string;
  private adminApiUrl: string;
  private isConfigured: boolean;

  constructor() {
    const envEndpoint = process.env.NEXT_PUBLIC_API_ENDPOINT;
    const adminEnvEndpoint = process.env.NEXT_PUBLIC_ADMIN_API_ENDPOINT;
    
    // Validate that API endpoint is properly configured
    if (!envEndpoint || envEndpoint === '/api') {
      console.warn(
        'WARNING: NEXT_PUBLIC_API_ENDPOINT is not configured or using default /api. ' +
        'Please set NEXT_PUBLIC_API_ENDPOINT to your API Gateway URL in .env.local'
      );
      this.isConfigured = false;
      this.baseUrl = '/api'; // fallback, but will show warnings
    } else {
      this.isConfigured = true;
      // Remove trailing slash to prevent double slashes in URL construction
      this.baseUrl = envEndpoint.replace(/\/+$/, '');
    }
    
    // Admin API endpoint (for EC2 discovery, etc.)
    // Remove trailing slash to prevent double slashes in URL construction
    this.adminApiUrl = (adminEnvEndpoint || this.baseUrl).replace(/\/+$/, '');
    
    // Log the configuration for debugging
    if (typeof window !== 'undefined') {
      console.log(`API Client initialized with baseUrl: ${this.baseUrl}`);
      if (adminEnvEndpoint) {
        console.log(`Admin API Client initialized with adminApiUrl: ${this.adminApiUrl}`);
      }
    }
  }

  private async getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
    const token = await this.getStoredToken(forceRefresh);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async getStoredToken(forceRefresh = false): Promise<string | null> {
    if (typeof window === 'undefined') return null;

    try {
      const session = await fetchAuthSession({ forceRefresh });
      return session.tokens?.idToken?.toString() || null;
    } catch (error) {
      console.error('Failed to get auth token:', error);
      return null;
    }
  }

  /**
   * Check if response body looks like XML/HTML (even if Content-Type says JSON)
   */
  private isXmlOrHtmlContent(text: string): boolean {
    const trimmed = text.trim();
    return (
      trimmed.startsWith('<?xml') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html') ||
      trimmed.startsWith('<HTML') ||
      // S3 XML error responses
      trimmed.startsWith('<Error>') ||
      trimmed.startsWith('<ListBucketResult') ||
      // CloudFront error pages
      trimmed.includes('AccessDenied') && trimmed.includes('<Code>')
    );
  }

  /**
   * Generate a helpful error message for XML/HTML responses
   */
  private getXmlErrorMessage(url: string, responseText: string): string {
    const trimmed = responseText.trim();
    
    // Try to extract S3/CloudFront error details
    if (trimmed.includes('<Code>')) {
      const codeMatch = trimmed.match(/<Code>([^<]+)<\/Code>/);
      const messageMatch = trimmed.match(/<Message>([^<]+)<\/Message>/);
      const code = codeMatch ? codeMatch[1] : 'Unknown';
      const message = messageMatch ? messageMatch[1] : 'Unknown error';
      
      if (code === 'AccessDenied') {
        return `Access denied to API endpoint. The URL ${url} may not exist or you may not have permission to access it. Please verify NEXT_PUBLIC_API_ENDPOINT is correctly configured.`;
      }
      if (code === 'NoSuchKey' || code === 'NoSuchBucket') {
        return `API endpoint not found. The URL ${url} does not exist. Please check your NEXT_PUBLIC_API_ENDPOINT configuration.`;
      }
      
      return `AWS Error (${code}): ${message}. URL: ${url}. Please verify your API configuration.`;
    }
    
    return `API endpoint misconfigured. Received HTML/XML instead of JSON from ${url}. Please verify NEXT_PUBLIC_API_ENDPOINT is set correctly to your API Gateway URL (should be something like https://xxxxxxxx.execute-api.us-west-2.amazonaws.com/api)`;
  }

  /**
   * Validate API configuration before making requests
   */
  public checkConfiguration(): { isValid: boolean; message: string } {
    if (!this.isConfigured) {
      return {
        isValid: false,
        message: 'API endpoint is not configured. Please set NEXT_PUBLIC_API_ENDPOINT in your .env.local file to your API Gateway URL.'
      };
    }
    
    // Check if it looks like a valid API Gateway URL
    const url = this.baseUrl;
    if (!url.startsWith('https://') && !url.startsWith('http://localhost')) {
      return {
        isValid: false,
        message: `API endpoint "${url}" does not appear to be a valid URL. It should start with https:// (e.g., https://xxxxxxxx.execute-api.us-west-2.amazonaws.com/api)`
      };
    }
    
    return { isValid: true, message: 'API configuration appears valid.' };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    useAdminApi: boolean = false,
    isRetry: boolean = false
  ): Promise<T> {
    // Check configuration before making requests
    const configCheck = this.checkConfiguration();
    if (!configCheck.isValid) {
      console.error('API Configuration Error:', configCheck.message);
      throw new Error(configCheck.message);
    }

    const baseUrl = useAdminApi ? this.adminApiUrl : this.baseUrl;
    const url = `${baseUrl}${endpoint}`;
    const authHeaders = await this.getAuthHeaders(isRetry);
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json', // Explicitly request JSON
      ...authHeaders,
      ...(options.headers as Record<string, string>),
    };

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (error) {
      console.error('Network request failed:', error);
      throw new Error(`Network error: Unable to reach ${url}. Please check your internet connection and API endpoint configuration.`);
    }

    // Expired token: refresh the session once and retry before giving up
    if (response.status === 401 && !isRetry) {
      return this.request<T>(endpoint, options, useAdminApi, true);
    }
    if (response.status === 401) {
      await this.handleSessionExpired();
      throw new Error('Your session has expired. Please sign in again.');
    }

    // Get the raw response text first to check for XML/HTML
    const responseText = await response.text();
    
    // Check if response looks like XML/HTML (regardless of Content-Type header)
    if (this.isXmlOrHtmlContent(responseText)) {
      console.error('Received XML/HTML response instead of JSON:', responseText.substring(0, 500));
      throw new Error(this.getXmlErrorMessage(url, responseText));
    }

    // Check content type header
    const contentType = response.headers.get('content-type');
    const isJson = contentType && contentType.includes('application/json');

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      
      // Try to parse as JSON for error details
      if (responseText) {
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (e) {
          // Not valid JSON, include response text in error
          errorMessage = `${errorMessage}. Response: ${responseText.substring(0, 200)}`;
        }
      }
      
      throw new Error(errorMessage);
    }

    // Handle empty responses
    if (!responseText || responseText.trim() === '') {
      // Some endpoints might return empty responses for DELETE operations
      if (options.method === 'DELETE') {
        return {} as T;
      }
      throw new Error(`Empty response received from ${url}`);
    }

    // Validate response is JSON before parsing
    if (!isJson && !responseText.startsWith('{') && !responseText.startsWith('[')) {
      console.error('Unexpected response format:', responseText.substring(0, 200));
      throw new Error(`Expected JSON response but received: ${responseText.substring(0, 100)}`);
    }

    try {
      return JSON.parse(responseText) as T;
    } catch (error) {
      console.error('Failed to parse JSON response:', error);
      console.error('Response text:', responseText.substring(0, 500));
      throw new Error(`Failed to parse JSON response from ${url}. Response starts with: "${responseText.substring(0, 50)}..."`);
    }
  }

  /**
   * The refresh-and-retry already failed, so the session is truly gone.
   * Clear local auth state, sign out of Amplify, and send the user to the
   * login page — otherwise every panel just surfaces opaque request errors
   * until the user figures out they need to log in again.
   */
  private sessionExpiryHandled = false;
  private async handleSessionExpired(): Promise<void> {
    if (this.sessionExpiryHandled) return;
    this.sessionExpiryHandled = true;
    try {
      useAuthStore.getState().logout();
      await signOut();
    } catch (error) {
      console.error('Error during forced logout:', error);
    }
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }

  // Generic HTTP methods for flexibility
  async get<T>(endpoint: string, useAdminApi: boolean = false): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' }, useAdminApi);
  }

  async post<T>(endpoint: string, data?: any, useAdminApi: boolean = false): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }, useAdminApi);
  }

  async put<T>(endpoint: string, data?: any, useAdminApi: boolean = false): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }, useAdminApi);
  }

  async delete<T>(endpoint: string, useAdminApi: boolean = false): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' }, useAdminApi);
  }

  async patch<T>(endpoint: string, data?: any, useAdminApi: boolean = false): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }, useAdminApi);
  }

  // Workstations (existing functionality)
  async getWorkstations(userId?: string): Promise<{ workstations: Workstation[] }> {
    const params = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    return this.request<{ workstations: Workstation[] }>(`/workstations${params}`);
  }

  async launchWorkstation(request: LaunchWorkstationRequest): Promise<Workstation> {
    return this.request<Workstation>('/workstations', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async terminateWorkstation(workstationId: string): Promise<void> {
    await this.request(`/workstations/${workstationId}`, {
      method: 'DELETE',
    });
  }

  // Instance power actions (start / stop / reboot) — do not terminate the instance
  async setWorkstationPower(
    workstationId: string,
    action: 'start' | 'stop' | 'reboot'
  ): Promise<{ status: string; message: string }> {
    return this.request<{ status: string; message: string }>(`/workstations/${workstationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ powerAction: action }),
    });
  }

  async startWorkstation(workstationId: string): Promise<{ status: string; message: string }> {
    return this.setWorkstationPower(workstationId, 'start');
  }

  async stopWorkstation(workstationId: string): Promise<{ status: string; message: string }> {
    return this.setWorkstationPower(workstationId, 'stop');
  }

  async rebootWorkstation(workstationId: string): Promise<{ status: string; message: string }> {
    return this.setWorkstationPower(workstationId, 'reboot');
  }

  async getWorkstationCredentials(workstationId: string): Promise<WorkstationCredentials> {
    return this.request<WorkstationCredentials>(`/workstations/${workstationId}/credentials`);
  }

  // Dashboard and Analytics
  async getDashboardStatus(): Promise<DashboardData> {
    return this.request<DashboardData>('/dashboard/status');
  }

  async getCostAnalytics(period: 'daily' | 'weekly' | 'monthly', userId?: string): Promise<CostData> {
    const params = new URLSearchParams({ period });
    if (userId) params.append('userId', userId);
    return this.request<CostData>(`/costs?${params.toString()}`);
  }

  // Configuration
  async getRegions(): Promise<RegionInfo[]> {
    return this.request<RegionInfo[]>('/regions');
  }

  async getInstanceTypes(): Promise<InstanceTypeInfo[]> {
    return this.request<InstanceTypeInfo[]>('/instance-types');
  }

  // User Management
  async getUsers(filters: UserFilters = {}, page = 1, limit = 20): Promise<UsersListResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      ...Object.entries(filters).reduce((acc, [key, value]) => {
        if (value !== undefined && value !== '') {
          acc[key] = value.toString();
        }
        return acc;
      }, {} as Record<string, string>)
    });

    return this.request<UsersListResponse>(`/users?${params.toString()}`, {}, true);
  }

  async getUserById(userId: string): Promise<EnhancedUser> {
    return this.request<EnhancedUser>(`/users/${userId}`, {}, true);
  }

  async createUser(userData: CreateUserRequest): Promise<{
    user: EnhancedUser;
    message: string;
    temporaryPassword?: string;
    note?: string;
  }> {
    return this.request('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    }, true);
  }

  async updateUser(userId: string, userData: UpdateUserRequest): Promise<EnhancedUser> {
    return this.request<EnhancedUser>(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    }, true);
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request(`/users/${userId}`, {
      method: 'DELETE',
    }, true);
  }

  // Enhanced User Deletion Methods
  async getDeletionPreview(userId: string): Promise<{
    user: {
      id: string;
      email: string;
      name: string;
      status: string;
      createdAt?: string;
      lastLoginAt?: string;
    };
    associatedData: {
      groupMemberships: {
        count: number;
        items: Array<{ groupId: string; membershipType: string }>;
      };
      auditLogEntries: number;
      savedPreferences: number;
    };
    deletionRestrictions: {
      canSoftDelete: boolean;
      canHardDelete: boolean;
      restrictions: string[];
      warnings: string[];
    };
  }> {
    return this.request(`/users/${userId}/deletion-preview`, {}, true);
  }

  async softDeleteUser(userId: string, options: {
    reason?: string;
    notes?: string;
    notifyUser?: boolean;
    retentionDays?: number;
  }): Promise<{
    success: boolean;
    message: string;
    deletedUser: {
      id: string;
      email: string;
      previousStatus: string;
      newStatus: string;
      deletionType: 'soft';
      deletedAt: string;
      deletedBy: string;
      scheduledPurgeDate: string;
      canRestore: boolean;
    };
    actions: {
      groupMembershipsRemoved: number;
      cognitoUserDisabled: boolean;
      notificationsSent: string[];
    };
    auditLogId: string;
  }> {
    return this.request(`/users/${userId}/soft-delete`, {
      method: 'POST',
      body: JSON.stringify(options),
    }, true);
  }

  async hardDeleteUser(userId: string, options: {
    confirmationEmail?: string;
    reason?: string;
    acknowledgements: {
      understandIrreversible: boolean;
      verifiedDeletion: boolean;
    };
  }): Promise<{
    success: boolean;
    message: string;
    deletedUser: {
      id: string;
      email: string;
      deletionType: 'hard';
      deletedAt: string;
      deletedBy: string;
    };
    actions: {
      groupMembershipsRemoved: number;
      cognitoUserDeleted: boolean;
      dynamoDBRecordsDeleted: number;
    };
    auditLogId: string;
  }> {
    // API Gateway exposes hard delete as POST /users/{id}/hard-delete
    // (DELETE /users/{id} is a plain Cognito delete with no cleanup/audit)
    return this.request(`/users/${userId}/hard-delete`, {
      method: 'POST',
      body: JSON.stringify(options),
    }, true);
  }

  async restoreUser(userId: string, options?: {
    restoreGroupMemberships?: boolean;
    notifyUser?: boolean;
  }): Promise<{
    success: boolean;
    message: string;
    restoredUser: {
      id: string;
      email: string;
      status: string;
      restoredAt: string;
      restoredBy: string;
    };
    actions: {
      groupMembershipsRestored: number;
      cognitoUserEnabled: boolean;
      notificationsSent: string[];
    };
    auditLogId: string;
  }> {
    return this.request(`/users/${userId}/restore`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }, true);
  }

  // Password Management Methods
  async setUserPassword(userId: string, options: {
    password: string;
    forceChangeOnLogin?: boolean;
    temporary?: boolean;
    expiresIn?: string;
    notifications?: {
      notifyUser?: boolean;
      includePasswordInEmail?: boolean;
      notifyAdmin?: boolean;
    };
    reason?: string;
  }): Promise<{
    success: boolean;
    message: string;
    details: {
      userId: string;
      email: string;
      passwordType: 'custom';
      temporary: boolean;
      expiresAt?: string;
      forceChangeOnLogin: boolean;
      updatedAt: string;
      updatedBy: string;
    };
    notifications: {
      userNotified: boolean;
      adminNotified: boolean;
    };
    auditLogId: string;
  }> {
    return this.request(`/users/${userId}/password`, {
      method: 'POST',
      body: JSON.stringify(options),
    }, true);
  }

  async generateUserPassword(userId: string, options?: {
    expiresIn?: string;
    length?: number;
    forceChangeOnLogin?: boolean;
    notifications?: {
      notifyUser?: boolean;
      includePasswordInEmail?: boolean;
      notifyAdmin?: boolean;
    };
    reason?: string;
  }): Promise<{
    success: boolean;
    message: string;
    details: {
      userId: string;
      email: string;
      generatedPassword: string;
      passwordType: 'temporary';
      temporary: boolean;
      expiresAt: string;
      forceChangeOnLogin: boolean;
      generatedAt: string;
      generatedBy: string;
    };
    notifications: {
      userNotified: boolean;
      adminNotified: boolean;
    };
    auditLogId: string;
  }> {
    return this.request(`/users/${userId}/password/generate`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }, true);
  }

  async getPasswordPolicy(): Promise<{
    id: string;
    minLength: number;
    maxLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    allowedSpecialChars: string;
    preventCommonPasswords: boolean;
    preventUsernameInPassword: boolean;
    expiryDays?: number;
    historyCount?: number;
  }> {
    return this.request('/password-policy', {}, true);
  }

  async suspendUser(userId: string): Promise<EnhancedUser> {
    return this.request<EnhancedUser>(`/users/${userId}/suspend`, {
      method: 'POST',
    }, true);
  }

  async activateUser(userId: string): Promise<EnhancedUser> {
    return this.request<EnhancedUser>(`/users/${userId}/activate`, {
      method: 'POST',
    }, true);
  }

  async inviteUser(invitation: CreateUserRequest): Promise<UserInvitation> {
    return this.request<UserInvitation>('/users/invite', {
      method: 'POST',
      body: JSON.stringify(invitation),
    }, true);
  }

  async resendInvitation(invitationId: string): Promise<void> {
    await this.request(`/admin/invitations/${invitationId}/resend`, {
      method: 'POST',
    });
  }

  async cancelInvitation(invitationId: string): Promise<void> {
    await this.request(`/admin/invitations/${invitationId}`, {
      method: 'DELETE',
    });
  }

  async getUserInvitations(): Promise<UserInvitation[]> {
    return this.request<UserInvitation[]>('/admin/invitations');
  }

  // Role Management
  async getRoles(): Promise<RolesListResponse> {
    return this.request<RolesListResponse>('/roles', {}, true);
  }

  async getRoleById(roleId: string): Promise<Role> {
    return this.request<Role>(`/roles/${roleId}`, {}, true);
  }

  async createRole(roleData: CreateRoleRequest): Promise<Role> {
    return this.request<Role>('/roles', {
      method: 'POST',
      body: JSON.stringify(roleData),
    }, true);
  }

  async updateRole(roleId: string, roleData: Partial<CreateRoleRequest>): Promise<Role> {
    return this.request<Role>(`/roles/${roleId}`, {
      method: 'PUT',
      body: JSON.stringify(roleData),
    }, true);
  }

  async deleteRole(roleId: string): Promise<void> {
    await this.request(`/roles/${roleId}`, {
      method: 'DELETE',
    }, true);
  }

  async getAvailablePermissions(): Promise<Permission[]> {
    return this.request<Permission[]>('/permissions', {}, true);
  }

  // Cognito Group Management — native user-pool groups. These are the groups
  // that appear in JWT claims and drive authorization and package bindings.
  async getCognitoGroups(): Promise<{ groups: CognitoGroup[] }> {
    return this.request('/cognito-groups', {}, true);
  }

  async createCognitoGroup(data: {
    groupName: string;
    description?: string;
    precedence?: number;
  }): Promise<{ group: CognitoGroup; message: string }> {
    return this.request('/cognito-groups', {
      method: 'POST',
      body: JSON.stringify(data),
    }, true);
  }

  async deleteCognitoGroup(groupName: string): Promise<{ message: string }> {
    return this.request(`/cognito-groups/${encodeURIComponent(groupName)}`, {
      method: 'DELETE',
    }, true);
  }

  async getUserCognitoGroups(userIdOrEmail: string): Promise<{ groups: CognitoGroup[] }> {
    return this.request(`/users/${encodeURIComponent(userIdOrEmail)}/groups`, {}, true);
  }

  async addUserToCognitoGroup(userIdOrEmail: string, groupName: string): Promise<{ message: string }> {
    return this.request(`/users/${encodeURIComponent(userIdOrEmail)}/groups`, {
      method: 'POST',
      body: JSON.stringify({ groupName }),
    }, true);
  }

  async removeUserFromCognitoGroup(userIdOrEmail: string, groupName: string): Promise<{ message: string }> {
    return this.request(
      `/users/${encodeURIComponent(userIdOrEmail)}/groups/${encodeURIComponent(groupName)}`,
      { method: 'DELETE' },
      true
    );
  }

  // Group Management
  async getGroups(): Promise<GroupsListResponse> {
    return this.request<GroupsListResponse>('/groups', {}, true);
  }

  async getGroupById(groupId: string): Promise<Group> {
    return this.request<Group>(`/groups/${groupId}`, {}, true);
  }

  async createGroup(groupData: CreateGroupRequest): Promise<Group> {
    return this.request<Group>('/groups', {
      method: 'POST',
      body: JSON.stringify(groupData),
    }, true);
  }

  async updateGroup(groupId: string, groupData: Partial<CreateGroupRequest>): Promise<Group> {
    return this.request<Group>(`/groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify(groupData),
    }, true);
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.request(`/groups/${groupId}`, {
      method: 'DELETE',
    }, true);
  }

  async addUserToGroup(
    groupId: string,
    userId: string,
    membershipType: 'static' | 'dynamic' | 'nested' = 'static',
    source?: string,
    expiresAt?: string
  ): Promise<void> {
    await this.request(`/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, membershipType, source, expiresAt }),
    }, true);
  }

  async removeUserFromGroup(groupId: string, userId: string): Promise<void> {
    await this.request(`/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
    }, true);
  }

  async getGroupMembers(groupId: string): Promise<{
    members: Array<{
      id: string;
      userId: string;
      groupId: string;
      membershipType: 'static' | 'dynamic' | 'nested';
      source?: string;
      addedAt: string;
      addedBy: string;
      expiresAt?: string;
    }>;
  }> {
    return this.request(`/groups/${groupId}/members`, {}, true);
  }

  async evaluateGroupRules(groupId: string): Promise<{
    matchedUsers: string[];
    count: number;
  }> {
    return this.request(`/groups/${groupId}/evaluate-rules`, {
      method: 'POST',
    }, true);
  }

  async getGroupAuditLogs(groupId?: string, limit: number = 100): Promise<{
    logs: Array<{
      id: string;
      groupId: string;
      action: 'created' | 'updated' | 'deleted' | 'member_added' | 'member_removed' | 'rule_evaluated' | 'hierarchy_changed';
      performedBy: string;
      timestamp: string;
      changes?: any;
      metadata?: Record<string, any>;
    }>;
  }> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (groupId) {
      params.append('groupId', groupId);
    }
    return this.request(`/group-audit-logs?${params.toString()}`, {}, true);
  }

  // Audit and Monitoring
  async getAuditLogs(
    page = 1, 
    limit = 50, 
    filters: {
      userId?: string;
      action?: string;
      resource?: string;
      startDate?: string;
      endDate?: string;
    } = {}
  ): Promise<{ logs: AuditLog[]; pagination: any }> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      ...Object.entries(filters).reduce((acc, [key, value]) => {
        if (value !== undefined && value !== '') {
          acc[key] = value.toString();
        }
        return acc;
      }, {} as Record<string, string>)
    });

    return this.request<{ logs: AuditLog[]; pagination: any }>(`/audit-logs?${params.toString()}`, {}, true);
  }

  async getUserLoginHistory(userId: string): Promise<any[]> {
    return this.request<any[]>(`/users/${userId}/login-history`, {}, true);
  }

  // Permission checking
  async checkUserPermissions(userId: string, permissions: Permission[]): Promise<Record<Permission, boolean>> {
    return this.request<Record<Permission, boolean>>(`/users/${userId}/permissions/check`, {
      method: 'POST',
      body: JSON.stringify({ permissions }),
    }, true);
  }

  // Bulk operations
  async bulkUpdateUsers(updates: { userId: string; data: UpdateUserRequest }[]): Promise<void> {
    await this.request('/users/bulk-update', {
      method: 'POST',
      body: JSON.stringify({ updates }),
    }, true);
  }

  async exportUsers(filters: UserFilters = {}): Promise<Blob> {
    const params = new URLSearchParams(
      Object.entries(filters).reduce((acc, [key, value]) => {
        if (value !== undefined && value !== '') {
          acc[key] = value.toString();
        }
        return acc;
      }, {} as Record<string, string>)
    );

    const authHeaders = await this.getAuthHeaders();
    const response = await fetch(`${this.adminApiUrl}/users/export?${params.toString()}`, {
      headers: authHeaders,
    });

    if (response.status === 401) {
      await this.handleSessionExpired();
      throw new Error('Your session has expired. Please sign in again.');
    }
    if (!response.ok) {
      throw new Error('Failed to export users');
    }

    return response.blob();
  }

  // Profile management (for current user)
  async updateProfile(profileData: Partial<EnhancedUser>): Promise<EnhancedUser> {
    return this.request<EnhancedUser>('/profile', {
      method: 'PUT',
      body: JSON.stringify(profileData),
    });
  }

  async updatePreferences(preferences: Partial<EnhancedUser['preferences']>): Promise<EnhancedUser> {
    return this.request<EnhancedUser>('/preferences', {
      method: 'PATCH',
      body: JSON.stringify(preferences),
    });
  }

  // Security Group Management
  async getSecurityGroups(): Promise<{
    securityGroups: Array<{
      groupId: string;
      groupName: string;
      description: string;
      vpcId: string;
      ingressRules: number;
      egressRules: number;
      tags?: Record<string, string>;
    }>;
  }> {
    return this.request('/security-groups', {}, true);
  }

  async getSecurityGroup(groupId: string): Promise<{
    groupId: string;
    groupName: string;
    description: string;
    vpcId: string;
    ingressRules: Array<{
      ipProtocol: string;
      fromPort?: number;
      toPort?: number;
      ipRanges?: Array<{ cidrIp: string; description?: string }>;
      ipv6Ranges?: Array<{ cidrIpv6: string; description?: string }>;
      userIdGroupPairs?: Array<{ groupId: string; description?: string }>;
    }>;
    egressRules: Array<{
      ipProtocol: string;
      fromPort?: number;
      toPort?: number;
      ipRanges?: Array<{ cidrIp: string; description?: string }>;
    }>;
    tags?: Record<string, string>;
  }> {
    return this.request(`/security-groups/${groupId}`, {}, true);
  }

  async getCommonPorts(): Promise<{
    ports: Record<string, { port: number; protocol: string; description: string }>;
  }> {
    return this.request('/security-groups/common-ports', {}, true);
  }

  async createSecurityGroup(data: {
    groupName: string;
    description: string;
  }): Promise<{ groupId: string; message: string }> {
    return this.request('/security-groups', {
      method: 'POST',
      body: JSON.stringify(data),
    }, true);
  }

  async addSecurityGroupRule(data: {
    groupId: string;
    port?: number;
    fromPort?: number;
    toPort?: number;
    protocol: string;
    cidrIp: string;
    description?: string;
    applicationName?: string;
  }): Promise<{ message: string; rule: any }> {
    return this.request('/security-groups/add-rule', {
      method: 'POST',
      body: JSON.stringify(data),
    }, true);
  }

  async removeSecurityGroupRule(data: {
    groupId: string;
    port?: number;
    fromPort?: number;
    toPort?: number;
    protocol: string;
    cidrIp: string;
  }): Promise<{ message: string }> {
    return this.request('/security-groups/remove-rule', {
      method: 'DELETE',
      body: JSON.stringify(data),
    }, true);
  }

  async deleteSecurityGroup(groupId: string): Promise<{ message: string }> {
    return this.request(`/security-groups/${groupId}`, {
      method: 'DELETE',
    }, true);
  }

  async getWorkstationsForSecurityGroup(groupId: string): Promise<{
    securityGroupId: string;
    workstations: Array<{
      workstationId: string;
      instanceId: string;
      userId: string;
      status: string;
      instanceType: string;
      region: string;
      publicIp?: string;
    }>;
    ec2InstanceCount: number;
  }> {
    return this.request(`/security-groups/workstations?groupId=${encodeURIComponent(groupId)}`, {}, true);
  }

  async attachSecurityGroupToWorkstation(data: {
    workstationId: string;
    securityGroupId: string;
  }): Promise<{
    message: string;
    workstationId: string;
    securityGroupId: string;
    previousSecurityGroupId?: string;
  }> {
    return this.request('/security-groups/attach-to-workstation', {
      method: 'POST',
      body: JSON.stringify(data),
    }, true);
  }

  async allowMyIp(workstationId: string): Promise<{
    message: string;
    ipAddress: string;
    securityGroupId: string;
    workstationId: string;
  }> {
    return this.request('/security-groups/allow-my-ip', {
      method: 'POST',
      body: JSON.stringify({ workstationId }),
    }, true);
  }

  // Bootstrap Package Management
  async getBootstrapPackages(): Promise<{
    packages: Array<{
      packageId: string;
      name: string;
      description: string;
      type: 'driver' | 'application';
      category: string;
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
    }>;
    summary: {
      total: number;
      required: number;
      optional: number;
      disabled: number;
    };
  }> {
    return this.request('/bootstrap-packages', {}, true);
  }

  async getAdminBootstrapPackages(): Promise<{
    packages: Array<any>;
    summary: {
      total: number;
      required: number;
      optional: number;
      disabled: number;
    };
  }> {
    return this.request('/bootstrap-packages', {}, true);
  }

  async getBootstrapPackage(packageId: string): Promise<any> {
    return this.request(`/bootstrap-packages/${packageId}`, {}, true);
  }

  async createBootstrapPackage(packageData: {
    name: string;
    description: string;
    type: 'driver' | 'application';
    category: string;
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
    metadata?: Record<string, any>;
  }): Promise<any> {
    return this.request('/bootstrap-packages', {
      method: 'POST',
      body: JSON.stringify(packageData),
    }, true);
  }

  async updateBootstrapPackage(packageId: string, packageData: Partial<any>): Promise<any> {
    return this.request(`/bootstrap-packages/${packageId}`, {
      method: 'PUT',
      body: JSON.stringify(packageData),
    }, true);
  }

  async deleteBootstrapPackage(packageId: string): Promise<void> {
    await this.request(`/bootstrap-packages/${packageId}`, {
      method: 'DELETE',
    }, true);
  }

  // Phase 4: Post-Boot Package Installation API Methods

  /**
   * Get packages associated with the current user's groups
   * These are packages that will be auto-installed based on group membership
   */
  async getUserGroupPackages(): Promise<{ packages: GroupPackageInfo[] }> {
    return this.request('/user/group-packages');
  }

  /**
   * Get package installation status for a workstation
   * Returns real-time status of post-boot package installation
   */
  async getPackageInstallationStatus(workstationId: string): Promise<PackageInstallationStatusResponse> {
    return this.request(`/workstations/${workstationId}/packages`);
  }

  /**
   * Retry a failed package installation
   */
  async retryPackageInstallation(workstationId: string, packageId: string): Promise<{ message: string }> {
    return this.request(`/workstations/${workstationId}/packages/${packageId}/retry`, {
      method: 'POST',
    });
  }

  /**
   * Get packages associated with a group (admin only)
   */
  async getGroupPackages(groupId: string): Promise<{ packages: GroupPackageBinding[] }> {
    return this.request(`/groups/${groupId}/packages`, {}, true);
  }

  /**
   * Associate a package with a group (admin only)
   */
  async addPackageToGroup(groupId: string, data: AddPackageToGroupRequest): Promise<GroupPackageBinding> {
    return this.request(`/groups/${groupId}/packages`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, true);
  }

  /**
   * Update package configuration for a group (admin only)
   */
  async updateGroupPackage(
    groupId: string,
    packageId: string,
    data: UpdateGroupPackageRequest
  ): Promise<GroupPackageBinding> {
    return this.request(`/groups/${groupId}/packages/${packageId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }, true);
  }

  /**
   * Remove package association from a group (admin only)
   */
  async removePackageFromGroup(groupId: string, packageId: string): Promise<{ message: string }> {
    return this.request(`/groups/${groupId}/packages/${packageId}`, {
      method: 'DELETE',
    }, true);
  }

  /**
   * Add packages to an already-launched workstation's queue (admin only)
   * Useful for adding packages to running workstations after launch
   */
  async addPackagesToWorkstation(
    workstationId: string,
    packageIds: string[]
  ): Promise<{ message: string; queued: number }> {
    return this.request(`/workstations/${workstationId}/packages`, {
      method: 'POST',
      body: JSON.stringify({ packageIds }),
    });
  }

  /**
   * Remove a queued package from a workstation (only if status is 'pending')
   */
  async removeQueuedPackage(workstationId: string, packageId: string): Promise<{ message: string }> {
    return this.request(`/workstations/${workstationId}/packages/${packageId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Push a workstation's auto-termination deadline out by N hours
   * (from now or the current deadline, whichever is later)
   */
  async extendWorkstationAutoTerminate(
    workstationId: string,
    hours: number
  ): Promise<{ message: string; workstation: Workstation }> {
    return this.request(`/workstations/${workstationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ extendAutoTerminateHours: hours }),
    });
  }

  /**
   * Update workstation friendly name
   */
  async updateWorkstationName(workstationId: string, friendlyName: string): Promise<Workstation> {
    return this.request<Workstation>(`/workstations/${workstationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ friendlyName }),
    });
  }

  /**
   * Reassign the owner and/or set the shared-user list of a workstation (admin only)
   */
  async updateWorkstationOwnership(
    workstationId: string,
    data: { owner?: string; assignedUsers?: string[] }
  ): Promise<{ message: string; workstation: Workstation }> {
    return this.request(`/workstations/${workstationId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // Deployment doctor (read-only admin health report)
  async getDeploymentDoctorReport(): Promise<DeploymentDoctorReport> {
    return this.request<DeploymentDoctorReport>('/admin/deployment-doctor', { method: 'GET' }, true);
  }

  // Instance Family Management (Admin)
  async getInstanceFamilies(): Promise<{
    allowedFamilies: string[];
    allFamilies: Array<{ family: string; description: string; isAllowed: boolean }>;
    updatedAt?: string;
    updatedBy?: string;
  }> {
    return this.request('/admin/instance-families', { method: 'GET' }, true);
  }

  async updateInstanceFamilies(allowedFamilies: string[], allowedTypes?: Record<string, string[]>): Promise<{
    message: string;
    allowedFamilies: string[];
  }> {
    return this.request('/admin/instance-families', {
      method: 'POST',
      body: JSON.stringify({
        allowedFamilies,
        allowedTypes: allowedTypes || {},
      }),
    }, true);
  }
}

export const apiClient = new ApiClient();