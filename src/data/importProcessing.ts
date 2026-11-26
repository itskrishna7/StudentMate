import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url'
import { db } from './database'
import { createId, nowIso } from './settings'
import type { ImportJob, Subject } from './models'

export type DocumentType =
  | 'academic_calendar'
  | 'weekly_timetable'
  | 'examination_timetable'
  | 'holiday_list'
  | 'unknown'

export type ReviewState = 'high_confidence' | 'needs_review' | 'invalid' | 'duplicate' | 'unrecognized'

export interface ExtractedSegment {
  text: string
  x: number
  width: number
}

export interface ExtractedLine {
  text: string
  page: number
  y?: number
  segments?: ExtractedSegment[]
}

export interface ExtractedPage {
  page: number
  text: string
  lines: ExtractedLine[]
  source: 'pdf_text' | 'ocr'
  ocrConfidence?: number
}

export interface DocumentExtraction {
  pages: ExtractedPage[]
  sourceText: string
}

export interface ExtractionProgress {
  phase: 'reading' | 'rendering' | 'ocr'
  page: number
  pageCount: number
  progress: number
  message: string
}

export interface ExtractedReviewItem {
  id: string
  kind: 'subject' | 'event'
  title: string
  description: string
  eventType?: 'holiday' | 'exam' | 'internal_exam' | 'vacation' | 'event' | 'deadline' | 'special' | undefined
  date?: string
  startDate?: string
  endDate?: string
  startTime?: string
  endTime?: string
  weekday?: number | undefined
  room?: string
  teacher?: string
  lectureKind?: 'lecture' | 'laboratory' | 'break' | undefined
  subjectId?: string | undefined
  createSubject?: boolean
  semesterId?: string | undefined
  included?: boolean | undefined
  subjectMatch?: 'matched' | 'ambiguous' | 'unrecognized' | 'not_applicable' | undefined
  page: number
  confidence: number
  validation: ReviewState
  warnings: string[]
}

export interface ImportReview {
  kind: ImportJob['kind']
  documentType: DocumentType
  detectedDocumentType: DocumentType
  items: ExtractedReviewItem[]
  sourceText: string
  pageCount: number
  academicYear?: string
}

export const MAX_IMPORT_SIZE = 15 * 1024 * 1024
export const MAX_IMPORT_PAGES = 100
const MAX_SOURCE_TEXT_LENGTH = 100_000
const MAX_CANVAS_PIXELS = 12_000_000
const OCR_TIMEOUT_MS = 60_000

type ProgressCallback = (progress: ExtractionProgress) => void

export function validateImportFile(file: File): 'pdf' | 'image' {
  if (file.size <= 0) throw new Error('The selected file is empty')
  if (file.size > MAX_IMPORT_SIZE) throw new Error('The file is larger than the 15 MB limit')
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) return 'image'
  throw new Error('Only PDF, PNG, JPEG, and WebP files are accepted')
}

function emitProgress(callback: ProgressCallback | undefined, update: ExtractionProgress): void {
  callback?.(update)
}

function makeLinesFromPdfItems(items: Array<{ str: string; x: number; y: number; width: number; height: number }>, page: number): ExtractedLine[] {
  const sorted = items
    .filter((item) => item.str.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: Array<{ y: number; items: typeof sorted }> = []

  for (const item of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(2.5, item.height * 0.35))
    if (row) row.items.push(item)
    else rows.push({ y: item.y, items: [item] })
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const segments: ExtractedSegment[] = []
      for (const item of row.items.sort((a, b) => a.x - b.x)) {
        const previous = segments.at(-1)
        const gap = previous ? item.x - (previous.x + previous.width) : 0
        if (previous && gap > 20) {
          segments.push({ text: item.str.trim(), x: item.x, width: item.width })
        } else if (previous) {
          previous.text += `${gap > 2 ? ' ' : ''}${item.str.trim()}`
          previous.width = item.x + item.width - previous.x
        } else {
          segments.push({ text: item.str.trim(), x: item.x, width: item.width })
        }
      }
      return {
        page,
        y: row.y,
        segments,
        text: segments.map((segment) => segment.text).join(' | ').trim(),
      }
    })
    .filter((line) => line.text)
}

function timeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: number | undefined
  const timed = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), OCR_TIMEOUT_MS)
  })
  return Promise.race([promise, timed]).finally(() => {
    if (timer !== undefined) window.clearTimeout(timer)
  })
}

function createOcrCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('This browser could not prepare the document image for OCR')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)

  const image = context.getImageData(0, 0, width, height)
  const { data } = image
  let minimum = 255
  let maximum = 0
  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(data[index]! * 0.299 + data[index + 1]! * 0.587 + data[index + 2]! * 0.114)
    minimum = Math.min(minimum, gray)
    maximum = Math.max(maximum, gray)
  }
  const range = Math.max(80, maximum - minimum)
  const scale = 255 / range
  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.max(0, Math.min(255, Math.round((data[index]! * 0.299 + data[index + 1]! * 0.587 + data[index + 2]! * 0.114 - minimum) * scale)))
    data[index] = gray
    data[index + 1] = gray
    data[index + 2] = gray
  }
  context.putImageData(image, 0, 0)
  return canvas
}

async function createOcrWorker(onWorkerProgress?: (status: string, progress: number) => void) {
  const { createWorker } = await import('tesseract.js')
  const corePath = new URL(`${import.meta.env.BASE_URL}tesseract-core/`, window.location.origin).href
  try {
    const worker = await timeout(createWorker('eng', 1, {
      cacheMethod: 'write',
      workerPath: tesseractWorkerUrl,
      corePath,
      logger: (message) => onWorkerProgress?.(message.status, message.progress),
    }), 'OCR initialization took too long. Check your connection and try again.')
    await worker.setParameters({
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    })
    return worker
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : ''
    if (/network|fetch|traineddata|language|load/i.test(message)) {
      throw new Error('English OCR resources could not be loaded. Connect once to download and cache them, then try again offline.')
    }
    throw new Error(message || 'The local OCR engine could not be initialized')
  }
}

async function recognizeCanvas(
  worker: Awaited<ReturnType<typeof createOcrWorker>>,
  canvas: HTMLCanvasElement,
  page: number,
  pageCount: number,
  callback?: ProgressCallback,
): Promise<{ text: string; confidence: number }> {
  try {
    const result = await timeout(worker.recognize(canvas), `OCR timed out on page ${page}. Try a smaller or clearer document.`)
    return { text: result.data.text, confidence: result.data.confidence / 100 }
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('OCR timed out')) throw cause
    throw new Error(`OCR could not read page ${page}. The document may be too blurry or the OCR resources may be unavailable.`)
  } finally {
    emitProgress(callback, {
      phase: 'ocr',
      page,
      pageCount,
      progress: page / pageCount,
      message: `OCR page ${page} of ${pageCount}`,
    })
  }
}

export async function extractDocument(file: File, onProgress?: ProgressCallback): Promise<DocumentExtraction> {
  const type = validateImportFile(file)
  if (type === 'image') {
    const bitmap = await createImageBitmap(file).catch(() => {
      throw new Error('The image could not be opened. Try a valid PNG or JPEG file.')
    })
    const ratio = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (bitmap.width * bitmap.height)), 2800 / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * ratio))
    const height = Math.max(1, Math.round(bitmap.height * ratio))
    const canvas = createOcrCanvas(bitmap, width, height)
    bitmap.close()
    emitProgress(onProgress, { phase: 'ocr', page: 1, pageCount: 1, progress: 0, message: 'Preparing image for OCR' })
    const worker = await createOcrWorker((status, progress) => {
      emitProgress(onProgress, { phase: 'ocr', page: 1, pageCount: 1, progress, message: status })
    })
    try {
      const result = await recognizeCanvas(worker, canvas, 1, 1, onProgress)
      const lines = result.text.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ text, page: 1 }))
      return { pages: [{ page: 1, text: result.text, lines, source: 'ocr', ocrConfidence: result.confidence }], sourceText: result.text.slice(0, MAX_SOURCE_TEXT_LENGTH) }
    } finally {
      await worker.terminate()
      canvas.width = 0
      canvas.height = 0
    }
  }

  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const pdfDocument = await loadingTask.promise
  if (pdfDocument.numPages > MAX_IMPORT_PAGES) {
    await loadingTask.destroy()
    throw new Error(`PDFs must contain ${MAX_IMPORT_PAGES} pages or fewer`)
  }

  const pages: ExtractedPage[] = []
  let worker: Awaited<ReturnType<typeof createOcrWorker>> | undefined
  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      emitProgress(onProgress, {
        phase: 'reading',
        page: pageNumber,
        pageCount: pdfDocument.numPages,
        progress: (pageNumber - 1) / pdfDocument.numPages,
        message: `Reading page ${pageNumber} of ${pdfDocument.numPages}`,
      })
      const page = await pdfDocument.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = content.items.flatMap((item) => {
        if (!('str' in item) || !item.str.trim()) return []
        const transform = 'transform' in item ? item.transform : undefined
        return transform ? [{
          str: item.str,
          x: transform[4],
          y: transform[5],
          width: 'width' in item ? item.width : 0,
          height: 'height' in item ? item.height : 0,
        }] : []
      })
      const textLines = makeLinesFromPdfItems(items, pageNumber)
      const text = textLines.map((line) => line.text).join('\n')
      if (text.replace(/[^\p{L}\p{N}]/gu, '').length >= 24) {
        pages.push({ page: pageNumber, text, lines: textLines, source: 'pdf_text' })
        page.cleanup()
        continue
      }

      emitProgress(onProgress, {
        phase: 'rendering',
        page: pageNumber,
        pageCount: pdfDocument.numPages,
        progress: (pageNumber - 1) / pdfDocument.numPages,
        message: `Rendering scanned page ${pageNumber} of ${pdfDocument.numPages}`,
      })
      const baseViewport = page.getViewport({ scale: 1 })
      const scale = Math.min(3, Math.sqrt(MAX_CANVAS_PIXELS / (baseViewport.width * baseViewport.height)))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error(`This browser could not render PDF page ${pageNumber}`)
      await page.render({ canvasContext: context, canvas, viewport }).promise
      const prepared = createOcrCanvas(canvas, canvas.width, canvas.height)
      canvas.width = 0
      canvas.height = 0
      page.cleanup()
      worker ??= await createOcrWorker((status, progress) => {
        emitProgress(onProgress, {
          phase: 'ocr',
          page: pageNumber,
          pageCount: pdfDocument.numPages,
          progress: ((pageNumber - 1) + progress) / pdfDocument.numPages,
          message: status,
        })
      })
      const result = await recognizeCanvas(worker, prepared, pageNumber, pdfDocument.numPages, onProgress)
      const lines = result.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ text: line, page: pageNumber }))
      pages.push({ page: pageNumber, text: result.text, lines, source: 'ocr', ocrConfidence: result.confidence })
      prepared.width = 0
      prepared.height = 0
    }
  } catch (cause) {
    if (cause instanceof Error && /OCR|render|page/i.test(cause.message)) throw cause
    throw new Error('The PDF could not be read. It may be corrupted or use unsupported encryption.')
  } finally {
    if (worker) await worker.terminate()
    await loadingTask.destroy()
  }
  const sourceText = pages.map((page) => `--- Page ${page.page} ---\n${page.text}`).join('\n\n').slice(0, MAX_SOURCE_TEXT_LENGTH)
  return { pages, sourceText }
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
  october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

interface DateMatch { start: number; end: number; iso: string; endIso?: string; ambiguous: boolean }

function validIsoDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function findDateMatches(text: string): DateMatch[] {
  const matches: DateMatch[] = []
  const ranges: Array<{ regex: RegExp; parse: (match: RegExpExecArray) => [string | undefined, string | undefined] }> = [
    {
      regex: /\b(\d{1,2})\s*(?:-|–|—|\bto\b)\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*((?:19|20)\d{2})\b/gi,
      parse: (m) => {
        const month = MONTHS[m[3]!.toLowerCase().replace(/\.$/, '')]
        return month ? [
          validIsoDate(Number(m[4]), month, Number(m[1])),
          validIsoDate(Number(m[4]), month, Number(m[2])),
        ] : [undefined, undefined]
      },
    },
    {
      regex: /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*(?:-|–|—|\bto\b)\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*((?:19|20)\d{2})\b/gi,
      parse: (m) => [
        MONTHS[m[2]!.toLowerCase().replace(/\.$/, '')] ? validIsoDate(Number(m[5]), MONTHS[m[2]!.toLowerCase().replace(/\.$/, '')]!, Number(m[1])) : undefined,
        MONTHS[m[4]!.toLowerCase().replace(/\.$/, '')] ? validIsoDate(Number(m[5]), MONTHS[m[4]!.toLowerCase().replace(/\.$/, '')]!, Number(m[3])) : undefined,
      ],
    },
    {
      regex: /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*(?:-|–|—)\s*(\d{1,2}),?\s*((?:19|20)\d{2})\b/gi,
      parse: (m) => {
        const month = MONTHS[m[1]!.toLowerCase().replace(/\.$/, '')]
        return month ? [
          validIsoDate(Number(m[4]), month, Number(m[2])),
          validIsoDate(Number(m[4]), month, Number(m[3])),
        ] : [undefined, undefined]
      },
    },
  ]
  for (const { regex, parse } of ranges) {
    for (const match of text.matchAll(regex)) {
      const [iso, endIso] = parse(match)
      if (iso && endIso) matches.push({
        start: match.index!,
        end: match.index! + match[0].length,
        iso,
        endIso,
        ambiguous: false,
      })
    }
  }
  const patterns: Array<{ regex: RegExp; parse: (match: RegExpExecArray) => { iso: string | undefined; ambiguous?: boolean } }> = [
    { regex: /\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, parse: (m) => ({ iso: validIsoDate(Number(m[1]), Number(m[2]), Number(m[3])) }) },
    { regex: /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g, parse: (m) => ({ iso: validIsoDate(Number(m[3]), Number(m[2]), Number(m[1])), ambiguous: Number(m[1]) <= 12 && Number(m[2]) <= 12 }) },
    { regex: /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+((?:19|20)\d{2})\b/g, parse: (m) => ({ iso: MONTHS[m[2]!.toLowerCase().replace(/\.$/, '')] ? validIsoDate(Number(m[3]), MONTHS[m[2]!.toLowerCase().replace(/\.$/, '')]!, Number(m[1])) : undefined }) },
    { regex: /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/g, parse: (m) => ({ iso: MONTHS[m[1]!.toLowerCase().replace(/\.$/, '')] ? validIsoDate(Number(m[3]), MONTHS[m[1]!.toLowerCase().replace(/\.$/, '')]!, Number(m[2])) : undefined }) },
  ]
  for (const { regex, parse } of patterns) {
    for (const match of text.matchAll(regex)) {
      const parsed = parse(match)
      if (parsed.iso) matches.push({ start: match.index!, end: match.index! + match[0].length, iso: parsed.iso, ambiguous: parsed.ambiguous ?? false })
    }
  }
  return matches.sort((a, b) => a.start - b.start).filter((match, index, list) => index === 0 || match.start >= list[index - 1]!.end)
}

function inferCalendarType(text: string): ExtractedReviewItem['eventType'] | undefined {
  if (/\b(internal|sessional|mid[- ]?term|unit)\s*(exam|test)|exam(?:ination)?\s*(i|ii|1|2|one|two)\b/i.test(text)) return 'internal_exam'
  if (/\b(exam|examination|semester exam|university exam|end[- ]?term)\b/i.test(text)) return 'exam'
  if (/\b(holiday|holidays|public holiday|closed)\b/i.test(text)) return 'holiday'
  if (/\b(vacation|recess|break)\b/i.test(text)) return 'vacation'
  if (/\b(registration|enrol(?:l)?ment|deadline|submission|last date|due date)\b/i.test(text)) return 'deadline'
  if (/\b(result|orientation|commencement|commencement|semester begins|semester ends|classes begin)\b/i.test(text)) return 'special'
  if (/\b(event|festival|ceremony|workshop|conference)\b/i.test(text)) return 'event'
  return undefined
}

function makeCalendarItems(pages: ExtractedPage[], requestedType: Exclude<DocumentType, 'weekly_timetable' | 'unknown'>): ExtractedReviewItem[] {
  const items: ExtractedReviewItem[] = []
  for (const page of pages) {
    const lines = page.lines
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!
      const text = line.text.trim()
      const dates = findDateMatches(text)
      if (dates.length === 0) {
        const previous = items.at(-1)
        if (previous && previous.page === page.page && previous.title && text.length > 3 && !/^(page\s+\d+|continued)$/i.test(text)) {
          previous.description = `${previous.description}${previous.description ? ' ' : ''}${text}`.slice(0, 1000)
        }
        continue
      }

      const startDate = dates[0]!.iso
      const endDate = dates[0]!.endIso ?? (dates.length > 1 ? dates[1]!.iso : startDate)
      const title = text.slice(0, dates[0]!.start).concat(' ', text.slice(dates.at(-1)!.end)).replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '').trim()

      let description = title
      if (!description && index > 0 && lines[index - 1]!.page === page.page && findDateMatches(lines[index - 1]!.text).length === 0) {
        description = lines[index - 1]!.text.trim()
      }
      if (!description && lines[index + 1] && lines[index + 1]!.page === page.page && findDateMatches(lines[index + 1]!.text).length === 0) {
        description = lines[index + 1]!.text.trim()
        index += 1
      }
      const eventType = requestedType === 'holiday_list' ? 'holiday' : inferCalendarType(description)
      const ambiguousDate = dates.some((date) => date.ambiguous)
      const hasType = Boolean(eventType)
      const validation: ReviewState = !description
        ? 'invalid'
        : ambiguousDate || !hasType
          ? 'needs_review'
          : page.source === 'ocr' && (page.ocrConfidence ?? 0) < 0.7
            ? 'needs_review'
            : 'high_confidence'
      const warnings = [
        ...(!description ? ['No event description was found'] : []),
        ...(ambiguousDate ? ['Numeric date interpreted as DD/MM/YYYY; verify the date'] : []),
        ...(!hasType ? ['Event type could not be identified from the description'] : []),
        ...(page.source === 'ocr' && (page.ocrConfidence ?? 0) < 0.7 ? ['Low OCR confidence; verify the extracted text'] : []),
      ]
      items.push({
        id: createId(),
        kind: 'event',
        title: description || 'Unrecognized event',
        description,
        ...(eventType ? { eventType } : {}),
        date: startDate,
        startDate,
        endDate,
        page: page.page,
        confidence: Math.min(page.source === 'ocr' ? page.ocrConfidence ?? 0.45 : 0.88, ambiguousDate || !hasType ? 0.58 : 0.96),
        validation,
        warnings,
        subjectMatch: 'not_applicable',
      })
    }
  }
  return items
}

const DAY_PATTERN = /\b(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\b/i
const TIME_PATTERN = /(?<![\d/])(\d{1,2}(?::[0-5]\d|[.][0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?)(?![\d/])/gi

function parseTime(value: string): string | undefined {
  const match = /^\s*(\d{1,2})(?::|\.([0-5]\d))?([0-5]\d)?\s*(a\.?m\.?|p\.?m\.?)?\s*$/i.exec(value)
  if (!match) return undefined
  const hourValue = Number(match[1])
  const minute = Number(match[2] ?? match[3] ?? 0)
  const meridiem = match[4]?.replace(/\./g, '').toLowerCase()
  if (minute > 59 || hourValue > 23 || (meridiem && (hourValue < 1 || hourValue > 12))) return undefined
  const hour = meridiem
    ? (hourValue % 12) + (meridiem === 'pm' ? 12 : 0)
    : hourValue
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function parseTimeRange(text: string): { startTime: string; endTime: string; start: number; end: number } | undefined {
  const rangePattern = /(\d{1,2}(?::[0-5]\d|[.][0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:-|–|—|\bto\b)\s*(\d{1,2}(?::[0-5]\d|[.][0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?)/i
  const match = rangePattern.exec(text)
  if (!match) return undefined
  const leftHasMeridiem = /[ap]\.?m\.?/i.test(match[1]!)
  const rightHasMeridiem = /[ap]\.?m\.?/i.test(match[2]!)
  let startTime = parseTime(match[1]!)
  let endTime = parseTime(match[2]!)
  if (!startTime || !endTime) return undefined
  if (!leftHasMeridiem && rightHasMeridiem) {
    const meridiem = match[2]!.match(/[ap]\.?m\.?/i)?.[0]
    startTime = parseTime(`${match[1]} ${meridiem}`) ?? startTime
  }
  const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3))
  let end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3))
  if (end <= start && !leftHasMeridiem && rightHasMeridiem && endTime.startsWith('00')) {
    endTime = `${String(Number(endTime.slice(0, 2)) + 12).padStart(2, '0')}:${endTime.slice(3)}`
    end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3))
  }
  return { startTime, endTime, start, end }
}

function getWeekday(text: string): number | undefined {
  const match = DAY_PATTERN.exec(text)
  if (!match) return undefined
  const prefix = match[1]!.slice(0, 3).toLowerCase()
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(prefix)
}

function normalizeForMatch(value: string): string {
  return value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function subjectMatch(title: string, subjects: Subject[]): { state: 'matched' | 'ambiguous' | 'unrecognized'; subjectId?: string } {
  const normalized = normalizeForMatch(title)
  if (!normalized) return { state: 'unrecognized' }
  const exact = subjects.filter((subject) => normalizeForMatch(subject.name) === normalized || (subject.code && normalizeForMatch(subject.code) === normalized))
  if (exact.length === 1) return { state: 'matched', subjectId: exact[0]!.id }
  if (exact.length > 1) return { state: 'ambiguous' }

  const tokens = (value: string) => new Set(normalizeForMatch(value).split(' ').filter((token) => token.length > 1))
  const score = (a: string, b: string) => {
    const aa = tokens(a)
    const bb = tokens(b)
    const common = [...aa].filter((token) => bb.has(token)).length
    return common / Math.max(aa.size, bb.size, 1)
  }
  const scored = subjects.map((subject) => ({ subject, score: Math.max(score(title, subject.name), subject.code ? score(title, subject.code) : 0) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const next = scored[1]
  if (best && best.score >= 0.75 && (!next || best.score - next.score >= 0.2)) return { state: 'matched', subjectId: best.subject.id }
  if (best && best.score >= 0.4) return { state: 'ambiguous' }
  return { state: 'unrecognized' }
}

function extractRoom(text: string): string | undefined {
  return /\b(?:room|rm|lab|laboratory|classroom)\s*[-:#]?\s*([A-Z0-9-]+)/i.exec(text)?.[0]?.trim()
}

function cleanSubjectTitle(text: string): string {
  return text
    .replace(DAY_PATTERN, ' ')
    .replace(TIME_PATTERN, ' ')
    .replace(/\b(room|rm|lab|laboratory|classroom)\b\s*[-:#]?\s*[A-Z0-9-]+/ig, ' ')
    .replace(/\b(section|sec)\s*[A-Z0-9-]+/ig, ' ')
    .replace(/[|,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
    .trim()
}

function inferLectureKind(text: string): 'lecture' | 'laboratory' | 'break' {
  if (/\b(lab|laboratory|practical)\b/i.test(text)) return 'laboratory'
  if (/\b(break|lunch|recess)\b/i.test(text)) return 'break'
  return 'lecture'
}

function expandTimetableGrid(page: ExtractedPage): ExtractedPage {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const header = page.lines.find((line) => {
    if ((line.segments?.length ?? 0) < 3) return false
    const dayCount = line.segments!.filter((segment) => getWeekday(segment.text) !== undefined).length
    const timeCount = line.segments!.filter((segment) => parseTimeRange(segment.text)).length
    return dayCount >= 2 || timeCount >= 2
  })
  if (!header?.segments) return page

  const dayColumns = header.segments.flatMap((segment) => {
    const weekday = getWeekday(segment.text)
    return weekday === undefined ? [] : [{ weekday, x: segment.x }]
  })
  const timeColumns = header.segments.flatMap((segment) => {
    const range = parseTimeRange(segment.text)
    return range ? [{ range, x: segment.x }] : []
  })
  if (dayColumns.length < 2 && timeColumns.length < 2) return page

  const generated: ExtractedLine[] = []
  const consumed = new Set<ExtractedLine>([header])
  const nearest = <T extends { x: number }>(x: number, columns: T[]): T | undefined =>
    columns.reduce<T | undefined>((best, column) =>
      !best || Math.abs(column.x - x) < Math.abs(best.x - x) ? column : best, undefined)

  for (const line of page.lines) {
    if (line === header || !line.segments?.length) continue
    if (dayColumns.length >= 2) {
      const timeSegment = line.segments.find((segment) => parseTimeRange(segment.text))
      const range = timeSegment && parseTimeRange(timeSegment.text)
      if (range) {
        const beforeCount = generated.length
        const cells = line.segments.filter((segment) => segment !== timeSegment && !parseTimeRange(segment.text))
        for (const cell of cells) {
          const column = nearest(cell.x, dayColumns)
          const title = cleanSubjectTitle(cell.text)
          if (!column || !title) continue
          generated.push({ page: page.page, text: `${dayNames[column.weekday]} ${range.startTime}-${range.endTime} ${title}` })
        }
        if (generated.length > beforeCount) consumed.add(line)
      }
    } else {
      const daySegment = line.segments.find((segment) => getWeekday(segment.text) !== undefined)
      const weekday = daySegment ? getWeekday(daySegment.text) : undefined
      if (weekday === undefined) continue
      const cells = line.segments.filter((segment) => segment !== daySegment && !parseTimeRange(segment.text))
      const beforeCount = generated.length
      for (const cell of cells) {
        const firstColumn = nearest(cell.x, timeColumns)
        if (!firstColumn) continue
        const cellEnd = cell.x + Math.max(0, cell.width)
        const lastColumn = [...timeColumns].reverse().find((column) => column.x < cellEnd) ?? firstColumn
        const endTime = lastColumn.range.endTime
        const title = cleanSubjectTitle(cell.text)
        if (!title) continue
        generated.push({ page: page.page, text: `${dayNames[weekday]} ${firstColumn.range.startTime}-${endTime} ${title}` })
      }
      if (generated.length > beforeCount) consumed.add(line)
    }
  }

  return generated.length
    ? { ...page, lines: [...page.lines.filter((line) => !consumed.has(line)), ...generated] }
    : page
}

function makeTimetableItems(pages: ExtractedPage[], subjects: Subject[], examination = false): ExtractedReviewItem[] {
  const items: ExtractedReviewItem[] = []
  let currentDay: number | undefined
  for (const page of pages.map(expandTimetableGrid)) {
    for (const line of page.lines) {
      const text = line.text.trim()
      const weekday = getWeekday(text)
      const timeRange = parseTimeRange(text)
      if (weekday !== undefined) currentDay = weekday

      if (examination) {
        const dates = findDateMatches(text)
        if (!dates.length) continue
        const title = text.slice(0, dates[0]!.start).concat(' ', text.slice(dates[0]!.end)).replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '').trim()
        const startTime = TIME_PATTERN.exec(text)?.[0]
        TIME_PATTERN.lastIndex = 0
        const parsedTime = startTime ? parseTime(startTime) : undefined
        const state = title ? (dates[0]!.ambiguous ? 'needs_review' : 'high_confidence') : 'unrecognized'
        items.push({
          id: createId(), kind: 'event', title: title || 'Unrecognized examination',
          description: title, eventType: 'exam', date: dates[0]!.iso, startDate: dates[0]!.iso, endDate: dates[0]!.iso,
          ...(parsedTime ? { startTime: parsedTime } : {}),
          page: page.page, confidence: dates[0]!.ambiguous ? 0.58 : 0.85, validation: state,
          warnings: dates[0]!.ambiguous ? ['Numeric date interpreted as DD/MM/YYYY; verify the date'] : [],
          subjectMatch: 'not_applicable',
        })
        continue
      }

      const day = weekday ?? currentDay
      if (day === undefined && !timeRange && !line.segments?.length) continue
      let title = ''
      let teacher = ''
      const room = extractRoom(text)

      if (line.segments?.length && line.segments.length > 1 && day === undefined) {
        const daySegment = line.segments.find((segment) => getWeekday(segment.text) !== undefined)
        if (daySegment) currentDay = getWeekday(daySegment.text)
      }
      const range = timeRange ?? (() => {
        const times = [...text.matchAll(TIME_PATTERN)].map((match) => parseTime(match[0])).filter((time): time is string => Boolean(time))
        TIME_PATTERN.lastIndex = 0
        if (times.length >= 2) {
          const start = Number(times[0]!.slice(0, 2)) * 60 + Number(times[0]!.slice(3))
          let end = Number(times[1]!.slice(0, 2)) * 60 + Number(times[1]!.slice(3))
          if (end <= start) end += 12 * 60
          if (end <= 24 * 60) return { startTime: times[0]!, endTime: `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`, start, end }
        }
        return undefined
      })()
      const remainder = range
        ? text.replace(/(\d{1,2}(?::[0-5]\d|[.][0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:-|–|—|\bto\b)\s*(\d{1,2}(?::[0-5]\d|[.][0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?)/i, ' ')
        : text
      title = cleanSubjectTitle(remainder)
      if (room) title = title.replace(room, '').trim()
      const teacherMatch = /\b(?:teacher|faculty|lecturer)\s*[:=-]\s*([^|,;]+)/i.exec(text)
      teacher = teacherMatch?.[1]?.trim() ?? ''
      if (teacherMatch) title = title.replace(teacherMatch[0], '').trim()
      if (!title && line.segments?.length) title = cleanSubjectTitle(line.segments.map((segment) => segment.text).filter((segment) => !parseTimeRange(segment) && getWeekday(segment) === undefined).join(' '))

      const matched = subjectMatch(title, subjects)
      const lectureKind = inferLectureKind(text)
      const valid = day !== undefined && range !== undefined && range.end > range.start && Boolean(title)
      const duplicate = items.some((item) => item.kind === 'subject' && item.weekday === day && item.startTime === range?.startTime && item.endTime === range?.endTime && normalizeForMatch(item.title) === normalizeForMatch(title))
      const overlap = items.some((item) => item.kind === 'subject' && item.weekday === day && range && item.startTime && item.endTime && range.start < Number(item.endTime.slice(0, 2)) * 60 + Number(item.endTime.slice(3)) && range.end > Number(item.startTime.slice(0, 2)) * 60 + Number(item.startTime.slice(3)))
      const warnings = [
        ...(day === undefined ? ['Weekday could not be identified'] : []),
        ...(!range ? ['Start and end times could not be identified'] : []),
        ...(range && range.end <= range.start ? ['End time must be later than start time'] : []),
        ...(!title ? ['Subject name could not be identified'] : []),
        ...(matched.state === 'ambiguous' ? ['Subject match is ambiguous; choose a subject'] : []),
        ...(matched.state === 'unrecognized' ? ['No existing subject matched; review the name'] : []),
        ...(duplicate ? ['Duplicate timetable row detected'] : []),
        ...(overlap ? ['This row overlaps another extracted session'] : []),
        ...(page.source === 'ocr' && (page.ocrConfidence ?? 0) < 0.7 ? ['Low OCR confidence; verify the extracted text'] : []),
      ]
      const validation: ReviewState = duplicate ? 'duplicate'
        : !valid ? 'invalid'
          : matched.state !== 'matched' ? matched.state === 'ambiguous' ? 'needs_review' : 'unrecognized'
            : overlap || (page.source === 'ocr' && (page.ocrConfidence ?? 0) < 0.7) ? 'needs_review'
              : 'high_confidence'

      if (!title && !range && day === undefined) continue
      items.push({
        id: createId(),
        kind: 'subject',
        title: title || 'Unrecognized subject',
        description: text,
        ...(day !== undefined ? { weekday: day } : {}),
        ...(range ? { startTime: range.startTime, endTime: range.endTime } : {}),
        ...(room ? { room } : {}),
        ...(teacher ? { teacher } : {}),
        lectureKind,
        ...(matched.subjectId ? { subjectId: matched.subjectId } : {}),
        subjectMatch: matched.state,
        page: page.page,
        confidence: Math.min(page.source === 'ocr' ? page.ocrConfidence ?? 0.45 : 0.88, validation === 'high_confidence' ? 0.95 : 0.6),
        validation,
        warnings,
      })
    }
  }

  const sorted = items.filter((item) => item.kind === 'subject' && item.weekday !== undefined && item.startTime)
    .sort((a, b) => a.weekday! - b.weekday! || a.startTime!.localeCompare(b.startTime!))
  const unmergeable = items.filter((item) => item.kind === 'subject' && (item.weekday === undefined || !item.startTime || !item.endTime))
  const merged: ExtractedReviewItem[] = []
  for (const item of sorted) {
    const previous = merged.at(-1)
    if (previous && item.endTime && previous.weekday === item.weekday && previous.endTime === item.startTime &&
      normalizeForMatch(previous.title) === normalizeForMatch(item.title) && previous.subjectId === item.subjectId) {
      previous.endTime = item.endTime
      previous.description = `${previous.description}; ${item.description}`.slice(0, 1000)
      previous.warnings = [...new Set([...previous.warnings, ...item.warnings])]
      continue
    }
    merged.push(item)
  }
  const nonSubjects = items.filter((item) => item.kind !== 'subject')
  return [...nonSubjects, ...unmergeable, ...merged].sort((a, b) => a.page - b.page || (a.weekday ?? 0) - (b.weekday ?? 0) || (a.startTime ?? a.startDate ?? '').localeCompare(b.startTime ?? b.startDate ?? ''))
}

function classifyDocument(sourceText: string): DocumentType {
  const text = sourceText.toLowerCase()
  const counts = {
    weekly_timetable: (text.match(/\b(timetable|time table|weekly schedule|period|lecture|lab|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\b/g) ?? []).length,
    examination_timetable: (text.match(/\b(examination timetable|exam schedule|exam timetable|date of exam|examination schedule)\b/g) ?? []).length,
    holiday_list: (text.match(/\b(holiday list|public holidays|college holidays|holidays)\b/g) ?? []).length,
    academic_calendar: (text.match(/\b(academic calendar|semester calendar|academic year|registration|semester begins|semester ends)\b/g) ?? []).length,
  }

  if (counts.examination_timetable >= 1 && counts.examination_timetable >= counts.weekly_timetable) return 'examination_timetable'
  if (/\bholiday\s+list\b/i.test(text)) return 'holiday_list'
  if (/\bacademic\s+calendar\b/i.test(text)) return 'academic_calendar'
  if (/\b(weekly\s+)?(class\s+)?time\s*table\b/i.test(text)) return 'weekly_timetable'
  if (counts.holiday_list >= 2 && counts.holiday_list >= counts.academic_calendar) return 'holiday_list'
  if (counts.academic_calendar >= 1 && counts.academic_calendar >= counts.weekly_timetable) return 'academic_calendar'
  if (counts.weekly_timetable >= 2) return 'weekly_timetable'
  return 'unknown'
}

export function buildImportReview(
  requestedType: DocumentType | 'auto' | 'timetable',
  extraction: DocumentExtraction | string,
  subjects: Subject[] = [],
): ImportReview {
  const normalizedExtraction: DocumentExtraction = typeof extraction === 'string'
    ? { sourceText: extraction, pages: extraction.split(/\n--- Page \d+ ---\n/).map((text, index) => ({
      page: index + 1,
      text,
      lines: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((text) => ({ text, page: index + 1 })),
      source: 'pdf_text' as const,
    })) }
    : extraction
  const safePages = normalizedExtraction.pages.map((page) => ({
    ...page,
    lines: page.lines.map((line) => ({
      ...line,
      text: Array.from(line.text).filter((character) => {
        const code = character.charCodeAt(0)
        return code === 9 || code === 10 || code === 13 || code >= 32
      }).join('').slice(0, 1000),
    })),
  }))
  const safeText = Array.from(normalizedExtraction.sourceText)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || code >= 32
    })
    .join('')
    .slice(0, MAX_SOURCE_TEXT_LENGTH)
  const detectedDocumentType = classifyDocument(safeText)
  const normalizedRequestedType = requestedType === 'timetable' ? 'weekly_timetable' : requestedType
  const documentType = normalizedRequestedType === 'auto' ? detectedDocumentType : normalizedRequestedType
  const kind: ImportJob['kind'] = documentType === 'weekly_timetable' || documentType === 'examination_timetable'
    ? 'timetable'
    : 'academic_calendar'
  const calendarType = documentType === 'holiday_list' ? 'holiday_list'
    : documentType === 'examination_timetable' ? 'examination_timetable'
      : 'academic_calendar'
  const items = documentType === 'unknown' ? []
    : documentType === 'weekly_timetable'
      ? makeTimetableItems(safePages, subjects)
      : documentType === 'examination_timetable'
        ? makeTimetableItems(safePages, subjects, true)
      : makeCalendarItems(safePages, calendarType)
  const year = /\b(?:19|20)\d{2}\s*[/-]\s*(?:19|20)\d{2}\b/.exec(safeText)?.[0]
  return {
    kind,
    documentType,
    detectedDocumentType,
    items,
    sourceText: safeText,
    pageCount: safePages.length,
    ...(year ? { academicYear: year.replace(/\s+/g, '') } : {}),
  }
}

export function reviewStateForItem(item: ExtractedReviewItem, existingItems: ExtractedReviewItem[]): ReviewState {
  if (item.validation === 'invalid' || item.validation === 'unrecognized') return item.validation
  const duplicate = existingItems.some((candidate) =>
    candidate.id !== item.id &&
    candidate.kind === item.kind &&
    candidate.weekday === item.weekday &&
    candidate.startTime === item.startTime &&
    candidate.endTime === item.endTime &&
    candidate.startDate === item.startDate &&
    normalizeForMatch(candidate.title) === normalizeForMatch(item.title),
  )
  return duplicate ? 'duplicate' : item.validation
}

export async function saveImportJob(
  kind: ImportJob['kind'],
  fileName: string,
  sourceType: ImportJob['sourceType'],
  review: ImportReview,
  status: ImportJob['status'] = 'review',
): Promise<ImportJob> {
  const now = nowIso()
  const job: ImportJob = {
    id: createId(),
    kind,
    fileName,
    status,
    sourceType,
    extractedData: JSON.stringify(review),
    confidence: review.items.length
      ? review.items.reduce((sum, item) => sum + item.confidence, 0) / review.items.length
      : 0,
    createdAt: now,
    updatedAt: now,
  }
  await db.importJobs.add(job)
  return job
}

export function findSubjectMatch(title: string, subjects: Subject[]) {
  return subjectMatch(title, subjects)
}
