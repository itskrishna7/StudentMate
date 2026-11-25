import { MemoryRouter } from 'react-router-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

afterEach(cleanup)

describe('App', () => {
  it('renders the dashboard empty state', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('No academic data yet')).toBeInTheDocument()
  })

  it('shows an offline status banner after going offline', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    fireEvent(window, new Event('offline'))
    expect(screen.getByRole('status')).toHaveTextContent('Offline')
  })
})
