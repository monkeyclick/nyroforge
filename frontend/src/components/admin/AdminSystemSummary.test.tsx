import { render, screen, within } from '@testing-library/react'
import AdminSummaryStats, { AdminSystemSummary } from './AdminSummaryStats'
import AdminSystemInfo from './AdminSystemInfo'

const summary: AdminSystemSummary = {
  totalInstances: 12,
  runningInstances: 7,
  stoppedInstances: 5,
  totalHourlyCost: 9.876,
  estimatedMonthlyCost: 321.6,
}

describe('admin system summary components', () => {
  it('renders the compact system summary with rounded monthly cost', () => {
    render(<AdminSummaryStats summary={summary} />)

    const stats = screen.getByRole('region', { name: 'System summary' })
    expect(within(stats).getByText('12')).toBeInTheDocument()
    expect(within(stats).getByText('7')).toBeInTheDocument()
    expect(within(stats).getByText('5')).toBeInTheDocument()
    expect(within(stats).getByText('$322')).toBeInTheDocument()
  })

  it('renders detailed system costs and the privilege notice', () => {
    render(<AdminSystemInfo summary={summary} />)

    const info = screen.getByRole('complementary', { name: 'System information' })
    expect(within(info).getByText('$9.88')).toBeInTheDocument()
    expect(within(info).getByText('$322')).toBeInTheDocument()
    expect(within(info).getByText('ADMIN PRIVILEGES')).toBeInTheDocument()
    expect(within(info).getByText(/full system access/i)).toBeInTheDocument()
  })
})
