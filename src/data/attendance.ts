import type { AttendanceRecord, ClassSession } from './models'

export interface AttendanceSummary {
  attended: number
  absent: number
  conducted: number
  missed: number
  exactPercentage: number
  displayPercentage: number
  maxBunk: number
  classesRequired: number
}

export function countsForAttendance(
  sessions: ClassSession[],
  records: AttendanceRecord[],
): { attended: number; absent: number; conducted: number } {
  const recordsBySession = new Map(records.map((record) => [record.sessionId, record]))
  let attended = 0
  let absent = 0
  let conducted = 0

  for (const session of sessions) {
    if (session.status !== 'conducted') continue

    const record = recordsBySession.get(session.id)
    if (!record) continue
    if (record.status === 'present' || record.status === 'extra' || record.status === 'rescheduled') {
      attended += 1
      conducted += 1
    } else if (record.status === 'absent') {
      absent += 1
      conducted += 1
    }
  }
  return { attended, absent, conducted }
}

export function roundAttendance(attended: number, conducted: number): number {
  if (conducted === 0) return 0
  if (!Number.isInteger(attended) || !Number.isInteger(conducted) || attended < 0 || conducted < 0) {
    throw new Error('Attendance counts must be non-negative integers')
  }
  if (attended > conducted) throw new Error('Attended classes cannot exceed conducted classes')
  return Math.floor((200 * attended + conducted) / (2 * conducted))
}

export function calculateAttendanceSummary(
  sessions: ClassSession[],
  records: AttendanceRecord[],
  targetPercentage = 75,
): AttendanceSummary {
  if (!Number.isFinite(targetPercentage) || targetPercentage <= 0 || targetPercentage > 100) {
    throw new Error('Attendance target must be between 1 and 100')
  }

  const counts = countsForAttendance(sessions, records)
  const exactPercentage = counts.conducted === 0 ? 0 : (counts.attended / counts.conducted) * 100

  let maxBunk = 0
  if (exactPercentage >= targetPercentage) {
    maxBunk = Math.max(
      0,
      Math.floor((counts.attended * 100 - targetPercentage * counts.conducted) / targetPercentage),
    )
  }

  let classesRequired = 0
  if (exactPercentage < targetPercentage) {
    classesRequired = Math.ceil(
      (targetPercentage * counts.conducted - 100 * counts.attended) / (100 - targetPercentage),
    )
  }

  return {
    ...counts,
    missed: counts.absent,
    exactPercentage,
    displayPercentage: roundAttendance(counts.attended, counts.conducted),
    maxBunk,
    classesRequired,
  }
}
