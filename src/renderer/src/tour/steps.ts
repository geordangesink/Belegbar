/**
 * Guided tour — stop definitions.
 *
 * Each stop points at an element carrying a matching `data-tour` attribute.
 * The engine navigates via the router first, then measures the element.
 * Missing targets are tolerated: the stop is skipped silently.
 */
import type { Route } from '../context/RouterContext'

export type TourDepth = 'minimum' | 'medium' | 'full'

export interface TourStepDef {
  /** step id; texts live under tour.steps.<id>.title / .body */
  id: string
  /** smallest tour depth that includes this stop */
  tier: TourDepth
  /** data-tour attribute value of the target element */
  target: string
  /** navigate here before measuring (static screens) */
  route?: Route
  /** stop lives on the review screen; the engine opens the most recent document */
  needsDocument?: boolean
}

const TIER_RANK: Record<TourDepth, number> = { minimum: 0, medium: 1, full: 2 }

/**
 * Master list in travel order. Filtering by depth preserves the order, so
 * minimum = 3 stops, medium = 6 stops, full = 10 stops.
 */
export const TOUR_STEPS: readonly TourStepDef[] = [
  { id: 'dropzones', tier: 'minimum', target: 'dropzones', route: { name: 'overview' } },
  { id: 'attention', tier: 'minimum', target: 'attention', route: { name: 'overview' } },
  { id: 'confirm', tier: 'minimum', target: 'confirm-flow', route: { name: 'documents' } },
  { id: 'taxesVat', tier: 'medium', target: 'taxes-vat', route: { name: 'taxes', tab: 'vat' } },
  {
    id: 'taxesIncome',
    tier: 'medium',
    target: 'taxes-income',
    route: { name: 'taxes', tab: 'income' }
  },
  { id: 'reviewSplit', tier: 'full', target: 'review-split', needsDocument: true },
  { id: 'reviewRecheck', tier: 'full', target: 'review-recheck', needsDocument: true },
  { id: 'paymentActions', tier: 'full', target: 'payment-actions', needsDocument: true },
  { id: 'settingsMethods', tier: 'medium', target: 'settings-methods', route: { name: 'settings' } },
  { id: 'settingsBackup', tier: 'full', target: 'settings-backup', route: { name: 'settings' } }
]

export function stepsForDepth(depth: TourDepth): TourStepDef[] {
  return TOUR_STEPS.filter((step) => TIER_RANK[step.tier] <= TIER_RANK[depth])
}
