import { db } from './database'
import { createId, nowIso } from './settings'
import type { Assessment, GradingScale, Mark } from './models'
import { requireDate, requireRange } from './validation'

export type AssessmentInput = Omit<Assessment, 'id' | 'createdAt' | 'updatedAt'>
export type MarkInput = Omit<Mark, 'id' | 'enteredAt' | 'createdAt' | 'updatedAt'>

export async function saveAssessment(input: AssessmentInput, id?: string): Promise<Assessment> {
  requireRange(input.maxMarks, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'Maximum marks')
  requireRange(input.weight, 0, Number.MAX_SAFE_INTEGER, 'Assessment weight')
  if (!input.subjectId) throw new Error('Subject is required')
  if (!input.name.trim()) throw new Error('Assessment name is required')
  if (input.date) requireDate(input.date, 'Assessment date')

  const now = nowIso()
  const record: Assessment = { ...input, id: id ?? createId(), createdAt: now, updatedAt: now }
  if (id) {
    const previous = await db.assessments.get(id)
    if (!previous) throw new Error('Assessment no longer exists')
    const existingMarks = await db.marks.where('assessmentId').equals(id).toArray()
    if (existingMarks.some((mark) => mark.marksObtained > input.maxMarks)) {
      throw new Error('Maximum marks cannot be lower than an already entered mark')
    }
    await db.assessments.put({ ...previous, ...input, updatedAt: now })
  } else {
    await db.assessments.add(record)
  }
  return (await db.assessments.get(record.id)) ?? record
}

export async function saveMark(input: MarkInput, id?: string): Promise<Mark> {
  const assessment = await db.assessments.get(input.assessmentId)
  if (!assessment) throw new Error('Assessment no longer exists')
  if (input.subjectId !== assessment.subjectId) throw new Error('Mark subject must match its assessment')
  requireRange(input.marksObtained, 0, assessment.maxMarks, 'Marks obtained')

  const now = nowIso()
  const record: Mark = { ...input, id: id ?? createId(), enteredAt: now, createdAt: now, updatedAt: now }
  const existing = id
    ? await db.marks.get(id)
    : await db.marks.where('assessmentId').equals(input.assessmentId).first()

  if (id && !existing) throw new Error('Mark no longer exists')
  if (existing) {
    if (existing.assessmentId !== input.assessmentId) throw new Error('Mark cannot be moved to another assessment')
    await db.marks.update(existing.id, { marksObtained: input.marksObtained, subjectId: input.subjectId, enteredAt: now, updatedAt: now })
    return (await db.marks.get(existing.id)) ?? record
  }
  await db.marks.add(record)
  return record
}

export async function deleteMark(assessmentId: string): Promise<void> {
  await db.transaction('rw', db.assessments, db.marks, async () => {
    if (!(await db.assessments.get(assessmentId))) throw new Error('Assessment no longer exists')
    await db.marks.where('assessmentId').equals(assessmentId).delete()
  })
}

export async function deleteAssessment(id: string): Promise<void> {
  await db.transaction('rw', db.assessments, db.marks, async () => {
    if (!(await db.assessments.get(id))) throw new Error('Assessment no longer exists')
    await db.marks.where('assessmentId').equals(id).delete()
    await db.assessments.delete(id)
  })
}

export async function listAssessments(subjectId?: string) {
  if (subjectId) return db.assessments.where('subjectId').equals(subjectId).toArray()
  return db.assessments.toArray()
}

export async function listMarks(subjectId?: string) {
  if (subjectId) return db.marks.where('subjectId').equals(subjectId).toArray()
  return db.marks.toArray()
}

export async function saveGradingScale(
  scale: Omit<GradingScale, 'id' | 'createdAt' | 'updatedAt'>,
  id?: string,
): Promise<GradingScale> {
  if (!scale.name.trim()) throw new Error('Grading scale name is required')
  if (!scale.boundaries.length) throw new Error('At least one grade boundary is required')
  if (!Number.isFinite(scale.passingPercentage) || scale.passingPercentage < 0 || scale.passingPercentage > 100) {
    throw new Error('Passing percentage must be between 0 and 100')
  }
  if (!Number.isInteger(scale.decimalPrecision) || scale.decimalPrecision < 0 || scale.decimalPrecision > 6) {
    throw new Error('Decimal precision must be between 0 and 6')
  }
  if (scale.boundaries.some((boundary) =>
    !Number.isFinite(boundary.minPercentage) ||
    boundary.minPercentage < 0 ||
    boundary.minPercentage > 100 ||
    !Number.isFinite(boundary.gradePoint) ||
    boundary.gradePoint < 0 ||
    !boundary.label.trim(),
  )) {
    throw new Error('Grade boundaries are invalid')
  }
  const now = nowIso()
  const record: GradingScale = { ...scale, id: id ?? createId(), createdAt: now, updatedAt: now }
  if (scale.isDefault) {
    await db.gradingScales.filter((item) => item.isDefault).modify({ isDefault: false })
  }
  if (id) {
    await db.gradingScales.update(id, { ...scale, updatedAt: now })
  } else {
    await db.gradingScales.add(record)
  }
  return (await db.gradingScales.get(record.id)) ?? record
}

export async function listGradingScales() {
  return db.gradingScales.toArray()
}
