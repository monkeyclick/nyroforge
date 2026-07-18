import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StudioFilters from './StudioFilters'

describe('StudioFilters', () => {
  it('reports and changes the active status', async () => {
    const onStatusChange = jest.fn()
    render(<StudioFilters activeStatus="running" onStatusChange={onStatusChange} onLaunch={jest.fn()} onRefresh={jest.fn()} />)

    expect(screen.getByRole('button', { name: 'Running' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Stopped' }))
    expect(onStatusChange).toHaveBeenCalledWith('stopped')
  })
})
