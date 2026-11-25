import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url'
import { db } from './database'
import { createId, nowIso } from './settings'
import type { ImportJob } from './models'

export interface ExtractedReviewItem {
  kind: 'subject' | 'event'
  title: string
  date?: string
  startTime?: string
  endTime?: string
  weekday?: number
  confidence: number
}

export interface ImportReview {
  kind: ImportJob['kind']
  items: ExtractedReviewItem[]
  sourceText: string
}

export const MAX_IMPORT_SIZE = 15 * 1024 * 1024

export function validateImportFile(file: File): 'pdf' | 'image' {
  if (file.size <= 0) throw new Error('The selected file is empty')
  if (file.size > MAX_IMPORT_SIZE) throw new Error('The file is larger than the 15 MB limit')
  if (file.type === 'application/pdf') return 'pdf'
  if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return 'image'
  throw new Error('Only PDF, PNG, JPEG, and WebP files are accepted')
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const data = await file.arrayBuffer()
  const document = await pdfjs.getDocument({ data }).promise
  if (document.numPages > 100) throw new Error('PDFs must contain 100 pages or fewer')
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }
  return pages.join('\n')
}

export async function extractImageText(file: File): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const corePath = new URL(`${import.meta.env.BASE_URL}tesseract-core`, window.location.origin).href
  const worker = await createWorker('eng', 1, {
    cacheMethod: 'write',
    workerPath: tesseractWorkerUrl,
    corePath,
  })
  try {
    const result = await worker.recognize(file)
    return result.data.text
  } finally {
    await worker.terminate()
  }
}

export function buildImportReview(kind: ImportJob['kind'], text: string): ImportReview {
  const items: ExtractedReviewItem[] = []
  const safeText = Array.from(text)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || code >= 32
    })
    .join('')
    .slice(0, 10000)
  const lines = safeText.split(/\n|,/).map((line) => line.trim().slice(0, 500)).filter(Boolean)
  const datePattern = /\b(?:\d{4}-\d{2}-\d{2}|(?:\d{1,2}[/-]){2}\d{2,4})\b/
  const timePattern = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/

  for (const line of lines.slice(0, 40)) {
    if (kind === 'timetable') {
      const timeMatch = line.match(timePattern)
      const weekdayMatch = /\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i.exec(line)
      if (timeMatch || weekdayMatch) {
        items.push({
          kind: 'subject',
          title: line.replace(timePattern, '').replace(/\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/gi, '').trim() || 'Unrecognized subject',
          ...(timeMatch?.[0] ? { startTime: timeMatch[0] } : {}),
          ...(weekdayMatch?.[1] ? { weekday: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].findIndex((prefix) => weekdayMatch[1]!.toLowerCase().startsWith(prefix)) } : {}),
          confidence: timeMatch && weekdayMatch ? 0.75 : 0.45,
        })
      }
    } else if (datePattern.test(line)) {
      items.push({
        kind: 'event',
        title: line.replace(datePattern, '').trim() || 'Unrecognized event',
        ...(line.match(datePattern)?.[0] ? { date: line.match(datePattern)![0] } : {}),
        confidence: 0.55,
      })
    }
  }
  return { kind, items, sourceText: safeText }
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
