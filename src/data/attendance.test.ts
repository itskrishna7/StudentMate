import { describe, expect, it } from 'vitest'
import { calculateAttendanceSummary, countsForAttendance, roundAttendance } from './attendance'
import type { AttendanceRecord, ClassSession } from './models'

const makeSession = (id: string, status: ClassSession['status'] = 'conducted', rescheduledFromId?: string): ClassSession => ({
  id,
  date: '2026-10-01',
  timetableRuleId: 'rule',
  subjectId: 'subject',
  status,
  ...(rescheduledFromId ? { rescheduledFromId } : {}),
  notes: '',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
})

const makeRecord = (sessionId: string, status: AttendanceRecord['status']): AttendanceRecord => ({
  id: `record-${sessionId}`,
  sessionId,
  subjectId: 'subject',
  status,
  recordedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
})

describe('attendance calculations', () => {
  it('handles a large attendance history without changing exact values', () => {
    const sessions = Array.from({ length: 5000 }, (_, index) => makeSession(`large-${index}`))
    const records = Array.from({ length: 5000 }, (_, index) =>
      makeRecord(`large-${index}`, index % 4 === 0 ? 'absent' : 'present'))
    const summary = calculateAttendanceSummary(sessions, records, 75)
    expect(summary.conducted).toBe(5000)
    expect(summary.attended).toBe(3750)
    expect(summary.absent).toBe(1250)
    expect(summary.displayPercentage).toBe(75)
  })
  it('handles zero conducted classes, 100 percent, and 0 percent', () => {
    const noClasses = calculateAttendanceSummary([], [], 75)
    expect(noClasses.conducted).toBe(0)
    expect(noClasses.displayPercentage).toBe(0)

    const fullSessions = Array.from({ length: 100 }, (_, index) => makeSession(String(index)))
    const fullRecords = fullSessions.map((session) => makeRecord(session.id, 'present'))
    expect(calculateAttendanceSummary(fullSessions, fullRecords, 75).displayPercentage).toBe(100)

    const absentRecords = fullSessions.map((session) => makeRecord(session.id, 'absent'))
    expect(calculateAttendanceSummary(fullSessions, absentRecords, 75).displayPercentage).toBe(0)
  })
  it('rounds display percentages below and at .5 correctly', () => {
    expect(roundAttendance(1, 8)).toBe(13)
    expect(roundAttendance(1, 12)).toBe(8)
    expect(roundAttendance(6, 12)).toBe(50)
  })

  it('excludes teacher absence, cancellation, holiday, and unrecorded sessions', () => {
    const sessions = [
      makeSession('1'),
      makeSession('2', 'teacher_absent'),
      makeSession('3', 'cancelled'),
      makeSession('4', 'holiday'),
    ]
    const records = [makeRecord('1', 'present')]
    expect(countsForAttendance(sessions, records)).toEqual({ attended: 1, absent: 0, conducted: 1 })
  })

  it('counts present and absent but excludes the original of a rescheduled class', () => {
    const sessions = [
      makeSession('original', 'cancelled'),
      makeSession('replacement', 'conducted'),
    ]
    const records = [makeRecord('replacement', 'present')]
    expect(countsForAttendance(sessions, records)).toEqual({ attended: 1, absent: 0, conducted: 1 })
  })

  it('calculates bunk and required-class projections from exact values', () => {
    const sessions = [makeSession('1'), makeSession('2'), makeSession('3'), makeSession('4')]
    const records = [
      makeRecord('1', 'present'),
      makeRecord('2', 'present'),
      makeRecord('3', 'present'),
      makeRecord('4', 'absent'),
    ]
    const summary = calculateAttendanceSummary(sessions, records, 75)
    expect(summary.exactPercentage).toBe(75)
    expect(summary.displayPercentage).toBe(75)
    expect(summary.maxBunk).toBe(0)
    expect(summary.classesRequired).toBe(0)
  })

  it('uses exact underlying attendance for required classes', () => {
    const sessions = [makeSession('1'), makeSession('2'), makeSession('3')]
    const records = [makeRecord('1', 'present'), makeRecord('2', 'present'), makeRecord('3', 'absent')]
    const summary = calculateAttendanceSummary(sessions, records, 75)
    expect(summary.exactPercentage).toBeCloseTo(66.6666667)
    expect(summary.displayPercentage).toBe(67)
    expect(summary.classesRequired).toBe(1)
  })

  it('allows extra and rescheduled attendance records to count when conducted', () => {
    const sessions = [makeSession('1'), makeSession('2')]
    const records = [makeRecord('1', 'extra'), makeRecord('2', 'rescheduled')]
    expect(countsForAttendance(sessions, records)).toEqual({ attended: 2, absent: 0, conducted: 2 })
  })
})
