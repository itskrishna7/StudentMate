import { expect, test } from '@playwright/test'

test('dashboard loads and navigation reaches settings', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)!/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Build your academic workspace' })).toBeVisible()
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
})

test('academic performance tracks completed semester results', async ({ page }) => {
  await page.goto('/performance')
  await page.getByLabel('Current semester').selectOption('3')
  await expect(page.getByText('Semester history is ready.')).toBeVisible()

  const firstSemester = page.locator('tbody tr').filter({ hasText: 'Semester 1' })
  await firstSemester.getByLabel('Semester 1 SGPA').fill('8')
  await firstSemester.getByLabel('Semester 1 credits').fill('20')
  await firstSemester.getByLabel('Semester 1 completed').check()
  await firstSemester.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Semester 1 result saved.')).toBeVisible()

  const secondSemester = page.locator('tbody tr').filter({ hasText: 'Semester 2' })
  await secondSemester.getByLabel('Semester 2 SGPA').fill('6')
  await secondSemester.getByLabel('Semester 2 credits').fill('20')
  await secondSemester.getByLabel('Semester 2 completed').check()
  await secondSemester.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Semester 2 result saved.')).toBeVisible()
  await expect(page.getByText('7.00', { exact: true })).toBeVisible()
})

test('manifest exposes install metadata and PNG icons', async ({ page, request }) => {
  await page.goto('/')
  const response = await request.get('/manifest.webmanifest')
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest.name).toBe('StudentMate')
  expect(manifest.short_name).toBe('StudentMate')
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.some((icon: { sizes: string }) => icon.sizes === '192x192')).toBe(true)
  expect(manifest.icons.some((icon: { sizes: string }) => icon.sizes === '512x512')).toBe(true)
})

test('mobile viewport has no horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile')
  await page.goto('/')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})

test('cached app reloads while offline', async ({ page, context }) => {
  await page.goto('/')
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller !== null,
    undefined,
    { timeout: 15000 },
  ).catch(async () => {
    await page.reload()
  })
  await page.waitForTimeout(500)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)!/ })).toBeVisible()
  await expect(page.getByText(/Offline - local academic data/)).toBeVisible()
})

test('core routes have no horizontal overflow at release screen sizes', async ({ page }) => {
  const sizes = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]
  for (const viewport of sizes) {
    await page.setViewportSize(viewport)
    for (const route of ['/', '/subjects', '/timetable', '/calendar', '/attendance', '/academics', '/performance', '/import', '/analytics', '/backup', '/settings']) {
      await page.goto(route)
      await page.waitForTimeout(100)
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflow, `${route} at ${viewport.width}x${viewport.height}`).toBe(false)
    }
  }
})

test('mobile navigation keeps every route reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation' })
  await expect(navigation).toBeVisible()
  for (const route of ['/subjects', '/timetable', '/calendar', '/attendance', '/academics', '/performance', '/import', '/analytics', '/backup', '/settings']) {
    await expect(navigation.locator(`a[href="${route}"]`)).toHaveCount(1)
  }
  await navigation.getByRole('link', { name: 'Attendance' }).click()
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()
})

test('demo settings actions fit narrow mobile screens', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Enter demo mode' }).click()
  await page.waitForURL(/demo=1/)
  await expect(page.getByRole('button', { name: 'Exit demo' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})

test('import rejects empty unsupported and invalid PDF files safely', async ({ page }) => {
  await page.goto('/import')
  const input = page.locator('input[type="file"]')

  await input.setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) })
  await page.getByRole('button', { name: 'Extract and review' }).click()
  await expect(page.getByRole('alert')).toContainText(/empty/i)

  await input.setInputFiles({ name: 'unsupported.txt', mimeType: 'text/plain', buffer: Buffer.from('not a document') })
  await page.getByRole('button', { name: 'Extract and review' }).click()
  await expect(page.getByRole('alert')).toContainText(/Only PDF|accepted/i)

  await input.setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') })
  await page.getByRole('button', { name: 'Extract and review' }).click()
  await expect(page.getByRole('alert').or(page.getByRole('heading', { name: 'Review extracted entries' }))).toBeVisible({
    timeout: 30000,
  })
})
