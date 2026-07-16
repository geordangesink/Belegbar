export interface SoliRules {
  thresholdSingle: number
  thresholdJoint: number
  rate: number
  mitigationRate: number
  centRounding: 'down'
}

export interface SoliOverride {
  year: number
  rules: SoliRules
  sourceLabel: string
}

export function soliRulesEqual(a: SoliRules, b: SoliRules): boolean {
  return (
    a.thresholdSingle === b.thresholdSingle &&
    a.thresholdJoint === b.thresholdJoint &&
    a.rate === b.rate &&
    a.mitigationRate === b.mitigationRate &&
    a.centRounding === b.centRounding
  )
}

export function validateSoliRules(rules: SoliRules): string[] {
  const numbers = [
    rules.thresholdSingle,
    rules.thresholdJoint,
    rules.rate,
    rules.mitigationRate
  ]
  if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return ['non_finite_parameter']
  }

  const errors: string[] = []
  if (
    !Number.isInteger(rules.thresholdSingle) ||
    rules.thresholdSingle < 10000 ||
    rules.thresholdSingle > 100000
  ) {
    errors.push('single_threshold_out_of_range')
  }
  if (
    !Number.isInteger(rules.thresholdJoint) ||
    rules.thresholdJoint < 20000 ||
    rules.thresholdJoint > 200000
  ) {
    errors.push('joint_threshold_out_of_range')
  }
  if (rules.thresholdJoint !== rules.thresholdSingle * 2) {
    errors.push('joint_threshold_not_double')
  }
  if (rules.rate < 0.04 || rules.rate > 0.07) {
    errors.push('rate_out_of_range')
  }
  if (rules.mitigationRate < 0.08 || rules.mitigationRate > 0.18) {
    errors.push('mitigation_rate_out_of_range')
  }
  if (rules.mitigationRate <= rules.rate) {
    errors.push('mitigation_rate_not_above_rate')
  }
  if (rules.centRounding !== 'down') {
    errors.push('unsupported_cent_rounding')
  }
  return errors
}

const overrides = new Map<number, SoliOverride>()

function cloneRules(rules: SoliRules): SoliRules {
  return Object.freeze({
    thresholdSingle: rules.thresholdSingle,
    thresholdJoint: rules.thresholdJoint,
    rate: rules.rate,
    mitigationRate: rules.mitigationRate,
    centRounding: rules.centRounding
  })
}

export function registerSoliOverride(
  year: number,
  rules: SoliRules,
  sourceLabel: string
): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('soli_override_invalid_year')
  }
  const label = sourceLabel.trim()
  if (label === '' || label.length > 40 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(label)) {
    throw new Error('soli_override_invalid_source_label')
  }
  const errors = validateSoliRules(rules)
  if (errors.length > 0) {
    throw new Error(`soli_override_rejected:${errors.join(',')}`)
  }
  overrides.set(
    year,
    Object.freeze({ year, rules: cloneRules(rules), sourceLabel: label })
  )
}

export function getSoliOverride(year: number): SoliOverride | undefined {
  return overrides.get(year)
}

export function getRegisteredSoliOverrideYears(): number[] {
  return [...overrides.keys()].sort((a, b) => a - b)
}

export function clearSoliOverrides(): void {
  overrides.clear()
}
