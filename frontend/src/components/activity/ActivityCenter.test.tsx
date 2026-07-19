import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ActivityCenter, { ActivityItem } from './ActivityCenter'

const activities: ActivityItem[] = [
  { id: '1', title: 'Launching workstation', resourceName: 'Edit Bay 04', status: 'in_progress', progress: 42, createdAt: '2026-07-18T16:00:00Z' },
  { id: '2', title: 'Install failed', status: 'failed', errorMessage: 'Storage volume is unavailable.', createdAt: '2026-07-18T15:00:00Z' },
  { id: '3', title: 'Workstation stopped', status: 'succeeded', createdAt: '2026-07-18T14:00:00Z' },
]

describe('ActivityCenter', () => {
  it('renders nothing while closed', () => {
    render(<ActivityCenter isOpen={false} activities={activities} onClose={jest.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('presents operation state and progress accessibly', () => {
    render(<ActivityCenter isOpen activities={activities} onClose={jest.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Activity center' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Launching workstation progress' })).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
  })

  it('supports retry, dismiss, and clearing completed activity', async () => {
    const user = userEvent.setup()
    const onRetry = jest.fn(); const onDismiss = jest.fn(); const onClearCompleted = jest.fn()
    render(<ActivityCenter isOpen activities={activities} onClose={jest.fn()} onRetry={onRetry} onDismiss={onDismiss} onClearCompleted={onClearCompleted} />)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await user.click(screen.getAllByRole('button', { name: 'Dismiss' })[0])
    await user.click(screen.getByRole('button', { name: 'Clear completed' }))
    expect(onRetry).toHaveBeenCalledWith(activities[1]); expect(onDismiss).toHaveBeenCalledWith(activities[1]); expect(onClearCompleted).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape and restores focus', async () => {
    const user = userEvent.setup(); const onClose = jest.fn()
    const { rerender } = render(<><button>Open activity</button><ActivityCenter isOpen={false} activities={[]} onClose={onClose} /></>)
    const opener = screen.getByRole('button', { name: 'Open activity' }); opener.focus()
    rerender(<><button>Open activity</button><ActivityCenter isOpen activities={[]} onClose={onClose} /></>)
    expect(screen.getByRole('button', { name: 'Close activity center' })).toHaveFocus()
    await user.keyboard('{Escape}'); expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<><button>Open activity</button><ActivityCenter isOpen={false} activities={[]} onClose={onClose} /></>)
    expect(opener).toHaveFocus()
  })
})
