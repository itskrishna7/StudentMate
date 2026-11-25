import { db } from './database'
import { createId, nowIso } from './settings'
import type { Semester, Subject } from './models'
import { requireDate, requireNonEmpty, requireRange } from './validation'

export type SemesterInput = Omit<Semester, 'id' | 'createdAt' | 'updatedAt'>
export type SubjectInput = Omit<Subject, 'id' | 'createdAt' | 'updatedAt'>

export async function listSemesters() {
  return db.semesters.orderBy('startDate').reverse().toArray()
}

export async function saveSemester(input: SemesterInput, id?: string): Promise<Semester> {
  requireNonEmpty(input.name, 'Semester name')
  requireDate(input.startDate, 'Start date')
  requireDate(input.endDate, 'End date')
  if (input.endDate < input.startDate) throw new Error('End date cannot be before start date')

  const now = nowIso()
  const record: Semester = { ...input, id: id ?? createId(), createdAt: now, updatedAt: now }

  await db.transaction('rw', db.semesters, async () => {
    if (input.isCurrent) {
      await db.semesters.filter((semester) => semester.isCurrent).modify({ isCurrent: false })
    }
    if (id) {
      const existing = await db.semesters.get(id)
      if (!existing) throw new Error('Semester no longer exists')
      await db.semesters.put({ ...existing, ...input, updatedAt: now })
    } else {
      await db.semesters.add(record)
    }
  })
  return (await db.semesters.get(record.id)) ?? record
}

export async function listSubjects(includeArchived = false) {
  const subjects = await db.subjects.toArray()
  return includeArchived ? subjects : subjects.filter((subject) => !subject.archived)
}

export async function saveSubject(input: SubjectInput, id?: string): Promise<Subject> {
  requireNonEmpty(input.name, 'Subject name')
  requireNonEmpty(input.semesterId, 'Semester')
  requireRange(input.credits, 0, 30, 'Credits')
  requireRange(input.attendanceTarget, 1, 100, 'Attendance target')
  if (!/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error('Choose a valid subject color')

  if (!(await db.semesters.get(input.semesterId))) throw new Error('The selected semester does not exist')
  const duplicate = await db.subjects
    .filter((subject) => subject.semesterId === input.semesterId && subject.code.trim().toLowerCase() === input.code.trim().toLowerCase() && subject.id !== id)
    .first()
  if (input.code.trim() && duplicate) throw new Error('A subject with this code already exists in the semester')

  const now = nowIso()
  await db.transaction('rw', db.subjects, async () => {
    if (id) {
      const existing = await db.subjects.get(id)
      if (!existing) throw new Error('Subject no longer exists')
      await db.subjects.put({ ...existing, ...input, code: input.code.trim(), updatedAt: now })
    } else {
      await db.subjects.add({ ...input, id: createId(), code: input.code.trim(), createdAt: now, updatedAt: now })
    }
  })
  const saved = id ? await db.subjects.get(id) : await db.subjects.filter((subject) =>
    subject.semesterId === input.semesterId && subject.name === input.name).last()
  if (!saved) throw new Error('Subject could not be saved')
  return saved
}

export async function archiveSubject(id: string): Promise<void> {
  await db.subjects.update(id, { archived: true, updatedAt: nowIso() })
}

export async function deleteSubject(id: string): Promise<'deleted' | 'blocked'> {
  const historicalReferences = await Promise.all([
    db.timetableRules.where('subjectId').equals(id).count(),
    db.classSessions.where('subjectId').equals(id).count(),
    db.attendanceRecords.where('subjectId').equals(id).count(),
    db.assessments.where('subjectId').equals(id).count(),
    db.marks.where('subjectId').equals(id).count(),
  ])
  if (historicalReferences.some((count) => count > 0)) return 'blocked'

  await db.subjects.delete(id)
  return 'deleted'
}
