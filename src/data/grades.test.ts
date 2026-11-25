import { describe, expect, it } from 'vitest'
import {
  calculateAssessmentPercentage,
  calculateCGPA,
  calculateSGPA,
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

  it('maps percentages to the correct configurable grade boundary', () => {
    const scale = [
      { minPercentage: 90, gradePoint: 10, label: 'O', pass: true },
      { minPercentage: 75, gradePoint: 8, label: 'A', pass: true },
      { minPercentage: 0, gradePoint: 0, label: 'F', pass: false },
    ]
    expect(gradePointForPercentage(92, scale)?.label).toBe('O')
    expect(gradePointForPercentage(80, scale)?.label).toBe('A')
  })

  it('calculates marks required in remaining assessed work', () => {
    expect(requiredMarks(60, 75, 40)).toBe(37.5)
  })

  it('rejects invalid SGPA inputs', () => {
    expect(() => calculateSGPA([{ credits: -1, gradePoint: 10 }])).toThrow('cannot be negative')
  })
})
