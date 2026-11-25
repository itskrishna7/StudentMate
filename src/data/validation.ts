export function requireNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`)
}

export function requireDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} must be a valid date`)
  }
}

export function requireRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`)
  }
}
