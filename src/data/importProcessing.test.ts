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

  it('normalizes compact OCR times and groups words within timetable cells', () => {
    const extraction = {
      sourceText: 'Weekly timetable Monday Data Structures Algorithms',
      pages: [{
        page: 1,
        text: '',
        source: 'ocr' as const,
        ocrConfidence: 0.9,
        lines: [
          { page: 1, text: 'Period 830925 | 925-1020', segments: [
            { text: 'Period', x: 0, width: 40 },
            { text: '830925', x: 100, width: 60 },
            { text: '925-1020', x: 200, width: 70 },
          ] },
          { page: 1, text: 'MONDAY | Data Structures | Algorithms', segments: [
            { text: 'MONDAY', x: 0, width: 60, height: 12 },
            { text: '|', x: 85, width: 2, height: 12 },
            { text: 'Data', x: 105, width: 28, height: 12 },
            { text: 'Structures', x: 138, width: 50, height: 12 },
            { text: '|', x: 190, width: 2, height: 12 },
            { text: 'Algorithms', x: 205, width: 55, height: 12 },
          ] },
        ],
      }],
    }
    const review = buildImportReview('weekly_timetable', extraction, [
      subject,
      { ...subject, id: 'subject-algorithms', name: 'Algorithms', code: 'CS202' },
    ])
    expect(review.items.map(({ title, startTime, endTime }) => ({ title, startTime, endTime }))).toEqual([
      { title: 'Data Structures', startTime: '08:30', endTime: '09:25' },
      { title: 'Algorithms', startTime: '09:25', endTime: '10:20' },
    ])
  })

  it('does not turn unrelated OCR footer text into a session for the last detected weekday', () => {
    const extraction = {
      sourceText: 'Weekly timetable Monday Saturday',
      pages: [{
        page: 1,
        text: '',
        source: 'ocr' as const,
        lines: [
          { page: 1, text: 'Monday 09:00-10:00 Data Structures' },
          { page: 1, text: 'Saturday 10:00-11:00 Algorithms' },
          { page: 1, text: 'TIMETABLE COORDINATORS PRINCIPAL', segments: [
            { text: 'TIMETABLE', x: 0, width: 70 },
            { text: 'COORDINATORS', x: 80, width: 90 },
            { text: 'PRINCIPAL', x: 200, width: 80 },
          ] },
        ],
      }],
    }
    const review = buildImportReview('weekly_timetable', extraction)
    expect(review.items).toHaveLength(2)
    expect(review.items.map(({ weekday }) => weekday)).toEqual([1, 6])
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

  it('does not expand duplicated weekday OCR labels or academic years into timetable times', () => {
    const extraction = {
      sourceText: 'Weekly timetable Academic Year 2026-2027 Thursday Data Structures',
      pages: [{
        page: 1,
        text: '',
        source: 'ocr' as const,
        lines: [
          { page: 1, text: 'Thursday | Thursday', segments: [
            { text: 'Thursday', x: 100, width: 60 },
            { text: '|', x: 180, width: 2 },
            { text: 'Thursday', x: 220, width: 60 },
          ] },
          { page: 1, text: 'Academic Year 2026-2027', segments: [
            { text: 'Academic Year', x: 0, width: 100 },
            { text: '2026-2027', x: 200, width: 70 },
            { text: '(ODD)', x: 300, width: 40 },
          ] },
          { page: 1, text: 'Monday 09:00-10:00 Data Structures' },
        ],
      }],
    }
    const review = buildImportReview('weekly_timetable', extraction)
    expect(review.items.some(({ startTime, endTime }) => startTime === '20:26' || endTime === '20:27')).toBe(false)
    expect(review.items.some(({ weekday, title, startTime, endTime }) =>
      weekday === 1 && title === 'Data Structures' && startTime === '09:00' && endTime === '10:00',
    )).toBe(true)
  })

  it('maps OCR time headers split across nearby text lines to timetable cells', () => {
    const extraction = {
      sourceText: 'Weekly timetable 09:00-10:00 10:00-11:00 11:00-12:00 Monday Database Lab Data Structures',
      pages: [{
        page: 1,
        text: '',
        source: 'ocr' as const,
        lines: [
          { page: 1, y: 100, text: '09:00-10:00', segments: [{ text: '09:00-10:00', x: 100, width: 70, height: 12 }] },
          { page: 1, y: 102, text: '10:00-11:00', segments: [{ text: '10:00-11:00', x: 200, width: 70, height: 12 }] },
          { page: 1, y: 99, text: '11:00-12:00', segments: [{ text: '11:00-12:00', x: 300, width: 70, height: 12 }] },
          { page: 1, y: 150, text: 'Monday Database Lab Data Structures', segments: [
            { text: 'Monday', x: 0, width: 50, height: 12 },
            { text: 'Database', x: 110, width: 65, height: 12 },
            { text: 'Lab', x: 182, width: 25, height: 12 },
            { text: 'Data Structures', x: 310, width: 90, height: 12 },
          ] },
        ],
      }],
    }
    const review = buildImportReview('weekly_timetable', extraction)
    expect(review.items.map(({ title, startTime, endTime }) => ({ title, startTime, endTime }))).toEqual([
      { title: 'Database Lab', startTime: '09:00', endTime: '11:00' },
      { title: 'Data Structures', startTime: '11:00', endTime: '12:00' },
    ])
  })

  it('infers afternoon times from a sequential timetable header and flags them for review', () => {
    const extraction = {
      sourceText: 'Weekly timetable 12:30-1:25 1:25-2:20 Monday Algorithms Data Structures',
      pages: [{
        page: 1,
        text: '',
        source: 'ocr' as const,
        lines: [
          { page: 1, y: 100, text: '12:30-1:25', segments: [{ text: '12:30-1:25', x: 100, width: 70, height: 12 }] },
          { page: 1, y: 100, text: '1:25-2:20', segments: [{ text: '1:25-2:20', x: 200, width: 70, height: 12 }] },
          { page: 1, y: 150, text: 'Monday Algorithms Data Structures', segments: [
            { text: 'Monday', x: 0, width: 50, height: 12 },
            { text: 'Algorithms', x: 110, width: 65, height: 12 },
            { text: 'Data Structures', x: 210, width: 90, height: 12 },
          ] },
        ],
      }],
    }
    const review = buildImportReview('weekly_timetable', extraction)
    expect(review.items.map(({ title, startTime, endTime, validation, warnings }) => ({
      title, startTime, endTime, validation, warnings,
    }))).toEqual([
      {
        title: 'Algorithms',
        startTime: '12:30',
        endTime: '13:25',
        validation: 'needs_review',
        warnings: expect.arrayContaining(['Afternoon meridiem inferred from the timetable sequence; verify this time', 'No existing subject matched; review the name']),
      },
      {
        title: 'Data Structures',
        startTime: '13:25',
        endTime: '14:20',
        validation: 'needs_review',
        warnings: expect.arrayContaining(['Afternoon meridiem inferred from the timetable sequence; verify this time', 'No existing subject matched; review the name']),
      },
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
            { text: 'Monday', x: 0, width: 45 }, { text: 'Database Laboratory', x: 155, width: 90 },
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

  it('does not assign a time to OCR text outside the detected schedule columns', () => {
    const extraction = {
      sourceText: 'Weekly timetable Monday',
      pages: [{
        page: 1,
        text: '',
        source: 'ocr' as const,
        lines: [
          { page: 1, text: 'Period | 09:00-10:00 | 10:00-11:00', segments: [
            { text: 'Period', x: 0, width: 40 },
            { text: '09:00-10:00', x: 100, width: 70 },
            { text: '10:00-11:00', x: 200, width: 70 },
          ] },
          { page: 1, text: 'Monday Unmapped', segments: [
            { text: 'Monday', x: 0, width: 50 },
            { text: 'Unmapped', x: 500, width: 80 },
          ] },
        ],
      }],
    }
    const review = buildImportReview('weekly_timetable', extraction)
    expect(review.items).toHaveLength(1)
    expect(review.items[0]).toMatchObject({ weekday: 1, validation: 'invalid' })
    expect(review.items[0]?.startTime).toBeUndefined()
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

  it('uses an academic-year heading for month-only dates and splits multiple events on a line', () => {
    const extraction = {
      sourceText: 'Tentative Calendar of Events 2026-27',
      pages: [{
        page: 1,
        text: 'Tentative Calendar of Events 2026-27',
        lines: [
          { page: 1, text: '07-08 Sep.: Course Registration of BE III Semester 09 Sep.: Commencement of III Semester Classes' },
          { page: 1, text: '12-14 Nov.: Internal Assessment 1' },
          { page: 1, text: '04 Jan.: Last date to enter CIE marks' },
        ],
        source: 'ocr' as const,
        ocrConfidence: 0.9,
      }],
    }
    const review = buildImportReview('academic_calendar', extraction)
    expect(review.academicYear).toBe('2026-27')
    expect(review.items.map(({ title, startDate, endDate, eventType, validation }) => ({
      title, startDate, endDate, eventType, validation,
    }))).toEqual([
      { title: 'Course Registration of BE III Semester', startDate: '2026-09-07', endDate: '2026-09-08', eventType: 'deadline', validation: 'needs_review' },
      { title: 'Commencement of III Semester Classes', startDate: '2026-09-09', endDate: '2026-09-09', eventType: 'special', validation: 'needs_review' },
      { title: 'Internal Assessment 1', startDate: '2026-11-12', endDate: '2026-11-14', eventType: 'internal_exam', validation: 'needs_review' },
      { title: 'Last date to enter CIE marks', startDate: '2027-01-04', endDate: '2027-01-04', eventType: 'deadline', validation: 'needs_review' },
    ])
    expect(review.items.every((item) => item.warnings.includes('Year inferred from the academic-year heading; verify the date'))).toBe(true)
  })

  it('keeps wrapped event text with the spatially matching calendar entry', () => {
    const extraction = {
      sourceText: 'Academic Calendar 2026-27',
      pages: [{
        page: 1,
        text: 'Academic Calendar 2026-27',
        lines: [
          {
            page: 1,
            text: '11-15 Sep. Societal Project Group Formation and 14 Sep. Ganesha Chaturthi',
            segments: [
              { text: '11-15', x: 100, width: 60, height: 20 },
              { text: 'Sep.', x: 165, width: 40, height: 20 },
              { text: 'Societal', x: 210, width: 70, height: 20 },
              { text: 'Project', x: 285, width: 60, height: 20 },
              { text: 'Group', x: 350, width: 50, height: 20 },
              { text: 'Formation', x: 405, width: 90, height: 20 },
              { text: 'and', x: 500, width: 35, height: 20 },
              { text: '14', x: 700, width: 20, height: 20 },
              { text: 'Sep.', x: 725, width: 40, height: 20 },
              { text: 'Ganesha', x: 770, width: 75, height: 20 },
              { text: 'Chaturthi', x: 850, width: 80, height: 20 },
            ],
          },
          {
            page: 1,
            text: 'allotment of Guides',
            segments: [
              { text: 'allotment', x: 420, width: 80, height: 20 },
              { text: 'of', x: 505, width: 15, height: 20 },
              { text: 'Guides', x: 525, width: 55, height: 20 },
            ],
          },
        ],
        source: 'ocr' as const,
        ocrConfidence: 0.9,
      }],
    }
    const review = buildImportReview('academic_calendar', extraction)
    expect(review.items.map(({ title, startDate, endDate }) => ({ title, startDate, endDate }))).toEqual([
      { title: 'Societal Project Group Formation and allotment of Guides', startDate: '2026-09-11', endDate: '2026-09-15' },
      { title: 'Ganesha Chaturthi', startDate: '2026-09-14', endDate: '2026-09-14' },
    ])
    expect(review.items[0]?.description).toContain('allotment of Guides')
  })

  it('does not infer a year when no academic-year context exists', () => {
    const review = buildImportReview('academic_calendar', 'Ganesha Chaturthi 14 Sep')
    expect(review.items).toEqual([])
  })

  it('does not mistake a full ISO-style date for an academic-year range', () => {
    const review = buildImportReview('academic_calendar', 'Date 2026/10/02')
    expect(review.academicYear).toBeUndefined()
  })

  it('associates a description on an adjacent line with a dated calendar event', () => {
    const review = buildImportReview('academic_calendar', 'Synthetic Internal Examination\n2026-11-30')
    expect(review.items[0]).toMatchObject({
      title: 'Synthetic Internal Examination',
      startDate: '2026-11-30',
      eventType: 'internal_exam',
    })
  })

  it('does not classify unknown documents as calendars or timetables', () => {
    const review = buildImportReview('auto', 'A fictional campus memorandum with no dates or class schedule')
    expect(review.detectedDocumentType).toBe('unknown')
    expect(review.items).toEqual([])
  })

  it('detects a month-grid academic calendar without a readable title', () => {
    const review = buildImportReview(
      'auto',
      'January February March April May June July August September October November December 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31',
    )
    expect(review.detectedDocumentType).toBe('academic_calendar')
  })

  it('does not silently match ambiguous subject names', () => {
    expect(findSubjectMatch('Data Structures', [subject, { ...subject, id: 'subject-duplicate' }]))
      .toMatchObject({ state: 'ambiguous' })
  })

  it('matches unique timetable abbreviations but leaves ambiguous ones for review', () => {
    const subjects = [
      { ...subject, id: 'subject-maths', name: 'Program Specific Mathematics (MATHS)' },
      { ...subject, id: 'subject-os', name: 'Operating Systems (OS)' },
    ]
    expect(findSubjectMatch('MATHS', subjects)).toMatchObject({ state: 'matched', subjectId: 'subject-maths' })
    expect(findSubjectMatch('OS', subjects)).toMatchObject({ state: 'matched', subjectId: 'subject-os' })
    expect(findSubjectMatch('DS', [
      { ...subject, id: 'subject-data-structures', name: 'Data Structures' },
      { ...subject, id: 'subject-data-science', name: 'Data Science' },
    ])).toMatchObject({ state: 'ambiguous' })
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
