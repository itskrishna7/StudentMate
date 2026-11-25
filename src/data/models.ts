export interface BaseRecord {
  id: string
  createdAt: string
  updatedAt: string
}

export interface Semester extends BaseRecord {
  name: string
  startDate: string
  endDate: string
  isCurrent: boolean
}

export interface Subject extends BaseRecord {
  semesterId: string
  name: string
  code: string
  facultyName: string
  credits: number
  kind: 'theory' | 'practical' | 'laboratory'
  attendanceTarget: number
  color: string
  archived: boolean
}

export interface TimetableRule extends BaseRecord {
  subjectId: string
  weekday: number
  startTime: string
  endTime: string
  facultyName: string
  room: string
  kind: 'lecture' | 'break' | 'laboratory'
  recurring: boolean
  startDate: string
  endDate?: string
  active: boolean
}

export interface CalendarEvent extends BaseRecord {
  title: string
  type: 'holiday' | 'exam' | 'internal_exam' | 'vacation' | 'event' | 'deadline' | 'special'
  startDate: string
  endDate: string
  recurring: boolean
  subjectId?: string
  notes: string
}

export type SessionStatus = 'scheduled' | 'conducted' | 'teacher_absent' | 'cancelled' | 'holiday'
export interface ClassSession extends BaseRecord {
  date: string
  timetableRuleId: string
  subjectId: string
  status: SessionStatus
  rescheduledFromId?: string
  notes: string
}

export type AttendanceStatus = 'present' | 'absent' | 'extra' | 'rescheduled'
export interface AttendanceRecord extends BaseRecord {
  sessionId: string
  subjectId: string
  status: AttendanceStatus
  recordedAt: string
}

export interface ChangeLog extends BaseRecord {
  entityType: 'attendance' | 'schedule'
  entityId: string
  action: string
  previousValue: string
  newValue: string
  reason: string
}

export interface Assessment extends BaseRecord {
  subjectId: string
  name: string
  type: 'assignment' | 'quiz' | 'mid_semester' | 'practical' | 'other'
  maxMarks: number
  weight: number
  date?: string
}

export interface Mark extends BaseRecord {
  assessmentId: string
  subjectId: string
  marksObtained: number
  enteredAt: string
}

export interface GradeBoundary {
  minPercentage: number
  gradePoint: number
  label: string
  pass: boolean
}

export interface GradingScale extends BaseRecord {
  name: string
  boundaries: GradeBoundary[]
  passingPercentage: number
  decimalPrecision: number
  isDefault: boolean
}

export interface AppSetting extends BaseRecord {
  key: string
  value: string
}

export interface ImportJob extends BaseRecord {
  kind: 'academic_calendar' | 'timetable'
  fileName: string
  status: 'processing' | 'review' | 'confirmed' | 'failed'
  sourceType: 'pdf' | 'image'
  extractedData: string
  confidence: number
  error?: string
}
