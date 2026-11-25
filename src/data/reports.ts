import { calculateAssessmentPercentage } from './grades'
import { calculateAttendanceSummary } from './attendance'
import type { Assessment, AttendanceRecord, ClassSession, Mark, Semester, Subject } from './models'

function csvEscape(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const content = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => row.map(csvEscape).join(',')),
  ].join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function exportAttendanceCsv(
  subjects: Subject[],
  sessions: ClassSession[],
  records: AttendanceRecord[],
) {
  const rows = subjects.map((subject) => {
    const summary = calculateAttendanceSummary(
      sessions.filter((session) => session.subjectId === subject.id),
      records.filter((record) => record.subjectId === subject.id),
      subject.attendanceTarget,
    )
    return [
      subject.code,
      subject.name,
      summary.attended,
      summary.absent,
      summary.conducted,
      summary.exactPercentage.toFixed(2),
      subject.attendanceTarget,
      summary.classesRequired,
      summary.maxBunk,
    ]
  })
  downloadCsv('studentmate-attendance.csv', [
    'Subject Code', 'Subject', 'Attended', 'Absent', 'Conducted',
    'Exact Percentage', 'Target Percentage', 'Classes Required', 'Maximum Bunk',
  ], rows)
}

export function exportSemesterCsv(
  semesters: Semester[],
  subjects: Subject[],
  assessments: Assessment[],
  marks: Mark[],
) {
  const rows = semesters.flatMap((semester) =>
    subjects.filter((subject) => subject.semesterId === semester.id).map((subject) => {
      const subjectAssessments = assessments.filter((assessment) => assessment.subjectId === subject.id)
      const subjectMarks = marks.filter((mark) => mark.subjectId === subject.id)
      return [
        semester.name,
        subject.code,
        subject.name,
        subject.credits,
        calculateAssessmentPercentage(subjectAssessments, subjectMarks).toFixed(2),
      ]
    }),
  )
  downloadCsv('studentmate-semester-report.csv', [
    'Semester', 'Subject Code', 'Subject', 'Credits', 'Assessment Percentage',
  ], rows)
}
