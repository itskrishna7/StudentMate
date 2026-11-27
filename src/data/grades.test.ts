import { describe, expect, it } from 'vitest'
import {
  calculateAssessmentPercentage,
  calculateCGPA,
  calculateSGPA,
  gradeForSubjectPercentage,
  gradePointForPercentage,
  requiredMarks,
} from './grades'
import type { Assessment, Mark } from './models'

describe('academic calculations', () => {
  it('calculates weighted SGPA with configurable credits and grade points', () => {
    expect(calculateSGPA([
      { credits: 4, gradePoint: 10 },
      { credits: 2, gradePoint: 8 },
    ])).toBe(9.33)
  })

  it('calculates weighted CGPA across semesters', () => {
    expect(calculateCGPA([
      { sgpa: 9, credits: 20 },
      { sgpa: 8, credits: 20 },
    ])).toBe(8.5)
  })

  it('calculates weighted assessment percentages only from entered marks', () => {
    const assessments: Assessment[] = [
      { id: 'a1', subjectId: 's', name: 'Quiz', type: 'quiz', maxMarks: 20, weight: 20, createdAt: '', updatedAt: '' },
      { id: 'a2', subjectId: 's', name: 'Mid', type: 'mid_semester', maxMarks: 100, weight: 80, createdAt: '', updatedAt: '' },
    ]
    const marks: Mark[] = [
      { id: 'm1', assessmentId: 'a1', subjectId: 's', marksObtained: 15, enteredAt: '', createdAt: '', updatedAt: '' },
    ]
    expect(calculateAssessmentPercentage(assessments, marks)).toBe(75)
  })

  it('applies total, average, best-of-N, and assessment-weighted rules to completed marks only', () => {
    const assessments: Assessment[] = [
      { id: 'a1', subjectId: 's', name: 'Assignment', type: 'assignment', maxMarks: 10, weight: 1, createdAt: '', updatedAt: '' },
      { id: 'a2', subjectId: 's', name: 'Quiz', type: 'quiz', maxMarks: 20, weight: 3, createdAt: '', updatedAt: '' },
      { id: 'a3', subjectId: 's', name: 'Midterm', type: 'mid_semester', maxMarks: 25, weight: 6, createdAt: '', updatedAt: '' },
    ]
    const marks: Mark[] = [
      { id: 'm1', assessmentId: 'a1', subjectId: 's', marksObtained: 8, enteredAt: '', createdAt: '', updatedAt: '' },
      { id: 'm2', assessmentId: 'a2', subjectId: 's', marksObtained: 15, enteredAt: '', createdAt: '', updatedAt: '' },
    ]
    const scheme = {
      calculationMethod: 'average' as const,
      passingPercentage: 40,
      decimalPrecision: 2,
      boundaries: [{ minPercentage: 0, gradePoint: 0, label: 'F', pass: false }],
    }

    expect(calculateAssessmentPercentage(assessments, marks, { ...scheme, calculationMethod: 'total' })).toBeCloseTo(76.67, 2)
    expect(calculateAssessmentPercentage(assessments, marks, scheme)).toBe(77.5)
    expect(calculateAssessmentPercentage(assessments, marks, {
      ...scheme,
      calculationMethod: 'best_of',
      bestOfCount: 1,
    })).toBe(80)
    expect(calculateAssessmentPercentage(assessments, marks, { ...scheme, calculationMethod: 'weighted' })).toBe(76.25)
  })

  it('combines internal and external component results using configured weightages', () => {
    const assessments: Assessment[] = [
      { id: 'internal', subjectId: 's', name: 'Internal', type: 'other', category: 'Internal assessment', maxMarks: 10, weight: 0, createdAt: '', updatedAt: '' },
      { id: 'external', subjectId: 's', name: 'External', type: 'other', category: 'External examination', maxMarks: 20, weight: 0, createdAt: '', updatedAt: '' },
    ]
    const marks: Mark[] = [
      { id: 'mi', assessmentId: 'internal', subjectId: 's', marksObtained: 8, enteredAt: '', createdAt: '', updatedAt: '' },
      { id: 'me', assessmentId: 'external', subjectId: 's', marksObtained: 15, enteredAt: '', createdAt: '', updatedAt: '' },
    ]
    const scheme = {
      calculationMethod: 'total' as const,
      internalWeightage: 40,
      externalWeightage: 60,
      passingPercentage: 40,
      decimalPrecision: 2,
      boundaries: [{ minPercentage: 0, gradePoint: 0, label: 'F', pass: false }],
    }

    expect(calculateAssessmentPercentage(assessments, marks, scheme)).toBe(77)
    expect(calculateAssessmentPercentage(assessments, [marks[0]!], scheme)).toBe(80)
  })

  it('maps percentages to the correct configurable grade boundary', () => {
    const scale = [
      { minPercentage: 90, gradePoint: 10, label: 'O', pass: true },
      { minPercentage: 75, gradePoint: 8, label: 'A', pass: true },
      { minPercentage: 0, gradePoint: 0, label: 'F', pass: false },
    ]
    expect(gradePointForPercentage(92, scale)?.label).toBe('O')
    expect(gradePointForPercentage(80, scale)?.label).toBe('A')
  })

  it('uses configured passing marks and component maxima to enforce the failing grade', () => {
    const scale = [
      { minPercentage: 40, gradePoint: 5, label: 'P', pass: true },
      { minPercentage: 0, gradePoint: 0, label: 'F', pass: false },
    ]
    const scheme = {
      calculationMethod: 'total' as const,
      internalMaxMarks: 50,
      externalMaxMarks: 50,
      passingMarks: 40,
      passingPercentage: 40,
      decimalPrecision: 2,
      boundaries: scale,
    }

    expect(gradeForSubjectPercentage(35, scale, scheme)?.label).toBe('F')
    expect(gradeForSubjectPercentage(55, scale, scheme)?.label).toBe('P')
  })

  it('calculates marks required in remaining assessed work', () => {
    expect(requiredMarks(60, 75, 40)).toBe(37.5)
  })

  it('rejects invalid SGPA inputs', () => {
    expect(() => calculateSGPA([{ credits: -1, gradePoint: 10 }])).toThrow('cannot be negative')
  })
})
