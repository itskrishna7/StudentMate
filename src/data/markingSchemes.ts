import { db } from './database'
import type { AssessmentCalculationMethod, SubjectMarkingScheme } from './models'
import { getSetting, setSetting } from './settings'

const KEY_PREFIX = 'markingScheme.subject.'
const methods = new Set<AssessmentCalculationMethod>(['total', 'average', 'best_of', 'weighted'])

function isFiniteOptional(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function validateScheme(scheme: SubjectMarkingScheme): void {
  if (!methods.has(scheme.calculationMethod)) throw new Error('Choose a valid assessment calculation method')
  if (!Number.isInteger(scheme.decimalPrecision) || scheme.decimalPrecision < 0 || scheme.decimalPrecision > 6) {
    throw new Error('Decimal precision must be between 0 and 6')
  }
  if (!Number.isFinite(scheme.passingPercentage) || scheme.passingPercentage < 0 || scheme.passingPercentage > 100) {
    throw new Error('Passing percentage must be between 0 and 100')
  }
  if (!scheme.boundaries.length) throw new Error('Add at least one grade boundary')
  if (scheme.boundaries.some((boundary) =>
    !boundary ||
    typeof boundary !== 'object' ||
    !Number.isFinite(boundary.minPercentage) ||
    boundary.minPercentage < 0 ||
    boundary.minPercentage > 100 ||
    !Number.isFinite(boundary.gradePoint) ||
    boundary.gradePoint < 0 ||
    typeof boundary.label !== 'string' ||
    !boundary.label.trim() ||
    typeof boundary.pass !== 'boolean',
  )) {
    throw new Error('Grade boundaries must have valid percentages, grade points, and labels')
  }
  for (const [label, value] of [
    ['Internal maximum marks', scheme.internalMaxMarks],
    ['External maximum marks', scheme.externalMaxMarks],
    ['Practical maximum marks', scheme.practicalMaxMarks],
  ] as const) {
    if (!isFiniteOptional(value) || (value !== undefined && value <= 0)) {
      throw new Error(`${label} must be greater than zero`)
    }
  }
  if (!isFiniteOptional(scheme.passingMarks) || (scheme.passingMarks !== undefined && scheme.passingMarks < 0)) {
    throw new Error('Passing marks cannot be negative')
  }
  for (const [label, value] of [
    ['Internal weightage', scheme.internalWeightage],
    ['External weightage', scheme.externalWeightage],
  ] as const) {
    if (!isFiniteOptional(value) || (value !== undefined && (value < 0 || value > 100))) {
      throw new Error(`${label} must be between 0 and 100`)
    }
  }
  if (scheme.calculationMethod === 'best_of' &&
    (!Number.isInteger(scheme.bestOfCount) || (scheme.bestOfCount ?? 0) < 1)) {
    throw new Error('Best-of count must be a positive whole number')
  }
  if (scheme.bestOfCount !== undefined &&
    (!Number.isInteger(scheme.bestOfCount) || scheme.bestOfCount < 1)) {
    throw new Error('Best-of count must be a positive whole number')
  }
  if ((scheme.internalWeightage === undefined) !== (scheme.externalWeightage === undefined)) {
    throw new Error('Configure both internal and external weightages, or leave both empty')
  }
  if (scheme.internalWeightage !== undefined && scheme.externalWeightage !== undefined &&
    scheme.internalWeightage + scheme.externalWeightage <= 0) {
    throw new Error('Internal and external weightages must have a combined value greater than zero')
  }
  const configuredMaximum = (scheme.internalMaxMarks ?? 0) +
    (scheme.externalMaxMarks ?? 0) +
    (scheme.practicalMaxMarks ?? 0)
  if (scheme.passingMarks !== undefined && configuredMaximum === 0) {
    throw new Error('Configure at least one component maximum before setting passing marks')
  }
  if (configuredMaximum > 0 && scheme.passingMarks !== undefined) {
    if (scheme.passingMarks > configuredMaximum) {
      throw new Error('Passing marks cannot exceed the configured subject maximum')
    }
    if (scheme.passingMarks > 0 && !scheme.boundaries.some((boundary) => boundary.pass === false)) {
      throw new Error('Add a failing grade boundary when configuring passing marks')
    }
  }
}

function parseScheme(value: string): SubjectMarkingScheme {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored subject marking scheme is invalid')
  }
  const scheme = parsed as SubjectMarkingScheme
  if (!Array.isArray(scheme.boundaries)) throw new Error('Stored subject marking scheme has invalid grade boundaries')
  validateScheme(scheme)
  return scheme
}

export function validateSubjectMarkingSchemeJson(value: string): void {
  parseScheme(value)
}

export async function getSubjectMarkingScheme(subjectId: string): Promise<SubjectMarkingScheme | undefined> {
  const value = await getSetting(`${KEY_PREFIX}${subjectId}`)
  return value === undefined ? undefined : parseScheme(value)
}

export async function listSubjectMarkingSchemes(): Promise<Record<string, SubjectMarkingScheme>> {
  const rows = await db.appSettings.where('key').startsWith(KEY_PREFIX).toArray()
  return Object.fromEntries(rows.map((row) => [row.key.slice(KEY_PREFIX.length), parseScheme(row.value)]))
}

export async function saveSubjectMarkingScheme(
  subjectId: string,
  scheme: SubjectMarkingScheme,
): Promise<void> {
  if (!subjectId.trim()) throw new Error('Subject is required')
  validateScheme(scheme)
  await setSetting(`${KEY_PREFIX}${subjectId}`, JSON.stringify(scheme))
}

