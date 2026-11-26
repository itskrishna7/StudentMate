import { describe, expect, it } from 'vitest'
import { buildImportReview, findSubjectMatch, MAX_IMPORT_SIZE, reviewStateForItem, validateImportFile } from './importProcessing'
import type { Subject } from './models'

const subject: Subject = {
  id: 'subject-data-structures',
  semesterId: 'semester-1',
  name: 'Data Structures',
  code: 'CS201',
  facultyName: '',
  credits: 3,
  kind: 'theory',
  attendanceTarget: 75,
  color: '#4f46e5',
  archived: false,
  createdAt: '',
  updatedAt: '',
}

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

  it('rejects empty documents', () => {
    const empty = new File([], 'empty.pdf', { type: 'application/pdf' })
    expect(() => validateImportFile(empty)).toThrow('empty')
  })

  it('extracts calendar dates and timetable weekdays into review candidates', () => {
    const calendar = buildImportReview('academic_calendar', 'October 02 2026\nHoliday\n2026-11-15 Midterm')
    expect(calendar.items.some((item) => item.kind === 'event')).toBe(true)

    const timetable = buildImportReview('timetable', 'Monday 09:00-10:00 Data Structures\nTuesday 11:30-12:30 Algorithms')
    expect(timetable.items).toHaveLength(2)
    expect(timetable.items[0]?.weekday).toBe(1)
  })

  it('normalizes AM/PM times and matches a known subject', () => {
    const review = buildImportReview('weekly_timetable', 'Monday 02:30 PM - 03:30 PM Data Structures', [subject])
    expect(review.items[0]).toMatchObject({
      weekday: 1,
      title: 'Data Structures',
      startTime: '14:30',
      endTime: '15:30',
      subjectId: subject.id,
      validation: 'high_confidence',
    })
  })

  it('maps days-in-columns timetable tables by text coordinates', () => {
    const extraction = {
      sourceText: 'Time Monday Tuesday 09:00-10:00 Data Structures Engineering Mathematics',
      pages: [{
        page: 1,
        text: '',
        source: 'pdf_text' as const,
        lines: [
          { page: 1, text: 'Time | Monday | Tuesday', segments: [
            { text: 'Time', x: 0, width: 30 }, { text: 'Monday', x: 100, width: 45 }, { text: 'Tuesday', x: 200, width: 45 },
          ] },
          { page: 1, text: '09:00-10:00 | Data Structures | Engineering Mathematics', segments: [
            { text: '09:00-10:00', x: 0, width: 70 }, { text: 'Data Structures', x: 100, width: 80 }, { text: 'Engineering Mathematics', x: 200, width: 100 },
          ] },
        ],
      }],
    }
    const review = buildImportReview('weekly_timetable', extraction, [
      subject,
      { ...subject, id: 'subject-math', name: 'Engineering Mathematics', code: 'MA201' },
    ])
    expect(review.items.map(({ weekday, title, startTime, endTime }) => ({ weekday, title, startTime, endTime }))).toEqual([
      { weekday: 1, title: 'Data Structures', startTime: '09:00', endTime: '10:00' },
      { weekday: 2, title: 'Engineering Mathematics', startTime: '09:00', endTime: '10:00' },
    ])
  })

  it('keeps a merged laboratory cell as one longer session', () => {
    const extraction = {
      sourceText: 'Day 09:00-10:00 10:00-11:00 Monday Database Laboratory',
      pages: [{
        page: 1,
        text: '',
        source: 'pdf_text' as const,
        lines: [
          { page: 1, text: 'Day | 09:00-10:00 | 10:00-11:00', segments: [
            { text: 'Day', x: 0, width: 25 }, { text: '09:00-10:00', x: 100, width: 70 }, { text: '10:00-11:00', x: 200, width: 70 },
          ] },
          { page: 1, text: 'Monday | Database Laboratory', segments: [
            { text: 'Monday', x: 0, width: 45 }, { text: 'Database Laboratory', x: 100, width: 160 },
          ] },
        ],
      }],
    }
    const review = buildImportReview('weekly_timetable', extraction, [
      { ...subject, id: 'subject-lab', name: 'Database Laboratory', code: 'DBL201', kind: 'laboratory' },
    ])
    expect(review.items).toHaveLength(1)
    expect(review.items[0]).toMatchObject({
      weekday: 1,
      startTime: '09:00',
      endTime: '11:00',
      lectureKind: 'laboratory',
    })
  })

  it('flags ambiguous numeric dates and preserves page references', () => {
    const extraction = {
      sourceText: 'Holiday 03/04/2027',
      pages: [{
        page: 2,
        text: 'Holiday 03/04/2027',
        lines: [{ page: 2, text: 'Holiday 03/04/2027' }],
        source: 'pdf_text' as const,
      }],
    }
    const review = buildImportReview('holiday_list', extraction)
    expect(review.items[0]).toMatchObject({
      startDate: '2027-04-03',
      endDate: '2027-04-03',
      page: 2,
      validation: 'needs_review',
    })
  })

  it('extracts month-name date ranges and classifies a heading-only holiday list', () => {
    const calendar = buildImportReview(
      'academic_calendar',
      'Semester recess 01-05 Sep 2026\nFounders Day November 12-14, 2026',
    )
    expect(calendar.items.map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      ['2026-09-01', '2026-09-05'],
      ['2026-11-12', '2026-11-14'],
    ])
    expect(buildImportReview('auto', 'Holiday List').detectedDocumentType).toBe('holiday_list')
  })

  it('does not classify unknown documents as calendars or timetables', () => {
    const review = buildImportReview('auto', 'A fictional campus memorandum with no dates or class schedule')
    expect(review.detectedDocumentType).toBe('unknown')
    expect(review.items).toEqual([])
  })

  it('does not silently match ambiguous subject names', () => {
    expect(findSubjectMatch('Data Structures', [subject, { ...subject, id: 'subject-duplicate' }]))
      .toMatchObject({ state: 'ambiguous' })
  })

  it('flags duplicate extracted calendar entries for review', () => {
    const review = buildImportReview(
      'holiday_list',
      'Founders Day Holiday 25 November 2026\nFounders Day Holiday 25 November 2026',
    )
    expect(review.items).toHaveLength(2)
    expect(reviewStateForItem(review.items[1]!, review.items)).toBe('duplicate')
  })

  it('does not expose extracted text as HTML or execute it', () => {
    const review = buildImportReview('academic_calendar', '<img src=x onerror=alert(1)>')
    expect(review.sourceText).toContain('<img')
  })
})
