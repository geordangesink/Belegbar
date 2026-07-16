import type { Route } from '../context/RouterContext'
import type { TourStepDef } from './steps'

function documentsPresetMatches(
  current: Extract<Route, { name: 'documents' }>['preset'],
  target: Extract<Route, { name: 'documents' }>['preset']
): boolean {
  if (!current || !target) return current === target
  return (
    current.search === target.search &&
    current.reviewStatus === target.reviewStatus &&
    current.direction === target.direction &&
    current.clientFilter === target.clientFilter
  )
}

export function tourRouteMatches(current: Route, target: Route): boolean {
  if (current.name !== target.name) return false

  switch (target.name) {
    case 'documents':
      return current.name === 'documents' && documentsPresetMatches(current.preset, target.preset)
    case 'review':
      return current.name === 'review' && current.id === target.id
    case 'taxes':
      return current.name === 'taxes' && (current.tab ?? 'vat') === (target.tab ?? 'vat')
    default:
      return true
  }
}

export function missingTargetShouldSkip(step: Pick<TourStepDef, 'needsDocument'>): boolean {
  return step.needsDocument === true
}
