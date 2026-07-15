/**
 * § 32a EStG tariff parameters: the single evaluator both the built-in
 * engines and runtime overrides flow through, plus a small in-memory
 * override registry.
 *
 * Overrides come from the official norm text on gesetze-im-internet.de
 * (fetched by src/main/tax/tariff-update.ts). They are NEVER accepted
 * without passing validateTariffParams() — registerTariffOverride throws
 * on invalid parameters, so a garbled or misparsed norm text can never
 * displace the built-in engines.
 */

/** Parameters of the five-zone § 32a Abs. 1 EStG tariff formula. */
export interface Section32aParams {
  /** zone 1 upper bound: tax-free basic allowance (Grundfreibetrag) */
  basicAllowance: number
  /** zone 2 (first progression zone) upper bound */
  zone2End: number
  /** zone 3 (second progression zone) upper bound */
  zone3End: number
  /** zone 4 (42 % proportional zone) upper bound */
  zone4End: number
  /** zone 2: (a·y + b)·y with y = (x − basicAllowance) / 10 000 */
  zone2: { a: number; b: number }
  /** zone 3: (a·z + b)·z + c with z = (x − zone2End) / 10 000 */
  zone3: { a: number; b: number; c: number }
  /** zone 4: rate·x − sub */
  zone4: { rate: number; sub: number }
  /** zone 5: rate·x − sub */
  zone5: { rate: number; sub: number }
}

/**
 * § 32a Abs. 1 EStG tariff for a full-euro income x, before the final
 * rounding of Abs. 1 Satz 6 (callers floor the result).
 */
export function evaluateTariff(p: Section32aParams, x: number): number {
  if (x <= p.basicAllowance) return 0
  if (x <= p.zone2End) {
    const y = (x - p.basicAllowance) / 10000
    return (p.zone2.a * y + p.zone2.b) * y
  }
  if (x <= p.zone3End) {
    const z = (x - p.zone2End) / 10000
    return (p.zone3.a * z + p.zone3.b) * z + p.zone3.c
  }
  if (x <= p.zone4End) return p.zone4.rate * x - p.zone4.sub
  return p.zone5.rate * x - p.zone5.sub
}

/** Marginal tax rate at income x as a fraction (0.42 = 42 %). */
export function tariffMarginalRate(p: Section32aParams, x: number): number {
  if (x <= p.basicAllowance) return 0
  if (x <= p.zone2End) {
    const y = (x - p.basicAllowance) / 10000
    return (2 * p.zone2.a * y + p.zone2.b) / 10000
  }
  if (x <= p.zone3End) {
    const z = (x - p.zone2End) / 10000
    return (2 * p.zone3.a * z + p.zone3.b) / 10000
  }
  if (x <= p.zone4End) return p.zone4.rate
  return p.zone5.rate
}

/** Structural equality of two parameter sets. */
export function tariffParamsEqual(a: Section32aParams, b: Section32aParams): boolean {
  return (
    a.basicAllowance === b.basicAllowance &&
    a.zone2End === b.zone2End &&
    a.zone3End === b.zone3End &&
    a.zone4End === b.zone4End &&
    a.zone2.a === b.zone2.a &&
    a.zone2.b === b.zone2.b &&
    a.zone3.a === b.zone3.a &&
    a.zone3.b === b.zone3.b &&
    a.zone3.c === b.zone3.c &&
    a.zone4.rate === b.zone4.rate &&
    a.zone4.sub === b.zone4.sub &&
    a.zone5.rate === b.zone5.rate &&
    a.zone5.sub === b.zone5.sub
  )
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

/** Maximum tolerated jump of the tariff function at a zone boundary (EUR). */
const CONTINUITY_TOLERANCE_EUR = 2
/** Tolerated deviation of the zone-3 exit marginal rate from zone4.rate. */
const MARGINAL_RATE_TOLERANCE = 0.02

/**
 * Plausibility + consistency checks. Returns a list of stable error codes;
 * an empty list means the parameters are acceptable as an override.
 */
export function validateTariffParams(p: Section32aParams): string[] {
  const numbers = [
    p.basicAllowance,
    p.zone2End,
    p.zone3End,
    p.zone4End,
    p.zone2.a,
    p.zone2.b,
    p.zone3.a,
    p.zone3.b,
    p.zone3.c,
    p.zone4.rate,
    p.zone4.sub,
    p.zone5.rate,
    p.zone5.sub
  ]
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return ['non_finite_parameter']
  }

  const errors: string[] = []
  if (p.basicAllowance < 10000 || p.basicAllowance > 25000) {
    errors.push('basic_allowance_out_of_range')
  }
  if (
    !(
      p.basicAllowance < p.zone2End &&
      p.zone2End < p.zone3End &&
      p.zone3End < p.zone4End
    )
  ) {
    errors.push('boundaries_not_ascending')
  }
  if (
    p.zone2.a <= 0 ||
    p.zone3.a <= 0 ||
    p.zone3.c <= 0 ||
    p.zone4.sub <= 0 ||
    p.zone5.sub <= 0
  ) {
    errors.push('non_positive_parameter')
  }

  // marginal rate progression ~14 % → 42 % → 45 %
  if (p.zone2.b < 1200 || p.zone2.b > 1600) errors.push('entry_rate_not_near_14_percent')
  if (p.zone4.rate < 0.4 || p.zone4.rate > 0.44) errors.push('zone4_rate_not_near_42_percent')
  if (p.zone5.rate < 0.43 || p.zone5.rate > 0.48) errors.push('zone5_rate_not_near_45_percent')
  if (p.zone5.rate <= p.zone4.rate) errors.push('top_rate_not_above_zone4_rate')

  // continuity checks only make sense on structurally sound boundaries
  if (errors.length > 0) return errors

  const y2 = (p.zone2End - p.basicAllowance) / 10000
  const endOfZone2 = (p.zone2.a * y2 + p.zone2.b) * y2
  if (Math.abs(endOfZone2 - p.zone3.c) > CONTINUITY_TOLERANCE_EUR) {
    errors.push('discontinuous_at_zone2_end')
  }

  const z3 = (p.zone3End - p.zone2End) / 10000
  const endOfZone3 = (p.zone3.a * z3 + p.zone3.b) * z3 + p.zone3.c
  const startOfZone4 = p.zone4.rate * p.zone3End - p.zone4.sub
  if (Math.abs(endOfZone3 - startOfZone4) > CONTINUITY_TOLERANCE_EUR) {
    errors.push('discontinuous_at_zone3_end')
  }

  const endOfZone4 = p.zone4.rate * p.zone4End - p.zone4.sub
  const startOfZone5 = p.zone5.rate * p.zone4End - p.zone5.sub
  if (Math.abs(endOfZone4 - startOfZone5) > CONTINUITY_TOLERANCE_EUR) {
    errors.push('discontinuous_at_zone4_end')
  }

  // the second progression zone must exit at ~ the proportional rate
  const zone3ExitRate = (2 * p.zone3.a * z3 + p.zone3.b) / 10000
  if (Math.abs(zone3ExitRate - p.zone4.rate) > MARGINAL_RATE_TOLERANCE) {
    errors.push('zone3_exit_rate_mismatch')
  }

  return errors
}

// ---------------------------------------------------------------------------
// override registry
// ---------------------------------------------------------------------------

export interface TariffOverride {
  year: number
  params: Section32aParams
  /** e.g. 'gii-20260715' — appended to the engine version label */
  sourceLabel: string
}

const overrides = new Map<number, TariffOverride>()

function cloneParams(p: Section32aParams): Section32aParams {
  const copy: Section32aParams = {
    basicAllowance: p.basicAllowance,
    zone2End: p.zone2End,
    zone3End: p.zone3End,
    zone4End: p.zone4End,
    zone2: { a: p.zone2.a, b: p.zone2.b },
    zone3: { a: p.zone3.a, b: p.zone3.b, c: p.zone3.c },
    zone4: { rate: p.zone4.rate, sub: p.zone4.sub },
    zone5: { rate: p.zone5.rate, sub: p.zone5.sub }
  }
  Object.freeze(copy.zone2)
  Object.freeze(copy.zone3)
  Object.freeze(copy.zone4)
  Object.freeze(copy.zone5)
  return Object.freeze(copy)
}

/**
 * Registers validated tariff parameters for one assessment year.
 * Throws when the year, the label or the parameters are unacceptable —
 * callers that fetched the params from the network must treat a throw
 * as "keep the built-in engine".
 */
export function registerTariffOverride(
  year: number,
  params: Section32aParams,
  sourceLabel: string
): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('tariff_override_invalid_year')
  }
  const label = sourceLabel.trim()
  if (label === '' || label.length > 40 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(label)) {
    throw new Error('tariff_override_invalid_source_label')
  }
  const errors = validateTariffParams(params)
  if (errors.length > 0) {
    throw new Error(`tariff_override_rejected:${errors.join(',')}`)
  }
  overrides.set(year, { year, params: cloneParams(params), sourceLabel: label })
}

export function clearTariffOverrides(): void {
  overrides.clear()
}

export function getTariffOverride(year: number): TariffOverride | undefined {
  return overrides.get(year)
}

/** Years with a registered override, ascending. */
export function getRegisteredOverrideYears(): number[] {
  return [...overrides.keys()].sort((a, b) => a - b)
}
