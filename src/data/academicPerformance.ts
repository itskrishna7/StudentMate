import type { CGPACalculationMethod, StudentSemesterResult } from './models'

export const MAX_SEMESTERS = 8
export const DEFAULT_MAX_SGPA = 10
export const DEFAULT_DECIMAL_PRECISION = 2

export interface CGPAProgressPoint {
  semesterNumber: number
  sgpa: number
  cgpa: number
}

export interface AcademicPerformanceSummary {
  completedCount: number
  cgpa: number | null
  latestSGPA: number | null
  previousSGPA: number | null
  progressPercent: number
  progression: CGPAProgressPoint[]
}

function completedResults(results: StudentSemesterResult[]): StudentSemesterResult[] {
  return results
    .filter((result) => result.status === 'completed' && result.sgpa !== undefined)
    .sort((a, b) => a.semesterNumber - b.semesterNumber)
}

function weightedTotal(results: StudentSemesterResult[]): { points: number; credits: number } {
  return results.reduce((total, result) => {
    if (result.sgpa === undefined) throw new Error(`Semester ${result.semesterNumber} is missing SGPA`)
    if (!result.totalCredits || result.totalCredits <= 0) {
      throw new Error(`Semester ${result.semesterNumber} needs credits for credit-weighted CGPA`)
    }
    return {
      points: total.points + result.sgpa * result.totalCredits,
      credits: total.credits + result.totalCredits,
    }
  }, { points: 0, credits: 0 })
}

function round(value: number, precision: number): number {
  return Number(value.toFixed(precision))
}

export function calculatePerformanceCGPA(
  results: StudentSemesterResult[],
  method: CGPACalculationMethod,
  precision = DEFAULT_DECIMAL_PRECISION,
): number | null {
  const completed = completedResults(results)
  if (!completed.length) return null
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw new Error('Decimal precision must be between 0 and 6')
  }
  if (method === 'simple') {
    return round(completed.reduce((sum, result) => sum + result.sgpa!, 0) / completed.length, precision)
  }
  const total = weightedTotal(completed)
  return round(total.points / total.credits, precision)
}

export function calculatePerformanceSummary(
  results: StudentSemesterResult[],
  method: CGPACalculationMethod,
  precision = DEFAULT_DECIMAL_PRECISION,
): AcademicPerformanceSummary {
  const completed = completedResults(results)
  const progression: CGPAProgressPoint[] = []
  for (let index = 0; index < completed.length; index += 1) {
    const included = completed.slice(0, index + 1)
    const cgpa = calculatePerformanceCGPA(included, method, precision)
    progression.push({
      semesterNumber: included[index]!.semesterNumber,
      sgpa: included[index]!.sgpa!,
      cgpa: cgpa!,
    })
  }
  return {
    completedCount: completed.length,
    cgpa: progression.at(-1)?.cgpa ?? null,
    latestSGPA: completed.at(-1)?.sgpa ?? null,
    previousSGPA: completed.at(-2)?.sgpa ?? null,
    progressPercent: Math.round((completed.length / MAX_SEMESTERS) * 100),
    progression,
  }
}

export function remainingSemesterNumbers(
  currentSemester: number,
  results: StudentSemesterResult[],
): number[] {
  const completed = new Set(completedResults(results).map((result) => result.semesterNumber))
  return Array.from(
    { length: Math.max(0, MAX_SEMESTERS - currentSemester + 1) },
    (_, index) => currentSemester + index,
  ).filter((semesterNumber) => !completed.has(semesterNumber))
}

export function predictCGPA(
  results: StudentSemesterResult[],
  currentSemester: number,
  expectedSGPA: number,
  method: CGPACalculationMethod,
  expectedCredits?: number,
  precision = DEFAULT_DECIMAL_PRECISION,
): number | null {
  const completed = completedResults(results)
  const remaining = remainingSemesterNumbers(currentSemester, results)
  if (!remaining.length) return calculatePerformanceCGPA(completed, method, precision)
  const projected: Array<StudentSemesterResult | null> = remaining.map((semesterNumber) => {
    const existing = results.find((result) => result.semesterNumber === semesterNumber)
    const credits = existing?.totalCredits ?? expectedCredits
    if (method === 'credit_weighted' && (!credits || credits <= 0)) return null
    return {
      id: `prediction-${semesterNumber}`,
      semesterNumber,
      status: 'completed' as const,
      sgpa: expectedSGPA,
      ...(credits !== undefined ? { totalCredits: credits } : {}),
      createdAt: '',
      updatedAt: '',
    }
  })
  const validProjected = projected.filter((result): result is StudentSemesterResult => result !== null)
  if (validProjected.length !== projected.length) return null
  return calculatePerformanceCGPA([...completed, ...validProjected], method, precision)
}

export interface TargetSGPAResult {
  requiredSGPA: number | null
  possible: boolean
  targetAlreadyMet: boolean
  reason?: string
}

export function calculateRequiredSGPA(
  results: StudentSemesterResult[],
  currentSemester: number,
  targetCGPA: number,
  method: CGPACalculationMethod,
  maxSGPA: number,
  expectedCredits?: number,
  precision = DEFAULT_DECIMAL_PRECISION,
): TargetSGPAResult {
  if (!Number.isFinite(targetCGPA) || targetCGPA < 0) throw new Error('Target CGPA must be zero or higher')
  if (!Number.isFinite(maxSGPA) || maxSGPA <= 0) throw new Error('Maximum SGPA must be greater than zero')
  if (targetCGPA > maxSGPA) {
    return { requiredSGPA: null, possible: false, targetAlreadyMet: false, reason: `Target exceeds the grading scale maximum of ${maxSGPA}.` }
  }

  const completed = completedResults(results)
  const remaining = remainingSemesterNumbers(currentSemester, results)
  const currentCGPA = calculatePerformanceCGPA(completed, method, precision)
  if (currentCGPA !== null && currentCGPA >= targetCGPA) {
    return { requiredSGPA: 0, possible: true, targetAlreadyMet: true }
  }
  if (!remaining.length) {
    return {
      requiredSGPA: null,
      possible: false,
      targetAlreadyMet: false,
      reason: 'No semesters remain to reach this target.',
    }
  }

  let required: number
  if (method === 'simple') {
    const completedSum = completed.reduce((sum, result) => sum + (result.sgpa ?? 0), 0)
    required = (targetCGPA * (completed.length + remaining.length) - completedSum) / remaining.length
  } else {
    const missingCredits = remaining.filter((semesterNumber) => {
      const credits = results.find((result) => result.semesterNumber === semesterNumber)?.totalCredits ?? expectedCredits
      return !credits || credits <= 0
    })
    if (missingCredits.length) {
      return {
        requiredSGPA: null,
        possible: false,
        targetAlreadyMet: false,
        reason: 'Add credits for remaining semesters or enter an expected credit value.',
      }
    }
    const completedTotal = weightedTotal(completed)
    const remainingCredits = remaining.reduce((sum, semesterNumber) => {
      const credits = results.find((result) => result.semesterNumber === semesterNumber)?.totalCredits ?? expectedCredits!
      return sum + credits
    }, 0)
    required = (targetCGPA * (completedTotal.credits + remainingCredits) - completedTotal.points) / remainingCredits
  }

  if (required < 0) return { requiredSGPA: 0, possible: true, targetAlreadyMet: true }
  const roundedRequired = round(required, precision)
  return {
    requiredSGPA: roundedRequired,
    possible: required <= maxSGPA,
    targetAlreadyMet: false,
    ... (required > maxSGPA ? { reason: `The required SGPA exceeds the grading scale maximum of ${maxSGPA}.` } : {}),
  }
}
