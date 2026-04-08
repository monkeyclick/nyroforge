import { Workstation } from '@/types'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { apiClient } from '@/services/api'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import RdpCredentialsModal from './RdpCredentialsModal'

interface WorkstationCardProps {
  workstation: Workstation
}

export default function WorkstationCard({ workstation }: WorkstationCardProps) {
  const [showCredentials, setShowCredentials] = useState(false)
  const [showSecurityDetails, setShowSecurityDetails] = useState(false)
  const [credentials, setCredentials] = useState<any>(null)
  const [loadingCredentials, setLoadingCredentials] = useState(false)
  const queryClient = useQueryClient()

  // Fetch security group details for this workstation
  const { data: securityGroupData } = useQuery({
    queryKey: ['security-group-details', workstation.securityGroupId],
    queryFn: () => apiClient.getSecurityGroup(workstation.securityGroupId!),
    enabled: !!workstation.securityGroupId,
  })

  const terminateMutation = useMutation({
    mutationFn: () => apiClient.terminateWorkstation(workstation.instanceId),
    onSuccess: () => {
      toast.success('Workstation terminated successfully')
      queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to terminate workstation')
    },
  })

  const allowMyIpMutation = useMutation({
    mutationFn: () => apiClient.allowMyIp(workstation.instanceId),
    onSuccess: (data) => {
      toast.success(`Your IP (${data.ipAddress}) has been whitelisted for RDP access`)
      queryClient.invalidateQueries({ queryKey: ['security-group-details', workstation.securityGroupId] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to whitelist IP address')
    },
  })

  const handleGetCredentials = async () => {
    setLoadingCredentials(true)
    try {
      const creds = await apiClient.getWorkstationCredentials(workstation.instanceId)
      setCredentials(creds)
      setShowCredentials(true)
    } catch (error: any) {
      toast.error(error.message || 'Failed to get credentials')
    } finally {
      setLoadingCredentials(false)
    }
  }

  const handleTerminate = () => {
    if (confirm(`Are you sure you want to terminate ${workstation.tags?.Name || workstation.instanceId}?`)) {
      terminateMutation.mutate()
    }
  }

  const handleAllowMyIp = () => {
    allowMyIpMutation.mutate()
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-green-100 text-green-800'
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'stopping':
      case 'shutting-down':
        return 'bg-orange-100 text-orange-800'
      case 'stopped':
      case 'terminated':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900">{workstation.tags?.Name || workstation.instanceId}</h3>
          <p className="mt-1 text-sm text-gray-500">Instance ID: {workstation.instanceId}</p>
          <div className="mt-2 flex items-center space-x-2">
            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(workstation.status)}`}>
              {workstation.status}
            </span>
            <span className="text-sm text-gray-500">{workstation.instanceType}</span>
            <span className="text-sm text-gray-500">{workstation.region}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="font-medium text-gray-700">Public IP:</span>
          <span className="ml-2 text-gray-900">{workstation.publicIp || 'N/A'}</span>
        </div>
        <div>
          <span className="font-medium text-gray-700">Launch Time:</span>
          <span className="ml-2 text-gray-900">
            {new Date(workstation.launchTime).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Security Group Information */}
      {workstation.securityGroupId && (
        <div className="mt-4 border-t pt-4">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-medium text-gray-700">Security Group</h4>
            <button
              onClick={() => setShowSecurityDetails(!showSecurityDetails)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              {showSecurityDetails ? 'Hide' : 'Show'} Details
            </button>
          </div>
          
          <div className="mt-2">
            <p className="text-xs text-gray-600">
              {securityGroupData?.groupName || workstation.securityGroupId}
            </p>
            
            {showSecurityDetails && securityGroupData && (
              <div className="mt-3 space-y-2">
                <div className="bg-gray-50 rounded p-3">
                  <p className="text-xs font-medium text-gray-700 mb-2">Open Inbound Ports:</p>
                  {securityGroupData.ingressRules && securityGroupData.ingressRules.length > 0 ? (
                    <div className="space-y-1">
                      {securityGroupData.ingressRules.map((rule: any, idx: number) => (
                        <div key={idx} className="text-xs text-gray-600 flex justify-between">
                          <span>
                            <strong>
                              {rule.fromPort && rule.toPort
                                ? rule.fromPort === rule.toPort
                                  ? `Port ${rule.fromPort}`
                                  : `Ports ${rule.fromPort}-${rule.toPort}`
                                : 'All Ports'}
                            </strong>
                            {' / '}
                            {rule.ipProtocol.toUpperCase()}
                          </span>
                          <span className="text-gray-500">
                            {rule.ipRanges?.[0]?.cidrIp === '0.0.0.0/0'
                              ? 'All IPs'
                              : rule.ipRanges?.[0]?.cidrIp || 'N/A'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">No inbound rules configured</p>
                  )}
                </div>

                {securityGroupData.description && (
                  <p className="text-xs text-gray-500">
                    <strong>Description:</strong> {securityGroupData.description}
                  </p>
                )}

                <p className="text-xs text-gray-500">
                  <strong>Group ID:</strong> {workstation.securityGroupId}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {workstation.autoTerminateAt && (
        <div className="mt-2 text-sm text-gray-600">
          Auto-terminate at: {new Date(workstation.autoTerminateAt).toLocaleString()}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {workstation.status === 'running' && (
          <>
            <button
              onClick={handleGetCredentials}
              disabled={loadingCredentials}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
            >
              {loadingCredentials ? 'Loading...' : 'Get Credentials'}
            </button>
            <button
              onClick={handleAllowMyIp}
              disabled={allowMyIpMutation.isPending}
              className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 disabled:opacity-50"
              title="Add your current IP address to the security group for RDP access"
            >
              {allowMyIpMutation.isPending ? 'Adding IP...' : 'Allow My IP'}
            </button>
            <button
              onClick={handleTerminate}
              disabled={terminateMutation.isPending}
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-50"
            >
              {terminateMutation.isPending ? 'Terminating...' : 'Terminate'}
            </button>
          </>
        )}
      </div>

      {/* RDP Credentials Modal */}
      {credentials && (
        <RdpCredentialsModal
          isOpen={showCredentials}
          onClose={() => setShowCredentials(false)}
          credentials={{
            hostname: workstation.publicIp || workstation.instanceId,
            username: credentials.username,
            password: credentials.password,
            rdpFile: credentials.rdpFile
          }}
          workstationName={workstation.tags?.Name || workstation.instanceId}
        />
      )}
    </div>
  )
}