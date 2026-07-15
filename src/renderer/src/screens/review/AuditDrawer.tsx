import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditEvent } from '@shared/domain'
import { api, errorToKey } from '../../lib/api'
import { activeLanguage } from '../../i18n'
import { formatIsoDateTime } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { Icon } from '../../components/Icon'

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    const json = JSON.stringify(value)
    return json.length > 120 ? `${json.slice(0, 117)}…` : json
  } catch {
    return '…'
  }
}

export function AuditDrawer({
  documentId,
  onClose
}: {
  documentId: string
  onClose: () => void
}): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const toast = useToast()
  const [events, setEvents] = useState<AuditEvent[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const trail = await api().getAuditTrail(documentId)
        if (!cancelled) setEvents(trail)
      } catch (err) {
        if (!cancelled) {
          toast.error(t(errorToKey(err)))
          setEvents([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [documentId, toast, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="drawer" aria-label={t('review.history')}>
      <div className="drawer-header">
        <span>
          <Icon name="history" size={14} /> {t('review.history')}
        </span>
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="drawer-body">
        {events === null ? (
          <p className="muted">{t('app.loading')}</p>
        ) : events.length === 0 ? (
          <p className="muted">{t('review.historyEmpty')}</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className="audit-item">
              <div style={{ fontWeight: 500 }}>
                {t(`audit.event.${event.eventType}`, {
                  defaultValue: event.eventType.replace(/_/g, ' ')
                })}
              </div>
              {event.previousValue !== null || event.nextValue !== null ? (
                <div className="small muted">
                  {describeValue(event.previousValue)} → {describeValue(event.nextValue)}
                </div>
              ) : null}
              <div className="small muted">
                {formatIsoDateTime(event.createdAt, lang)} ·{' '}
                {event.source === 'user' ? t('audit.user') : t('audit.system')}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
