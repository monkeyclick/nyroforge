import { useActivityStore } from './activityStore'

const activity = {
  title: 'Start workstation',
  description: 'Request sent',
  status: 'in_progress' as const,
  category: 'workstation' as const,
}

describe('activityStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useActivityStore.setState({ activities: [] })
  })

  it('adds, updates, and marks activities read', () => {
    const id = useActivityStore.getState().addActivity({ ...activity, id: 'operation-1' })
    expect(id).toBe('operation-1')
    expect(useActivityStore.getState().activities[0]).toMatchObject({ id, read: false, status: 'in_progress' })

    useActivityStore.getState().updateActivity(id, { status: 'succeeded' })
    expect(useActivityStore.getState().activities[0].status).toBe('succeeded')

    useActivityStore.getState().markAllRead()
    expect(useActivityStore.getState().activities[0].read).toBe(true)
  })

  it('deduplicates explicit ids and caps history at 50 items', () => {
    useActivityStore.getState().addActivity({ ...activity, id: 'same', title: 'First' })
    useActivityStore.getState().addActivity({ ...activity, id: 'same', title: 'Updated' })
    expect(useActivityStore.getState().activities.filter(item => item.id === 'same')).toHaveLength(1)
    expect(useActivityStore.getState().activities[0].title).toBe('Updated')

    for (let index = 0; index < 55; index += 1) useActivityStore.getState().addActivity({ ...activity, id: `item-${index}` })
    expect(useActivityStore.getState().activities).toHaveLength(50)
  })

  it('clears completed items while retaining active work', () => {
    const activeId = useActivityStore.getState().addActivity(activity)
    useActivityStore.getState().addActivity({ ...activity, id: 'done', status: 'succeeded' })
    useActivityStore.getState().clearCompleted()

    expect(useActivityStore.getState().activities.map(item => item.id)).toEqual([activeId])
    useActivityStore.getState().dismissActivity(activeId)
    expect(useActivityStore.getState().activities).toEqual([])
  })
})
