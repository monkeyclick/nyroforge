//------------------------------------------------------------------------------
// Credential Manager Component - AWS Credentials Configuration
//------------------------------------------------------------------------------

import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  Shield,
  User,
  Globe,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useTransferStore } from '../stores/transferStore';
import { credentialManager } from '../services/credentialManager';
import { AWSCredentials, CredentialType, CredentialProfile } from '../types';

interface CredentialManagerProps {
  onClose: () => void;
}

export const CredentialManager: React.FC<CredentialManagerProps> = ({ onClose }) => {
  const { setCredentials, isConnected, testConnection } = useTransferStore();

  const [profiles, setProfiles] = useState<CredentialProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Form state
  const [credentialType, setCredentialType] = useState<CredentialType>('accessKey');
  const [profileName, setProfileName] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [showSecrets, setShowSecrets] = useState(false);

  // Load profiles on mount
  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    await credentialManager.initialize();
    setProfiles(credentialManager.getAllProfiles());
    const active = credentialManager.getActiveProfile();
    if (active) {
      setSelectedProfile(active.id);
    }
  };

  const resetForm = () => {
    setProfileName('');
    setAccessKeyId('');
    setSecretAccessKey('');
    setSessionToken('');
    setRegion('us-east-1');
    setCredentialType('accessKey');
    setShowSecrets(false);
    setTestResult(null);
  };

  const handleSelectProfile = async (profileId: string) => {
    setSelectedProfile(profileId);
    const profile = credentialManager.getProfile(profileId);
    if (profile) {
      await credentialManager.setActiveProfile(profileId);
      await setCredentials(profile.credentials);
    }
  };

  const handleSaveProfile = async () => {
    const credentials: AWSCredentials = {
      type: credentialType,
      region,
      accessKeyId: credentialType === 'accessKey' ? accessKeyId : undefined,
      secretAccessKey: credentialType === 'accessKey' ? secretAccessKey : undefined,
      sessionToken: sessionToken || undefined,
    };

    // Validate
    const validation = credentialManager.validateCredentials(credentials);
    if (!validation.valid) {
      setTestResult({ success: false, message: validation.errors.join(', ') });
      return;
    }

    try {
      if (isEditing && selectedProfile) {
        await credentialManager.updateProfile(selectedProfile, {
          name: profileName,
          credentials,
        });
      } else {
        const profile = await credentialManager.createProfile(profileName || 'Default', credentials);
        setSelectedProfile(profile.id);
      }

      await loadProfiles();
      setIsEditing(false);
      resetForm();
    } catch (error: any) {
      setTestResult({ success: false, message: error.message });
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    await credentialManager.deleteProfile(profileId);
    await loadProfiles();
    if (selectedProfile === profileId) {
      setSelectedProfile(null);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    const credentials: AWSCredentials = {
      type: credentialType,
      region,
      accessKeyId: credentialType === 'accessKey' ? accessKeyId : undefined,
      secretAccessKey: credentialType === 'accessKey' ? secretAccessKey : undefined,
      sessionToken: sessionToken || undefined,
    };

    try {
      const success = await setCredentials(credentials);
      setTestResult({
        success,
        message: success ? 'Connection successful!' : 'Connection failed',
      });
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error.message || 'Connection failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleConnect = async () => {
    const credentials: AWSCredentials = {
      type: credentialType,
      region,
      accessKeyId: credentialType === 'accessKey' ? accessKeyId : undefined,
      secretAccessKey: credentialType === 'accessKey' ? secretAccessKey : undefined,
      sessionToken: sessionToken || undefined,
    };

    const success = await setCredentials(credentials);
    if (success) {
      // Save as new profile if not editing
      if (!selectedProfile) {
        await credentialManager.createProfile(profileName || 'Default', credentials);
        await loadProfiles();
      }
      onClose();
    } else {
      setTestResult({ success: false, message: 'Failed to connect' });
    }
  };

  const regions = credentialManager.getRegions();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-800">AWS Credentials</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex h-[500px]">
          {/* Profile list */}
          <div className="w-48 border-r bg-gray-50 p-2">
            <div className="text-xs font-medium text-gray-500 uppercase mb-2 px-2">
              Saved Profiles
            </div>
            <div className="space-y-1">
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => handleSelectProfile(profile.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm ${
                    selectedProfile === profile.id
                      ? 'bg-primary-100 text-primary-700'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{profile.name}</span>
                    {profile.isDefault && (
                      <span className="text-xs text-primary-500">Default</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                resetForm();
                setIsEditing(true);
                setSelectedProfile(null);
              }}
              className="w-full mt-2 px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded border border-dashed border-primary-300"
            >
              + Add Profile
            </button>
          </div>

          {/* Form */}
          <div className="flex-1 p-4 overflow-y-auto">
            <div className="space-y-4">
              {/* Profile Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Profile Name
                </label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="My AWS Account"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {/* Credential Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Authentication Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCredentialType('accessKey')}
                    className={`flex items-center gap-2 p-3 border rounded-lg ${
                      credentialType === 'accessKey'
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <Key className="w-4 h-4" />
                    <span className="text-sm">Access Keys</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCredentialType('iamRole')}
                    className={`flex items-center gap-2 p-3 border rounded-lg ${
                      credentialType === 'iamRole'
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <Shield className="w-4 h-4" />
                    <span className="text-sm">IAM Role</span>
                  </button>
                </div>
              </div>

              {/* Region */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Globe className="w-4 h-4 inline mr-1" />
                  AWS Region
                </label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {regions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Access Key Credentials */}
              {credentialType === 'accessKey' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Access Key ID
                    </label>
                    <input
                      type="text"
                      value={accessKeyId}
                      onChange={(e) => setAccessKeyId(e.target.value)}
                      placeholder="AKIAIOSFODNN7EXAMPLE"
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Secret Access Key
                    </label>
                    <div className="relative">
                      <input
                        type={showSecrets ? 'text' : 'password'}
                        value={secretAccessKey}
                        onChange={(e) => setSecretAccessKey(e.target.value)}
                        placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                        className="w-full px-3 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecrets(!showSecrets)}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                      >
                        {showSecrets ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Session Token (Optional)
                    </label>
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      value={sessionToken}
                      onChange={(e) => setSessionToken(e.target.value)}
                      placeholder="For temporary credentials"
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Required for temporary credentials from STS AssumeRole
                    </p>
                  </div>
                </>
              )}

              {/* IAM Role info */}
              {credentialType === 'iamRole' && (
                <div className="p-4 bg-blue-50 rounded-lg text-sm text-blue-700">
                  <p>
                    IAM role credentials will be automatically obtained from the EC2 instance
                    metadata service or ECS task role. Make sure your environment has the
                    appropriate IAM role attached.
                  </p>
                </div>
              )}

              {/* Test Result */}
              {testResult && (
                <div
                  className={`p-3 rounded-lg flex items-center gap-2 ${
                    testResult.success
                      ? 'bg-green-50 text-green-700'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  {testResult.success ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <AlertCircle className="w-4 h-4" />
                  )}
                  <span className="text-sm">{testResult.message}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50">
          <div>
            {selectedProfile && (
              <button
                onClick={() => handleDeleteProfile(selectedProfile)}
                className="text-sm text-red-600 hover:text-red-700"
              >
                Delete Profile
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestConnection}
              disabled={isTesting}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-2"
            >
              {isTesting && <Loader2 className="w-4 h-4 animate-spin" />}
              Test Connection
            </button>
            <button
              onClick={handleConnect}
              className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CredentialManager;