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
            {/* sandwich: top bun, lettuce wave, base */}
            <path
              d="M4 10c0-3.3 3.6-5 8-5s8 1.7 8 5v.5H4V10Z"
              fill="currentColor"
              opacity="0.9"
            />
            <path
              d="M3.5 13.5c1.4 0 1.4 1.6 2.8 1.6s1.4-1.6 2.8-1.6 1.4 1.6 2.8 1.6 1.4-1.6 2.8-1.6 1.4 1.6 2.8 1.6 1.4-1.6 2.9-1.6"
              stroke="var(--accent)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M4 17.5h16V18a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18v-.5Z"
              fill="currentColor"
              opacity="0.9"
            />
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
