/**
 * Deterministic, versioned VAT classification engine (spec §12).
 * All VAT decision rules live here — never in UI or extraction code.
 */
import type {
  DocumentDirection,
  VatClassificationResult,
  VatConfidence,
  VatRateLine,
  VatTreatmentCode
} from '../../shared/domain'
import { roundMoney } from '../currency/convert'

export const VAT_ENGINE_VERSION = '2026.2'

export interface VatClassificationInput {
  direction: DocumentDirection
  taxYear: number | null

  issuerCountryCode: string | null
  issuerVatId: string | null
  recipientCountryCode: string | null
  recipientVatId: string | null
  recipientIsBusiness: boolean | null
  recipientName: string | null

  vatRates: VatRateLine[]
  netAmount: number | null
  vatAmount: number | null
  grossAmount: number | null
  currency: string | null

  /** wording signals from extraction */
  reverseChargeWording: boolean
  vatExemptWording: boolean
  kleinunternehmerWording: boolean
  ossWording: boolean
  isServiceLikely: boolean
  descriptionText: string | null

  /** user's own VAT situation */
  userVatMethod: 'ist' | 'soll' | 'kleinunternehmer' | 'unsure'
}

// ---------------------------------------------------------------------------
// Country + evidence helpers
// ---------------------------------------------------------------------------

/** The 27 EU member states (state 2025). */
const EU_COUNTRY_CODES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE'
])

export function isEuCountry(countryCode: string): boolean {
  let code = countryCode.trim().toUpperCase()
  if (code === 'EL') code = 'GR' // VAT-id prefix used by Greece
  return EU_COUNTRY_CODES.has(code)
}

function normalizeCountry(code: string | null): string | null {
  const normalized = code?.trim().toUpperCase() ?? ''
  return normalized.length === 2 ? normalized : null
}

function vatIdPrefix(vatId: string | null): string | null {
  const normalized = vatId?.trim().toUpperCase().replace(/\s+/g, '') ?? ''
  return /^[A-Z]{2}/.test(normalized) ? normalized.slice(0, 2) : null
}

/** Regular EU country VAT-id prefix — the OSS 'EU…' prefix does not count. */
function isEuCountryVatPrefix(prefix: string | null): boolean {
  if (prefix === null || prefix === 'EU') return false
  return isEuCountry(prefix)
}

function hasLegalForm(name: string | null): boolean {
  if (!name) return false
  // trailing (?![a-z]) instead of \b: dotted forms like "S.A." end in a
  // non-word char, where \b would never match before a following space
  if (
    /\b(gmbh|aktiengesellschaft|unternehmergesellschaft|incorporated|inc|llc|llp|ltd|limited|corporation|corp|plc|sarl|sas|srl|sro|aps|kft|oyj|gbr|kgaa|s\.a\.|s\.r\.l\.|s\.r\.o\.|b\.v\.|n\.v\.|sp\. z o\.o\.|d\.o\.o\.|e\.k\.)(?![a-z])/i.test(
      name
    )
  ) {
    return true
  }
  // short all-caps forms are only trusted case-sensitively to avoid words
  return /(^|\s)(AG|KG|SE|AB|AS|A\/S|BV|NV|SA|UG|OY|OÜ)(\s|$|,)/.test(name)
}

function hasBusinessEvidence(input: VatClassificationInput): boolean {
  return (
    input.recipientIsBusiness === true ||
    (input.recipientVatId?.trim().length ?? 0) > 0 ||
    hasLegalForm(input.recipientName)
  )
}

/** Third-country special place-of-supply suspicions (spec §12 cascade). */
const SPECIAL_RULE_KEYWORDS: ReadonlyArray<{ pattern: RegExp; topic: string }> = [
  {
    pattern: /grundst(ü|ue?)ck|immobil|real estate/i,
    topic: 'services connected to real estate are taxed where the property is located (§ 3a Abs. 3 Nr. 1 UStG)'
  },
  {
    pattern: /veranstalt|\bevent\b|konferenz|conference|seminar|messe|trade fair|eintritt|admission/i,
    topic: 'event and admission services are taxed where the event takes place (§ 3a Abs. 3 UStG)'
  },
  {
    pattern: /bef(ö|oe?)rder|\btransport\b|freight|passenger/i,
    topic: 'transport services follow their own place-of-supply rules (§ 3b UStG)'
  },
  {
    pattern: /restaurant|catering|verpflegung|bewirtung|hospitality/i,
    topic: 'restaurant and catering services are taxed where they are performed (§ 3a Abs. 3 Nr. 3 UStG)'
  },
  {
    pattern: /streaming|download|e-?book|digital content|elektronisch erbrachte/i,
    topic: 'digital services to consumers are taxed at the consumer location (§ 3a Abs. 5 UStG)'
  }
]

function matchSpecialRules(text: string | null): string[] {
  if (!text) return []
  return SPECIAL_RULE_KEYWORDS.filter((k) => k.pattern.test(text)).map(
    (k) => k.topic
  )
}

// ---------------------------------------------------------------------------
// German rate detection
// ---------------------------------------------------------------------------

interface RateDetection {
  /** dominant German rate when one is recognizable */
  rate: 19 | 7 | null
  /** any VAT amount > 0 shown on the document */
  vatCharged: boolean
  /** the shown VAT amount matches rate × net within tolerance */
  plausible: boolean
  /** more than one German rate on the document */
  mixed: boolean
  /** a positive VAT rate other than the German 19 %/7 % is shown */
  foreignRate: boolean
  /** sum of the German-rate VAT lines, when lines exist */
  lineVatSum: number | null
}

function lineIsConsistent(line: VatRateLine): boolean {
  const expected = (line.netAmountOriginal * line.rate) / 100
  const tolerance = Math.max(0.02, line.netAmountOriginal * 0.01)
  return Math.abs(line.vatAmountOriginal - expected) <= tolerance
}

function detectGermanRate(input: VatClassificationInput): RateDetection {
  const positiveLines = input.vatRates.filter(
    (l) => l.rate > 0 && l.vatAmountOriginal > 0
  )
  const germanLines = positiveLines.filter((l) => l.rate === 19 || l.rate === 7)
  const vatCharged =
    positiveLines.length > 0 || (input.vatAmount !== null && input.vatAmount > 0)

  let rate: 19 | 7 | null = null
  let mixed = false
  let plausible = false
  let foreignRate = positiveLines.some((l) => l.rate !== 19 && l.rate !== 7)
  let lineVatSum: number | null = null

  if (germanLines.length > 0) {
    lineVatSum = roundMoney(
      germanLines.reduce((sum, l) => sum + l.vatAmountOriginal, 0)
    )
    const netByRate = new Map<number, number>()
    for (const line of germanLines) {
      netByRate.set(
        line.rate,
        (netByRate.get(line.rate) ?? 0) + line.netAmountOriginal
      )
    }
    mixed = netByRate.size > 1
    let dominant: 19 | 7 = 19
    let dominantNet = -1
    for (const [lineRate, net] of netByRate) {
      if (net > dominantNet) {
        dominant = lineRate as 19 | 7
        dominantNet = net
      }
    }
    rate = dominant
    plausible = !mixed && germanLines.every(lineIsConsistent)
  } else if (
    input.netAmount !== null &&
    input.netAmount > 0 &&
    input.vatAmount !== null &&
    input.vatAmount > 0
  ) {
    const ratio = input.vatAmount / input.netAmount
    if (Math.abs(ratio - 0.19) <= 0.005) {
      rate = 19
      plausible = true
    } else if (Math.abs(ratio - 0.07) <= 0.005) {
      rate = 7
      plausible = true
    } else {
      foreignRate = true
    }
  }

  return { rate, vatCharged, plausible, mixed, foreignRate, lineVatSum }
}

function germanVatAmountOf(
  input: VatClassificationInput,
  detection: RateDetection
): number | null {
  if (input.vatAmount !== null) return roundMoney(input.vatAmount)
  if (detection.lineVatSum !== null) return detection.lineVatSum
  if (input.netAmount !== null && detection.rate !== null) {
    return roundMoney((input.netAmount * detection.rate) / 100)
  }
  return null
}

// ---------------------------------------------------------------------------
// Treatment catalog
// ---------------------------------------------------------------------------

interface TreatmentMeta {
  labelDe: string
  labelEn: string
  legalBasis: string | null
  germanVatRate: number | null
}

const CATALOG: Record<VatTreatmentCode, TreatmentMeta> = {
  DE_DOMESTIC_19: {
    labelDe: 'Umsatzsteuerpflichtig 19 % (Inland)',
    labelEn: 'Taxable at 19 % (domestic)',
    legalBasis: '§ 12 Abs. 1 UStG',
    germanVatRate: 19
  },
  DE_DOMESTIC_7: {
    labelDe: 'Umsatzsteuerpflichtig 7 % (Inland, ermäßigter Satz)',
    labelEn: 'Taxable at 7 % (domestic, reduced rate)',
    legalBasis: '§ 12 Abs. 2 UStG',
    germanVatRate: 7
  },
  DE_DOMESTIC_0_EXEMPT: {
    labelDe: 'Steuerfreier Umsatz (Inland)',
    labelEn: 'Tax-exempt supply (domestic)',
    legalBasis: '§ 4 UStG',
    germanVatRate: 0
  },
  DE_EXPENSE_INPUT_VAT: {
    labelDe: 'Vorsteuerabzug aus Eingangsrechnung',
    labelEn: 'Input VAT deductible (domestic expense)',
    legalBasis: '§ 15 Abs. 1 UStG',
    germanVatRate: null
  },
  DE_EXPENSE_NO_INPUT_VAT: {
    labelDe: 'Ausgabe ohne Vorsteuerabzug',
    labelEn: 'Expense without input-VAT deduction',
    legalBasis: null,
    germanVatRate: null
  },
  EU_B2B_REVERSE_CHARGE_REVENUE: {
    labelDe: 'EU-B2B-Leistung – Steuerschuldnerschaft des Leistungsempfängers',
    labelEn: 'EU B2B service – reverse charge, recipient owes VAT',
    legalBasis: '§ 3a Abs. 2 UStG; Art. 196 MwStSystRL',
    germanVatRate: null
  },
  THIRD_COUNTRY_B2B_SERVICE: {
    labelDe: 'Nicht im Inland steuerbar – Leistungsort im Drittland',
    labelEn: 'Not taxable in Germany – place of supply in a third country',
    legalBasis: '§ 3a Abs. 2 UStG',
    germanVatRate: null
  },
  EXPENSE_REVERSE_CHARGE_13B: {
    labelDe: 'Reverse Charge als Leistungsempfänger (§ 13b UStG)',
    labelEn: 'Reverse charge as service recipient (§ 13b UStG)',
    legalBasis: '§ 13b UStG',
    germanVatRate: 19
  },
  KLEINUNTERNEHMER: {
    labelDe: 'Kleinunternehmer – keine Umsatzsteuer (§ 19 UStG)',
    labelEn: 'Small-business scheme – no VAT charged (§ 19 UStG)',
    legalBasis: '§ 19 Abs. 1 UStG',
    germanVatRate: null
  },
  UNKNOWN_REVIEW: {
    labelDe: 'Unklar – manuelle Prüfung erforderlich',
    labelEn: 'Unclear – manual review required',
    legalBasis: null,
    germanVatRate: null
  }
}

const TREATMENT_ORDER: VatTreatmentCode[] = [
  'DE_DOMESTIC_19',
  'DE_DOMESTIC_7',
  'DE_DOMESTIC_0_EXEMPT',
  'DE_EXPENSE_INPUT_VAT',
  'DE_EXPENSE_NO_INPUT_VAT',
  'EU_B2B_REVERSE_CHARGE_REVENUE',
  'THIRD_COUNTRY_B2B_SERVICE',
  'EXPENSE_REVERSE_CHARGE_13B',
  'KLEINUNTERNEHMER',
  'UNKNOWN_REVIEW'
]

const INCOME_TREATMENTS: ReadonlySet<VatTreatmentCode> = new Set([
  'DE_DOMESTIC_19',
  'DE_DOMESTIC_7',
  'DE_DOMESTIC_0_EXEMPT',
  'EU_B2B_REVERSE_CHARGE_REVENUE',
  'THIRD_COUNTRY_B2B_SERVICE',
  'KLEINUNTERNEHMER'
])

const EXPENSE_TREATMENTS: ReadonlySet<VatTreatmentCode> = new Set([
  'DE_EXPENSE_INPUT_VAT',
  'DE_EXPENSE_NO_INPUT_VAT',
  'EXPENSE_REVERSE_CHARGE_13B'
])

export function isVatTreatmentApplicable(
  direction: DocumentDirection,
  code: VatTreatmentCode
): boolean {
  return (direction === 'income' ? INCOME_TREATMENTS : EXPENSE_TREATMENTS).has(code)
}

interface ResultOverrides {
  confidence: VatConfidence
  reasons: string[]
  unresolvedQuestions?: string[]
  requiresUserConfirmation?: boolean
  germanVatRate?: number | null
  germanVatAmount?: number | null
  legalBasis?: string | null
}

function result(
  code: VatTreatmentCode,
  overrides: ResultOverrides
): VatClassificationResult {
  const meta = CATALOG[code]
  return {
    code,
    labelDe: meta.labelDe,
    labelEn: meta.labelEn,
    germanVatRate:
      overrides.germanVatRate !== undefined
        ? overrides.germanVatRate
        : meta.germanVatRate,
    germanVatAmount:
      overrides.germanVatAmount !== undefined ? overrides.germanVatAmount : null,
    legalBasis:
      overrides.legalBasis !== undefined ? overrides.legalBasis : meta.legalBasis,
    confidence: overrides.confidence,
    reasons: overrides.reasons,
    unresolvedQuestions: overrides.unresolvedQuestions ?? [],
    requiresUserConfirmation: overrides.requiresUserConfirmation ?? false
  }
}

/** All codes with bilingual labels + legal basis, for the treatment picker. */
export function listVatTreatments(): VatClassificationResult[] {
  return TREATMENT_ORDER.map((code) =>
    result(code, {
      confidence: code === 'UNKNOWN_REVIEW' ? 'low' : 'high',
      reasons: [],
      requiresUserConfirmation: code === 'UNKNOWN_REVIEW'
    })
  )
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyVat(input: VatClassificationInput): VatClassificationResult {
  return input.direction === 'income'
    ? classifyIncome(input)
    : classifyExpense(input)
}

function classifyIncome(input: VatClassificationInput): VatClassificationResult {
  const detection = detectGermanRate(input)

  if (input.userVatMethod === 'kleinunternehmer') {
    const contradicts = detection.vatCharged
    return result('KLEINUNTERNEHMER', {
      germanVatAmount: 0,
      confidence: 'high',
      reasons: [
        'You use the small-business scheme (§ 19 UStG), so no German VAT is charged on your revenue.',
        ...(contradicts
          ? [
              'However, the document itself shows a VAT amount greater than zero, which contradicts the small-business scheme.'
            ]
          : [])
      ],
      unresolvedQuestions: contradicts
        ? [
            'The document shows VAT although the small-business scheme charges none. Was VAT stated by mistake? Incorrectly stated VAT is still owed (§ 14c UStG).'
          ]
        : [],
      requiresUserConfirmation: contradicts
    })
  }

  if (input.vatExemptWording && detection.vatCharged) {
    return result('UNKNOWN_REVIEW', {
      confidence: 'low',
      requiresUserConfirmation: true,
      reasons: [
        'The document contains VAT-exemption wording but also shows a VAT amount greater than zero.',
        'These signals conflict, so no automatic classification was made.'
      ],
      unresolvedQuestions: [
        'Was VAT actually charged on this invoice, or is the supply exempt?'
      ]
    })
  }

  const country = normalizeCountry(input.recipientCountryCode)
  const germanHints =
    vatIdPrefix(input.recipientVatId) === 'DE' ||
    (detection.rate !== null && detection.vatCharged)

  if (country === 'DE' || (country === null && germanHints)) {
    return classifyIncomeDomestic(input, detection, country === 'DE')
  }
  if (country !== null && isEuCountry(country)) {
    return classifyIncomeEu(input, detection, country)
  }
  if (country !== null) {
    return classifyIncomeThirdCountry(input, detection, country)
  }

  return result('UNKNOWN_REVIEW', {
    confidence: 'low',
    requiresUserConfirmation: true,
    reasons: [
      'The recipient country could not be determined, so the place of supply is unknown.'
    ],
    unresolvedQuestions: ['In which country is the invoice recipient located?']
  })
}

function classifyIncomeDomestic(
  input: VatClassificationInput,
  detection: RateDetection,
  countryKnown: boolean
): VatClassificationResult {
  if (detection.rate !== null && detection.vatCharged) {
    const code: VatTreatmentCode =
      detection.rate === 19 ? 'DE_DOMESTIC_19' : 'DE_DOMESTIC_7'
    const questions: string[] = []
    if (!countryKnown) {
      questions.push(
        'The recipient country was not found on the document. Is the recipient located in Germany?'
      )
    }
    if (!detection.plausible && !detection.mixed) {
      questions.push(
        `The VAT amount on the document does not match ${detection.rate} % of the net amount. Which amounts are correct?`
      )
    }
    if (detection.mixed) {
      questions.push(
        'The document shows more than one VAT rate. Please verify the rate breakdown.'
      )
    }
    const clean = countryKnown && detection.plausible && !detection.mixed
    return result(code, {
      germanVatAmount: germanVatAmountOf(input, detection),
      confidence: clean ? 'high' : 'medium',
      requiresUserConfirmation: !clean,
      reasons: [
        `German VAT of ${detection.rate} % is shown on the document.`,
        countryKnown
          ? 'The recipient is located in Germany, so the supply is taxable in Germany.'
          : 'The recipient country is missing, but the German VAT shown suggests a domestic supply.'
      ],
      unresolvedQuestions: questions
    })
  }

  if (detection.foreignRate) {
    return result('UNKNOWN_REVIEW', {
      confidence: 'low',
      requiresUserConfirmation: true,
      reasons: [
        'A VAT rate other than the German 19 % or 7 % is shown although the recipient appears to be in Germany.'
      ],
      unresolvedQuestions: ['Which VAT rate and country actually apply to this invoice?']
    })
  }

  if (input.reverseChargeWording) {
    return result('UNKNOWN_REVIEW', {
      confidence: 'low',
      requiresUserConfirmation: true,
      reasons: [
        'The invoice carries reverse-charge wording although the recipient appears to be in Germany.',
        'Domestic reverse-charge cases (§ 13b UStG, e.g. construction services) are not covered by the automatic rules.'
      ],
      unresolvedQuestions: [
        'Does a domestic reverse-charge rule (§ 13b UStG) apply to this supply?'
      ]
    })
  }

  return result('DE_DOMESTIC_0_EXEMPT', {
    germanVatAmount: 0,
    confidence: 'low',
    requiresUserConfirmation: true,
    reasons: [
      'The recipient appears to be in Germany and no VAT is shown on the document.',
      'A domestic supply without VAT needs a specific exemption reason, which cannot be determined automatically.'
    ],
    unresolvedQuestions: [
      'Which exemption applies (e.g. § 4 UStG) — or should VAT have been charged?'
    ]
  })
}

function classifyIncomeEu(
  input: VatClassificationInput,
  detection: RateDetection,
  country: string
): VatClassificationResult {
  if (detection.vatCharged) {
    return result('UNKNOWN_REVIEW', {
      confidence: 'low',
      requiresUserConfirmation: true,
      reasons: [
        `The recipient is located in ${country} (EU) but VAT is shown on the invoice.`,
        'Charging VAT to an EU recipient can mean a consumer sale (possibly OSS) or a misclassification, so review is required.'
      ],
      unresolvedQuestions: [
        'Is the recipient a business or a consumer, and which country’s VAT was charged?'
      ]
    })
  }

  const evidence = hasBusinessEvidence(input)

  if (evidence && input.isServiceLikely) {
    const hasVatId = (input.recipientVatId?.trim().length ?? 0) > 0
    const reasons = [
      `The recipient is located in ${country}, an EU member state.`,
      hasVatId
        ? 'The recipient provided a VAT identification number, which indicates a business customer.'
        : 'The recipient appears to be a business, but no VAT identification number was found on the document.',
      'No VAT is shown, matching the reverse-charge rule for EU B2B services: the place of supply is where the recipient is established (§ 3a Abs. 2 UStG) and the recipient owes the VAT (Art. 196 of the EU VAT Directive).'
    ]
    if (input.reverseChargeWording) {
      reasons.push('The document contains explicit reverse-charge wording.')
    }
    return result('EU_B2B_REVERSE_CHARGE_REVENUE', {
      germanVatAmount: 0,
      confidence: hasVatId ? 'high' : 'medium',
      requiresUserConfirmation: !hasVatId,
      reasons,
      unresolvedQuestions: hasVatId
        ? []
        : [
            'What is the recipient’s VAT identification number (USt-IdNr.)? It is needed to support the reverse charge under Art. 196 of the EU VAT Directive.'
          ]
    })
  }

  if (evidence && !input.isServiceLikely) {
    return result('UNKNOWN_REVIEW', {
      confidence: 'low',
      requiresUserConfirmation: true,
      reasons: [
        `The recipient appears to be a business in ${country} (EU), but the supply does not look like a service.`,
        'A delivery of goods to another EU country (intra-Community supply) follows different rules that are not classified automatically.'
      ],
      unresolvedQuestions: [
        'Is this a service or a delivery of goods to another EU country?'
      ]
    })
  }

  return result('UNKNOWN_REVIEW', {
    confidence: 'low',
    requiresUserConfirmation: true,
    reasons: [
      `The recipient is located in ${country} (EU) and does not appear to be a business.`,
      'Sales to EU consumers may require German VAT or the OSS scheme, so review is required.'
    ],
    unresolvedQuestions: [
      'Is the recipient a business? If not, which VAT scheme applies to this consumer sale?'
    ]
  })
}

function classifyIncomeThirdCountry(
  input: VatClassificationInput,
  detection: RateDetection,
  country: string
): VatClassificationResult {
  if (detection.vatCharged) {
    return result('UNKNOWN_REVIEW', {
      confidence: 'low',
      requiresUserConfirmation: true,
      reasons: [
        `The recipient is located in ${country}, outside the EU, but VAT is shown on the invoice.`,
        'Third-country B2B services are generally not taxable in Germany, so the VAT shown conflicts with the location data.'
      ],
      unresolvedQuestions: [
        'Why was VAT charged although the recipient is located outside the EU?'
      ]
    })
  }

  const specialRules = matchSpecialRules(input.descriptionText)
  const confirmedBusiness = input.recipientIsBusiness === true
  const evidence = hasBusinessEvidence(input)
  const clean =
    confirmedBusiness && input.isServiceLikely && specialRules.length === 0

  const reasons = [`The recipient is located in ${country}, outside the EU.`]
  if (confirmedBusiness) {
    reasons.push('The recipient is confirmed to be a business.')
  } else if (evidence) {
    reasons.push(
      'The recipient appears to be a business (VAT/tax ID or legal form found), but this is not confirmed yet.'
    )
  }
  if (input.isServiceLikely) {
    reasons.push(
      'The supply appears to be a service. Under the general B2B rule the place of supply is where the recipient is established (§ 3a Abs. 2 UStG), so the revenue is not taxable in Germany.'
    )
  }

  const questions: string[] = []
  if (!confirmedBusiness) {
    questions.push(
      'Is the recipient a business (e.g. VAT/tax ID or commercial registration)? The § 3a Abs. 2 UStG rule only applies to B2B supplies.'
    )
  }
  if (!input.isServiceLikely) {
    questions.push(
      'Is this a service or a delivery of goods? Exports of goods follow different rules (§ 4 Nr. 1a, § 6 UStG).'
    )
  }
  for (const topic of specialRules) {
    questions.push(
      `The description suggests that ${topic}. Does this special rule override the general B2B rule here?`
    )
  }

  let confidence: VatConfidence
  if (clean) {
    confidence = 'high'
  } else if (
    input.recipientIsBusiness !== false &&
    input.isServiceLikely &&
    (confirmedBusiness || evidence)
  ) {
    confidence = 'medium'
  } else {
    confidence = 'low'
  }

  return result('THIRD_COUNTRY_B2B_SERVICE', {
    germanVatRate: null,
    germanVatAmount: 0,
    confidence,
    requiresUserConfirmation: !clean,
    reasons,
    unresolvedQuestions: questions
  })
}

function classifyExpense(input: VatClassificationInput): VatClassificationResult {
  const detection = detectGermanRate(input)
  const isKleinunternehmer = input.userVatMethod === 'kleinunternehmer'
  const issuerVatId = input.issuerVatId?.trim().toUpperCase().replace(/\s+/g, '') ?? null
  const prefix = vatIdPrefix(input.issuerVatId)

  if (detection.rate !== null && detection.vatCharged) {
    const amount = germanVatAmountOf(input, detection)

    if (isKleinunternehmer) {
      return result('DE_EXPENSE_NO_INPUT_VAT', {
        germanVatAmount: 0,
        legalBasis: '§ 19 Abs. 1 UStG',
        confidence: 'high',
        reasons: [
          `German VAT of ${detection.rate} % is shown on the document.`,
          'As a Kleinunternehmer you cannot deduct input VAT (§ 19 Abs. 1 UStG); the gross amount is your business expense.'
        ]
      })
    }

    if (prefix === 'DE') {
      const clean = detection.plausible && !detection.mixed
      const questions: string[] = []
      if (!clean) {
        questions.push(
          `The VAT amount does not clearly match ${detection.rate} % of the net amount (or several rates are shown). Please verify the amounts.`
        )
      }
      return result('DE_EXPENSE_INPUT_VAT', {
        germanVatRate: detection.rate,
        germanVatAmount: amount,
        confidence: clean ? 'high' : 'medium',
        requiresUserConfirmation: !clean,
        reasons: [
          `German VAT of ${detection.rate} % was charged by a supplier with a German VAT ID (${issuerVatId ?? 'DE…'}).`,
          'The VAT is generally deductible as input VAT (§ 15 Abs. 1 UStG).'
        ],
        unresolvedQuestions: questions
      })
    }

    // German VAT charged but issuer registration is OSS/foreign/unknown
    const reasons = [`German VAT of ${detection.rate} % is shown on the document.`]
    if (prefix === 'EU' || input.ossWording) {
      reasons.push(
        'The supplier appears to be registered under the One-Stop-Shop scheme (VAT ID starting with “EU”). OSS invoices generally do not entitle to an input-VAT deduction.'
      )
    } else if (prefix !== null) {
      reasons.push(
        `The supplier’s VAT ID (${issuerVatId ?? prefix}) is not a German registration; § 15 Abs. 1 UStG requires a proper German invoice for the input-VAT deduction.`
      )
    } else {
      reasons.push(
        'No supplier VAT ID was found on the document, so the input-VAT deduction cannot be verified.'
      )
    }
    return result('DE_EXPENSE_INPUT_VAT', {
      germanVatRate: detection.rate,
      germanVatAmount: amount,
      confidence: 'medium',
      requiresUserConfirmation: true,
      reasons,
      unresolvedQuestions: [
        'Does the invoice show a German VAT ID (DE…) of the supplier? Without one, the German VAT shown is likely not deductible as input VAT.'
      ]
    })
  }

  if (detection.foreignRate) {
    return result('DE_EXPENSE_NO_INPUT_VAT', {
      germanVatAmount: 0,
      confidence: 'medium',
      requiresUserConfirmation: true,
      reasons: [
        'The VAT shown does not match the German rates of 19 % or 7 %, so it appears to be foreign VAT.',
        'Foreign VAT is not deductible in the German VAT return; a refund is only possible via the VAT refund procedure (Vorsteuervergütung).'
      ],
      unresolvedQuestions: [
        'Which country’s VAT was charged? The gross amount would then be the business expense.'
      ]
    })
  }

  if (input.kleinunternehmerWording) {
    return result('DE_EXPENSE_NO_INPUT_VAT', {
      germanVatAmount: 0,
      legalBasis: '§ 19 Abs. 1 UStG',
      confidence: 'high',
      reasons: [
        'The supplier states that no VAT is charged under the small-business scheme (§ 19 UStG).',
        'Without charged VAT there is no input VAT to deduct.'
      ]
    })
  }

  const issuerCountry = normalizeCountry(input.issuerCountryCode)
  const foreignByVatId = prefix !== null && prefix !== 'DE'
  const foreignIssuer =
    (issuerCountry !== null && issuerCountry !== 'DE') ||
    (issuerCountry === null && foreignByVatId)

  if (foreignIssuer && input.isServiceLikely) {
    // § 13b candidate: recipient owes 19 % German VAT on the net amount
    const euVatId = isEuCountryVatPrefix(prefix) && prefix !== 'DE'
    const strong = input.reverseChargeWording && euVatId
    const net = input.netAmount ?? input.grossAmount
    const reverseChargeVat = net !== null ? roundMoney(net * 0.19) : null

    const reasons = [
      `The supplier is located outside Germany${issuerCountry ? ` (${issuerCountry})` : ''} and no VAT is shown on the document.`,
      'For services bought from abroad the tax liability shifts to you as the recipient: you owe 19 % German VAT on the net amount (§ 13b UStG).'
    ]
    if (input.reverseChargeWording) {
      reasons.push(
        'The document contains reverse-charge wording (e.g. Art. 196 of the EU VAT Directive).'
      )
    }
    if (isKleinunternehmer) {
      reasons.push(
        '§ 13b UStG also applies to Kleinunternehmer: the VAT is owed without a corresponding input-VAT deduction.'
      )
    } else {
      reasons.push(
        'If you are entitled to the input-VAT deduction, the same amount is deductible (§ 15 Abs. 1 Satz 1 Nr. 4 UStG), so the net effect is usually zero.'
      )
    }

    const questions: string[] = []
    if (!input.reverseChargeWording) {
      questions.push(
        'Does the invoice reference the reverse-charge mechanism (e.g. “VAT to be accounted for by the recipient” or Art. 196 of the EU VAT Directive)?'
      )
    }
    if (!euVatId) {
      questions.push(
        'Does the supplier have a regular EU VAT ID? OSS (“EU…”) or missing registrations make the assessment less certain.'
      )
    }

    return result('EXPENSE_REVERSE_CHARGE_13B', {
      germanVatRate: 19,
      germanVatAmount: reverseChargeVat,
      confidence: strong ? 'high' : 'medium',
      // KU users must always confirm — § 13b creates a payment without deduction
      requiresUserConfirmation: !strong || isKleinunternehmer,
      reasons,
      unresolvedQuestions: questions
    })
  }

  if (foreignIssuer && !input.isServiceLikely) {
    return result('UNKNOWN_REVIEW', {
      confidence: 'low',
      requiresUserConfirmation: true,
      reasons: [
        'The supplier is located outside Germany and the purchase does not look like a service.',
        'Goods bought abroad can trigger import VAT or an intra-Community acquisition, which is not classified automatically.'
      ],
      unresolvedQuestions: [
        'Is this a purchase of goods from abroad (import or intra-Community acquisition)?'
      ]
    })
  }

  const explicitNoVat = input.vatAmount === 0 || input.vatExemptWording
  const domesticIssuer =
    issuerCountry === 'DE' || (issuerCountry === null && prefix === 'DE')
  if (domesticIssuer && explicitNoVat && input.reverseChargeWording) {
    return result('UNKNOWN_REVIEW', {
      germanVatAmount: 0,
      confidence: 'low',
      requiresUserConfirmation: true,
      reasons: [
        'The German supplier charged no VAT and the document contains reverse-charge wording.',
        'Domestic reverse-charge cases can create VAT liability under § 13b UStG and need a separate assessment.'
      ],
      unresolvedQuestions: [
        'Does a domestic reverse-charge rule under § 13b UStG apply to this purchase?'
      ]
    })
  }
  if (domesticIssuer && explicitNoVat) {
    return result('DE_EXPENSE_NO_INPUT_VAT', {
      germanVatAmount: 0,
      legalBasis: '§ 15 Abs. 1 Satz 1 Nr. 1 UStG',
      confidence: 'high',
      reasons: [
        'A German supplier charged no VAT on this document.',
        'Without separately stated VAT there is no input VAT to deduct; the gross amount is the business expense.'
      ]
    })
  }

  return result('UNKNOWN_REVIEW', {
    confidence: 'low',
    requiresUserConfirmation: true,
    reasons: [
      'No usable VAT information could be read from the document (e.g. a small-amount receipt without a VAT breakdown).'
    ],
    unresolvedQuestions: [
      'What VAT rate, if any, is included in this receipt, and who is the supplier?'
    ]
  })
}
