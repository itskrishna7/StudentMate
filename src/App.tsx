import { lazy, Suspense, useEffect, useState } from 'react'
import { Archive, Moon, Sun, GraduationCap, LayoutDashboard, Settings, Wifi, WifiOff, BookOpen, Plus, Pencil, Trash2, CalendarDays, Clock3, ClipboardCheck, Calculator, FileUp, BarChart3, DatabaseBackup, AlertTriangle, ArrowRight, CheckCircle2, MapPin, Timer, TrendingUp } from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { initializeDatabaseSettings } from './data/settings'
import { checkDatabaseHealth } from './data/health'
import type { CalendarEvent, Semester, Subject, TimetableRule } from './data/models'
import { archiveSubject, deleteSubject, listSemesters, listSubjects, saveSemester, saveSubject } from './data/academicRepositories'
import { cancelTimetableRule, listAllTimetableRules, listCalendarEvents, saveCalendarEvent, saveTimetableRule } from './data/timetableCalendar'
import type { Assessment, AttendanceStatus, AttendanceRecord, ClassSession, GradingScale, Mark, SubjectMarkingScheme } from './data/models'
import { listAttendanceRecords, listSessions, markAttendance, markDayAsHoliday, saveClassSession, setSessionStatus } from './data/attendanceRepository'
import { calculateAttendanceSummary } from './data/attendance'
import { calculateAssessmentPercentage, calculateCGPA, calculateSGPA, gradeForSubjectPercentage, requiredMarks } from './data/grades'
import { deleteAssessment, deleteMark, listAssessments, listMarks, saveAssessment, saveMark, saveGradingScale, listGradingScales } from './data/academicsRepository'
import { listSubjectMarkingSchemes, saveSubjectMarkingScheme } from './data/markingSchemes'
import { buildImportReview, extractDocument, findSubjectMatch, reviewStateForItem, saveImportJob, validateImportFile, type DocumentExtraction, type DocumentType, type ExtractedReviewItem, type ExtractionProgress, type ImportReview, type ReviewState } from './data/importProcessing'
import { createFullBackup, downloadJsonBackup, previewRestore, restoreBackup, validateBackupText, type RestorePreview, type StudentMateBackup } from './data/backup'
import { loadDashboardData, type DashboardData } from './data/dashboard'
import { enterDemoMode, isDemoMode, resetDemoData, seedDemoData } from './data/demo'
import { ConfirmDialogProvider } from './components/ConfirmDialog'
import { useConfirmDialog } from './components/confirmDialogContext'

const AnalyticsPage = lazy(() => import('./features/AnalyticsPage'))
const DashboardCharts = lazy(() => import('./features/DashboardCharts'))
const AcademicPerformancePage = lazy(() => import('./features/AcademicPerformancePage'))
const AcademicPerformanceWidget = lazy(() => import('./features/AcademicPerformancePage').then((module) => ({
  default: module.AcademicPerformanceWidget,
})))

type Theme = 'light' | 'dark'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function getInitialTheme(): Theme {
  const saved = localStorage.getItem('studentmate-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function AppShell() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [online, setOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const location = useLocation()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('studentmate-theme', theme)
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#101216' : '#f6f7fb',
    )
  }, [theme])

  useEffect(() => {
    initializeDatabaseSettings().catch((error: unknown) => {
      console.error('Could not initialize local database settings', error)
    })
  }, [])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
    }
  }, [])

  const toggleTheme = () => setTheme((current) => (current === 'light' ? 'dark' : 'light'))

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <Link className="brand" to="/" aria-label="StudentMate dashboard">
          <span className="brand-mark"><GraduationCap size={22} /></span>
          <span>StudentMate</span>
        </Link>
        <nav className="side-nav">
          <div className="nav-group">
            <span className="nav-group-label">Workspace</span>
            <Link aria-current={location.pathname === '/' ? 'page' : undefined} className={location.pathname === '/' ? 'nav-item active' : 'nav-item'} to="/">
              <LayoutDashboard size={18} />
              <span>Dashboard</span>
            </Link>
            <Link aria-current={location.pathname === '/subjects' ? 'page' : undefined} className={location.pathname === '/subjects' ? 'nav-item active' : 'nav-item'} to="/subjects">
              <BookOpen size={18} />
              <span>Subjects</span>
            </Link>
            <Link aria-current={location.pathname === '/timetable' ? 'page' : undefined} className={location.pathname === '/timetable' ? 'nav-item active' : 'nav-item'} to="/timetable">
              <Clock3 size={18} />
              <span>Timetable</span>
            </Link>
            <Link aria-current={location.pathname === '/calendar' ? 'page' : undefined} className={location.pathname === '/calendar' ? 'nav-item active' : 'nav-item'} to="/calendar">
              <CalendarDays size={18} />
              <span>Calendar</span>
            </Link>
            <Link aria-current={location.pathname === '/attendance' ? 'page' : undefined} className={location.pathname === '/attendance' ? 'nav-item active' : 'nav-item'} to="/attendance">
              <ClipboardCheck size={18} />
              <span>Attendance</span>
            </Link>
          </div>
          <div className="nav-group">
            <span className="nav-group-label">Study</span>
            <Link aria-current={location.pathname === '/academics' ? 'page' : undefined} className={location.pathname === '/academics' ? 'nav-item active' : 'nav-item'} to="/academics">
              <Calculator size={18} />
              <span>Academics</span>
            </Link>
            <Link aria-current={location.pathname === '/performance' ? 'page' : undefined} className={location.pathname === '/performance' ? 'nav-item active' : 'nav-item'} to="/performance">
              <GraduationCap size={18} />
              <span>Performance</span>
            </Link>
            <Link aria-current={location.pathname === '/analytics' ? 'page' : undefined} className={location.pathname === '/analytics' ? 'nav-item active' : 'nav-item'} to="/analytics">
              <BarChart3 size={18} />
              <span>Analytics</span>
            </Link>
          </div>
          <div className="nav-group">
            <span className="nav-group-label">Tools</span>
            <Link aria-current={location.pathname === '/import' ? 'page' : undefined} className={location.pathname === '/import' ? 'nav-item active' : 'nav-item'} to="/import">
              <FileUp size={18} />
              <span>Import</span>
            </Link>
            <Link aria-current={location.pathname === '/backup' ? 'page' : undefined} className={location.pathname === '/backup' ? 'nav-item active' : 'nav-item'} to="/backup">
              <DatabaseBackup size={18} />
              <span>Backup</span>
            </Link>
            <Link aria-current={location.pathname === '/settings' ? 'page' : undefined} className={location.pathname === '/settings' ? 'nav-item active' : 'nav-item'} to="/settings">
              <Settings size={18} />
              <span>Settings</span>
            </Link>
          </div>
        </nav>
        <div className="sidebar-status" title={online ? 'Online' : 'Offline'}>
          {online ? <Wifi size={16} /> : <WifiOff size={16} />}
          <span>{online ? 'Online' : 'Offline'}</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <Link className="mobile-brand" to="/" aria-label="StudentMate dashboard">
            <span className="brand-mark"><GraduationCap size={20} /></span>
            <span>StudentMate</span>
          </Link>
          <div className="topbar-actions">
            {installPrompt && (
              <button className="install-button" type="button" onClick={async () => {
                await installPrompt.prompt()
                await installPrompt.userChoice
                setInstallPrompt(null)
              }}>Install app</button>
            )}
            <span className="connection-status">
              {online ? <Wifi size={15} /> : <WifiOff size={15} />}
              {online ? 'Online' : 'Offline'}
            </span>
            <button className="icon-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </header>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          <Link aria-current={location.pathname === '/' ? 'page' : undefined} className={location.pathname === '/' ? 'mobile-nav-item active' : 'mobile-nav-item'} to="/"><LayoutDashboard size={17} /><span>Home</span></Link>
          <Link aria-current={location.pathname === '/subjects' ? 'page' : undefined} className={location.pathname === '/subjects' ? 'mobile-nav-item active' : 'mobile-nav-item'} to="/subjects"><BookOpen size={17} /><span>Subjects</span></Link>
          <Link aria-current={location.pathname === '/timetable' ? 'page' : undefined} className={location.pathname === '/timetable' ? 'mobile-nav-item active' : 'mobile-nav-item'} to="/timetable"><Clock3 size={17} /><span>Timetable</span></Link>
          <Link aria-current={location.pathname === '/calendar' ? 'page' : undefined} className={location.pathname === '/calendar' ? 'mobile-nav-item active' : 'mobile-nav-item'} to="/calendar"><CalendarDays size={17} /><span>Calendar</span></Link>
          <Link aria-current={location.pathname === '/attendance' ? 'page' : undefined} className={location.pathname === '/attendance' ? 'mobile-nav-item active' : 'mobile-nav-item'} to="/attendance"><ClipboardCheck size={17} /><span>Attendance</span></Link>
          <Link aria-current={location.pathname === '/academics' ? 'page' : undefined} className={location.pathname === '/academics' ? 'mobile-nav-item active' : 'mobile-nav-item'} to="/academics"><Calculator size={17} /><span>Academics</span></Link>
          <Link aria-current={location.pathname === '/performance' ? 'page' : undefined} className={location.pathname === '/performance' ? 'mobile-nav-item active' : 'mobile-nav-item'} to="/performance"><GraduationCap size={17} /><span>Performance</span></Link>
          <Link aria-current={location.pathname === '/import' ? 'page' : undefined} className={location.pathname === '/import' ? 'mobile-nav-item active' : 'mobile-nav-item'} to="/import"><FileUp size={17} /><span>Import</span></Link>
          <Link aria-current={location.pathname === '/analytics' ? 'page' : undefined} className={location.pathname === '/analytics' ? 'mobile-nav-item active' : 'mobile-nav-item'} to="/analytics"><BarChart3 size={17} /><span>Analytics</span></Link>
          <Link aria-current={location.pathname === '/backup' ? 'page' : undefined} className={location.pathname === '/backup' ? 'mobile-nav-item active' : 'mobile-nav-item'} to="/backup"><DatabaseBackup size={17} /><span>Backup</span></Link>
          <Link aria-current={location.pathname === '/settings' ? 'page' : undefined} className={location.pathname === '/settings' ? 'mobile-nav-item active' : 'mobile-nav-item'} to="/settings"><Settings size={17} /><span>Settings</span></Link>
        </nav>

        {!online && (
          <div className="offline-banner" role="status">
            <WifiOff size={16} />
            Offline - local academic data and cached pages remain available.
          </div>
        )}
        {isDemoMode() && (
          <div className="demo-banner" role="status">
            Sample data mode - entirely fictional records are isolated from your real database.
          </div>
        )}

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/subjects" element={<SubjectsPage />} />
          <Route path="/timetable" element={<TimetablePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/academics" element={<AcademicsPage />} />
          <Route path="/performance" element={<Suspense fallback={<div className="page"><div className="loading-card" role="status">Loading academic performance...</div></div>}><AcademicPerformancePage /></Suspense>} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/analytics" element={<Suspense fallback={<div className="page"><div className="loading-card" role="status">Loading analytics...</div></div>}><AnalyticsPage /></Suspense>} />
          <Route path="/backup" element={<BackupPage />} />
          <Route path="/settings" element={<SettingsPage theme={theme} toggleTheme={toggleTheme} installPrompt={installPrompt} onInstall={async () => {
            if (!installPrompt) return
            await installPrompt.prompt()
            await installPrompt.userChoice
            setInstallPrompt(null)
          }} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let active = true
    const refresh = () => {
      loadDashboardData().then((value) => {
        if (active) setData(value)
      }).catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load dashboard')
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(() => setNow(new Date()), 60000)
    return () => {
      active = false
      window.removeEventListener('focus', refresh)
      window.clearInterval(timer)
    }
  }, [])

  if (!data) {
    return (
      <div className="page premium-dashboard">
        <div className="premium-skeleton-header" />
        <div className="premium-skeleton-grid">{[0,1,2,3].map((item) => <div className="premium-skeleton-card" key={item} />)}</div>
        <div className="premium-skeleton-columns"><div /><div /></div>
      </div>
    )
  }

  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const todayText = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const nextLecture = data.todayLectures.find((lecture) =>
    lecture.status === 'current' || lecture.status === 'upcoming',
  ) ?? data.upcomingLectures.find((lecture) => lecture.date >= todayText)

  const countdown = (() => {
    if (!nextLecture || nextLecture.status === 'extra' || nextLecture.startTime === 'Extra') return null
    const [hours, minutes] = nextLecture.startTime.split(':').map(Number)
    const lectureDate = new Date(`${nextLecture.date}T00:00:00`)
    lectureDate.setHours(hours ?? 0, minutes ?? 0, 0, 0)
    const remaining = lectureDate.getTime() - now.getTime()
    if (remaining < 0) return null
    const totalMinutes = Math.ceil(remaining / 60000)
    const hoursRemaining = Math.floor(totalMinutes / 60)
    const minutesRemaining = totalMinutes % 60
    return hoursRemaining > 0 ? `${hoursRemaining}h ${minutesRemaining}m` : `${minutesRemaining}m`
  })()

  const daysUntil = (date: string) => {
    const target = new Date(`${date}T00:00:00`)
    const today = new Date(`${todayText}T00:00:00`)
    return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86400000))
  }

  const retry = () => {
    setError('')
    loadDashboardData().then(setData).catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'Could not load dashboard'),
    )
  }

  return (
    <div className="page premium-dashboard">
      <header className="premium-welcome">
        <div>
          <p className="premium-eyebrow">{dateLabel}</p>
          <h1>{greeting}! <span>Here is your academic overview.</span></h1>
          {data.currentSemester && <p className="premium-semester"><span className="premium-live-dot" />{data.currentSemester.name}</p>}
        </div>
        <div className="premium-quick-actions" aria-label="Quick actions">
          <Link className="premium-action premium-action-primary" to="/attendance"><ClipboardCheck size={17} />Mark attendance</Link>
          <Link className="premium-action" to="/timetable"><Plus size={17} />Add lecture</Link>
          <Link className="premium-action" to="/subjects"><BookOpen size={17} />Add subject</Link>
          <Link className="premium-action" to="/calendar"><CalendarDays size={17} />Add event</Link>
        </div>
      </header>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {error && <button className="premium-retry" type="button" onClick={retry}>Retry dashboard</button>}

      {data.activeSubjectCount === 0 ? (
        <section className="premium-empty-dashboard" aria-label="Academic overview">
          <div className="premium-empty-icon"><GraduationCap size={28} /></div>
          <div><p>READY WHEN YOU ARE</p><h2>Build your academic workspace</h2><span>Add a semester and subject to unlock attendance, timetable and performance insights.</span></div>
          <Link className="premium-action premium-action-primary" to="/subjects">Add first subject <ArrowRight size={16} /></Link>
        </section>
      ) : (
        <>
          <div className="premium-summary-grid">
            <article className="premium-summary-card">
              <div className="premium-card-top"><span>Overall attendance</span><div className="premium-card-icon indigo"><TrendingUp size={18} /></div></div>
              <div className="premium-summary-value"><strong>{data.overallAttendance}%</strong><span className={data.overallAttendance >= 75 ? 'positive' : 'warning'}>{data.overallAttendance >= 75 ? 'On track' : 'Needs attention'}</span></div>
              <div className="premium-progress"><span style={{ width: `${data.overallAttendance}%` }} /></div>
              <p>{data.subjectAttendance.reduce((sum, item) => sum + item.attended, 0)} attended · {data.subjectAttendance.reduce((sum, item) => sum + item.conducted, 0)} conducted</p>
            </article>
            <article className="premium-summary-card">
              <div className="premium-card-top"><span>Active subjects</span><div className="premium-card-icon blue"><BookOpen size={18} /></div></div>
              <div className="premium-summary-value"><strong>{data.activeSubjectCount}</strong><span>{data.belowTargetSubjects.length} below target</span></div>
              <p>{data.currentSemester ? 'Current semester subjects' : 'Subjects available'}</p>
            </article>
            <article className="premium-summary-card">
              <div className="premium-card-top"><span>CGPA</span><div className="premium-card-icon violet"><GraduationCap size={18} /></div></div>
              <div className="premium-summary-value"><strong>{data.overallCGPA === null ? '—' : data.overallCGPA.toFixed(2)}</strong><span>{data.currentSGPA === null ? 'No SGPA yet' : `SGPA ${data.currentSGPA.toFixed(2)}`}</span></div>
              <p>{data.overallCGPA === null ? 'Available after enough marks are entered' : 'Calculated from available results'}</p>
            </article>
            <article className="premium-summary-card">
              <div className="premium-card-top"><span>Next examination</span><div className="premium-card-icon amber"><CalendarDays size={18} /></div></div>
              {data.upcomingExaminations[0] ? (
                <>
                  <div className="premium-exam-next"><strong>{data.upcomingExaminations[0].title}</strong><span>{daysUntil(data.upcomingExaminations[0].date)} days</span></div>
                  <p>{new Date(`${data.upcomingExaminations[0].date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                </>
              ) : <><strong className="premium-no-data">No exams scheduled</strong><p>Upcoming examinations will appear here.</p></>}
            </article>
          </div>

          <div className="premium-main-grid">
            <div className="premium-main-column">
              <section className="premium-panel">
                <div className="premium-panel-heading">
                  <div><p>DAY PLAN</p><h2>Today's timetable</h2></div>
                  <div className="premium-panel-actions">
                    {countdown && <span className="premium-countdown"><Timer size={14} />{countdown} to next class</span>}
                    <Link className="premium-panel-link" to="/timetable">View timetable <ArrowRight size={14} /></Link>
                  </div>
                </div>
                {data.todayLectures.length === 0 ? (
                  <div className="premium-empty-inline"><Clock3 size={18} /><span>No lectures scheduled today.</span></div>
                ) : (
                  <div className="premium-timeline">
                    {data.todayLectures.map((lecture) => (
                      <article className={`premium-timeline-item ${lecture.status}`} key={lecture.id}>
                        <div className="premium-timeline-time">
                          <strong>{lecture.startTime === 'Extra' ? 'Extra' : lecture.startTime}</strong>
                          {lecture.endTime && <span>{lecture.endTime}</span>}
                        </div>
                        <div className="premium-timeline-marker" style={{ '--subject-color': lecture.color } as React.CSSProperties}>
                          {lecture.status === 'completed' ? <CheckCircle2 size={15} /> : lecture.status === 'cancelled' ? <AlertTriangle size={15} /> : <span />}
                        </div>
                        <div className="premium-timeline-content">
                          <div><h3>{lecture.subjectName}</h3><span className={`premium-status ${lecture.status}`}>{lecture.status}</span></div>
                          <p><MapPin size={13} />{lecture.room || 'Location not set'}{lecture.status === 'current' ? ' · Happening now' : ''}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="premium-panel">
                <div className="premium-panel-heading">
                  <div><p>ATTENDANCE</p><h2>Subjects needing attention</h2></div>
                  <Link className="premium-panel-link" to="/attendance">Mark attendance <ArrowRight size={14} /></Link>
                </div>
                {data.belowTargetSubjects.length === 0 ? (
                  <div className="premium-empty-inline"><CheckCircle2 size={18} /><span>No subjects are below their attendance target.</span></div>
                ) : (
                  <div className="premium-warning-list">
                    {data.belowTargetSubjects.map((item) => (
                      <article className="premium-warning-row" key={item.subjectId}>
                        <div className="premium-warning-dot" style={{ background: item.color }} />
                        <div><h3>{item.name}</h3><p>{item.percentage}% attendance · Target {item.target}%</p></div>
                        <strong>{item.classesRequired > 0 ? `${item.classesRequired} required` : 'At target'}</strong>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <aside className="premium-side-column">
              <section className="premium-panel">
                <div className="premium-panel-heading">
                  <div><p>EXAMINATIONS</p><h2>Upcoming</h2></div>
                  <Link className="premium-panel-link" to="/calendar">Calendar <ArrowRight size={14} /></Link>
                </div>
                {data.upcomingExaminations.length === 0 ? (
                  <div className="premium-empty-inline"><CalendarDays size={18} /><span>No upcoming examinations.</span></div>
                ) : (
                  <div className="premium-exam-list">
                    {data.upcomingExaminations.slice(0, 4).map((exam) => (
                      <article className="premium-exam-row" key={exam.id}>
                        <div className="premium-exam-date"><strong>{new Date(`${exam.date}T00:00:00`).getDate()}</strong><span>{new Date(`${exam.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short' })}</span></div>
                        <div><h3>{exam.subjectName ? `${exam.subjectName} — ${exam.title}` : exam.title}</h3><p>{exam.type.replace('_', ' ')} · {daysUntil(exam.date)} days</p></div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="premium-panel">
                <div className="premium-panel-heading">
                  <div><p>CALENDAR</p><h2>Coming up</h2></div>
                  <Link className="premium-panel-link" to="/calendar">View all <ArrowRight size={14} /></Link>
                </div>
                {data.upcomingCalendarEvents.length === 0 ? (
                  <div className="premium-empty-inline"><CalendarDays size={18} /><span>No upcoming calendar events.</span></div>
                ) : (
                  <div className="premium-calendar-list">
                    {data.upcomingCalendarEvents.slice(0, 5).map((event) => (
                      <article key={event.id}>
                        <span className={`premium-event-dot ${event.type}`} />
                        <div><h3>{event.subjectName ? `${event.subjectName} — ${event.title}` : event.title}</h3><p>{new Date(`${event.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {event.type.replace('_', ' ')}</p></div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="premium-panel">
                <div className="premium-panel-heading"><div><p>ACTIVITY</p><h2>Recent</h2></div></div>
                {data.recentActivity.length === 0 ? (
                  <div className="premium-empty-inline"><Clock3 size={18} /><span>No attendance activity yet.</span></div>
                ) : (
                  <div className="premium-activity-list">
                    {data.recentActivity.slice(0, 5).map((activity) => (
                      <article key={activity.id}>
                        <span className={`premium-activity-icon ${activity.status}`}><ClipboardCheck size={14} /></span>
                        <div><h3>{activity.subjectName}</h3><p>{activity.status} · {activity.date}</p></div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </aside>
          </div>

          <div className="premium-bottom-grid">
            <Suspense fallback={<section className="premium-panel premium-skeleton-chart"><div /></section>}>
              <DashboardCharts attendance={data.subjectAttendance} marks={data.marksSummary} />
            </Suspense>
            <section className="premium-panel premium-progress-card">
              <div className="premium-panel-heading"><div><p>SEMESTER</p><h2>Semester progress</h2></div></div>
              {data.semesterProgress ? (
                <>
                  <div className="premium-progress-ring" style={{ '--progress': `${data.semesterProgress.percentage * 3.6}deg` } as React.CSSProperties}>
                    <div><strong>{data.semesterProgress.percentage}%</strong><span>complete</span></div>
                  </div>
                  <div className="premium-progress-details">
                    <div><span>Started</span><strong>{new Date(`${data.semesterProgress.startDate}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</strong></div>
                    <div><span>Ends</span><strong>{new Date(`${data.semesterProgress.endDate}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</strong></div>
                    <div><span>Remaining</span><strong>{data.semesterProgress.daysRemaining} days</strong></div>
                  </div>
                </>
              ) : (
                <div className="premium-empty-inline"><CalendarDays size={18} /><span>Semester dates are not available.</span></div>
              )}
            </section>
          </div>
        </>
      )}
      <Suspense fallback={<section className="premium-panel"><div className="loading-card" role="status">Loading performance...</div></section>}>
        <AcademicPerformanceWidget />
      </Suspense>
    </div>
  )
}

function SubjectsPage() {
  const { confirm } = useConfirmDialog()
  const [semesters, setSemesters] = useState<Semester[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [semesterEditor, setSemesterEditor] = useState<Semester | 'new' | null>(null)
  const [subjectEditor, setSubjectEditor] = useState<Subject | 'new' | null>(null)
  const [error, setError] = useState('')

  const refresh = async () => {
    const [semesterRows, subjectRows] = await Promise.all([listSemesters(), listSubjects(includeArchived)])
    setSemesters(semesterRows)
    setSubjects(subjectRows)
  }

  useEffect(() => {
    let active = true
    void Promise.all([listSemesters(), listSubjects(includeArchived)])
      .then(([semesterRows, subjectRows]) => {
        if (active) {
          setSemesters(semesterRows)
          setSubjects(subjectRows)
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load academic records')
      })
    return () => { active = false }
  }, [includeArchived])

  const saveAndRefresh = async (operation: () => Promise<unknown>) => {
    setError('')
    try {
      await operation()
      await refresh()
      setSemesterEditor(null)
      setSubjectEditor(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the record')
    }
  }

  const removeSubject = async (subject: Subject) => {
    if (!(await confirm({
      title: 'Delete this subject?',
      description: `"${subject.name}" will be removed. Subjects with academic history must be archived instead.`,
      confirmLabel: 'Delete subject',
      variant: 'danger',
    }))) return
    setError('')
    const result = await deleteSubject(subject.id)
    if (result === 'blocked') {
      setError('This subject has academic history and cannot be deleted. Archive it instead.')
      return
    }
    await refresh()
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">Academic setup</p><h1>Subjects</h1></div>
        <div className="heading-actions">
          <button className="secondary-button" type="button" onClick={() => setSemesterEditor('new')}><Plus size={17} /> Semester</button>
          <button className="primary-button" type="button" onClick={() => setSubjectEditor('new')}><Plus size={17} /> Subject</button>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {semesterEditor && <SemesterEditor record={semesterEditor === 'new' ? null : semesterEditor} onCancel={() => setSemesterEditor(null)} onSave={(input) => saveAndRefresh(() => saveSemester(input, semesterEditor === 'new' ? undefined : semesterEditor.id))} />}
      {subjectEditor && <SubjectEditor semesters={semesters} record={subjectEditor === 'new' ? null : subjectEditor} onCancel={() => setSubjectEditor(null)} onSave={(input) => saveAndRefresh(() => saveSubject(input, subjectEditor === 'new' ? undefined : subjectEditor.id))} />}

      <div className="filter-row">
        <label><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Show archived subjects</label>
      </div>

      {semesters.length === 0 && subjects.length === 0 ? (
        <section className="empty-dashboard"><div className="empty-icon"><BookOpen size={30} /></div><h2>Set up your first semester</h2><p>Add a semester and subject to begin building your academic records.</p></section>
      ) : (
        semesters.map((semester) => (
          <section className="semester-section" key={semester.id}>
            <div className="section-heading">
              <div><h2>{semester.name}</h2><p>{semester.startDate} to {semester.endDate}{semester.isCurrent ? ' - Current' : ''}</p></div>
              <button className="icon-button" type="button" onClick={() => setSemesterEditor(semester)} aria-label={`Edit ${semester.name}`}><Pencil size={17} /></button>
            </div>
            <div className="subject-grid">
              {subjects.filter((subject) => subject.semesterId === semester.id).map((subject) => (
                <article className="subject-card" key={subject.id}>
                  <div className="subject-accent" style={{ background: subject.color }} />
                  <div className="subject-card-main">
                    <div><h3>{subject.name}</h3><p>{subject.code || 'No code'} - {subject.credits} credits</p></div>
                    {subject.archived && <span className="archived-badge">Archived</span>}
                    <p className="subject-meta">{subject.kind} - {subject.attendanceTarget}% target</p>
                  </div>
                  <div className="card-actions">
                    <button className="icon-button" type="button" onClick={() => setSubjectEditor(subject)} aria-label={`Edit ${subject.name}`}><Pencil size={16} /></button>
                    {!subject.archived && <button className="icon-button" type="button" onClick={() => saveAndRefresh(() => archiveSubject(subject.id))} aria-label={`Archive ${subject.name}`}><Archive size={16} /></button>}
                    <button className="icon-button danger" type="button" onClick={() => removeSubject(subject)} aria-label={`Delete ${subject.name}`}><Trash2 size={16} /></button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function SemesterEditor({ record, onCancel, onSave }: { record: Semester | null; onCancel: () => void; onSave: (input: Omit<Semester, 'id' | 'createdAt' | 'updatedAt'>) => void }) {
  const [name, setName] = useState(record?.name ?? '')
  const [startDate, setStartDate] = useState(record?.startDate ?? '')
  const [endDate, setEndDate] = useState(record?.endDate ?? '')
  const [isCurrent, setIsCurrent] = useState(record?.isCurrent ?? false)
  return (
    <form className="editor-card" onSubmit={(event) => { event.preventDefault(); onSave({ name, startDate, endDate, isCurrent }) }}>
      <h2>{record ? 'Edit semester' : 'Add semester'}</h2>
      <div className="form-grid">
        <label>Semester name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Start date<input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label>End date<input required type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={isCurrent} onChange={(event) => setIsCurrent(event.target.checked)} /> Current semester</label>
      <div className="form-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit">Save semester</button></div>
    </form>
  )
}

function AcademicsPage() {
  const { confirm } = useConfirmDialog()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [semesters, setSemesters] = useState<Semester[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [marks, setMarks] = useState<Mark[]>([])
  const [scales, setScales] = useState<GradingScale[]>([])
  const [markingSchemes, setMarkingSchemes] = useState<Record<string, SubjectMarkingScheme>>({})
  const [selectedSubject, setSelectedSubject] = useState('')
  const [assessmentEditor, setAssessmentEditor] = useState(false)
  const [assessmentEditorId, setAssessmentEditorId] = useState<string | undefined>()
  const [scaleEditor, setScaleEditor] = useState(false)
  const [schemeEditor, setSchemeEditor] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [assessmentType, setAssessmentType] = useState<Assessment['type']>('assignment')
  const [category, setCategory] = useState('')
  const [maxMarks, setMaxMarks] = useState('')
  const [weight, setWeight] = useState('')
  const [assessmentDate, setAssessmentDate] = useState('')

  const refresh = async () => {
    const [subjectRows, semesterRows, assessmentRows, markRows, scaleRows, schemeRows] = await Promise.all([
      listSubjects(false),
      listSemesters(),
      listAssessments(),
      listMarks(),
      listGradingScales(),
      listSubjectMarkingSchemes(),
    ])
    setSubjects(subjectRows)
    setSemesters(semesterRows)
    setAssessments(assessmentRows)
    setMarks(markRows)
    setScales(scaleRows)
    setMarkingSchemes(schemeRows)
  }
  useEffect(() => { refresh().catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load academics')) }, [])

  const saveAssessmentAndRefresh = async () => {
    setError('')
    try {
      if (!selectedSubject) throw new Error('Select a subject')
      if (!maxMarks) throw new Error('Enter maximum marks')
      const scheme = markingSchemes[selectedSubject]
      if ((!scheme || scheme.calculationMethod === 'weighted') && !weight.trim()) {
        throw new Error('Enter an assessment weight for weighted calculation')
      }
      await saveAssessment({
        subjectId: selectedSubject,
        name,
        type: assessmentType,
        category: category.trim(),
        maxMarks: Number(maxMarks),
        weight: weight ? Number(weight) : 0,
        date: assessmentDate,
      }, assessmentEditorId)
      setName('')
      setCategory('')
      setMaxMarks('')
      setWeight('')
      setAssessmentDate('')
      setAssessmentEditorId(undefined)
      setAssessmentEditor(false)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save assessment') }
  }

  const startAssessmentEditor = (assessment?: Assessment) => {
    setAssessmentEditorId(assessment?.id)
    if (assessment) {
      setSelectedSubject(assessment.subjectId)
      setName(assessment.name)
      setAssessmentType(assessment.type)
      setCategory(assessment.category ?? '')
      setMaxMarks(String(assessment.maxMarks))
      setWeight(String(assessment.weight))
      setAssessmentDate(assessment.date ?? '')
    } else {
      setName('')
      setAssessmentType('assignment')
      setCategory('')
      setMaxMarks('')
      setWeight('')
      setAssessmentDate('')
    }
    setAssessmentEditor(true)
  }

  const removeAssessment = async (assessment: Assessment) => {
    if (!(await confirm({
      title: 'Delete this assessment?',
      description: `"${assessment.name}" and its entered mark will be deleted.`,
      confirmLabel: 'Delete assessment',
      variant: 'danger',
    }))) return
    try {
      await deleteAssessment(assessment.id)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete assessment')
    }
  }

  const subjectAssessments = assessments.filter((assessment) => assessment.subjectId === selectedSubject)
  const subjectMarks = marks.filter((mark) => mark.subjectId === selectedSubject)
  const selectedScheme = markingSchemes[selectedSubject]
  const percentage = calculateAssessmentPercentage(subjectAssessments, subjectMarks, selectedScheme)
  const configuredMaximum = selectedScheme
    ? (selectedScheme.internalMaxMarks ?? 0) +
      (selectedScheme.externalMaxMarks ?? 0) +
      (selectedScheme.practicalMaxMarks ?? 0)
    : 0
  const defaultScale = scales.find((scale) => scale.isDefault) ?? scales[0]
  const passingPercentage = selectedScheme?.passingPercentage ?? defaultScale?.passingPercentage
  const totalAssessmentWeight = subjectAssessments.reduce((sum, item) => sum + item.weight, 0)
  const remainingAssessmentWeight = subjectAssessments.reduce((sum, item) =>
    sum + (subjectMarks.some((mark) => mark.assessmentId === item.id) ? 0 : item.weight), 0)
  const supportsRequiredMarks = !selectedScheme ||
    (selectedScheme.calculationMethod === 'weighted' && selectedScheme.internalWeightage === undefined)
  const requiredAtTarget = passingPercentage === undefined || !supportsRequiredMarks || totalAssessmentWeight === 0
    ? null
    : requiredMarks(percentage, passingPercentage, (remainingAssessmentWeight / totalAssessmentWeight) * 100)

  const sgpaEntries = subjects.flatMap((subject) => {
    const subjectAssessments = assessments.filter((assessment) => assessment.subjectId === subject.id)
    const subjectMarks = marks.filter((mark) => mark.subjectId === subject.id)
    if (!subjectMarks.length) return []
    const scheme = markingSchemes[subject.id]
    const subjectPercentage = calculateAssessmentPercentage(subjectAssessments, subjectMarks, scheme)
    const gradePoint = gradeForSubjectPercentage(
      subjectPercentage,
      scheme?.boundaries ?? defaultScale?.boundaries ?? [],
      scheme,
    )?.gradePoint
    return gradePoint === undefined ? [] : [{ credits: subject.credits, gradePoint }]
  })
  const sgpa = calculateSGPA(sgpaEntries)
  const cgpa = calculateCGPA(semesters.map((semester) => ({
    sgpa: semester.isCurrent ? sgpa : 0,
    credits: subjects.filter((subject) => subject.semesterId === semester.id).reduce((sum, subject) => sum + subject.credits, 0),
  })))

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">Marks and grades</p><h1>Academics</h1></div>
        <div className="heading-actions">
          <button className="secondary-button" type="button" onClick={() => setScaleEditor(true)}><Calculator size={17} /> Grading scale</button>
          <button className="primary-button" type="button" onClick={() => startAssessmentEditor()}><Plus size={17} /> Assessment</button>
        </div>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}

      {assessmentEditor && (
        <div className="editor-card">
          <h2>{assessmentEditorId ? 'Edit assessment' : 'Add assessment'}</h2>
          <div className="form-grid">
            <label>Subject<select disabled={Boolean(assessmentEditorId)} value={selectedSubject} onChange={(event) => setSelectedSubject(event.target.value)}><option value="">Select subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
            <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>Type<select value={assessmentType} onChange={(event) => setAssessmentType(event.target.value as Assessment['type'])}><option value="assignment">Assignment</option><option value="quiz">Quiz</option><option value="mid_semester">Mid-semester</option><option value="practical">Practical</option><option value="other">Other</option></select></label>
            <label>Category<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="internal, external, practical, or custom" /></label>
            <label>Maximum marks<input required type="number" min="0.01" step="any" value={maxMarks} onChange={(event) => setMaxMarks(event.target.value)} /></label>
            <label>Assessment weight<input required={!markingSchemes[selectedSubject] || markingSchemes[selectedSubject]?.calculationMethod === 'weighted'} type="number" min="0" step="any" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="Only used by weighted rules" /></label>
            <label>Date (optional)<input type="date" value={assessmentDate} onChange={(event) => setAssessmentDate(event.target.value)} /></label>
          </div>
          <div className="form-actions"><button className="secondary-button" type="button" onClick={() => { setAssessmentEditor(false); setAssessmentEditorId(undefined) }}>Cancel</button><button className="primary-button" type="button" onClick={saveAssessmentAndRefresh}>Save assessment</button></div>
        </div>
      )}

      {scaleEditor && <GradingScaleEditor
        initialScale={defaultScale}
        onCancel={() => setScaleEditor(false)}
        onSave={async (scale, id) => {
          try {
            await saveGradingScale(scale, id)
            setScaleEditor(false)
            await refresh()
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not save grading scale')
          }
        }}
      />}

      <label className="subject-selector">Subject
        <select value={selectedSubject} onChange={(event) => setSelectedSubject(event.target.value)}><option value="">Select subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
      </label>
      {selectedSubject && (
        <div className="section-heading">
          <div><h2>Subject marking scheme</h2><p>Configure this subject independently; settings stay in this browser’s local database.</p></div>
          <button className="secondary-button" type="button" onClick={() => setSchemeEditor(true)}>Configure scheme</button>
        </div>
      )}
      {schemeEditor && selectedSubject && (
        <SubjectMarkingSchemeEditor
          initialScheme={selectedScheme}
          fallbackScale={defaultScale}
          onCancel={() => setSchemeEditor(false)}
          onSave={async (scheme) => {
            try {
              await saveSubjectMarkingScheme(selectedSubject, scheme)
              setSchemeEditor(false)
              await refresh()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not save subject marking scheme')
            }
          }}
        />
      )}
      {selectedScheme && (
        <p className="muted-state">
          Configured maxima — internal: {selectedScheme.internalMaxMarks ?? 'not set'}, external: {selectedScheme.externalMaxMarks ?? 'not set'}, practical: {selectedScheme.practicalMaxMarks ?? 'not set'}.
          Passing marks: {selectedScheme.passingMarks ?? 'not set'}; passing percentage: {selectedScheme.passingPercentage}%.
        </p>
      )}

      {selectedSubject ? (
        <>
          <div className="grade-summary">
            <article><p>Assessment percentage</p><strong>{percentage.toFixed(2)}%</strong></article>
            <article><p>SGPA</p><strong>{sgpa.toFixed(2)}</strong></article>
            <article><p>CGPA</p><strong>{cgpa.toFixed(2)}</strong></article>
            {selectedScheme?.passingMarks !== undefined && configuredMaximum > 0 && subjectMarks.length > 0 && (
              <article>
                <p>Marks against configured scheme</p>
                <strong>{(percentage * configuredMaximum / 100).toFixed(selectedScheme.decimalPrecision)} / {configuredMaximum}</strong>
                <span>{percentage * configuredMaximum / 100 >= selectedScheme.passingMarks ? 'Pass mark met' : `Below ${selectedScheme.passingMarks} pass marks`}</span>
              </article>
            )}
            {requiredAtTarget !== null && (!selectedScheme || selectedScheme.calculationMethod === 'weighted') &&
              <article><p>Marks needed for {passingPercentage}%</p><strong>{requiredAtTarget.toFixed(1)}</strong></article>}
          </div>

          <div className="assessment-list">
            {subjectAssessments.length === 0 ? <p className="muted-state">No assessments have been added for this subject.</p> : subjectAssessments.map((assessment) => {
              const mark = subjectMarks.find((item) => item.assessmentId === assessment.id)
              return (
                <article className="assessment-card" key={assessment.id}>
                  <div><h3>{assessment.name}</h3><p>{assessment.category || assessment.type.replace('_', ' ')}{assessment.date ? ` · ${assessment.date}` : ''}{selectedScheme?.calculationMethod === 'weighted' ? ` · weight ${assessment.weight}` : ''}</p></div>
                  <div className="heading-actions">
                    <button className="icon-button" type="button" aria-label={`Edit ${assessment.name}`} onClick={() => startAssessmentEditor(assessment)}><Pencil size={16} /></button>
                    <button className="icon-button" type="button" aria-label={`Delete ${assessment.name}`} onClick={() => void removeAssessment(assessment)}><Trash2 size={16} /></button>
                  </div>
                  <label>Marks
                    <input type="number" min="0" max={assessment.maxMarks} defaultValue={mark?.marksObtained ?? ''} placeholder={`0-${assessment.maxMarks}`} onBlur={(event) => {
                      const value = Number(event.target.value)
                      if (event.target.value === '') return
                      saveMark({ assessmentId: assessment.id, subjectId: selectedSubject, marksObtained: value }).then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not save marks'))
                    }} />
                  </label>
                  <span>/ {assessment.maxMarks}</span>
                  {mark && <button className="secondary-button" type="button" onClick={() => {
                    deleteMark(assessment.id).then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not delete mark'))
                  }}>Clear mark</button>}
                </article>
              )
            })}
          </div>
        </>
      ) : (
        <section className="empty-dashboard"><div className="empty-icon"><Calculator size={30} /></div><h2>Select a subject</h2><p>Choose a subject to manage assessments and marks.</p></section>
      )}
    </div>
  )
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error('Enter a valid number or leave the field empty')
  return parsed
}

function GradingScaleEditor({
  initialScale,
  onCancel,
  onSave,
}: {
  initialScale?: GradingScale | undefined
  onCancel: () => void
  onSave: (scale: Omit<GradingScale, 'id' | 'createdAt' | 'updatedAt'>, id?: string) => Promise<void>
}) {
  const [name, setName] = useState(initialScale?.name ?? '')
  const [passingPercentage, setPassingPercentage] = useState(initialScale?.passingPercentage.toString() ?? '')
  const [decimalPrecision, setDecimalPrecision] = useState(initialScale?.decimalPrecision.toString() ?? '')
  const [boundaries, setBoundaries] = useState<GradingScale['boundaries']>(initialScale?.boundaries ?? [])
  const [isDefault, setIsDefault] = useState(initialScale?.isDefault ?? true)
  const [error, setError] = useState('')

  const updateBoundary = (index: number, patch: Partial<GradingScale['boundaries'][number]>) => {
    setBoundaries((current) => current.map((boundary, itemIndex) =>
      itemIndex === index ? { ...boundary, ...patch } : boundary,
    ))
  }

  return (
    <div className="editor-card">
      <h2>Configure grading scale</h2>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="form-grid">
        <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Passing percentage<input required type="number" min="0" max="100" step="any" value={passingPercentage} onChange={(event) => setPassingPercentage(event.target.value)} /></label>
        <label>Decimal precision<input required type="number" min="0" max="6" step="1" value={decimalPrecision} onChange={(event) => setDecimalPrecision(event.target.value)} /></label>
      </div>
      <div className="assessment-list">
        {boundaries.map((boundary, index) => (
          <div className="form-grid" key={`grade-boundary-${index}`}>
            <label>Minimum percentage<input type="number" min="0" max="100" step="any" value={boundary.minPercentage} onChange={(event) => updateBoundary(index, { minPercentage: Number(event.target.value) })} /></label>
            <label>Grade point<input type="number" min="0" step="any" value={boundary.gradePoint} onChange={(event) => updateBoundary(index, { gradePoint: Number(event.target.value) })} /></label>
            <label>Grade label<input required value={boundary.label} onChange={(event) => updateBoundary(index, { label: event.target.value })} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={boundary.pass} onChange={(event) => updateBoundary(index, { pass: event.target.checked })} /> Passing grade</label>
            <button className="secondary-button" type="button" onClick={() => setBoundaries((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove grade</button>
          </div>
        ))}
      </div>
      <button className="secondary-button" type="button" onClick={() => setBoundaries((current) => [
        ...current,
        { minPercentage: 0, gradePoint: 0, label: '', pass: false },
      ])}>Add grade boundary</button>
      <label className="checkbox-label"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} /> Default scale</label>
      <div className="form-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary-button" type="button" onClick={() => {
          setError('')
          const passing = optionalNumber(passingPercentage)
          const precision = optionalNumber(decimalPrecision)
          if (passing === undefined || precision === undefined) {
            setError('Enter the passing percentage and decimal precision')
            return
          }
          onSave({ name, isDefault, passingPercentage: passing, decimalPrecision: precision, boundaries }, initialScale?.id)
            .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not save grading scale'))
        }}>Save scale</button>
      </div>
    </div>
  )
}

function SubjectMarkingSchemeEditor({
  initialScheme,
  fallbackScale,
  onCancel,
  onSave,
}: {
  initialScheme?: SubjectMarkingScheme | undefined
  fallbackScale?: GradingScale | undefined
  onCancel: () => void
  onSave: (scheme: SubjectMarkingScheme) => Promise<void>
}) {
  const [method, setMethod] = useState<SubjectMarkingScheme['calculationMethod'] | ''>(initialScheme?.calculationMethod ?? '')
  const [bestOfCount, setBestOfCount] = useState(initialScheme?.bestOfCount?.toString() ?? '')
  const [internalMaxMarks, setInternalMaxMarks] = useState(initialScheme?.internalMaxMarks?.toString() ?? '')
  const [externalMaxMarks, setExternalMaxMarks] = useState(initialScheme?.externalMaxMarks?.toString() ?? '')
  const [practicalMaxMarks, setPracticalMaxMarks] = useState(initialScheme?.practicalMaxMarks?.toString() ?? '')
  const [passingMarks, setPassingMarks] = useState(initialScheme?.passingMarks?.toString() ?? '')
  const [internalWeightage, setInternalWeightage] = useState(initialScheme?.internalWeightage?.toString() ?? '')
  const [externalWeightage, setExternalWeightage] = useState(initialScheme?.externalWeightage?.toString() ?? '')
  const [passingPercentage, setPassingPercentage] = useState(
    initialScheme?.passingPercentage.toString() ?? fallbackScale?.passingPercentage.toString() ?? '',
  )
  const [decimalPrecision, setDecimalPrecision] = useState(
    initialScheme?.decimalPrecision.toString() ?? fallbackScale?.decimalPrecision.toString() ?? '',
  )
  const [boundaries, setBoundaries] = useState<GradingScale['boundaries']>(
    initialScheme?.boundaries ?? fallbackScale?.boundaries ?? [],
  )
  const [error, setError] = useState('')

  const updateBoundary = (index: number, patch: Partial<GradingScale['boundaries'][number]>) => {
    setBoundaries((current) => current.map((boundary, itemIndex) =>
      itemIndex === index ? { ...boundary, ...patch } : boundary,
    ))
  }

  const handleSave = () => {
    setError('')
    try {
      if (!method) throw new Error('Choose a calculation method')
      const passing = optionalNumber(passingPercentage)
      const precision = optionalNumber(decimalPrecision)
      if (passing === undefined || precision === undefined) {
        throw new Error('Enter the passing percentage and decimal precision')
      }
      const best = optionalNumber(bestOfCount)
      const internalMax = optionalNumber(internalMaxMarks)
      const externalMax = optionalNumber(externalMaxMarks)
      const practicalMax = optionalNumber(practicalMaxMarks)
      const passMarks = optionalNumber(passingMarks)
      const internalWeight = optionalNumber(internalWeightage)
      const externalWeight = optionalNumber(externalWeightage)
      const scheme: SubjectMarkingScheme = {
        calculationMethod: method,
        ...(best !== undefined ? { bestOfCount: best } : {}),
        ...(internalMax !== undefined ? { internalMaxMarks: internalMax } : {}),
        ...(externalMax !== undefined ? { externalMaxMarks: externalMax } : {}),
        ...(practicalMax !== undefined ? { practicalMaxMarks: practicalMax } : {}),
        ...(passMarks !== undefined ? { passingMarks: passMarks } : {}),
        ...(internalWeight !== undefined ? { internalWeightage: internalWeight } : {}),
        ...(externalWeight !== undefined ? { externalWeightage: externalWeight } : {}),
        passingPercentage: passing,
        decimalPrecision: precision,
        boundaries,
      }
      void onSave(scheme).catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Could not save subject marking scheme'),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save subject marking scheme')
    }
  }

  return (
    <div className="editor-card">
      <h2>Configure subject marking scheme</h2>
      <p className="muted-state">Categories beginning with “external” use the external component. Practical and other custom categories are grouped with internal when component weightages are used.</p>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="form-grid">
        <label>Assessment calculation
          <select value={method} onChange={(event) => setMethod(event.target.value as SubjectMarkingScheme['calculationMethod'] | '')}>
            <option value="">Choose calculation</option>
            <option value="total">Total marks</option>
            <option value="average">Average percentage</option>
            <option value="best_of">Best of N assessments</option>
            <option value="weighted">Weighted calculation</option>
          </select>
        </label>
        {method === 'best_of' && <label>Best N<input required type="number" min="1" step="1" value={bestOfCount} onChange={(event) => setBestOfCount(event.target.value)} /></label>}
        <label>Internal maximum marks<input type="number" min="0.01" step="any" value={internalMaxMarks} onChange={(event) => setInternalMaxMarks(event.target.value)} /></label>
        <label>External maximum marks<input type="number" min="0.01" step="any" value={externalMaxMarks} onChange={(event) => setExternalMaxMarks(event.target.value)} /></label>
        <label>Practical maximum marks<input type="number" min="0.01" step="any" value={practicalMaxMarks} onChange={(event) => setPracticalMaxMarks(event.target.value)} /></label>
        <label>Passing marks<input type="number" min="0" step="any" value={passingMarks} onChange={(event) => setPassingMarks(event.target.value)} /></label>
        <label>Internal weightage (%)<input type="number" min="0" max="100" step="any" value={internalWeightage} onChange={(event) => setInternalWeightage(event.target.value)} /></label>
        <label>External weightage (%)<input type="number" min="0" max="100" step="any" value={externalWeightage} onChange={(event) => setExternalWeightage(event.target.value)} /></label>
        <label>Passing percentage<input required type="number" min="0" max="100" step="any" value={passingPercentage} onChange={(event) => setPassingPercentage(event.target.value)} /></label>
        <label>Decimal precision<input required type="number" min="0" max="6" step="1" value={decimalPrecision} onChange={(event) => setDecimalPrecision(event.target.value)} /></label>
      </div>
      <div className="assessment-list">
        {boundaries.map((boundary, index) => (
          <div className="form-grid" key={`subject-grade-boundary-${index}`}>
            <label>Minimum percentage<input type="number" min="0" max="100" step="any" value={boundary.minPercentage} onChange={(event) => updateBoundary(index, { minPercentage: Number(event.target.value) })} /></label>
            <label>Grade point<input type="number" min="0" step="any" value={boundary.gradePoint} onChange={(event) => updateBoundary(index, { gradePoint: Number(event.target.value) })} /></label>
            <label>Grade label<input required value={boundary.label} onChange={(event) => updateBoundary(index, { label: event.target.value })} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={boundary.pass} onChange={(event) => updateBoundary(index, { pass: event.target.checked })} /> Passing grade</label>
            <button className="secondary-button" type="button" onClick={() => setBoundaries((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove grade</button>
          </div>
        ))}
      </div>
      <button className="secondary-button" type="button" onClick={() => setBoundaries((current) => [
        ...current,
        { minPercentage: 0, gradePoint: 0, label: '', pass: false },
      ])}>Add grade boundary</button>
      <div className="form-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary-button" type="button" onClick={handleSave}>Save scheme</button>
      </div>
    </div>
  )
}

function SubjectEditor({ semesters, record, onCancel, onSave }: { semesters: Semester[]; record: Subject | null; onCancel: () => void; onSave: (input: Omit<Subject, 'id' | 'createdAt' | 'updatedAt'>) => void }) {
  const [semesterId, setSemesterId] = useState(record?.semesterId ?? semesters[0]?.id ?? '')
  const [name, setName] = useState(record?.name ?? '')
  const [code, setCode] = useState(record?.code ?? '')
  const [facultyName, setFacultyName] = useState(record?.facultyName ?? '')
  const [credits, setCredits] = useState(record?.credits ?? 4)
  const [kind, setKind] = useState<Subject['kind']>(record?.kind ?? 'theory')
  const [attendanceTarget, setAttendanceTarget] = useState(record?.attendanceTarget ?? 75)
  const [color, setColor] = useState(record?.color ?? '#4f46e5')
  const archived = record?.archived ?? false

  return (
    <form className="editor-card" onSubmit={(event) => { event.preventDefault(); onSave({ semesterId, name, code, facultyName, credits, kind, attendanceTarget, color, archived }) }}>
      <h2>{record ? 'Edit subject' : 'Add subject'}</h2>
      <div className="form-grid">
        <label>Semester<select required value={semesterId} onChange={(event) => setSemesterId(event.target.value)}><option value="">Select semester</option>{semesters.map((semester) => <option key={semester.id} value={semester.id}>{semester.name}</option>)}</select></label>
        <label>Subject name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Subject code<input value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <label>Faculty name<input value={facultyName} onChange={(event) => setFacultyName(event.target.value)} /></label>
        <label>Credits<input required type="number" min="0" max="30" step="0.5" value={credits} onChange={(event) => setCredits(Number(event.target.value))} /></label>
        <label>Type<select value={kind} onChange={(event) => setKind(event.target.value as Subject['kind'])}><option value="theory">Theory</option><option value="practical">Practical</option><option value="laboratory">Laboratory</option></select></label>
        <label>Attendance target<input required type="number" min="1" max="100" value={attendanceTarget} onChange={(event) => setAttendanceTarget(Number(event.target.value))} /></label>
        <label>Color<input required type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
      </div>
      <div className="form-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit">Save subject</button></div>
    </form>
  )
}

function AttendancePage() {
  const { confirm } = useConfirmDialog()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [rules, setRules] = useState<TimetableRule[]>([])
  const [sessions, setSessions] = useState<ClassSession[]>([])
  const [allSessions, setAllSessions] = useState<ClassSession[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [extraSubjectId, setExtraSubjectId] = useState('')

  const refresh = async () => {
    const [subjectRows, ruleRows, sessionRows, allSessionRows, recordRows] = await Promise.all([
      listSubjects(false),
      listAllTimetableRules(),
      listSessions(date),
      listSessions(),
      listAttendanceRecords(),
    ])
    setSubjects(subjectRows)
    setRules(ruleRows)
    setSessions(sessionRows)
    setAllSessions(allSessionRows)
    setRecords(recordRows)
  }

  useEffect(() => {
    let active = true
    void Promise.all([listSubjects(false), listAllTimetableRules(), listSessions(date), listSessions(), listAttendanceRecords()])
      .then(([subjectRows, ruleRows, sessionRows, allSessionRows, recordRows]) => {
        if (active) {
          setSubjects(subjectRows)
          setRules(ruleRows)
          setSessions(sessionRows)
          setAllSessions(allSessionRows)
          setRecords(recordRows)
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load attendance')
      })
    return () => { active = false }
  }, [date])

  const ensureSessions = async () => {
    setError('')
    try {
      const weekday = new Date(`${date}T00:00:00`).getDay()
      const matchingRules = rules.filter((rule) => rule.active && rule.weekday === weekday)
      for (const rule of matchingRules) {
        const existing = sessions.find((session) => session.timetableRuleId === rule.id)
        if (!existing) {
          await saveClassSession({
            date,
            timetableRuleId: rule.id,
            subjectId: rule.subjectId,
            status: 'scheduled',
            notes: '',
          })
        }
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare sessions')
    }
  }

  const bulkMark = async (status: AttendanceStatus) => {
    setError('')
    setNotice('')
    try {
      for (const session of sessions) {
        if (session.status === 'conducted') await markAttendance(session.id, session.subjectId, status)
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not mark attendance')
    }
  }

  const markSelectedDayAsHoliday = async () => {
    if (!(await confirm({
      title: 'Mark this day as a holiday?',
      description: `All classes on ${date} will be excluded from attendance totals. Existing attendance records will be kept.`,
      confirmLabel: 'Mark as holiday',
    }))) return
    setError('')
    setNotice('')
    try {
      const count = await markDayAsHoliday(date)
      await refresh()
      setNotice(count === 0
        ? `No classes were found for ${date}.`
        : `Marked ${count} class${count === 1 ? '' : 'es'} as a holiday for ${date}. Existing attendance records are preserved.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not mark the day as a holiday')
    }
  }

  const addExtraLecture = async () => {
    if (!extraSubjectId) return
    setError('')
    setNotice('')
    try {
      await saveClassSession({
        date,
        timetableRuleId: 'extra',
        subjectId: extraSubjectId,
        status: 'conducted',
        notes: 'Extra lecture',
      })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add extra lecture')
    }
  }

  const subjectSessions = (subjectId: string) => {
    return allSessions.filter((session) => session.subjectId === subjectId)
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">Daily records</p><h1>Attendance</h1></div>
        <label className="date-picker">Date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setNotice('') }} /></label>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      <section className="attendance-toolbar">
        <button className="secondary-button" type="button" onClick={ensureSessions}>Prepare timetable sessions</button>
        <button className="present-button" type="button" onClick={() => bulkMark('present')}>Mark whole day present</button>
        <button className="absent-button" type="button" onClick={() => bulkMark('absent')}>Mark whole day absent</button>
        <button className="secondary-button" type="button" onClick={markSelectedDayAsHoliday} title="Applies to the selected date; existing attendance records are retained">Mark whole day holiday</button>
      </section>

      <section className="extra-row">
        <label>Extra lecture
          <select value={extraSubjectId} onChange={(event) => setExtraSubjectId(event.target.value)}>
            <option value="">Select subject</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        </label>
        <button className="secondary-button" type="button" onClick={addExtraLecture}>Add extra lecture</button>
      </section>

      <div className="attendance-layout">
        <section className="session-list">
          <h2>Sessions</h2>
          {sessions.length === 0 ? (
            <p className="muted-state">No sessions prepared for this date.</p>
          ) : sessions.map((session) => {
            const subject = subjects.find((item) => item.id === session.subjectId)
            const record = records.find((item) => item.sessionId === session.id)
            return (
              <article className="session-card" key={session.id}>
                <div>
                  <h3>{subject?.name ?? 'Unknown subject'}</h3>
                  <p>{session.status.replace('_', ' ')}</p>
                </div>
                <div className="status-controls">
                  {(['scheduled', 'conducted', 'teacher_absent', 'cancelled', 'holiday'] as const).map((status) => (
                    <button key={status} className={session.status === status ? 'status-chip active' : 'status-chip'} type="button" onClick={async () => {
                      await setSessionStatus(session.id, status)
                      await refresh()
                    }}>{status.replace('_', ' ')}</button>
                  ))}
                </div>
                {session.status === 'conducted' && (
                  <div className="attendance-controls" aria-label={`Mark ${subject?.name ?? 'subject'} attendance`}>
                    {(['present', 'absent', 'extra', 'rescheduled'] as AttendanceStatus[]).map((status) => (
                      <button key={status} className={record?.status === status ? 'attendance-button active' : 'attendance-button'} type="button" onClick={async () => {
                        await markAttendance(session.id, session.subjectId, status)
                        await refresh()
                      }}>{status}</button>
                    ))}
                  </div>
                )}
              </article>
            )
          })}
        </section>

        <section className="summary-list">
          <h2>Subject summary</h2>
          {subjects.map((subject) => {
            const subjectSessionRows = subjectSessions(subject.id)
            const subjectRecords = records.filter((record) => record.subjectId === subject.id)
            const summary = calculateAttendanceSummary(subjectSessionRows, subjectRecords, subject.attendanceTarget)
            return (
              <article className="summary-card" key={subject.id}>
                <div className="summary-heading"><h3>{subject.name}</h3><strong>{summary.displayPercentage}%</strong></div>
                <div className="summary-bar"><span style={{ width: `${summary.exactPercentage}%`, background: subject.color }} /></div>
                <p>{summary.attended}/{summary.conducted} conducted - exact {summary.exactPercentage.toFixed(2)}%</p>
                {summary.classesRequired > 0
                  ? <p>Attend next {summary.classesRequired} class{summary.classesRequired === 1 ? '' : 'es'} to reach target.</p>
                  : <p>{summary.maxBunk} class{summary.maxBunk === 1 ? '' : 'es'} can be missed.</p>}
              </article>
            )
          })}
        </section>
      </div>
    </div>
  )
}

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function TimetablePage() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [rules, setRules] = useState<TimetableRule[]>([])
  const [editor, setEditor] = useState<TimetableRule | 'new' | null>(null)
  const [error, setError] = useState('')

  const refresh = async () => {
    const [subjectRows, ruleRows] = await Promise.all([listSubjects(false), listAllTimetableRules()])
    setSubjects(subjectRows)
    setRules(ruleRows)
  }
  useEffect(() => {
    let active = true
    void Promise.all([listSubjects(false), listAllTimetableRules()])
      .then(([subjectRows, ruleRows]) => {
        if (active) {
          setSubjects(subjectRows)
          setRules(ruleRows)
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load timetable')
      })
    return () => { active = false }
  }, [])

  const saveAndRefresh = async (operation: () => Promise<unknown>) => {
    setError('')
    try { await operation(); await refresh(); setEditor(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save timetable entry') }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">Weekly schedule</p><h1>Timetable</h1></div>
        <button className="primary-button" type="button" onClick={() => setEditor('new')}><Plus size={17} /> Lecture</button>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {editor && <TimetableEditor subjects={subjects} record={editor === 'new' ? null : editor} onCancel={() => setEditor(null)} onSave={(input) => saveAndRefresh(() => saveTimetableRule(input, editor === 'new' ? undefined : editor.id))} />}
      {subjects.length === 0 ? (
        <section className="empty-dashboard"><div className="empty-icon"><Clock3 size={30} /></div><h2>Add subjects before scheduling</h2><p>Each timetable entry must be linked to an existing subject.</p></section>
      ) : (
        <div className="week-grid">
          {weekdays.map((day, weekday) => (
            <section className="day-column" key={day}>
              <h2>{day}</h2>
              {rules.filter((rule) => rule.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime)).map((rule) => (
                <article className="schedule-card" key={rule.id}>
                  <div className="schedule-time">{rule.startTime} - {rule.endTime}</div>
                  <h3>{subjects.find((subject) => subject.id === rule.subjectId)?.name ?? 'Unknown subject'}</h3>
                  <p>{rule.room || 'Room not set'} - {rule.kind}</p>
                  <div className="card-actions">
                    <button className="icon-button" type="button" onClick={() => setEditor(rule)} aria-label="Edit timetable entry"><Pencil size={15} /></button>
                    <button className="icon-button" type="button" onClick={() => saveAndRefresh(() => cancelTimetableRule(rule.id, false))} aria-label="Disable timetable entry"><Archive size={15} /></button>
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function TimetableEditor({ subjects, record, onCancel, onSave }: { subjects: Subject[]; record: TimetableRule | null; onCancel: () => void; onSave: (input: Omit<TimetableRule, 'id' | 'createdAt' | 'updatedAt'>) => void }) {
  const [subjectId, setSubjectId] = useState(record?.subjectId ?? subjects[0]?.id ?? '')
  const [weekday, setWeekday] = useState(record?.weekday ?? 1)
  const [startTime, setStartTime] = useState(record?.startTime ?? '09:00')
  const [endTime, setEndTime] = useState(record?.endTime ?? '10:00')
  const [facultyName, setFacultyName] = useState(record?.facultyName ?? '')
  const [room, setRoom] = useState(record?.room ?? '')
  const [kind, setKind] = useState<TimetableRule['kind']>(record?.kind ?? 'lecture')
  const [startDate, setStartDate] = useState(record?.startDate ?? new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(record?.endDate ?? '')
  const [recurring, setRecurring] = useState(record?.recurring ?? true)

  return (
    <form className="editor-card" onSubmit={(event) => { event.preventDefault(); onSave({ subjectId, weekday, startTime, endTime, facultyName, room, kind, recurring, startDate, ...(endDate ? { endDate } : {}), active: record?.active ?? true }) }}>
      <h2>{record ? 'Edit timetable entry' : 'Add timetable entry'}</h2>
      <div className="form-grid">
        <label>Subject<select required value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">Select subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
        <label>Weekday<select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
        <label>Start time<input required type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
        <label>End time<input required type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
        <label>Faculty<input value={facultyName} onChange={(event) => setFacultyName(event.target.value)} /></label>
        <label>Room or laboratory<input value={room} onChange={(event) => setRoom(event.target.value)} /></label>
        <label>Type<select value={kind} onChange={(event) => setKind(event.target.value as TimetableRule['kind'])}><option value="lecture">Lecture</option><option value="laboratory">Laboratory</option><option value="break">Break</option></select></label>
        <label>Schedule start<input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label>Schedule end (optional)<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /> Recurring weekly</label>
      <div className="form-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit">Save timetable</button></div>
    </form>
  )
}

function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [editor, setEditor] = useState<CalendarEvent | 'new' | null>(null)
  const [error, setError] = useState('')
  const refresh = async () => {
    const [eventRows, subjectRows] = await Promise.all([listCalendarEvents(), listSubjects(true)])
    setEvents(eventRows)
    setSubjects(subjectRows)
  }
  useEffect(() => {
    let active = true
    void Promise.all([listCalendarEvents(), listSubjects(true)])
      .then(([eventRows, subjectRows]) => {
        if (active) {
          setEvents(eventRows)
          setSubjects(subjectRows)
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load calendar')
      })
    return () => { active = false }
  }, [])
  const saveAndRefresh = async (operation: () => Promise<unknown>) => {
    setError('')
    try { await operation(); await refresh(); setEditor(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save calendar event') }
  }
  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">Academic schedule</p><h1>Academic calendar</h1></div><button className="primary-button" type="button" onClick={() => setEditor('new')}><Plus size={17} /> Event</button></div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {editor && <CalendarEditor subjects={subjects} record={editor === 'new' ? null : editor} onCancel={() => setEditor(null)} onSave={(input) => saveAndRefresh(() => saveCalendarEvent(input, editor === 'new' ? undefined : editor.id))} />}
      {events.length === 0 ? (
        <section className="empty-dashboard"><div className="empty-icon"><CalendarDays size={30} /></div><h2>No academic events yet</h2><p>Add holidays, examinations, vacations, deadlines, or college events.</p></section>
      ) : (
        <div className="event-list">{events.map((event) => (
          <article className="event-card" key={event.id}>
            <div className="event-date">{event.startDate === event.endDate ? event.startDate : `${event.startDate} - ${event.endDate}`}</div>
            <div><h3>{event.title}</h3><p>{event.type.replace('_', ' ')}{event.recurring ? ' - recurring' : ''}</p></div>
            <button className="icon-button" type="button" onClick={() => setEditor(event)} aria-label={`Edit ${event.title}`}><Pencil size={16} /></button>
          </article>
        ))}</div>
      )}
    </div>
  )
}

function CalendarEditor({ subjects, record, onCancel, onSave }: { subjects: Subject[]; record: CalendarEvent | null; onCancel: () => void; onSave: (input: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => void }) {
  const [title, setTitle] = useState(record?.title ?? '')
  const [type, setType] = useState<CalendarEvent['type']>(record?.type ?? 'event')
  const [startDate, setStartDate] = useState(record?.startDate ?? new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(record?.endDate ?? startDate)
  const [recurring, setRecurring] = useState(record?.recurring ?? false)
  const [subjectId, setSubjectId] = useState(record?.subjectId ?? '')
  const [notes, setNotes] = useState(record?.notes ?? '')
  return (
    <form className="editor-card" onSubmit={(event) => { event.preventDefault(); onSave({ title, type, startDate, endDate, recurring, ...(subjectId ? { subjectId } : {}), notes }) }}>
      <h2>{record ? 'Edit academic event' : 'Add academic event'}</h2>
      <div className="form-grid">
        <label>Title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Type<select value={type} onChange={(event) => setType(event.target.value as CalendarEvent['type'])}><option value="holiday">Holiday</option><option value="exam">Examination</option><option value="internal_exam">Internal examination</option><option value="vacation">Vacation</option><option value="event">College event</option><option value="deadline">Assignment deadline</option><option value="special">Special day</option></select></label>
        <label>Start date<input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label>End date<input required type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        <label>Related subject<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">All subjects</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
        <label>Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /> Recurring event</label>
      <div className="form-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit">Save event</button></div>
    </form>
  )
}

function BackupPage() {
  const [backup, setBackup] = useState<StudentMateBackup | null>(null)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const createBackup = async () => {
    setError('')
    try {
      downloadJsonBackup(await createFullBackup())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create backup')
    }
  }

  const selectRestoreFile = async (file: File | undefined) => {
    setBackup(null)
    setPreview(null)
    setSuccess('')
    setError('')
    setFileName(file?.name ?? '')
    if (!file) return
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Backup is larger than the 50 MB limit')
      const validated = validateBackupText(await file.text())
      const restorePreview = await previewRestore(validated)
      setBackup(validated)
      setPreview(restorePreview)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not validate backup')
    }
  }

  const confirmRestore = async () => {
    if (!backup || !preview) return
    setError('')
    setSuccess('')
    try {
      const result = await restoreBackup(backup)
      setSuccess(`Restore completed: ${result.additions} records added; ${result.duplicateRows} existing records kept unchanged.`)
      setPreview(await previewRestore(backup))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore backup')
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">Local data safety</p><h1>Backup and restore</h1></div>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {success && <div className="success-banner" role="status">{success}</div>}

      <section className="backup-grid">
        <article className="backup-card">
          <div className="empty-icon"><DatabaseBackup size={26} /></div>
          <h2>Create backup</h2>
          <p>Download a complete JSON copy of the locally stored StudentMate database.</p>
          <button className="primary-button" type="button" onClick={createBackup}>Download JSON backup</button>
        </article>

        <article className="backup-card">
          <div className="empty-icon"><Archive size={26} /></div>
          <h2>Restore backup</h2>
          <p>Validate and review a backup before any data is changed.</p>
          <label className="backup-file">Backup JSON file<input type="file" accept=".json,application/json" onChange={(event) => selectRestoreFile(event.target.files?.[0])} /></label>
          {fileName && <p className="backup-file-name">{fileName}</p>}
        </article>
      </section>

      {backup && preview && (
        <section className="restore-review">
          <h2>Restore preview</h2>
          <p>This restore is merge-only. Existing records with matching IDs will never be overwritten.</p>
          <div className="restore-stats">
            <article><span>Total rows</span><strong>{preview.totalRows}</strong></article>
            <article><span>Additions</span><strong>{preview.additions}</strong></article>
            <article><span>Duplicates kept</span><strong>{preview.duplicateRows}</strong></article>
          </div>
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={() => { setBackup(null); setPreview(null); setFileName('') }}>Cancel</button>
            <button className="primary-button" type="button" onClick={confirmRestore}>Confirm merge restore</button>
          </div>
        </section>
      )}
    </div>
  )
}

function ImportPage() {
  const { confirm } = useConfirmDialog()
  const [documentType, setDocumentType] = useState<DocumentType | 'auto'>('auto')
  const [file, setFile] = useState<File | null>(null)
  const [sourceType, setSourceType] = useState<'pdf' | 'image'>('pdf')
  const [extraction, setExtraction] = useState<DocumentExtraction | null>(null)
  const [review, setReview] = useState<ImportReview | null>(null)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [semesters, setSemesters] = useState<Semester[]>([])
  const [existingEvents, setExistingEvents] = useState<CalendarEvent[]>([])
  const [existingRules, setExistingRules] = useState<TimetableRule[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<ExtractionProgress | null>(null)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState('')

  useEffect(() => {
    let active = true
    void Promise.all([listSubjects(false), listSemesters(), listCalendarEvents(), listAllTimetableRules()])
      .then(([subjectRows, semesterRows, eventRows, ruleRows]) => {
        if (!active) return
        setSubjects(subjectRows)
        setSemesters(semesterRows)
        setExistingEvents(eventRows)
        setExistingRules(ruleRows)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load academic records')
      })
    return () => { active = false }
  }, [])

  const analyze = (nextExtraction: DocumentExtraction, type: DocumentType | 'auto' = documentType) => {
    setReview(buildImportReview(type, nextExtraction, subjects))
  }

  const processFile = async () => {
    if (!file) return
    setError('')
    setConfirmed('')
    setReview(null)
    setExtraction(null)
    setProgress(null)
    setProcessing(true)
    try {
      const type = validateImportFile(file)
      setSourceType(type)
      const result = await extractDocument(file, setProgress)
      setExtraction(result)
      analyze(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not process the document')
    } finally {
      setProcessing(false)
    }
  }

  const updateItem = (index: number, patch: Partial<ExtractedReviewItem>) => {
    setReview((current) => current ? {
      ...current,
      items: current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const updated = { ...item, ...patch, validation: 'needs_review' as const }
        const warnings = item.warnings.filter((warning) => !warning.startsWith('Edited by student'))
        updated.warnings = [...warnings, 'Edited by student; confirm the values before importing']
        if (patch.title !== undefined && item.kind === 'subject') {
          const match = findSubjectMatch(patch.title, subjects)
          updated.subjectMatch = match.state
          updated.subjectId = match.subjectId
          updated.createSubject = false
        }
        return updated
      }),
    } : current)
  }

  const addReviewItem = () => {
    setReview((current) => {
      if (!current) return current
      const isCalendar = current.documentType !== 'weekly_timetable'
      const item: ExtractedReviewItem = {
        id: crypto.randomUUID(),
        kind: isCalendar ? 'event' : 'subject',
        title: '',
        description: '',
        ...(isCalendar ? { eventType: current.documentType === 'holiday_list' ? 'holiday' : current.documentType === 'examination_timetable' ? 'exam' : 'event', startDate: '', endDate: '', date: '' } : { subjectMatch: 'unrecognized', lectureKind: 'lecture' }),
        page: current.pageCount || 1,
        confidence: 1,
        validation: 'needs_review',
        warnings: ['Manually added; complete all required values'],
        included: true,
      }
      return { ...current, items: [...current.items, item] }
    })
  }

  const isValidIsoDate = (value: string | undefined) =>
    Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
  const validItems = review?.items.filter((item) => {
    if (item.included === false || ['invalid', 'duplicate', 'unrecognized'].includes(item.validation) ||
      reviewStateForItem(item, review.items) === 'duplicate') return false
    if (!item.title.trim()) return false
    if (item.kind === 'event') {
      return Boolean(item.eventType && isValidIsoDate(item.startDate) && isValidIsoDate(item.endDate) && item.endDate! >= item.startDate!)
    }
    return item.lectureKind !== 'break' && item.weekday !== undefined &&
      Boolean(item.startTime && item.endTime && item.endTime > item.startTime) &&
      Boolean(item.subjectId || (item.createSubject && item.semesterId))
  }) ?? []

  const itemWarnings = (item: ExtractedReviewItem): string[] => {
    const warnings = [...item.warnings]
    if (item.kind === 'event' && existingEvents.some((event) =>
      event.title.trim().toLowerCase() === item.title.trim().toLowerCase() &&
      event.startDate === item.startDate && event.endDate === item.endDate,
    )) warnings.push('A matching calendar event already exists')
    if (item.kind === 'subject' && item.weekday !== undefined && item.startTime && item.endTime) {
      const start = Number(item.startTime.slice(0, 2)) * 60 + Number(item.startTime.slice(3))
      const end = Number(item.endTime.slice(0, 2)) * 60 + Number(item.endTime.slice(3))
      if (existingRules.some((rule) => rule.active && rule.weekday === item.weekday &&
        start < Number(rule.endTime.slice(0, 2)) * 60 + Number(rule.endTime.slice(3)) &&
        end > Number(rule.startTime.slice(0, 2)) * 60 + Number(rule.startTime.slice(3)))) {
        warnings.push('This time overlaps an existing timetable session')
      }
    }
    return [...new Set(warnings)]
  }

  const confirmImport = async () => {
    if (!file || !review || validItems.length === 0) return
    const duplicateCount = review.items.filter((item) => reviewStateForItem(item, review.items) === 'duplicate').length
    const warningCount = review.items.filter((item) => itemWarnings(item).length > 0).length
    if (!(await confirm({
      title: 'Import academic data?',
      description: `Import ${validItems.length} valid entr${validItems.length === 1 ? 'y' : 'ies'}? ${duplicateCount} duplicate row(s) and ${warningCount} warning(s) will be skipped or need attention. Existing records will not be overwritten.`,
      confirmLabel: 'Import entries',
    }))) return
    setError('')
    setConfirmed('')
    let saved = 0
    const failures: string[] = []
    try {
      for (const item of validItems) {
        try {
          const warnings = itemWarnings(item)
          if (warnings.some((warning) => /already exists|overlaps an existing/.test(warning))) {
            failures.push(`${item.title}: ${warnings.find((warning) => /already exists|overlaps an existing/.test(warning))}`)
            continue
          }
          if (item.kind === 'event') {
            await saveCalendarEvent({
              title: item.title.trim(),
              type: item.eventType!,
              startDate: item.startDate!,
              endDate: item.endDate!,
              recurring: false,
              notes: item.description.trim(),
            })
          } else {
            let subjectId = item.subjectId
            let semesterId: string | undefined
            if (item.createSubject) {
              const semester = semesters.find((candidate) => candidate.id === item.semesterId)
              if (!semester) throw new Error('Choose a semester for this new subject')
              const created = await saveSubject({
                semesterId: semester.id,
                name: item.title.trim(),
                code: '',
                facultyName: item.teacher ?? '',
                credits: 0,
                kind: item.lectureKind === 'laboratory' ? 'laboratory' : 'theory',
                attendanceTarget: 75,
                color: '#4f46e5',
                archived: false,
              })
              subjectId = created.id
              semesterId = semester.id
            }
            if (!subjectId) throw new Error('Choose an existing subject or explicitly create one')
            const subject = subjects.find((candidate) => candidate.id === subjectId)
            const semester = semesters.find((candidate) => candidate.id === (semesterId ?? subject?.semesterId))
            if (!semester) throw new Error('The selected subject has no valid semester')
            await saveTimetableRule({
              subjectId,
              weekday: item.weekday!,
              startTime: item.startTime!,
              endTime: item.endTime!,
              facultyName: item.teacher ?? '',
              room: item.room ?? '',
              kind: item.lectureKind === 'laboratory' ? 'laboratory' : 'lecture',
              recurring: true,
              startDate: semester.startDate,
              endDate: semester.endDate,
              active: true,
            })
          }
          saved += 1
        } catch (cause) {
          failures.push(`${item.title}: ${cause instanceof Error ? cause.message : 'could not save'}`)
        }
      }
      await saveImportJob(review.kind, file.name, sourceType, review, 'confirmed')
      await Promise.all([listSubjects(false), listCalendarEvents(), listAllTimetableRules()])
        .then(([subjectRows, eventRows, ruleRows]) => {
          setSubjects(subjectRows)
          setExistingEvents(eventRows)
          setExistingRules(ruleRows)
        })
      setConfirmed(`${saved} entr${saved === 1 ? 'y' : 'ies'} imported. Existing records were kept unchanged.${failures.length ? ` ${failures.length} row(s) were skipped: ${failures.join('; ')}` : ''}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm import')
    }
  }

  const documentTypeLabel: Record<DocumentType, string> = {
    academic_calendar: 'Academic calendar',
    weekly_timetable: 'Weekly timetable',
    examination_timetable: 'Examination timetable',
    holiday_list: 'Holiday list',
    unknown: 'Unknown document',
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">Local document processing</p><h1>Document import</h1></div>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {confirmed && <div className="success-banner" role="status">{confirmed}</div>}
      <section className="import-card">
        <div className="import-controls">
          <label>Document type
            <select value={documentType} onChange={(event) => {
              const nextType = event.target.value as DocumentType | 'auto'
              setDocumentType(nextType)
              if (extraction) analyze(extraction, nextType)
            }}>
              <option value="auto">Detect automatically</option>
              <option value="academic_calendar">Academic calendar</option>
              <option value="weekly_timetable">Weekly timetable</option>
              <option value="examination_timetable">Examination timetable</option>
              <option value="holiday_list">Holiday list</option>
            </select>
          </label>
          <label>PDF or image
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setReview(null)
              setExtraction(null)
              setProgress(null)
              setError('')
              setConfirmed('')
            }} />
          </label>
          <button className="primary-button" type="button" disabled={!file || processing} onClick={processFile}>{processing ? 'Processing locally...' : 'Extract and review'}</button>
        </div>
        <p className="privacy-note">Documents stay in this browser. PDF text is preferred; scanned pages use local Tesseract OCR with the English model bundled and cached with the app for offline use.</p>
        {processing && (
          <div className="import-progress" role="status" aria-live="polite">
            <div className="import-progress-heading"><span>{progress?.message ?? 'Starting local document extraction...'}</span><strong>{Math.round((progress?.progress ?? 0) * 100)}%</strong></div>
            <progress max="1" value={progress?.progress ?? 0} />
          </div>
        )}
      </section>

      {review && (
        <section className="review-card">
          <div className="section-heading import-review-heading">
            <div><h2>Review extracted information</h2><p>Detected: {documentTypeLabel[review.detectedDocumentType]} · Review as: {documentTypeLabel[review.documentType]} · {review.pageCount} page(s). Nothing has been saved.</p></div>
            <button className="secondary-button" type="button" onClick={addReviewItem}><Plus size={16} /> Add row</button>
          </div>
          {review.detectedDocumentType === 'unknown' && documentType === 'auto' && <div className="error-banner" role="status">Document type is unknown. Select a type above to parse it; no calendar or timetable records have been inferred.</div>}
          <div className="import-summary">
            <span><strong>{validItems.length}</strong> valid entries</span>
            <span><strong>{review.items.filter((item) => ['needs_review', 'invalid', 'unrecognized'].includes(item.validation)).length}</strong> need review</span>
            <span><strong>{review.items.filter((item) => reviewStateForItem(item, review.items) === 'duplicate').length}</strong> duplicate rows</span>
            <span><strong>{review.items.filter((item) => itemWarnings(item).some((warning) => /overlaps|already exists/.test(warning))).length}</strong> existing conflicts</span>
          </div>
          {review.items.length === 0 ? (
            <>
              <p className="muted-state">No event rows could be identified. For scanned month-grid calendars, review the OCR text below and add or correct entries manually.</p>
              <details className="source-document">
                <summary>View extracted OCR text</summary>
                <pre>{extraction?.pages.map((page) => `Page ${page.page} (${page.source})\n${page.text}`).join('\n\n')}</pre>
              </details>
            </>
          ) : (
            <div className="import-review-layout">
              <div className="review-list">
                {review.items.map((item, index) => {
                  const warnings = itemWarnings(item)
                  const state: ReviewState = reviewStateForItem(item, review.items)
                  return (
                    <article className={`review-row document-review-row state-${state}`} key={item.id}>
                      <div className="review-row-meta">
                        <label className="review-include"><input type="checkbox" checked={item.included !== false} onChange={(event) => updateItem(index, { included: event.target.checked })} /> Include</label>
                        <span className={`review-state state-${state}`}>{state.replace('_', ' ')}</span>
                        <span className="confidence">{Math.round(item.confidence * 100)}% OCR/parse confidence · page {item.page}</span>
                        <button className="icon-button" type="button" aria-label={`Remove ${item.title || 'row'}`} onClick={() => setReview({ ...review, items: review.items.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={16} /></button>
                      </div>
                      {item.kind === 'event' ? (
                        <div className="review-fields">
                          <label>Event name<input value={item.title} onChange={(event) => updateItem(index, { title: event.target.value, description: event.target.value })} /></label>
                          <label>Event type<select value={item.eventType ?? ''} onChange={(event) => updateItem(index, { eventType: (event.target.value || undefined) as ExtractedReviewItem['eventType'] })}>
                            <option value="">Choose type</option><option value="holiday">Holiday</option><option value="exam">Examination</option><option value="internal_exam">Internal examination</option><option value="vacation">Vacation</option><option value="deadline">Deadline</option><option value="event">Academic event</option><option value="special">Important date</option>
                          </select></label>
                          <label>Start date<input type="date" value={item.startDate ?? item.date ?? ''} onChange={(event) => updateItem(index, { startDate: event.target.value, date: event.target.value })} /></label>
                          <label>End date<input type="date" value={item.endDate ?? item.startDate ?? item.date ?? ''} onChange={(event) => updateItem(index, { endDate: event.target.value })} /></label>
                          <label className="review-description">Description<textarea rows={2} value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} /></label>
                        </div>
                      ) : (
                        <div className="review-fields timetable-review-fields">
                          <label>Weekday<select value={item.weekday ?? ''} onChange={(event) => updateItem(index, { weekday: event.target.value === '' ? undefined : Number(event.target.value) })}>
                            <option value="">Choose day</option>{weekdays.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}
                          </select></label>
                          <label>Subject name<input value={item.title} onChange={(event) => updateItem(index, { title: event.target.value })} /></label>
                          <label>Existing subject<select value={item.createSubject ? '__create__' : item.subjectId ?? ''} onChange={(event) => {
                            if (event.target.value === '__create__') updateItem(index, { subjectId: undefined, createSubject: true, subjectMatch: 'unrecognized' })
                            else updateItem(index, { subjectId: event.target.value || undefined, createSubject: false, subjectMatch: event.target.value ? 'matched' : 'unrecognized' })
                          }}>
                            <option value="">Choose existing subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}{subject.code ? ` (${subject.code})` : ''}</option>)}<option value="__create__">Create new subject after confirmation</option>
                          </select></label>
                          {item.createSubject && <label>New subject semester<select value={item.semesterId ?? ''} onChange={(event) => updateItem(index, { semesterId: event.target.value })}><option value="">Choose semester</option>{semesters.map((semester) => <option key={semester.id} value={semester.id}>{semester.name}</option>)}</select></label>}
                          <label>Start time<input type="time" value={item.startTime ?? ''} onChange={(event) => updateItem(index, { startTime: event.target.value })} /></label>
                          <label>End time<input type="time" value={item.endTime ?? ''} onChange={(event) => updateItem(index, { endTime: event.target.value })} /></label>
                          <label>Classroom<input value={item.room ?? ''} onChange={(event) => updateItem(index, { room: event.target.value })} /></label>
                          <label>Teacher<input value={item.teacher ?? ''} onChange={(event) => updateItem(index, { teacher: event.target.value })} /></label>
                          <label>Session type<select value={item.lectureKind ?? 'lecture'} onChange={(event) => updateItem(index, { lectureKind: event.target.value as ExtractedReviewItem['lectureKind'] })}><option value="lecture">Lecture</option><option value="laboratory">Laboratory</option><option value="break">Break (review only)</option></select></label>
                        </div>
                      )}
                      {warnings.length > 0 && <ul className="review-warnings">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                    </article>
                  )
                })}
              </div>
              <details className="source-document">
                <summary>Original extracted text</summary>
                <pre>{extraction?.pages.map((page) => `Page ${page.page} (${page.source})\n${page.text}`).join('\n\n')}</pre>
              </details>
            </div>
          )}
          {review.items.some((item) => item.lectureKind === 'break') && <p className="privacy-note">Breaks are recognized for review but cannot be imported as timetable rules because timetable records require a subject.</p>}
          <div className="form-actions"><button className="secondary-button" type="button" onClick={() => { setReview(null); setExtraction(null) }}>Discard</button><button className="primary-button" type="button" disabled={validItems.length === 0} onClick={confirmImport}>Confirm import ({validItems.length})</button></div>
        </section>
      )}
    </div>
  )
}

function SettingsPage({ theme, toggleTheme, installPrompt, onInstall }: { theme: Theme; toggleTheme: () => void; installPrompt: BeforeInstallPromptEvent | null; onInstall: () => Promise<void> }) {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof checkDatabaseHealth>> | null>(null)

  useEffect(() => {
    checkDatabaseHealth().then(setHealth)
  }, [])

  useEffect(() => {
    if (isDemoMode() && sessionStorage.getItem('studentmate-demo-needs-seed') === '1') {
      sessionStorage.removeItem('studentmate-demo-needs-seed')
      void seedDemoData().then(() => window.location.reload())
    }
  }, [])

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1>Settings</h1>
        </div>
      </div>
      <section className="settings-card">
        <div>
          <h2>Appearance</h2>
          <p>Choose how StudentMate looks on this device.</p>
        </div>
        <button className="theme-button" type="button" onClick={toggleTheme}>
          {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          {theme === 'light' ? 'Use dark mode' : 'Use light mode'}
        </button>
      </section>
      {health && (
        <section className="settings-card database-status">
          <div>
            <h2>Local database</h2>
            <p>{health.healthy ? `Healthy - schema version ${health.version}` : 'The local database needs attention'}</p>
          </div>
          <span className={health.healthy ? 'status-dot healthy' : 'status-dot'} />
        </section>
      )}
      {installPrompt && (
        <section className="settings-card database-status">
          <div>
            <h2>Install StudentMate</h2>
            <p>Add this app to your device for quick, standalone access.</p>
          </div>
          <button className="theme-button" type="button" onClick={() => void onInstall()}>
            <DatabaseBackup size={17} />
            Install app
          </button>
        </section>
      )}
      <section className="settings-card database-status">
        <div>
          <h2>Demo mode</h2>
          <p>{isDemoMode() ? 'Sample data uses a separate isolated browser database.' : 'Explore entirely fictional records without mixing them into your academic data.'}</p>
        </div>
        {isDemoMode() ? (
          <div className="heading-actions">
            <button className="theme-button" type="button" onClick={() => void seedDemoData().then(() => window.location.reload())}>Reload sample data</button>
            <button className="theme-button" type="button" onClick={() => void resetDemoData().then(() => window.location.reload())}>Reset demo</button>
            <button className="theme-button" type="button" onClick={() => {
              const url = new URL(window.location.href)
              url.searchParams.delete('demo')
              window.location.assign(url.toString())
            }}>Exit demo</button>
          </div>
        ) : (
          <button className="theme-button" type="button" onClick={() => void enterDemoMode()}>Enter demo mode</button>
        )}
      </section>
    </div>
  )
}

export default function App() {
  return (
    <ConfirmDialogProvider>
      <AppShell />
    </ConfirmDialogProvider>
  )
}
