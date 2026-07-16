import { describe, expect, it } from 'vitest'
import { missingTargetShouldSkip, tourRouteMatches } from './navigation'

describe('tourRouteMatches', () => {
  it('matches static routes without re-navigating', () => {
    expect(tourRouteMatches({ name: 'overview' }, { name: 'overview' })).toBe(true)
    expect(tourRouteMatches({ name: 'settings' }, { name: 'settings' })).toBe(true)
    expect(tourRouteMatches({ name: 'overview' }, { name: 'documents' })).toBe(false)
  })

  it('clears a documents preset before resolving a tour target', () => {
    expect(tourRouteMatches({ name: 'documents' }, { name: 'documents' })).toBe(true)
    expect(
      tourRouteMatches(
        { name: 'documents', preset: { reviewStatus: 'needs_review' } },
        { name: 'documents' }
      )
    ).toBe(false)
  })

  it('treats the default tax tab as VAT and distinguishes income', () => {
    expect(tourRouteMatches({ name: 'taxes' }, { name: 'taxes', tab: 'vat' })).toBe(true)
    expect(tourRouteMatches({ name: 'taxes', tab: 'vat' }, { name: 'taxes' })).toBe(true)
    expect(tourRouteMatches({ name: 'taxes', tab: 'vat' }, { name: 'taxes', tab: 'income' })).toBe(
      false
    )
  })

  it('matches review routes by document id', () => {
    expect(tourRouteMatches({ name: 'review', id: 'a' }, { name: 'review', id: 'a' })).toBe(true)
    expect(tourRouteMatches({ name: 'review', id: 'a' }, { name: 'review', id: 'b' })).toBe(false)
  })
})

describe('missingTargetShouldSkip', () => {
  it('keeps static conditional stops visible without an anchor', () => {
    expect(missingTargetShouldSkip({})).toBe(false)
  })

  it('skips document-only stops when their document UI is unavailable', () => {
    expect(missingTargetShouldSkip({ needsDocument: true })).toBe(true)
  })
})
