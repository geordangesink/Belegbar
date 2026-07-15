/**
 * Human-readable stored filename generation:
 *   YYYY_MM_DD-Company_Service-InvoiceNumber.pdf
 * with explicit placeholders for missing parts (never invented values):
 *   Unknown-Date / Unknown-Company / Unknown-Service / Unknown-Invoice
 */

export interface FilenameFields {
  /** ISO invoice date or null */
  invoiceDate: string | null
  /** counterparty: customer for income, supplier for expense */
  company: string | null
  /** service description / category */
  service: string | null
  invoiceNumber: string | null
}

export interface GeneratedFilename {
  filename: string
  /** which components fell back to placeholders */
  placeholders: ('date' | 'company' | 'service' | 'invoiceNumber')[]
}

export const MAX_FILENAME_LENGTH = 180

const TRANSLITERATIONS: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss',
  Ä: 'Ae', Ö: 'Oe', Ü: 'Ue',
  á: 'a', à: 'a', â: 'a', ã: 'a', å: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', õ: 'o',
  ú: 'u', ù: 'u', û: 'u',
  ç: 'c', ñ: 'n', ý: 'y',
  Á: 'A', À: 'A', Â: 'A', Ã: 'A', Å: 'A',
  É: 'E', È: 'E', Ê: 'E', Ë: 'E',
  Í: 'I', Ì: 'I', Î: 'I', Ï: 'I',
  Ó: 'O', Ò: 'O', Ô: 'O', Õ: 'O',
  Ú: 'U', Ù: 'U', Û: 'U',
  Ç: 'C', Ñ: 'N', '€': 'EUR', '£': 'GBP', $: 'USD'
}

/** Sanitize one filename component (no path separators, traversal, reserved chars). */
export function sanitizeFilenameComponent(raw: string, maxLength = 60): string {
  let s = ''
  for (const ch of raw) {
    s += TRANSLITERATIONS[ch] ?? ch
  }
  // path separators and reserved filesystem chars → space
  s = s.replace(/[\\/<>:"|?*]/g, ' ')
  // control chars removed outright
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1f\x7f]/g, '')
  // remaining non-ASCII stripped (transliteration table covered the common ones)
  s = s.replace(/[^\x20-\x7e]/g, '')
  // '..' sequences collapse so traversal can never survive
  s = s.replace(/\.{2,}/g, '.')
  // spaces → hyphens, collapse runs of separators
  s = s.trim().replace(/\s+/g, '-')
  s = s.replace(/-{2,}/g, '-').replace(/_{2,}/g, '_')
  s = s.replace(/(?:[-_.]{2,})/g, (run) => run[0] ?? '-')
  // leading/trailing punctuation off
  s = s.replace(/^[-_.,;!]+/, '').replace(/[-_.,;!]+$/, '')
  if (s.length > maxLength) {
    s = s.slice(0, maxLength).replace(/[-_.,;!]+$/, '')
  }
  return s
}

const EXT = '.pdf'

export function generateStoredFilename(fields: FilenameFields): GeneratedFilename {
  const placeholders: GeneratedFilename['placeholders'] = []

  let datePart = 'Unknown-Date'
  if (fields.invoiceDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(fields.invoiceDate)) {
    datePart = fields.invoiceDate.replace(/-/g, '_')
  } else {
    placeholders.push('date')
  }

  let company = fields.company !== null ? sanitizeFilenameComponent(fields.company, 60) : ''
  if (company.length === 0) {
    company = 'Unknown-Company'
    placeholders.push('company')
  }

  let service = fields.service !== null ? sanitizeFilenameComponent(fields.service, 60) : ''
  if (service.length === 0) {
    service = 'Unknown-Service'
    placeholders.push('service')
  }

  let invoiceNo =
    fields.invoiceNumber !== null ? sanitizeFilenameComponent(fields.invoiceNumber, 40) : ''
  if (invoiceNo.length === 0) {
    invoiceNo = 'Unknown-Invoice'
    placeholders.push('invoiceNumber')
  }

  const assemble = (): string => `${datePart}-${company}_${service}-${invoiceNo}${EXT}`

  // Length cap: trim service first, then company (each keeps at least 8 chars).
  let filename = assemble()
  if (filename.length > MAX_FILENAME_LENGTH) {
    const excess = filename.length - MAX_FILENAME_LENGTH
    const serviceCut = Math.min(Math.max(service.length - 8, 0), excess)
    if (serviceCut > 0) {
      service = service.slice(0, service.length - serviceCut).replace(/[-_.]+$/, '')
      filename = assemble()
    }
  }
  if (filename.length > MAX_FILENAME_LENGTH) {
    const excess = filename.length - MAX_FILENAME_LENGTH
    const companyCut = Math.min(Math.max(company.length - 8, 0), excess)
    if (companyCut > 0) {
      company = company.slice(0, company.length - companyCut).replace(/[-_.]+$/, '')
      filename = assemble()
    }
  }
  if (filename.length > MAX_FILENAME_LENGTH) {
    // last resort: hard trim before the extension
    filename = filename.slice(0, MAX_FILENAME_LENGTH - EXT.length) + EXT
  }

  return { filename, placeholders }
}

/** Append -2, -3 … before .pdf on collision. */
export function withCollisionSuffix(filename: string, attempt: number): string {
  if (attempt <= 1) return filename
  const suffix = `-${attempt}`
  const base = filename.toLowerCase().endsWith(EXT)
    ? filename.slice(0, filename.length - EXT.length)
    : filename
  let stem = base
  if (stem.length + suffix.length + EXT.length > MAX_FILENAME_LENGTH) {
    stem = stem.slice(0, MAX_FILENAME_LENGTH - suffix.length - EXT.length)
  }
  return `${stem}${suffix}${EXT}`
}
