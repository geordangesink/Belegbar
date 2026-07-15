import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter, type RouteName } from '../context/RouterContext'
import { PeriodSelector } from '../components/PeriodSelector'
import { Icon, type IconName } from '../components/Icon'
import { ImportPanel } from '../components/ImportPanel'
import { Overview } from '../screens/Overview'
import { Documents } from '../screens/Documents'
import { Review } from '../screens/review/Review'
import { Taxes } from '../screens/taxes/Taxes'
import { Settings } from '../screens/Settings'

const NAV: { name: RouteName & ('overview' | 'documents' | 'taxes' | 'settings'); icon: IconName }[] = [
  { name: 'overview', icon: 'overview' },
  { name: 'documents', icon: 'documents' },
  { name: 'taxes', icon: 'taxes' },
  { name: 'settings', icon: 'settings' }
]

export function Shell(): ReactNode {
  const { t } = useTranslation()
  const { route, go } = useRouter()
  const [search, setSearch] = useState('')

  const isReview = route.name === 'review'

  const content = (() => {
    switch (route.name) {
      case 'overview':
        return <Overview />
      case 'documents':
        return <Documents preset={route.preset} />
      case 'review':
        return <Review id={route.id} />
      case 'taxes':
        return <Taxes initialTab={route.tab} />
      case 'settings':
        return <Settings />
    }
  })()

  return (
    <div className="shell">
      <nav className="sidebar" aria-label={t('app.name')}>
        <div className="wordmark">
          <svg
            className="wordmark-glyph"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            {/* triangle sandwich from the top-front — three solid shapes, sharp */}
            <path d="M4.5 13.4 12 7l7.5 6.4H4.5Z" fill="currentColor" />
            <rect x="3.4" y="15" width="17.2" height="2" fill="currentColor" />
            <rect x="4.5" y="18.4" width="15" height="2.6" fill="currentColor" />
          </svg>
          Beleg<span>bar</span>
        </div>
        {NAV.map((item) => {
          const active =
            route.name === item.name || (item.name === 'documents' && route.name === 'review')
          return (
            <button
              key={item.name}
              type="button"
              className={`nav-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => go({ name: item.name })}
            >
              <Icon name={item.icon} />
              {t(`nav.${item.name}`)}
            </button>
          )
        })}
      </nav>
      <div className="main-col">
        <header className="topbar">
          <PeriodSelector />
          <span className="spacer" />
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              const query = search.trim()
              go({ name: 'documents', preset: query === '' ? undefined : { search: query } })
              setSearch('')
            }}
          >
            <input
              className="input"
              type="search"
              style={{ width: 220 }}
              placeholder={t('search.placeholder')}
              aria-label={t('search.aria')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
        </header>
        <main className="content" style={isReview ? { padding: 0, overflow: 'hidden' } : undefined}>
          {content}
        </main>
      </div>
      <ImportPanel />
    </div>
  )
}
