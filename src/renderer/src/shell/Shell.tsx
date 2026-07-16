import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter, type RouteName } from '../context/RouterContext'
import { PeriodSelector } from '../components/PeriodSelector'
import { Icon, type IconName } from '../components/Icon'
import { ImportPanel } from '../components/ImportPanel'
import { TourProvider } from '../tour/TourProvider'
import { Overview } from '../screens/Overview'
import { Documents } from '../screens/Documents'
import { Review } from '../screens/review/Review'
import { Taxes } from '../screens/taxes/Taxes'
import { Settings } from '../screens/Settings'
import appIconUrl from '../../../../build/icon.png'

const NAV: { name: RouteName & ('overview' | 'documents' | 'taxes' | 'settings'); icon: IconName }[] = [
  { name: 'overview', icon: 'overview' },
  { name: 'documents', icon: 'documents' },
  { name: 'taxes', icon: 'taxes' },
  { name: 'settings', icon: 'settings' }
]

export function Shell(): ReactNode {
  const { t } = useTranslation()
  const { route, routeEntryId, go } = useRouter()
  const [search, setSearch] = useState('')

  const isReview = route.name === 'review'
  const showPeriod = route.name === 'overview' || route.name === 'documents' || route.name === 'taxes'
  const showSearch = route.name === 'overview' || route.name === 'taxes'
  const routeKey = routeEntryId

  const content = (() => {
    switch (route.name) {
      case 'overview':
        return <Overview />
      case 'documents':
        return <Documents preset={route.preset} routeEntryId={routeEntryId} />
      case 'review':
        return <Review id={route.id} />
      case 'taxes':
        return <Taxes initialTab={route.tab} />
      case 'settings':
        return <Settings />
    }
  })()

  return (
    <TourProvider>
      <div className="shell">
        <nav className="sidebar" aria-label={t('app.name')}>
          <div className="sidebar-titlebar" aria-hidden="true" />
          <div className="sidebar-brand">
            <img className="wordmark-mark" src={appIconUrl} alt="" draggable={false} />
            <div className="wordmark">
              Beleg<span>bar</span>
            </div>
          </div>
          <div className="nav-list">
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
                  <span className="nav-icon">
                    <Icon name={item.icon} />
                  </span>
                  <span>{t(`nav.${item.name}`)}</span>
                </button>
              )
            })}
          </div>
          <div className="sidebar-footer">
            <div className="privacy-card">
              <span className="privacy-icon">
                <Icon name="lock" size={14} />
              </span>
              <span>
                <strong>{t('nav.privateTitle')}</strong>
                <small>{t('nav.privateBody')}</small>
              </span>
            </div>
          </div>
        </nav>
        <div className="main-col">
          <header className="topbar">
            {showPeriod ? (
              <div className="topbar-period">
                <PeriodSelector />
              </div>
            ) : null}
            <span className="spacer" />
            {showSearch ? (
              <form
                className="topbar-search"
                role="search"
                onSubmit={(e) => {
                  e.preventDefault()
                  const query = search.trim()
                  go({ name: 'documents', preset: query === '' ? undefined : { search: query } })
                  setSearch('')
                }}
              >
                <Icon name="search" size={15} />
                <input
                  type="search"
                  placeholder={t('search.placeholder')}
                  aria-label={t('search.aria')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </form>
            ) : null}
          </header>
          <main className="content" style={isReview ? { padding: 0, overflow: 'hidden' } : undefined}>
            <div key={routeKey} className={`screen-transition${isReview ? ' review-screen' : ''}`}>
              {content}
            </div>
          </main>
        </div>
        <ImportPanel />
      </div>
    </TourProvider>
  )
}
