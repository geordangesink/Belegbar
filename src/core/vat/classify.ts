/**
 * Deterministic, versioned VAT classification engine (spec §12).
 * All VAT decision rules live here — never in UI or extraction code.
 */
import type {
  DocumentDirection,
  VatClassificationResult,
  VatRateLine
} from '../../shared/domain'

export const VAT_ENGINE_VERSION = '2026.1'

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

export function classifyVat(input: VatClassificationInput): VatClassificationResult {
  throw new Error('not implemented')
}

/** All codes with bilingual labels + legal basis, for the treatment picker. */
export function listVatTreatments(): VatClassificationResult[] {
  throw new Error('not implemented')
}

export function isEuCountry(countryCode: string): boolean {
  throw new Error('not implemented')
}
