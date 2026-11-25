import { db } from './database'
import type { AppSetting } from './models'

export const createId = () => crypto.randomUUID()
export const nowIso = () => new Date().toISOString()

export function defaultSetting(key: string, value: string): AppSetting {
  const now = nowIso()
  return { id: createId(), key, value, createdAt: now, updatedAt: now }
}

export async function getSetting(key: string): Promise<string | undefined> {
  return (await db.appSettings.where('key').equals(key).first())?.value
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.transaction('rw', db.appSettings, async () => {
    const existing = await db.appSettings.where('key').equals(key).first()
    if (existing) {
      await db.appSettings.update(existing.id, { value, updatedAt: nowIso() })
      return
    }
    await db.appSettings.add(defaultSetting(key, value))
  })
}

export async function initializeDatabaseSettings(): Promise<void> {
  await db.transaction('rw', db.appSettings, async () => {
    for (const [key, value] of Object.entries({
      attendanceTarget: '75',
      theme: 'system',
      decimalPrecision: '2',
    })) {
      if (!(await db.appSettings.where('key').equals(key).first())) {
        await db.appSettings.add(defaultSetting(key, value))
      }
    }
  })
}
