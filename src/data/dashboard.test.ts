import { afterEach, describe, expect, it } from 'vitest'
import { db } from './database'
import { loadDashboardData } from './dashboard'

afterEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
})

describe('dashboard aggregation', () => {
  it('handles an empty database gracefully', async () => {
    const dashboard = await loadDashboardData(new Date('2026-11-25T12:00:00'))
    expect(dashboard.currentSemester).toBeNull()
    expect(dashboard.activeSubjectCount).toBe(0)
    expect(dashboard.overallAttendance).toBe(0)
    expect(dashboard.todayLectures).toEqual([])
  })

  it('aggregates current semester subjects and different targets', async () => {
    await db.semesters.add({
      id: 'semester-1',
      name: 'Semester 1',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      isCurrent: true,
      createdAt: '',
      updatedAt: '',
    })
    await db.subjects.bulkAdd([
      {
        id: 'subject-a',
        semesterId: 'semester-1',
        name: 'Data Structures',
        code: 'DS',
        facultyName: '',
        credits: 4,
        kind: 'theory',
        attendanceTarget: 75,
        color: '#4f46e5',
        archived: false,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'subject-b',
        semesterId: 'semester-1',
        name: 'Physics',
        code: 'PHY',
        facultyName: '',
        credits: 3,
        kind: 'theory',
        attendanceTarget: 85,
        color: '#059669',
        archived: false,
        createdAt: '',
        updatedAt: '',
      },
    ])
    await db.classSessions.bulkAdd([
      {
        id: 'session-a',
        date: '2026-11-24',
        timetableRuleId: 'rule-a',
        subjectId: 'subject-a',
        status: 'conducted',
        notes: '',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'session-b',
        date: '2026-11-24',
        timetableRuleId: 'rule-b',
        subjectId: 'subject-b',
        status: 'teacher_absent',
        notes: '',
        createdAt: '',
        updatedAt: '',
      },
    ])
    await db.attendanceRecords.add({
      id: 'record-a',
      sessionId: 'session-a',
      subjectId: 'subject-a',
      status: 'present',
      recordedAt: '2026-11-24T10:00:00.000Z',
      createdAt: '',
      updatedAt: '',
    })

    const dashboard = await loadDashboardData(new Date('2026-11-25T12:00:00'))
    expect(dashboard.currentSemester?.name).toBe('Semester 1')
    expect(dashboard.activeSubjectCount).toBe(2)
    expect(dashboard.overallAttendance).toBe(100)
    expect(dashboard.subjectAttendance.find((item) => item.subjectId === 'subject-b')?.conducted).toBe(0)
  })

  it('finds today lectures, upcoming exams, and missed-target subjects', async () => {
    await db.subjects.add({
      id: 'subject-a',
      semesterId: 'semester-1',
      name: 'Algorithms',
      code: 'ALG',
      facultyName: '',
      credits: 4,
      kind: 'theory',
      attendanceTarget: 75,
      color: '#4f46e5',
      archived: false,
      createdAt: '',
      updatedAt: '',
    })
    await db.timetableRules.add({
      id: 'rule-a',
      subjectId: 'subject-a',
      weekday: 3,
      startTime: '09:00',
      endTime: '10:00',
      facultyName: '',
      room: 'A101',
      kind: 'lecture',
      recurring: true,
      startDate: '2026-07-01',
      active: true,
      createdAt: '',
      updatedAt: '',
    })
    await db.calendarEvents.add({
      id: 'exam-a',
      title: 'Data Structures Exam',
      type: 'exam',
      startDate: '2026-11-30',
      endDate: '2026-11-30',
      recurring: false,
      notes: '',
      createdAt: '',
      updatedAt: '',
    })
    await db.classSessions.bulkAdd([
      { id: 'present', date: '2026-11-01', timetableRuleId: 'old', subjectId: 'subject-a', status: 'conducted', notes: '', createdAt: '', updatedAt: '' },
      { id: 'absent', date: '2026-11-02', timetableRuleId: 'old', subjectId: 'subject-a', status: 'conducted', notes: '', createdAt: '', updatedAt: '' },
    ])
    await db.attendanceRecords.bulkAdd([
      { id: 'present-record', sessionId: 'present', subjectId: 'subject-a', status: 'present', recordedAt: '2026-11-01T10:00:00.000Z', createdAt: '', updatedAt: '' },
      { id: 'absent-record', sessionId: 'absent', subjectId: 'subject-a', status: 'absent', recordedAt: '2026-11-02T10:00:00.000Z', createdAt: '', updatedAt: '' },
    ])

    const dashboard = await loadDashboardData(new Date('2026-11-25T12:00:00'))
    expect(dashboard.todayLectures).toHaveLength(1)
    expect(dashboard.upcomingExaminations[0]?.title).toBe('Data Structures Exam')
    expect(dashboard.belowTargetSubjects[0]?.subjectId).toBe('subject-a')
  })
})
