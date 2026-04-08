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
import { fetchAuthSession } from 'aws-amplify/auth';

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

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async getStoredToken(): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    
    try {
      const session = await fetchAuthSession();
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
    useAdminApi: boolean = false
  ): Promise<T> {
    // Check configuration before making requests
    const configCheck = this.checkConfiguration();
    if (!configCheck.isValid) {
      console.error('API Configuration Error:', configCheck.message);
      throw new Error(configCheck.message);
    }

    const baseUrl = useAdminApi ? this.adminApiUrl : this.baseUrl;
    const url = `${baseUrl}${endpoint}`;
    const authHeaders = await this.getAuthHeaders();
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

  // Authentication
  async getCurrentUser(): Promise<EnhancedUser> {
    return this.request<EnhancedUser>('/auth/me');
  }

  async refreshToken(): Promise<{ token: string; user: EnhancedUser }> {
    return this.request<{ token: string; user: EnhancedUser }>('/auth/refresh', {
      method: 'POST',
    });
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

    return this.request<UsersListResponse>(`/admin/users?${params.toString()}`);
  }

  async getUserById(userId: string): Promise<EnhancedUser> {
    return this.request<EnhancedUser>(`/admin/users/${userId}`);
  }

  async createUser(userData: CreateUserRequest): Promise<EnhancedUser> {
    return this.request<EnhancedUser>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async updateUser(userId: string, userData: UpdateUserRequest): Promise<EnhancedUser> {
    return this.request<EnhancedUser>(`/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request(`/admin/users/${userId}`, {
      method: 'DELETE',
    });
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
    return this.request(`/admin/users/${userId}/deletion-preview`);
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
    return this.request(`/admin/users/${userId}/soft-delete`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
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
    return this.request(`/admin/users/${userId}`, {
      method: 'DELETE',
      body: JSON.stringify(options),
    });
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
    return this.request(`/admin/users/${userId}/restore`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
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
    return this.request(`/admin/users/${userId}/password`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
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
    return this.request(`/admin/users/${userId}/password/generate`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
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
    return this.request('/admin/settings/password-policy');
  }

  async suspendUser(userId: string): Promise<EnhancedUser> {
    return this.request<EnhancedUser>(`/admin/users/${userId}/suspend`, {
      method: 'POST',
    });
  }

  async activateUser(userId: string): Promise<EnhancedUser> {
    return this.request<EnhancedUser>(`/admin/users/${userId}/activate`, {
      method: 'POST',
    });
  }

  async inviteUser(invitation: CreateUserRequest): Promise<UserInvitation> {
    return this.request<UserInvitation>('/admin/users/invite', {
      method: 'POST',
      body: JSON.stringify(invitation),
    });
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
    return this.request<RolesListResponse>('/admin/roles');
  }

  async getRoleById(roleId: string): Promise<Role> {
    return this.request<Role>(`/admin/roles/${roleId}`);
  }

  async createRole(roleData: CreateRoleRequest): Promise<Role> {
    return this.request<Role>('/admin/roles', {
      method: 'POST',
      body: JSON.stringify(roleData),
    });
  }

  async updateRole(roleId: string, roleData: Partial<CreateRoleRequest>): Promise<Role> {
    return this.request<Role>(`/admin/roles/${roleId}`, {
      method: 'PUT',
      body: JSON.stringify(roleData),
    });
  }

  async deleteRole(roleId: string): Promise<void> {
    await this.request(`/admin/roles/${roleId}`, {
      method: 'DELETE',
    });
  }

  async getAvailablePermissions(): Promise<Permission[]> {
    return this.request<Permission[]>('/admin/permissions');
  }

  // Group Management
  async getGroups(): Promise<GroupsListResponse> {
    return this.request<GroupsListResponse>('/admin/groups');
  }

  async getGroupById(groupId: string): Promise<Group> {
    return this.request<Group>(`/admin/groups/${groupId}`);
  }

  async createGroup(groupData: CreateGroupRequest): Promise<Group> {
    return this.request<Group>('/admin/groups', {
      method: 'POST',
      body: JSON.stringify(groupData),
    });
  }

  async updateGroup(groupId: string, groupData: Partial<CreateGroupRequest>): Promise<Group> {
    return this.request<Group>(`/admin/groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify(groupData),
    });
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.request(`/admin/groups/${groupId}`, {
      method: 'DELETE',
    });
  }

  async addUserToGroup(
    groupId: string,
    userId: string,
    membershipType: 'static' | 'dynamic' | 'nested' = 'static',
    source?: string,
    expiresAt?: string
  ): Promise<void> {
    await this.request(`/admin/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, membershipType, source, expiresAt }),
    });
  }

  async removeUserFromGroup(groupId: string, userId: string): Promise<void> {
    await this.request(`/admin/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
    });
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
    return this.request(`/admin/groups/${groupId}/members`);
  }

  async evaluateGroupRules(groupId: string): Promise<{
    matchedUsers: string[];
    count: number;
  }> {
    return this.request(`/admin/groups/${groupId}/evaluate-rules`, {
      method: 'POST',
    });
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
    return this.request(`/admin/group-audit-logs?${params.toString()}`);
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

    return this.request<{ logs: AuditLog[]; pagination: any }>(`/admin/audit-logs?${params.toString()}`);
  }

  async getUserLoginHistory(userId: string): Promise<any[]> {
    return this.request<any[]>(`/admin/users/${userId}/login-history`);
  }

  // Permission checking
  async checkUserPermissions(userId: string, permissions: Permission[]): Promise<Record<Permission, boolean>> {
    return this.request<Record<Permission, boolean>>(`/admin/users/${userId}/permissions/check`, {
      method: 'POST',
      body: JSON.stringify({ permissions }),
    });
  }

  // Bulk operations
  async bulkUpdateUsers(updates: { userId: string; data: UpdateUserRequest }[]): Promise<void> {
    await this.request('/admin/users/bulk-update', {
      method: 'POST',
      body: JSON.stringify({ updates }),
    });
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
    const response = await fetch(`${this.baseUrl}/admin/users/export?${params.toString()}`, {
      headers: authHeaders,
    });

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
    return this.request('/admin/security-groups');
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
    return this.request(`/admin/security-groups/${groupId}`);
  }

  async getCommonPorts(): Promise<{
    ports: Record<string, { port: number; protocol: string; description: string }>;
  }> {
    return this.request('/admin/security-groups/common-ports');
  }

  async createSecurityGroup(data: {
    groupName: string;
    description: string;
  }): Promise<{ groupId: string; message: string }> {
    return this.request('/admin/security-groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
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
    return this.request('/admin/security-groups/add-rule', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async removeSecurityGroupRule(data: {
    groupId: string;
    port?: number;
    fromPort?: number;
    toPort?: number;
    protocol: string;
    cidrIp: string;
  }): Promise<{ message: string }> {
    return this.request('/admin/security-groups/remove-rule', {
      method: 'DELETE',
      body: JSON.stringify(data),
    });
  }

  async deleteSecurityGroup(groupId: string): Promise<{ message: string }> {
    return this.request(`/admin/security-groups/${groupId}`, {
      method: 'DELETE',
    });
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
    return this.request(`/admin/security-groups/workstations?groupId=${encodeURIComponent(groupId)}`);
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
    return this.request('/admin/security-groups/attach-to-workstation', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async allowMyIp(workstationId: string): Promise<{
    message: string;
    ipAddress: string;
    securityGroupId: string;
    workstationId: string;
  }> {
    return this.request('/admin/security-groups/allow-my-ip', {
      method: 'POST',
      body: JSON.stringify({ workstationId }),
    });
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
    return this.request('/bootstrap-packages');
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
    return this.request('/admin/bootstrap-packages');
  }

  async getBootstrapPackage(packageId: string): Promise<any> {
    return this.request(`/admin/bootstrap-packages/${packageId}`);
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
    return this.request('/admin/bootstrap-packages', {
      method: 'POST',
      body: JSON.stringify(packageData),
    });
  }

  async updateBootstrapPackage(packageId: string, packageData: Partial<any>): Promise<any> {
    return this.request(`/admin/bootstrap-packages/${packageId}`, {
      method: 'PUT',
      body: JSON.stringify(packageData),
    });
  }

  async deleteBootstrapPackage(packageId: string): Promise<void> {
    await this.request(`/admin/bootstrap-packages/${packageId}`, {
      method: 'DELETE',
    });
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
    return this.request(`/admin/groups/${groupId}/packages`);
  }

  /**
   * Associate a package with a group (admin only)
   */
  async addPackageToGroup(groupId: string, data: AddPackageToGroupRequest): Promise<GroupPackageBinding> {
    return this.request(`/admin/groups/${groupId}/packages`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update package configuration for a group (admin only)
   */
  async updateGroupPackage(
    groupId: string,
    packageId: string,
    data: UpdateGroupPackageRequest
  ): Promise<GroupPackageBinding> {
    return this.request(`/admin/groups/${groupId}/packages/${packageId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Remove package association from a group (admin only)
   */
  async removePackageFromGroup(groupId: string, packageId: string): Promise<{ message: string }> {
    return this.request(`/admin/groups/${groupId}/packages/${packageId}`, {
      method: 'DELETE',
    });
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
   * Update workstation friendly name
   */
  async updateWorkstationName(workstationId: string, friendlyName: string): Promise<Workstation> {
    return this.request<Workstation>(`/workstations/${workstationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ friendlyName }),
    });
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