import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/api';

interface SecurityGroup {
  groupId: string;
  groupName: string;
  description: string;
  vpcId: string;
  ingressRules: number;
  egressRules: number;
  tags?: Record<string, string>;
}

interface WorkstationInfo {
  workstationId: string;
  instanceId: string;
  userId: string;
  status: string;
  instanceType: string;
  region: string;
  publicIp?: string;
}

interface SecurityGroupDetail {
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
}

interface CommonPort {
  port: number;
  protocol: string;
  description: string;
}

export default function SecurityManagement() {
  const queryClient = useQueryClient();
  const [selectedGroup, setSelectedGroup] = useState<SecurityGroup | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showWorkstationsModal, setShowWorkstationsModal] = useState(false);
  const [showMatrixModal, setShowMatrixModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupDescription, setEditGroupDescription] = useState('');
  const [selectedWorkstationId, setSelectedWorkstationId] = useState('');
  
  // Rule form state
  const [ruleType, setRuleType] = useState<'application' | 'custom' | 'range'>('application');
  const [selectedApplication, setSelectedApplication] = useState('');
  const [customPort, setCustomPort] = useState('');
  const [fromPort, setFromPort] = useState('');
  const [toPort, setToPort] = useState('');
  const [protocol, setProtocol] = useState('tcp');
  const [cidrIp, setCidrIp] = useState('0.0.0.0/0');
  const [ruleDescription, setRuleDescription] = useState('');

  // Fetch security groups
  const { data: securityGroupsData, isLoading: loadingGroups } = useQuery({
    queryKey: ['security-groups'],
    queryFn: () => apiClient.getSecurityGroups(),
    refetchInterval: 30000,
  });

  // Fetch selected group details
  const { data: groupDetails, isLoading: loadingDetails } = useQuery({
    queryKey: ['security-group', selectedGroup?.groupId],
    queryFn: () => apiClient.getSecurityGroup(selectedGroup!.groupId),
    enabled: !!selectedGroup,
  });

  // Fetch common ports
  const { data: commonPortsData } = useQuery({
    queryKey: ['common-ports'],
    queryFn: () => apiClient.getCommonPorts(),
  });

  // Fetch workstations for selected group
  const { data: groupWorkstationsData, isLoading: loadingWorkstations } = useQuery({
    queryKey: ['security-group-workstations', selectedGroup?.groupId],
    queryFn: () => apiClient.getWorkstationsForSecurityGroup(selectedGroup!.groupId),
    enabled: !!selectedGroup,
  });

  // Fetch all workstations for assignment
  const { data: allWorkstationsData } = useQuery({
    queryKey: ['workstations'],
    queryFn: () => apiClient.getWorkstations(),
  });

  // Create security group mutation
  const createGroup = useMutation({
    mutationFn: (data: { groupName: string; description: string }) => 
      apiClient.createSecurityGroup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security-groups'] });
      setShowCreateModal(false);
      setNewGroupName('');
      setNewGroupDescription('');
    },
  });

  // Delete security group mutation
  const deleteGroup = useMutation({
    mutationFn: (groupId: string) => apiClient.deleteSecurityGroup(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security-groups'] });
      setSelectedGroup(null);
    },
  });

  // Add rule mutation
  const addRule = useMutation({
    mutationFn: (data: any) => apiClient.addSecurityGroupRule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security-group', selectedGroup?.groupId] });
      setShowAddRuleModal(false);
      resetRuleForm();
    },
  });

  // Remove rule mutation
  const removeRule = useMutation({
    mutationFn: (data: any) => apiClient.removeSecurityGroupRule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security-group', selectedGroup?.groupId] });
    },
  });

  // Attach security group to workstation mutation
  const attachToWorkstation = useMutation({
    mutationFn: (data: { workstationId: string; securityGroupId: string }) =>
      apiClient.attachSecurityGroupToWorkstation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security-group-workstations', selectedGroup?.groupId] });
      queryClient.invalidateQueries({ queryKey: ['workstations'] });
      setShowAssignModal(false);
      setSelectedWorkstationId('');
    },
  });

  const resetRuleForm = () => {
    setRuleType('application');
    setSelectedApplication('');
    setCustomPort('');
    setFromPort('');
    setToPort('');
    setProtocol('tcp');
    setCidrIp('0.0.0.0/0');
    setRuleDescription('');
  };

  const handleAddRule = () => {
    if (!selectedGroup) return;

    let ruleData: any = {
      groupId: selectedGroup.groupId,
      protocol: protocol,
      cidrIp: cidrIp,
      description: ruleDescription,
    };

    if (ruleType === 'application' && selectedApplication) {
      ruleData.applicationName = selectedApplication;
    } else if (ruleType === 'custom' && customPort) {
      ruleData.port = parseInt(customPort);
    } else if (ruleType === 'range' && fromPort && toPort) {
      ruleData.fromPort = parseInt(fromPort);
      ruleData.toPort = parseInt(toPort);
    } else {
      alert('Please fill in all required fields');
      return;
    }

    addRule.mutate(ruleData);
  };

  const handleRemoveRule = (rule: any) => {
    if (!selectedGroup) return;
    
    if (!confirm('Are you sure you want to remove this rule?')) return;

    const ruleData: any = {
      groupId: selectedGroup.groupId,
      protocol: rule.ipProtocol,
      cidrIp: rule.ipRanges?.[0]?.cidrIp || '0.0.0.0/0',
    };

    if (rule.fromPort && rule.toPort) {
      if (rule.fromPort === rule.toPort) {
        ruleData.port = rule.fromPort;
      } else {
        ruleData.fromPort = rule.fromPort;
        ruleData.toPort = rule.toPort;
      }
    }

    removeRule.mutate(ruleData);
  };

  const handleAssignToWorkstation = () => {
    if (!selectedGroup || !selectedWorkstationId) {
      alert('Please select a workstation');
      return;
    }

    attachToWorkstation.mutate({
      workstationId: selectedWorkstationId,
      securityGroupId: selectedGroup.groupId,
    });
  };

  const handleQuickAddPort = (portName: string) => {
    if (!selectedGroup) return;
    
    addRule.mutate({
      groupId: selectedGroup.groupId,
      applicationName: portName,
      protocol: 'tcp',
      cidrIp: '0.0.0.0/0',
      description: `Quick add ${portName.toUpperCase()}`,
    });
  };

  const securityGroups = securityGroupsData?.securityGroups || [];
  const commonPorts = commonPortsData?.ports || {};
  const groupWorkstations = groupWorkstationsData?.workstations || [];
  const allWorkstations = allWorkstationsData?.workstations || [];

  // Build matrix data: workstation -> security groups
  const workstationSecurityGroups = new Map<string, string[]>();
  allWorkstations.forEach((ws: any) => {
    if (ws.securityGroups && Array.isArray(ws.securityGroups)) {
      workstationSecurityGroups.set(ws.workstationId, ws.securityGroups);
    }
  });

  return (
    <div className="space-y-6">
      {/* Security Groups List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-sm font-semibold text-gray-900">SECURITY GROUPS</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowMatrixModal(true)}
              className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              View Matrix
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              + Create Group
            </button>
          </div>
        </div>
        <div className="p-4">
          {loadingGroups ? (
            <div className="text-center py-8 text-gray-500">Loading security groups...</div>
          ) : securityGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No security groups found</div>
          ) : (
            <div className="space-y-3">
              {securityGroups.map((group) => (
                <div
                  key={group.groupId}
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedGroup?.groupId === group.groupId
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSelectedGroup(group)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900">{group.groupName}</h3>
                      <p className="text-xs text-gray-500 mt-1">{group.description}</p>
                      <div className="flex gap-4 mt-2 text-xs text-gray-600">
                        <span>ID: {group.groupId}</span>
                        <span>VPC: {group.vpcId}</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                          {group.ingressRules} inbound
                        </span>
                        <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">
                          {group.egressRules} outbound
                        </span>
                        {selectedGroup?.groupId === group.groupId && groupWorkstations.length > 0 && (
                          <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">
                            {groupWorkstations.length} workstation{groupWorkstations.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedGroup(group);
                          setEditGroupName(group.groupName);
                          setEditGroupDescription(group.description);
                          setShowEditModal(true);
                        }}
                        className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Security Group Details */}
      {selectedGroup && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-sm font-semibold text-gray-900">
              {selectedGroup.groupName} - RULES
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => setShowWorkstationsModal(true)}
                className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
              >
                View Workstations ({groupWorkstations.length})
              </button>
              <button
                onClick={() => setShowAssignModal(true)}
                className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                Assign to Workstation
              </button>
              <button
                onClick={() => setShowAddRuleModal(true)}
                className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
              >
                + Add Rule
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete security group "${selectedGroup.groupName}"?`)) {
                    deleteGroup.mutate(selectedGroup.groupId);
                  }
                }}
                disabled={deleteGroup.isPending}
                className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {deleteGroup.isPending ? 'Deleting...' : 'Delete Group'}
              </button>
            </div>
          </div>
          <div className="p-4">
            {loadingDetails ? (
              <div className="text-center py-8 text-gray-500">Loading rules...</div>
            ) : groupDetails ? (
              <div className="space-y-4">
                {/* Quick Actions for Remote Access */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Add Remote Access Ports</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleQuickAddPort('rdp')}
                      disabled={addRule.isPending}
                      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      + RDP (3389)
                    </button>
                    <button
                      onClick={() => handleQuickAddPort('ssh')}
                      disabled={addRule.isPending}
                      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      + SSH (22)
                    </button>
                    <button
                      onClick={() => handleQuickAddPort('vnc')}
                      disabled={addRule.isPending}
                      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      + VNC (5900)
                    </button>
                    <button
                      onClick={() => handleQuickAddPort('https')}
                      disabled={addRule.isPending}
                      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      + HTTPS (443)
                    </button>
                  </div>
                </div>

                {/* Inbound Rules */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Inbound Rules</h3>
                  {groupDetails.ingressRules.length === 0 ? (
                    <p className="text-sm text-gray-500">No inbound rules</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              Protocol
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              Port Range
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              Source
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              Description
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {groupDetails.ingressRules.map((rule, idx) => (
                            <tr key={idx}>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {rule.ipProtocol.toUpperCase()}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {rule.fromPort && rule.toPort
                                  ? rule.fromPort === rule.toPort
                                    ? rule.fromPort
                                    : `${rule.fromPort} - ${rule.toPort}`
                                  : 'All'}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {rule.ipRanges?.[0]?.cidrIp || 
                                 rule.ipv6Ranges?.[0]?.cidrIpv6 || 
                                 rule.userIdGroupPairs?.[0]?.groupId || 
                                 'N/A'}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-500">
                                {rule.ipRanges?.[0]?.description || '-'}
                              </td>
                              <td className="px-3 py-2 text-sm text-right">
                                <button
                                  onClick={() => handleRemoveRule(rule)}
                                  disabled={removeRule.isPending}
                                  className="text-red-600 hover:text-red-800 text-xs disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Outbound Rules */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Outbound Rules</h3>
                  {groupDetails.egressRules.length === 0 ? (
                    <p className="text-sm text-gray-500">No outbound rules</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              Protocol
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              Port Range
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              Destination
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              Description
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {groupDetails.egressRules.map((rule, idx) => (
                            <tr key={idx}>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {rule.ipProtocol.toUpperCase()}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {rule.fromPort && rule.toPort
                                  ? rule.fromPort === rule.toPort
                                    ? rule.fromPort
                                    : `${rule.fromPort} - ${rule.toPort}`
                                  : 'All'}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {rule.ipRanges?.[0]?.cidrIp || 'N/A'}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-500">
                                {rule.ipRanges?.[0]?.description || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Create Security Group</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Group Name *
                </label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="my-security-group"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description *
                </label>
                <textarea
                  value={newGroupDescription}
                  onChange={(e) => setNewGroupDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="Security group description"
                  rows={3}
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!newGroupName || !newGroupDescription) {
                    alert('Please fill in all fields');
                    return;
                  }
                  createGroup.mutate({
                    groupName: newGroupName,
                    description: newGroupDescription,
                  });
                }}
                disabled={createGroup.isPending}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {createGroup.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {showEditModal && selectedGroup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full mx-4 max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{selectedGroup.groupName}</h3>
                <p className="text-xs text-gray-500 mt-1">{selectedGroup.groupId}</p>
              </div>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditGroupName('');
                  setEditGroupDescription('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-auto flex-1">
              {loadingDetails ? (
                <div className="text-center py-8 text-gray-500">Loading details...</div>
              ) : groupDetails ? (
                <div className="space-y-6">
                  {/* Basic Information */}
                  <div className="bg-gray-50 rounded p-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Details</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Security Group ID:</span>
                        <span className="ml-2 text-gray-900">{groupDetails.groupId}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">VPC ID:</span>
                        <span className="ml-2 text-gray-900">{groupDetails.vpcId}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-gray-600">Description:</span>
                        <span className="ml-2 text-gray-900">{groupDetails.description}</span>
                      </div>
                    </div>
                  </div>

                  {/* Inbound Rules */}
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-sm font-semibold text-gray-900">Inbound rules</h4>
                      <button
                        onClick={() => setShowAddRuleModal(true)}
                        className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        + Add Rule
                      </button>
                    </div>
                    {groupDetails.ingressRules.length === 0 ? (
                      <p className="text-sm text-gray-500 bg-gray-50 p-4 rounded">No inbound rules</p>
                    ) : (
                      <div className="border border-gray-200 rounded overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Type
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Protocol
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Port range
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Source
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Description
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {groupDetails.ingressRules.map((rule, idx) => {
                              const portRange = rule.fromPort && rule.toPort
                                ? rule.fromPort === rule.toPort
                                  ? rule.fromPort.toString()
                                  : `${rule.fromPort} - ${rule.toPort}`
                                : 'All';
                              const type = rule.fromPort === 22 ? 'SSH' :
                                          rule.fromPort === 3389 ? 'RDP' :
                                          rule.fromPort === 443 ? 'HTTPS' :
                                          rule.fromPort === 80 ? 'HTTP' :
                                          rule.fromPort === 5900 ? 'VNC' :
                                          'Custom';
                              return (
                                <tr key={idx} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-sm text-gray-900">
                                    {type}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-900">
                                    {rule.ipProtocol === '-1' ? 'All' : rule.ipProtocol.toUpperCase()}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-900">
                                    {portRange}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-900">
                                    {rule.ipRanges?.[0]?.cidrIp ||
                                     rule.ipv6Ranges?.[0]?.cidrIpv6 ||
                                     rule.userIdGroupPairs?.[0]?.groupId ||
                                     'N/A'}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-500">
                                    {rule.ipRanges?.[0]?.description || '-'}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-right">
                                    <button
                                      onClick={() => handleRemoveRule(rule)}
                                      disabled={removeRule.isPending}
                                      className="text-red-600 hover:text-red-800 text-xs disabled:opacity-50"
                                    >
                                      Delete
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Outbound Rules */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">Outbound rules</h4>
                    {groupDetails.egressRules.length === 0 ? (
                      <p className="text-sm text-gray-500 bg-gray-50 p-4 rounded">No outbound rules</p>
                    ) : (
                      <div className="border border-gray-200 rounded overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Type
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Protocol
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Port range
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Destination
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Description
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {groupDetails.egressRules.map((rule, idx) => {
                              const portRange = rule.fromPort && rule.toPort
                                ? rule.fromPort === rule.toPort
                                  ? rule.fromPort.toString()
                                  : `${rule.fromPort} - ${rule.toPort}`
                                : 'All';
                              const type = rule.ipProtocol === '-1' && portRange === 'All' ? 'All traffic' : 'Custom';
                              return (
                                <tr key={idx} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-sm text-gray-900">
                                    {type}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-900">
                                    {rule.ipProtocol === '-1' ? 'All' : rule.ipProtocol.toUpperCase()}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-900">
                                    {portRange}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-900">
                                    {rule.ipRanges?.[0]?.cidrIp || 'N/A'}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-500">
                                    {rule.ipRanges?.[0]?.description || '-'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">Failed to load security group details</div>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditGroupName('');
                  setEditGroupDescription('');
                }}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Rule Modal */}
      {showAddRuleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Add Inbound Rule</h3>
              <button
                onClick={() => {
                  setShowAddRuleModal(false);
                  resetRuleForm();
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Rule Type Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Rule Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setRuleType('application')}
                    className={`flex-1 px-3 py-2 text-sm rounded border ${
                      ruleType === 'application'
                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Application
                  </button>
                  <button
                    onClick={() => setRuleType('custom')}
                    className={`flex-1 px-3 py-2 text-sm rounded border ${
                      ruleType === 'custom'
                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Custom Port
                  </button>
                  <button
                    onClick={() => setRuleType('range')}
                    className={`flex-1 px-3 py-2 text-sm rounded border ${
                      ruleType === 'range'
                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Port Range
                  </button>
                </div>
              </div>

              {/* Application Preset */}
              {ruleType === 'application' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Select Application *
                  </label>
                  <select
                    value={selectedApplication}
                    onChange={(e) => setSelectedApplication(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="">Choose an application...</option>
                    {Object.entries(commonPorts).map(([name, port]) => (
                      <option key={name} value={name}>
                        {name} - Port {port.port} ({port.description})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Custom Port */}
              {ruleType === 'custom' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Port Number *
                  </label>
                  <input
                    type="number"
                    value={customPort}
                    onChange={(e) => setCustomPort(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="e.g., 8080"
                    min="1"
                    max="65535"
                  />
                </div>
              )}

              {/* Port Range */}
              {ruleType === 'range' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      From Port *
                    </label>
                    <input
                      type="number"
                      value={fromPort}
                      onChange={(e) => setFromPort(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="e.g., 8000"
                      min="1"
                      max="65535"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      To Port *
                    </label>
                    <input
                      type="number"
                      value={toPort}
                      onChange={(e) => setToPort(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="e.g., 9000"
                      min="1"
                      max="65535"
                    />
                  </div>
                </div>
              )}

              {/* Protocol */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Protocol *
                </label>
                <select
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="-1">All</option>
                </select>
              </div>

              {/* Source CIDR */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Source CIDR *
                </label>
                <input
                  type="text"
                  value={cidrIp}
                  onChange={(e) => setCidrIp(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="0.0.0.0/0"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Use 0.0.0.0/0 for all sources or specify IP range (e.g., 192.168.1.0/24)
                </p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={ruleDescription}
                  onChange={(e) => setRuleDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="Optional rule description"
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowAddRuleModal(false);
                  resetRuleForm();
                }}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddRule}
                disabled={addRule.isPending}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {addRule.isPending ? 'Adding...' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign to Workstation Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Assign to Workstation</h3>
              <button
                onClick={() => {
                  setShowAssignModal(false);
                  setSelectedWorkstationId('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Security Group
                </label>
                <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm">
                  {selectedGroup?.groupName}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Workstation *
                </label>
                <select
                  value={selectedWorkstationId}
                  onChange={(e) => setSelectedWorkstationId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Choose a workstation...</option>
                  {allWorkstations.map((ws: any) => (
                    <option key={ws.workstationId} value={ws.workstationId}>
                      {ws.workstationId} - {ws.status} ({ws.instanceType})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  This will replace the current security group on the selected workstation
                </p>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowAssignModal(false);
                  setSelectedWorkstationId('');
                }}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignToWorkstation}
                disabled={attachToWorkstation.isPending}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {attachToWorkstation.isPending ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Workstations Modal */}
      {showWorkstationsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">
                Workstations Using: {selectedGroup?.groupName}
              </h3>
              <button
                onClick={() => setShowWorkstationsModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              {loadingWorkstations ? (
                <div className="text-center py-8 text-gray-500">Loading workstations...</div>
              ) : groupWorkstations.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No workstations are using this security group
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Workstation ID
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Instance ID
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Status
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Type
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Public IP
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {groupWorkstations.map((ws: WorkstationInfo) => (
                        <tr key={ws.workstationId}>
                          <td className="px-3 py-2 text-sm text-gray-900">{ws.workstationId}</td>
                          <td className="px-3 py-2 text-sm text-gray-900">{ws.instanceId}</td>
                          <td className="px-3 py-2 text-sm">
                            <span className={`px-2 py-1 rounded text-xs ${
                              ws.status === 'running' ? 'bg-green-100 text-green-700' :
                              ws.status === 'stopped' ? 'bg-gray-100 text-gray-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>
                              {ws.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-900">{ws.instanceType}</td>
                          <td className="px-3 py-2 text-sm text-gray-900">{ws.publicIp || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowWorkstationsModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Group Matrix Modal */}
      {showMatrixModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">
                Security Group Assignment Matrix
              </h3>
              <button
                onClick={() => setShowMatrixModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-auto flex-1">
              {allWorkstations.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No workstations available
                </div>
              ) : securityGroups.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No security groups available
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-b-2 border-r-2 border-gray-300 z-10">
                          Workstation
                        </th>
                        {securityGroups.map((group) => (
                          <th
                            key={group.groupId}
                            className="bg-gray-50 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase border-b-2 border-gray-300"
                          >
                            <div className="min-w-[120px]">
                              <div className="font-semibold">{group.groupName}</div>
                              <div className="text-[10px] text-gray-400 mt-1">{group.groupId}</div>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allWorkstations.map((ws: any, wsIdx: number) => {
                        const wsSecurityGroups = ws.securityGroups || [];
                        return (
                          <tr key={ws.workstationId} className={wsIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="sticky left-0 bg-inherit px-4 py-3 text-sm border-r-2 border-gray-300 z-10">
                              <div>
                                <div className="font-medium text-gray-900">{ws.workstationId}</div>
                                <div className="text-xs text-gray-500 mt-1">
                                  {ws.instanceType} • {ws.status}
                                </div>
                              </div>
                            </td>
                            {securityGroups.map((group) => {
                              const isAssigned = wsSecurityGroups.includes(group.groupId);
                              return (
                                <td
                                  key={group.groupId}
                                  className="px-4 py-3 text-center border-l border-gray-200"
                                >
                                  {isAssigned ? (
                                    <div className="flex justify-center">
                                      <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path
                                          fillRule="evenodd"
                                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                          clipRule="evenodd"
                                        />
                                      </svg>
                                    </div>
                                  ) : (
                                    <div className="flex justify-center">
                                      <svg className="w-5 h-5 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                                        <path
                                          fillRule="evenodd"
                                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                          clipRule="evenodd"
                                        />
                                      </svg>
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-4 text-xs text-gray-500">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>Assigned</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>Not Assigned</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowMatrixModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}