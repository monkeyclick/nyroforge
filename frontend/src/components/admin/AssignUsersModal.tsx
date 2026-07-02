import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { apiClient } from '@/services/api'
import { Workstation } from '@/types'

interface AssignUsersModalProps {
  workstation: Workstation
  onClose: () => void
  onSuccess: () => void
}

/**
 * Admin-only modal to reassign a workstation's owner and share it with
 * additional users. The owner has implicit access; assigned users get the
 * same start/stop/terminate/connect rights.
 */
export default function AssignUsersModal({ workstation, onClose, onSuccess }: AssignUsersModalProps) {
  const [owner, setOwner] = useState(workstation.userId)
  const [assignedUsers, setAssignedUsers] = useState<string[]>(workstation.assignedUsers || [])
  const [search, setSearch] = useState('')

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiClient.getUsers(),
  })

  const userEmails = useMemo(() => {
    const emails = (usersData?.users || [])
      .map((u: any) => u.email as string)
      .filter(Boolean)
    // Ensure the current owner and already-assigned users remain selectable
    // even if they no longer appear in the user directory
    const all = new Set([...emails, workstation.userId, ...(workstation.assignedUsers || [])])
    return Array.from(all).sort((a, b) => a.localeCompare(b))
  }, [usersData, workstation.userId, workstation.assignedUsers])

  const filteredEmails = useMemo(
    () => userEmails.filter(email => email.toLowerCase().includes(search.toLowerCase())),
    [userEmails, search]
  )

  const toggleAssigned = (email: string) => {
    setAssignedUsers(prev =>
      prev.includes(email) ? prev.filter(u => u !== email) : [...prev, email]
    )
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.updateWorkstationOwnership(
        workstation.workstationId || workstation.instanceId,
        {
          owner,
          assignedUsers: assignedUsers.filter(u => u !== owner),
        }
      ),
    onSuccess: () => {
      toast.success('Workstation access updated')
      onSuccess()
      onClose()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update workstation access')
    },
  })

  const ownerChanged = owner !== workstation.userId
  const workstationName = workstation.friendlyName || workstation.instanceId

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-start">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Manage Access</h2>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{workstationName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Owner */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {userEmails.map(email => (
                <option key={email} value={email}>{email}</option>
              ))}
            </select>
            {ownerChanged && (
              <p className="mt-1 text-xs text-amber-600">
                Ownership will be transferred from {workstation.userId} to {owner}.
              </p>
            )}
          </div>

          {/* Shared users */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-medium text-gray-700">
                Shared with ({assignedUsers.filter(u => u !== owner).length})
              </label>
              {assignedUsers.length > 0 && (
                <button
                  onClick={() => setAssignedUsers([])}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear all
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-2">
              Shared users can start, stop, terminate, and connect to this workstation.
            </p>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users…"
              className="w-full px-3 py-2 mb-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-56 overflow-y-auto">
              {usersLoading ? (
                <div className="px-3 py-4 text-sm text-gray-500 text-center">Loading users…</div>
              ) : filteredEmails.length === 0 ? (
                <div className="px-3 py-4 text-sm text-gray-500 text-center">No users match</div>
              ) : (
                filteredEmails.map(email => {
                  const isOwner = email === owner
                  return (
                    <label
                      key={email}
                      className={`flex items-center gap-2 px-3 py-2 text-sm ${
                        isOwner ? 'bg-gray-50 text-gray-400' : 'hover:bg-gray-50 cursor-pointer text-gray-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isOwner || assignedUsers.includes(email)}
                        disabled={isOwner}
                        onChange={() => toggleAssigned(email)}
                        className="rounded border-gray-300"
                      />
                      <span className="flex-1 truncate">{email}</span>
                      {isOwner && (
                        <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">owner</span>
                      )}
                    </label>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Access'}
          </button>
        </div>
      </div>
    </div>
  )
}
