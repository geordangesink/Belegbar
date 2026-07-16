import type {
  AttentionLevel,
  DocumentDirection,
  DocumentSort,
  ReviewStatus
} from '@shared/domain'
import type { ClientDocFilter, DocumentsPreset } from '../context/RouterContext'

export interface DocumentsFilters {
  search: string
  direction: DocumentDirection | ''
  reviewStatus: ReviewStatus | ''
  includeDeleted: boolean
  clientFilter: ClientDocFilter | null
  sort: DocumentSort
}

export interface DocumentsSessionState {
  filters: DocumentsFilters
  searchText: string
  allPeriods: boolean
  attentionLevels: AttentionLevel[]
}

const states = new Map<number, DocumentsSessionState>()
let latest: DocumentsSessionState | null = null

function clone(state: DocumentsSessionState): DocumentsSessionState {
  return {
    filters: { ...state.filters },
    searchText: state.searchText,
    allPeriods: state.allPeriods,
    attentionLevels: [...state.attentionLevels]
  }
}

function fromPreset(preset?: DocumentsPreset): DocumentsSessionState {
  return {
    filters: {
      search: preset?.search ?? '',
      direction: preset?.direction ?? '',
      reviewStatus: preset?.reviewStatus ?? '',
      includeDeleted: false,
      clientFilter: preset?.clientFilter ?? null,
      sort: 'newest'
    },
    searchText: preset?.search ?? '',
    allPeriods: false,
    attentionLevels: []
  }
}

export function documentsSessionState(
  routeEntryId: number,
  preset?: DocumentsPreset
): DocumentsSessionState {
  const stored = states.get(routeEntryId)
  if (stored) return clone(stored)

  const initial = preset ? fromPreset(preset) : latest ? clone(latest) : fromPreset()
  states.set(routeEntryId, clone(initial))
  latest = clone(initial)
  return initial
}

export function rememberDocumentsSessionState(
  routeEntryId: number,
  state: DocumentsSessionState
): void {
  const next = clone(state)
  states.set(routeEntryId, next)
  latest = clone(next)
}

export function resetDocumentsSessionState(): void {
  states.clear()
  latest = null
}
