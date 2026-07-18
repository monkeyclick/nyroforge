import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorkstationActions from './WorkstationActions'
import { Workstation } from '@/types'

const baseWorkstation = {
  instanceId: 'i-creative',
  workstationId: 'ws-creative',
  friendlyName: 'Edit Bay 1',
  status: 'running',
} as Workstation

function renderActions(status: Workstation['status'] = 'running') {
  const callbacks = {
    onSoftware: jest.fn(), onShare: jest.fn(), onRemoteDesktop: jest.fn(), onConnect: jest.fn(),
    onPower: jest.fn(), onTerminate: jest.fn(),
  }
  render(<WorkstationActions workstation={{ ...baseWorkstation, status }} canShare pendingPowerAction={null} isTerminatePending={false} {...callbacks} />)
  return callbacks
}

describe('WorkstationActions', () => {
  it('prioritizes connection controls for a running workstation', async () => {
    const callbacks = renderActions()
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(callbacks.onConnect).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument()
  })

  it('offers start instead of connection controls while stopped', () => {
    renderActions('stopped')
    expect(screen.getByRole('button', { name: /Start/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  })

  it('hides all lifecycle actions after termination', () => {
    renderActions('terminated')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
