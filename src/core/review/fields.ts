const FIELD_ALIASES: Readonly<Record<string, string>> = {
  currency: 'originalCurrency',
  netAmount: 'netAmountOriginal',
  vatAmount: 'vatAmountOriginal',
  grossAmount: 'grossAmountOriginal',
  vatTreatment: 'vatTreatmentCode'
}

const CONFIDENCE_KEYS: Readonly<Record<string, readonly string[]>> = {
  originalCurrency: ['originalCurrency', 'currency'],
  netAmountOriginal: ['netAmountOriginal', 'netAmount'],
  vatAmountOriginal: ['vatAmountOriginal', 'vatAmount'],
  grossAmountOriginal: ['grossAmountOriginal', 'grossAmount']
}

export function canonicalDocumentField(field: string): string {
  return FIELD_ALIASES[field] ?? field
}

export function confidenceKeysForField(field: string): readonly string[] {
  const canonical = canonicalDocumentField(field)
  return CONFIDENCE_KEYS[canonical] ?? [canonical]
}

export function confidenceForField(
  fieldConfidence: Readonly<Record<string, number>>,
  field: string
): number | undefined {
  let best: number | undefined
  for (const key of confidenceKeysForField(field)) {
    const confidence = fieldConfidence[key]
    if (typeof confidence === 'number' && (best === undefined || confidence > best)) {
      best = confidence
    }
  }
  return best
}
