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
            {/* triangle sandwich seen from the top-front, monochrome */}
            <path
              d="M4.6 12.2 12 6.9a.9.9 0 0 1 1 0l6.4 5.3a.55.55 0 0 1-.35.97H4.95a.55.55 0 0 1-.35-.97Z"
              fill="currentColor"
            />
            <rect x="3.9" y="14.2" width="16.2" height="2" rx="1" fill="currentColor" opacity="0.55" />
            <rect x="3" y="17" width="18" height="1.6" rx="0.8" fill="currentColor" />
            <path
              d="M3.9 19.4h16.2v.1a1.9 1.9 0 0 1-1.9 1.9H5.8a1.9 1.9 0 0 1-1.9-1.9v-.1Z"
              fill="currentColor"
              opacity="0.55"
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
