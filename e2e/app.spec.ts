import { expect, test } from '@playwright/test'

test('dashboard loads and navigation reaches settings', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('No academic data yet')).toBeVisible()
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
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
    for (const route of ['/', '/subjects', '/attendance', '/timetable', '/calendar', '/analytics', '/backup']) {
      await page.goto(route)
      await page.waitForTimeout(100)
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflow, `${route} at ${viewport.width}x${viewport.height}`).toBe(false)
    }
  }
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
