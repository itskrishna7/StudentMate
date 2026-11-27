import { afterEach, describe, expect, it } from 'vitest'
import { db } from './database'
import { deleteAssessment, deleteMark, saveAssessment, saveMark } from './academicsRepository'
import { calculateAssessmentPercentage } from './grades'

afterEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
})

describe('assessment and mark repository', () => {
  it('uses entered assessment maxima, recalculates without changing marks, and refuses invalid maximum reductions', async () => {
    const assessment = await saveAssessment({
      subjectId: 'subject-1',
      name: 'Quiz',
      type: 'quiz',
      category: 'Internal',
      maxMarks: 20,
      weight: 1,
    })
    const mark = await saveMark({
      assessmentId: assessment.id,
      subjectId: 'subject-1',
      marksObtained: 15,
    })
    expect(calculateAssessmentPercentage([assessment], [mark])).toBe(75)

    const updated = await saveAssessment({ ...assessment, maxMarks: 30 }, assessment.id)
    expect(calculateAssessmentPercentage([updated], [mark])).toBe(50)
    await expect(saveAssessment({ ...updated, maxMarks: 10 }, updated.id))
      .rejects.toThrow('cannot be lower than an already entered mark')
    expect((await db.marks.get(mark.id))?.marksObtained).toBe(15)
  })

  it('rejects marks beyond the assessment maximum and mismatched subject records', async () => {
    const assessment = await saveAssessment({
      subjectId: 'subject-1',
      name: 'Assignment',
      type: 'assignment',
      maxMarks: 10,
      weight: 0,
    })
    await expect(saveMark({
      assessmentId: assessment.id,
      subjectId: 'subject-1',
      marksObtained: 11,
    })).rejects.toThrow('Marks obtained must be between')
    await expect(saveMark({
      assessmentId: assessment.id,
      subjectId: 'subject-2',
      marksObtained: 5,
    })).rejects.toThrow('must match its assessment')
  })

  it('clears only the selected mark or explicitly deletes its assessment and dependent mark', async () => {
    const assessment = await saveAssessment({
      subjectId: 'subject-1',
      name: 'Practical',
      type: 'practical',
      maxMarks: 20,
      weight: 0,
    })
    await saveMark({ assessmentId: assessment.id, subjectId: 'subject-1', marksObtained: 12 })
    await deleteMark(assessment.id)
    expect(await db.assessments.get(assessment.id)).toBeDefined()
    expect(await db.marks.where('assessmentId').equals(assessment.id).count()).toBe(0)

    await saveMark({ assessmentId: assessment.id, subjectId: 'subject-1', marksObtained: 12 })
    await deleteAssessment(assessment.id)
    expect(await db.assessments.get(assessment.id)).toBeUndefined()
    expect(await db.marks.where('assessmentId').equals(assessment.id).count()).toBe(0)
  })
})
