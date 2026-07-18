import { render, screen } from '@testing-library/react'
import StudioStats from './StudioStats'

describe('StudioStats', () => {
  it('renders operational and cost metrics', () => {
    render(<StudioStats total={8} running={3} monthlyCost={142.7} projectedMonthly={280.2} />)

    expect(screen.getByLabelText('Studio summary')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('$143')).toBeInTheDocument()
    expect(screen.getByText(/projected \$280/)).toBeInTheDocument()
  })
})
