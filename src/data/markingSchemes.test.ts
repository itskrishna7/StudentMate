import { afterEach, describe, expect, it } from 'vitest'
import { db } from './database'
import { getSubjectMarkingScheme, saveSubjectMarkingScheme } from './markingSchemes'
import type { SubjectMarkingScheme } from './models'

afterEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
})

const scheme: SubjectMarkingScheme = {
  calculationMethod: 'best_of',
  bestOfCount: 2,
  internalMaxMarks: 40,
  externalMaxMarks: 60,
  practicalMaxMarks: 20,
  passingMarks: 40,
  internalWeightage: 40,
  externalWeightage: 60,
  passingPercentage: 40,
  decimalPrecision: 2,
  boundaries: [
    { minPercentage: 80, gradePoint: 9, label: 'A', pass: true },
    { minPercentage: 0, gradePoint: 0, label: 'F', pass: false },
  ],
}

describe('subject marking schemes', () => {
  it('persists each scheme in local app settings and leaves academic records untouched', async () => {
    await db.assessments.add({
      id: 'existing-assessment',
      subjectId: 'subject-1',
      name: 'Existing quiz',
      type: 'quiz',
      maxMarks: 25,
      weight: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    await saveSubjectMarkingScheme('subject-1', scheme)

    expect(await getSubjectMarkingScheme('subject-1')).toEqual(scheme)
    expect(await db.appSettings.where('key').equals('markingScheme.subject.subject-1').count()).toBe(1)
    expect(await db.assessments.get('existing-assessment')).toMatchObject({
      name: 'Existing quiz',
      maxMarks: 25,
      weight: 1,
    })
  })

  it('rejects invalid calculation parameters and malformed stored settings', async () => {
    await expect(saveSubjectMarkingScheme('subject-1', {
      ...scheme,
      bestOfCount: 0,
    })).rejects.toThrow('Best-of count')
    const incompleteScheme: SubjectMarkingScheme = { ...scheme, internalWeightage: 60 }
    delete incompleteScheme.externalWeightage
    await expect(saveSubjectMarkingScheme('subject-1', incompleteScheme))
      .rejects.toThrow('both internal and external')
    await db.appSettings.add({
      id: 'bad-scheme',
      key: 'markingScheme.subject.subject-1',
      value: '{"calculationMethod":"invalid"}',
      createdAt: '',
      updatedAt: '',
    })
    await expect(getSubjectMarkingScheme('subject-1')).rejects.toThrow('invalid grade boundaries')
  })
})
