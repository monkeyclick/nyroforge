import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminNavigation from './AdminNavigation'

describe('AdminNavigation', () => {
  it('marks the current section and emits navigation changes', async () => {
    const onChange = jest.fn()
    render(<AdminNavigation activeTab="workstations" onChange={onChange} />)

    expect(screen.getByRole('button', { name: 'Workstations' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('button', { name: 'People & teams' }))
    expect(onChange).toHaveBeenCalledWith('user-management')
  })

  it('shows a count beside a section that has work waiting', () => {
    render(
      <AdminNavigation activeTab="workstations" onChange={jest.fn()} badges={{ 'package-review': 3 }} />
    )
    expect(screen.getByLabelText('3 awaiting attention')).toHaveTextContent('3')
  })

  it('caps the badge so a large backlog does not distort the nav', () => {
    render(
      <AdminNavigation activeTab="workstations" onChange={jest.fn()} badges={{ 'package-review': 42 }} />
    )
    expect(screen.getByLabelText('42 awaiting attention')).toHaveTextContent('9+')
  })

  it('renders no badge when nothing is waiting', () => {
    render(
      <AdminNavigation activeTab="workstations" onChange={jest.fn()} badges={{ 'package-review': 0 }} />
    )
    expect(screen.queryByLabelText(/awaiting attention/)).toBeNull()
  })
})
