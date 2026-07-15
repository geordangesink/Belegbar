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
            {/* triangle sandwich from the top-front — three solid shapes */}
            <path
              d="M5 12.6 11.5 7a.8.8 0 0 1 1 0l6.5 5.6a.5.5 0 0 1-.33.88H5.33A.5.5 0 0 1 5 12.6Z"
              fill="currentColor"
            />
            <rect x="3.4" y="14.7" width="17.2" height="2.1" rx="1.05" fill="currentColor" />
            <path
              d="M4.3 18h15.4v.4a2.2 2.2 0 0 1-2.2 2.2H6.5a2.2 2.2 0 0 1-2.2-2.2V18Z"
              fill="currentColor"
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
