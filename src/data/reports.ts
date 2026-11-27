import { calculateAssessmentPercentage } from './grades'
import { calculateAttendanceSummary } from './attendance'
import type { Assessment, AttendanceRecord, ClassSession, Mark, Semester, Subject, SubjectMarkingScheme } from './models'

export function neutralizeCsvFormula(value: string | number): string {
  const cleaned = Array.from(String(value))
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || code >= 32
    })
    .join('')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^\s+/, '')
  return /^[=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned
}

function csvEscape(value: string | number): string {
  let text = neutralizeCsvFormula(value)
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`
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
  markingSchemes: Record<string, SubjectMarkingScheme> = {},
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
        calculateAssessmentPercentage(subjectAssessments, subjectMarks, markingSchemes[subject.id]).toFixed(2),
      ]
    }),
  )
  downloadCsv('studentmate-semester-report.csv', [
    'Semester', 'Subject Code', 'Subject', 'Credits', 'Assessment Percentage',
  ], rows)
}
