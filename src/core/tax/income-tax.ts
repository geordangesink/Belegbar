/**
 * Versioned German income-tax estimation engines (§32a EStG tariff).
 * One engine per supported tax year; selection by year with explicit
 * version labels. Everything here is an ESTIMATE — the UI must say so.
 *
 * The tariff itself is evaluated by the single evaluator in
 * tariff-override.ts; built-in parameter sets and validated runtime
 * overrides (fetched from gesetze-im-internet.de) both flow through it.
 * When an override is registered for a year, getIncomeTaxEngine prefers
 * it and appends the override source to the version label, e.g.
 * '2026.1+gii-20260715'.
 *
 * Tariff parameters verified against the published § 32a EStG texts:
 * - 2025: Grundfreibetrag 12 096 €; (932,30·y + 1 400)·y up to 17 443 €;
 *   (176,64·z + 2 397)·z + 1 015,13 up to 68 480 €; 0,42·x − 10 911,92 up to
 *   277 825 €; 0,45·x − 19 246,67 above.
 * - 2026 (Steuerfortentwicklungsgesetz): Grundfreibetrag 12 348 €;
 *   (914,51·y + 1 400)·y up to 17 799 €; (173,10·z + 2 397)·z + 1 034,87 up
 *   to 69 878 €; 0,42·x − 11 135,63 up to 277 825 €; 0,45·x − 19 470,38 above.
 * Solidarity surcharge (SolzG): 5,5 %, Freigrenze 19 950 € (2025) /
 * 20 350 € (2026) single — doubled for joint assessment — with a mitigation
 * zone capping the surcharge at 11,9 % of the tax above the Freigrenze.
 */
import {
  evaluateTariff,
  getRegisteredOverrideYears,
  getTariffOverride,
  tariffMarginalRate,
  type Section32aParams
} from './tariff-override'
import {
  getRegisteredSoliOverrideYears,
  getSoliOverride,
  type SoliRules
} from './soli-rules'

export interface IncomeTaxEngineInput {
  year: number
  taxableIncome: number
  assessmentType: 'single' | 'joint'
  churchTax: 'none' | 'rate8' | 'rate9'
  includeSolidaritySurcharge: boolean
}

export interface IncomeTaxEngineResult {
  incomeTax: number
  solidaritySurcharge: number
  churchTax: number
  total: number
  engineVersion: string
  marginalRatePercent: number
  averageRatePercent: number
}

export interface IncomeTaxEngine {
  year: number
  version: string
  calculate(input: IncomeTaxEngineInput): IncomeTaxEngineResult
}

interface TariffParameters {
  year: number
  version: string
  params: Section32aParams
  soli: SoliRules
}

const SOLI_RATE = 0.055
const SOLI_MITIGATION_RATE = 0.119

function soli(thresholdSingle: number): SoliRules {
  return Object.freeze({
    thresholdSingle,
    thresholdJoint: thresholdSingle * 2,
    rate: SOLI_RATE,
    mitigationRate: SOLI_MITIGATION_RATE,
    centRounding: 'down'
  })
}

const TARIFF_2022: TariffParameters = {
  year: 2022,
  version: '2022.1',
  params: {
    basicAllowance: 10347,
    zone2End: 14926,
    zone3End: 58596,
    zone4End: 277825,
    zone2: { a: 1088.67, b: 1400 },
    zone3: { a: 206.43, b: 2397, c: 869.32 },
    zone4: { rate: 0.42, sub: 9336.45 },
    zone5: { rate: 0.45, sub: 17671.2 }
  },
  soli: soli(16956)
}

const TARIFF_2023: TariffParameters = {
  year: 2023,
  version: '2023.1',
  params: {
    basicAllowance: 10908,
    zone2End: 15999,
    zone3End: 62809,
    zone4End: 277825,
    zone2: { a: 979.18, b: 1400 },
    zone3: { a: 192.59, b: 2397, c: 966.53 },
    zone4: { rate: 0.42, sub: 9972.98 },
    zone5: { rate: 0.45, sub: 18307.73 }
  },
  soli: soli(17543)
}

const TARIFF_2024: TariffParameters = {
  year: 2024,
  version: '2024.1',
  params: {
    basicAllowance: 11784,
    zone2End: 17005,
    zone3End: 66760,
    zone4End: 277825,
    zone2: { a: 954.8, b: 1400 },
    zone3: { a: 181.19, b: 2397, c: 991.21 },
    zone4: { rate: 0.42, sub: 10636.31 },
    zone5: { rate: 0.45, sub: 18971.06 }
  },
  soli: soli(18130)
}

const TARIFF_2025: TariffParameters = {
  year: 2025,
  version: '2025.1',
  params: {
    basicAllowance: 12096,
    zone2End: 17443,
    zone3End: 68480,
    zone4End: 277825,
    zone2: { a: 932.3, b: 1400 },
    zone3: { a: 176.64, b: 2397, c: 1015.13 },
    zone4: { rate: 0.42, sub: 10911.92 },
    zone5: { rate: 0.45, sub: 19246.67 }
  },
  soli: soli(19950)
}

const TARIFF_2026: TariffParameters = {
  year: 2026,
  version: '2026.1',
  params: {
    basicAllowance: 12348,
    zone2End: 17799,
    zone3End: 69878,
    zone4End: 277825,
    zone2: { a: 914.51, b: 1400 },
    zone3: { a: 173.1, b: 2397, c: 1034.87 },
    zone4: { rate: 0.42, sub: 11135.63 },
    zone5: { rate: 0.45, sub: 19470.38 }
  },
  soli: soli(20350)
}

/** Ascending by year. */
const BUILT_IN: TariffParameters[] = [
  TARIFF_2022,
  TARIFF_2023,
  TARIFF_2024,
  TARIFF_2025,
  TARIFF_2026
]

function round2(value: number): number {
  const sign = value < 0 ? -1 : 1
  const scaled = Number((Math.abs(value) * 100).toPrecision(12))
  return (sign * Math.round(scaled)) / 100
}

function truncate2(value: number): number {
  const scaled = Number((Math.max(0, value) * 100).toPrecision(12))
  return Math.floor(scaled) / 100
}

function makeEngine(p: TariffParameters): IncomeTaxEngine {
  return {
    year: p.year,
    version: p.version,
    calculate(input: IncomeTaxEngineInput): IncomeTaxEngineResult {
      // zvE floored to full euro; tax rounded down (§ 32a Abs. 1 und 5 EStG)
      const zvE = Math.max(0, Math.floor(input.taxableIncome))
      const joint = input.assessmentType === 'joint'
      // splitting: twice the tax on half the joint income (§ 32a Abs. 5)
      const tariffIncome = joint ? Math.floor(zvE / 2) : zvE
      const perShare = Math.floor(evaluateTariff(p.params, tariffIncome))
      const incomeTax = joint ? perShare * 2 : perShare

      let solidaritySurcharge = 0
      if (input.includeSolidaritySurcharge && incomeTax > 0) {
        const threshold = joint ? p.soli.thresholdJoint : p.soli.thresholdSingle
        if (incomeTax > threshold) {
          solidaritySurcharge = truncate2(
            Math.min(
              p.soli.rate * incomeTax,
              p.soli.mitigationRate * (incomeTax - threshold)
            )
          )
        }
      }

      const churchRate =
        input.churchTax === 'rate8' ? 0.08 : input.churchTax === 'rate9' ? 0.09 : 0
      const churchTax = round2(incomeTax * churchRate)

      return {
        incomeTax,
        solidaritySurcharge,
        churchTax,
        total: round2(incomeTax + solidaritySurcharge + churchTax),
        engineVersion: p.version,
        marginalRatePercent: round2(tariffMarginalRate(p.params, tariffIncome) * 100),
        averageRatePercent: zvE > 0 ? round2((incomeTax / zvE) * 100) : 0
      }
    }
  }
}

function builtInFor(year: number): TariffParameters | undefined {
  return BUILT_IN.find((p) => p.year === year)
}

export interface ResolvedSoli {
  rules: SoliRules
  sourceYear: number
  versionSuffix: string
  exactYearMatch: boolean
}

export function getSoliRulesForYear(year: number): ResolvedSoli {
  const exactOverride = getSoliOverride(year)
  if (exactOverride) {
    return {
      rules: exactOverride.rules,
      sourceYear: year,
      versionSuffix: `+${exactOverride.sourceLabel}`,
      exactYearMatch: true
    }
  }

  const exactBuiltIn = builtInFor(year)
  if (exactBuiltIn) {
    return {
      rules: exactBuiltIn.soli,
      sourceYear: year,
      versionSuffix: '',
      exactYearMatch: true
    }
  }

  const candidateYears = [
    ...BUILT_IN.map((parameters) => parameters.year),
    ...getRegisteredSoliOverrideYears()
  ]
  const uniqueYears = [...new Set(candidateYears)].sort((a, b) => a - b)
  const sourceYear =
    uniqueYears.filter((candidate) => candidate < year).at(-1) ?? uniqueYears[0]
  if (sourceYear === undefined) throw new Error('no solidarity surcharge rules registered')

  const override = getSoliOverride(sourceYear)
  const rules = override?.rules ?? builtInFor(sourceYear)?.soli
  if (!rules) throw new Error('no solidarity surcharge rules registered')
  const source = override ? `${sourceYear}-${override.sourceLabel}` : String(sourceYear)
  return {
    rules,
    sourceYear,
    versionSuffix: `+solzg-fallback-${source}`,
    exactYearMatch: false
  }
}

/** Engine for exactly this year (override preferred), or undefined. */
function engineForYear(year: number): IncomeTaxEngine | undefined {
  const builtIn = builtInFor(year)
  const override = getTariffOverride(year)
  const resolvedSoli = getSoliRulesForYear(year)
  if (override) {
    const baseVersion = builtIn ? builtIn.version : `${year}.0`
    return makeEngine({
      year,
      version: `${baseVersion}+${override.sourceLabel}${resolvedSoli.versionSuffix}`,
      params: override.params,
      soli: resolvedSoli.rules
    })
  }
  return builtIn
    ? makeEngine({
        ...builtIn,
        version: `${builtIn.version}${resolvedSoli.versionSuffix}`,
        soli: resolvedSoli.rules
      })
    : undefined
}

/** Returns the engine for a year, or the closest earlier engine marked as fallback. */
export function getIncomeTaxEngine(year: number): {
  engine: IncomeTaxEngine
  exactYearMatch: boolean
} {
  const exact = engineForYear(year)
  if (exact) return { engine: exact, exactYearMatch: true }

  const candidateYears = [
    ...BUILT_IN.map((p) => p.year),
    ...getRegisteredOverrideYears()
  ]
  let bestEarlier: number | undefined
  for (const candidate of candidateYears) {
    if (candidate < year && (bestEarlier === undefined || candidate > bestEarlier)) {
      bestEarlier = candidate
    }
  }
  const fallbackYear = bestEarlier ?? BUILT_IN[0]?.year
  const fallback = fallbackYear === undefined ? undefined : engineForYear(fallbackYear)
  if (!fallback) throw new Error('no income tax engines registered')
  return { engine: fallback, exactYearMatch: false }
}

export function listSupportedTaxYears(): number[] {
  return BUILT_IN.map((p) => p.year)
}

/** Built-in §32a parameters for a year (copy), or undefined when not shipped. */
export function getBuiltInTariffParams(year: number): Section32aParams | undefined {
  const p = builtInFor(year)
  return p ? structuredClone(p.params) : undefined
}

export function getBuiltInSoliRules(year: number): SoliRules | undefined {
  const rules = builtInFor(year)?.soli
  return rules ? structuredClone(rules) : undefined
}
