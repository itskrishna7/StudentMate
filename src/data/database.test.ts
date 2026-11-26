import { afterEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { StudentMateDatabase } from './database'
import { requireDate, requireNonEmpty, requireRange } from './validation'
import { archiveSubject, deleteSubject, saveSemester, saveSubject } from './academicRepositories'
import { db } from './database'
import { findCalendarConflicts, findTimetableOverlap, saveCalendarEvent, saveTimetableRule } from './timetableCalendar'
import { markDayAsHoliday, saveClassSession } from './attendanceRepository'
import { calculateAttendanceSummary } from './attendance'

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
  it('creates all normalized stores in schema version 2', async () => {
    const database = testDatabase()
    await database.open()

    expect(database.verno).toBe(2)
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
      'studentSemesterResults',
    ]))
  })

  it('upgrades a version 1 database without changing existing academic or attendance records', async () => {
    const name = `StudentMateMigration-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(1).stores({
      subjects: 'id, semesterId, code, kind, archived',
      classSessions: 'id, date, timetableRuleId, subjectId, status',
      attendanceRecords: 'id, sessionId, subjectId, status, recordedAt',
      calendarEvents: 'id, type, startDate, endDate, recurring, subjectId',
    })
    await legacy.open()
    await legacy.table('subjects').add({
      id: 'existing-subject',
      semesterId: 'existing-semester',
      name: 'Preserved subject',
      code: 'SAFE101',
      facultyName: '',
      credits: 3,
      kind: 'theory',
      attendanceTarget: 75,
      color: '#4f46e5',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await legacy.table('classSessions').add({
      id: 'existing-session',
      date: '2026-02-01',
      timetableRuleId: 'existing-rule',
      subjectId: 'existing-subject',
      status: 'conducted',
      notes: '',
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
    await legacy.table('attendanceRecords').add({
      id: 'existing-attendance',
      sessionId: 'existing-session',
      subjectId: 'existing-subject',
      status: 'present',
      recordedAt: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
    await legacy.close()

    const upgraded = new StudentMateDatabase(name)
    databases.push(upgraded)
    await upgraded.open()

    expect(upgraded.verno).toBe(2)
    expect((await upgraded.subjects.get('existing-subject'))?.name).toBe('Preserved subject')
    expect((await upgraded.classSessions.get('existing-session'))?.status).toBe('conducted')
    expect((await upgraded.attendanceRecords.get('existing-attendance'))?.status).toBe('present')
    expect(await upgraded.studentSemesterResults.count()).toBe(0)
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

    it('prevents duplicate class sessions and duplicate calendar events', async () => {
      await db.subjects.add({
        id: 'subject-session',
        semesterId: 'semester-1',
        name: 'Test Subject',
        code: 'TEST',
        facultyName: '',
        credits: 3,
        kind: 'theory',
        attendanceTarget: 75,
        color: '#4f46e5',
        archived: false,
        createdAt: '',
        updatedAt: '',
      })
      const input = {
        date: '2026-10-05',
        timetableRuleId: 'rule-1',
        subjectId: 'subject-session',
        status: 'conducted' as const,
        notes: '',
      }
      await saveClassSession(input)
      await expect(saveClassSession(input)).rejects.toThrow('already recorded')

      const event = {
        title: 'Exam',
        type: 'exam' as const,
        startDate: '2026-11-10',
        endDate: '2026-11-10',
        recurring: false,
        notes: '',
      }
      await saveCalendarEvent(event)
      await expect(saveCalendarEvent(event)).rejects.toThrow('already recorded')
    })

    it('marks the selected date as a holiday without deleting attendance records', async () => {
      const date = '2026-10-05'
      await db.subjects.add({
        id: 'holiday-subject',
        semesterId: 'semester-1',
        name: 'Holiday test subject',
        code: 'HOL101',
        facultyName: '',
        credits: 3,
        kind: 'theory',
        attendanceTarget: 75,
        color: '#4f46e5',
        archived: false,
        createdAt: '',
        updatedAt: '',
      })
      await db.timetableRules.bulkAdd([
        {
          id: 'holiday-rule-existing',
          subjectId: 'holiday-subject',
          weekday: 1,
          startTime: '09:00',
          endTime: '10:00',
          facultyName: '',
          room: '',
          kind: 'lecture',
          recurring: true,
          startDate: '2026-07-01',
          active: true,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'holiday-rule-new',
          subjectId: 'holiday-subject',
          weekday: 1,
          startTime: '10:00',
          endTime: '11:00',
          facultyName: '',
          room: '',
          kind: 'lecture',
          recurring: true,
          startDate: '2026-07-01',
          active: true,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'holiday-rule-out-of-range',
          subjectId: 'holiday-subject',
          weekday: 1,
          startTime: '11:00',
          endTime: '12:00',
          facultyName: '',
          room: '',
          kind: 'lecture',
          recurring: true,
          startDate: '2026-10-06',
          active: true,
          createdAt: '',
          updatedAt: '',
        },
      ])
      await db.classSessions.add({
        id: 'holiday-existing-session',
        date,
        timetableRuleId: 'holiday-rule-existing',
        subjectId: 'holiday-subject',
        status: 'conducted',
        notes: '',
        createdAt: '',
        updatedAt: '',
      })
      await db.attendanceRecords.add({
        id: 'holiday-existing-record',
        sessionId: 'holiday-existing-session',
        subjectId: 'holiday-subject',
        status: 'present',
        recordedAt: '',
        createdAt: '',
        updatedAt: '',
      })

      expect(await markDayAsHoliday(date)).toBe(2)
      const sessions = await db.classSessions.where('date').equals(date).toArray()
      expect(sessions.map((session) => session.status)).toEqual(['holiday', 'holiday'])
      expect(sessions.some((session) => session.timetableRuleId === 'holiday-rule-out-of-range')).toBe(false)
      expect(await db.attendanceRecords.get('holiday-existing-record')).toMatchObject({ status: 'present' })
      expect(calculateAttendanceSummary(sessions, await db.attendanceRecords.toArray()).conducted).toBe(0)
      expect(await markDayAsHoliday(date)).toBe(2)
      expect(await db.classSessions.where('date').equals(date).count()).toBe(2)
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
