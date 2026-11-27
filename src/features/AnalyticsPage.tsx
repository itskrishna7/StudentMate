import { useEffect, useState } from 'react'
import { Calculator } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { listSubjects } from '../data/academicRepositories'
import { calculateAttendanceSummary } from '../data/attendance'
import { listAttendanceRecords, listSessions } from '../data/attendanceRepository'
import { calculateAssessmentPercentage } from '../data/grades'
import { listAssessments, listMarks } from '../data/academicsRepository'
import { listSemesters } from '../data/academicRepositories'
import { exportAttendanceCsv, exportSemesterCsv } from '../data/reports'
import type { Assessment, AttendanceRecord, ClassSession, Mark, Semester, Subject } from '../data/models'

export default function AnalyticsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [sessions, setSessions] = useState<ClassSession[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [marks, setMarks] = useState<Mark[]>([])
  const [semesters, setSemesters] = useState<Semester[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void Promise.all([
      listSubjects(true),
      listSessions(),
      listAttendanceRecords(),
      listAssessments(),
      listMarks(),
      listSemesters(),
    ]).then(([subjectRows, sessionRows, recordRows, assessmentRows, markRows, semesterRows]) => {
      if (active) {
        setSubjects(subjectRows)
        setSessions(sessionRows)
        setRecords(recordRows)
        setAssessments(assessmentRows)
        setMarks(markRows)
        setSemesters(semesterRows)
      }
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load analytics')
    })
    return () => { active = false }
  }, [])

  const attendanceData = subjects.map((subject) => {
    const summary = calculateAttendanceSummary(
      sessions.filter((session) => session.subjectId === subject.id),
      records.filter((record) => record.subjectId === subject.id),
      subject.attendanceTarget,
    )
    return { name: subject.code || subject.name, attendance: summary.displayPercentage, target: subject.attendanceTarget, color: subject.color }
  })
  const academicData = subjects.map((subject) => ({
    name: subject.code || subject.name,
    percentage: calculateAssessmentPercentage(
      assessments.filter((assessment) => assessment.subjectId === subject.id),
      marks.filter((mark) => mark.subjectId === subject.id),
    ),
    color: subject.color,
  }))
  const axisTick = { fill: 'var(--chart-text)', fontSize: 12 }
  const tooltipStyle = {
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    boxShadow: 'var(--shadow-popover)',
    fontSize: 13,
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">Academic insights</p><h1>Analytics</h1></div>
        <div className="heading-actions">
          <button className="secondary-button" type="button" onClick={() => exportAttendanceCsv(subjects, sessions, records)}>Attendance CSV</button>
          <button className="primary-button" type="button" onClick={() => exportSemesterCsv(semesters, subjects, assessments, marks)}>Semester report</button>
        </div>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {subjects.length === 0 ? (
        <section className="empty-dashboard"><div className="empty-icon"><Calculator size={30} /></div><h2>No academic data yet</h2><p>Add subjects and attendance or assessment records to populate analytics.</p></section>
      ) : (
        <>
          <div className="analytics-grid">
            <section className="chart-card">
              <div className="section-heading"><div><h2>Attendance by subject</h2><p>Exact records summarized for display</p></div></div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={attendanceData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={axisTick} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'var(--chart-cursor)' }} contentStyle={tooltipStyle} />
                    <Bar dataKey="attendance" radius={[6, 6, 0, 0]}>
                      {attendanceData.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={entry.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="chart-card">
              <div className="section-heading"><div><h2>Assessment performance</h2><p>Entered weighted marks</p></div></div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={academicData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={axisTick} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'var(--chart-cursor)' }} contentStyle={tooltipStyle} />
                    <Bar dataKey="percentage" radius={[6, 6, 0, 0]}>
                      {academicData.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={entry.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
          <section className="insight-list">
            {attendanceData.map((item) => {
              const subject = subjects.find((row) => (row.code || row.name) === item.name)
              const summary = calculateAttendanceSummary(
                sessions.filter((session) => session.subjectId === subject?.id),
                records.filter((record) => record.subjectId === subject?.id),
                subject?.attendanceTarget ?? 75,
              )
              return (
                <article className="insight-card" key={item.name}>
                  <div><h3>{subject?.name ?? item.name}</h3><p>{summary.attended} attended, {summary.missed} missed, {summary.conducted} conducted</p></div>
                  <strong>{item.attendance}%</strong>
                  <p>{summary.classesRequired > 0 ? `${summary.classesRequired} class(es) required to reach ${subject?.attendanceTarget ?? 75}%` : `${summary.maxBunk} class(es) can currently be missed`}</p>
                </article>
              )
            })}
          </section>
        </>
      )}
    </div>
  )
}
