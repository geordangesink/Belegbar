import { afterEach, describe, expect, it } from 'vitest'
import {
  clearSoliOverrides,
  getRegisteredSoliOverrideYears,
  getSoliOverride,
  registerSoliOverride,
  soliRulesEqual,
  validateSoliRules,
  type SoliRules
} from './soli-rules'

function rules(): SoliRules {
  return {
    thresholdSingle: 20350,
    thresholdJoint: 40700,
    rate: 0.055,
    mitigationRate: 0.119,
    centRounding: 'down'
  }
}

afterEach(() => clearSoliOverrides())

describe('validateSoliRules', () => {
  it('accepts the current statutory rules', () => {
    expect(validateSoliRules(rules())).toEqual([])
  })

  it('rejects implausible values and a joint threshold that is not double', () => {
    expect(validateSoliRules({ ...rules(), thresholdSingle: 1 })).toContain(
      'single_threshold_out_of_range'
    )
    expect(validateSoliRules({ ...rules(), thresholdJoint: 40000 })).toContain(
      'joint_threshold_not_double'
    )
    expect(validateSoliRules({ ...rules(), rate: 0.55 })).toContain('rate_out_of_range')
    expect(validateSoliRules({ ...rules(), mitigationRate: 0.0119 })).toContain(
      'mitigation_rate_out_of_range'
    )
    expect(validateSoliRules({ ...rules(), rate: Number.NaN })).toEqual([
      'non_finite_parameter'
    ])
  })
})

describe('Soli override registry', () => {
  it('stores an immutable copy with source provenance', () => {
    const input = rules()
    registerSoliOverride(2026, input, 'gii-solzg-20260715')
    input.thresholdSingle = 1

    expect(getSoliOverride(2026)).toEqual({
      year: 2026,
      rules: rules(),
      sourceLabel: 'gii-solzg-20260715'
    })
    expect(Object.isFrozen(getSoliOverride(2026)?.rules)).toBe(true)
    expect(getRegisteredSoliOverrideYears()).toEqual([2026])
  })

  it('rejects invalid years, labels and rules', () => {
    expect(() => registerSoliOverride(1999, rules(), 'gii-x')).toThrow()
    expect(() => registerSoliOverride(2026.5, rules(), 'gii-x')).toThrow()
    expect(() => registerSoliOverride(2026, rules(), 'bad label')).toThrow()
    expect(() =>
      registerSoliOverride(2026, { ...rules(), thresholdJoint: 1 }, 'gii-x')
    ).toThrow(/soli_override_rejected/)
  })

  it('compares rule sets structurally and clears overrides', () => {
    expect(soliRulesEqual(rules(), rules())).toBe(true)
    expect(soliRulesEqual(rules(), { ...rules(), rate: 0.056 })).toBe(false)
    registerSoliOverride(2026, rules(), 'gii-x')
    clearSoliOverrides()
    expect(getSoliOverride(2026)).toBeUndefined()
  })
})
