import { validateSoliRules, type SoliRules } from './soli-rules'

export interface ParsedSolzgText {
  rules: SoliRules
  firstApplicableYear: number
}

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u00ad\u200b]/g, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueMatch(text: string, pattern: RegExp): string | null {
  const matches = [...text.matchAll(pattern)]
  return matches.length === 1 ? (matches[0]?.[1] ?? null) : null
}

function parseEuroInteger(value: string): number | null {
  if (!/^\d[\d .]*$/.test(value)) return null
  const compact = value.replace(/[ .]/g, '')
  if (!/^\d+$/.test(compact)) return null
  const parsed = Number.parseInt(compact, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePercent(value: string): number | null {
  if (!/^\d{1,2}(?:[,.]\d{1,4})?$/.test(value)) return null
  const [whole, fraction = ''] = value.replace(',', '.').split('.')
  const numerator = Number.parseInt(`${whole}${fraction}`, 10)
  const denominator = 100 * 10 ** fraction.length
  const rate = numerator / denominator
  return Number.isFinite(rate) ? rate : null
}

function parseFirstApplicableYear(text: string): number | null {
  const matches = [
    ...text.matchAll(
      /§\s*3\s+Absatz\s+3\b.{0,300}?erstmals\s+im\s+Veranlagungszeitraum\s+((?:19|20)\d{2})\s+anzuwenden/gi
    )
  ]
  const years = matches
    .map((match) => Number.parseInt(match[1] ?? '', 10))
    .filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100)
  return years.length > 0 ? Math.max(...years) : null
}

export function parseSolzgText(
  section3Text: string,
  section4Text: string,
  section6Text: string
): ParsedSolzgText | null {
  const section3 = normalize(section3Text)
  const section4 = normalize(section4Text)
  const section6 = normalize(section6Text)

  if (!/§\s*3\b/.test(section3) || !/§\s*4\b/.test(section4)) return null

  const jointRaw = uniqueMatch(
    section3,
    /in\s+den\s+Fällen\s+des\s+§\s*32a\s+Absatz\s+5\s+und\s+6\s+des\s+Einkommensteuergesetzes\s+(\d[\d .]*?)\s+Euro/gi
  )
  const singleRaw = uniqueMatch(
    section3,
    /in\s+anderen\s+Fällen\s+(\d[\d .]*?)\s+Euro/gi
  )
  const rateRaw = uniqueMatch(
    section4,
    /Solidaritätszuschlag\s+beträgt\s+(\d{1,2}(?:[,.]\d{1,4})?)\s+Prozent\s+der\s+Bemessungsgrundlage/gi
  )
  const mitigationRaw = uniqueMatch(
    section4,
    /nicht\s+mehr\s+als\s+(\d{1,2}(?:[,.]\d{1,4})?)\s+Prozent\s+des\s+Unterschiedsbetrag(?:es|s)/gi
  )
  if (!jointRaw || !singleRaw || !rateRaw || !mitigationRaw) return null
  if (!/Bruchteile\s+eines\s+Cents\s+bleiben\s+außer\s+Ansatz/i.test(section4)) {
    return null
  }

  const thresholdJoint = parseEuroInteger(jointRaw)
  const thresholdSingle = parseEuroInteger(singleRaw)
  const rate = parsePercent(rateRaw)
  const mitigationRate = parsePercent(mitigationRaw)
  const firstApplicableYear = parseFirstApplicableYear(section6)
  if (
    thresholdJoint === null ||
    thresholdSingle === null ||
    rate === null ||
    mitigationRate === null ||
    firstApplicableYear === null
  ) {
    return null
  }

  const rules: SoliRules = {
    thresholdSingle,
    thresholdJoint,
    rate,
    mitigationRate,
    centRounding: 'down'
  }
  return validateSoliRules(rules).length === 0
    ? { rules, firstApplicableYear }
    : null
}
