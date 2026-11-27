import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useConfirmDialog } from '../components/confirmDialogContext'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  calculateRequiredSGPA,
  predictCGPA,
} from '../data/academicPerformance'
import {
  deleteSemesterResult,
  getAcademicPerformanceData,
  saveSemesterResult,
  setCGPACalculationMethod,
  setCurrentSemester,
  type AcademicPerformanceData,
} from '../data/academicPerformanceRepository'
import type { CGPACalculationMethod, StudentSemesterResult } from '../data/models'

interface ResultDraft {
  sgpa: string
  totalCredits: string
  academicYear: string
  completed: boolean
}

function draftFromResult(result?: StudentSemesterResult): ResultDraft {
  return {
    sgpa: result?.sgpa === undefined ? '' : String(result.sgpa),
    totalCredits: result?.totalCredits === undefined ? '' : String(result.totalCredits),
    academicYear: result?.academicYear ?? '',
    completed: result?.status === 'completed',
  }
}

function fixed(value: number | null, precision: number): string {
  return value === null ? '—' : value.toFixed(precision)
}

function ProgressionChart({ data }: { data: AcademicPerformanceData }) {
  if (!data.progression.length) {
    return <p className="academic-performance-empty">Complete a semester to see your CGPA progression.</p>
  }
  return (
    <div className="academic-performance-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.progression} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="semesterNumber" tick={{ fill: 'var(--chart-text)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(value: number) => `Sem ${value}`} />
          <YAxis domain={[0, data.maxSGPA]} tick={{ fill: 'var(--chart-text)', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ stroke: 'var(--chart-grid)' }}
            contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow-popover)', fontSize: 13 }}
            formatter={(value) => [Number(value).toFixed(data.decimalPrecision), 'CGPA']}
            labelFormatter={(value) => `Semester ${value}`}
          />
          <Line type="monotone" dataKey="cgpa" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 4, fill: 'var(--primary)', stroke: 'var(--surface)', strokeWidth: 2 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function AcademicPerformanceWidget() {
  const [data, setData] = useState<AcademicPerformanceData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void getAcademicPerformanceData().then((value) => {
      if (active) setData(value)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load academic performance')
    })
    return () => { active = false }
  }, [])

  return (
    <section className="premium-panel academic-performance-widget">
      <div className="premium-panel-heading">
        <div><p>ACADEMIC PERFORMANCE</p><h2>Semester results</h2></div>
        <Link className="premium-panel-link" to="/performance">Manage results</Link>
      </div>
      {error ? <div className="error-banner" role="alert">{error}</div> : data ? (
        <>
          <div className="academic-performance-widget-stats">
            <div><span>CGPA</span><strong>{fixed(data.cgpa, data.decimalPrecision)}</strong></div>
            <div><span>Latest SGPA</span><strong>{fixed(data.latestSGPA, data.decimalPrecision)}</strong></div>
            <div><span>Previous SGPA</span><strong>{fixed(data.previousSGPA, data.decimalPrecision)}</strong></div>
            <div><span>Completed</span><strong>{data.completedCount} / 8</strong></div>
          </div>
          <div className="academic-performance-progress"><span style={{ width: `${data.progressPercent}%` }} /></div>
          <p className="academic-performance-progress-label">{data.progressPercent}% academic progress</p>
          <ProgressionChart data={data} />
        </>
      ) : <p className="academic-performance-empty">Loading academic performance…</p>}
    </section>
  )
}

export default function AcademicPerformancePage() {
  const { confirm } = useConfirmDialog()
  const [data, setData] = useState<AcademicPerformanceData | null>(null)
  const [drafts, setDrafts] = useState<Record<number, ResultDraft>>({})
  const [expectedSGPA, setExpectedSGPA] = useState('')
  const [expectedCredits, setExpectedCredits] = useState('')
  const [targetCGPA, setTargetCGPA] = useState('')
  const [targetCredits, setTargetCredits] = useState('')
  const [prediction, setPrediction] = useState<number | null | undefined>()
  const [required, setRequired] = useState<ReturnType<typeof calculateRequiredSGPA>>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [savingSemester, setSavingSemester] = useState<number | null>(null)

  const refresh = async () => {
    const next = await getAcademicPerformanceData()
    setData(next)
    setDrafts(Object.fromEntries(next.results.map((result) => [result.semesterNumber, draftFromResult(result)])))
  }

  useEffect(() => {
    let active = true
    void getAcademicPerformanceData().then((value) => {
      if (!active) return
      setData(value)
      setDrafts(Object.fromEntries(value.results.map((result) => [result.semesterNumber, draftFromResult(result)])))
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load academic performance')
    })
    return () => { active = false }
  }, [])

  const resultBySemester = useMemo(
    () => new Map(data?.results.map((result) => [result.semesterNumber, result]) ?? []),
    [data?.results],
  )

  const updateDraft = (semesterNumber: number, patch: Partial<ResultDraft>) => {
    setDrafts((current) => ({
      ...current,
      [semesterNumber]: { ...draftFromResult(resultBySemester.get(semesterNumber)), ...current[semesterNumber], ...patch },
    }))
  }

  const perform = async (action: () => Promise<void>, successMessage: string) => {
    setError('')
    setNotice('')
    try {
      await action()
      await refresh()
      setNotice(successMessage)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save academic performance')
    }
  }

  const onMethodChange = (method: CGPACalculationMethod) => {
    void perform(() => setCGPACalculationMethod(method), 'CGPA calculation method updated.')
  }

  const saveResult = async (semesterNumber: number) => {
    if (!data) return
    const draft = drafts[semesterNumber] ?? draftFromResult(resultBySemester.get(semesterNumber))
    const sgpa = draft.sgpa.trim() ? Number(draft.sgpa) : undefined
    const totalCredits = draft.totalCredits.trim() ? Number(draft.totalCredits) : undefined
    setSavingSemester(semesterNumber)
    await perform(async () => {
      await saveSemesterResult({
        semesterNumber,
        ...(sgpa !== undefined ? { sgpa } : {}),
        ...(totalCredits !== undefined ? { totalCredits } : {}),
        ...(draft.academicYear.trim() ? { academicYear: draft.academicYear.trim() } : {}),
        completed: draft.completed,
      }, resultBySemester.get(semesterNumber)?.id)
    }, `Semester ${semesterNumber} result saved.`)
    setSavingSemester(null)
  }

  const deleteResult = async (semesterNumber: number) => {
    const result = resultBySemester.get(semesterNumber)
    if (!result || !(await confirm({
      title: 'Delete this semester result?',
      description: `The result for semester ${semesterNumber} will be permanently removed.`,
      confirmLabel: 'Delete result',
      variant: 'danger',
    }))) return
    await perform(() => deleteSemesterResult(result.id), `Semester ${semesterNumber} result deleted.`)
  }

  const calculatePrediction = () => {
    setError('')
    setPrediction(undefined)
    if (!data?.currentSemester || !expectedSGPA.trim()) {
      setError('Select your current semester and enter an expected SGPA.')
      return
    }
    const score = Number(expectedSGPA)
    const credits = expectedCredits.trim() ? Number(expectedCredits) : undefined
    if (!Number.isFinite(score) || score < 0 || score > data.maxSGPA) {
      setError(`Expected SGPA must be between 0 and ${data.maxSGPA}.`)
      return
    }
    if (credits !== undefined && (!Number.isFinite(credits) || credits <= 0)) {
      setError('Expected credits must be greater than zero.')
      return
    }
    try {
      setPrediction(predictCGPA(data.results, data.currentSemester, score, data.calculationMethod, credits, data.decimalPrecision))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not calculate predicted CGPA')
    }
  }

  const calculateTarget = () => {
    setError('')
    setRequired(undefined)
    if (!data?.currentSemester || !targetCGPA.trim()) {
      setError('Select your current semester and enter a target CGPA.')
      return
    }
    const target = Number(targetCGPA)
    const credits = targetCredits.trim() ? Number(targetCredits) : undefined
    if (!Number.isFinite(target) || target < 0 || target > data.maxSGPA) {
      setError(`Target CGPA must be between 0 and ${data.maxSGPA}.`)
      return
    }
    if (credits !== undefined && (!Number.isFinite(credits) || credits <= 0)) {
      setError('Expected credits must be greater than zero.')
      return
    }
    try {
      setRequired(calculateRequiredSGPA(
        data.results,
        data.currentSemester,
        target,
        data.calculationMethod,
        data.maxSGPA,
        credits,
        data.decimalPrecision,
      ))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not calculate target SGPA')
    }
  }

  return (
    <div className="page academic-performance-page">
      <div className="page-heading">
        <div><p className="eyebrow">Academic insights</p><h1>Academic performance</h1></div>
        <Link className="secondary-button" to="/academics">View marks and grades</Link>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}
      {!data ? <div className="loading-card" role="status">Loading academic performance…</div> : (
        <>
          <section className="academic-performance-overview">
            <article><span>Current CGPA</span><strong>{fixed(data.cgpa, data.decimalPrecision)}</strong><small>{data.completedCount} completed semester{data.completedCount === 1 ? '' : 's'}</small></article>
            <article><span>Latest SGPA</span><strong>{fixed(data.latestSGPA, data.decimalPrecision)}</strong><small>{data.previousSGPA === null ? 'No previous result' : `Previous: ${fixed(data.previousSGPA, data.decimalPrecision)}`}</small></article>
            <article><span>Academic progress</span><strong>{data.progressPercent}%</strong><div className="academic-performance-progress"><span style={{ width: `${data.progressPercent}%` }} /></div><small>{data.completedCount} of 8 semesters completed</small></article>
          </section>

          <section className="editor-card">
            <div className="section-heading"><div><h2>Performance settings</h2><p>Choose your current semester and your university’s CGPA rule.</p></div></div>
            <div className="form-grid academic-performance-settings">
              <label>Current semester
                <select
                  aria-label="Current semester"
                  value={data.currentSemester ?? ''}
                  onChange={(event) => {
                    if (event.target.value) void perform(() => setCurrentSemester(Number(event.target.value)), 'Semester history is ready.')
                  }}
                >
                  <option value="">Select current semester</option>
                  {Array.from({ length: 8 }, (_, index) => index + 1).map((semester) => <option key={semester} value={semester}>Semester {semester}</option>)}
                </select>
              </label>
              <label>CGPA calculation method
                <select
                  aria-label="CGPA calculation method"
                  value={data.calculationMethod}
                  onChange={(event) => onMethodChange(event.target.value as CGPACalculationMethod)}
                >
                  <option value="simple">Simple average of completed SGPAs</option>
                  <option value="credit_weighted">Credit-weighted average</option>
                </select>
              </label>
            </div>
            <p className="academic-performance-note">Selecting a semester creates pending records for earlier semesters. You can fill them in later; current and pending semesters never count toward CGPA.</p>
          </section>

          <section className="editor-card">
            <div className="section-heading"><div><h2>Semester results</h2><p>Add or update SGPA and credits. Results are saved only when you choose Save.</p></div></div>
            <div className="academic-performance-table-wrap">
              <table className="academic-performance-table">
                <thead><tr><th>Semester</th><th>SGPA</th><th>Credits</th><th>Academic year</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {Array.from({ length: 8 }, (_, index) => index + 1).map((semesterNumber) => {
                    const result = resultBySemester.get(semesterNumber)
                    const draft = drafts[semesterNumber] ?? draftFromResult(result)
                    const status = draft.completed
                      ? 'completed'
                      : result?.status ?? (
                        semesterNumber === data.currentSemester
                          ? 'current'
                          : data.currentSemester !== null && semesterNumber < data.currentSemester
                            ? 'pending'
                            : 'not set'
                      )
                    return (
                      <tr key={semesterNumber}>
                        <th scope="row">Semester {semesterNumber}</th>
                        <td><input aria-label={`Semester ${semesterNumber} SGPA`} type="number" min="0" max={data.maxSGPA} step="any" value={draft.sgpa} onChange={(event) => updateDraft(semesterNumber, { sgpa: event.target.value })} /></td>
                        <td><input aria-label={`Semester ${semesterNumber} credits`} type="number" min="0.01" max="1000" step="any" value={draft.totalCredits} onChange={(event) => updateDraft(semesterNumber, { totalCredits: event.target.value })} /></td>
                        <td><input aria-label={`Semester ${semesterNumber} academic year`} type="text" placeholder="Optional" value={draft.academicYear} onChange={(event) => updateDraft(semesterNumber, { academicYear: event.target.value })} /></td>
                        <td>
                          <label className="academic-performance-completed">
                            <input type="checkbox" aria-label={`Semester ${semesterNumber} completed`} checked={draft.completed} onChange={(event) => updateDraft(semesterNumber, { completed: event.target.checked })} />
                            {status}
                          </label>
                        </td>
                        <td className="academic-performance-actions">
                          <button className="secondary-button" type="button" disabled={savingSemester === semesterNumber} onClick={() => void saveResult(semesterNumber)}>{savingSemester === semesterNumber ? 'Saving…' : 'Save'}</button>
                          {result && (result.sgpa !== undefined || result.totalCredits !== undefined || result.academicYear) && (
                            <button className="secondary-button danger" type="button" onClick={() => void deleteResult(semesterNumber)}>Delete</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="academic-performance-chart-card">
            <div className="section-heading"><div><h2>CGPA progression</h2><p>Calculated from completed semester results only.</p></div></div>
            <ProgressionChart data={data} />
          </section>

          <div className="academic-performance-tools">
            <section className="editor-card">
              <div className="section-heading"><div><h2>CGPA predictor</h2><p>Project future CGPA using one expected SGPA for remaining semesters.</p></div></div>
              <div className="form-grid">
                <label>Expected SGPA<input aria-label="Expected SGPA" type="number" min="0" max={data.maxSGPA} step="any" value={expectedSGPA} onChange={(event) => setExpectedSGPA(event.target.value)} /></label>
                {data.calculationMethod === 'credit_weighted' && <label>Credits per remaining semester<input aria-label="Prediction credits" type="number" min="0.01" step="any" value={expectedCredits} onChange={(event) => setExpectedCredits(event.target.value)} /></label>}
              </div>
              <button className="primary-button academic-performance-submit" type="button" onClick={calculatePrediction}>Calculate predicted CGPA</button>
              {prediction !== undefined && <p className="academic-performance-result" role="status">{prediction === null ? 'Enter credits for all remaining semesters to use weighted prediction.' : `Predicted CGPA: ${fixed(prediction, data.decimalPrecision)}`}</p>}
            </section>
            <section className="editor-card">
              <div className="section-heading"><div><h2>Target CGPA calculator</h2><p>Estimate the average SGPA needed over your remaining semesters.</p></div></div>
              <div className="form-grid">
                <label>Desired CGPA<input aria-label="Desired CGPA" type="number" min="0" max={data.maxSGPA} step="any" value={targetCGPA} onChange={(event) => setTargetCGPA(event.target.value)} /></label>
                {data.calculationMethod === 'credit_weighted' && <label>Credits per remaining semester<input aria-label="Target credits" type="number" min="0.01" step="any" value={targetCredits} onChange={(event) => setTargetCredits(event.target.value)} /></label>}
              </div>
              <button className="primary-button academic-performance-submit" type="button" onClick={calculateTarget}>Calculate required SGPA</button>
              {required && (
                <p className={`academic-performance-result ${required.possible ? '' : 'warning'}`} role="status">
                  {required.reason ?? (required.targetAlreadyMet
                    ? 'Your completed results already meet this target.'
                    : `Required average SGPA: ${fixed(required.requiredSGPA, data.decimalPrecision)}`)}
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
