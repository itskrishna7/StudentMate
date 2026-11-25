import { expect, test, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const syntheticDate = '2026-11-25'

function createSyntheticPdf(title: string, date: string): Buffer {
  const stream = `BT /F1 18 Tf 72 720 Td (${title}) Tj 0 -30 Td (${date}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'utf8')
}

async function seedSyntheticDatabase(page: Page) {
  await page.goto('/')
  await page.evaluate(async (today) => {
    const tableNames = [
      'semesters', 'subjects', 'timetableRules', 'calendarEvents', 'classSessions',
      'attendanceRecords', 'attendanceChangeLog', 'scheduleChangeLog', 'assessments',
      'marks', 'gradingScales', 'appSettings', 'importJobs',
    ]
    const request = indexedDB.open('StudentMate')
    request.onupgradeneeded = () => {
      const database = request.result
      for (const tableName of tableNames) {
        if (!database.objectStoreNames.contains(tableName)) {
          database.createObjectStore(tableName, { keyPath: 'id' })
        }
      }
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(tableNames, 'readwrite')
      for (const tableName of tableNames) transaction.objectStore(tableName).clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })

    const now = '2026-11-25T10:00:00.000Z'
    const subjects = [
      ['subject-ds', 'Data Structures', 'CS301', 4, 75, '#4f46e5'],
      ['subject-ma', 'Engineering Mathematics', 'MA301', 3, 75, '#0891b2'],
      ['subject-ph', 'Applied Physics', 'PY301', 3, 80, '#059669'],
      ['subject-db', 'Database Laboratory', 'DBL301', 2, 85, '#d97706'],
      ['subject-os', 'Operating Systems', 'CS302', 4, 75, '#7c3aed'],
      ['subject-vlsi', 'VLSI Laboratory', 'EC391', 3, 85, '#dc2626'],
    ] as const

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(tableNames, 'readwrite')
      transaction.objectStore('semesters').add({
        id: 'semester-current', name: 'Synthetic Semester V', startDate: '2026-07-01',
        endDate: '2026-12-31', isCurrent: true, createdAt: now, updatedAt: now,
      })
      for (const [id, name, code, credits, target, color] of subjects) {
        transaction.objectStore('subjects').add({
          id, semesterId: 'semester-current', name, code, facultyName: 'Synthetic Faculty',
          credits, kind: code.includes('L') ? 'laboratory' : 'theory',
          attendanceTarget: target, color, archived: false, createdAt: now, updatedAt: now,
        })
      }
      transaction.objectStore('gradingScales').add({
        id: 'scale-1', name: 'Synthetic 10-point scale',
        passingPercentage: 40, decimalPrecision: 2, isDefault: true,
        boundaries: [
          { minPercentage: 90, gradePoint: 10, label: 'O', pass: true },
          { minPercentage: 80, gradePoint: 9, label: 'A', pass: true },
          { minPercentage: 70, gradePoint: 8, label: 'B', pass: true },
          { minPercentage: 60, gradePoint: 7, label: 'C', pass: true },
          { minPercentage: 40, gradePoint: 6, label: 'P', pass: true },
          { minPercentage: 0, gradePoint: 0, label: 'F', pass: false },
        ],
        createdAt: now, updatedAt: now,
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(tableNames, 'readwrite')
      const weekdays = [1, 2, 3, 4, 5, 6]
      for (let index = 0; index < subjects.length; index += 1) {
        const [subjectId, , , , ,] = subjects[index]
        transaction.objectStore('timetableRules').add({
          id: `rule-${subjectId}`, subjectId, weekday: weekdays[index],
          startTime: `${9 + index}:00`, endTime: `${10 + index}:00`,
          facultyName: 'Synthetic Faculty', room: `Room ${100 + index}`,
          kind: subjectId.includes('lab') ? 'laboratory' : 'lecture',
          recurring: true, startDate: '2026-07-01', active: true,
          createdAt: now, updatedAt: now,
        })
      }
      transaction.objectStore('calendarEvents').add({
        id: 'holiday-synthetic', title: 'Synthetic College Holiday',
        type: 'holiday', startDate: today, endDate: today,
        recurring: false, notes: 'Synthetic testing only',
        createdAt: now, updatedAt: now,
      })
      transaction.objectStore('calendarEvents').add({
        id: 'exam-mid', title: 'Synthetic Internal Examination',
        type: 'internal_exam', startDate: '2026-11-30', endDate: '2026-11-30',
        recurring: false, notes: 'Synthetic testing only',
        createdAt: now, updatedAt: now,
      })
      transaction.objectStore('calendarEvents').add({
        id: 'exam-final', title: 'Synthetic Semester Examination',
        type: 'exam', startDate: '2026-12-14', endDate: '2026-12-18',
        recurring: false, notes: 'Synthetic testing only',
        createdAt: now, updatedAt: now,
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(tableNames, 'readwrite')
      const patterns: Record<string, ('present' | 'absent')[]> = {
        'subject-ds': ['present', 'present', 'present', 'present', 'present', 'present', 'absent', 'absent'],
        'subject-ma': ['present', 'present', 'present', 'present', 'present', 'present', 'present', 'absent'],
        'subject-ph': ['present', 'present', 'present', 'present', 'present', 'present', 'absent', 'absent'],
        'subject-db': ['present', 'present', 'present', 'present', 'present', 'present', 'present', 'present'],
        'subject-os': ['present', 'present', 'present', 'present', 'present', 'absent', 'absent', 'absent'],
        'subject-vlsi': ['present', 'present', 'present', 'present', 'present', 'present', 'present', 'absent'],
      }
      for (const subjectId of Object.keys(patterns)) {
        for (let index = 0; index < 8; index += 1) {
          const sessionId = `${subjectId}-session-${index}`
          transaction.objectStore('classSessions').add({
            id: sessionId, date: `2026-11-${String(index + 1).padStart(2, '0')}`,
            timetableRuleId: `rule-${subjectId}`, subjectId, status: 'conducted',
            notes: '', createdAt: now, updatedAt: now,
          })
          transaction.objectStore('attendanceRecords').add({
            id: `${sessionId}-record`, sessionId, subjectId,
            status: patterns[subjectId][index], recordedAt: now,
            createdAt: now, updatedAt: now,
          })
        }
      }

      const exclusions = [
        ['subject-ds', 'teacher_absent'],
        ['subject-ma', 'cancelled'],
        ['subject-ph', 'holiday'],
      ] as const
      for (const [subjectId, status] of exclusions) {
        transaction.objectStore('classSessions').add({
          id: `${subjectId}-${status}`, date: today,
          timetableRuleId: `rule-${subjectId}`, subjectId, status,
          notes: 'Synthetic excluded session', createdAt: now, updatedAt: now,
        })
      }

      transaction.objectStore('classSessions').add({
        id: 'subject-ds-original-rescheduled', date: '2026-11-23',
        timetableRuleId: 'rule-subject-ds', subjectId: 'subject-ds', status: 'cancelled',
        rescheduledFromId: 'subject-ds-original-rescheduled', notes: 'Synthetic original',
        createdAt: now, updatedAt: now,
      })
      transaction.objectStore('classSessions').add({
        id: 'subject-ds-replacement', date: '2026-11-24',
        timetableRuleId: 'rule-subject-ds-extra', subjectId: 'subject-ds', status: 'conducted',
        rescheduledFromId: 'subject-ds-original-rescheduled', notes: 'Synthetic replacement',
        createdAt: now, updatedAt: now,
      })
      transaction.objectStore('attendanceRecords').add({
        id: 'subject-ds-replacement-record', sessionId: 'subject-ds-replacement',
        subjectId: 'subject-ds', status: 'rescheduled', recordedAt: now,
        createdAt: now, updatedAt: now,
      })
      transaction.objectStore('classSessions').add({
        id: 'subject-ds-extra', date: '2026-11-24',
        timetableRuleId: 'rule-subject-ds-extra', subjectId: 'subject-ds', status: 'conducted',
        notes: 'Synthetic extra lecture', createdAt: now, updatedAt: now,
      })
      transaction.objectStore('attendanceRecords').add({
        id: 'subject-ds-extra-record', sessionId: 'subject-ds-extra',
        subjectId: 'subject-ds', status: 'extra', recordedAt: now,
        createdAt: now, updatedAt: now,
      })

      const marks = [
        ['subject-ds', [18, 70, 45, 27], [20, 100, 50, 30], [20, 30, 20, 30]],
        ['subject-ma', [15, 68, 42], [20, 100, 50], [25, 50, 25]],
        ['subject-ph', [12, 60, 38], [20, 100, 50], [25, 50, 25]],
        ['subject-db', [18, 28], [20, 30], [40, 60]],
        ['subject-os', [16, 74, 44], [20, 100, 50], [20, 50, 30]],
        ['subject-vlsi', [19, 29], [20, 30], [40, 60]],
      ] as const
      marks.forEach(([subjectId, obtained, maximum, weights], subjectIndex) => {
        for (let index = 0; index < obtained.length; index += 1) {
          const assessmentId = `${subjectId}-assessment-${index}`
          transaction.objectStore('assessments').add({
            id: assessmentId, subjectId, name: `Synthetic Assessment ${index + 1}`,
            type: index === 0 ? 'quiz' : index === 1 ? 'mid_semester' : 'practical',
            maxMarks: maximum[index], weight: weights[index], date: '2026-11-20',
            createdAt: now, updatedAt: now,
          })
          transaction.objectStore('marks').add({
            id: `${assessmentId}-mark`, assessmentId, subjectId,
            marksObtained: obtained[index], enteredAt: now,
            createdAt: now, updatedAt: now,
          })
        }
        void subjectIndex
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })

    database.close()
  }, syntheticDate)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test.describe('Synthetic real-world semester', () => {
  test('demo database remains separate from real synthetic database', async ({ page }) => {
    await seedSyntheticDatabase(page)

    const snapshotReal = await page.evaluate(async () => {
      const open = indexedDB.open('StudentMate')
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => reject(open.error)
      })
      const counts: Record<string, number> = {}
      await new Promise<void>((resolve, reject) => {
        const names = ['semesters', 'subjects', 'classSessions', 'attendanceRecords', 'marks']
        const transaction = database.transaction(names, 'readonly')
        for (const name of names) {
          const request = transaction.objectStore(name).count()
          request.onsuccess = () => { counts[name] = request.result }
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      database.close()
      return counts
    })

    await page.goto('/settings')
    await page.getByRole('button', { name: 'Enter demo mode' }).click()
    await expect(page).toHaveURL(/demo=1/)
    await expect(page.getByText(/Sample data mode/)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/separate isolated browser database/)).toBeVisible()

    await page.getByRole('button', { name: 'Reload sample data' }).click()
    await expect(page).toHaveURL(/demo=1/)
    await expect(page.getByText(/Sample data mode/)).toBeVisible({ timeout: 15000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(300)

    await page.evaluate(async () => {
      const open = indexedDB.open('StudentMate-Demo')
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => reject(open.error)
      })
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['subjects'], 'readwrite')
        transaction.objectStore('subjects').clear()
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      database.close()
    })

    await page.getByRole('button', { name: 'Reset demo' }).click()
    await expect(page).toHaveURL(/demo=1/)
    await expect(page.getByText(/Sample data mode/)).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: 'Exit demo' }).click()
    await expect(page).not.toHaveURL(/demo=1/)

    const snapshotAfter = await page.evaluate(async () => {
      const open = indexedDB.open('StudentMate')
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => reject(open.error)
      })
      const counts: Record<string, number> = {}
      await new Promise<void>((resolve, reject) => {
        const names = ['semesters', 'subjects', 'classSessions', 'attendanceRecords', 'marks']
        const transaction = database.transaction(names, 'readonly')
        for (const name of names) {
          const request = transaction.objectStore(name).count()
          request.onsuccess = () => { counts[name] = request.result }
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      database.close()
      return counts
    })
    expect(snapshotAfter).toEqual(snapshotReal)
  })

  test('demo mode remains isolated and can exit safely', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Enter demo mode' }).click()
    await expect(page.getByText(/Sample data mode/)).toBeVisible()
    await page.getByRole('button', { name: 'Reload sample data' }).click()
    await expect(page.getByText(/Sample data mode/)).toBeVisible()
    await page.waitForTimeout(500)
    await expect(page).toHaveURL(/demo=1/)
    await page.getByRole('button', { name: 'Exit demo' }).click()
    await expect(page).toHaveURL(/^(?!.*demo=1)/)
  })

  test('text PDF import reaches review without saving automatically', async ({ page }) => {
    test.setTimeout(60000)
    await page.goto('/import')
    await page.getByLabel('Document type').selectOption('academic_calendar')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'synthetic-calendar.pdf',
      mimeType: 'application/pdf',
      buffer: createSyntheticPdf('Synthetic Internal Examination', '2026-11-30'),
    })
    await page.getByRole('button', { name: 'Extract and review' }).click()
    await expect(page.getByRole('heading', { name: 'Review extracted entries' })).toBeVisible({ timeout: 30000 })
  })

  test('scanned image OCR reaches review or reports a safe failure', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop')
    test.setTimeout(90000)
    await page.goto('/import')
    await page.getByLabel('Document type').selectOption('timetable')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'synthetic-timetable.png',
      mimeType: 'image/png',
      buffer: png,
    })
    await page.getByRole('button', { name: 'Extract and review' }).click()
    await expect(
      page.getByRole('heading', { name: 'Review extracted entries' }).or(page.getByRole('alert')),
    ).toBeVisible({ timeout: 60000 })
  })

  test('persistent isolated profile survives close reopen and offline reload', async ({ playwright }, testInfo) => {
    test.setTimeout(60000)
    test.skip(testInfo.project.name !== 'desktop')
    const profileDir = await mkdtemp(join(tmpdir(), 'studentmate-synthetic-'))
    let context = await playwright.chromium.launchPersistentContext(profileDir, {
      headless: true,
      baseURL: 'http://127.0.0.1:4173',
    })
    try {
      let page = await context.newPage()
      await seedSyntheticDatabase(page)
      await page.reload()
      await expect(page.getByText('Synthetic Semester V')).toBeVisible()
      await context.close()

      context = await playwright.chromium.launchPersistentContext(profileDir, {
        headless: true,
        baseURL: 'http://127.0.0.1:4173',
      })
      page = await context.newPage()
      await page.goto('/')
      await expect(page.getByText('Synthetic Semester V')).toBeVisible()
      await page.waitForFunction(
        () => navigator.serviceWorker?.controller !== null,
        undefined,
        { timeout: 15000 },
      ).catch(async () => { await page.reload() })
      await context.setOffline(true)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(page.getByText('Synthetic Semester V')).toBeVisible()
    } finally {
      await context.close()
      await rm(profileDir, { recursive: true, force: true })
    }
  })

  test('semester subject timetable and calendar creation controls', async ({ page }) => {
    await seedSyntheticDatabase(page)

    await page.goto('/subjects')
    await expect(page.getByRole('heading', { name: 'Subjects' })).toBeVisible()
    await page.getByRole('button', { name: 'Semester', exact: true }).click()
    await page.getByLabel('Semester name').fill('Synthetic UI Semester')
    await page.getByLabel('Start date').fill('2027-01-05')
    await page.getByLabel('End date').fill('2027-05-30')
    await page.getByRole('checkbox', { name: 'Current semester' }).check()
    await page.getByRole('button', { name: 'Save semester' }).click()
    await expect(page.getByText('Synthetic UI Semester')).toBeVisible()

    await page.getByRole('button', { name: 'Subject', exact: true }).click()
    await page.getByLabel('Subject name').fill('Synthetic UI Subject')
    await page.getByLabel('Subject code').fill('UI301')
    await page.getByLabel('Faculty name').fill('Synthetic UI Faculty')
    await page.getByLabel('Credits').fill('3')
    await page.getByLabel('Attendance target').fill('80')
    await page.getByRole('button', { name: 'Save subject' }).click()
    await expect(page.getByText('Synthetic UI Subject')).toBeVisible()

    await page.goto('/timetable')
    await page.getByRole('button', { name: 'Lecture', exact: true }).click()
    await page.getByLabel('Subject').selectOption({ label: 'Synthetic UI Subject' })
    await page.getByLabel('Weekday').selectOption('1')
    await page.getByLabel('Start time').fill('14:00')
    await page.getByLabel('End time').fill('15:00')
    await page.getByLabel('Room or laboratory').fill('UI Lab')
    await page.getByRole('button', { name: 'Save timetable' }).click()
    await expect(page.getByText('Synthetic UI Subject')).toBeVisible()

    await page.goto('/calendar')
    await page.getByRole('button', { name: 'Event', exact: true }).click()
    await page.getByLabel('Title').fill('Synthetic UI Event')
    await page.getByLabel('Start date').fill('2027-02-10')
    await page.getByLabel('End date').fill('2027-02-10')
    await page.getByRole('button', { name: 'Save event' }).click()
    await expect(page.getByText('Synthetic UI Event')).toBeVisible()

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflow).toBe(false)
  })

  test('dashboard, attendance, calendar, analytics and persistence', async ({ page }) => {
    await seedSyntheticDatabase(page)

    await expect(page.getByText('Synthetic Semester V')).toBeVisible()
    await expect(page.getByText('6', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('82%', { exact: true }).first()).toBeVisible()

    await page.goto('/attendance')
    await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()
    await expect(page.locator('.session-card').filter({ hasText: 'Data Structures' }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Prepare timetable sessions' }).click()
    const physicsCard = page.locator('.session-card').filter({ hasText: 'Applied Physics' }).first()
    await expect(physicsCard).toBeVisible()
    await physicsCard.getByRole('button', { name: 'conducted', exact: true }).click()
    await physicsCard.getByRole('button', { name: 'present', exact: true }).click()
    await page.getByRole('button', { name: 'Mark whole day absent' }).click()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()
    await expect(page.locator('.session-card').filter({ hasText: 'Applied Physics' }).first()).toBeVisible()

    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: 'Academic calendar' })).toBeVisible()
    await expect(page.getByText('Synthetic Semester Examination')).toBeVisible()

    await page.goto('/analytics')
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible()
  })

  test('backup download and existing-database restore preview', async ({ page }) => {
    await seedSyntheticDatabase(page)
    await page.goto('/backup')
    await expect(page.getByRole('heading', { name: 'Backup and restore' })).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download JSON backup' }).click()
    const download = await downloadPromise
    const path = await download.path()
    expect(path).toBeTruthy()

    const fs = await import('node:fs/promises')
    const text = await fs.readFile(path!, 'utf8')
    const backup = JSON.parse(text)
    expect(backup.format).toBe('studentmate')
    expect(backup.data.subjects).toHaveLength(6)

    await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
      name: 'synthetic-duplicate-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    })
    await expect(page.getByRole('heading', { name: 'Restore preview' })).toBeVisible()
    await expect(page.getByText('Duplicates kept')).toBeVisible()

    await page.evaluate(async () => {
      const request = indexedDB.open('StudentMate')
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const names = Array.from(database.objectStoreNames)
        const transaction = database.transaction(names, 'readwrite')
        for (const name of names) transaction.objectStore(name).clear()
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      database.close()
    })

    await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
      name: 'synthetic-restored-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    })
    await expect(page.getByRole('heading', { name: 'Restore preview' })).toBeVisible()
    await expect(page.getByText('Additions')).toBeVisible()
    await page.getByRole('button', { name: 'Confirm merge restore' }).click()
    await expect(page.getByText(/Restore completed/)).toBeVisible()

    const restoredCounts = await page.evaluate(async () => {
      const request = indexedDB.open('StudentMate')
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const counts: Record<string, number> = {}
      await new Promise<void>((resolve, reject) => {
        const names = ['semesters', 'subjects', 'timetableRules', 'calendarEvents', 'classSessions', 'attendanceRecords', 'assessments', 'marks']
        const transaction = database.transaction(names, 'readonly')
        for (const name of names) {
          const countRequest = transaction.objectStore(name).count()
          countRequest.onsuccess = () => { counts[name] = countRequest.result }
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      database.close()
      return counts
    })
    expect(restoredCounts.subjects).toBe(6)
    expect(restoredCounts.semesters).toBe(1)
    expect(restoredCounts.attendanceRecords).toBeGreaterThan(40)
    expect(restoredCounts.marks).toBeGreaterThan(10)

    await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
      name: 'synthetic-duplicate-after-restore.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    })
    await expect(page.getByRole('heading', { name: 'Restore preview' })).toBeVisible()
    await expect(page.getByText('Duplicates kept')).toBeVisible()

    await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{bad json'),
    })
    await expect(page.getByText(/malformed JSON|Could not validate backup/i)).toBeVisible()

    const malicious = JSON.parse(text)
    malicious.data.subjects = [{
      ...malicious.data.subjects[0],
      name: 'Malicious',
      color: 'url(https://attacker.invalid/tracker)',
    }]
    await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
      name: 'malicious.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(malicious)),
    })
    await expect(page.getByText(/six-digit hex color|Could not validate backup/i)).toBeVisible()
  })
})
