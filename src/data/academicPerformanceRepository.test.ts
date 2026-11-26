import { afterEach, describe, expect, it } from 'vitest'
import { db } from './database'
import {
  deleteSemesterResult,
  getAcademicPerformanceData,
  listSemesterResults,
  saveSemesterResult,
  setCGPACalculationMethod,
  setCurrentSemester,
} from './academicPerformanceRepository'

afterEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
})

describe('academic performance repository', () => {
  it('lets a first-semester student start with no completed history', async () => {
    expect(await getAcademicPerformanceData()).toMatchObject({
      currentSemester: null,
      completedCount: 0,
      cgpa: null,
    })

    await setCurrentSemester(1)
    const data = await getAcademicPerformanceData()
    expect(data.results).toHaveLength(1)
    expect(data.results[0]).toMatchObject({ semesterNumber: 1, status: 'current' })
    expect(data.cgpa).toBeNull()
  })

  it('generates earlier pending semesters when a current semester is selected', async () => {
    await setCurrentSemester(5)
    expect((await listSemesterResults()).map(({ semesterNumber, status }) => [semesterNumber, status])).toEqual([
      [1, 'pending'],
      [2, 'pending'],
      [3, 'pending'],
      [4, 'pending'],
      [5, 'current'],
    ])
  })

  it('allows prior results to be entered later and recalculates both CGPA methods', async () => {
    await setCurrentSemester(3)
    await saveSemesterResult({ semesterNumber: 1, sgpa: 9, totalCredits: 20, completed: true })
    const second = await saveSemesterResult({ semesterNumber: 2, sgpa: 7, totalCredits: 10, completed: true })
    await setCGPACalculationMethod('simple')
    expect((await getAcademicPerformanceData()).cgpa).toBe(8)

    await saveSemesterResult({ semesterNumber: 2, sgpa: 8, totalCredits: 10, completed: true }, second.id)
    expect((await getAcademicPerformanceData()).cgpa).toBe(8.5)

    await setCGPACalculationMethod('credit_weighted')
    expect((await getAcademicPerformanceData()).cgpa).toBe(8.67)
  })

  it('keeps pending semesters out of CGPA and deletes an incorrect completed result', async () => {
    await setCurrentSemester(2)
    const firstResult = await saveSemesterResult({ semesterNumber: 1, sgpa: 10, totalCredits: 20, completed: false })
    expect((await getAcademicPerformanceData()).cgpa).toBeNull()

    await saveSemesterResult({ semesterNumber: 1, sgpa: 8, totalCredits: 20, completed: true }, firstResult.id)
    expect((await getAcademicPerformanceData()).cgpa).toBe(8)
    await deleteSemesterResult(firstResult.id)
    expect(await db.studentSemesterResults.get(firstResult.id)).toBeUndefined()
    expect((await getAcademicPerformanceData()).cgpa).toBeNull()
  })

  it('rejects duplicate semester results and invalid SGPA/credits', async () => {
    await setCurrentSemester(2)
    await saveSemesterResult({ semesterNumber: 1, sgpa: 8, totalCredits: 18, completed: true })
    await expect(saveSemesterResult({ semesterNumber: 1, sgpa: 7, totalCredits: 18, completed: true }))
      .rejects.toThrow('already has a record')
    await expect(saveSemesterResult({ semesterNumber: 2, sgpa: 11, completed: false }))
      .rejects.toThrow('SGPA must be between')
    await expect(saveSemesterResult({ semesterNumber: 2, sgpa: 7, completed: true }))
      .rejects.toThrow('credits')
  })
})
