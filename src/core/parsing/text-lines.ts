/**
 * Line-based label/value resolution for invoice text.
 *
 * Invoice PDFs collapse to text in three shapes:
 *  1. "Label: value" on one line
 *  2. "Label" followed by its value on the next line(s)
 *  3. stacked columns: N label lines followed by N value lines in the same
 *     order (Viking), or N value lines followed by N label lines (Google).
 * The resolver handles all three; stacked runs are aligned positionally.
 */

/** Full-line patterns that identify a line as a (pure) label of some field. */
const LABEL_LIKE: RegExp[] = [
  /^(?:kunden|rechnungs|auftrags|bestell|liefer|referenz)[- ]?(?:nr|nummer)\.?:?$/i,
  /^rechnungsnummer:?$/i,
  /^\/?(?:rechnungs|auftrags|bestell|liefer|versand)datum\s*:?$/i,
  /^fälligkeitsdatum:?$/i,
  /^zahlungsfällig:?$/i,
  /^invoice(?:\s+(?:number|no\.?|nr\.?|date))?\s*:?$/i,
  /^receipt number:?$/i,
  /^(?:date paid|due date|issue date|billing id|account id)\s*:?$/i,
  /^(?:date|datum)\s*:?$/i,
  /^(?:payment method|payment history)\s*:?$/i,
  /^amount paid:?$/i,
  /^(?:description|beschreibung|artikelbezeichnung|produktbeschreibung)\s*:?$/i,
  /^(?:qty|quantity|menge|anzahl|units?)\s*:?$/i,
  /^(?:unit price|stückpreis|einzel-?|preis je einheit.*)\s*:?$/i,
  /^(?:tax|amount|betrag|summe)\s*(?:\(.*\))?\s*:?$/i,
  /^amount\s*\(.*\)$/i,
  /^subtotal(?:\s+in\s+[A-Z]{3})?\s*:?$/i,
  /^total(?:\s+in\s+[A-Z]{3})?\s*:?$/i,
  /^total excluding tax:?$/i,
  /^vat(?:\s*[-–—].*)?\s*(?:\(.*\))?\s*:?$/i,
  /^(?:company|firma)\s*:?$/i,
  /^(?:tax id(?:\s*no\.?)?|vat id|vat no\.?|st\.?-?nr\.?|steuernummer)\s*:?$/i,
  /^ust\.?-?\s?id-?\s?nr\.?\s*#?\s*(?:des kunden)?\s*:?$/i,
  /^ust\.?-?nr\.?\s*:?$/i,
  /^(?:address|adresse|supplier address|lieferantenadresse|anschrift)\s*:?$/i,
  /^(?:postal code|postleitzahl|plz|city|stadt|country|land)\s*:?$/i,
  /^(?:supplier|lieferant)\s*:?$/i,
  /^(?:e-?mail(?:[- ]?(?:address|adresse))?|email address)\s*:?$/i,
  /^(?:services|dienstleis?t?ungen)\s*:?$/i,
  /^(?:zahlbetrag|gesamtpreis|gesamtbetrag|nettobetrag|bruttobetrag)\s*:?$/i,
  /^gesamt\s*ust\.?:?$/i,
  /^ust\.?\s*gesamt:?$/i,
  /^(?:ust|mwst)\.?[- ]?(?:betrag|%|satz)?\.?\s*:?$/i,
  /^mwst\.?[\s.]*(?:mwst\.?)?[- ]?satz$/i,
  /^netto(?:\s*warenwert)?\s*:?$/i,
  /^brutto:?$/i,
  /^rechnungsbetrag(?:\s*\(brutto\))?\s*:?$/i,
  /^split-\/?ust\.?\s*%?:?$/i,
  /^zwischensumme.*$/i,
  /^\((?:ohne|inkl\.?|exkl\.?)\s*(?:ust|mwst)\.?\)$/i,
  /^steuersatz\s*:?$/i,
  /^%$/,
  /^(?:zahlungskonditionen|kostenstelle|lieferschein|bestellnotizen|incoterms|kontaktperson|bestellnummer)\s*:?$/i,
  /^(?:artikel-?(?:nummer)?|materialnummer|nr\.|me|rabatt|gesamt-?|preis)\s*:?$/i,
  /^\((?:exkl|inkl)\.\s*mwst\.\)$/i,
  /^(?:umsatzsteuer erklärt durch|verkauft von)\s*:?$/i,
  /^(?:beneficiary|empfänger|bank name|bank adresse|bank address|iban|bic|swift.*)\s*:?$/i
]

const SECTION_HEADER =
  /^(?:details|rechnungsdetails|bestellinformationen|payment history|zahlungsinformationen|summary for .*|angabe in [A-Z]{3,5}|amounts displayed in.*|page \d+ of \d+|seite\s*:?\s*\d+(?:\s+von\s+\d+)?|=== page break ===|invoice|rechnung|receipt|quittung|bill\s*to:?|rechnung an|rechnungsadresse|lieferadresse:?|auftraggeber|versand an.*)$/i

/** Lines that are pure visual noise (dot leaders, rules). */
const NOISE = /^[.·•=_\-\s]{3,}$/

export interface TextLine {
  /** trimmed text ('' for blank/noise lines) */
  text: string
  /** offset of the raw line start in the original text */
  offset: number
}

export function toLines(text: string): TextLine[] {
  const out: TextLine[] = []
  let offset = 0
  for (const raw of text.split('\n')) {
    let t = raw.trim()
    if (NOISE.test(t)) t = ''
    out.push({ text: t, offset })
    offset += raw.length + 1
  }
  return out
}

export function isLabelLike(line: string): boolean {
  if (line.length === 0 || line.length > 60) return false
  return LABEL_LIKE.some((re) => re.test(line))
}

export function isSectionHeader(line: string): boolean {
  return SECTION_HEADER.test(line)
}

export interface ResolvedLabel {
  /** the extracted raw value text */
  value: string
  /** line index the value came from */
  valueLine: number
  /** line index the label was found on */
  labelLine: number
  /** value came from the same line as the label */
  sameLine: boolean
}

export interface ResolveOptions {
  /** accept a candidate value line */
  validate: (value: string) => boolean
  /** search only within [from, to) line indices */
  from?: number
  to?: number
  /** allow multi-line value continuation (addresses) */
  multiline?: boolean
}

function labelRunBounds(lines: TextLine[], idx: number): { start: number; end: number } {
  let start = idx
  while (start > 0 && isLabelLike(lines[start - 1]?.text ?? '')) start--
  let end = idx
  while (end + 1 < lines.length && isLabelLike(lines[end + 1]?.text ?? '')) end++
  return { start, end }
}

/** Collect up to n candidate value lines after `after`, skipping blanks/headers. */
function collectForward(lines: TextLine[], after: number, n: number): { text: string; idx: number }[] {
  const out: { text: string; idx: number }[] = []
  for (let i = after + 1; i < lines.length && out.length < n; i++) {
    const t = lines[i]?.text ?? ''
    if (t.length === 0 || isSectionHeader(t)) continue
    if (isLabelLike(t)) break
    out.push({ text: t, idx: i })
  }
  return out
}

/** Collect up to n candidate value lines before `before`, in document order. */
function collectBackward(lines: TextLine[], before: number, n: number): { text: string; idx: number }[] {
  const out: { text: string; idx: number }[] = []
  for (let i = before - 1; i >= 0 && out.length < n; i--) {
    const t = lines[i]?.text ?? ''
    if (t.length === 0 || isSectionHeader(t)) continue
    if (isLabelLike(t)) break
    out.push({ text: t, idx: i })
  }
  return out.reverse()
}

/**
 * Resolve the value belonging to a label. `labelRe` should be anchored at the
 * line start; any same-line remainder is used first, then stacked alignment.
 */
export function resolveLabel(
  lines: TextLine[],
  labelRe: RegExp,
  opts: ResolveOptions
): ResolvedLabel | null {
  const from = opts.from ?? 0
  const to = opts.to ?? lines.length
  for (let i = from; i < to; i++) {
    const text = lines[i]?.text ?? ''
    if (text.length === 0) continue
    const m = labelRe.exec(text)
    if (!m || m.index !== 0) continue

    // 1. value on the same line after the label
    const remainder = text.slice(m[0].length).replace(/^[\s:.#]+/, '').trim()
    if (remainder.length > 0 && opts.validate(remainder)) {
      return { value: remainder, valueLine: i, labelLine: i, sameLine: true }
    }
    if (remainder.length > 0) continue

    // 2. stacked run alignment (forward: labels then values)
    const { start, end } = labelRunBounds(lines, i)
    const p = i - start
    const runLen = end - start + 1
    const forward = collectForward(lines, end, runLen)
    const fwd = forward[p]
    if (fwd && opts.validate(fwd.text)) {
      let value = fwd.text
      if (opts.multiline && runLen === 1) {
        // continuation lines until the next label (addresses wrap)
        let j = fwd.idx + 1
        while (j < lines.length) {
          const t = lines[j]?.text ?? ''
          if (t.length === 0 || isLabelLike(t) || isSectionHeader(t)) break
          value += `, ${t}`
          j++
          if (j - fwd.idx > 4) break
        }
      }
      return { value, valueLine: fwd.idx, labelLine: i, sameLine: false }
    }

    // 3. reversed stack (values then labels) — only meaningful for real
    // multi-label runs; a single label with a value above it is coincidence
    const backward = runLen >= 2 ? collectBackward(lines, start, runLen) : []
    if (backward.length === runLen && runLen >= 2) {
      const back = backward[p]
      if (back && opts.validate(back.text)) {
        return { value: back.text, valueLine: back.idx, labelLine: i, sameLine: false }
      }
    }

    // 4. single-label fallback: first valid candidate in the forward window
    if (runLen === 1) {
      for (const cand of forward) {
        if (opts.validate(cand.text)) {
          return { value: cand.text, valueLine: cand.idx, labelLine: i, sameLine: false }
        }
      }
    }
  }
  return null
}

/** Find the line index of the first line matching `re`, or -1. */
export function findLineIndex(lines: TextLine[], re: RegExp, from = 0): number {
  for (let i = from; i < lines.length; i++) {
    if (re.test(lines[i]?.text ?? '')) return i
  }
  return -1
}
