import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DashboardInsights from './DashboardInsights'
import type { EnhancedUser } from '@/types/auth'

const user: EnhancedUser = {
  id: 'user-1',
  email: 'artist@example.com',
  name: 'Avery Artist',
  status: 'active',
  roleIds: ['admin'],
  groupIds: [],
  directPermissions: [],
  attributes: {},
  preferences: {},
  loginHistory: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const defaultProps = {
  user,
  isAdmin: true,
  runningCount: 3,
  stoppedCount: 2,
  totalCount: 6,
  monthlyCost: 128.456,
  dailyAverage: 4.25,
  projectedMonthly: 201.8,
  costSuggestions: ['Stop idle workstations', 'Use a smaller instance family'],
  onEditProfile: jest.fn(),
  onOpenAdmin: jest.fn(),
}

describe('DashboardInsights', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders account, operational, and formatted cost information', () => {
    render(<DashboardInsights {...defaultProps} />)

    const insights = screen.getByRole('complementary', { name: 'Studio insights' })
    expect(within(insights).getByText('Avery Artist')).toBeInTheDocument()
    expect(within(insights).getByText('artist@example.com')).toBeInTheDocument()
    expect(within(insights).getByText('Administrator')).toBeInTheDocument()
    expect(within(insights).getByText('$128.46')).toBeInTheDocument()
    expect(within(insights).getByText('$4.25')).toBeInTheDocument()
    expect(within(insights).getByText('$201.80')).toBeInTheDocument()
    expect(within(insights).getByText('Stop idle workstations')).toBeInTheDocument()
  })

  it('emits profile and admin navigation requests', async () => {
    render(<DashboardInsights {...defaultProps} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open Admin Panel' }))

    expect(defaultProps.onEditProfile).toHaveBeenCalledTimes(1)
    expect(defaultProps.onOpenAdmin).toHaveBeenCalledTimes(1)
  })

  it('hides optional cost and admin panels when they do not apply', () => {
    render(
      <DashboardInsights
        {...defaultProps}
        user={{ ...user, roleIds: ['user'] }}
        isAdmin={false}
        dailyAverage={0}
        costSuggestions={[]}
      />
    )

    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.queryByText('COST INSIGHTS')).not.toBeInTheDocument()
    expect(screen.queryByText('ADMIN ACCESS')).not.toBeInTheDocument()
  })
})
