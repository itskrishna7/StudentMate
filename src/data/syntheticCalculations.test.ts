import { describe, expect, it } from 'vitest'
import { calculateAttendanceSummary, roundAttendance } from './attendance'
import { calculateAssessmentPercentage, calculateCGPA, calculateSGPA } from './grades'
import type { Assessment, AttendanceRecord, ClassSession, Mark } from './models'

const session = (id: string, status: ClassSession['status'] = 'conducted'): ClassSession => ({
  id, date: '2026-11-25', timetableRuleId: 'rule', subjectId: 'subject',
  status, notes: '', createdAt: '', updatedAt: '',
})

const record = (sessionId: string, status: AttendanceRecord['status']): AttendanceRecord => ({
  id: `${sessionId}-record`, sessionId, subjectId: 'subject', status,
  recordedAt: '2026-11-25T10:00:00.000Z', createdAt: '', updatedAt: '',
})

describe('synthetic real-world semester calculations', () => {
  it('counts extra and rescheduled lectures but excludes teacher absence, cancellation, and holiday', () => {
    const sessions = [
      ...Array.from({ length: 8 }, (_, index) => session(`normal-${index}`)),
      session('extra', 'conducted'),
      session('replacement', 'conducted'),
      session('teacher-absent', 'teacher_absent'),
      session('cancelled', 'cancelled'),
      session('holiday', 'holiday'),
    ]
    const records = [
      ...Array.from({ length: 6 }, (_, index) => record(`normal-${index}`, 'present')),
      ...Array.from({ length: 2 }, (_, index) => record(`normal-${index + 6}`, 'absent')),
      record('extra', 'extra'),
      record('replacement', 'rescheduled'),
    ]
    const summary = calculateAttendanceSummary(sessions, records, 75)
    expect(summary.attended).toBe(8)
    expect(summary.absent).toBe(2)
    expect(summary.conducted).toBe(10)
    expect(summary.exactPercentage).toBe(80)
    expect(summary.displayPercentage).toBe(80)
  })

  it('calculates manually expected subject and overall attendance percentages', () => {
    const subjects = [
      { name: 'DS', attended: 8, conducted: 10, target: 75 },
      { name: 'MA', attended: 7, conducted: 8, target: 75 },
      { name: 'PHY', attended: 6, conducted: 8, target: 80 },
      { name: 'DB', attended: 8, conducted: 8, target: 85 },
      { name: 'OS', attended: 5, conducted: 8, target: 75 },
      { name: 'VLSI', attended: 7, conducted: 8, target: 85 },
    ]
    const percentages = subjects.map((subject) => ({
      name: subject.name,
      percentage: roundAttendance(subject.attended, subject.conducted),
    }))
    expect(percentages).toEqual([
      { name: 'DS', percentage: 80 },
      { name: 'MA', percentage: 88 },
      { name: 'PHY', percentage: 75 },
      { name: 'DB', percentage: 100 },
      { name: 'OS', percentage: 63 },
      { name: 'VLSI', percentage: 88 },
    ])
    const attended = subjects.reduce((sum, subject) => sum + subject.attended, 0)
    const conducted = subjects.reduce((sum, subject) => sum + subject.conducted, 0)
    expect(roundAttendance(attended, conducted)).toBe(82)
  })

  it('calculates manually expected assessment, SGPA, and CGPA values', () => {
    const assessments: Assessment[] = [
      { id: 'ds-q', subjectId: 'ds', name: 'Quiz', type: 'quiz', maxMarks: 20, weight: 20, createdAt: '', updatedAt: '' },
      { id: 'ds-m', subjectId: 'ds', name: 'Mid', type: 'mid_semester', maxMarks: 100, weight: 30, createdAt: '', updatedAt: '' },
      { id: 'ds-a', subjectId: 'ds', name: 'Assignment', type: 'assignment', maxMarks: 50, weight: 20, createdAt: '', updatedAt: '' },
      { id: 'ds-p', subjectId: 'ds', name: 'Practical', type: 'practical', maxMarks: 30, weight: 30, createdAt: '', updatedAt: '' },
    ]
    const marks: Mark[] = [
      { id: 'm1', assessmentId: 'ds-q', subjectId: 'ds', marksObtained: 18, enteredAt: '', createdAt: '', updatedAt: '' },
      { id: 'm2', assessmentId: 'ds-m', subjectId: 'ds', marksObtained: 70, enteredAt: '', createdAt: '', updatedAt: '' },
      { id: 'm3', assessmentId: 'ds-a', subjectId: 'ds', marksObtained: 45, enteredAt: '', createdAt: '', updatedAt: '' },
      { id: 'm4', assessmentId: 'ds-p', subjectId: 'ds', marksObtained: 27, enteredAt: '', createdAt: '', updatedAt: '' },
    ]
    expect(calculateAssessmentPercentage(assessments, marks)).toBe(84)

    const sgpa = calculateSGPA([
      { credits: 4, gradePoint: 9 },
      { credits: 3, gradePoint: 8 },
      { credits: 3, gradePoint: 7 },
      { credits: 2, gradePoint: 10 },
      { credits: 4, gradePoint: 9 },
      { credits: 3, gradePoint: 10 },
    ], 2)
    expect(sgpa).toBe(8.79)
    expect(calculateCGPA([
      { sgpa: 9, credits: 20 },
      { sgpa: 8.79, credits: 19 },
    ], 2)).toBe(8.90)
  })

  it('returns safe values for missing marks and zero conducted classes', () => {
    expect(calculateSGPA([])).toBe(0)
    expect(calculateCGPA([])).toBe(0)
    expect(calculateAssessmentPercentage([], [])).toBe(0)
    expect(calculateAttendanceSummary([], [], 75).exactPercentage).toBe(0)
  })
})
