import Dexie, { type Table } from 'dexie'
import type {
  AppSetting, Assessment, CalendarEvent, ChangeLog, ClassSession,
  AttendanceRecord, GradingScale, ImportJob, Mark, Semester,
  Subject, TimetableRule,
} from './models'

export class StudentMateDatabase extends Dexie {
  semesters!: Table<Semester, string>
  subjects!: Table<Subject, string>
  timetableRules!: Table<TimetableRule, string>
  calendarEvents!: Table<CalendarEvent, string>
  classSessions!: Table<ClassSession, string>
  attendanceRecords!: Table<AttendanceRecord, string>
  attendanceChangeLog!: Table<ChangeLog, string>
  scheduleChangeLog!: Table<ChangeLog, string>
  assessments!: Table<Assessment, string>
  marks!: Table<Mark, string>
  gradingScales!: Table<GradingScale, string>
  appSettings!: Table<AppSetting, string>
  importJobs!: Table<ImportJob, string>

  constructor(name = 'StudentMate') {
    super(name)
    this.version(1).stores({
      semesters: 'id, name, startDate, endDate, isCurrent',
      subjects: 'id, semesterId, code, kind, archived',
      timetableRules: 'id, subjectId, weekday, startDate, endDate, active',
      calendarEvents: 'id, type, startDate, endDate, recurring, subjectId',
      classSessions: 'id, date, timetableRuleId, subjectId, status',
      attendanceRecords: 'id, sessionId, subjectId, status, recordedAt',
      attendanceChangeLog: 'id, entityType, entityId, action',
      scheduleChangeLog: 'id, entityType, entityId, action',
      assessments: 'id, subjectId, type, date',
      marks: 'id, assessmentId, subjectId',
      gradingScales: 'id, name, isDefault',
      appSettings: 'id, &key',
      importJobs: 'id, kind, status, sourceType, createdAt',
    })
  }
}

const isDemoMode = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('demo') === '1'

export const db = new StudentMateDatabase(isDemoMode ? 'StudentMate-Demo' : 'StudentMate')
