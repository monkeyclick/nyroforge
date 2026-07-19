import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ActivityStatus = 'queued' | 'in_progress' | 'succeeded' | 'failed'
export type ActivityCategory = 'workstation' | 'connection' | 'software' | 'collaboration' | 'system'

export interface ActivityItem {
  id: string
  title: string
  description?: string
  status: ActivityStatus
  category: ActivityCategory
  resourceId?: string
  resourceName?: string
  progress?: number
  errorMessage?: string
  createdAt: string
  updatedAt: string
  read: boolean
}

interface NewActivity extends Omit<ActivityItem, 'id' | 'createdAt' | 'updatedAt' | 'read'> {
  id?: string
}

interface ActivityStore {
  activities: ActivityItem[]
  addActivity: (activity: NewActivity) => string
  updateActivity: (id: string, updates: Partial<Pick<ActivityItem, 'title' | 'description' | 'status' | 'read' | 'progress' | 'errorMessage'>>) => void
  markAllRead: () => void
  dismissActivity: (id: string) => void
  clearCompleted: () => void
  clearAll: () => void
}

const createActivityId = () => `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const useActivityStore = create<ActivityStore>()(
  persist(
    (set) => ({
      activities: [],
      addActivity: (activity) => {
        const now = new Date().toISOString()
        const id = activity.id || createActivityId()
        set(state => ({
          activities: [{ ...activity, id, createdAt: now, updatedAt: now, read: false }, ...state.activities.filter(item => item.id !== id)].slice(0, 50),
        }))
        return id
      },
      updateActivity: (id, updates) => set(state => ({
        activities: state.activities.map(item => item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString(), read: updates.read ?? item.read } : item),
      })),
      markAllRead: () => set(state => ({ activities: state.activities.map(item => ({ ...item, read: true })) })),
      dismissActivity: (id) => set(state => ({ activities: state.activities.filter(item => item.id !== id) })),
      clearCompleted: () => set(state => ({ activities: state.activities.filter(item => item.status === 'queued' || item.status === 'in_progress') })),
      clearAll: () => set({ activities: [] }),
    }),
    { name: 'nyroforge-activities', version: 1 }
  )
)
