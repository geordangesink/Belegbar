/**
 * Versioned German income-tax estimation engines (§32a EStG tariff).
 * One engine per supported tax year; selection by year with explicit
 * version labels. Everything here is an ESTIMATE — the UI must say so.
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

/** Returns the engine for a year, or the closest earlier engine marked as fallback. */
export function getIncomeTaxEngine(year: number): {
  engine: IncomeTaxEngine
  exactYearMatch: boolean
} {
  throw new Error('not implemented')
}

export function listSupportedTaxYears(): number[] {
  throw new Error('not implemented')
}
