import { beforeEach, describe, expect, it } from 'vitest'
import {
  documentsSessionState,
  rememberDocumentsSessionState,
  resetDocumentsSessionState
} from './documentsSession'

describe('documents session state', () => {
  beforeEach(resetDocumentsSessionState)

  it('carries every persistent list control into a new unpreset route', () => {
    const state = documentsSessionState(1)
    rememberDocumentsSessionState(1, {
      filters: {
        search: 'hosting',
        direction: 'expense',
        reviewStatus: 'needs_review',
        includeDeleted: true,
        clientFilter: 'rate_missing',
        sort: 'oldest'
      },
      searchText: 'hosting ltd',
      allPeriods: true,
      attentionLevels: ['minor', 'warning']
    })

    expect(state.filters.sort).toBe('newest')
    expect(documentsSessionState(2)).toEqual({
      filters: {
        search: 'hosting',
        direction: 'expense',
        reviewStatus: 'needs_review',
        includeDeleted: true,
        clientFilter: 'rate_missing',
        sort: 'oldest'
      },
      searchText: 'hosting ltd',
      allPeriods: true,
      attentionLevels: ['minor', 'warning']
    })
  })

  it('applies an external preset once for its route entry', () => {
    expect(
      documentsSessionState(10, { search: 'INV-7', direction: 'income' })
    ).toMatchObject({
      filters: { search: 'INV-7', direction: 'income', sort: 'newest' },
      searchText: 'INV-7'
    })

    const changed = documentsSessionState(10)
    changed.filters.search = 'edited'
    changed.searchText = 'edited'
    changed.attentionLevels = ['critical']
    rememberDocumentsSessionState(10, changed)

    expect(
      documentsSessionState(10, { search: 'INV-7', direction: 'income' })
    ).toMatchObject({
      filters: { search: 'edited', direction: 'income' },
      searchText: 'edited',
      attentionLevels: ['critical']
    })

    expect(
      documentsSessionState(11, { search: 'INV-7', direction: 'income' })
    ).toMatchObject({
      filters: {
        search: 'INV-7',
        direction: 'income',
        includeDeleted: false,
        clientFilter: null,
        sort: 'newest'
      },
      searchText: 'INV-7',
      allPeriods: false,
      attentionLevels: []
    })
  })
})
