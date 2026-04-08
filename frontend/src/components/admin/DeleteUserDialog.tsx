import React, { useState, useEffect, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import {
  TrashIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
  ArrowPathIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  CogIcon,
  ShieldCheckIcon,
  CheckCircleIcon
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
  createdAt?: string;
  lastLoginAt?: string;
}

interface GroupMembership {
  groupId: string;
  membershipType: string;
}

interface DeletionPreview {
  user: User;
  associatedData: {
    groupMemberships: {
      count: number;
      items: GroupMembership[];
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
}

interface DeleteUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onDeleteSuccess: () => void;
  currentUserId: string;
}

// Delete User Dialog Component
const DeleteUserDialog: React.FC<DeleteUserDialogProps> = ({
  isOpen,
  onClose,
  user,
  onDeleteSuccess,
  currentUserId
}) => {
  // State
  const [step, setStep] = useState<'preview' | 'confirm-soft' | 'confirm-hard' | 'success'>('preview');
  const [deletionPreview, setDeletionPreview] = useState<DeletionPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteType, setDeleteType] = useState<'soft' | 'hard'>('soft');
  
  // Form state for soft delete
  const [softDeleteReason, setSoftDeleteReason] = useState('');
  const [softDeleteNotes, setSoftDeleteNotes] = useState('');
  const [notifyUserSoft, setNotifyUserSoft] = useState(true);
  const [retentionDays, setRetentionDays] = useState(90);
  
  // Form state for hard delete
  const [hardDeleteReason, setHardDeleteReason] = useState('');
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [ackIrreversible, setAckIrreversible] = useState(false);
  const [ackVerified, setAckVerified] = useState(false);
  
  // Result state
  const [deleteResult, setDeleteResult] = useState<any>(null);

  // Fetch deletion preview when dialog opens
  const fetchDeletionPreview = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const headers = await getAuthHeaders();
      const apiEndpoint = getAdminApiEndpoint();
      const response = await fetch(`${apiEndpoint}/users/${user.id}/deletion-preview`, {
        method: 'GET',
        headers,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch deletion preview');
      }
      
      const data = await response.json();
      setDeletionPreview(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load deletion preview');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isOpen && user) {
      fetchDeletionPreview();
      setStep('preview');
      setDeleteType('soft');
      setSoftDeleteReason('');
      setSoftDeleteNotes('');
      setNotifyUserSoft(true);
      setRetentionDays(90);
      setHardDeleteReason('');
      setConfirmationEmail('');
      setAckIrreversible(false);
      setAckVerified(false);
      setDeleteResult(null);
    }
  }, [isOpen, user, fetchDeletionPreview]);

  // Handle soft delete
  const handleSoftDelete = async () => {
    if (!user) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const headers = await getAuthHeaders();
      const apiEndpoint = getAdminApiEndpoint();
      const response = await fetch(`${apiEndpoint}/users/${user.id}/soft-delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          reason: softDeleteReason,
          notes: softDeleteNotes,
          notifyUser: notifyUserSoft,
          retentionDays,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete user');
      }
      
      const data = await response.json();
      setDeleteResult(data);
      setStep('success');
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle hard delete
  const handleHardDelete = async () => {
    if (!user) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const headers = await getAuthHeaders();
      const apiEndpoint = getAdminApiEndpoint();
      // Note: API Gateway route for hard-delete is configured as POST, not DELETE
      const response = await fetch(`${apiEndpoint}/users/${user.id}/hard-delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          confirmationEmail,
          reason: hardDeleteReason,
          acknowledgements: {
            understandIrreversible: ackIrreversible,
            verifiedDeletion: ackVerified,
          },
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to permanently delete user');
      }
      
      const data = await response.json();
      setDeleteResult(data);
      setStep('success');
    } catch (err: any) {
      setError(err.message || 'Failed to permanently delete user');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle close and success callback
  const handleClose = () => {
    if (step === 'success') {
      onDeleteSuccess();
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
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-full ${
                step === 'success' 
                  ? 'bg-green-100' 
                  : deleteType === 'hard' 
                    ? 'bg-red-100' 
                    : 'bg-yellow-100'
              }`}>
                {step === 'success' ? (
                  <CheckCircleIcon className="h-6 w-6 text-green-600" />
                ) : (
                  <TrashIcon className={`h-6 w-6 ${
                    deleteType === 'hard' ? 'text-red-600' : 'text-yellow-600'
                  }`} />
                )}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {step === 'success' 
                    ? 'User Deleted' 
                    : step === 'preview' 
                      ? 'Delete User' 
                      : deleteType === 'hard' 
                        ? 'Confirm Permanent Deletion' 
                        : 'Confirm User Deletion'}
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

            {/* Loading state */}
            {isLoading && step === 'preview' && (
              <div className="flex flex-col items-center justify-center py-12">
                <ArrowPathIcon className="h-8 w-8 text-blue-500 animate-spin" />
                <p className="mt-4 text-gray-600">Loading deletion preview...</p>
              </div>
            )}

            {/* Preview Step */}
            {step === 'preview' && !isLoading && deletionPreview && (
              <div className="space-y-6">
                {/* User Info */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">User Information</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Name:</span>
                      <span className="ml-2 text-gray-900">{deletionPreview.user.name}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Status:</span>
                      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                        deletionPreview.user.status === 'active' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {deletionPreview.user.status}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Created:</span>
                      <span className="ml-2 text-gray-900">
                        {deletionPreview.user.createdAt 
                          ? new Date(deletionPreview.user.createdAt).toLocaleDateString()
                          : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Last Login:</span>
                      <span className="ml-2 text-gray-900">
                        {deletionPreview.user.lastLoginAt 
                          ? new Date(deletionPreview.user.lastLoginAt).toLocaleDateString()
                          : 'Never'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Associated Data */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Associated Data</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-blue-50 rounded-lg p-4 text-center">
                      <UserGroupIcon className="h-6 w-6 text-blue-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-blue-700">
                        {deletionPreview.associatedData.groupMemberships.count}
                      </div>
                      <div className="text-xs text-blue-600">Group Memberships</div>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-4 text-center">
                      <ClipboardDocumentListIcon className="h-6 w-6 text-purple-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-purple-700">
                        {deletionPreview.associatedData.auditLogEntries}
                      </div>
                      <div className="text-xs text-purple-600">Audit Log Entries</div>
                    </div>
                    <div className="bg-gray-100 rounded-lg p-4 text-center">
                      <CogIcon className="h-6 w-6 text-gray-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-gray-700">
                        {deletionPreview.associatedData.savedPreferences}
                      </div>
                      <div className="text-xs text-gray-600">Saved Preferences</div>
                    </div>
                  </div>
                </div>

                {/* Restrictions */}
                {deletionPreview.deletionRestrictions.restrictions.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center space-x-2 mb-2">
                      <ShieldCheckIcon className="h-5 w-5 text-red-600" />
                      <h3 className="text-sm font-medium text-red-800">Cannot Delete User</h3>
                    </div>
                    <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                      {deletionPreview.deletionRestrictions.restrictions.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Warnings */}
                {deletionPreview.deletionRestrictions.warnings.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <div className="flex items-center space-x-2 mb-2">
                      <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />
                      <h3 className="text-sm font-medium text-yellow-800">Warnings</h3>
                    </div>
                    <ul className="list-disc list-inside text-sm text-yellow-700 space-y-1">
                      {deletionPreview.deletionRestrictions.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Delete Type Selection */}
                {deletionPreview.deletionRestrictions.canSoftDelete && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-3">Deletion Type</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Soft Delete Option */}
                      <button
                        onClick={() => setDeleteType('soft')}
                        className={`p-4 rounded-lg border-2 text-left transition-all ${
                          deleteType === 'soft'
                            ? 'border-yellow-500 bg-yellow-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center space-x-2 mb-2">
                          <div className={`w-4 h-4 rounded-full border-2 ${
                            deleteType === 'soft' 
                              ? 'border-yellow-500 bg-yellow-500' 
                              : 'border-gray-300'
                          }`}>
                            {deleteType === 'soft' && (
                              <div className="w-full h-full flex items-center justify-center">
                                <div className="w-1.5 h-1.5 bg-white rounded-full" />
                              </div>
                            )}
                          </div>
                          <span className="font-medium text-gray-900">Soft Delete</span>
                        </div>
                        <p className="text-xs text-gray-600 ml-6">
                          Disable the account and retain data for 90 days. Can be restored.
                        </p>
                      </button>

                      {/* Hard Delete Option */}
                      <button
                        onClick={() => setDeleteType('hard')}
                        disabled={!deletionPreview.deletionRestrictions.canHardDelete}
                        className={`p-4 rounded-lg border-2 text-left transition-all ${
                          !deletionPreview.deletionRestrictions.canHardDelete
                            ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                            : deleteType === 'hard'
                              ? 'border-red-500 bg-red-50'
                              : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center space-x-2 mb-2">
                          <div className={`w-4 h-4 rounded-full border-2 ${
                            deleteType === 'hard' 
                              ? 'border-red-500 bg-red-500' 
                              : 'border-gray-300'
                          }`}>
                            {deleteType === 'hard' && (
                              <div className="w-full h-full flex items-center justify-center">
                                <div className="w-1.5 h-1.5 bg-white rounded-full" />
                              </div>
                            )}
                          </div>
                          <span className="font-medium text-gray-900">Permanent Delete</span>
                        </div>
                        <p className="text-xs text-gray-600 ml-6">
                          Permanently remove all user data. Cannot be undone.
                        </p>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Soft Delete Confirmation */}
            {step === 'confirm-soft' && (
              <div className="space-y-6">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <ExclamationTriangleIcon className="h-6 w-6 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-medium text-yellow-800">Confirm Soft Deletion</h3>
                      <p className="text-sm text-yellow-700 mt-1">
                        This will disable the user account and preserve data for the retention period.
                        The user will be unable to log in, but their data can be restored.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason for Deletion <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={softDeleteReason}
                    onChange={(e) => setSoftDeleteReason(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                  >
                    <option value="">Select a reason...</option>
                    <option value="employee_departure">Employee Departure</option>
                    <option value="account_consolidation">Account Consolidation</option>
                    <option value="security_concern">Security Concern</option>
                    <option value="policy_violation">Policy Violation</option>
                    <option value="user_request">User Request</option>
                    <option value="inactivity">Extended Inactivity</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Additional Notes
                  </label>
                  <textarea
                    value={softDeleteNotes}
                    onChange={(e) => setSoftDeleteNotes(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                    placeholder="Optional notes about this deletion..."
                  />
                </div>

                {/* Retention Days */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Data Retention Period
                  </label>
                  <select
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                  >
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days (default)</option>
                    <option value={180}>180 days</option>
                    <option value={365}>1 year</option>
                  </select>
                </div>

                {/* Notification */}
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="notify-user-soft"
                    checked={notifyUserSoft}
                    onChange={(e) => setNotifyUserSoft(e.target.checked)}
                    className="h-4 w-4 text-yellow-600 focus:ring-yellow-500 border-gray-300 rounded"
                  />
                  <label htmlFor="notify-user-soft" className="text-sm text-gray-700">
                    Notify user via email about account deactivation
                  </label>
                </div>
              </div>
            )}

            {/* Hard Delete Confirmation */}
            {step === 'confirm-hard' && (
              <div className="space-y-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <ExclamationTriangleIcon className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-medium text-red-800">⚠️ Permanent Deletion Warning</h3>
                      <p className="text-sm text-red-700 mt-1">
                        This action is <strong>irreversible</strong>. All user data, including account information,
                        group memberships, and preferences will be permanently deleted. Audit logs will be 
                        retained with anonymized user references.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason for Permanent Deletion <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={hardDeleteReason}
                    onChange={(e) => setHardDeleteReason(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  >
                    <option value="">Select a reason...</option>
                    <option value="gdpr_request">GDPR/Privacy Request</option>
                    <option value="data_cleanup">Data Cleanup</option>
                    <option value="duplicate_account">Duplicate Account</option>
                    <option value="compliance_requirement">Compliance Requirement</option>
                    <option value="test_account">Test Account Removal</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Email Confirmation */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Type the user's email to confirm <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={confirmationEmail}
                    onChange={(e) => setConfirmationEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    placeholder={user.email}
                  />
                  {confirmationEmail && confirmationEmail !== user.email && (
                    <p className="text-red-500 text-xs mt-1">Email does not match</p>
                  )}
                </div>

                {/* Acknowledgements */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-gray-700">
                    Required Acknowledgements
                  </label>
                  
                  <div className="flex items-start space-x-3">
                    <input
                      type="checkbox"
                      id="ack-irreversible"
                      checked={ackIrreversible}
                      onChange={(e) => setAckIrreversible(e.target.checked)}
                      className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded mt-0.5"
                    />
                    <label htmlFor="ack-irreversible" className="text-sm text-gray-700">
                      I understand this action is <strong>irreversible</strong> and all user data will be
                      permanently deleted.
                    </label>
                  </div>

                  <div className="flex items-start space-x-3">
                    <input
                      type="checkbox"
                      id="ack-verified"
                      checked={ackVerified}
                      onChange={(e) => setAckVerified(e.target.checked)}
                      className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded mt-0.5"
                    />
                    <label htmlFor="ack-verified" className="text-sm text-gray-700">
                      I have verified that this user should be permanently deleted and have
                      appropriate authorization to perform this action.
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Success Step */}
            {step === 'success' && deleteResult && (
              <div className="space-y-6">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center space-x-3">
                    <CheckCircleIcon className="h-6 w-6 text-green-600" />
                    <div>
                      <h3 className="font-medium text-green-800">User Successfully Deleted</h3>
                      <p className="text-sm text-green-700 mt-1">
                        {deleteResult.deletedUser?.deletionType === 'soft'
                          ? 'The user account has been disabled and data preserved for the retention period.'
                          : 'The user and all associated data have been permanently removed.'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Deletion Summary</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">User Email:</span>
                      <span className="text-gray-900">{deleteResult.deletedUser?.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Deletion Type:</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        deleteResult.deletedUser?.deletionType === 'soft'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {deleteResult.deletedUser?.deletionType === 'soft' ? 'Soft Delete' : 'Hard Delete'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Deleted At:</span>
                      <span className="text-gray-900">
                        {new Date(deleteResult.deletedUser?.deletedAt).toLocaleString()}
                      </span>
                    </div>
                    {deleteResult.deletedUser?.scheduledPurgeDate && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Data Purge Date:</span>
                        <span className="text-gray-900">
                          {new Date(deleteResult.deletedUser.scheduledPurgeDate).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">Group Memberships Removed:</span>
                      <span className="text-gray-900">{deleteResult.actions?.groupMembershipsRemoved || 0}</span>
                    </div>
                    {deleteResult.deletedUser?.canRestore && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Can Restore:</span>
                        <span className="text-green-600">Yes</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-sm text-gray-500 text-center">
                  Audit Log ID: {deleteResult.auditLogId}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
            {step === 'preview' && (
              <>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setStep(deleteType === 'soft' ? 'confirm-soft' : 'confirm-hard')}
                  disabled={
                    isLoading || 
                    !deletionPreview?.deletionRestrictions.canSoftDelete ||
                    (deleteType === 'hard' && !deletionPreview?.deletionRestrictions.canHardDelete)
                  }
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    deleteType === 'hard'
                      ? 'bg-red-600 hover:bg-red-700 text-white disabled:bg-red-300'
                      : 'bg-yellow-600 hover:bg-yellow-700 text-white disabled:bg-yellow-300'
                  } disabled:cursor-not-allowed`}
                >
                  Continue
                </button>
              </>
            )}

            {step === 'confirm-soft' && (
              <>
                <button
                  onClick={() => setStep('preview')}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSoftDelete}
                  disabled={isLoading || !softDeleteReason}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors disabled:bg-yellow-300 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isLoading ? (
                    <>
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <TrashIcon className="h-4 w-4" />
                      <span>Disable User</span>
                    </>
                  )}
                </button>
              </>
            )}

            {step === 'confirm-hard' && (
              <>
                <button
                  onClick={() => setStep('preview')}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleHardDelete}
                  disabled={
                    isLoading || 
                    !hardDeleteReason || 
                    confirmationEmail !== user.email ||
                    !ackIrreversible ||
                    !ackVerified
                  }
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:bg-red-300 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isLoading ? (
                    <>
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <TrashIcon className="h-4 w-4" />
                      <span>Permanently Delete</span>
                    </>
                  )}
                </button>
              </>
            )}

            {step === 'success' && (
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

export default DeleteUserDialog;
