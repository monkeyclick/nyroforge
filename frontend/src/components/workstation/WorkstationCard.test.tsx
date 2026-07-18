import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Workstation } from '@/types'
import WorkstationCard from './WorkstationCard'

const workstation = {
  instanceId: 'i-edit-bay',
  workstationId: 'ws-edit-bay',
  friendlyName: 'Edit Bay 1',
  instanceType: 'g5.2xlarge',
  region: 'us-west-2',
  publicIp: '203.0.113.10',
  userId: 'artist@example.com',
  status: 'running',
  autoTerminateAt: '2099-01-01T00:00:00.000Z',
} as Workstation

function renderCard(overrides: Partial<React.ComponentProps<typeof WorkstationCard>> = {}) {
  const callbacks = {
    onEditingNameChange: jest.fn(),
    onStartEditName: jest.fn(),
    onSaveName: jest.fn(),
    onCancelEditName: jest.fn(),
    onExtend: jest.fn(),
    onSoftware: jest.fn(),
    onShare: jest.fn(),
    onRemoteDesktop: jest.fn(),
    onConnect: jest.fn(),
    onPower: jest.fn(),
    onTerminate: jest.fn(),
  }

  render(
    <WorkstationCard
      workstation={workstation}
      canShare
      isEditingName={false}
      editingNameValue=""
      isSavingName={false}
      isExtending={false}
      pendingPowerAction={null}
      isTerminatePending={false}
      {...callbacks}
      {...overrides}
    />,
  )

  return callbacks
}

describe('WorkstationCard', () => {
  it('supports the controlled rename flow', async () => {
    const callbacks = renderCard({ isEditingName: true, editingNameValue: 'Edit Bay 2' })

    const input = screen.getByRole('textbox', { name: '' })
    await userEvent.type(input, 'A')
    expect(callbacks.onEditingNameChange).toHaveBeenCalledWith('Edit Bay 2A')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(callbacks.onSaveName).toHaveBeenCalledTimes(1)
  })

  it('requests an auto-termination extension with the selected duration', async () => {
    const callbacks = renderCard()

    await userEvent.click(screen.getByRole('button', { name: '+8h' }))
    expect(callbacks.onExtend).toHaveBeenCalledWith(8)
  })

  it('wires workstation actions to the card callbacks', async () => {
    const callbacks = renderCard()

    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await userEvent.click(screen.getByRole('button', { name: 'Software' }))
    await userEvent.click(screen.getByRole('button', { name: /Stop/ }))

    expect(callbacks.onConnect).toHaveBeenCalledTimes(1)
    expect(callbacks.onSoftware).toHaveBeenCalledTimes(1)
    expect(callbacks.onPower).toHaveBeenCalledWith('stop')
  })
})
