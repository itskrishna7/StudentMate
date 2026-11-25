import { afterEach, describe, expect, it } from 'vitest'
import { StudentMateDatabase } from './database'
import { requireDate, requireNonEmpty, requireRange } from './validation'
import { archiveSubject, deleteSubject, saveSemester, saveSubject } from './academicRepositories'
import { db } from './database'
import { findCalendarConflicts, findTimetableOverlap, saveCalendarEvent, saveTimetableRule } from './timetableCalendar'

const databases: StudentMateDatabase[] = []

function testDatabase() {
  const database = new StudentMateDatabase(`StudentMateTest-${crypto.randomUUID()}`)
  databases.push(database)
  return database
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()))
})

describe('StudentMate database', () => {
  it('creates all normalized stores in schema version 1', async () => {
    const database = testDatabase()
    await database.open()

    expect(database.verno).toBe(1)
    expect(database.tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      'semesters',
      'subjects',
      'timetableRules',
      'calendarEvents',
      'classSessions',
      'attendanceRecords',
      'attendanceChangeLog',
      'scheduleChangeLog',
      'assessments',
      'marks',
      'gradingScales',
      'appSettings',
      'importJobs',
    ]))
  })

  it('preserves subject archival and separate session records', async () => {
    const database = testDatabase()
    await database.open()

    await database.subjects.add({
      id: 'subject-1',
      semesterId: 'semester-1',
      name: 'Computer Science',
      code: 'CS101',
      facultyName: 'Faculty',
      credits: 4,
      kind: 'theory',
      attendanceTarget: 75,
      color: '#4f46e5',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await database.subjects.update('subject-1', { archived: true })

    expect((await database.subjects.get('subject-1'))?.archived).toBe(true)
  })
})

describe('database input validation', () => {
  it('rejects empty names, invalid dates, and out-of-range values', () => {
    expect(() => requireNonEmpty('  ', 'Name')).toThrow('Name is required')
    expect(() => requireDate('2026-99-99', 'Date')).toThrow('valid date')
    expect(() => requireRange(101, 0, 100, 'Percentage')).toThrow('between 0 and 100')
  })
})

describe('semester and subject repositories', () => {
  afterEach(async () => {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()))
    })
  })

  describe('timetable and calendar repositories', () => {
    afterEach(async () => {
      await db.transaction('rw', db.tables, async () => {
        await Promise.all(db.tables.map((table) => table.clear()))
      })
    })

    it('detects overlapping timetable entries', () => {
      const existing = {
        id: 'rule-1',
        subjectId: 'subject-1',
        weekday: 1,
        startTime: '09:00',
        endTime: '10:00',
        facultyName: '',
        room: '',
        kind: 'lecture' as const,
        recurring: true,
        startDate: '2026-07-01',
        active: true,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      }
      const overlap = findTimetableOverlap({
        subjectId: 'subject-2',
        weekday: 1,
        startTime: '09:30',
        endTime: '10:30',
        facultyName: '',
        room: '',
        kind: 'lecture',
        recurring: true,
        startDate: '2026-07-01',
        active: true,
      }, [existing])

      expect(overlap?.id).toBe('rule-1')
    })

    it('detects academic event conflicts without changing class sessions', async () => {
      await saveCalendarEvent({
        title: 'College Holiday',
        type: 'holiday',
        startDate: '2026-10-02',
        endDate: '2026-10-02',
        recurring: true,
        notes: '',
      })

      const conflicts = await findCalendarConflicts('2026-10-02')
      expect(conflicts.map((event) => event.title)).toContain('College Holiday')
    })

    it('rejects invalid timetable time ranges', async () => {
      await expect(saveTimetableRule({
        subjectId: 'missing',
        weekday: 1,
        startTime: '11:00',
        endTime: '10:00',
        facultyName: '',
        room: '',
        kind: 'lecture',
        recurring: true,
        startDate: '2026-07-01',
        active: true,
      })).rejects.toThrow('End time must be after start time')
    })
  })

  it('creates a current semester and subject', async () => {
    const semester = await saveSemester({
      name: 'Semester 1',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      isCurrent: true,
    })
    const subject = await saveSubject({
      semesterId: semester.id,
      name: 'Programming',
      code: 'CS101',
      facultyName: 'Dr. Smith',
      credits: 4,
      kind: 'theory',
      attendanceTarget: 75,
      color: '#4f46e5',
      archived: false,
    })

    expect(subject.name).toBe('Programming')
    expect((await db.semesters.get(semester.id))?.isCurrent).toBe(true)
  })

  it('archives subjects and refuses deletion with historical references', async () => {
    const semester = await saveSemester({
      name: 'Semester 2',
      startDate: '2027-01-01',
      endDate: '2027-05-31',
      isCurrent: true,
    })
    const subject = await saveSubject({
      semesterId: semester.id,
      name: 'Database Systems',
      code: 'DB201',
      facultyName: '',
      credits: 3,
      kind: 'practical',
      attendanceTarget: 80,
      color: '#059669',
      archived: false,
    })

    await db.classSessions.add({
      id: 'session-1',
      date: '2027-01-10',
      timetableRuleId: 'rule-1',
      subjectId: subject.id,
      status: 'conducted',
      notes: '',
      createdAt: '2027-01-10T00:00:00.000Z',
      updatedAt: '2027-01-10T00:00:00.000Z',
    })
    await archiveSubject(subject.id)

    expect((await db.subjects.get(subject.id))?.archived).toBe(true)
    expect(await deleteSubject(subject.id)).toBe('blocked')
    expect(await db.subjects.get(subject.id)).toBeDefined()
  })
})
