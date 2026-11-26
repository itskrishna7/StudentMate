import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import englishOcrDataUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url'
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
  height?: number
}

export interface ExtractedLine {
  text: string
  page: number
  y?: number
  segments?: ExtractedSegment[]
  timeInferred?: boolean
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

function rotateCanvas(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const sideways = degrees === 90 || degrees === 270
  const canvas = document.createElement('canvas')
  canvas.width = sideways ? source.height : source.width
  canvas.height = sideways ? source.width : source.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not rotate the document image for OCR')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate((degrees * Math.PI) / 180)
  context.drawImage(source, -source.width / 2, -source.height / 2)
  return canvas
}

async function createOcrWorker(onWorkerProgress?: (status: string, progress: number) => void) {
  const { createWorker } = await import('tesseract.js')
  const corePath = new URL(`${import.meta.env.BASE_URL}tesseract-core/`, window.location.origin).href
  try {
    const worker = await timeout(createWorker('eng', 1, {
      cacheMethod: 'write',
      workerPath: tesseractWorkerUrl,
      workerBlobURL: false,
      corePath,
      langPath: new URL('.', new URL(englishOcrDataUrl, document.baseURI)).href,
      gzip: true,
      logger: (message) => onWorkerProgress?.(message.status, message.progress),
    }), 'The local OCR engine took too long to start. Try closing other browser tabs and processing a smaller document.')
    await worker.setParameters({
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    })
    return worker
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : ''
    if (/network|fetch|traineddata|language|load/i.test(message)) {
      throw new Error('The bundled English OCR model could not be loaded. Reopen or update the app, then try again.')
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
): Promise<{ text: string; confidence: number; lines: ExtractedLine[] }> {
  try {
    const result = await timeout(worker.recognize(canvas, {}, { blocks: true }), `OCR timed out on page ${page}. Try a smaller or clearer document.`)
    const lines = result.data.blocks?.flatMap((block) =>
      block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => ({
        page,
        text: line.text.trim(),
        y: line.bbox.y0,
        segments: line.words.map((word) => ({
          text: word.text.trim(),
          x: word.bbox.x0,
          width: word.bbox.x1 - word.bbox.x0,
          height: word.bbox.y1 - word.bbox.y0,
        })).filter((segment) => segment.text),
      })).filter((line) => line.text)),
    ) ?? []
    return { text: result.data.text, confidence: result.data.confidence / 100, lines }
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

function ocrStructureScore(text: string): number {
  const normalized = text.toLowerCase()
  const months = normalized.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/g) ?? []
  const weekdays = normalized.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/g) ?? []
  const dates = normalized.match(/\b(?:\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}|\d{1,2}\s+[a-z]{3,9}\s+(?:19|20)\d{2})\b/g) ?? []
  const times = normalized.match(/\b\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?\b/g) ?? []
  const timeRanges = normalized.match(/\b\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\b/g) ?? []
  const academicTerms = normalized.match(/\b(calendar|semester|holiday|holidays|examination|exam|vacation|registration|classes|lecture|timetable)\b/g) ?? []
  const recognizedWords = normalized.match(/\b[a-z]{4,}\b/g) ?? []
  return new Set(months).size * 4
    + new Set(weekdays).size * 5
    + dates.length * 3
    + times.length
    + timeRanges.length * 12
    + academicTerms.length * 2
    + Math.min(recognizedWords.length, 40) * 0.15
}

async function recognizeBestOrientation(
  worker: Awaited<ReturnType<typeof createOcrWorker>>,
  canvas: HTMLCanvasElement,
  page: number,
  pageCount: number,
  callback?: ProgressCallback,
): Promise<{ text: string; confidence: number; lines: ExtractedLine[] }> {
  let best = await recognizeCanvas(worker, canvas, page, pageCount, callback)
  let bestScore = ocrStructureScore(best.text)
  const hasReadableDatedEvent =
    /\b\d{1,2}\s+[a-z]{3,9}\s+(?:19|20)\d{2}\b|\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/i.test(best.text) &&
    /\b(holiday|exam|examination|registration|semester|classes|event)\b/i.test(best.text)
  const timetablePage = /\b(timetable|time\s*table|period|lecture)\b/i.test(best.text)
  if ((bestScore >= 18 && !timetablePage) || hasReadableDatedEvent) return best

  try {
    for (const mode of ['11', '6'] as const) {
      await worker.setParameters({ tessedit_pageseg_mode: mode as import('tesseract.js').PSM })
      const candidate = await recognizeCanvas(worker, canvas, page, pageCount, callback)
      const score = ocrStructureScore(candidate.text)
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: '3' as import('tesseract.js').PSM })
  }
  if (bestScore >= 18) return best

  for (const degrees of [90, 270]) {
    const rotated = rotateCanvas(canvas, degrees)
    try {
      const candidate = await recognizeCanvas(worker, rotated, page, pageCount, callback)
      const score = ocrStructureScore(candidate.text)
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
      if (bestScore >= 18) break
    } finally {
      rotated.width = 0
      rotated.height = 0
    }
  }
  return best
}

async function recognizeTimetableRows(
  worker: Awaited<ReturnType<typeof createOcrWorker>>,
  canvas: HTMLCanvasElement,
  lines: ExtractedLine[],
  page: number,
  pageCount: number,
  callback?: ProgressCallback,
): Promise<ExtractedLine[] | undefined> {
  const sourceText = lines.map((line) => line.text).join(' ')
  if (!/\b(timetable|time\s*table|period|lecture)\b/i.test(sourceText)) return undefined

  const dayLines = lines.filter((line) => line.y !== undefined && DAY_PATTERN.test(line.text))
  if (dayLines.length < 2) return undefined

  const croppedLines: ExtractedLine[] = []
  const cropCanvas = document.createElement('canvas')
  const canvasContext = cropCanvas.getContext('2d')
  if (!canvasContext) throw new Error('This browser could not crop timetable rows for OCR')
  const sortedDayLines = [...dayLines].sort((a, b) => a.y! - b.y!)
  const rowPitches = sortedDayLines.slice(1).flatMap((line, index) => {
    const previous = sortedDayLines[index]!
    const dayGap = (getWeekday(line.text) ?? 0) - (getWeekday(previous.text) ?? 0)
    return dayGap > 0 ? [(line.y! - previous.y!) / dayGap] : []
  }).sort((a, b) => a - b)
  const typicalPitch = rowPitches.length
    ? rowPitches[Math.floor(rowPitches.length / 2)]!
    : canvas.height * 0.05
  const rowHeight = Math.max(32, Math.min(110, Math.round(typicalPitch * 0.65)))
  cropCanvas.width = canvas.width
  try {
    for (const [index, line] of dayLines.entries()) {
      const top = Math.max(0, Math.floor(line.y! - 2))
      const bottom = Math.min(canvas.height, top + rowHeight)
      if (bottom <= top) continue
      cropCanvas.height = bottom - top
      canvasContext.drawImage(canvas, 0, top, canvas.width, bottom - top, 0, 0, canvas.width, bottom - top)
      emitProgress(callback, {
        phase: 'ocr',
        page,
        pageCount,
        progress: ((page - 1) + (index + 1) / dayLines.length) / pageCount,
        message: `Reading timetable row ${index + 1} of ${dayLines.length}`,
      })
      let best = line
      let bestScore = ocrStructureScore(line.text)
      for (const mode of ['11', '6'] as const) {
        await worker.setParameters({ tessedit_pageseg_mode: mode as import('tesseract.js').PSM })
        const candidate = await recognizeCanvas(worker, cropCanvas, page, pageCount, callback)
        const score = ocrStructureScore(candidate.text)
        if (score > bestScore && DAY_PATTERN.test(candidate.text)) {
          best = {
            page,
            y: top,
            text: candidate.text.trim(),
            segments: candidate.lines.flatMap((resultLine) => resultLine.segments ?? []).sort((a, b) => a.x - b.x),
          }
          bestScore = score
        }
      }
      const segments = best.segments?.length ? best.segments : line.segments
      if (segments?.length) croppedLines.push({ ...best, segments })
    }
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: '3' as import('tesseract.js').PSM })
    cropCanvas.width = 0
    cropCanvas.height = 0
  }

  if (!croppedLines.length) return undefined
  const bodyTop = Math.min(...dayLines.map((line) => line.y! - 2))
  const bodyBottom = Math.max(...dayLines.map((line) => line.y! + rowHeight))
  return [
    ...lines.filter((line) => line.y === undefined || line.y < bodyTop || line.y > bodyBottom),
    ...croppedLines,
  ].sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
}

export async function extractDocument(file: File, onProgress?: ProgressCallback): Promise<DocumentExtraction> {
  const type = validateImportFile(file)
  if (type === 'image') {
    const bitmap = await createImageBitmap(file).catch(() => {
      throw new Error('The image could not be opened. Try a valid PNG or JPEG file.')
    })
    const ratio = Math.min(2, Math.sqrt(MAX_CANVAS_PIXELS / (bitmap.width * bitmap.height)), 2800 / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * ratio))
    const height = Math.max(1, Math.round(bitmap.height * ratio))
    const canvas = createOcrCanvas(bitmap, width, height)
    bitmap.close()
    emitProgress(onProgress, { phase: 'ocr', page: 1, pageCount: 1, progress: 0, message: 'Preparing image for OCR' })
    const worker = await createOcrWorker((status, progress) => {
      emitProgress(onProgress, { phase: 'ocr', page: 1, pageCount: 1, progress, message: status })
    })
    try {
      const result = await recognizeBestOrientation(worker, canvas, 1, 1, onProgress)
      const rowLines = await recognizeTimetableRows(worker, canvas, result.lines, 1, 1, onProgress)
      const recognizedLines = rowLines ?? result.lines
      const lines = recognizedLines.length > 0
        ? recognizedLines
        : result.text.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ text, page: 1 }))
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
      const pdfText = textLines.map((line) => line.text).join('\n')
      if (pdfText.replace(/[^\p{L}\p{N}]/gu, '').length >= 24) {
        pages.push({ page: pageNumber, text: pdfText, lines: textLines, source: 'pdf_text' })
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
      const result = await recognizeBestOrientation(worker, prepared, pageNumber, pdfDocument.numPages, onProgress)
      const rowLines = await recognizeTimetableRows(worker, prepared, result.lines, pageNumber, pdfDocument.numPages, onProgress)
      const recognizedLines = rowLines ?? result.lines
      const lines = recognizedLines.length > 0
        ? recognizedLines
        : result.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ text: line, page: pageNumber }))
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

interface DateMatch {
  start: number
  end: number
  iso: string
  endIso?: string
  month?: number
  ambiguous: boolean
  inferredYear?: boolean
}

interface AcademicYearRange {
  label: string
  startYear: number
  endYear: number
}

function validIsoDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function findDateMatches(text: string, inferredYear?: number): DateMatch[] {
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
        month: Number(iso.slice(5, 7)),
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
      if (parsed.iso) matches.push({
        start: match.index!,
        end: match.index! + match[0].length,
        iso: parsed.iso,
        month: Number(parsed.iso.slice(5, 7)),
        ambiguous: parsed.ambiguous ?? false,
      })
    }
  }
  if (inferredYear !== undefined) {
    const listedDays = /\b(\d{1,2}(?:\s*(?:,|&|\/|\band\b)\s*\d{1,2})+)\s+([A-Za-z]{3,9})\.?(?![A-Za-z])/gi
    for (const match of text.matchAll(listedDays)) {
      const month = MONTHS[match[2]!.toLowerCase().replace(/\.$/, '')]
      if (!month) continue
      for (const dayMatch of match[1]!.matchAll(/\d{1,2}/g)) {
        const day = Number(dayMatch[0])
        const iso = validIsoDate(inferredYear, month, day)
        if (iso) matches.push({
          start: match.index! + dayMatch.index!,
          end: match.index! + dayMatch.index! + dayMatch[0].length,
          iso,
          month,
          ambiguous: false,
          inferredYear: true,
        })
      }
    }

    const monthDatePatterns = [
      {
        regex: /\b(\d{1,2})\s*(?:-|–|—|\bto\b)\s*(\d{1,2})\s*([A-Za-z]{3,9})\.?(?![A-Za-z])/gi,
        parse: (match: RegExpExecArray, month: number): { startDay: number; endDay?: number; month: number } => ({
          startDay: Number(match[1]),
          endDay: Number(match[2]),
          month,
        }),
      },
      {
        regex: /\b(\d{1,2})\s*([A-Za-z]{3,9})\.?(?![A-Za-z])/gi,
        parse: (match: RegExpExecArray, month: number): { startDay: number; endDay?: number; month: number } => ({
          startDay: Number(match[1]),
          month,
        }),
      },
      {
        regex: /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*(?:-|–|—)\s*(\d{1,2})\b/gi,
        parse: (match: RegExpExecArray, month: number): { startDay: number; endDay?: number; month: number } => ({
          startDay: Number(match[2]),
          endDay: Number(match[3]),
          month,
        }),
      },
    ]
    for (const { regex, parse } of monthDatePatterns) {
      for (const match of text.matchAll(regex)) {
        const monthText = (regex === monthDatePatterns[2]!.regex ? match[1] : match[3] ?? match[2])!
        const month = MONTHS[monthText.toLowerCase().replace(/\.$/, '')]
        if (!month) continue
        const date = parse(match, month)
        const iso = validIsoDate(inferredYear, date.month, date.startDay)
        const endIso = date.endDay === undefined ? undefined : validIsoDate(inferredYear, date.month, date.endDay)
        if (!iso || (date.endDay !== undefined && !endIso)) continue
        matches.push({
          start: match.index!,
          end: match.index! + match[0].length,
          iso,
          ...(endIso ? { endIso } : {}),
          month,
          ambiguous: false,
          inferredYear: true,
        })
      }
    }
  }
  return matches.sort((a, b) => a.start - b.start).filter((match, index, list) => index === 0 || match.start >= list[index - 1]!.end)
}

function findAcademicYear(text: string): AcademicYearRange | undefined {
  const match = /\b((?:19|20)\d{2})\s*[-–—/]\s*((?:19|20)\d{2}|\d{2})\b(?!\s*\/\s*\d{1,2}\b)/.exec(text)
  if (!match) return undefined
  const startYear = Number(match[1])
  const yearSuffix = match[2]!
  let endYear = yearSuffix.length === 2
    ? Math.floor(startYear / 100) * 100 + Number(yearSuffix)
    : Number(yearSuffix)
  if (endYear < startYear) endYear += 100
  return { label: match[0].replace(/\s+/g, ''), startYear, endYear }
}

function inferCalendarType(text: string): ExtractedReviewItem['eventType'] | undefined {
  if (/\b(registration|enrol(?:l)?ment|deadline|submission|last date|due date|withdrawal|freezing|finalization|dropping of courses)\b/i.test(text)) return 'deadline'
  if (/\b(internal|sessional|mid[- ]?term|unit)\s*(exam|test|assessment)|exam(?:ination)?\s*(i|ii|1|2|one|two)\b|\b(?:evaluation|conduction)\s+of\s+(?:cca|ia)\s*[12]?\b|\b(?:cca|ia)\s*[12]?\s*(?:qps?|question papers?|scrutiny|exam|test)\b/i.test(text)) return 'internal_exam'
  if (/\b(?:lab(?:oratory)?\s+internals?|internals?\s+exam)\b/i.test(text)) return 'internal_exam'
  if (/\b(exams?|examinations?|semester end examinations?|university exams?|end[- ]?term)\b/i.test(text)) return 'exam'
  if (/\b(holiday|holidays|public holiday|closed|jayanti|jayanthi|chaturthi|amavasya|vijayadashami|mahanavami|balipadyami)\b/i.test(text)) return 'holiday'
  if (/\b(vacation|recess|break)\b/i.test(text)) return 'vacation'
  if (/\b(result|orientation|commencement|semester begins|semester ends|classes begin|last working day)\b/i.test(text)) return 'special'
  if (/\b(event|festival|ceremony|workshop|conference|meeting|formation|feedback|synopsis|assessment|project|review|announcement)\b/i.test(text)) return 'event'
  return undefined
}

interface CalendarLineGroup {
  text: string
  x?: number
  left?: number
  y?: number
  height?: number
}

function groupCalendarLine(line: ExtractedLine, maxColumnGap?: number): CalendarLineGroup[] {
  const segments = line.segments?.filter((segment) => segment.text.trim()).sort((a, b) => a.x - b.x)
  if (!segments?.length) return [{ text: line.text.trim() }]
  if (segments.length === 1) return [{
    text: segments[0]!.text.trim(),
    x: segments[0]!.x,
    left: segments[0]!.x,
    ...(line.y !== undefined ? { y: line.y } : {}),
    ...(segments[0]!.height !== undefined ? { height: segments[0]!.height } : {}),
  }]

  const heights = segments.map((segment) => segment.height ?? 0).filter((height) => height > 0).sort((a, b) => a - b)
  const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)]! : 0
  const columnGap = maxColumnGap ?? Math.max(100, medianHeight * 3)
  const groups: Array<{ text: string; x: number; right: number }> = []
  for (const segment of segments) {
    const previous = groups.at(-1)
    if (previous && segment.x - previous.right <= columnGap) {
      previous.text += ` ${segment.text.trim()}`
      previous.right = segment.x + segment.width
    } else {
      groups.push({ text: segment.text.trim(), x: segment.x, right: segment.x + segment.width })
    }
  }
  return groups.map((group) => ({
    text: group.text,
    x: (group.x + group.right) / 2,
    left: group.x,
    ...(line.y !== undefined ? { y: line.y } : {}),
    ...(medianHeight > 0 ? { height: medianHeight } : {}),
  }))
}

function findCalendarTableColumns(lines: ExtractedLine[]): { dateLeft: number; splitX: number } | undefined {
  for (const line of lines) {
    const segments = line.segments ?? []
    const date = segments.find((segment) => /\bdate(?:s)?\b/i.test(segment.text))
    const events = segments.find((segment) => /\b(events?|holidays?)\b/i.test(segment.text))
    if (date && events && events.x > date.x + date.width) {
      return {
        dateLeft: date.x,
        splitX: (date.x + date.width + events.x) / 2,
      }
    }
  }
  return undefined
}

function leadingCalendarDates(text: string, year: number | undefined): DateMatch[] {
  const dates = findDateMatches(text, year)
  if (dates.length < 2) return dates
  const leading = [dates[0]!]
  for (const date of dates.slice(1)) {
    const previous = leading.at(-1)!
    const between = text.slice(previous.end, date.start)
    if (/[A-Za-z]{3,}/.test(between.replace(/\band\b/gi, ''))) break
    leading.push(date)
  }
  return leading
}

function dateMatches(date: DateMatch, reference: DateMatch): boolean {
  return date.iso === reference.iso && (date.endIso ?? date.iso) === (reference.endIso ?? reference.iso)
}

function calendarDescriptionForDate(
  description: string,
  date: DateMatch,
  year: number | undefined,
  dates: DateMatch[] = [date],
  dateIndex = 0,
): { title: string; description: string; matched: boolean } {
  const clauses = description.split(/\s*[•;]\s*/).map((clause) => clause.trim()).filter(Boolean)
  const matchedClause = clauses.find((clause) => findDateMatches(clause, year).some((reference) => dateMatches(date, reference)))
  const positionalClause = !matchedClause && clauses.length === dates.length ? clauses[dateIndex] : undefined
  const selected = matchedClause ?? positionalClause ?? description.trim()
  const references = findDateMatches(selected, year)
    .filter((reference) => dateMatches(date, reference))
    .sort((a, b) => b.start - a.start)
  let title = selected
  for (const reference of references) {
    title = `${title.slice(0, reference.start)} ${title.slice(reference.end)}`
  }
  title = title
    .replace(/\(\s*\)/g, ' ')
    .replace(/[|•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
    .trim()
  return {
    title: title || selected,
    description: selected,
    matched: Boolean(matchedClause),
  }
}

function adjacentCalendarDescription(lines: ExtractedLine[], index: number, x: number | undefined, year: number | undefined): string {
  for (const neighborIndex of [index - 1, index + 1]) {
    const neighbor = lines[neighborIndex]
    if (!neighbor) continue
    const candidates = groupCalendarLine(neighbor)
      .filter((group) => group.text.length > 3 && findDateMatches(group.text, year).length === 0)
      .filter((group) => x === undefined || group.x === undefined || Math.abs(group.x - x) <= 300)
      .sort((a, b) => x === undefined || a.x === undefined || b.x === undefined
        ? 0
        : Math.abs(a.x - x) - Math.abs(b.x - x))
    if (candidates[0]) return candidates[0].text
  }
  return ''
}

function makeCalendarItems(
  pages: ExtractedPage[],
  requestedType: Exclude<DocumentType, 'weekly_timetable' | 'unknown'>,
  academicYear?: AcademicYearRange,
): ExtractedReviewItem[] {
  const items: ExtractedReviewItem[] = []
  const tableItems: Array<{
    item: ExtractedReviewItem
    date: DateMatch
    dates: DateMatch[]
    dateIndex: number
    page: ExtractedPage
    boundaryOnly: boolean
  }> = []
  let currentYear = academicYear?.startYear
  let previousMonth: number | undefined
  for (const page of pages) {
    const lines = page.lines
    const tableColumns = findCalendarTableColumns(lines)
    const previousByColumn: Array<{ x: number; y?: number; height?: number; order: number; item: ExtractedReviewItem }> = []
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!
      const groups = groupCalendarLine(line, tableColumns ? 18 : undefined)
      const handledGroups = new Set<CalendarLineGroup>()
      for (const group of groups) {
        if (handledGroups.has(group)) continue
        const text = group.text
        const inDateColumn = !tableColumns || (
          group.left !== undefined &&
          group.left >= tableColumns.dateLeft - 30 &&
          group.left < tableColumns.splitX
        )
        const dates = tableColumns
          ? inDateColumn ? leadingCalendarDates(text, currentYear) : []
          : findDateMatches(text, currentYear)
        for (const date of dates) {
          if (date.inferredYear && date.month !== undefined && currentYear !== undefined) {
            if (previousMonth !== undefined && date.month < previousMonth && currentYear < (academicYear?.endYear ?? currentYear)) {
              currentYear += 1
            }
            date.iso = validIsoDate(currentYear, date.month, Number(date.iso.slice(8, 10))) ?? date.iso
            if (date.endIso) {
              const endMonth = Number(date.endIso.slice(5, 7))
              const endYear = endMonth < date.month && currentYear < (academicYear?.endYear ?? currentYear)
                ? currentYear + 1
                : currentYear
              date.endIso = validIsoDate(endYear, endMonth, Number(date.endIso.slice(8, 10))) ?? date.endIso
            }
          } else if (!date.inferredYear) {
            currentYear = Number(date.iso.slice(0, 4))
          }
          if (date.month !== undefined) previousMonth = date.month
        }
        if (dates.length === 0) {
          if (/^\s*date\s*[:.-]\s*\d/i.test(text)) continue
          const previous = group.x === undefined
            ? items.at(-1)
            : previousByColumn
              .filter((candidate) => {
                const verticalLimit = Math.max(40, (candidate.height ?? group.height ?? 0) * 3)
                const horizontalLimit = tableColumns ? Math.max(50, (candidate.height ?? group.height ?? 0) * 3) : 300
                return Math.abs(candidate.x - (tableColumns ? group.left ?? group.x! : group.x!)) <= horizontalLimit &&
                  (group.y === undefined || candidate.y === undefined || Math.abs(candidate.y - group.y) <= verticalLimit)
              })
              .sort((a, b) => {
                const verticalDistance = group.y === undefined || a.y === undefined || b.y === undefined
                  ? 0
                  : Math.abs(a.y - group.y) - Math.abs(b.y - group.y)
                return verticalDistance || b.order - a.order
              })[0]?.item
          if (previous && previous.page === page.page && previous.title && text.length > 3 && !/^(page\s+\d+|continued)$/i.test(text)) {
            const priorDescription = previous.description
            previous.description = `${priorDescription}${priorDescription ? ' ' : ''}${text}`.slice(0, 1000)
            if (previous.title === priorDescription) previous.title = previous.description
          }
          continue
        }

        const descriptionGroup = tableColumns
          ? groups
            .filter((candidate) => candidate !== group && candidate.left !== undefined && candidate.left >= tableColumns.splitX)
            .sort((a, b) => a.left! - b.left!)[0]
          : undefined
        if (descriptionGroup) handledGroups.add(descriptionGroup)
        const inlineDescription = tableColumns && !descriptionGroup
          ? text.slice(dates.at(-1)!.end).replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '').trim()
          : ''
        const rowDescription = descriptionGroup?.text ?? inlineDescription
        dates.forEach((date, dateIndex) => {
          const boundaryOnly = /\b(?:after|before)\s*$/i.test(text.slice(0, date.start))
          const precedingDate = dateIndex > 0 ? dates[dateIndex - 1] : undefined
          const followingDate = dates[dateIndex + 1]
          const before = text.slice(precedingDate?.end ?? 0, date.start).replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '').trim()
          const after = text.slice(date.end, followingDate?.start ?? text.length).replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '').trim()
          const description = tableColumns
            ? rowDescription || after || before
            : after || before || adjacentCalendarDescription(lines, index, group.x, currentYear)
          const mappedDescription = calendarDescriptionForDate(description, date, currentYear, dates, dateIndex)
          const title = tableColumns ? mappedDescription.title : description
          const originalDescription = tableColumns ? mappedDescription.description : description
          const startDate = date.iso
          const endDate = date.endIso ?? startDate
          const eventType = requestedType === 'holiday_list' ? 'holiday' : inferCalendarType(`${title} ${originalDescription}`)
          const ambiguousDate = date.ambiguous
          const inferredEventYear = Boolean(date.inferredYear)
          const hasType = Boolean(eventType)
          const descriptionDateMatch = tableColumns && rowDescription
            ? findDateMatches(rowDescription, currentYear).some((reference) => dateMatches(date, reference))
            : false
          const sharedDescription = Boolean(tableColumns && dates.length > 1 && rowDescription && !descriptionDateMatch)
          const validation: ReviewState = !title
            ? 'invalid'
            : boundaryOnly || ambiguousDate || inferredEventYear || !hasType || sharedDescription
              ? 'needs_review'
              : page.source === 'ocr' && (page.ocrConfidence ?? 0) < 0.7
                ? 'needs_review'
                : 'high_confidence'
          const warnings = [
            ...(!title ? ['No event description was found'] : []),
            ...(ambiguousDate ? ['Numeric date interpreted as DD/MM/YYYY; verify the date'] : []),
            ...(inferredEventYear && !boundaryOnly ? ['Year inferred from the academic-year heading; verify the date'] : []),
            ...(boundaryOnly ? ['Date is a boundary only; the exact event date was not stated'] : []),
            ...(!hasType ? ['Event type could not be identified from the description'] : []),
            ...(sharedDescription ? ['A description is associated with multiple dates; verify the event mapping'] : []),
            ...(page.source === 'ocr' && (page.ocrConfidence ?? 0) < 0.7 ? ['Low OCR confidence; verify the extracted text'] : []),
          ]
          const item: ExtractedReviewItem = {
            id: createId(),
            kind: 'event',
            title: title || 'Unrecognized event',
            description: originalDescription,
            ...(eventType ? { eventType } : {}),
            ...(!boundaryOnly ? { date: startDate, startDate, endDate } : {}),
            page: page.page,
            confidence: Math.min(page.source === 'ocr' ? page.ocrConfidence ?? 0.45 : 0.88, ambiguousDate || inferredEventYear || !hasType ? 0.58 : 0.96),
            validation,
            warnings,
            subjectMatch: 'not_applicable',
          }
          items.push(item)
          if (tableColumns) tableItems.push({ item, date, dates, dateIndex, page, boundaryOnly })
          const descriptionColumn = descriptionGroup?.left ??
            (inlineDescription && tableColumns ? tableColumns.splitX : tableColumns ? group.left ?? group.x : group.x)
          if (descriptionColumn !== undefined) previousByColumn.push({
            x: descriptionColumn,
            ...(group.y !== undefined ? { y: group.y } : {}),
            ...(group.height !== undefined ? { height: group.height } : {}),
            order: items.length,
            item,
          })
        })
      }
    }
  }
  for (const { item, date, dates, dateIndex, page, boundaryOnly } of tableItems) {
    const mapped = calendarDescriptionForDate(item.description, date, Number(date.iso.slice(0, 4)), dates, dateIndex)
    const eventType = requestedType === 'holiday_list' ? 'holiday' : inferCalendarType(`${mapped.title} ${mapped.description}`)
    item.title = mapped.title || 'Unrecognized event'
    item.description = mapped.description
    item.eventType = eventType
    item.warnings = item.warnings.filter((warning) =>
      warning !== 'No event description was found' &&
      warning !== 'Event type could not be identified from the description' &&
      warning !== 'A description is associated with multiple dates; verify the event mapping',
    )
    if (!eventType) item.warnings.push('Event type could not be identified from the description')
    if (dates.length > 1 && !mapped.matched) item.warnings.push('A description is associated with multiple dates; verify the event mapping')
    item.validation = !mapped.title
      ? 'invalid'
      : boundaryOnly || date.ambiguous || date.inferredYear || !eventType || (dates.length > 1 && !mapped.matched)
        ? 'needs_review'
        : page.source === 'ocr' && (page.ocrConfidence ?? 0) < 0.7
          ? 'needs_review'
          : 'high_confidence'
    item.confidence = Math.min(page.source === 'ocr' ? page.ocrConfidence ?? 0.45 : 0.88, item.validation === 'high_confidence' ? 0.96 : 0.58)
  }
  return items
}

const DAY_PATTERN = /\b(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\b/i
const TIME_PATTERN = /(?<![\d/])(\d{1,2}(?::[0-5]\d|[.][0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?)(?![\d/])/gi

function parseTime(value: string): string | undefined {
  const compact = /^\s*(\d{3,4})\s*(a\.?m\.?|p\.?m\.?)?\s*$/i.exec(value)
  const normalized = compact
    ? `${compact[1]!.length === 3 ? compact[1]!.slice(0, 1) : compact[1]!.slice(0, 2)}:${compact[1]!.slice(-2)}${compact[2] ? ` ${compact[2]}` : ''}`
    : value
  const match = /^\s*(\d{1,2})(?::|\.([0-5]\d))?([0-5]\d)?\s*(a\.?m\.?|p\.?m\.?)?\s*$/i.exec(normalized)
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
  const rangePattern = /(?<!\d)(\d{1,2}(?::[0-5]\d|[.][0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:-|–|—|\bto\b)\s*(\d{1,2}(?::[0-5]\d|[.][0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?)(?!\d)/i
  const match = rangePattern.exec(text)
  const compactMatch = match ? undefined : /(?<!\d)(\d{3,4})\s*(?:[-–—]\s*)?(\d{3,4})(?!\d)/.exec(text)
  if (!match && compactMatch) {
    if (/^(?:19|20)\d{2}$/.test(compactMatch[1]!) && /^(?:19|20)\d{2}$/.test(compactMatch[2]!)) return undefined
    const startTime = parseTime(compactMatch[1]!)
    const endTime = parseTime(compactMatch[2]!)
    if (startTime && endTime) {
      const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3))
      const end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3))
      if (end > start) return { startTime, endTime, start, end }
    }
  }
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
  const titleTokens = tokens(title)
  const aliases = subjects.filter((subject) => {
    const subjectTokens = tokens(`${subject.name} ${subject.code ?? ''}`)
    if (titleTokens.size > 0 && [...titleTokens].every((token) => subjectTokens.has(token))) return true
    if (titleTokens.size !== 1 || normalized.length < 2) return false
    const abbreviation = [...normalizeForMatch(subject.name).split(' ')
      .filter((token) => token.length > 1 && !['and', 'for', 'the', 'with'].includes(token))]
      .map((token) => token[0])
      .join('')
    return abbreviation.startsWith(normalized)
  })
  if (aliases.length === 1) return { state: 'matched', subjectId: aliases[0]!.id }
  if (aliases.length > 1) return { state: 'ambiguous' }

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
  const classRoom = /\bclass\s*room\s*[:#-]?\s*([^|,;]+)/i.exec(text)
  if (classRoom) return classRoom[1]!.trim()
  const match = /\b(room|rm|lab|laboratory|classroom|lb)\s*[-:#]?\s*([A-Z0-9][A-Z0-9-]*)/i.exec(text)
  if (!match) return undefined
  const [, label, code] = match
  if (/^(?:room|rm|classroom)$/i.test(label!)) return `Room ${code}`
  if (/^lb$/i.test(label!)) return `LB: ${code}`
  return `${label![0]!.toUpperCase()}${label!.slice(1)}-${code}`
}

function cleanSubjectTitle(text: string): string {
  return text
    .replace(DAY_PATTERN, ' ')
    .replace(/\b\d{1,2}(?::[0-5]\d|[.][0-5]\d)\s*(?:a\.?m\.?|p\.?m\.?)?|\b\d{1,2}\s*a\.?m\.?|\b\d{1,2}\s*p\.?m\.?/ig, ' ')
    .replace(/\b(room|rm|lab|laboratory|classroom|lb)\b\s*[-:#]?\s*[A-Z0-9-]+/ig, ' ')
    .replace(/\(\s*\)/g, ' ')
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

function normalizeTimetableColumns<T extends {
  range: NonNullable<ReturnType<typeof parseTimeRange>>
  text: string
}>(
  columns: T[],
): Array<T & { timeInferred: boolean }> {
  let previousEnd = -1
  return columns.map((column) => {
    const { range } = column
    let start = range.start
    let end = range.end
    let timeInferred = false
    const explicitMeridiem = /[ap]\.?m\.?/i.test(column.text)
    if (!explicitMeridiem && start >= 12 * 60 && end < 12 * 60) {
      end += 12 * 60
      timeInferred = true
    } else if (!explicitMeridiem && end <= start && start < 12 * 60 && end < 12 * 60) {
      end += 12 * 60
      timeInferred = true
    }
    if (!explicitMeridiem && previousEnd >= 12 * 60 && start < 12 * 60) {
      start += 12 * 60
      end += 12 * 60
      timeInferred = true
    }
    previousEnd = end
    const format = (minutes: number) =>
      `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    return {
      ...column,
      range: { ...range, start, end, startTime: format(start), endTime: format(end) },
      timeInferred,
    }
  })
}

function expandTimetableGrid(page: ExtractedPage): ExtractedPage {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const timedSegments = page.lines.flatMap((line) =>
    line.y === undefined
      ? []
      : (line.segments ?? []).flatMap((segment) => {
        const range = parseTimeRange(segment.text)
        return range ? [{ range, x: segment.x, y: line.y!, text: segment.text }] : []
      }),
  )
  const timeHeader = timedSegments
    .map((seed) => timedSegments.filter((candidate) => Math.abs(candidate.y - seed.y) <= 24))
    .sort((a, b) => new Set(b.map((entry) => Math.round(entry.x / 30))).size - new Set(a.map((entry) => Math.round(entry.x / 30))).size)[0]
  const separatedTimeColumns = normalizeTimetableColumns([...(timeHeader ?? [])]
    .sort((a, b) => a.x - b.x)
    .filter((entry, index, entries) => index === 0 || Math.abs(entry.x - entries[index - 1]!.x) >= 30))

  if (separatedTimeColumns.length >= 2) {
    const gaps = separatedTimeColumns.slice(1).map((column, index) => column.x - separatedTimeColumns[index]!.x).sort((a, b) => a - b)
    const typicalGap = gaps[Math.floor(gaps.length / 2)]!
    const generated: ExtractedLine[] = []
    const consumed = new Set<ExtractedLine>()
    const headerY = Math.max(...separatedTimeColumns.map((column) => column.y))
    const weekdayRows = page.lines.flatMap((line) => {
      const segment = line.segments?.find((candidate) => getWeekday(candidate.text) !== undefined)
      const weekday = segment ? getWeekday(segment.text) : undefined
      return weekday === undefined || line.y === undefined || line.y >= headerY - 8 && page.source !== 'ocr' || line.y <= headerY + 8 && page.source === 'ocr'
        ? []
        : [{ line, weekday, y: line.y }]
    })
    const sortedWeekdayRows = [...weekdayRows].sort((a, b) => a.y - b.y)
    const rowGaps = sortedWeekdayRows.slice(1).map((row, index) => row.y - sortedWeekdayRows[index]!.y).sort((a, b) => a - b)
    const typicalRowGap = rowGaps.length ? rowGaps[Math.floor(rowGaps.length / 2)]! : typicalGap
    for (const [rowIndex, row] of sortedWeekdayRows.entries()) {
      const previousY = sortedWeekdayRows[rowIndex - 1]?.y ?? row.y - typicalRowGap
      const nextY = sortedWeekdayRows[rowIndex + 1]?.y ?? row.y + typicalRowGap
      const minY = (previousY + row.y) / 2
      const maxY = (row.y + nextY) / 2
      const cells: Array<{ cell: ExtractedSegment; y: number; firstIndex: number; lastIndex: number }> = []
      for (const line of page.lines) {
        if (line.y === undefined || line.y < minY || line.y > maxY || !line.segments?.length) continue
        const heights = line.segments.map((segment) => segment.height ?? 0).filter((height) => height > 0).sort((a, b) => a - b)
        const wordGap = Math.max(8, (heights[Math.floor(heights.length / 2)] ?? 14) * 0.9)
        let group: ExtractedSegment | undefined
        const flushGroup = () => {
          if (!group) return
          const firstColumn = separatedTimeColumns.reduce((best, column) =>
            Math.abs(column.x - group!.x) < Math.abs(best.x - group!.x) ? column : best,
          )
          const firstIndex = separatedTimeColumns.indexOf(firstColumn)
          if (Math.abs(firstColumn.x - group.x) <= typicalGap * 0.65) {
            const cellEnd = group.x + Math.max(0, group.width)
            const lastColumn = [...separatedTimeColumns.slice(firstIndex)].reverse().find((column) => column.x < cellEnd) ?? firstColumn
            cells.push({ cell: group, y: line.y!, firstIndex, lastIndex: separatedTimeColumns.indexOf(lastColumn) })
          }
          group = undefined
        }
        for (const segment of [...line.segments].sort((a, b) => a.x - b.x)) {
          if (getWeekday(segment.text) !== undefined || parseTimeRange(segment.text) ||
            /^(?:tea|break)$/i.test(segment.text.trim()) || /^[|:;.,]+$/.test(segment.text.trim())) {
            flushGroup()
            continue
          }
          if (group && segment.x - (group.x + group.width) <= wordGap) {
            group.text += ` ${segment.text}`
            group.width = segment.x + segment.width - group.x
            group.height = Math.max(group.height ?? 0, segment.height ?? 0)
          } else {
            flushGroup()
            group = { ...segment }
          }
        }
        flushGroup()
      }

      const bySlot = new Map<string, typeof cells>()
      for (const cell of cells) {
        const key = `${cell.firstIndex}:${cell.lastIndex}`
        const entries = bySlot.get(key) ?? []
        entries.push(cell)
        bySlot.set(key, entries)
      }
      for (const [key, entries] of bySlot) {
        const firstIndex = Number(key.split(':')[0])
        const lastIndex = Number(key.split(':')[1])
        const columns = entries.sort((a, b) => page.source === 'ocr' ? a.y - b.y : b.y - a.y)
        const groups: typeof cells[] = []
        for (const entry of columns) {
          const previous = groups.at(-1)?.at(-1)
          const sameBatchCell = previous && /\bbatch\s*\d+\b/i.test(previous.cell.text) && /\bbatch\s*\d+\b/i.test(entry.cell.text)
          if (previous && Math.abs(previous.y - entry.y) <= 13 && !sameBatchCell) groups.at(-1)!.push(entry)
          else groups.push([entry])
        }
        for (const cellGroup of groups) {
          const firstColumn = separatedTimeColumns[firstIndex]!
          const lastColumn = separatedTimeColumns[lastIndex]!
          const title = cellGroup.map((entry) => entry.cell.text).join(' ')
          const cleanedTitle = cleanSubjectTitle(title)
          if (normalizeForMatch(cleanedTitle).length < 2 && !/C\+\+/i.test(cleanedTitle)) continue
          generated.push({
            page: page.page,
            text: `${dayNames[row.weekday]} ${firstColumn.range.startTime}-${lastColumn.range.endTime} ${title}`,
            timeInferred: firstColumn.timeInferred || lastColumn.timeInferred,
          })
        }
      }
      consumed.add(row.line)
    }

    if (generated.length) {
      return { ...page, lines: [...page.lines.filter((line) => !consumed.has(line)), ...generated] }
    }
  }

  const isHeader = (line: ExtractedLine) => {
    if ((line.segments?.length ?? 0) < 3) return false
    const dayCount = new Set(line.segments!.flatMap((segment) => {
      const weekday = getWeekday(segment.text)
      return weekday === undefined ? [] : [weekday]
    })).size
    const timeCount = line.segments!.filter((segment) => parseTimeRange(segment.text)).length
    return dayCount >= 2 || timeCount >= 2
  }
  const header = page.lines.find((line) =>
    isHeader(line) && line.segments!.filter((segment) => parseTimeRange(segment.text)).length >= 2,
  ) ?? page.lines.find(isHeader)
  if (!header?.segments) return page

  const dayColumns = header.segments.flatMap((segment) => {
    const weekday = getWeekday(segment.text)
    return weekday === undefined ? [] : [{ weekday, x: segment.x }]
  })
  const timeColumns = normalizeTimetableColumns(header.segments.flatMap((segment) => {
    const range = parseTimeRange(segment.text)
    return range ? [{ range, x: segment.x, text: segment.text }] : []
  }))
  const timeColumnGaps = timeColumns.slice(1).map((column, index) => column.x - timeColumns[index]!.x).sort((a, b) => a - b)
  const typicalTimeColumnGap = timeColumnGaps.length
    ? timeColumnGaps[Math.floor(timeColumnGaps.length / 2)]!
    : 0
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
      const cells: ExtractedSegment[] = []
      let group: ExtractedSegment | undefined
      const heights = line.segments.map((segment) => segment.height ?? 0).filter((height) => height > 0).sort((a, b) => a - b)
      const wordGap = Math.max(8, (heights[Math.floor(heights.length / 2)] ?? 14) * 0.9)
      const flushGroup = () => {
        if (group) cells.push(group)
        group = undefined
      }
      for (const segment of [...line.segments].sort((a, b) => a.x - b.x)) {
        if (segment === daySegment || parseTimeRange(segment.text)) continue
        if (/^[|:;.,]+$/.test(segment.text.trim())) {
          flushGroup()
          continue
        }
        if (group && segment.x - (group.x + group.width) <= wordGap) {
          group.text += ` ${segment.text}`
          group.width = segment.x + segment.width - group.x
          group.height = Math.max(group.height ?? 0, segment.height ?? 0)
        } else {
          flushGroup()
          group = { ...segment }
        }
      }
      flushGroup()
      const beforeCount = generated.length
      for (const cell of cells) {
        let firstColumn = nearest(cell.x, timeColumns)
        if (!firstColumn || Math.abs(firstColumn.x - cell.x) > typicalTimeColumnGap * 0.65) continue
        const nearestColumnIndex = timeColumns.indexOf(firstColumn)
        const previousColumn = timeColumns[nearestColumnIndex - 1]
        if (previousColumn && typicalTimeColumnGap > 0 &&
          Math.abs(firstColumn.x - cell.x) > typicalTimeColumnGap * 0.35 &&
          Math.abs(previousColumn.x - cell.x) > typicalTimeColumnGap * 0.35 &&
          cell.width >= typicalTimeColumnGap * 0.45) {
          firstColumn = previousColumn
        }
        const firstColumnIndex = timeColumns.indexOf(firstColumn)
        const cellEnd = cell.x + Math.max(0, cell.width)
        const lastColumn = [...timeColumns.slice(firstColumnIndex)].reverse().find((column) => column.x < cellEnd) ?? firstColumn
        const endTime = lastColumn.range.endTime
        const title = cleanSubjectTitle(cell.text)
        if (normalizeForMatch(title).length < 2) continue
        generated.push({
          page: page.page,
          text: `${dayNames[weekday]} ${firstColumn.range.startTime}-${endTime} ${title}`,
          timeInferred: firstColumn.timeInferred || lastColumn.timeInferred,
        })
      }
      if (generated.length > beforeCount) consumed.add(line)
    }
  }

  return generated.length
    ? { ...page, lines: [
      ...page.lines.filter((line) => !consumed.has(line) && DAY_PATTERN.test(line.text) && parseTimeRange(line.text)),
      ...generated,
    ] }
    : page
}

function extractTeacherNames(text: string): string[] {
  return text.match(/\b(?:Prof|Dr|Lt)\.\s*[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*/g) ?? []
}

function timetableFacultyMaps(pages: ExtractedPage[]): { faculty: Map<string, string>; laboratory: Map<string, string> } {
  const faculty = new Map<string, string>()
  const laboratory = new Map<string, string>()
  for (const page of pages) {
    const tableStart = page.lines.findIndex((line) => /\bsubject\b.*\bcode\b.*\bfaculty\b/i.test(line.text))
    if (tableStart < 0) continue
    const lines = page.lines.slice(tableStart + 1)
    const subjectRows = lines.flatMap((line) => {
      const subject = line.segments?.find((segment) =>
        segment.x < 250 && segment.text.trim().length > 10 && !/^batch\s*\d/i.test(segment.text),
      )
      return subject ? [{ line, subject }] : []
    })
    for (const { line, subject } of subjectRows) {
      const nearbyLines = lines.filter((candidate) =>
        line.y === undefined || candidate.y === undefined || Math.abs(candidate.y - line.y) <= 14,
      )
      const continuation = nearbyLines.flatMap((candidate) => candidate.segments ?? [])
        .filter((segment) => segment.x < 250 && segment !== subject && segment.text.trim().length <= 10 && /[a-z]{2}/i.test(segment.text))
        .map((segment) => segment.text)
      const subjectText = [subject.text, ...continuation].join(' ')
      const coreNames = [...new Set(nearbyLines.flatMap((candidate) => (candidate.segments ?? [])
        .filter((segment) => segment.x >= 250 && segment.x < 500)
        .flatMap((segment) => extractTeacherNames(segment.text))))]
      const practicalSegments = nearbyLines.flatMap((candidate) => (candidate.segments ?? [])
        .filter((segment) => segment.x >= 500)
        .map((segment) => ({ segment, y: candidate.y })))
      const practicalNames = [...new Set(practicalSegments.flatMap(({ segment, y }) => {
        const names = extractTeacherNames(segment.text)
        if (names.length || !/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(segment.text.trim())) return names
        const hasDanglingTitle = practicalSegments.some((candidate) =>
          /\b(?:Prof|Dr|Lt)\.\s*$/.test(candidate.segment.text) &&
          (y === undefined || candidate.y === undefined || Math.abs(candidate.y - y) <= 14),
        )
        return hasDanglingTitle ? [segment.text.trim()] : []
      }))]
      const aliases = [
        subjectText,
        ...[...subjectText.matchAll(/\(([A-Z0-9+]{2,})\)?/g)].map((match) => match[1]!),
        ...subjectText.match(/\b[A-Z]{2,}(?:\s+[A-Z]{2,})*\b/g) ?? [],
      ]
      if (/c\+\+/i.test(subjectText)) aliases.push('C++')
      if (/additional\s+mathematics/i.test(subjectText) && nearbyLines.some((candidate) =>
        candidate.segments?.some((segment) => /\bMATDIP\b/i.test(segment.text)),
      )) {
        aliases.push('DIP MATHS')
      }
      const isLaboratory = /\b(lab|laboratory|practical)\b/i.test(subjectText)
      for (const alias of aliases) {
        const normalized = normalizeForMatch(alias)
        if (!normalized) continue
        if (coreNames.length && !faculty.has(normalized)) faculty.set(normalized, coreNames.join(' / '))
        const labNames = isLaboratory ? [...new Set([...coreNames, ...practicalNames])] : practicalNames
        if (labNames.length && !laboratory.has(normalized)) laboratory.set(normalized, labNames.join(' / '))
        for (const { segment: practicalSegment, y } of practicalSegments) {
          const batch = /\bbatch\s*(\d+)\b/i.exec(practicalSegment.text)?.[1]
          if (!batch) continue
          const batchNames = [...new Set([
            ...extractTeacherNames(practicalSegment.text),
            ...practicalSegments
              .filter((candidate) => candidate.y !== undefined && y !== undefined && Math.abs(candidate.y - y) <= 14)
              .flatMap(({ segment }) =>
                /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(segment.text.trim()) &&
                practicalSegments.some((candidate) =>
                  /\b(?:Prof|Dr|Lt)\.\s*$/.test(candidate.segment.text) &&
                  (candidate.y === undefined || y === undefined || Math.abs(candidate.y - y) <= 14),
                )
                  ? [segment.text.trim()]
                  : [],
              ),
          ])]
          if (!batchNames.length) continue
          const batchAliases = isLaboratory
            ? [`${alias} lab batch ${batch}`, `${alias} batch ${batch}`]
            : [`${alias} lab batch ${batch}`]
          for (const batchAlias of batchAliases) {
            const batchKey = normalizeForMatch(batchAlias)
            if (batchKey && !laboratory.has(batchKey)) laboratory.set(batchKey, batchNames.join(' / '))
          }
        }
      }
    }
  }
  return { faculty, laboratory }
}

function findTimetableTeacher(
  title: string,
  lectureKind: 'lecture' | 'laboratory' | 'break',
  maps: ReturnType<typeof timetableFacultyMaps>,
): string | undefined {
  const normalized = normalizeForMatch(title)
  const candidates = lectureKind === 'laboratory'
    ? [...maps.laboratory, ...[...maps.faculty].filter(([alias]) => !maps.laboratory.has(alias))]
    : [...maps.faculty]
  const matches = candidates
    .filter(([alias]) => normalized === alias || normalized.startsWith(`${alias} `))
    .sort(([a], [b]) => b.length - a.length)
  if (!matches.length) return undefined
  const [alias, teacher] = matches[0]!
  const equallySpecific = matches.filter(([candidate]) => candidate.length === alias.length)
  return equallySpecific.every(([, candidateTeacher]) => candidateTeacher === teacher) ? teacher : undefined
}

function makeTimetableItems(pages: ExtractedPage[], subjects: Subject[], examination = false): ExtractedReviewItem[] {
  const items: ExtractedReviewItem[] = []
  const facultyMaps = timetableFacultyMaps(pages)
  const sharedRoom = pages
    .flatMap((page) => page.lines)
    .map((line) => extractRoom(line.text))
    .find((room) => room !== undefined)
  for (const page of pages.map(expandTimetableGrid)) {
    for (const line of page.lines) {
      const text = line.text.trim()
      const weekday = getWeekday(text)
      const timeRange = parseTimeRange(text)

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

      const day = weekday
      if (day === undefined) continue
      let title = ''
      let teacher = ''
      const room = extractRoom(text) ?? sharedRoom

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
      teacher = teacherMatch?.[1]?.trim() ?? findTimetableTeacher(title, inferLectureKind(text), facultyMaps) ?? ''
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
        ...(line.timeInferred ? ['Afternoon meridiem inferred from the timetable sequence; verify this time'] : []),
        ...(duplicate ? ['Duplicate timetable row detected'] : []),
        ...(overlap ? ['This row overlaps another extracted session'] : []),
        ...(page.source === 'ocr' && (page.ocrConfidence ?? 0) < 0.7 ? ['Low OCR confidence; verify the extracted text'] : []),
      ]
      const validation: ReviewState = duplicate ? 'duplicate'
        : !valid ? 'invalid'
          : line.timeInferred ? 'needs_review'
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
    academic_calendar: (text.match(/\b(academic calendar|semester calendar|academic year|registration|semester begins|semester ends|calendar of events|academic events?|date\(s\))\b/g) ?? []).length,
  }
  const monthNames = new Set(text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/g) ?? [])
  const numberedCells = text.match(/\b\d{1,2}\b/g) ?? []

  if (counts.examination_timetable >= 1 && counts.examination_timetable >= counts.weekly_timetable) return 'examination_timetable'
  if (/\bholiday\s+list\b/i.test(text)) return 'holiday_list'
  if (/\b(?:tentative\s+)?calendar\s+of\s+events\b|\bacademic\s+events?\s*(?:&|and)\s*holidays\b/i.test(text)) return 'academic_calendar'
  if (/\bacademic\s+calendar\b/i.test(text)) return 'academic_calendar'
  if (monthNames.size >= 3 && /\bmonth\b/i.test(text) && /\bdate(?:s)?\b/i.test(text) && /\bevents?\b/i.test(text)) return 'academic_calendar'
  if (monthNames.size >= 6 && numberedCells.length >= 20) return 'academic_calendar'
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
  const academicYear = findAcademicYear(safeText)
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
      : makeCalendarItems(safePages, calendarType, academicYear)
  return {
    kind,
    documentType,
    detectedDocumentType,
    items,
    sourceText: safeText,
    pageCount: safePages.length,
    ...(academicYear ? { academicYear: academicYear.label } : {}),
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
