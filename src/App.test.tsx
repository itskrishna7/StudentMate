import { MemoryRouter } from 'react-router-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { db } from './data/database'

afterEach(cleanup)
afterEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
})

describe('App', () => {
  it('renders the dashboard empty state', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: /Good (morning|afternoon|evening)!/ })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Build your academic workspace' })).toBeInTheDocument()
  })

  it('shows an offline status banner after going offline', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    fireEvent(window, new Event('offline'))
    expect(screen.getByText(/Offline - local academic data/)).toBeInTheDocument()
  })

  it('lets a student select a semester and opens the performance tracker', async () => {
    render(
      <MemoryRouter initialEntries={['/performance']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Academic performance' })).toBeInTheDocument()
    const currentSemester = await screen.findByRole('combobox', { name: 'Current semester' })
    fireEvent.change(currentSemester, { target: { value: '3' } })
    expect(await screen.findByText('Semester history is ready.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Semester results' })).toBeInTheDocument()
  })
})
