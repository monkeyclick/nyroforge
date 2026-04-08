import React, { useState, useEffect, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import {
  KeyIcon,
  XMarkIcon,
  ArrowPathIcon,
  EyeIcon,
  EyeSlashIcon,
  ClipboardDocumentIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EnvelopeIcon,
  ShieldExclamationIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';

// Get admin API endpoint from environment
const getAdminApiEndpoint = () => {
  return process.env.NEXT_PUBLIC_ADMIN_API_ENDPOINT || '';
};

// Helper to get auth headers
const getAuthHeaders = async () => {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
};

// Types
interface User {
  id: string;
  email: string;
  name: string;
  status: string;
}

interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  allowedSpecialChars: string;
  preventCommonPasswords: boolean;
  preventUsernameInPassword: boolean;
}

interface PasswordValidation {
  valid: boolean;
  strength: 'weak' | 'medium' | 'strong' | 'very_strong';
  score: number;
  requirements: Record<string, { required: boolean | number; met: boolean; message: string }>;
  suggestions: string[];
}

interface PasswordManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onSuccess: () => void;
  currentUserId: string;
}

// Password Strength Indicator Component
const PasswordStrengthIndicator: React.FC<{ 
  validation: PasswordValidation | null;
  password: string;
}> = ({ validation, password }) => {
  if (!password || !validation) return null;

  const strengthColors = {
    weak: 'bg-red-500',
    medium: 'bg-yellow-500',
    strong: 'bg-green-500',
    very_strong: 'bg-emerald-600',
  };

  const strengthLabels = {
    weak: 'Weak',
    medium: 'Medium',
    strong: 'Strong',
    very_strong: 'Very Strong',
  };

  const widthPercentages = {
    weak: '25%',
    medium: '50%',
    strong: '75%',
    very_strong: '100%',
  };

  return (
    <div className="mt-2 space-y-2">
      {/* Strength Bar */}
      <div className="flex items-center space-x-2">
        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-300 ${strengthColors[validation.strength]}`}
            style={{ width: widthPercentages[validation.strength] }}
          />
        </div>
        <span className={`text-xs font-medium ${
          validation.strength === 'weak' ? 'text-red-600' :
          validation.strength === 'medium' ? 'text-yellow-600' :
          validation.strength === 'strong' ? 'text-green-600' :
          'text-emerald-600'
        }`}>
          {strengthLabels[validation.strength]}
        </span>
      </div>

      {/* Requirements Checklist */}
      <div className="grid grid-cols-2 gap-1 text-xs">
        {Object.entries(validation.requirements).map(([key, req]) => (
          <div 
            key={key}
            className={`flex items-center space-x-1 ${req.met ? 'text-green-600' : 'text-gray-400'}`}
          >
            {req.met ? (
              <CheckCircleIcon className="h-3.5 w-3.5" />
            ) : (
              <div className="h-3.5 w-3.5 rounded-full border border-current" />
            )}
            <span>{req.message}</span>
          </div>
        ))}
      </div>

      {/* Suggestions */}
      {validation.suggestions.length > 0 && (
        <div className="text-xs text-amber-600 space-y-1">
          {validation.suggestions.map((suggestion, i) => (
            <div key={i} className="flex items-start space-x-1">
              <InformationCircleIcon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>{suggestion}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Main Component
const PasswordManagementDialog: React.FC<PasswordManagementDialogProps> = ({
  isOpen,
  onClose,
  user,
  onSuccess,
  currentUserId
}) => {
  // State
  const [mode, setMode] = useState<'set' | 'generate'>('generate');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy | null>(null);
  
  // Password form state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [validation, setValidation] = useState<PasswordValidation | null>(null);
  
  // Options state
  const [forceChangeOnLogin, setForceChangeOnLogin] = useState(true);
  const [temporary, setTemporary] = useState(true);
  const [expiresIn, setExpiresIn] = useState('24h');
  const [passwordLength, setPasswordLength] = useState(16);
  const [reason, setReason] = useState('');
  
  // Notification state
  const [notifyUser, setNotifyUser] = useState(true);
  const [includePasswordInEmail, setIncludePasswordInEmail] = useState(false);
  const [notifyAdmin, setNotifyAdmin] = useState(false);
  
  // Result state
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Fetch password policy
  const fetchPasswordPolicy = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const apiEndpoint = getAdminApiEndpoint();
      const response = await fetch(`${apiEndpoint}/password-policy`, {
        method: 'GET',
        headers,
      });
      if (response.ok) {
        const data = await response.json();
        setPasswordPolicy(data);
      } else {
        // Use default policy
        setPasswordPolicy({
          minLength: 12,
          maxLength: 128,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: true,
          requireSpecialChars: true,
          allowedSpecialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
          preventCommonPasswords: true,
          preventUsernameInPassword: true,
        });
      }
    } catch {
      // Use default policy on error
      setPasswordPolicy({
        minLength: 12,
        maxLength: 128,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        allowedSpecialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
        preventCommonPasswords: true,
        preventUsernameInPassword: true,
      });
    }
  }, []);

  // Validate password
  const validatePassword = useCallback((pwd: string) => {
    if (!passwordPolicy || !pwd) {
      setValidation(null);
      return;
    }

    const requirements: Record<string, { required: boolean | number; met: boolean; message: string }> = {};
    let score = 0;

    // Check length
    const meetsMinLength = pwd.length >= passwordPolicy.minLength;
    const meetsMaxLength = pwd.length <= passwordPolicy.maxLength;
    requirements.minLength = { required: passwordPolicy.minLength, met: meetsMinLength, message: `${passwordPolicy.minLength}+ characters` };
    if (meetsMinLength) score += 20;
    if (pwd.length >= 16) score += 10;
    if (pwd.length >= 20) score += 10;

    // Check uppercase
    const hasUppercase = /[A-Z]/.test(pwd);
    requirements.uppercase = { required: passwordPolicy.requireUppercase, met: hasUppercase || !passwordPolicy.requireUppercase, message: 'Uppercase letter' };
    if (hasUppercase) score += 15;

    // Check lowercase
    const hasLowercase = /[a-z]/.test(pwd);
    requirements.lowercase = { required: passwordPolicy.requireLowercase, met: hasLowercase || !passwordPolicy.requireLowercase, message: 'Lowercase letter' };
    if (hasLowercase) score += 15;

    // Check numbers
    const hasNumbers = /[0-9]/.test(pwd);
    requirements.numbers = { required: passwordPolicy.requireNumbers, met: hasNumbers || !passwordPolicy.requireNumbers, message: 'Number' };
    if (hasNumbers) score += 15;

    // Check special characters
    const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(pwd);
    requirements.specialChars = { required: passwordPolicy.requireSpecialChars, met: hasSpecialChars || !passwordPolicy.requireSpecialChars, message: 'Special character' };
    if (hasSpecialChars) score += 15;

    // Check common passwords (simplified)
    const commonPasswords = ['password', '123456', 'qwerty', 'admin', 'letmein', 'welcome'];
    const isCommon = commonPasswords.includes(pwd.toLowerCase());
    requirements.notCommon = { required: passwordPolicy.preventCommonPasswords, met: !isCommon, message: 'Not common' };
    if (isCommon) score -= 30;

    // Check username in password
    let containsUsername = false;
    if (user?.email && passwordPolicy.preventUsernameInPassword) {
      const username = user.email.split('@')[0].toLowerCase();
      containsUsername = pwd.toLowerCase().includes(username);
    }
    requirements.notUsername = { required: passwordPolicy.preventUsernameInPassword, met: !containsUsername, message: 'No username' };
    if (containsUsername) score -= 20;

    // Calculate validity
    const valid = Object.values(requirements).every(r => r.met) && meetsMaxLength;

    // Determine strength
    const clampedScore = Math.max(0, Math.min(100, score));
    let strength: 'weak' | 'medium' | 'strong' | 'very_strong';
    if (clampedScore >= 90) strength = 'very_strong';
    else if (clampedScore >= 70) strength = 'strong';
    else if (clampedScore >= 50) strength = 'medium';
    else strength = 'weak';

    // Generate suggestions
    const suggestions: string[] = [];
    if (!hasUppercase && passwordPolicy.requireUppercase) suggestions.push('Add an uppercase letter');
    if (!hasLowercase && passwordPolicy.requireLowercase) suggestions.push('Add a lowercase letter');
    if (!hasNumbers && passwordPolicy.requireNumbers) suggestions.push('Add a number');
    if (!hasSpecialChars && passwordPolicy.requireSpecialChars) suggestions.push('Add a special character');
    if (pwd.length < 16) suggestions.push('Consider using 16+ characters');

    setValidation({
      valid,
      strength,
      score: clampedScore,
      requirements,
      suggestions,
    });
  }, [passwordPolicy, user?.email]);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen && user) {
      fetchPasswordPolicy();
      setMode('generate');
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setShowConfirmPassword(false);
      setValidation(null);
      setForceChangeOnLogin(true);
      setTemporary(true);
      setExpiresIn('24h');
      setPasswordLength(16);
      setReason('');
      setNotifyUser(true);
      setIncludePasswordInEmail(false);
      setNotifyAdmin(false);
      setGeneratedPassword('');
      setCopiedToClipboard(false);
      setResult(null);
      setError(null);
      setSuccess(false);
    }
  }, [isOpen, user, fetchPasswordPolicy]);

  // Validate password when it changes
  useEffect(() => {
    if (mode === 'set') {
      validatePassword(password);
    }
  }, [password, mode, validatePassword]);

  // Generate password locally for preview using cryptographically secure random values
  const generatePreviewPassword = () => {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*()_+-=';
    const allChars = uppercase + lowercase + numbers + special;

    // Helper to get a cryptographically secure random index
    const secureRandomIndex = (max: number): number => {
      const randomArray = new Uint32Array(1);
      crypto.getRandomValues(randomArray);
      return randomArray[0] % max;
    };

    let pwd = '';
    pwd += uppercase[secureRandomIndex(uppercase.length)];
    pwd += lowercase[secureRandomIndex(lowercase.length)];
    pwd += numbers[secureRandomIndex(numbers.length)];
    pwd += special[secureRandomIndex(special.length)];

    for (let i = pwd.length; i < passwordLength; i++) {
      pwd += allChars[secureRandomIndex(allChars.length)];
    }

    // Shuffle using Fisher-Yates with secure random
    const arr = pwd.split('');
    for (let i = arr.length - 1; i > 0; i--) {
      const j = secureRandomIndex(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr.join('');
  };

  // Handle set password
  const handleSetPassword = async () => {
    if (!user) return;
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!validation?.valid) {
      setError('Password does not meet requirements');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      const apiEndpoint = getAdminApiEndpoint();
      const response = await fetch(`${apiEndpoint}/users/${user.id}/password`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          password,
          forceChangeOnLogin,
          temporary,
          expiresIn: temporary ? expiresIn : undefined,
          notifications: {
            notifyUser,
            includePasswordInEmail,
            notifyAdmin,
          },
          reason,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to set password');
      }

      const data = await response.json();
      setResult(data);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to set password');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle generate password
  const handleGeneratePassword = async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      const apiEndpoint = getAdminApiEndpoint();
      const response = await fetch(`${apiEndpoint}/users/${user.id}/password/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          expiresIn,
          length: passwordLength,
          forceChangeOnLogin,
          notifications: {
            notifyUser,
            includePasswordInEmail,
            notifyAdmin,
          },
          reason,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to generate password');
      }

      const data = await response.json();
      setResult(data);
      setGeneratedPassword(data.details?.generatedPassword || '');
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to generate password');
    } finally {
      setIsLoading(false);
    }
  };

  // Copy password to clipboard
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedPassword);
      setCopiedToClipboard(true);
      setTimeout(() => setCopiedToClipboard(false), 3000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Handle close
  const handleClose = () => {
    if (success) {
      onSuccess();
    }
    onClose();
  };

  if (!isOpen || !user) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" 
          onClick={handleClose}
        />
        
        {/* Dialog */}
        <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-full ${success ? 'bg-green-100' : 'bg-blue-100'}`}>
                {success ? (
                  <CheckCircleIcon className="h-6 w-6 text-green-600" />
                ) : (
                  <KeyIcon className="h-6 w-6 text-blue-600" />
                )}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {success ? 'Password Updated' : 'Manage Password'}
                </h2>
                <p className="text-sm text-gray-500">{user.email}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <XMarkIcon className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4 overflow-y-auto max-h-[calc(90vh-180px)]">
            {/* Error display */}
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center space-x-2">
                  <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />
                  <span className="text-red-700">{error}</span>
                </div>
              </div>
            )}

            {!success ? (
              <div className="space-y-6">
                {/* Mode Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Password Action
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setMode('generate')}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        mode === 'generate'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <ArrowPathIcon className={`h-5 w-5 ${mode === 'generate' ? 'text-blue-600' : 'text-gray-400'}`} />
                        <span className="font-medium text-gray-900">Generate</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Auto-generate a secure temporary password
                      </p>
                    </button>
                    <button
                      onClick={() => setMode('set')}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        mode === 'set'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <KeyIcon className={`h-5 w-5 ${mode === 'set' ? 'text-blue-600' : 'text-gray-400'}`} />
                        <span className="font-medium text-gray-900">Set Custom</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Manually set a specific password
                      </p>
                    </button>
                  </div>
                </div>

                {/* Generate Mode Options */}
                {mode === 'generate' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Password Length
                      </label>
                      <div className="flex items-center space-x-4">
                        <input
                          type="range"
                          min={12}
                          max={32}
                          value={passwordLength}
                          onChange={(e) => setPasswordLength(Number(e.target.value))}
                          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                        <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                          {passwordLength}
                        </span>
                      </div>
                    </div>

                    {/* Preview */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">Preview</span>
                        <button
                          onClick={() => setGeneratedPassword(generatePreviewPassword())}
                          className="text-xs text-blue-600 hover:text-blue-700"
                        >
                          Regenerate Preview
                        </button>
                      </div>
                      <div className="font-mono text-sm bg-white border rounded px-3 py-2 break-all">
                        {generatedPassword || generatePreviewPassword()}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        <InformationCircleIcon className="h-3.5 w-3.5 inline mr-1" />
                        The actual password will be generated securely on the server
                      </p>
                    </div>
                  </div>
                )}

                {/* Set Custom Mode */}
                {mode === 'set' && (
                  <div className="space-y-4">
                    {/* Password Input */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        New Password
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Enter new password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          {showPassword ? (
                            <EyeSlashIcon className="h-5 w-5" />
                          ) : (
                            <EyeIcon className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                      <PasswordStrengthIndicator validation={validation} password={password} />
                    </div>

                    {/* Confirm Password */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className={`w-full px-3 py-2 pr-10 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                            confirmPassword && password !== confirmPassword
                              ? 'border-red-300 bg-red-50'
                              : 'border-gray-300'
                          }`}
                          placeholder="Confirm new password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          {showConfirmPassword ? (
                            <EyeSlashIcon className="h-5 w-5" />
                          ) : (
                            <EyeIcon className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                      {confirmPassword && password !== confirmPassword && (
                        <p className="text-red-500 text-xs mt-1">Passwords do not match</p>
                      )}
                    </div>

                    {/* Temporary option */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="temporary"
                        checked={temporary}
                        onChange={(e) => setTemporary(e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="temporary" className="text-sm text-gray-700">
                        Mark as temporary password
                      </label>
                    </div>
                  </div>
                )}

                {/* Common Options */}
                <div className="space-y-4 pt-4 border-t border-gray-200">
                  {/* Force Change */}
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      id="force-change"
                      checked={forceChangeOnLogin}
                      onChange={(e) => setForceChangeOnLogin(e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="force-change" className="text-sm text-gray-700">
                      Require password change on next login
                    </label>
                  </div>

                  {/* Expiration */}
                  {(mode === 'generate' || temporary) && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Password Expiration
                      </label>
                      <select
                        value={expiresIn}
                        onChange={(e) => setExpiresIn(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="1h">1 hour</option>
                        <option value="4h">4 hours</option>
                        <option value="8h">8 hours</option>
                        <option value="24h">24 hours</option>
                        <option value="48h">48 hours</option>
                        <option value="72h">72 hours</option>
                        <option value="168h">7 days</option>
                      </select>
                    </div>
                  )}

                  {/* Reason */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Reason (optional)
                    </label>
                    <select
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Select a reason...</option>
                      <option value="user_request">User Request</option>
                      <option value="security_concern">Security Concern</option>
                      <option value="forgot_password">Forgot Password</option>
                      <option value="account_recovery">Account Recovery</option>
                      <option value="new_employee">New Employee Onboarding</option>
                      <option value="periodic_reset">Periodic Reset</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                {/* Notification Options */}
                <div className="space-y-4 pt-4 border-t border-gray-200">
                  <h3 className="text-sm font-medium text-gray-700 flex items-center">
                    <EnvelopeIcon className="h-4 w-4 mr-2" />
                    Email Notifications
                  </h3>

                  <div className="space-y-3">
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="notify-user"
                        checked={notifyUser}
                        onChange={(e) => setNotifyUser(e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="notify-user" className="text-sm text-gray-700">
                        Notify user about password change
                      </label>
                    </div>

                    {notifyUser && (
                      <div className="ml-7 flex items-start space-x-3">
                        <input
                          type="checkbox"
                          id="include-password"
                          checked={includePasswordInEmail}
                          onChange={(e) => setIncludePasswordInEmail(e.target.checked)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-0.5"
                        />
                        <div>
                          <label htmlFor="include-password" className="text-sm text-gray-700">
                            Include password in email
                          </label>
                          {includePasswordInEmail && (
                            <div className="flex items-start space-x-1 mt-1 text-xs text-amber-600">
                              <ShieldExclamationIcon className="h-4 w-4 flex-shrink-0" />
                              <span>
                                Security warning: Sending passwords via email is less secure. 
                                Consider communicating via secure channel.
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="notify-admin"
                        checked={notifyAdmin}
                        onChange={(e) => setNotifyAdmin(e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="notify-admin" className="text-sm text-gray-700">
                        Send confirmation to admin
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Success View */
              <div className="space-y-6">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center space-x-3">
                    <CheckCircleIcon className="h-6 w-6 text-green-600" />
                    <div>
                      <h3 className="font-medium text-green-800">Password Updated Successfully</h3>
                      <p className="text-sm text-green-700 mt-1">
                        The user's password has been {mode === 'generate' ? 'generated and ' : ''}updated.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Generated Password Display */}
                {generatedPassword && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-blue-800">Generated Password</span>
                      <span className="text-xs text-blue-600 flex items-center">
                        <ShieldExclamationIcon className="h-4 w-4 mr-1" />
                        Shown once only
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <code className="flex-1 bg-white border rounded px-3 py-2 font-mono text-sm break-all">
                        {generatedPassword}
                      </code>
                      <button
                        onClick={copyToClipboard}
                        className={`p-2 rounded-lg transition-colors ${
                          copiedToClipboard
                            ? 'bg-green-100 text-green-600'
                            : 'bg-white border hover:bg-gray-50 text-gray-600'
                        }`}
                        title="Copy to clipboard"
                      >
                        {copiedToClipboard ? (
                          <CheckCircleIcon className="h-5 w-5" />
                        ) : (
                          <ClipboardDocumentIcon className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                    {copiedToClipboard && (
                      <p className="text-xs text-green-600 mt-2">Copied to clipboard!</p>
                    )}
                  </div>
                )}

                {/* Summary */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Summary</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">User:</span>
                      <span className="text-gray-900">{result?.details?.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Password Type:</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        result?.details?.temporary
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {result?.details?.temporary ? 'Temporary' : 'Permanent'}
                      </span>
                    </div>
                    {result?.details?.expiresAt && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Expires:</span>
                        <span className="text-gray-900">
                          {new Date(result.details.expiresAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">Force Change:</span>
                      <span className={result?.details?.forceChangeOnLogin ? 'text-green-600' : 'text-gray-600'}>
                        {result?.details?.forceChangeOnLogin ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">User Notified:</span>
                      <span className={result?.notifications?.userNotified ? 'text-green-600' : 'text-gray-600'}>
                        {result?.notifications?.userNotified ? 'Yes' : 'No'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-sm text-gray-500 text-center">
                  Audit Log ID: {result?.auditLogId}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
            {!success ? (
              <>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={mode === 'generate' ? handleGeneratePassword : handleSetPassword}
                  disabled={
                    isLoading ||
                    (mode === 'set' && (!validation?.valid || password !== confirmPassword))
                  }
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isLoading ? (
                    <>
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <KeyIcon className="h-4 w-4" />
                      <span>{mode === 'generate' ? 'Generate Password' : 'Set Password'}</span>
                    </>
                  )}
                </button>
              </>
            ) : (
              <button
                onClick={handleClose}
                className="ml-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PasswordManagementDialog;
