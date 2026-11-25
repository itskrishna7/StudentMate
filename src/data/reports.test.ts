import { describe, expect, it } from 'vitest'
import { calculateAssessmentPercentage } from './grades'
import { calculateAttendanceSummary } from './attendance'
import type { Assessment, AttendanceRecord, ClassSession, Mark } from './models'
import { neutralizeCsvFormula } from './reports'

describe('analytics report inputs', () => {
  it('neutralizes spreadsheet formula prefixes in CSV values', () => {
    expect(neutralizeCsvFormula('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(neutralizeCsvFormula('+cmd')).toBe("'+cmd")
    expect(neutralizeCsvFormula('Data\r=WEBSERVICE("example")')).toBe('Data =WEBSERVICE("example")')
    expect(neutralizeCsvFormula('Data Structures')).toBe('Data Structures')
  })
  it('uses exact attendance values for report summaries', () => {
    const sessions: ClassSession[] = [
      { id: '1', date: '2026-10-01', timetableRuleId: 'r', subjectId: 's', status: 'conducted', notes: '', createdAt: '', updatedAt: '' },
      { id: '2', date: '2026-10-02', timetableRuleId: 'r', subjectId: 's', status: 'conducted', notes: '', createdAt: '', updatedAt: '' },
      { id: '3', date: '2026-10-03', timetableRuleId: 'r', subjectId: 's', status: 'cancelled', notes: '', createdAt: '', updatedAt: '' },
    ]
    const records: AttendanceRecord[] = [
      { id: 'a', sessionId: '1', subjectId: 's', status: 'present', recordedAt: '', createdAt: '', updatedAt: '' },
      { id: 'b', sessionId: '2', subjectId: 's', status: 'absent', recordedAt: '', createdAt: '', updatedAt: '' },
    ]
    const summary = calculateAttendanceSummary(sessions, records, 75)
    expect(summary.conducted).toBe(2)
    expect(summary.exactPercentage).toBe(50)
  })

  it('reports weighted academic performance', () => {
    const assessments: Assessment[] = [
      { id: 'q', subjectId: 's', name: 'Quiz', type: 'quiz', maxMarks: 10, weight: 30, createdAt: '', updatedAt: '' },
      { id: 'm', subjectId: 's', name: 'Mid', type: 'mid_semester', maxMarks: 100, weight: 70, createdAt: '', updatedAt: '' },
    ]
    const marks: Mark[] = [
      { id: 'mq', assessmentId: 'q', subjectId: 's', marksObtained: 8, enteredAt: '', createdAt: '', updatedAt: '' },
      { id: 'mm', assessmentId: 'm', subjectId: 's', marksObtained: 70, enteredAt: '', createdAt: '', updatedAt: '' },
    ]
    expect(calculateAssessmentPercentage(assessments, marks)).toBe(73)
  })
})
