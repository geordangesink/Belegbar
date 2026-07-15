/**
 * Deterministic, locale-aware invoice text parsing.
 * Input: extracted plain text (native PDF text layer or OCR output).
 * Output: structured fields with per-field confidence + consistency issues.
 *
 * No Electron/Node imports allowed — pure functions only.
 */
import type {
  DocumentDirection,
  DocumentIssue,
  ExtractedField,
  ExtractedInvoiceData,
  IssueSeverity,
  VatRateLine
} from '../../shared/domain'
import { detectNumberLocale, parseLocalizedAmount, roundMoney, type NumberLocaleHint } from './numbers'
import { findDatesDetailed, parseInvoiceDate, type DateCandidate } from './dates'
import { countryOfVatId, detectCountry, detectCountryInText } from './countries'
import {
  findLineIndex,
  isLabelLike,
  isSectionHeader,
  resolveLabel,
  toLines,
  type ResolvedLabel,
  type TextLine
} from './text-lines'

export interface ParseInvoiceOptions {
  direction: DocumentDirection
  /** the user's own business identity, used to tell issuer from recipient */
  ownName?: string
  ownVatId?: string
  ocrUsed: boolean
  ocrPages: number[]
}

export const PARSER_VERSION = '1.0.0'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function f<T>(value: T | null, confidence: number): ExtractedField<T> {
  return { value, confidence: value === null ? 0 : Math.round(confidence * 100) / 100 }
}

const NONE = { value: null, confidence: 0 }

function makeIssue(code: string, severity: IssueSeverity, field?: string): DocumentIssue {
  return { code, severity, messageKey: `issues.${code}`, ...(field ? { field } : {}) }
}

const SYMBOL_TO_CODE: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP' }
const CODE_RE = /\b(EUR|USDT|USD|GBP|CHF)\b/
const ISO_CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'CHF'])

interface AmountHit {
  value: number
  currency: string | null
}

const DATE_LIKE = /\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}|\d{4}-\d{2}-\d{2}/

/** Find the first plausible monetary amount inside a text fragment. */
function amountInText(s: string, hint: NumberLocaleHint): AmountHit | null {
  const tokenRe = /[-−]?\d[\d.,']*\d|\d/g
  for (let m = tokenRe.exec(s); m; m = tokenRe.exec(s)) {
    const token = m[0]
    if (DATE_LIKE.test(token)) continue
    const after = s.slice(m.index + token.length, m.index + token.length + 6)
    if (/^\s*%/.test(after)) continue
    const before = s.slice(Math.max(0, m.index - 6), m.index)
    const curBefore = /([€$£])\s*$/.exec(before)?.[1] ?? CODE_RE.exec(before)?.[1] ?? null
    const curAfter = /^\s*([€$£])/.exec(after)?.[1] ?? CODE_RE.exec(after)?.[1] ?? null
    const currencyRaw = curBefore ?? curAfter
    const currency = currencyRaw ? (SYMBOL_TO_CODE[currencyRaw] ?? currencyRaw) : null
    const hasDecimals = /[.,]\d{1,2}$/.test(token)
    // precision guard: bare integers (quantities, ids) are not amounts
    if (!hasDecimals && currency === null) continue
    const value = parseLocalizedAmount(token, hint)
    if (value === null) continue
    return { value, currency }
  }
  return null
}

function isAmountish(hint: NumberLocaleHint): (v: string) => boolean {
  return (v) => !/%\s*$/.test(v) && amountInText(v, hint) !== null
}

const isDateValue = (v: string): boolean => parseInvoiceDate(v) !== null

function clamp01(n: number): number {
  return Math.max(0, Math.min(0.98, n))
}

interface LabeledAmount {
  hit: AmountHit
  res: ResolvedLabel
  rank: number
}

function resolveAmountLabels(
  lines: TextLine[],
  specs: RegExp[],
  hint: NumberLocaleHint
): LabeledAmount[] {
  const out: LabeledAmount[] = []
  specs.forEach((re, rank) => {
    const res = resolveLabel(lines, re, { validate: isAmountish(hint) })
    if (res) {
      const hit = amountInText(res.value, hint)
      if (hit) out.push({ hit, res, rank })
    }
  })
  return out
}

const MON =
  'Jan(?:uary|uar)?|Feb(?:ruary|ruar)?|M(?:ar(?:ch)?|är(?:z)?|rz)|Apr(?:il)?|Ma[iy]|Jun[ie]?|Jul[iy]?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|O[ck]t(?:ober)?|Nov(?:ember)?|De[cz](?:ember)?'
const MONTH_NUM: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mär: 3, mrz: 3, apr: 4, may: 5, mai: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12
}
function monthNum(name: string): number | null {
  const key = name.slice(0, 3).toLowerCase()
  return MONTH_NUM[key] ?? MONTH_NUM[key.slice(0, 3)] ?? null
}
function isoOf(y: number, mo: number, d: number): string | null {
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return parseInvoiceDate(iso) !== null ? iso : null
}
function lastDayOfMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

const LEGAL_FORM =
  /\b(GmbH & Co\. KG|GmbH|mbH|AG|KGaA|e\.K\.|UG(?: \(haftungsbeschränkt\))?|OHG|Inc\.?|LLC|L\.L\.C\.|Ltd\.?|Limited|Corp\.?|Corporation|PLC|plc|S\.?[àa] ?r\.?l\.?|SARL|S\.A\.(?:\s+[Dd][Ee]\s+C\.V\.)?|B\.V\.|N\.V\.|S\.p\.A\.)(?=[\s,.)]|$)/

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export function parseInvoiceText(
  text: string,
  options: ParseInvoiceOptions
): ExtractedInvoiceData {
  const lines = toLines(text)
  const localeGuess = detectNumberLocale(text)
  const hint: NumberLocaleHint = localeGuess === 'unknown' ? 'auto' : localeGuess
  const dates = findDatesDetailed(text)
  const issues: DocumentIssue[] = []
  const addIssue = (code: string, severity: IssueSeverity, field?: string): void => {
    if (!issues.some((i) => i.code === code)) issues.push(makeIssue(code, severity, field))
  }

  // ---- signals ------------------------------------------------------------
  const reverseChargeWording =
    /reverse charge|article 196|steuerschuldnerschaft des leistungsempfängers|§\s*13\s?b/i.test(text)
  const vatExemptWording =
    /tax[- ]exempt|steuerfrei|§\s*3\s?a\b|not taxable|nicht steuerbar|leistungsort|place of supply/i.test(text)
  const kleinunternehmerWording = /kleinunternehmer|§\s*19\s+UStG/i.test(text)
  const ossWording =
    /EU OSS VAT|\bOSS\b|one[- ]stop[- ]shop|one[- ]stop\b|umsatzsteuer erklärt durch .{0,60} im lieferland/is.test(text)
  const paidWording =
    /(?<![a-z])(?<!un)paid\b|zahlbetrag|bezahlt|beglichen|per vorkasse/i.test(text)
  const serviceWording =
    /subscription|abonnement|service|dienstleis|development|entwicklung|consulting|beratung|hosting|domain\b|usage|credits?\b|fee\b|plan\b|software|licen[cs]e|lizenz|\bapi\b|cloud|\bads\b|advertising|kampagne|campaign|support|wartung|mail/i.test(text)
  const goodsWording =
    /versandkosten|versand\b|lieferadresse|lieferschein|frachtkosten|shipping|lieferung\b|delivery|warenwert|\bware\b|hardware/i.test(text)
  const isServiceLikely = serviceWording && !goodsWording

  // ---- invoice number -------------------------------------------------------
  const invoiceNoValid = (v: string): boolean =>
    /\d/.test(v) && v.length >= 3 && v.length <= 40 && !v.includes('@') &&
    !/[€$£]/.test(v) && !isDateValue(v) && !/^\+?\d{1,4}[\s-]\d{2,}[\s-]\d{2,}[\s-]?\d*$/.test(v)

  let invoiceNumber: ExtractedField<string> = { ...NONE }
  for (const [re, conf] of [
    [/^Rechnungsnummer\b/i, 0.9],
    [/^Rechnungs[- ]?Nr\.?(?!\S)/i, 0.9],
    [/^Invoice\s*(?:number|no\.?|nr\.?)(?!\S)/i, 0.9],
    [/^Invoice(?!\S)/i, 0.7],
    [/^Receipt number\b/i, 0.6]
  ] as [RegExp, number][]) {
    const res = resolveLabel(lines, re, { validate: invoiceNoValid })
    if (res) {
      invoiceNumber = f(res.value.replace(/^[:#]\s*/, ''), conf)
      break
    }
  }

  // ---- dates ----------------------------------------------------------------
  const resolveDate = (re: RegExp): ResolvedLabel | null =>
    resolveLabel(lines, re, { validate: isDateValue })

  let invoiceDateRes: ResolvedLabel | null = null
  let invoiceDateConf = 0
  for (const [re, conf] of [
    [/^Date paid\b/i, 0.9],
    [/^Invoice date\b/i, 0.9],
    [/^Rechnungsdatum\b/i, 0.9],
    [/^Datum\b/i, 0.85],
    [/^Date\b/i, 0.8]
  ] as [RegExp, number][]) {
    invoiceDateRes = resolveDate(re)
    if (invoiceDateRes) {
      invoiceDateConf = conf
      break
    }
  }

  // fallback: first free-standing date not tied to order/shipping/service labels
  let invoiceDateIso: string | null = invoiceDateRes ? parseInvoiceDate(invoiceDateRes.value) : null
  let invoiceDateCand: DateCandidate | null = null
  if (invoiceDateRes) {
    invoiceDateCand =
      findDatesDetailed(invoiceDateRes.value)[0] ?? null
  } else {
    for (const cand of dates) {
      const before = text.slice(Math.max(0, cand.index - 30), cand.index)
      if (/(?:vom|bis|bestell|auftrag|versand|liefer|due|fällig|paid on|refund)[a-zäöü.]*\s*:?\s*$/i.test(before)) {
        continue
      }
      invoiceDateCand = cand
      invoiceDateIso = cand.iso
      invoiceDateConf = 0.6
      break
    }
  }

  // DD/MM vs MM/DD ambiguity: corroborate via any unambiguous date
  if (invoiceDateCand?.ambiguous && invoiceDateIso !== null) {
    const corroborated = dates.some(
      (c) =>
        !c.ambiguous &&
        c !== invoiceDateCand &&
        (c.iso === invoiceDateIso ||
          (c.raw.includes('/') && Number(c.raw.split('/')[0]) > 12))
    )
    if (!corroborated) {
      invoiceDateConf = Math.min(invoiceDateConf, 0.7)
      addIssue('ambiguous_date_format', 'warning', 'invoiceDate')
    }
  }

  const dueRes =
    resolveDate(/^Fälligkeitsdatum\b/i) ??
    resolveDate(/^Zahlungsfällig\b/i) ??
    resolveDate(/^Zahlbar bis\b/i) ??
    resolveDate(/^Zahlungsziel\b/i) ??
    resolveDate(/^Due date\b/i) ??
    resolveDate(/^Due\b/i)
  const dueDate = dueRes ? f(parseInvoiceDate(dueRes.value), 0.85) : { ...NONE }

  let paymentDateIso: string | null = null
  const paidOn = /(?:paid on|bezahlt am)\s+(.{4,30}?\d{4})/i.exec(text)
  if (paidOn) paymentDateIso = parseInvoiceDate(paidOn[1] ?? '')
  if (paymentDateIso === null) {
    const dp = resolveDate(/^Date paid\b/i)
    if (dp) paymentDateIso = parseInvoiceDate(dp.value)
  }

  // ---- service period -------------------------------------------------------
  let serviceFrom: string | null = null
  let serviceTo: string | null = null
  // 1. German "vom X bis Y" / generic two dates joined by dash/bis
  for (let i = 0; i + 1 < dates.length && serviceFrom === null; i++) {
    const a = dates[i]
    const b = dates[i + 1]
    if (!a || !b) continue
    const between = text.slice(a.index + a.raw.length, b.index)
    if (/^\s*(?:[-–—]|bis(?: zum)?)\s*$/i.test(between) && a.iso <= b.iso) {
      serviceFrom = a.iso
      serviceTo = b.iso
    }
  }
  // 2. "Apr 30–May 30, 2026" / "Dec 19, 2025–Jan 19, 2026"
  if (serviceFrom === null) {
    const re = new RegExp(
      `\\b(${MON})\\.?\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?\\s*[–—-]\\s*(${MON})\\.?\\s+(\\d{1,2}),?\\s*(\\d{4})\\b`
    )
    const m = re.exec(text)
    if (m) {
      const m1 = monthNum(m[1] ?? '')
      const m2 = monthNum(m[4] ?? '')
      const toYear = Number(m[6])
      if (m1 !== null && m2 !== null) {
        const fromYear = m[3] ? Number(m[3]) : m1 > m2 ? toYear - 1 : toYear
        serviceFrom = isoOf(fromYear, m1, Number(m[2]))
        serviceTo = isoOf(toYear, m2, Number(m[5]))
      }
    }
  }
  // 3. "services for January 2026" → whole month
  if (serviceFrom === null) {
    const m = new RegExp(`(?:services?\\s+for|für(?: den Monat)?)\\s+(${MON})\\w*\\s+(\\d{4})`, 'i').exec(text)
    if (m) {
      const mo = monthNum(m[1] ?? '')
      const y = Number(m[2])
      if (mo !== null) {
        serviceFrom = isoOf(y, mo, 1)
        serviceTo = isoOf(y, mo, lastDayOfMonth(y, mo))
      }
    }
  }

  // ---- amounts ---------------------------------------------------------------
  const grossHits = resolveAmountLabels(
    lines,
    [
      /^Amount paid\b/i,
      /^Zahlbetrag\b/i,
      /^Rechnungsbetrag\s*\(brutto\)/i,
      /^Summe\s+Rechnungsbetrag\b/i,
      /^Gesamtbetrag\b/i,
      /^Gesamtpreis\b/i,
      /^Total(?:\s+in\s+[A-Z]{3})?(?!\s*(?:excluding|excl|refunded))\b/i,
      /^Rechnungsbetrag\b/i,
      /^Bruttobetrag\b/i
    ],
    hint
  )
  const netHits = resolveAmountLabels(
    lines,
    [
      /^Total excluding tax\b/i,
      /^Zwischensumme\s*\((?:netto|ohne\s*USt\.?)\)/i,
      /^Nettobetrag\b/i,
      /^(?:Entspricht der )?Summe netto\b/i,
      /^Netto Warenwert\b/i,
      /^Subtotal(?:\s+in\s+[A-Z]{3})?\b/i,
      /^Netto\b(?!\s*[Ww]arenwert)/,
      /^Net amount\b/i
    ],
    hint
  )
  // VAT labels; several patterns also carry the rate in a capture group
  const vatSpecs: { re: RegExp; rateGroup: number | null }[] = [
    { re: /^VAT\b[^(\n]*\((\d{1,2}(?:[.,]\d{1,2})?)\s*%(?:\s+on\s+[^)]*)?\)\s*$/i, rateGroup: 1 },
    { re: /^Umsatzsteuer\s*\((\d{1,2}(?:[.,]\d{1,2})?)\s*%\)/i, rateGroup: 1 },
    { re: /^\+?\s*(\d{1,2})\s*[%&]\s*USt\b.*$/i, rateGroup: 1 },
    { re: /^(?:MwSt|USt)\.?-?[Bb]etrag\b/, rateGroup: null },
    { re: /^Gesamt\s*USt\.?(?!\S)/i, rateGroup: null },
    { re: /^USt\.?\s*$/, rateGroup: null },
    { re: /^MwSt\.?(?:\s+MwSt\.?-?Satz)?\s*$/i, rateGroup: null }
  ]
  let vatHit: LabeledAmount | null = null
  let vatRateFromLabel: number | null = null
  let vatBaseFromLabel: number | null = null
  for (const [rank, spec] of vatSpecs.entries()) {
    const res = resolveLabel(lines, spec.re, { validate: isAmountish(hint) })
    if (!res) continue
    const hit = amountInText(res.value, hint)
    if (!hit) continue
    vatHit = { hit, res, rank }
    if (spec.rateGroup !== null) {
      const m = spec.re.exec(lines[res.labelLine]?.text ?? '')
      const rateRaw = m?.[spec.rateGroup]
      if (rateRaw !== undefined) vatRateFromLabel = Number(rateRaw.replace(',', '.'))
      const baseM = /\(\s*[\d.,]+\s*%\s+on\s+([^)]+)\)/i.exec(lines[res.labelLine]?.text ?? '')
      if (baseM) vatBaseFromLabel = amountInText(baseM[1] ?? '', hint)?.value ?? null
    }
    break
  }

  // multi-rate tables (Amazon/Viking): "19%" line followed by net + vat lines
  const tableRates: VatRateLine[] = []
  for (let i = 0; i + 2 < lines.length; i++) {
    const rateM = /^(\d{1,2}(?:[.,]\d{1,2})?)\s*%$/.exec(lines[i]?.text ?? '')
    if (!rateM) continue
    const a = amountInText(lines[i + 1]?.text ?? '', hint)
    const b = amountInText(lines[i + 2]?.text ?? '', hint)
    if (!a || !b) continue
    const rate = Number((rateM[1] ?? '').replace(',', '.'))
    const expected = roundMoney((a.value * rate) / 100)
    if (Math.abs(expected - b.value) > 0.05) continue
    const row: VatRateLine = {
      rate,
      netAmountOriginal: roundMoney(a.value),
      vatAmountOriginal: roundMoney(b.value),
      grossAmountOriginal: roundMoney(a.value + b.value)
    }
    if (!tableRates.some((r) => r.rate === row.rate && r.netAmountOriginal === row.netAmountOriginal)) {
      tableRates.push(row)
    }
  }

  // single VAT rate detection from wording when not in a label
  let singleRate: number | null = vatRateFromLabel
  if (singleRate === null && tableRates.length === 1) singleRate = tableRates[0]?.rate ?? null
  if (singleRate === null) {
    const rates = new Set<number>()
    const rateRe = /(?:USt\.?|MwSt\.?|Steuersatz|Tax|VAT)[.:%\s]{0,4}(\d{1,2}(?:[.,]\d{1,2})?)\s*%|(\d{1,2}(?:[.,]\d{1,2})?)\s*%/g
    for (let m = rateRe.exec(text); m; m = rateRe.exec(text)) {
      const r = Number((m[1] ?? m[2] ?? '').replace(',', '.'))
      if ([0, 5, 7, 16, 19].includes(r)) rates.add(r)
    }
    if (rates.size === 1) singleRate = [...rates][0] ?? null
  }

  // choose values with conflict detection
  let grossValue: number | null = null
  let grossConf = 0
  let netValue: number | null = null
  let netConf = 0
  let vatValue: number | null = null
  let vatConf = 0

  const best = grossHits[0] ?? null
  let netFromTable = false
  let vatFromTable = false
  if (netHits[0]) {
    netValue = roundMoney(netHits[0].hit.value)
    netConf = 0.9
  } else if (vatBaseFromLabel !== null) {
    netValue = roundMoney(vatBaseFromLabel)
    netConf = 0.85
  } else if (tableRates.length > 0) {
    netValue = roundMoney(tableRates.reduce((s, r) => s + r.netAmountOriginal, 0))
    netConf = 0.8
    netFromTable = true
  }
  if (vatHit) {
    vatValue = roundMoney(vatHit.hit.value)
    vatConf = 0.9
  } else if (tableRates.length > 0) {
    vatValue = roundMoney(tableRates.reduce((s, r) => s + r.vatAmountOriginal, 0))
    vatConf = 0.8
    vatFromTable = true
  }
  let effectiveRates = tableRates

  if (best) {
    const distinct = new Set(grossHits.map((h) => roundMoney(h.hit.value)))
    const bestVal = roundMoney(best.hit.value)
    if (distinct.size <= 1) {
      grossValue = bestVal
      grossConf = 0.9
    } else if (
      netValue !== null &&
      vatValue !== null &&
      Math.abs(netValue + vatValue - bestVal) <= 0.02
    ) {
      grossValue = bestVal
      grossConf = 0.85
    } else {
      const consistent = grossHits.find(
        (h) =>
          netValue !== null &&
          vatValue !== null &&
          Math.abs(netValue + vatValue - roundMoney(h.hit.value)) <= 0.02
      )
      if (consistent) {
        grossValue = roundMoney(consistent.hit.value)
        grossConf = 0.8
      } else {
        addIssue('conflicting_totals', 'critical', 'grossAmount')
      }
    }
  }

  // Multi-invoice PDFs repeat their VAT table once per contained invoice; when
  // the summed rows contradict the labeled gross but a single row matches it,
  // that row is the table of the first invoice.
  if (
    grossValue !== null &&
    (netFromTable || vatFromTable) &&
    netValue !== null &&
    vatValue !== null &&
    Math.abs(netValue + vatValue - grossValue) > 0.02
  ) {
    const g = grossValue
    const row = tableRates.find((r) => Math.abs(r.grossAmountOriginal - g) <= 0.02)
    if (row) {
      netValue = row.netAmountOriginal
      vatValue = row.vatAmountOriginal
      netConf = 0.7
      vatConf = 0.7
      effectiveRates = [row]
    }
  }

  // derivations
  if (vatValue === null && (reverseChargeWording || kleinunternehmerWording) && singleRate === 0) {
    vatValue = 0
    vatConf = 0.9
  }
  if (grossValue !== null && netValue === null && vatValue === null && singleRate !== null) {
    // gross-only receipt: derive net from the printed rate
    netValue = roundMoney(grossValue / (1 + singleRate / 100))
    vatValue = roundMoney(grossValue - netValue)
    netConf = 0.65
    vatConf = 0.65
  }
  if (vatValue === null && (vatExemptWording || reverseChargeWording || kleinunternehmerWording)) {
    vatValue = 0
    vatConf = 0.75
    if (netValue === null && grossValue !== null) {
      netValue = grossValue
      netConf = 0.7
    }
  }
  if (grossValue === null && netValue !== null && vatValue !== null && !issues.some((i) => i.code === 'conflicting_totals')) {
    grossValue = roundMoney(netValue + vatValue)
    grossConf = 0.65
  }
  if (netValue === null && grossValue !== null && vatValue !== null) {
    netValue = roundMoney(grossValue - vatValue)
    netConf = 0.65
  }
  if (vatValue === null && grossValue !== null && netValue !== null && grossValue >= netValue) {
    vatValue = roundMoney(grossValue - netValue)
    vatConf = 0.65
  }

  // cross-checks
  if (grossValue !== null && netValue !== null && vatValue !== null) {
    if (Math.abs(netValue + vatValue - grossValue) <= 0.02) {
      grossConf = clamp01(grossConf + 0.05)
      netConf = clamp01(netConf + 0.05)
      vatConf = clamp01(vatConf + 0.05)
    }
  }
  if (netValue !== null && vatValue !== null && singleRate !== null && singleRate > 0) {
    if (Math.abs(roundMoney((netValue * singleRate) / 100) - vatValue) > 0.02) {
      vatConf = Math.min(vatConf, 0.6)
    }
  }

  const vatRates: VatRateLine[] =
    effectiveRates.length > 0
      ? effectiveRates
      : singleRate !== null && netValue !== null && vatValue !== null
        ? [
            {
              rate: singleRate,
              netAmountOriginal: netValue,
              vatAmountOriginal: vatValue,
              grossAmountOriginal: grossValue ?? roundMoney(netValue + vatValue)
            }
          ]
        : []

  // ---- currency ---------------------------------------------------------------
  let currency: string | null = null
  let currencyConf = 0
  const currencyOfLine = (idx: number): string | null => {
    const t = lines[idx]?.text ?? ''
    const sym = /[€$£]/.exec(t)?.[0]
    const code = CODE_RE.exec(t)?.[1]
    if (code === 'USD' && /\bUSDT\b/.test(t)) return 'USDT'
    return code ?? (sym ? (SYMBOL_TO_CODE[sym] ?? null) : null)
  }
  if (best) {
    currency = best.hit.currency ?? currencyOfLine(best.res.valueLine)
    if (currency) currencyConf = 0.9
  }
  if (!currency) {
    for (const h of [...grossHits, ...netHits]) {
      currency = h.hit.currency ?? currencyOfLine(h.res.valueLine)
      if (currency) {
        currencyConf = 0.85
        break
      }
    }
  }
  if (!currency) {
    const m =
      /(?:amounts displayed in|angabe in|total in)\s*\n?\s*([A-Z]{3,4})\b/i.exec(text)
    if (m && /^(EUR|USD|USDT|GBP|CHF)$/.test(m[1] ?? '')) {
      currency = m[1] ?? null
      currencyConf = 0.85
    }
  }
  if (!currency) {
    const counts = new Map<string, number>()
    const bump = (c: string, n: number): void => {
      counts.set(c, (counts.get(c) ?? 0) + n)
    }
    bump('EUR', (text.match(/€/g) ?? []).length + (text.match(/\bEUR\b/g) ?? []).length)
    bump('USDT', (text.match(/\bUSDT\b/g) ?? []).length * 2)
    bump('USD', (text.match(/\$/g) ?? []).length + (text.match(/\bUSD\b/g) ?? []).length)
    bump('GBP', (text.match(/£/g) ?? []).length + (text.match(/\bGBP\b/g) ?? []).length)
    bump('CHF', (text.match(/\bCHF\b/g) ?? []).length)
    const sorted = [...counts.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    if (sorted[0]) {
      currency = sorted[0][0]
      currencyConf = 0.6
    }
  }

  // ---- parties ------------------------------------------------------------------
  const own = options.ownName?.trim() ?? ''
  const ownTokens = own.toLowerCase().split(/\s+/).filter((t) => t.length > 1)
  const containsOwnName = (s: string): boolean =>
    ownTokens.length > 0 && ownTokens.every((t) => s.toLowerCase().includes(t))

  const billToIdx = findLineIndex(
    lines,
    /^(?:bill\s*to|rechnung an|rechnungsadresse|auftraggeber)\s*:?$/i
  )
  const supplierIdx = findLineIndex(lines, /^(?:supplier|lieferant)\s*:?$/i)

  const partyText = (v: string): boolean =>
    v.length >= 2 && v.length <= 120 && !isAmountish(hint)(v) && !isDateValue(v)

  // free-form block after a "Bill to"-style label
  const blockAfter = (idx: number): string[] => {
    const out: string[] = []
    if (idx < 0) return out
    for (let i = idx + 1; i < lines.length && out.length < 7; i++) {
      const t = lines[i]?.text ?? ''
      if (t.length === 0) {
        if (out.length > 0) break
        continue
      }
      if (t.includes('@') || isLabelLike(t) || isSectionHeader(t)) break
      out.push(t)
    }
    return out
  }

  let recipientName: ExtractedField<string> = { ...NONE }
  let recipientAddress: ExtractedField<string> = { ...NONE }
  let recipientCountry: ExtractedField<string> = { ...NONE }
  let recipientVatId: ExtractedField<string> = { ...NONE }
  let issuerName: ExtractedField<string> = { ...NONE }
  let issuerAddress: ExtractedField<string> = { ...NONE }
  let issuerCountry: ExtractedField<string> = { ...NONE }
  let issuerVatId: ExtractedField<string> = { ...NONE }
  let issuerTaxNumber: ExtractedField<string> = { ...NONE }

  const vatIdRe =
    /\b(DE\s?\d{3}\s?\d{3}\s?\d{3}(?!\d)|DE\d{9}(?!\d)|ATU\d{8}|IE\s?\d{7}[A-Z]{1,2}\b|IE\d[A-Z0-9+*]\d{5}[A-Z]{1,2}\b|LU\s?\d{8}(?!\d)|EU\s?\d{9}(?!\d)|GB\s?\d{9}(?!\d)|NL\s?\d{9}B\d{2}|FR\s?[A-Z0-9]{2}\d{9})/g
  const vatMatches: { id: string; index: number }[] = []
  for (let m = vatIdRe.exec(text); m; m = vatIdRe.exec(text)) {
    const id = (m[1] ?? '').replace(/\s+/g, '')
    if (!vatMatches.some((v) => v.id === id)) vatMatches.push({ id, index: m.index })
  }
  const ownVat = options.ownVatId?.replace(/\s+/g, '') ?? ''
  const kundenVat = vatMatches.find((v) =>
    /kunden/i.test(text.slice(Math.max(0, v.index - 40), v.index))
  )
  const otherVats = vatMatches.filter(
    (v) => v !== kundenVat && (ownVat === '' || v.id !== ownVat)
  )

  if (options.direction === 'expense') {
    // recipient = the user
    const block = blockAfter(billToIdx)
    if (block.length > 0) {
      recipientName = f(block[0] ?? null, 0.9)
      if (block.length > 1) recipientAddress = f(block.slice(1).join(', '), 0.85)
      const c = detectCountry(block.slice(1))
      if (c) recipientCountry = f(c, 0.9)
    } else if (own.length > 0) {
      const idx = findLineIndex(lines, new RegExp(ownTokens.map((t) => `(?=.*${t})`).join(''), 'i'))
      if (idx >= 0) {
        recipientName = f(own, 0.7)
        const addr = blockAfter(idx)
        if (addr.length > 0) {
          recipientAddress = f(addr.join(', '), 0.6)
          const c = detectCountry(addr)
          if (c) recipientCountry = f(c, 0.7)
        }
      }
    }
    if (recipientCountry.value === null && recipientAddress.value !== null) {
      // German 5-digit postal code + city in a German-language document
      if (/\b\d{5}\s+\p{Lu}/u.test(recipientAddress.value) && /Rechnung|USt|MwSt/.test(text)) {
        recipientCountry = f('DE', 0.5)
      }
    }
    if (kundenVat) recipientVatId = f(kundenVat.id, 0.85)
    else if (ownVat !== '' && vatMatches.some((v) => v.id === ownVat)) {
      recipientVatId = f(ownVat, 0.9)
    }

    // issuer = first company-looking line outside the recipient block
    const blockStart = billToIdx
    const blockEnd = billToIdx >= 0 ? billToIdx + 8 : -1
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]?.text ?? ''
      if (t.length === 0 || (i >= blockStart && i <= blockEnd && blockStart >= 0)) continue
      if (containsOwnName(t) || /^bank\b/i.test(t)) continue
      if (!LEGAL_FORM.test(t)) continue
      const parts = t.split(/\s+[•–]\s+|\s+-\s+(?=\d)/)
      const namePart = (parts[0] ?? t).trim().replace(/[,;]+$/, '')
      issuerName = f(namePart, 0.85)
      if (parts.length > 1) {
        issuerAddress = f(parts.slice(1).join(', '), 0.7)
      } else {
        const addr: string[] = []
        for (let j = i + 1; j < lines.length && addr.length < 6; j++) {
          const u = lines[j]?.text ?? ''
          if (u.length === 0) break
          if (u.includes('@') || /(?:^|\s)(?:VAT|USt\.?|Ust-?Id\S*|MwSt\.?|EIN)\b/i.test(u)) break
          if (isLabelLike(u) || isSectionHeader(u) || u === namePart || LEGAL_FORM.test(u)) break
          addr.push(u)
        }
        if (addr.length > 0) issuerAddress = f(addr.join(', '), 0.75)
      }
      break
    }
    if (issuerAddress.value !== null) {
      const c = detectCountryInText(issuerAddress.value)
      if (c) issuerCountry = f(c, 0.85)
    }
    if (otherVats[0]) issuerVatId = f(otherVats[0].id, 0.85)
    if (issuerCountry.value === null && issuerVatId.value !== null) {
      const c = countryOfVatId(issuerVatId.value)
      if (c) issuerCountry = f(c, 0.7)
    }
    const stnr = /Steuernummer\s+(\d{2,3}\/\d{3}\/\d{4,5})/.exec(text)
    if (stnr) issuerTaxNumber = f(stnr[1] ?? null, 0.85)
  } else {
    // income: issuer = the user
    const supplierName = resolveLabel(lines, /^(?:Supplier|Lieferant)(?!\S)/i, {
      validate: partyText,
      from: 0
    })
    issuerName = own.length > 0 ? f(own, 0.95) : supplierName ? f(supplierName.value, 0.85) : { ...NONE }

    const fromSupplier = supplierIdx >= 0 ? supplierIdx : 0
    const addrParts: string[] = []
    const supAddr = resolveLabel(lines, /^(?:Supplier Address|Lieferantenadresse)\b/i, {
      validate: partyText,
      from: fromSupplier,
      multiline: true
    })
    if (supAddr) addrParts.push(supAddr.value)
    const supPlz = resolveLabel(lines, /^(?:Postal Code|Postleitzahl|PLZ)\b/i, {
      validate: (v) => v.length <= 12,
      from: fromSupplier
    })
    const supCity = resolveLabel(lines, /^(?:City|Stadt)\b/i, { validate: partyText, from: fromSupplier })
    if (supPlz || supCity) addrParts.push([supPlz?.value, supCity?.value].filter(Boolean).join(' '))
    const supCountry = resolveLabel(lines, /^(?:Country|Land)\b/i, { validate: partyText, from: fromSupplier })
    if (supCountry) {
      addrParts.push(supCountry.value)
      const c = detectCountryInText(supCountry.value)
      if (c) issuerCountry = f(c, 0.9)
    }
    if (addrParts.length > 0) issuerAddress = f(addrParts.join(', '), 0.85)
    const taxId = resolveLabel(lines, /^(?:Tax ID(?:\s*No\.?)?|St\.?-?Nr\.?|Steuernummer)(?!\S)/i, {
      validate: (v) => /^[\d\s\/.-]{6,20}$/.test(v),
      from: fromSupplier
    })
    if (taxId) issuerTaxNumber = f(taxId.value.trim(), 0.85)
    const ownVatRes = resolveLabel(lines, /^(?:VAT No\.?|VAT no|USt-?IdNr\.?)(?!\S)/i, {
      validate: (v) => /^[A-Z]{2}[A-Z0-9\s]{6,14}$/.test(v.trim()),
      from: fromSupplier
    })
    if (ownVatRes) issuerVatId = f(ownVatRes.value.replace(/\s+/g, ''), 0.85)
    else if (ownVat !== '' && vatMatches.some((v) => v.id === ownVat)) issuerVatId = f(ownVat, 0.9)

    // recipient = the billed party
    const fromBill = billToIdx >= 0 ? billToIdx : 0
    const company = resolveLabel(lines, /^(?:Company|Firma)(?!\S)/i, {
      validate: partyText,
      from: fromBill
    })
    if (company) {
      recipientName = f(company.value, 0.9)
    } else {
      const block = blockAfter(billToIdx)
      if (block[0]) {
        recipientName = f(block[0], 0.8)
        if (block.length > 1) recipientAddress = f(block.slice(1).join(', '), 0.75)
      }
    }
    const rAddrParts: string[] = []
    const rAddr = resolveLabel(lines, /^(?:Address|Adresse)(?!\S)/i, {
      validate: partyText,
      from: fromBill,
      multiline: true
    })
    if (rAddr) rAddrParts.push(rAddr.value)
    const rPlz = resolveLabel(lines, /^(?:Postal Code|Postleitzahl|PLZ)(?!\S)/i, {
      validate: (v) => v.length <= 12,
      from: fromBill
    })
    const rCity = resolveLabel(lines, /^(?:City|Stadt)(?!\S)/i, { validate: partyText, from: fromBill })
    if (rPlz || rCity) rAddrParts.push([rPlz?.value, rCity?.value].filter(Boolean).join(' '))
    const rCountry = resolveLabel(lines, /^(?:Country|Land)(?!\S)/i, { validate: partyText, from: fromBill })
    if (rCountry) {
      rAddrParts.push(rCountry.value)
      const c = detectCountryInText(rCountry.value)
      if (c) recipientCountry = f(c, 0.9)
    }
    if (rAddrParts.length > 0 && recipientAddress.value === null) {
      recipientAddress = f(rAddrParts.join(', '), 0.85)
    }
    if (recipientCountry.value === null && recipientAddress.value !== null) {
      const c = detectCountryInText(recipientAddress.value)
      if (c) recipientCountry = f(c, 0.8)
    }
    const rVat = resolveLabel(lines, /^(?:VAT ID|USt-?IdNr\.?|Ust-?IdNr\.?)(?!\S)/i, {
      validate: (v) => /\d/.test(v) && v.length >= 5 && v.length <= 20 && !/not applicable/i.test(v),
      from: fromBill
    })
    if (rVat) recipientVatId = f(rVat.value.replace(/\s+/g, ''), 0.7)
  }

  const recipientIsBusiness: ExtractedField<boolean> =
    recipientName.value !== null && LEGAL_FORM.test(recipientName.value)
      ? f(true, 0.9)
      : { ...NONE }

  // ---- description -----------------------------------------------------------
  let description: ExtractedField<string> = { ...NONE }
  const descValid = (v: string): boolean => {
    if (v.length < 4 || isAmountish(hint)(v) || isDateValue(v)) return false
    const letters = (v.match(/\p{L}/gu) ?? []).length
    return letters >= 6 || (letters >= 4 && v.includes(' '))
  }
  const services = resolveLabel(lines, /^(?:Services|Dienstleis?t?ungen)(?!\S)/i, {
    validate: descValid
  })
  if (services) {
    description = f(services.value, 0.85)
  } else {
    const header = resolveLabel(
      lines,
      /^(?:Description|Beschreibung|Artikelbezeichnung|Produktbeschreibung)$/i,
      { validate: descValid }
    )
    if (header) description = f(header.value, 0.75)
  }
  if (description.value === null) {
    // German list item: "1  STRATO Mail-Archivierung 5 GB:  EUR 7,50"
    for (const line of lines) {
      const m = /^\d{1,3}\s{2,}(\S.*?):?\s+EUR\s+[\d.,]+$/.exec(line.text)
      if (m && descValid(m[1] ?? '')) {
        description = f((m[1] ?? '').replace(/:$/, ''), 0.6)
        break
      }
      const n = /^\d{6,8}\s+(\p{L}.{5,})$/u.exec(line.text)
      if (n && descValid(n[1] ?? '')) {
        description = f(n[1] ?? null, 0.5)
        break
      }
    }
  }
  if (description.value === null) {
    // ALL-CAPS product line (Apple style)
    for (const line of lines) {
      const t = line.text
      if (!/^[A-Z][A-Z0-9 ().,\/+-]{5,60}$/.test(t)) continue
      if (!t.includes(' ')) continue
      if ((t.match(/[A-Z]/g) ?? []).length < 8) continue
      if (containsOwnName(t) || isSectionHeader(t) || isLabelLike(t)) continue
      if (/RECHNUNG|INVOICE|GERMANY|IBAN|WEEE|COPY|GMBH/.test(t)) continue
      description = f(t, 0.5)
      break
    }
  }
  if (description.value === null) {
    // item line followed by its own amount (Clerk style) — pick the largest
    let bestPair: { text: string; amt: number } | null = null
    for (let i = 0; i + 1 < lines.length; i++) {
      const t = lines[i]?.text ?? ''
      const next = lines[i + 1]?.text ?? ''
      if (!descValid(t) || isLabelLike(t) || isSectionHeader(t)) continue
      if (t.includes('@') || DATE_LIKE.test(t) || containsOwnName(t)) continue
      const hit = /^[€$£]?\s*[\d.,]+$/.test(next) ? amountInText(next, hint) : null
      if (!hit || hit.value <= 0) continue
      if (!bestPair || hit.value > bestPair.amt) bestPair = { text: t, amt: hit.value }
    }
    if (bestPair) description = f(bestPair.text, 0.5)
  }
  if (description.value !== null && description.value.length > 100) {
    const cut = description.value.slice(0, 100)
    description = f(cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : 100), description.confidence)
  }

  // ---- issues ------------------------------------------------------------------
  const refundDetected = /refunded on|total refunded|refund issued|erstattet am|gutschrift(?!s)/i.test(text)
  if (refundDetected) addIssue('refund_detected', 'warning')
  const hasInvoiceWording = /invoice|receipt|rechnung|quittung|beleg\b/i.test(text)
  const orderWording = /thank you for your (?:purchase|order)|order summary|order confirmation|bestellbestätigung/i.test(text)
  if (!hasInvoiceWording || (orderWording && invoiceNumber.value === null)) {
    addIssue('possibly_not_invoice', 'warning')
  }

  if (invoiceDateIso === null) addIssue('missing_invoice_date', 'critical', 'invoiceDate')
  if (grossValue === null && netValue === null) addIssue('missing_amount', 'critical', 'grossAmount')
  if (currency === null) addIssue('unknown_currency', 'critical', 'currency')
  else if (!ISO_CURRENCIES.has(currency)) addIssue('non_iso_currency', 'warning', 'currency')
  if (invoiceNumber.value === null) addIssue('missing_invoice_number', 'warning', 'invoiceNumber')
  if (description.value === null) addIssue('missing_description', 'warning', 'description')
  if (options.direction === 'income') {
    if (recipientCountry.value === null) {
      addIssue('unclear_recipient_country', 'warning', 'recipientCountryCode')
    } else if (recipientCountry.value !== 'DE' && recipientIsBusiness.value === null) {
      addIssue('unclear_business_status', 'warning', 'recipientIsBusiness')
    }
  }
  if (options.ocrUsed) addIssue('ocr_used', 'info')

  return {
    invoiceNumber,
    invoiceDate: f(invoiceDateIso, invoiceDateConf),
    serviceDateFrom: f(serviceFrom, serviceFrom ? 0.8 : 0),
    serviceDateTo: f(serviceTo, serviceTo ? 0.8 : 0),
    dueDate,
    paymentDate: f(paymentDateIso, paymentDateIso ? 0.85 : 0),
    issuerName,
    issuerAddress,
    issuerCountryCode: issuerCountry,
    issuerTaxNumber,
    issuerVatId,
    recipientName,
    recipientAddress,
    recipientCountryCode: recipientCountry,
    recipientVatId,
    recipientIsBusiness,
    description,
    currency: f(currency, currencyConf),
    netAmount: f(netValue, netConf),
    vatAmount: f(vatValue, vatConf),
    grossAmount: f(grossValue, grossConf),
    vatRates,
    signals: {
      reverseChargeWording,
      vatExemptWording,
      kleinunternehmerWording,
      ossWording,
      paidWording,
      isServiceLikely
    },
    extractedText: text,
    ocrUsed: options.ocrUsed,
    ocrPages: options.ocrPages,
    issues
  }
}
