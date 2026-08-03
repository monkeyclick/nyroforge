import { render, screen, fireEvent } from '@testing-library/react'
import { StepReview } from './StepReview'
import { LaunchFormValues } from './types'

const values: LaunchFormValues = {
  friendlyName: '',
  region: 'us-west-2',
  instanceType: 'g5.xlarge',
  osVersion: 'windows-server-2025',
  authMethod: 'local',
  autoTerminateHours: 8,
  bootstrapPackages: ['pkg-1'],
  securityGroupMode: 'template',
  selectedSecurityGroup: '',
  newSecurityGroupName: '',
  newSecurityGroupDescription: '',
  selectedTemplate: 'Remote Desktop (RDP)',
  customPorts: [],
  tagPurpose: 'workstation',
  tagDepartment: 'se',
  tagLongRunning: false,
}

const noop = () => {}

describe('StepReview', () => {
  it('jumps back to the right step when an Edit button is clicked', () => {
    const onEditStep = jest.fn()
    render(
      <StepReview
        values={values}
        instanceTypes={[]}
        securityGroups={[]}
        clientIp=""
        error=""
        isPending={false}
        isSuccess={false}
        onEditStep={onEditStep}
        onBack={noop}
        onLaunch={noop}
      />
    )

    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    fireEvent.click(editButtons[1])
    expect(onEditStep).toHaveBeenCalledWith(1)
  })

  it('disables Launch and Back while a launch is pending', () => {
    render(
      <StepReview
        values={values}
        instanceTypes={[]}
        securityGroups={[]}
        clientIp=""
        error=""
        isPending
        isSuccess={false}
        onEditStep={noop}
        onBack={noop}
        onLaunch={noop}
      />
    )

    expect(screen.getByRole('button', { name: 'Launching...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
  })
})
