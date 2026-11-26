import { describe, expect, it } from 'vitest'
import type { StudentSemesterResult } from './models'
import {
  calculatePerformanceCGPA,
  calculatePerformanceSummary,
  calculateRequiredSGPA,
  predictCGPA,
  remainingSemesterNumbers,
} from './academicPerformance'

function result(
  semesterNumber: number,
  sgpa: number,
  totalCredits: number,
  status: StudentSemesterResult['status'] = 'completed',
): StudentSemesterResult {
  return {
    id: `result-${semesterNumber}`,
    semesterNumber,
    sgpa,
    totalCredits,
    status,
    createdAt: '',
    updatedAt: '',
  }
}

describe('semester performance calculations', () => {
  it('starts with no CGPA and excludes pending semesters', () => {
    expect(calculatePerformanceCGPA([], 'simple')).toBeNull()
    expect(calculatePerformanceCGPA([
      result(1, 9, 20),
      result(2, 2, 18, 'pending'),
      result(3, 10, 20, 'current'),
    ], 'simple')).toBe(9)
  })

  it('supports simple and credit-weighted CGPA with configured precision', () => {
    const completed = [result(1, 9, 20), result(2, 7, 10)]
    expect(calculatePerformanceCGPA(completed, 'simple')).toBe(8)
    expect(calculatePerformanceCGPA(completed, 'credit_weighted')).toBe(8.33)
    expect(calculatePerformanceCGPA(completed, 'simple', 1)).toBe(8)
  })

  it('rebuilds semester progression from completed results only', () => {
    const summary = calculatePerformanceSummary([
      result(1, 8, 20),
      result(2, 9, 20),
      result(3, 10, 20, 'current'),
    ], 'simple')
    expect(summary).toMatchObject({
      completedCount: 2,
      cgpa: 8.5,
      latestSGPA: 9,
      previousSGPA: 8,
      progressPercent: 25,
    })
    expect(summary.progression.map(({ semesterNumber, cgpa }) => ({ semesterNumber, cgpa }))).toEqual([
      { semesterNumber: 1, cgpa: 8 },
      { semesterNumber: 2, cgpa: 8.5 },
    ])
  })

  it('predicts future CGPA and handles weighted credits', () => {
    const completed = [result(1, 8, 20), result(2, 7, 10)]
    expect(predictCGPA(completed, 3, 9, 'simple')).toBe(8.63)
    expect(predictCGPA(completed, 3, 9, 'credit_weighted')).toBeNull()
    expect(predictCGPA(completed, 3, 9, 'credit_weighted', 20)).toBe(8.73)
  })

  it('calculates target SGPA and reports impossible targets or missing credits', () => {
    const completed = [result(1, 8, 20), result(2, 7, 10)]
    expect(calculateRequiredSGPA(completed, 3, 8.5, 'simple', 10)).toMatchObject({
      requiredSGPA: 8.83,
      possible: true,
    })
    expect(calculateRequiredSGPA(completed, 3, 9, 'credit_weighted', 10).reason)
      .toContain('Add credits')
    expect(calculateRequiredSGPA(completed, 3, 11, 'simple', 10)).toMatchObject({
      possible: false,
      reason: expect.stringContaining('exceeds'),
    })
  })

  it('includes the current and future semesters as remaining', () => {
    expect(remainingSemesterNumbers(3, [result(3, 8, 20, 'current'), result(4, 9, 20)]))
      .toEqual([3, 5, 6, 7, 8])
  })
})
