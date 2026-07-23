import { describe, expect, it } from 'vitest'
import { createOverviewChartScale } from './overview-chart'

describe('createOverviewChartScale', () => {
  it('uses one shared scale for both series', () => {
    const scale = createOverviewChartScale([
      { month: 1, revenueEur: 100, expensesEur: 25 },
      { month: 2, revenueEur: 50, expensesEur: 0 }
    ])

    expect(scale.empty).toBe(false)
    expect(scale.zeroPercent).toBe(0)
    expect(scale.geometry(100).heightPercent).toBe(100)
    expect(scale.geometry(25).heightPercent).toBe(25)
  })

  it('places negative values below a shared zero line', () => {
    const scale = createOverviewChartScale([
      { month: 1, revenueEur: 100, expensesEur: -50 }
    ])

    expect(scale.zeroPercent).toBeCloseTo(100 / 3)
    expect(scale.geometry(100).bottomPercent).toBeCloseTo(100 / 3)
    expect(scale.geometry(100).heightPercent).toBeCloseTo(200 / 3)
    expect(scale.geometry(100).negative).toBe(false)
    expect(scale.geometry(-50).bottomPercent).toBeCloseTo(0)
    expect(scale.geometry(-50).heightPercent).toBeCloseTo(100 / 3)
    expect(scale.geometry(-50).negative).toBe(true)
  })

  it('returns a stable empty scale for all-zero data', () => {
    const scale = createOverviewChartScale([
      { month: 1, revenueEur: 0, expensesEur: 0 }
    ])

    expect(scale.empty).toBe(true)
    expect(scale.zeroPercent).toBe(0)
    expect(scale.geometry(0).heightPercent).toBe(0)
  })
})
