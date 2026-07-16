/**
 * Static picker options for the ten VAT treatment codes (spec §12).
 * Labels/descriptions come from i18n (vat.treatment.* / vat.treatmentDesc.*);
 * the legal basis is a citation and stays identical in both languages.
 */
import type { DocumentDirection, VatTreatmentCode } from '@shared/domain'
import { isVatTreatmentApplicable } from '@core/vat/classify'

export interface VatTreatmentOption {
  code: VatTreatmentCode
  legalBasis: string | null
}

export const VAT_TREATMENT_OPTIONS: VatTreatmentOption[] = [
  { code: 'DE_DOMESTIC_19', legalBasis: '§ 1 Abs. 1 Nr. 1, § 12 Abs. 1 UStG' },
  { code: 'DE_DOMESTIC_7', legalBasis: '§ 12 Abs. 2 UStG' },
  { code: 'DE_DOMESTIC_0_EXEMPT', legalBasis: '§ 4 UStG' },
  { code: 'DE_EXPENSE_INPUT_VAT', legalBasis: '§ 15 UStG' },
  { code: 'DE_EXPENSE_NO_INPUT_VAT', legalBasis: '§ 15 UStG' },
  { code: 'EU_B2B_REVERSE_CHARGE_REVENUE', legalBasis: '§ 3a Abs. 2 UStG, Art. 196 MwStSystRL' },
  { code: 'THIRD_COUNTRY_B2B_SERVICE', legalBasis: '§ 3a Abs. 2 UStG' },
  { code: 'EXPENSE_REVERSE_CHARGE_13B', legalBasis: '§ 13b UStG' },
  { code: 'KLEINUNTERNEHMER', legalBasis: '§ 19 UStG' },
  { code: 'UNKNOWN_REVIEW', legalBasis: null }
]

export function vatTreatmentOptionsForDirection(
  direction: DocumentDirection,
  suggestedCode?: string | null
): VatTreatmentOption[] {
  const options = VAT_TREATMENT_OPTIONS.filter(({ code }) =>
    isVatTreatmentApplicable(direction, code)
  )
  if (!suggestedCode) return options
  const suggested = options.find(({ code }) => code === suggestedCode)
  return suggested
    ? [suggested, ...options.filter(({ code }) => code !== suggested.code)]
    : options
}

export function treatmentLabelKey(code: string): string {
  return `vat.treatment.${code}`
}

export function treatmentDescKey(code: string): string {
  return `vat.treatmentDesc.${code}`
}
