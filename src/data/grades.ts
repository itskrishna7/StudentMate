import type { Assessment, GradeBoundary, Mark, Semester, Subject, SubjectMarkingScheme } from './models'

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

export function gradeForSubjectPercentage(
  percentage: number,
  scale: GradeBoundary[],
  scheme?: SubjectMarkingScheme,
): GradeBoundary | undefined {
  const grade = gradePointForPercentage(percentage, scale)
  if (!scheme?.passingMarks) return grade
  const configuredMaximum = (scheme.internalMaxMarks ?? 0) +
    (scheme.externalMaxMarks ?? 0) +
    (scheme.practicalMaxMarks ?? 0)
  if (configuredMaximum <= 0 || percentage * configuredMaximum / 100 >= scheme.passingMarks) {
    return grade
  }
  return [...scale]
    .filter((boundary) => !boundary.pass)
    .sort((a, b) => a.minPercentage - b.minPercentage)[0]
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
  scheme?: SubjectMarkingScheme,
): number {
  if (!assessmentRows.length) return 0
  const scored = assessmentRows.flatMap((assessment) => {
    const mark = markRows.find((item) => item.assessmentId === assessment.id)
    if (!mark) return []
    if (assessment.maxMarks <= 0 || assessment.weight < 0 || mark.marksObtained < 0 ||
      mark.marksObtained > assessment.maxMarks) {
      throw new Error('Assessment marks and maximum marks must be valid')
    }
    return [{ assessment, percentage: (mark.marksObtained / assessment.maxMarks) * 100 }]
  })
  if (!scored.length) return 0

  const aggregate = (items: typeof scored, method: SubjectMarkingScheme['calculationMethod']): number | undefined => {
    if (!items.length) return undefined
    if (method === 'total') {
      const maximum = items.reduce((sum, item) => sum + item.assessment.maxMarks, 0)
      return maximum === 0 ? undefined : items.reduce((sum, item) => sum + item.assessment.maxMarks * item.percentage / 100, 0) / maximum * 100
    }
    if (method === 'average') {
      return items.reduce((sum, item) => sum + item.percentage, 0) / items.length
    }
    if (method === 'best_of') {
      const count = scheme?.bestOfCount ?? items.length
      const best = [...items].sort((a, b) => b.percentage - a.percentage).slice(0, count)
      return best.reduce((sum, item) => sum + item.percentage, 0) / best.length
    }
    const totalWeight = items.reduce((sum, item) => sum + item.assessment.weight, 0)
    return totalWeight === 0
      ? undefined
      : items.reduce((sum, item) => sum + item.percentage * item.assessment.weight, 0) / totalWeight
  }

  if (!scheme) {
    return aggregate(scored, 'weighted') ?? 0
  }

  if (scheme.internalWeightage === undefined || scheme.externalWeightage === undefined) {
    return aggregate(scored, scheme.calculationMethod) ?? 0
  }

  const internal = scored.filter(({ assessment }) => {
    const category = (assessment.category ?? assessment.type).trim().toLowerCase()
    return !category.startsWith('external')
  })
  const external = scored.filter(({ assessment }) =>
    (assessment.category ?? assessment.type).trim().toLowerCase().startsWith('external'),
  )
  const components = [
    { percentage: aggregate(internal, scheme.calculationMethod), weight: scheme.internalWeightage },
    { percentage: aggregate(external, scheme.calculationMethod), weight: scheme.externalWeightage },
  ].filter((item): item is { percentage: number; weight: number } =>
    item.percentage !== undefined && item.weight > 0,
  )
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0)
  return totalWeight === 0
    ? 0
    : components.reduce((sum, item) => sum + item.percentage * item.weight, 0) / totalWeight
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
