import type { OverviewMonthSummary } from '@shared/domain'

export interface BarGeometry {
  bottomPercent: number
  heightPercent: number
  negative: boolean
}

export interface OverviewChartScale {
  empty: boolean
  zeroPercent: number
  geometry(value: number): BarGeometry
}

export function createOverviewChartScale(
  months: readonly OverviewMonthSummary[]
): OverviewChartScale {
  const values = months.flatMap((month) => [month.revenueEur, month.expensesEur])
  const positiveMax = Math.max(0, ...values)
  const negativeMax = Math.max(0, ...values.map((value) => -value))
  const span = positiveMax + negativeMax
  const zeroPercent = span === 0 ? 0 : (negativeMax / span) * 100

  return {
    empty: span === 0,
    zeroPercent,
    geometry(value) {
      if (span === 0 || value === 0) {
        return { bottomPercent: zeroPercent, heightPercent: 0, negative: value < 0 }
      }
      const heightPercent = Math.max(1.5, (Math.abs(value) / span) * 100)
      return {
        bottomPercent: value < 0 ? zeroPercent - heightPercent : zeroPercent,
        heightPercent,
        negative: value < 0
      }
    }
  }
}
