import type {
  ExchangeRateProvider,
  ExchangeRateQuery,
  ExchangeRateResult
} from '../../core/currency/convert'

export interface ExchangeRateCache {
  findBmfMonthly(currency: string, date: string): ExchangeRateResult | null
  findEcbDaily(currency: string, date: string): ExchangeRateResult | null
}

export interface OfficialExchangeRateProviders {
  bmf: ExchangeRateProvider
  ecb: ExchangeRateProvider
}

export async function resolveOfficialExchangeRate(
  query: ExchangeRateQuery,
  cache: ExchangeRateCache,
  providers: OfficialExchangeRateProviders
): Promise<ExchangeRateResult | null> {
  const monthly = cache.findBmfMonthly(query.currency, query.date)
  if (monthly) return monthly

  const fetchedMonthly = await providers.bmf.getRate(query)
  if (fetchedMonthly) return fetchedMonthly

  const daily = cache.findEcbDaily(query.currency, query.date)
  if (daily) return daily

  return providers.ecb.getRate(query)
}
