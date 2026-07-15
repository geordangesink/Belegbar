import { describe, expect, it } from 'vitest'
import { parseSection32aNormText } from './parse-norm-text'
import { NORM_TEXT_32A_2026 } from './parse-norm-text.fixtures'
import { getBuiltInTariffParams } from './income-tax'
import type { Section32aParams } from './tariff-override'

const EXPECTED_2026: Section32aParams = {
  basicAllowance: 12348,
  zone2End: 17799,
  zone3End: 69878,
  zone4End: 277825,
  zone2: { a: 914.51, b: 1400 },
  zone3: { a: 173.1, b: 2397, c: 1034.87 },
  zone4: { rate: 0.42, sub: 11135.63 },
  zone5: { rate: 0.45, sub: 19470.38 }
}

// fixture uses NBSP ( ) in numbers, bullet (•) and en dash (–)
const NBSP = ' '

describe('parseSection32aNormText — official 2026 text', () => {
  it('extracts the exact 2026 parameters', () => {
    const parsed = parseSection32aNormText(NORM_TEXT_32A_2026)
    expect(parsed).not.toBeNull()
    expect(parsed!.params).toEqual(EXPECTED_2026)
  })

  it('reproduces the built-in 2026 engine parameters exactly (end-to-end proof)', () => {
    const parsed = parseSection32aNormText(NORM_TEXT_32A_2026)
    expect(parsed!.params).toEqual(getBuiltInTariffParams(2026))
  })

  it('reads the validity year from "ab dem Veranlagungszeitraum 2026"', () => {
    expect(parseSection32aNormText(NORM_TEXT_32A_2026)!.firstApplicableYear).toBe(2026)
  })

  it('returns null firstApplicableYear when the validity phrase is missing', () => {
    const withoutValidity = NORM_TEXT_32A_2026.replace(
      /ab dem Veranlagungszeitraum 2026 /,
      ''
    )
    const parsed = parseSection32aNormText(withoutValidity)
    expect(parsed).not.toBeNull()
    expect(parsed!.firstApplicableYear).toBeNull()
    expect(parsed!.params).toEqual(EXPECTED_2026)
  })
})

describe('parseSection32aNormText — character tolerance', () => {
  it.each([
    ['middle dot \\u00B7', NORM_TEXT_32A_2026.replace(/•/g, '·')],
    ['dot operator \\u22C5', NORM_TEXT_32A_2026.replace(/•/g, '⋅')],
    ['asterisk *', NORM_TEXT_32A_2026.replace(/•/g, '*')],
    ['minus sign \\u2212', NORM_TEXT_32A_2026.replace(/–/g, '−')],
    ['em dash \\u2014', NORM_TEXT_32A_2026.replace(/–/g, '—')],
    ['ASCII hyphen', NORM_TEXT_32A_2026.replace(/–/g, '-')],
    ['narrow NBSP \\u202F', NORM_TEXT_32A_2026.replace(/ /g, ' ')],
    ['plain spaces', NORM_TEXT_32A_2026.replace(/ /g, ' ')],
    [
      'dot thousands separators',
      NORM_TEXT_32A_2026.replace(/(\d) (\d{3})/g, '$1.$2')
    ],
    ['extra whitespace runs', NORM_TEXT_32A_2026.replace(/ /g, '  \n\t ')]
  ])('parses with %s', (_label, variant) => {
    const parsed = parseSection32aNormText(variant)
    expect(parsed).not.toBeNull()
    expect(parsed!.params).toEqual(EXPECTED_2026)
  })
})

describe('parseSection32aNormText — rejections', () => {
  it('rejects empty and unrelated text', () => {
    expect(parseSection32aNormText('')).toBeNull()
    expect(parseSection32aNormText('Lorem ipsum dolor sit amet')).toBeNull()
  })

  it('rejects text missing the top zone', () => {
    const truncated = NORM_TEXT_32A_2026.replace(
      new RegExp(`5\\. von 277${NBSP}826 Euro an.*$`),
      ''
    )
    expect(truncated).not.toBe(NORM_TEXT_32A_2026)
    expect(parseSection32aNormText(truncated)).toBeNull()
  })

  it('rejects a broken zone chain (zone 3 start does not follow zone 2 end)', () => {
    const shifted = NORM_TEXT_32A_2026.replace(`von 17${NBSP}800`, `von 17${NBSP}801`)
    expect(shifted).not.toBe(NORM_TEXT_32A_2026)
    expect(parseSection32aNormText(shifted)).toBeNull()
  })

  it('rejects garbled boundary numbers', () => {
    // zone3End appears both in "bis N Euro" and the next "von N+1" — changing
    // only one side must break the chain check
    const garbled = NORM_TEXT_32A_2026.replace(`bis 69${NBSP}878`, `bis 59${NBSP}878`)
    expect(garbled).not.toBe(NORM_TEXT_32A_2026)
    expect(parseSection32aNormText(garbled)).toBeNull()
  })

  it('rejects text where a formula lost its variable', () => {
    const broken = NORM_TEXT_32A_2026.replace('(914,51 • y', '(914,51 • q')
    expect(broken).not.toBe(NORM_TEXT_32A_2026)
    expect(parseSection32aNormText(broken)).toBeNull()
  })
})
