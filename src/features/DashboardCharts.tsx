import { Bar, ComposedChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DashboardMarksSummary, DashboardSubjectAttendance } from '../data/dashboard'

interface DashboardChartsProps {
  attendance: DashboardSubjectAttendance[]
  marks: DashboardMarksSummary[]
}

export default function DashboardCharts({ attendance, marks }: DashboardChartsProps) {
  const attendanceData = attendance.map((item) => ({
    name: item.code || item.name,
    attendance: item.percentage,
    target: item.target,
  }))
  const marksData = marks
    .filter((item) => item.enteredAssessments > 0)
    .map((item) => ({
      name: item.subjectName,
      percentage: item.percentage,
    }))

  return (
    <div className="premium-analytics-grid">
      <section className="premium-panel premium-chart-panel">
        <div className="premium-panel-heading">
          <div><p>ATTENDANCE</p><h2>Subject-wise performance</h2></div>
        </div>
        {attendanceData.length ? (
          <>
            <div className="premium-chart" aria-label="Subject-wise attendance chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={attendanceData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="name" tick={{ fill: 'var(--chart-text)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: 'var(--chart-text)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: 'var(--chart-cursor)' }}
                    contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Bar dataKey="attendance" name="Attendance" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={38} />
                  <Line type="monotone" dataKey="target" name="Target" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="premium-mobile-analytics">
              {attendance.map((item) => (
                <div className="premium-mobile-chart-row" key={item.subjectId}>
                  <div><span>{item.code || item.name}</span><strong>{item.percentage}%</strong></div>
                  <div className="premium-progress"><span style={{ width: `${item.percentage}%`, background: item.percentage < item.target ? '#f59e0b' : '#6366f1' }} /></div>
                  <small>Target {item.target}%</small>
                </div>
              ))}
            </div>
          </>
        ) : <p className="premium-empty-inline">Add subjects and attendance records to see this chart.</p>}
      </section>

      <section className="premium-panel premium-chart-panel">
        <div className="premium-panel-heading">
          <div><p>PERFORMANCE</p><h2>Internal assessment</h2></div>
        </div>
        {marksData.length ? (
          <div className="premium-chart" aria-label="Internal assessment chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={marksData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--chart-text)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--chart-text)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }} />
                <Bar dataKey="percentage" name="Assessment" fill="#818cf8" radius={[6, 6, 0, 0]} maxBarSize={38} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="premium-empty-inline">No entered assessment marks are available.</p>}
      </section>
    </div>
  )
}
