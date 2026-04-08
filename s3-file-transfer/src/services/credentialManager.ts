//------------------------------------------------------------------------------
// Credential Manager - AWS Credentials Management
//------------------------------------------------------------------------------

import localforage from 'localforage';
import { v4 as uuidv4 } from 'uuid';
import {
  AWSCredentials,
  CredentialProfile,
  CredentialType,
} from '../types';

// Configure localforage for credential storage
const credentialStore = localforage.createInstance({
  name: 's3-file-transfer',
  storeName: 'credentials',
});

const PROFILES_KEY = 'credential_profiles';
const ACTIVE_PROFILE_KEY = 'active_profile_id';

export class CredentialManager {
  private profiles: Map<string, CredentialProfile> = new Map();
  private activeProfileId: string | null = null;
  private initialized: boolean = false;

  //----------------------------------------------------------------------------
  // Initialization
  //----------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load profiles from storage
      const storedProfiles = await credentialStore.getItem<CredentialProfile[]>(PROFILES_KEY);
      if (storedProfiles) {
        storedProfiles.forEach((profile) => {
          this.profiles.set(profile.id, {
            ...profile,
            createdAt: new Date(profile.createdAt),
            lastUsed: profile.lastUsed ? new Date(profile.lastUsed) : undefined,
          });
        });
      }

      // Load active profile
      this.activeProfileId = await credentialStore.getItem<string>(ACTIVE_PROFILE_KEY);

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize credential manager:', error);
      throw error;
    }
  }

  private async saveProfiles(): Promise<void> {
    const profiles = Array.from(this.profiles.values());
    await credentialStore.setItem(PROFILES_KEY, profiles);
  }

  private async saveActiveProfile(): Promise<void> {
    await credentialStore.setItem(ACTIVE_PROFILE_KEY, this.activeProfileId);
  }

  //----------------------------------------------------------------------------
  // Profile Management
  //----------------------------------------------------------------------------

  async createProfile(
    name: string,
    credentials: AWSCredentials,
    isDefault: boolean = false
  ): Promise<CredentialProfile> {
    await this.initialize();

    // If this is the first profile or set as default, clear other defaults
    if (isDefault || this.profiles.size === 0) {
      this.profiles.forEach((profile) => {
        profile.isDefault = false;
      });
    }

    const profile: CredentialProfile = {
      id: uuidv4(),
      name,
      credentials: this.sanitizeCredentials(credentials),
      isDefault: isDefault || this.profiles.size === 0,
      createdAt: new Date(),
    };

    this.profiles.set(profile.id, profile);
    await this.saveProfiles();

    // Set as active if it's the first profile
    if (this.profiles.size === 1) {
      await this.setActiveProfile(profile.id);
    }

    return profile;
  }

  async updateProfile(
    id: string,
    updates: Partial<Omit<CredentialProfile, 'id' | 'createdAt'>>
  ): Promise<CredentialProfile | null> {
    await this.initialize();

    const profile = this.profiles.get(id);
    if (!profile) return null;

    // Handle default flag
    if (updates.isDefault) {
      this.profiles.forEach((p) => {
        if (p.id !== id) p.isDefault = false;
      });
    }

    const updatedProfile: CredentialProfile = {
      ...profile,
      ...updates,
      credentials: updates.credentials
        ? this.sanitizeCredentials(updates.credentials)
        : profile.credentials,
    };

    this.profiles.set(id, updatedProfile);
    await this.saveProfiles();

    return updatedProfile;
  }

  async deleteProfile(id: string): Promise<boolean> {
    await this.initialize();

    if (!this.profiles.has(id)) return false;

    const profile = this.profiles.get(id)!;
    this.profiles.delete(id);

    // If deleted profile was default, set another as default
    if (profile.isDefault && this.profiles.size > 0) {
      const firstProfile = Array.from(this.profiles.values())[0];
      firstProfile.isDefault = true;
      this.profiles.set(firstProfile.id, firstProfile);
    }

    // If deleted profile was active, clear active
    if (this.activeProfileId === id) {
      this.activeProfileId = this.getDefaultProfile()?.id || null;
      await this.saveActiveProfile();
    }

    await this.saveProfiles();
    return true;
  }

  getProfile(id: string): CredentialProfile | undefined {
    return this.profiles.get(id);
  }

  getAllProfiles(): CredentialProfile[] {
    return Array.from(this.profiles.values()).sort((a, b) => {
      if (a.isDefault) return -1;
      if (b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  getDefaultProfile(): CredentialProfile | undefined {
    return Array.from(this.profiles.values()).find((p) => p.isDefault);
  }

  //----------------------------------------------------------------------------
  // Active Profile
  //----------------------------------------------------------------------------

  async setActiveProfile(id: string): Promise<boolean> {
    await this.initialize();

    if (!this.profiles.has(id)) return false;

    this.activeProfileId = id;

    // Update last used timestamp
    const profile = this.profiles.get(id)!;
    profile.lastUsed = new Date();
    this.profiles.set(id, profile);

    await this.saveActiveProfile();
    await this.saveProfiles();

    return true;
  }

  getActiveProfile(): CredentialProfile | undefined {
    if (!this.activeProfileId) {
      return this.getDefaultProfile();
    }
    return this.profiles.get(this.activeProfileId);
  }

  getActiveCredentials(): AWSCredentials | undefined {
    return this.getActiveProfile()?.credentials;
  }

  //----------------------------------------------------------------------------
  // Credential Validation
  //----------------------------------------------------------------------------

  validateCredentials(credentials: AWSCredentials): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check region
    if (!credentials.region) {
      errors.push('AWS region is required');
    } else if (!this.isValidRegion(credentials.region)) {
      errors.push('Invalid AWS region');
    }

    // Check based on credential type
    switch (credentials.type) {
      case 'accessKey':
        if (!credentials.accessKeyId) {
          errors.push('Access Key ID is required');
        } else if (!this.isValidAccessKeyId(credentials.accessKeyId)) {
          errors.push('Invalid Access Key ID format');
        }

        if (!credentials.secretAccessKey) {
          errors.push('Secret Access Key is required');
        }
        break;

      case 'profile':
        if (!credentials.profileName) {
          errors.push('Profile name is required');
        }
        break;

      case 'sso':
        if (!credentials.ssoStartUrl) {
          errors.push('SSO Start URL is required');
        }
        if (!credentials.ssoRegion) {
          errors.push('SSO Region is required');
        }
        if (!credentials.ssoAccountId) {
          errors.push('SSO Account ID is required');
        }
        if (!credentials.ssoRoleName) {
          errors.push('SSO Role Name is required');
        }
        break;

      case 'iamRole':
        // IAM role credentials are obtained from instance metadata
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private isValidAccessKeyId(accessKeyId: string): boolean {
    // AWS Access Key IDs start with AKIA, ASIA, or AIDA
    return /^(AKIA|ASIA|AIDA)[A-Z0-9]{16}$/.test(accessKeyId);
  }

  private isValidRegion(region: string): boolean {
    const validRegions = [
      'us-east-1',
      'us-east-2',
      'us-west-1',
      'us-west-2',
      'af-south-1',
      'ap-east-1',
      'ap-south-1',
      'ap-south-2',
      'ap-southeast-1',
      'ap-southeast-2',
      'ap-southeast-3',
      'ap-southeast-4',
      'ap-northeast-1',
      'ap-northeast-2',
      'ap-northeast-3',
      'ca-central-1',
      'eu-central-1',
      'eu-central-2',
      'eu-west-1',
      'eu-west-2',
      'eu-west-3',
      'eu-south-1',
      'eu-south-2',
      'eu-north-1',
      'il-central-1',
      'me-south-1',
      'me-central-1',
      'sa-east-1',
      'us-gov-east-1',
      'us-gov-west-1',
    ];
    return validRegions.includes(region);
  }

  //----------------------------------------------------------------------------
  // Utility Functions
  //----------------------------------------------------------------------------

  private sanitizeCredentials(credentials: AWSCredentials): AWSCredentials {
    return {
      ...credentials,
      // Trim whitespace from string values
      accessKeyId: credentials.accessKeyId?.trim(),
      secretAccessKey: credentials.secretAccessKey?.trim(),
      sessionToken: credentials.sessionToken?.trim(),
      profileName: credentials.profileName?.trim(),
      ssoStartUrl: credentials.ssoStartUrl?.trim(),
      ssoAccountId: credentials.ssoAccountId?.trim(),
      ssoRoleName: credentials.ssoRoleName?.trim(),
    };
  }

  getRegions(): { value: string; label: string; group: string }[] {
    return [
      // US
      { value: 'us-east-1', label: 'US East (N. Virginia)', group: 'US' },
      { value: 'us-east-2', label: 'US East (Ohio)', group: 'US' },
      { value: 'us-west-1', label: 'US West (N. California)', group: 'US' },
      { value: 'us-west-2', label: 'US West (Oregon)', group: 'US' },
      // Africa
      { value: 'af-south-1', label: 'Africa (Cape Town)', group: 'Africa' },
      // Asia Pacific
      { value: 'ap-east-1', label: 'Asia Pacific (Hong Kong)', group: 'Asia Pacific' },
      { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)', group: 'Asia Pacific' },
      { value: 'ap-south-2', label: 'Asia Pacific (Hyderabad)', group: 'Asia Pacific' },
      { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)', group: 'Asia Pacific' },
      { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)', group: 'Asia Pacific' },
      { value: 'ap-southeast-3', label: 'Asia Pacific (Jakarta)', group: 'Asia Pacific' },
      { value: 'ap-southeast-4', label: 'Asia Pacific (Melbourne)', group: 'Asia Pacific' },
      { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)', group: 'Asia Pacific' },
      { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul)', group: 'Asia Pacific' },
      { value: 'ap-northeast-3', label: 'Asia Pacific (Osaka)', group: 'Asia Pacific' },
      // Canada
      { value: 'ca-central-1', label: 'Canada (Central)', group: 'Canada' },
      // Europe
      { value: 'eu-central-1', label: 'Europe (Frankfurt)', group: 'Europe' },
      { value: 'eu-central-2', label: 'Europe (Zurich)', group: 'Europe' },
      { value: 'eu-west-1', label: 'Europe (Ireland)', group: 'Europe' },
      { value: 'eu-west-2', label: 'Europe (London)', group: 'Europe' },
      { value: 'eu-west-3', label: 'Europe (Paris)', group: 'Europe' },
      { value: 'eu-south-1', label: 'Europe (Milan)', group: 'Europe' },
      { value: 'eu-south-2', label: 'Europe (Spain)', group: 'Europe' },
      { value: 'eu-north-1', label: 'Europe (Stockholm)', group: 'Europe' },
      // Israel
      { value: 'il-central-1', label: 'Israel (Tel Aviv)', group: 'Israel' },
      // Middle East
      { value: 'me-south-1', label: 'Middle East (Bahrain)', group: 'Middle East' },
      { value: 'me-central-1', label: 'Middle East (UAE)', group: 'Middle East' },
      // South America
      { value: 'sa-east-1', label: 'South America (São Paulo)', group: 'South America' },
      // GovCloud
      { value: 'us-gov-east-1', label: 'AWS GovCloud (US-East)', group: 'GovCloud' },
      { value: 'us-gov-west-1', label: 'AWS GovCloud (US-West)', group: 'GovCloud' },
    ];
  }

  //----------------------------------------------------------------------------
  // Export/Import
  //----------------------------------------------------------------------------

  async exportProfiles(includeSecrets: boolean = false): Promise<string> {
    await this.initialize();

    const profiles = this.getAllProfiles().map((profile) => ({
      ...profile,
      credentials: includeSecrets
        ? profile.credentials
        : {
            ...profile.credentials,
            secretAccessKey: undefined,
            sessionToken: undefined,
          },
    }));

    return JSON.stringify(profiles, null, 2);
  }

  async importProfiles(
    json: string,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<{ imported: number; errors: string[] }> {
    await this.initialize();

    const errors: string[] = [];
    let imported = 0;

    try {
      const profiles = JSON.parse(json) as CredentialProfile[];

      if (mode === 'replace') {
        this.profiles.clear();
      }

      for (const profile of profiles) {
        const validation = this.validateCredentials(profile.credentials);
        if (!validation.valid) {
          errors.push(`Profile "${profile.name}": ${validation.errors.join(', ')}`);
          continue;
        }

        // Generate new ID to avoid conflicts
        const newProfile: CredentialProfile = {
          ...profile,
          id: uuidv4(),
          createdAt: new Date(),
          lastUsed: undefined,
        };

        this.profiles.set(newProfile.id, newProfile);
        imported++;
      }

      await this.saveProfiles();
    } catch (error) {
      errors.push(`Failed to parse JSON: ${(error as Error).message}`);
    }

    return { imported, errors };
  }

  //----------------------------------------------------------------------------
  // Clear Data
  //----------------------------------------------------------------------------

  async clearAllData(): Promise<void> {
    this.profiles.clear();
    this.activeProfileId = null;
    await credentialStore.clear();
    this.initialized = false;
  }
}

// Singleton instance
export const credentialManager = new CredentialManager();