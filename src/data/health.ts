import { db } from './database'

export async function checkDatabaseHealth(): Promise<{
  healthy: boolean
  version: number
  tableCount: number
  error?: string
}> {
  try {
    await db.open()
    await db.appSettings.limit(1).count()
    return { healthy: true, version: db.verno, tableCount: db.tables.length }
  } catch (error) {
    return {
      healthy: false,
      version: db.verno,
      tableCount: db.tables.length,
      error: error instanceof Error ? error.message : 'Unknown database error',
    }
  }
}
