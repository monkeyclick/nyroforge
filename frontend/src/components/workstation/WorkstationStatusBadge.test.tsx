import { render, screen } from '@testing-library/react'
import WorkstationStatusBadge from './WorkstationStatusBadge'

describe('WorkstationStatusBadge', () => {
  it.each(['running', 'stopped', 'launching', 'terminating'])('labels the %s state', status => {
    render(<WorkstationStatusBadge status={status} />)
    expect(screen.getByText(status)).toBeInTheDocument()
  })
})
