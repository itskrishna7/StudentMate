import type { Assessment, GradeBoundary, Mark, Semester, Subject } from './models'

export interface SemesterGrade {
  sgpa: number
  totalCredits: number
}

export function gradePointForPercentage(
  percentage: number,
  scale: GradeBoundary[],
): GradeBoundary | undefined {
  return [...scale]
    .sort((a, b) => b.minPercentage - a.minPercentage)
    .find((boundary) => percentage >= boundary.minPercentage)
}

export function calculateSGPA(
  entries: Array<{ credits: number; gradePoint: number }>,
  precision = 2,
): number {
  if (!entries.length) return 0
  if (entries.some((entry) => entry.credits < 0 || entry.gradePoint < 0)) {
    throw new Error('Credits and grade points cannot be negative')
  }
  const totalCredits = entries.reduce((sum, entry) => sum + entry.credits, 0)
  if (totalCredits === 0) return 0
  const value = entries.reduce((sum, entry) => sum + entry.credits * entry.gradePoint, 0) / totalCredits
  return Number(value.toFixed(precision))
}

export function calculateCGPA(
  semesters: Array<{ sgpa: number; credits: number }>,
  precision = 2,
): number {
  if (!semesters.length) return 0
  if (semesters.some((semester) => semester.sgpa < 0 || semester.credits < 0)) {
    throw new Error('SGPA and semester credits cannot be negative')
  }
  const totalCredits = semesters.reduce((sum, semester) => sum + semester.credits, 0)
  if (totalCredits === 0) return 0
  const value = semesters.reduce((sum, semester) => sum + semester.sgpa * semester.credits, 0) / totalCredits
  return Number(value.toFixed(precision))
}

export function calculateAssessmentPercentage(
  assessmentRows: Assessment[],
  markRows: Mark[],
): number {
  if (!assessmentRows.length) return 0
  const weighted = assessmentRows.reduce((sum, assessment) => {
    const mark = markRows.find((item) => item.assessmentId === assessment.id)
    if (!mark) return sum
    if (assessment.maxMarks <= 0 || assessment.weight < 0) {
      throw new Error('Assessment maximum marks and weight must be valid')
    }
    return sum + (mark.marksObtained / assessment.maxMarks) * assessment.weight
  }, 0)
  const enteredWeight = assessmentRows.reduce((sum, assessment) => {
    const hasMark = markRows.some((mark) => mark.assessmentId === assessment.id)
    return sum + (hasMark ? assessment.weight : 0)
  }, 0)
  return enteredWeight === 0 ? 0 : (weighted / enteredWeight) * 100
}

export function requiredMarks(
  currentPercentage: number,
  targetPercentage: number,
  remainingWeight: number,
): number {
  if (remainingWeight <= 0) return 0
  if (currentPercentage < 0 || targetPercentage < 0 || targetPercentage > 100) {
    throw new Error('Percentages must be between 0 and 100')
  }
  return Math.max(0, (targetPercentage - currentPercentage) * (100 / remainingWeight))
}

export function semesterProgress(
  semesters: Semester[],
  subjects: Subject[],
  sgpas: Array<{ semesterId: string; sgpa: number }>,
): Array<SemesterGrade & { semesterId: string }> {
  return semesters.map((semester) => {
    const semesterSubjects = subjects.filter((subject) => subject.semesterId === semester.id)
    const sgpa = sgpas.find((item) => item.semesterId === semester.id)?.sgpa ?? 0
    return {
      semesterId: semester.id,
      sgpa,
      totalCredits: semesterSubjects.reduce((sum, subject) => sum + subject.credits, 0),
    }
  })
}
