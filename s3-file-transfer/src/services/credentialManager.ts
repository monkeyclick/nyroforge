//------------------------------------------------------------------------------
// Credential Manager - AWS Credentials Management
//------------------------------------------------------------------------------

import localforage from 'localforage';
import { v4 as uuidv4 } from 'uuid';
import {
  AWSCredentials,
  CredentialProfile,
  EncryptedPayload,
} from '../types';
import {
  SecretMaterial,
  encryptSecret,
  decryptSecret,
} from './cryptoService';

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

  // Decrypted secret material lives ONLY in memory, keyed by profile id, and
  // only for profiles the user has unlocked this session. It is never persisted.
  private unlockedSecrets: Map<string, SecretMaterial> = new Map();

  //----------------------------------------------------------------------------
  // Initialization
  //----------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load profiles from storage
      const storedProfiles = await credentialStore.getItem<CredentialProfile[]>(PROFILES_KEY);
      let foundLegacyPlaintext = false;

      if (storedProfiles) {
        storedProfiles.forEach((raw) => {
          // Legacy profiles stored the secret in cleartext. Detect it, strip it
          // out of the persisted shape, but keep it in memory for this session
          // only so the app keeps working until the user re-encrypts it.
          const legacySecretAccessKey = raw.credentials?.secretAccessKey;
          const legacySessionToken = raw.credentials?.sessionToken;
          const hasLegacyPlaintext = !!(legacySecretAccessKey || legacySessionToken);

          const credentials = this.stripSecrets(raw.credentials);
          const needsMigration =
            credentials.type === 'accessKey' && !raw.encryptedSecret;

          const profile: CredentialProfile = {
            ...raw,
            credentials,
            encryptedSecret: raw.encryptedSecret,
            needsMigration: needsMigration || undefined,
            createdAt: new Date(raw.createdAt),
            lastUsed: raw.lastUsed ? new Date(raw.lastUsed) : undefined,
          };
          this.profiles.set(profile.id, profile);

          if (hasLegacyPlaintext) {
            foundLegacyPlaintext = true;
            this.unlockedSecrets.set(profile.id, {
              secretAccessKey: legacySecretAccessKey,
              sessionToken: legacySessionToken,
            });
          }
        });
      }

      // Load active profile
      this.activeProfileId = await credentialStore.getItem<string>(ACTIVE_PROFILE_KEY);

      this.initialized = true;

      // Immediately scrub any plaintext secrets that were on disk.
      if (foundLegacyPlaintext) {
        await this.saveProfiles();
      }
    } catch (error) {
      console.error('Failed to initialize credential manager:', error);
      throw error;
    }
  }

  private async saveProfiles(): Promise<void> {
    // Persist non-secret fields + the encrypted blob only. Plaintext secret
    // material and derived state (needsMigration) are never written to disk.
    const profiles = Array.from(this.profiles.values()).map((profile) => ({
      id: profile.id,
      name: profile.name,
      credentials: this.stripSecrets(profile.credentials),
      encryptedSecret: profile.encryptedSecret,
      isDefault: profile.isDefault,
      createdAt: profile.createdAt,
      lastUsed: profile.lastUsed,
    }));
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
    passphrase?: string,
    isDefault: boolean = false
  ): Promise<CredentialProfile> {
    await this.initialize();

    const sanitized = this.sanitizeCredentials(credentials);
    const secret: SecretMaterial = {
      secretAccessKey: sanitized.secretAccessKey,
      sessionToken: sanitized.sessionToken,
    };
    const hasSecret = !!(secret.secretAccessKey || secret.sessionToken);

    // Encrypt secret material at rest; a passphrase is mandatory when present.
    let encryptedSecret: EncryptedPayload | undefined;
    if (hasSecret) {
      if (!passphrase) {
        throw new Error('A passphrase is required to encrypt secret credentials');
      }
      encryptedSecret = await encryptSecret(secret, passphrase);
    }

    // If this is the first profile or set as default, clear other defaults
    if (isDefault || this.profiles.size === 0) {
      this.profiles.forEach((profile) => {
        profile.isDefault = false;
      });
    }

    const id = uuidv4();
    const profile: CredentialProfile = {
      id,
      name,
      credentials: this.stripSecrets(sanitized),
      encryptedSecret,
      isDefault: isDefault || this.profiles.size === 0,
      createdAt: new Date(),
    };

    this.profiles.set(id, profile);

    // Cache the decrypted secret in memory so the current session can use it
    // immediately without re-prompting for the passphrase.
    if (hasSecret) {
      this.unlockedSecrets.set(id, secret);
    }

    await this.saveProfiles();

    // Set as active if it's the first profile
    if (this.profiles.size === 1) {
      await this.setActiveProfile(id);
    }

    return profile;
  }

  async updateProfile(
    id: string,
    updates: Partial<Omit<CredentialProfile, 'id' | 'createdAt'>>,
    passphrase?: string
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

    let credentials = profile.credentials;
    let encryptedSecret = profile.encryptedSecret;
    let needsMigration = profile.needsMigration;

    if (updates.credentials) {
      const sanitized = this.sanitizeCredentials(updates.credentials);
      const secret: SecretMaterial = {
        secretAccessKey: sanitized.secretAccessKey,
        sessionToken: sanitized.sessionToken,
      };
      const hasSecret = !!(secret.secretAccessKey || secret.sessionToken);

      if (hasSecret) {
        if (!passphrase) {
          throw new Error('A passphrase is required to encrypt secret credentials');
        }
        encryptedSecret = await encryptSecret(secret, passphrase);
        this.unlockedSecrets.set(id, secret);
      } else {
        // Credentials replaced with something that has no secret (e.g. iamRole).
        encryptedSecret = undefined;
        this.unlockedSecrets.delete(id);
      }

      credentials = this.stripSecrets(sanitized);
      needsMigration =
        credentials.type === 'accessKey' && !encryptedSecret ? true : undefined;
    }

    const updatedProfile: CredentialProfile = {
      ...profile,
      ...updates,
      credentials,
      encryptedSecret,
      needsMigration,
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
    this.unlockedSecrets.delete(id);

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

  // Returns fully usable credentials (including decrypted secret material) for
  // the active profile, but ONLY if it is unlocked. Returns undefined when a
  // secret-bearing profile is still locked - the caller must unlockProfile first.
  getActiveCredentials(): AWSCredentials | undefined {
    const profile = this.getActiveProfile();
    if (!profile) return undefined;
    if (this.requiresUnlock(profile) && !this.isProfileUnlocked(profile.id)) {
      return undefined;
    }
    return this.composeCredentials(profile);
  }

  //----------------------------------------------------------------------------
  // Unlock / Lock (secret material is decrypted into memory only)
  //----------------------------------------------------------------------------

  // Decrypt a profile's secret material with its passphrase and cache it in
  // memory for this session. Returns fully usable credentials for the AWS SDK.
  // Throws if the passphrase is incorrect.
  async unlockProfile(id: string, passphrase: string): Promise<AWSCredentials> {
    await this.initialize();

    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error('Profile not found');
    }

    if (profile.encryptedSecret) {
      const secret = await decryptSecret(profile.encryptedSecret, passphrase);
      this.unlockedSecrets.set(id, secret);
    }
    // Profiles with no encrypted secret (iamRole, or a legacy secret already in
    // memory) need no decryption - they are effectively already usable.

    return this.composeCredentials(profile);
  }

  // Whether a profile's secret material is currently available in memory (or the
  // profile carries no secret to unlock, e.g. iamRole).
  isProfileUnlocked(id: string): boolean {
    const profile = this.profiles.get(id);
    if (!profile) return false;
    if (!this.requiresUnlock(profile)) return true;
    return this.unlockedSecrets.has(id);
  }

  // Clear a single profile's decrypted secret from memory.
  lockProfile(id: string): void {
    this.unlockedSecrets.delete(id);
  }

  // Clear all decrypted secrets from memory (e.g. on sign-out / tab hidden).
  lock(): void {
    this.unlockedSecrets.clear();
  }

  private requiresUnlock(profile: CredentialProfile): boolean {
    // Only secret-bearing profiles need an unlock step.
    return profile.credentials.type === 'accessKey';
  }

  //----------------------------------------------------------------------------
  // Credential Validation
  //----------------------------------------------------------------------------

  validateCredentials(
    credentials: AWSCredentials,
    opts: { requireSecret?: boolean } = {}
  ): {
    valid: boolean;
    errors: string[];
  } {
    // When secret material is stored encrypted (e.g. on import), the plaintext
    // secret is legitimately absent and must not fail validation.
    const requireSecret = opts.requireSecret !== false;
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

        if (requireSecret && !credentials.secretAccessKey) {
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

  // Return a copy with all secret material removed. Used for anything that is
  // persisted, exported, or handed back through the read APIs.
  private stripSecrets(credentials: AWSCredentials): AWSCredentials {
    const copy: AWSCredentials = { ...credentials };
    delete copy.secretAccessKey;
    delete copy.sessionToken;
    return copy;
  }

  // Merge a profile's non-secret fields with its in-memory (unlocked) secret to
  // produce credentials usable by the AWS SDK.
  private composeCredentials(profile: CredentialProfile): AWSCredentials {
    const secret = this.unlockedSecrets.get(profile.id);
    if (!secret) return { ...profile.credentials };
    return {
      ...profile.credentials,
      secretAccessKey: secret.secretAccessKey,
      sessionToken: secret.sessionToken,
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

  // Exports profiles for backup. Secret material is NEVER exported in plaintext:
  // only the encrypted blob (safe to back up, useless without the passphrase) is
  // included. There is intentionally no option to export decrypted secrets.
  async exportProfiles(): Promise<string> {
    await this.initialize();

    const profiles = this.getAllProfiles().map((profile) => ({
      id: profile.id,
      name: profile.name,
      credentials: this.stripSecrets(profile.credentials),
      encryptedSecret: profile.encryptedSecret,
      isDefault: profile.isDefault,
      createdAt: profile.createdAt,
      lastUsed: profile.lastUsed,
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
        this.unlockedSecrets.clear();
      }

      for (const profile of profiles) {
        // Imported secrets are only trusted in encrypted form; the plaintext
        // secret (if any legacy export contains it) is dropped, not persisted.
        const validation = this.validateCredentials(profile.credentials, {
          requireSecret: false,
        });
        if (!validation.valid) {
          errors.push(`Profile "${profile.name}": ${validation.errors.join(', ')}`);
          continue;
        }

        const credentials = this.stripSecrets(profile.credentials);
        const encryptedSecret = profile.encryptedSecret;
        const needsMigration =
          credentials.type === 'accessKey' && !encryptedSecret ? true : undefined;

        // Generate new ID to avoid conflicts
        const newProfile: CredentialProfile = {
          ...profile,
          id: uuidv4(),
          credentials,
          encryptedSecret,
          needsMigration,
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
    this.unlockedSecrets.clear();
    this.activeProfileId = null;
    await credentialStore.clear();
    this.initialized = false;
  }
}

// Singleton instance
export const credentialManager = new CredentialManager();