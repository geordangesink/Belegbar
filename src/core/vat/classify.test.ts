import { describe, expect, it } from 'vitest'
import type { VatTreatmentCode } from '../../shared/domain'
import {
  classifyVat,
  isEuCountry,
  listVatTreatments,
  type VatClassificationInput
} from './classify'

function input(
  overrides: Partial<VatClassificationInput>
): VatClassificationInput {
  return {
    direction: 'income',
    taxYear: 2026,
    issuerCountryCode: 'DE',
    issuerVatId: null,
    recipientCountryCode: null,
    recipientVatId: null,
    recipientIsBusiness: null,
    recipientName: null,
    vatRates: [],
    netAmount: null,
    vatAmount: null,
    grossAmount: null,
    currency: 'EUR',
    reverseChargeWording: false,
    vatExemptWording: false,
    kleinunternehmerWording: false,
    ossWording: false,
    isServiceLikely: true,
    descriptionText: null,
    userVatMethod: 'soll',
    ...overrides
  }
}

describe('isEuCountry', () => {
  it('accepts all 27 EU member states', () => {
    const members = [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
      'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
      'SI', 'ES', 'SE'
    ]
    for (const code of members) expect(isEuCountry(code), code).toBe(true)
  })

  it('rejects non-members', () => {
    for (const code of ['GB', 'CH', 'NO', 'US', 'SV', 'TR']) {
      expect(isEuCountry(code), code).toBe(false)
    }
  })

  it('is case-insensitive and knows the EL alias for Greece', () => {
    expect(isEuCountry('de')).toBe(true)
    expect(isEuCountry('EL')).toBe(true)
  })
})

describe('income: Kleinunternehmer', () => {
  it('classifies KU revenue with high confidence and no VAT', () => {
    const result = classifyVat(
      input({ userVatMethod: 'kleinunternehmer', recipientCountryCode: 'DE' })
    )
    expect(result.code).toBe('KLEINUNTERNEHMER')
    expect(result.confidence).toBe('high')
    expect(result.germanVatAmount).toBe(0)
    expect(result.requiresUserConfirmation).toBe(false)
    expect(result.legalBasis).toContain('§ 19')
  })

  it('flags a KU invoice that nevertheless shows VAT', () => {
    const result = classifyVat(
      input({
        userVatMethod: 'kleinunternehmer',
        netAmount: 100,
        vatAmount: 19,
        grossAmount: 119
      })
    )
    expect(result.code).toBe('KLEINUNTERNEHMER')
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.unresolvedQuestions.length).toBeGreaterThan(0)
    expect(result.unresolvedQuestions.join(' ')).toContain('14c')
  })
})

describe('income: domestic', () => {
  it('classifies 19 % VAT to a German recipient as DE_DOMESTIC_19 (high)', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'DE',
        netAmount: 1000,
        vatAmount: 190,
        grossAmount: 1190
      })
    )
    expect(result.code).toBe('DE_DOMESTIC_19')
    expect(result.confidence).toBe('high')
    expect(result.requiresUserConfirmation).toBe(false)
    expect(result.germanVatRate).toBe(19)
    expect(result.germanVatAmount).toBe(190)
    expect(result.legalBasis).toBe('§ 12 Abs. 1 UStG')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('classifies 7 % via rate lines as DE_DOMESTIC_7', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'DE',
        vatRates: [
          { rate: 7, netAmountOriginal: 200, vatAmountOriginal: 14, grossAmountOriginal: 214 }
        ],
        netAmount: 200,
        vatAmount: 14,
        grossAmount: 214
      })
    )
    expect(result.code).toBe('DE_DOMESTIC_7')
    expect(result.confidence).toBe('high')
    expect(result.legalBasis).toBe('§ 12 Abs. 2 UStG')
  })

  it('downgrades to medium when the recipient country is only inferred', () => {
    const result = classifyVat(
      input({ recipientCountryCode: null, netAmount: 1000, vatAmount: 190 })
    )
    expect(result.code).toBe('DE_DOMESTIC_19')
    expect(result.confidence).toBe('medium')
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.unresolvedQuestions.join(' ')).toMatch(/country/i)
  })

  it('downgrades when the VAT amount is implausible for the rate line', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'DE',
        vatRates: [
          { rate: 19, netAmountOriginal: 1000, vatAmountOriginal: 150, grossAmountOriginal: 1150 }
        ],
        netAmount: 1000,
        vatAmount: 150
      })
    )
    expect(result.code).toBe('DE_DOMESTIC_19')
    expect(result.confidence).toBe('medium')
    expect(result.requiresUserConfirmation).toBe(true)
  })

  it('flags mixed 19 %/7 % documents for confirmation', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'DE',
        vatRates: [
          { rate: 19, netAmountOriginal: 100, vatAmountOriginal: 19, grossAmountOriginal: 119 },
          { rate: 7, netAmountOriginal: 300, vatAmountOriginal: 21, grossAmountOriginal: 321 }
        ],
        netAmount: 400,
        vatAmount: 40
      })
    )
    expect(result.code).toBe('DE_DOMESTIC_7') // dominant net share
    expect(result.confidence).toBe('medium')
    expect(result.requiresUserConfirmation).toBe(true)
  })

  it('requires an exemption reason for domestic zero-VAT invoices', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'DE',
        vatExemptWording: true,
        netAmount: 500,
        vatAmount: 0,
        grossAmount: 500
      })
    )
    expect(result.code).toBe('DE_DOMESTIC_0_EXEMPT')
    expect(result.confidence).toBe('low')
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.germanVatRate).toBe(0)
    expect(result.unresolvedQuestions.join(' ')).toContain('§ 4')
  })

  it('reports conflicting exemption wording + charged VAT as UNKNOWN_REVIEW', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'DE',
        vatExemptWording: true,
        netAmount: 1000,
        vatAmount: 190
      })
    )
    expect(result.code).toBe('UNKNOWN_REVIEW')
    expect(result.confidence).toBe('low')
    expect(result.requiresUserConfirmation).toBe(true)
  })
})

describe('income: EU B2B reverse charge', () => {
  it('is high confidence with recipient VAT id, service and no VAT', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'NL',
        recipientVatId: 'NL123456789B01',
        recipientName: 'Voorbeeld B.V.',
        netAmount: 2000,
        vatAmount: 0,
        reverseChargeWording: true
      })
    )
    expect(result.code).toBe('EU_B2B_REVERSE_CHARGE_REVENUE')
    expect(result.confidence).toBe('high')
    expect(result.requiresUserConfirmation).toBe(false)
    expect(result.germanVatAmount).toBe(0)
    expect(result.legalBasis).toContain('§ 3a Abs. 2 UStG')
    expect(result.legalBasis).toContain('Art. 196')
  })

  it('asks for the VAT id when only a legal form indicates a business', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'FR',
        recipientName: 'Exemple SARL',
        netAmount: 900,
        vatAmount: 0
      })
    )
    expect(result.code).toBe('EU_B2B_REVERSE_CHARGE_REVENUE')
    expect(result.confidence).toBe('medium')
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.unresolvedQuestions.join(' ')).toMatch(/VAT identification/i)
  })

  it('sends apparent EU consumer sales to review', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'AT',
        recipientName: 'Max Beispiel',
        netAmount: 100,
        vatAmount: 0
      })
    )
    expect(result.code).toBe('UNKNOWN_REVIEW')
    expect(result.confidence).toBe('low')
  })

  it('sends EU invoices with charged VAT to review', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'IT',
        recipientVatId: 'IT12345678901',
        netAmount: 100,
        vatAmount: 19
      })
    )
    expect(result.code).toBe('UNKNOWN_REVIEW')
  })
})

describe('income: third-country cascade', () => {
  it('clean case: confirmed business + service + no special rule → high, no confirmation', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'US',
        recipientIsBusiness: true,
        recipientName: 'Example Corp.',
        descriptionText: 'Software development services',
        netAmount: 6000,
        vatAmount: 0
      })
    )
    expect(result.code).toBe('THIRD_COUNTRY_B2B_SERVICE')
    expect(result.confidence).toBe('high')
    expect(result.requiresUserConfirmation).toBe(false)
    expect(result.labelDe).toBe('Nicht im Inland steuerbar – Leistungsort im Drittland')
    expect(result.labelEn).toBe(
      'Not taxable in Germany – place of supply in a third country'
    )
    expect(result.legalBasis).toBe('§ 3a Abs. 2 UStG')
    expect(result.germanVatRate).toBeNull()
    expect(result.germanVatAmount).toBe(0)
  })

  it('unconfirmed business with legal-form evidence → medium + confirmation', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'SV',
        recipientIsBusiness: null,
        recipientName: 'Ejemplo S.A. de C.V.',
        descriptionText: 'Contractor fee - software development',
        netAmount: 6000
      })
    )
    expect(result.code).toBe('THIRD_COUNTRY_B2B_SERVICE')
    expect(result.confidence).toBe('medium')
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.unresolvedQuestions.join(' ')).toMatch(/business/i)
  })

  it('explicit consumer recipient → low confidence + confirmation', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'US',
        recipientIsBusiness: false,
        recipientName: 'Max Beispiel',
        netAmount: 50
      })
    )
    expect(result.code).toBe('THIRD_COUNTRY_B2B_SERVICE')
    expect(result.confidence).toBe('low')
    expect(result.requiresUserConfirmation).toBe(true)
  })

  it('special-rule keywords trigger precise questions', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'US',
        recipientIsBusiness: true,
        descriptionText: 'Conference admission and event organization in New York',
        netAmount: 1000
      })
    )
    expect(result.code).toBe('THIRD_COUNTRY_B2B_SERVICE')
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.confidence).toBe('medium')
    expect(result.unresolvedQuestions.join(' ')).toMatch(/event/i)
  })

  it('non-service supplies are flagged as possible goods exports', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'CH',
        recipientIsBusiness: true,
        isServiceLikely: false,
        netAmount: 400
      })
    )
    expect(result.code).toBe('THIRD_COUNTRY_B2B_SERVICE')
    expect(result.confidence).toBe('low')
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.unresolvedQuestions.join(' ')).toMatch(/goods/i)
  })

  it('VAT charged to a third-country recipient conflicts → UNKNOWN_REVIEW', () => {
    const result = classifyVat(
      input({
        recipientCountryCode: 'US',
        recipientIsBusiness: true,
        netAmount: 100,
        vatAmount: 19
      })
    )
    expect(result.code).toBe('UNKNOWN_REVIEW')
  })

  it('unknown recipient country without hints → UNKNOWN_REVIEW', () => {
    const result = classifyVat(input({ netAmount: 100, vatAmount: 0 }))
    expect(result.code).toBe('UNKNOWN_REVIEW')
    expect(result.unresolvedQuestions.join(' ')).toMatch(/country/i)
  })
})

describe('expense: domestic input VAT', () => {
  it('German VAT + German issuer VAT id → DE_EXPENSE_INPUT_VAT high', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        issuerCountryCode: 'DE',
        issuerVatId: 'DE211045709',
        netAmount: 100,
        vatAmount: 19,
        grossAmount: 119
      })
    )
    expect(result.code).toBe('DE_EXPENSE_INPUT_VAT')
    expect(result.confidence).toBe('high')
    expect(result.requiresUserConfirmation).toBe(false)
    expect(result.germanVatRate).toBe(19)
    expect(result.germanVatAmount).toBe(19)
    expect(result.legalBasis).toBe('§ 15 Abs. 1 UStG')
  })

  it('Kleinunternehmer users get DE_EXPENSE_NO_INPUT_VAT despite German VAT', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        userVatMethod: 'kleinunternehmer',
        issuerCountryCode: 'DE',
        issuerVatId: 'DE211045709',
        netAmount: 100,
        vatAmount: 19
      })
    )
    expect(result.code).toBe('DE_EXPENSE_NO_INPUT_VAT')
    expect(result.confidence).toBe('high')
    expect(result.germanVatAmount).toBe(0)
    expect(result.reasons.join(' ')).toMatch(/Kleinunternehmer/)
  })

  it('OSS-registered supplier ("EU…") makes the deduction doubtful', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        issuerCountryCode: 'US',
        issuerVatId: 'EU372041333',
        ossWording: true,
        netAmount: 50,
        vatAmount: 9.5,
        grossAmount: 59.5
      })
    )
    expect(result.code).toBe('DE_EXPENSE_INPUT_VAT')
    expect(result.confidence).toBe('medium')
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.reasons.join(' ')).toMatch(/One-Stop-Shop|OSS/)
  })

  it('foreign (non-DE, non-EU-prefix) registration also triggers doubt', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        issuerCountryCode: 'IE',
        issuerVatId: 'IE6388047V',
        netAmount: 100,
        vatAmount: 19
      })
    )
    expect(result.code).toBe('DE_EXPENSE_INPUT_VAT')
    expect(result.confidence).toBe('medium')
    expect(result.requiresUserConfirmation).toBe(true)
  })
})

describe('expense: § 13b reverse charge', () => {
  it('EU supplier with Article 196 wording and EU VAT id → high confidence', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        issuerCountryCode: 'IE',
        issuerVatId: 'IE6388047V',
        reverseChargeWording: true,
        netAmount: 100,
        vatAmount: 0,
        grossAmount: 100
      })
    )
    expect(result.code).toBe('EXPENSE_REVERSE_CHARGE_13B')
    expect(result.confidence).toBe('high')
    expect(result.requiresUserConfirmation).toBe(false)
    expect(result.germanVatRate).toBe(19)
    expect(result.germanVatAmount).toBe(19)
    expect(result.legalBasis).toBe('§ 13b UStG')
    expect(result.reasons.join(' ')).toMatch(/deductible/i)
  })

  it('non-EU supplier without wording → medium + confirmation', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        issuerCountryCode: 'US',
        issuerVatId: null,
        netAmount: 200,
        vatAmount: null,
        grossAmount: 200
      })
    )
    expect(result.code).toBe('EXPENSE_REVERSE_CHARGE_13B')
    expect(result.confidence).toBe('medium')
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.germanVatAmount).toBe(38)
    expect(result.unresolvedQuestions.length).toBeGreaterThan(0)
  })

  it('still applies to Kleinunternehmer — flagged, VAT owed without deduction', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        userVatMethod: 'kleinunternehmer',
        issuerCountryCode: 'IE',
        issuerVatId: 'IE6388047V',
        reverseChargeWording: true,
        netAmount: 100,
        vatAmount: 0
      })
    )
    expect(result.code).toBe('EXPENSE_REVERSE_CHARGE_13B')
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.reasons.join(' ')).toMatch(/Kleinunternehmer/)
    expect(result.reasons.join(' ')).toMatch(/without .*deduction/i)
  })
})

describe('expense: no input VAT / unclear', () => {
  it('supplier invoking § 19 UStG → DE_EXPENSE_NO_INPUT_VAT', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        issuerCountryCode: 'DE',
        kleinunternehmerWording: true,
        netAmount: 80,
        vatAmount: 0,
        grossAmount: 80
      })
    )
    expect(result.code).toBe('DE_EXPENSE_NO_INPUT_VAT')
    expect(result.confidence).toBe('high')
  })

  it('foreign VAT rate → DE_EXPENSE_NO_INPUT_VAT with refund-procedure hint', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        issuerCountryCode: 'AT',
        issuerVatId: 'ATU12345678',
        vatRates: [
          { rate: 20, netAmountOriginal: 100, vatAmountOriginal: 20, grossAmountOriginal: 120 }
        ],
        netAmount: 100,
        vatAmount: 20
      })
    )
    expect(result.code).toBe('DE_EXPENSE_NO_INPUT_VAT')
    expect(result.confidence).toBe('medium')
    expect(result.requiresUserConfirmation).toBe(true)
  })

  it('German supplier with explicit zero VAT → DE_EXPENSE_NO_INPUT_VAT medium', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        issuerCountryCode: 'DE',
        netAmount: 100,
        vatAmount: 0,
        grossAmount: 100
      })
    )
    expect(result.code).toBe('DE_EXPENSE_NO_INPUT_VAT')
    expect(result.requiresUserConfirmation).toBe(true)
  })

  it('goods from abroad → UNKNOWN_REVIEW', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        issuerCountryCode: 'CN',
        isServiceLikely: false,
        grossAmount: 300
      })
    )
    expect(result.code).toBe('UNKNOWN_REVIEW')
    expect(result.confidence).toBe('low')
  })

  it('small receipt without VAT info → UNKNOWN_REVIEW low', () => {
    const result = classifyVat(
      input({
        direction: 'expense',
        issuerCountryCode: null,
        grossAmount: 12.5
      })
    )
    expect(result.code).toBe('UNKNOWN_REVIEW')
    expect(result.confidence).toBe('low')
    expect(result.requiresUserConfirmation).toBe(true)
  })
})

describe('listVatTreatments', () => {
  it('returns a neutral catalog of all 10 codes', () => {
    const treatments = listVatTreatments()
    expect(treatments).toHaveLength(10)
    const codes = treatments.map((t) => t.code)
    const expected: VatTreatmentCode[] = [
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
    expect(new Set(codes)).toEqual(new Set(expected))
    for (const treatment of treatments) {
      expect(treatment.labelDe.length).toBeGreaterThan(0)
      expect(treatment.labelEn.length).toBeGreaterThan(0)
      expect(treatment.requiresUserConfirmation).toBe(false)
      expect(treatment.unresolvedQuestions).toEqual([])
    }
  })
})
