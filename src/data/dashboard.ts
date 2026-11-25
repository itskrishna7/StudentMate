import { db } from './database'
import { calculateAttendanceSummary } from './attendance'
import { calculateAssessmentPercentage, calculateCGPA, calculateSGPA, gradePointForPercentage } from './grades'
import type { AttendanceRecord } from './models'

export interface DashboardSubjectAttendance {
  subjectId: string
  name: string
  code: string
  color: string
  target: number
  attended: number
  conducted: number
  percentage: number
  classesRequired: number
  maxBunk: number
}

export interface DashboardLecture {
  id: string
  subjectId: string
  subjectName: string
  startTime: string
  endTime: string
  room: string
  date: string
  color: string
  status: 'completed' | 'current' | 'upcoming' | 'cancelled' | 'teacher_absent' | 'holiday' | 'extra'
}

export interface DashboardCalendarEvent {
  id: string
  title: string
  date: string
  type: 'holiday' | 'exam' | 'internal_exam' | 'vacation' | 'event' | 'deadline' | 'special'
  subjectName?: string
}

export interface DashboardSemesterProgress {
  name: string
  startDate: string
  endDate: string
  daysCompleted: number
  daysRemaining: number
  percentage: number
}

export interface DashboardExamination {
  id: string
  title: string
  date: string
  type: string
  subjectName?: string
}

export interface DashboardActivity {
  id: string
  subjectName: string
  status: AttendanceRecord['status']
  date: string
}

export interface DashboardMarksSummary {
  subjectId: string
  subjectName: string
  percentage: number
  enteredAssessments: number
  totalAssessments: number
}

export interface DashboardData {
  currentSemester: { id: string; name: string; startDate: string; endDate: string } | null
  activeSubjectCount: number
  overallAttendance: number
  subjectAttendance: DashboardSubjectAttendance[]
  belowTargetSubjects: DashboardSubjectAttendance[]
  todayLectures: DashboardLecture[]
  upcomingLectures: DashboardLecture[]
  upcomingExaminations: DashboardExamination[]
  recentActivity: DashboardActivity[]
  marksSummary: DashboardMarksSummary[]
  currentSGPA: number | null
  overallCGPA: number | null
  upcomingCalendarEvents: DashboardCalendarEvent[]
  semesterProgress: DashboardSemesterProgress | null
}

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function loadDashboardData(now: Date = new Date()): Promise<DashboardData> {
  const [semesters, subjects, sessions, records, timetableRules, events, assessments, marks, gradingScales] =
    await Promise.all([
      db.semesters.toArray(),
      db.subjects.toArray(),
      db.classSessions.toArray(),
      db.attendanceRecords.toArray(),
      db.timetableRules.toArray(),
      db.calendarEvents.toArray(),
      db.assessments.toArray(),
      db.marks.toArray(),
      db.gradingScales.toArray(),
    ])

  const currentSemester = semesters.find((semester) => semester.isCurrent) ??
    (semesters.length ? [...semesters].sort((a, b) => b.startDate.localeCompare(a.startDate))[0] : undefined)

  const activeSubjects = subjects.filter((subject) =>
    !subject.archived &&
    (!currentSemester || subject.semesterId === currentSemester.id),
  )

  const subjectAttendance = activeSubjects.map((subject) => {
    const subjectSessions = sessions.filter((session) => session.subjectId === subject.id)
    const subjectRecords = records.filter((record) => record.subjectId === subject.id)
    const summary = calculateAttendanceSummary(subjectSessions, subjectRecords, subject.attendanceTarget)
    return {
      subjectId: subject.id,
      name: subject.name,
      code: subject.code,
      color: subject.color,
      target: subject.attendanceTarget,
      attended: summary.attended,
      conducted: summary.conducted,
      percentage: summary.displayPercentage,
      classesRequired: summary.classesRequired,
      maxBunk: summary.maxBunk,
    }
  })

  const overallConducted = subjectAttendance.reduce((sum, item) => sum + item.conducted, 0)
  const overallAttended = subjectAttendance.reduce((sum, item) => sum + item.attended, 0)
  const overallAttendance = overallConducted === 0
    ? 0
    : Math.round((overallAttended / overallConducted) * 100)

  const today = dateKey(now)
  const todayWeekday = now.getDay()
  const lectureRows = (rules: typeof timetableRules, dateString: string, weekday: number) => rules
    .filter((rule) => rule.active && rule.weekday === weekday)
    .filter((rule) => rule.startDate <= dateString && (!rule.endDate || rule.endDate >= dateString))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((rule): DashboardLecture => {
      const subject = subjects.find((item) => item.id === rule.subjectId)
      const session = sessions.find((item) => item.timetableRuleId === rule.id && item.date === dateString)
      const isHoliday = events.some((event) =>
        event.type === 'holiday' &&
        dateString >= event.startDate &&
        dateString <= event.endDate &&
        (!event.subjectId || event.subjectId === rule.subjectId),
      )
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      let status: DashboardLecture['status'] = 'upcoming'
      if (session?.status === 'teacher_absent') {
        status = 'teacher_absent'
      } else if (session?.status === 'holiday' || isHoliday) {
        status = 'holiday'
      } else if (session?.status === 'cancelled') {
        status = 'cancelled'
      } else if (dateString === today && rule.endTime <= currentTime) {
        status = 'completed'
      } else if (dateString === today && rule.startTime <= currentTime && rule.endTime >= currentTime) {
        status = 'current'
      }
      return {
        id: rule.id,
        subjectId: rule.subjectId,
        subjectName: subject?.name ?? 'Unknown subject',
        startTime: rule.startTime,
        endTime: rule.endTime,
        room: rule.room,
        date: dateString,
        color: subject?.color ?? '#4f46e5',
        status,
      }
    })

  const todayLectures = lectureRows(timetableRules, today, todayWeekday)
  for (const session of sessions.filter((item) =>
    item.date === today &&
    item.status === 'conducted' &&
    (item.timetableRuleId === 'extra' || item.rescheduledFromId),
  )) {
    const subject = subjects.find((item) => item.id === session.subjectId)
    if (!todayLectures.some((lecture) => lecture.id === session.id)) {
      todayLectures.push({
        id: session.id,
        subjectId: session.subjectId,
        subjectName: subject?.name ?? 'Unknown subject',
        startTime: 'Extra',
        endTime: '',
        room: 'Extra / rescheduled',
        date: today,
        color: subject?.color ?? '#4f46e5',
        status: 'extra',
      })
    }
  }

  const upcomingLectures: DashboardLecture[] = []
  for (let offset = 1; offset <= 14 && upcomingLectures.length < 8; offset += 1) {
    const date = new Date(now)
    date.setDate(date.getDate() + offset)
    const dateString = dateKey(date)
    const weekday = date.getDay()
    const rows = lectureRows(timetableRules, dateString, weekday)
    for (const lecture of rows) upcomingLectures.push({ ...lecture, id: `${lecture.id}-${dateString}` })
  }

  const upcomingExaminations = events
    .filter((event) => (event.type === 'exam' || event.type === 'internal_exam') && event.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 6)
    .map((event) => {
      const subjectName = event.subjectId
        ? subjects.find((subject) => subject.id === event.subjectId)?.name
        : undefined
      return {
        id: event.id,
        title: event.title,
        date: event.startDate,
        type: event.type,
        ...(subjectName ? { subjectName } : {}),
      }
    })

  const upcomingCalendarEvents: DashboardCalendarEvent[] = events
    .filter((event) =>
      event.endDate >= today &&
      event.type !== 'exam' &&
      event.type !== 'internal_exam',
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 6)
    .map((event) => {
      const subjectName = event.subjectId
        ? subjects.find((subject) => subject.id === event.subjectId)?.name
        : undefined
      return {
        id: event.id,
        title: event.title,
        date: event.startDate,
        type: event.type,
        ...(subjectName ? { subjectName } : {}),
      }
    })

  const recordsBySession = new Map(records.map((record) => [record.sessionId, record]))
  const recentActivity = [...sessions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
    .map((session) => recordsBySession.get(session.id))
    .filter((record): record is AttendanceRecord => Boolean(record))
    .slice(0, 6)
    .map((record) => ({
      id: record.id,
      subjectName: subjects.find((subject) => subject.id === record.subjectId)?.name ?? 'Unknown subject',
      status: record.status,
      date: record.recordedAt.slice(0, 10),
    }))

  const marksSummary = activeSubjects.map((subject) => {
    const subjectAssessments = assessments.filter((assessment) => assessment.subjectId === subject.id)
    const subjectMarks = marks.filter((mark) => mark.subjectId === subject.id)
    return {
      subjectId: subject.id,
      subjectName: subject.name,
      percentage: calculateAssessmentPercentage(subjectAssessments, subjectMarks),
      enteredAssessments: subjectAssessments.filter((assessment) =>
        subjectMarks.some((mark) => mark.assessmentId === assessment.id),
      ).length,
      totalAssessments: subjectAssessments.length,
    }
  })

  const defaultScale = gradingScales.find((scale) => scale.isDefault) ?? gradingScales[0]
  let currentSGPA: number | null = null
  if (activeSubjects.length) {
    const entries = activeSubjects.map((subject) => {
      const subjectAssessments = assessments.filter((assessment) => assessment.subjectId === subject.id)
      const subjectMarks = marks.filter((mark) => mark.subjectId === subject.id)
      if (!subjectAssessments.length || !subjectMarks.length) return null
      const percentage = calculateAssessmentPercentage(subjectAssessments, subjectMarks)
      const gradePoint = defaultScale
        ? gradePointForPercentage(percentage, defaultScale.boundaries)?.gradePoint
        : undefined
      return gradePoint === undefined
        ? null
        : { credits: subject.credits, gradePoint }
    }).filter((entry): entry is { credits: number; gradePoint: number } => entry !== null)
    if (entries.length && entries.some((entry) => entry.credits > 0)) {
      currentSGPA = calculateSGPA(entries, defaultScale?.decimalPrecision ?? 2)
    }
  }

  let overallCGPA: number | null = null
  if (currentSemester && activeSubjects.length) {
    const semesterRows = semesters.map((semester) => {
      const semesterSubjects = subjects.filter((subject) => subject.semesterId === semester.id && !subject.archived)
      if (!semesterSubjects.length) return null
      const entries = semesterSubjects.map((subject) => {
        const subjectAssessments = assessments.filter((assessment) => assessment.subjectId === subject.id)
        const subjectMarks = marks.filter((mark) => mark.subjectId === subject.id)
        if (!subjectAssessments.length || !subjectMarks.length) return null
        const percentage = calculateAssessmentPercentage(subjectAssessments, subjectMarks)
        const gradePoint = defaultScale
          ? gradePointForPercentage(percentage, defaultScale.boundaries)?.gradePoint
          : undefined
        return gradePoint === undefined ? null : { credits: subject.credits, gradePoint }
      }).filter((entry): entry is { credits: number; gradePoint: number } => entry !== null)
      return entries.length
        ? { sgpa: calculateSGPA(entries, defaultScale?.decimalPrecision ?? 2), credits: entries.reduce((sum, entry) => sum + entry.credits, 0) }
        : null
    }).filter((entry): entry is { sgpa: number; credits: number } => entry !== null)
    if (semesterRows.length) overallCGPA = calculateCGPA(semesterRows, defaultScale?.decimalPrecision ?? 2)
  }

  let semesterProgress: DashboardSemesterProgress | null = null
  if (currentSemester) {
    const start = Date.parse(`${currentSemester.startDate}T00:00:00`)
    const end = Date.parse(`${currentSemester.endDate}T00:00:00`)
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      const todayStart = Date.parse(`${today}T00:00:00`)
      const totalDays = Math.max(1, Math.round((end - start) / 86400000) + 1)
      const daysCompleted = Math.min(totalDays, Math.max(0, Math.round((todayStart - start) / 86400000) + 1))
      const daysRemaining = Math.max(0, totalDays - daysCompleted)
      semesterProgress = {
        name: currentSemester.name,
        startDate: currentSemester.startDate,
        endDate: currentSemester.endDate,
        daysCompleted,
        daysRemaining,
        percentage: Math.round((daysCompleted / totalDays) * 100),
      }
    }
  }

  return {
    currentSemester: currentSemester
      ? { id: currentSemester.id, name: currentSemester.name, startDate: currentSemester.startDate, endDate: currentSemester.endDate }
      : null,
    activeSubjectCount: activeSubjects.length,
    overallAttendance,
    subjectAttendance,
    belowTargetSubjects: subjectAttendance.filter((item) => item.conducted > 0 && item.percentage < item.target),
    todayLectures,
    upcomingLectures,
    upcomingExaminations,
    recentActivity,
    marksSummary,
    currentSGPA,
    overallCGPA,
    upcomingCalendarEvents,
    semesterProgress,
  }
}
