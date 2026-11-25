import { describe, expect, it } from 'vitest'
import { buildImportReview, MAX_IMPORT_SIZE, validateImportFile } from './importProcessing'

describe('import validation', () => {
  it('accepts supported PDF files and rejects oversized files', () => {
    const pdf = new File(['pdf'], 'calendar.pdf', { type: 'application/pdf' })
    expect(validateImportFile(pdf)).toBe('pdf')

    const oversized = new File([new Uint8Array(MAX_IMPORT_SIZE + 1)], 'large.pdf', { type: 'application/pdf' })
    expect(() => validateImportFile(oversized)).toThrow('15 MB')
  })

  it('rejects unsupported file types', () => {
    const script = new File(['<script>'], 'test.html', { type: 'text/html' })
    expect(() => validateImportFile(script)).toThrow('Only PDF')
  })

  it('extracts calendar dates and timetable weekdays into review candidates', () => {
    const calendar = buildImportReview('academic_calendar', 'October 02 2026\nHoliday\n2026-11-15 Midterm')
    expect(calendar.items.some((item) => item.kind === 'event')).toBe(true)

    const timetable = buildImportReview('timetable', 'Monday 09:00 Data Structures\nTuesday 11:30 Algorithms')
    expect(timetable.items).toHaveLength(2)
    expect(timetable.items[0]?.weekday).toBe(1)
  })

  it('does not expose extracted text as HTML or execute it', () => {
    const review = buildImportReview('academic_calendar', '<img src=x onerror=alert(1)>')
    expect(review.sourceText).toContain('<img')
  })
})
