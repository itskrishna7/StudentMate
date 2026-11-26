import { DEFAULT_DECIMAL_PRECISION, DEFAULT_MAX_SGPA, type AcademicPerformanceSummary, calculatePerformanceSummary } from './academicPerformance'
import { db } from './database'
import { createId, defaultSetting, nowIso } from './settings'
import type { CGPACalculationMethod, StudentSemesterResult } from './models'
import { requireNonEmpty, requireRange } from './validation'

const CURRENT_SEMESTER_KEY = 'performance.currentSemester'
const CALCULATION_METHOD_KEY = 'performance.calculationMethod'

export interface SemesterResultInput {
  semesterNumber: number
  sgpa?: number
  totalCredits?: number
  academicYear?: string
  completed: boolean
}

export interface AcademicPerformanceData extends AcademicPerformanceSummary {
  results: StudentSemesterResult[]
  currentSemester: number | null
  calculationMethod: CGPACalculationMethod
  maxSGPA: number
  decimalPrecision: number
}

function validateSemesterNumber(value: number): void {
  requireRange(value, 1, 8, 'Semester')
  if (!Number.isInteger(value)) throw new Error('Semester must be a whole number from 1 to 8')
}

async function saveSetting(key: string, value: string): Promise<void> {
  const existing = await db.appSettings.where('key').equals(key).first()
  const now = nowIso()
  if (existing) {
    await db.appSettings.update(existing.id, { value, updatedAt: now })
  } else {
    await db.appSettings.add({ ...defaultSetting(key, value), updatedAt: now })
  }
}

async function currentSemesterValue(): Promise<number | null> {
  const value = await db.appSettings.where('key').equals(CURRENT_SEMESTER_KEY).first()
  if (!value) return null
  const parsed = Number(value.value)
  validateSemesterNumber(parsed)
  return parsed
}

function calculationMethod(value: string | undefined): CGPACalculationMethod {
  if (!value) return 'simple'
  if (value === 'simple' || value === 'credit_weighted') return value
  throw new Error('Stored CGPA calculation method is invalid')
}

export async function listSemesterResults(): Promise<StudentSemesterResult[]> {
  return db.studentSemesterResults.orderBy('semesterNumber').toArray()
}

export async function getAcademicPerformanceData(): Promise<AcademicPerformanceData> {
  const [results, currentSetting, methodSetting, scales, precisionSetting] = await Promise.all([
    listSemesterResults(),
    db.appSettings.where('key').equals(CURRENT_SEMESTER_KEY).first(),
    db.appSettings.where('key').equals(CALCULATION_METHOD_KEY).first(),
    db.gradingScales.toArray(),
    db.appSettings.where('key').equals('decimalPrecision').first(),
  ])
  const parsedCurrent = currentSetting ? Number(currentSetting.value) : null
  if (parsedCurrent !== null) validateSemesterNumber(parsedCurrent)
  const parsedPrecision = precisionSetting ? Number(precisionSetting.value) : DEFAULT_DECIMAL_PRECISION
  if (!Number.isInteger(parsedPrecision) || parsedPrecision < 0 || parsedPrecision > 6) {
    throw new Error('Configured decimal precision must be between 0 and 6')
  }
  const scale = scales.find((item) => item.isDefault) ?? scales[0]
  const maxSGPA = scale?.boundaries.length
    ? Math.max(...scale.boundaries.map((boundary) => boundary.gradePoint))
    : DEFAULT_MAX_SGPA
  if (!Number.isFinite(maxSGPA) || maxSGPA <= 0) throw new Error('Configured grading scale has no valid maximum grade point')
  const method = calculationMethod(methodSetting?.value)
  return {
    ...calculatePerformanceSummary(results, method, parsedPrecision),
    results,
    currentSemester: parsedCurrent,
    calculationMethod: method,
    maxSGPA,
    decimalPrecision: parsedPrecision,
  }
}

export async function setCurrentSemester(semesterNumber: number): Promise<void> {
  validateSemesterNumber(semesterNumber)
  const now = nowIso()
  await db.transaction('rw', db.studentSemesterResults, db.appSettings, async () => {
    const records = await db.studentSemesterResults.toArray()
    const byNumber = new Map(records.map((record) => [record.semesterNumber, record]))
    for (let number = 1; number <= semesterNumber; number += 1) {
      const existing = byNumber.get(number)
      const status = number === semesterNumber ? 'current' : 'pending'
      if (existing) {
        if (existing.status !== 'completed' && existing.status !== status) {
          await db.studentSemesterResults.update(existing.id, { status, updatedAt: now })
        }
      } else {
        await db.studentSemesterResults.add({
          id: createId(),
          semesterNumber: number,
          status,
          createdAt: now,
          updatedAt: now,
        })
      }
    }
    for (const record of records) {
      if (record.status === 'current' && record.semesterNumber !== semesterNumber) {
        await db.studentSemesterResults.update(record.id, { status: 'pending', updatedAt: now })
      }
    }
    await saveSetting(CURRENT_SEMESTER_KEY, String(semesterNumber))
  })
}

export async function setCGPACalculationMethod(method: CGPACalculationMethod): Promise<void> {
  if (method !== 'simple' && method !== 'credit_weighted') throw new Error('Choose a valid CGPA calculation method')
  await saveSetting(CALCULATION_METHOD_KEY, method)
}

export async function saveSemesterResult(
  input: SemesterResultInput,
  id?: string,
): Promise<StudentSemesterResult> {
  validateSemesterNumber(input.semesterNumber)
  const data = await getAcademicPerformanceData()
  if (input.sgpa !== undefined) requireRange(input.sgpa, 0, data.maxSGPA, 'SGPA')
  if (input.totalCredits !== undefined) requireRange(input.totalCredits, 0.01, 1000, 'Semester credits')
  if (input.academicYear !== undefined) requireNonEmpty(input.academicYear, 'Academic year')
  if (input.completed && input.sgpa === undefined) throw new Error('Enter an SGPA before marking the semester completed')
  if (input.completed && (!input.totalCredits || input.totalCredits <= 0)) {
    throw new Error('Enter semester credits before marking the semester completed')
  }

  const currentSemester = await currentSemesterValue()
  const now = nowIso()
  const saved = await db.transaction('rw', db.studentSemesterResults, async () => {
    const duplicate = await db.studentSemesterResults.where('semesterNumber').equals(input.semesterNumber).first()
    const isEmptyPlaceholder = duplicate &&
      duplicate.sgpa === undefined &&
      duplicate.totalCredits === undefined &&
      duplicate.academicYear === undefined
    if (duplicate && duplicate.id !== id && (id !== undefined || !isEmptyPlaceholder)) {
      throw new Error(`Semester ${input.semesterNumber} already has a record`)
    }
    const previous = id
      ? await db.studentSemesterResults.get(id)
      : duplicate
    if (id && !previous) throw new Error('Semester result no longer exists')
    if (previous && previous.semesterNumber !== input.semesterNumber) {
      throw new Error('Semester result cannot be moved to another semester')
    }
    const record: StudentSemesterResult = {
      ...(previous ?? {}),
      id: previous?.id ?? createId(),
      semesterNumber: input.semesterNumber,
      status: input.completed ? 'completed' : input.semesterNumber === currentSemester ? 'current' : 'pending',
      ...(input.sgpa !== undefined ? { sgpa: input.sgpa } : {}),
      ...(input.totalCredits !== undefined ? { totalCredits: input.totalCredits } : {}),
      ...(input.academicYear?.trim() ? { academicYear: input.academicYear.trim() } : {}),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    if (input.sgpa === undefined) delete record.sgpa
    if (input.totalCredits === undefined) delete record.totalCredits
    if (!input.academicYear?.trim()) delete record.academicYear
    await db.studentSemesterResults.put(record)
    return record
  })
  return saved
}

export async function deleteSemesterResult(id: string): Promise<void> {
  await db.transaction('rw', db.studentSemesterResults, async () => {
    const record = await db.studentSemesterResults.get(id)
    if (!record) throw new Error('Semester result no longer exists')
    await db.studentSemesterResults.delete(id)
  })
}
