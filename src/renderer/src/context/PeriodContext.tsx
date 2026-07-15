import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { TaxPeriod } from '@shared/domain'
import { currentQuarter } from '../lib/format'

export type Quarter = 1 | 2 | 3 | 4

interface PeriodCtx {
  year: number
  /** null = whole year */
  quarter: Quarter | null
  period: TaxPeriod
  setYear(year: number): void
  setQuarter(quarter: Quarter | null): void
  setNow(): void
}

const Ctx = createContext<PeriodCtx | null>(null)

export function usePeriod(): PeriodCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePeriod outside PeriodProvider')
  return ctx
}

export function PeriodProvider({
  defaultYear,
  children
}: {
  defaultYear: number
  children: ReactNode
}): ReactNode {
  const [year, setYear] = useState(defaultYear)
  const [quarter, setQuarter] = useState<Quarter | null>(currentQuarter())

  const value = useMemo<PeriodCtx>(
    () => ({
      year,
      quarter,
      period: { year, quarter, month: null },
      setYear,
      setQuarter,
      setNow: () => {
        setYear(new Date().getFullYear())
        setQuarter(currentQuarter())
      }
    }),
    [year, quarter]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Year options for selectors: default year ±, plus current year. */
export function yearOptions(defaultYear: number): number[] {
  const now = new Date().getFullYear()
  const min = Math.min(defaultYear, now) - 3
  const max = Math.max(defaultYear, now) + 1
  const years: number[] = []
  for (let y = max; y >= min; y--) years.push(y)
  return years
}
