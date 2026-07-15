/**
 * Versioned German income-tax estimation engines (§32a EStG tariff).
 * One engine per supported tax year; selection by year with explicit
 * version labels. Everything here is an ESTIMATE — the UI must say so.
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
  /** zone 1 upper bound: tax-free basic allowance */
  grundfreibetrag: number
  /** zone 2 upper bound (also the offset for z in zone 3) */
  progression1End: number
  /** quadratic factor of zone 2 */
  progression1Factor: number
  /** zone 3 upper bound */
  progression2End: number
  /** quadratic factor of zone 3 */
  progression2Factor: number
  /** additive constant of zone 3 */
  progression2Constant: number
  /** zone 4 upper bound (42 % zone) */
  proportionalEnd: number
  /** subtraction constant of the 42 % zone */
  proportionalOffset: number
  /** subtraction constant of the 45 % zone */
  topOffset: number
  /** solidarity surcharge Freigrenze for single assessment */
  soliThresholdSingle: number
}

const PROGRESSION1_LINEAR = 1400
const PROGRESSION2_LINEAR = 2397
const RATE_ZONE4 = 0.42
const RATE_ZONE5 = 0.45
const SOLI_RATE = 0.055
const SOLI_MITIGATION_RATE = 0.119

const TARIFF_2025: TariffParameters = {
  year: 2025,
  version: '2025.1',
  grundfreibetrag: 12096,
  progression1End: 17443,
  progression1Factor: 932.3,
  progression2End: 68480,
  progression2Factor: 176.64,
  progression2Constant: 1015.13,
  proportionalEnd: 277825,
  proportionalOffset: 10911.92,
  topOffset: 19246.67,
  soliThresholdSingle: 19950
}

const TARIFF_2026: TariffParameters = {
  year: 2026,
  version: '2026.1',
  grundfreibetrag: 12348,
  progression1End: 17799,
  progression1Factor: 914.51,
  progression2End: 69878,
  progression2Factor: 173.1,
  progression2Constant: 1034.87,
  proportionalEnd: 277825,
  proportionalOffset: 11135.63,
  topOffset: 19470.38,
  soliThresholdSingle: 20350
}

function round2(value: number): number {
  const sign = value < 0 ? -1 : 1
  const scaled = Number((Math.abs(value) * 100).toPrecision(12))
  return (sign * Math.round(scaled)) / 100
}

/** § 32a Abs. 1 EStG tariff for a full-euro income x (before Abs. 5 flooring). */
function tariffTax(p: TariffParameters, x: number): number {
  if (x <= p.grundfreibetrag) return 0
  if (x <= p.progression1End) {
    const y = (x - p.grundfreibetrag) / 10000
    return (p.progression1Factor * y + PROGRESSION1_LINEAR) * y
  }
  if (x <= p.progression2End) {
    const z = (x - p.progression1End) / 10000
    return (
      (p.progression2Factor * z + PROGRESSION2_LINEAR) * z +
      p.progression2Constant
    )
  }
  if (x <= p.proportionalEnd) return RATE_ZONE4 * x - p.proportionalOffset
  return RATE_ZONE5 * x - p.topOffset
}

function marginalRatePercent(p: TariffParameters, x: number): number {
  if (x <= p.grundfreibetrag) return 0
  if (x <= p.progression1End) {
    const y = (x - p.grundfreibetrag) / 10000
    return round2((2 * p.progression1Factor * y + PROGRESSION1_LINEAR) / 100)
  }
  if (x <= p.progression2End) {
    const z = (x - p.progression1End) / 10000
    return round2((2 * p.progression2Factor * z + PROGRESSION2_LINEAR) / 100)
  }
  if (x <= p.proportionalEnd) return 42
  return 45
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
      const perShare = Math.floor(tariffTax(p, tariffIncome))
      const incomeTax = joint ? perShare * 2 : perShare

      let solidaritySurcharge = 0
      if (input.includeSolidaritySurcharge && incomeTax > 0) {
        const threshold = joint
          ? p.soliThresholdSingle * 2
          : p.soliThresholdSingle
        if (incomeTax > threshold) {
          solidaritySurcharge = round2(
            Math.min(
              SOLI_RATE * incomeTax,
              SOLI_MITIGATION_RATE * (incomeTax - threshold)
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
        marginalRatePercent: marginalRatePercent(p, tariffIncome),
        averageRatePercent: zvE > 0 ? round2((incomeTax / zvE) * 100) : 0
      }
    }
  }
}

/** Ascending by year. */
const ENGINES: IncomeTaxEngine[] = [makeEngine(TARIFF_2025), makeEngine(TARIFF_2026)]

/** Returns the engine for a year, or the closest earlier engine marked as fallback. */
export function getIncomeTaxEngine(year: number): {
  engine: IncomeTaxEngine
  exactYearMatch: boolean
} {
  const exact = ENGINES.find((e) => e.year === year)
  if (exact) return { engine: exact, exactYearMatch: true }
  let earlier: IncomeTaxEngine | undefined
  for (const engine of ENGINES) {
    if (engine.year < year) earlier = engine
  }
  const fallback = earlier ?? ENGINES[0]
  if (!fallback) throw new Error('no income tax engines registered')
  return { engine: fallback, exactYearMatch: false }
}

export function listSupportedTaxYears(): number[] {
  return ENGINES.map((e) => e.year)
}
