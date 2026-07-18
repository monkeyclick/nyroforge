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
})
