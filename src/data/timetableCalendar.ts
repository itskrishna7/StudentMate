import { db } from './database'
import { createId, nowIso } from './settings'
import type { CalendarEvent, TimetableRule } from './models'
import { requireDate, requireNonEmpty } from './validation'

export type TimetableInput = Omit<TimetableRule, 'id' | 'createdAt' | 'updatedAt'>
export type CalendarInput = Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>

export function timeToMinutes(time: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!match) throw new Error('Time must use HH:mm format')
  return Number(match[1]) * 60 + Number(match[2])
}

export function findTimetableOverlap(
  candidate: TimetableInput,
  existingRules: TimetableRule[],
): TimetableRule | undefined {
  const start = timeToMinutes(candidate.startTime)
  const end = timeToMinutes(candidate.endTime)
  if (end <= start) throw new Error('End time must be after start time')

  return existingRules.find((rule) =>
    rule.id !== ('id' in candidate ? (candidate as { id?: string }).id : undefined) &&
    rule.active &&
    rule.weekday === candidate.weekday &&
    start < timeToMinutes(rule.endTime) &&
    end > timeToMinutes(rule.startTime),
  )
}

export async function saveTimetableRule(input: TimetableInput, id?: string): Promise<TimetableRule> {
  requireNonEmpty(input.subjectId, 'Subject')
  requireDate(input.startDate, 'Schedule start date')
  if (input.endDate) requireDate(input.endDate, 'Schedule end date')
  if (input.endDate && input.endDate < input.startDate) throw new Error('Schedule end date cannot be before start date')
  if (input.weekday < 0 || input.weekday > 6) throw new Error('Weekday is invalid')

  const existing = await db.timetableRules.toArray()
  const overlap = findTimetableOverlap(input, existing.filter((rule) => rule.id !== id))
  if (overlap) throw new Error(`This overlaps another ${overlap.kind} in the timetable`)

  const now = nowIso()
  const record: TimetableRule = { ...input, id: id ?? createId(), createdAt: now, updatedAt: now }
  if (!(await db.subjects.get(input.subjectId))) throw new Error('The selected subject does not exist')

  if (id) {
    const previous = await db.timetableRules.get(id)
    if (!previous) throw new Error('Timetable rule no longer exists')
    await db.timetableRules.put({ ...previous, ...input, updatedAt: now })
  } else {
    await db.timetableRules.add(record)
  }
  return (await db.timetableRules.get(record.id)) ?? record
}

export async function listTimetableRules() {
  return (await db.timetableRules.toArray()).filter((rule) => rule.active)
}

export async function listAllTimetableRules() {
  return db.timetableRules.toArray()
}

export async function cancelTimetableRule(id: string, active = false) {
  await db.timetableRules.update(id, { active, updatedAt: nowIso() })
}

export async function saveCalendarEvent(input: CalendarInput, id?: string): Promise<CalendarEvent> {
  requireNonEmpty(input.title, 'Event title')
  requireDate(input.startDate, 'Event start date')
  requireDate(input.endDate, 'Event end date')
  if (input.endDate < input.startDate) throw new Error('Event end date cannot be before start date')

  const now = nowIso()
  const record: CalendarEvent = { ...input, id: id ?? createId(), createdAt: now, updatedAt: now }
  if (id) {
    const previous = await db.calendarEvents.get(id)
    if (!previous) throw new Error('Calendar event no longer exists')
    await db.calendarEvents.put({ ...previous, ...input, updatedAt: now })
  } else {
    const duplicate = await db.calendarEvents
      .filter((event) =>
        event.title.trim().toLowerCase() === input.title.trim().toLowerCase() &&
        event.startDate === input.startDate &&
        event.endDate === input.endDate &&
        event.subjectId === input.subjectId,
      )
      .first()
    if (duplicate) throw new Error('This calendar event is already recorded')
    await db.calendarEvents.add(record)
  }
  return (await db.calendarEvents.get(record.id)) ?? record
}

export async function listCalendarEvents() {
  return db.calendarEvents.orderBy('startDate').toArray()
}

export async function findCalendarConflicts(
  date: string,
  subjectId?: string,
): Promise<CalendarEvent[]> {
  const events = await listCalendarEvents()
  return events.filter((event) =>
    date >= event.startDate &&
    date <= event.endDate &&
    (!event.subjectId || !subjectId || event.subjectId === subjectId),
  )
}

export async function deleteCalendarEvent(id: string) {
  await db.calendarEvents.delete(id)
}
