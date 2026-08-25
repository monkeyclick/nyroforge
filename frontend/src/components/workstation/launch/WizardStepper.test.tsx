import { render, screen } from '@testing-library/react'
import { WizardStepper } from './WizardStepper'

const STEPS = ['Compute & Access', 'Packages & Security', 'Tags & Details', 'Review & Confirm']

describe('WizardStepper', () => {
  it('marks exactly one step as current for assistive tech', () => {
    const { container } = render(<WizardStepper steps={STEPS} currentStep={1} />)
    const current = container.querySelectorAll('[aria-current="step"]')
    expect(current).toHaveLength(1)
  })

  it('renders a label for every step', () => {
    render(<WizardStepper steps={STEPS} currentStep={0} />)
    STEPS.forEach(label => {
      expect(screen.getByText(label)).toBeInTheDocument()
    })
  })
})
