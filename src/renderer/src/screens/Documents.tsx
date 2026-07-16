import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AttentionLevel,
  LlmStatus,
  TaxDocument
} from '@shared/domain'
import { attentionForDocument } from '@core/review/attention'
import { api, errorToKey } from '../lib/api'
import { emitDataChanged, useDataVersion } from '../lib/bus'
import { activeLanguage } from '../i18n'
import { formatIsoDate, todayIso } from '../lib/format'
import {
  documentsSessionState,
  rememberDocumentsSessionState,
  type DocumentsFilters
} from '../lib/documentsSession'
import { usePeriod } from '../context/PeriodContext'
import { useRouter, type DocumentsPreset } from '../context/RouterContext'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { AttentionBadge, ATTENTION_LEVELS } from '../components/AttentionBadge'
import { counterpartyName, DocumentRow } from '../components/DocumentRow'
import { ConfirmDialog, Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'

/** Choices of the select-by-kind menu next to the select-all checkbox. */
const SELECT_MENU_CHOICES = [
  'all',
  'confirmed',
  'ok',
  'minor',
  'warning',
  'critical',
  'none'
] as const
type SelectMenuChoice = (typeof SELECT_MENU_CHOICES)[number]

function selectChoiceMatches(choice: SelectMenuChoice, level: AttentionLevel): boolean {
  switch (choice) {
    case 'all':
      return true
    case 'confirmed':
      return level === 'confirmed'
    case 'ok':
      return level === 'ok'
    case 'minor':
      return level === 'minor'
    case 'warning':
      return level === 'warning'
    case 'critical':
      return level === 'critical'
    case 'none':
      return false
  }
}

const PAGE_SIZE = 100

function needsPaymentDate(doc: TaxDocument): boolean {
  return doc.paymentDate === null && doc.paymentStatus !== 'unpaid'
}

function needsExchangeRate(doc: TaxDocument): boolean {
  return (
    doc.originalCurrency !== null &&
    doc.originalCurrency !== 'EUR' &&
    doc.exchangeRateToEur === null
  )
}

export function Documents({
  preset,
  routeEntryId
}: {
  preset?: DocumentsPreset
  routeEntryId: number
}): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const { year: periodYear, quarter: periodQuarter, setQuarter } = usePeriod()
  const { settings } = useSettings()
  const { push } = useRouter()
  const toast = useToast()
  const dataVersion = useDataVersion()

  const [initialView] = useState(() => documentsSessionState(routeEntryId, preset))
  const [filters, setFilters] = useState<DocumentsFilters>(() => initialView.filters)
  // Local override: ignore the global period entirely ("alle Zeiträume").
  // Shown as a dismissible chip while active.
  const [allPeriods, setAllPeriods] = useState(initialView.allPeriods)
  const [docs, setDocs] = useState<TaxDocument[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // Whether any documents exist at all (ignoring filters) — drives the
  // friendlier "nothing in this period" empty state vs. the true empty state.
  const [hasAnyDocuments, setHasAnyDocuments] = useState<boolean | null>(null)
  const [offset, setOffset] = useState(0)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [pickDateFor, setPickDateFor] = useState<string[] | null>(null)
  const [pickedDate, setPickedDate] = useState(todayIso())
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null)
  const [confirmBulkIds, setConfirmBulkIds] = useState<string[] | null>(null)
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false)
  const [emptyingTrash, setEmptyingTrash] = useState(false)
  const [savingCopies, setSavingCopies] = useState(false)
  const [attentionFilter, setAttentionFilter] = useState<ReadonlySet<AttentionLevel>>(
    () => new Set(initialView.attentionLevels)
  )
  const selectAllRef = useRef<HTMLInputElement>(null)

  const [searchText, setSearchText] = useState(initialView.searchText)

  // Local LLM checker status — the bulk "KI-Check" action is only offered
  // when the feature is enabled and the model is ready.
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null)
  useEffect(() => {
    let mounted = true
    api()
      .getLlmStatus()
      .then((s) => {
        if (mounted) setLlmStatus(s)
      })
      .catch(() => {
        /* status unavailable → action stays hidden */
      })
    const off = api().onLlmProgress((s) => setLlmStatus(s))
    return () => {
      mounted = false
      off()
    }
  }, [])
  const llmReady = settings.llmCheckerEnabled && llmStatus?.state === 'ready'

  useEffect(() => {
    rememberDocumentsSessionState(routeEntryId, {
      filters,
      searchText,
      allPeriods,
      attentionLevels: [...attentionFilter]
    })
  }, [routeEntryId, filters, searchText, allPeriods, attentionFilter])

  // Debounce typed search into the effective filter.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((f) => (f.search === searchText ? f : { ...f, search: searchText }))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchText])

  const fetchDocs = useCallback(
    async (nextOffset: number, append: boolean) => {
      if (!append) setLoading(true)
      try {
        const filter: Record<string, unknown> = {
          limit: filters.clientFilter ? 500 : PAGE_SIZE,
          offset: filters.clientFilter ? 0 : nextOffset
        }
        if (filters.search.trim() !== '') filter.search = filters.search.trim()
        // The global topbar period drives the list — unless the local
        // "alle Zeiträume" override is active.
        if (!allPeriods) {
          filter.year = periodYear
          if (periodQuarter !== null) filter.quarter = periodQuarter
          filter.includeUnassigned = true
        }
        if (filters.direction !== '') filter.direction = filters.direction
        if (filters.reviewStatus !== '') filter.reviewStatus = filters.reviewStatus
        if (filters.includeDeleted) filter.includeDeleted = true
        filter.sort = filters.sort
        const result = await api().listDocuments(filter)
        setDocs((current) => (append ? [...current, ...result.documents] : result.documents))
        setTotal(result.total)
        if (result.total > 0) {
          setHasAnyDocuments(true)
        } else {
          const all = await api().listDocuments({ limit: 1 })
          setHasAnyDocuments(all.total > 0)
        }
      } catch (err) {
        toast.error(t(errorToKey(err)))
      } finally {
        if (!append) setLoading(false)
      }
    },
    [filters, allPeriods, periodYear, periodQuarter, toast, t]
  )

  useEffect(() => {
    setOffset(0)
    setSelection(new Set())
    void fetchDocs(0, false)
  }, [fetchDocs, dataVersion])

  // Trash is global rather than period-scoped, so keep its total independent
  // from the currently visible document query.
  const [trashCount, setTrashCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [withDeleted, activeOnly] = await Promise.all([
          api().listDocuments({ includeDeleted: true, limit: 1 }),
          api().listDocuments({ limit: 1 })
        ])
        if (!cancelled) setTrashCount(Math.max(0, withDeleted.total - activeOnly.total))
      } catch {
        if (!cancelled) setTrashCount(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dataVersion])

  // Empty-state escape hatch: switch the GLOBAL selector to the whole year;
  // if the current query is empty even for the whole year, fall back to
  // ignoring the period entirely (dismissible "alle Zeiträume" chip).
  const showAllYears = useCallback(async () => {
    setQuarter(null)
    try {
      const probe: Record<string, unknown> = {
        year: periodYear,
        includeUnassigned: true,
        limit: 1
      }
      if (filters.search.trim() !== '') probe.search = filters.search.trim()
      if (filters.direction !== '') probe.direction = filters.direction
      if (filters.reviewStatus !== '') probe.reviewStatus = filters.reviewStatus
      const yearProbe = await api().listDocuments(probe)
      if (yearProbe.total === 0) setAllPeriods(true)
    } catch (err) {
      toast.error(t(errorToKey(err)))
    }
  }, [filters, periodYear, setQuarter, toast, t])

  const visibleDocs = useMemo(() => {
    let list = docs
    if (filters.clientFilter === 'payment_missing') list = list.filter(needsPaymentDate)
    if (filters.clientFilter === 'rate_missing') list = list.filter(needsExchangeRate)
    return list
  }, [docs, filters.clientFilter])
  const documentCount = filters.clientFilter ? visibleDocs.length : total

  const activeDocs = useMemo(() => visibleDocs.filter((d) => d.deletedAt === null), [visibleDocs])
  const trashedDocs = visibleDocs.filter((d) => d.deletedAt !== null)

  // The ONE status language: attention level per document (identical to
  // every other surface), driving badge, filter chips and select menu.
  const levelOf = useMemo(() => {
    const map = new Map<string, AttentionLevel>()
    for (const d of visibleDocs) map.set(d.id, attentionForDocument(d))
    return map
  }, [visibleDocs])

  const attentionCounts = useMemo(() => {
    const counts: Record<AttentionLevel, number> = {
      confirmed: 0,
      ok: 0,
      minor: 0,
      warning: 0,
      critical: 0
    }
    for (const d of activeDocs) {
      const level = levelOf.get(d.id)
      if (level) counts[level] += 1
    }
    return counts
  }, [activeDocs, levelOf])

  const shownDocs = useMemo(
    () =>
      attentionFilter.size === 0
        ? activeDocs
        : activeDocs.filter((d) => {
            const level = levelOf.get(d.id)
            return level !== undefined && attentionFilter.has(level)
          }),
    [activeDocs, levelOf, attentionFilter]
  )

  const toggleAttentionFilter = (level: AttentionLevel): void => {
    setSelection(new Set())
    setAttentionFilter((s) => {
      const next = new Set(s)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  const applySelectMenu = (choice: SelectMenuChoice): void => {
    setSelection(
      new Set(
        shownDocs
          .filter((d) => {
            const level = levelOf.get(d.id)
            return level !== undefined && selectChoiceMatches(choice, level)
          })
          .map((d) => d.id)
      )
    )
  }

  const toggleSelect = (id: string): void => {
    setSelection((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = shownDocs.length > 0 && shownDocs.every((d) => selection.has(d.id))
  const partiallySelected = selection.size > 0 && !allSelected
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = partiallySelected
  }, [partiallySelected])

  const hasExplicitFilters =
    filters.search.trim() !== '' ||
    filters.direction !== '' ||
    filters.reviewStatus !== '' ||
    filters.clientFilter !== null

  const runBulk = async (fn: () => Promise<void>, successToast?: string): Promise<void> => {
    try {
      await fn()
      if (successToast) toast.success(successToast)
      setSelection(new Set())
      emitDataChanged()
    } catch (err) {
      toast.error(t(errorToKey(err)))
      emitDataChanged()
    }
  }

  const ids = [...selection]
  const selectionHasCritical = ids.some((id) => levelOf.get(id) === 'critical')

  const runBulkConfirm = (targets: string[]): void => {
    void runBulk(async () => {
      for (const id of targets) await api().confirmDocument(id)
    }, t('review.confirmedToast'))
  }

  // ok/minor selections confirm directly; selections containing potentially
  // tax-relevant problems (warning/critical) get an extra ConfirmDialog.
  const bulkConfirm = (): void => {
    if (selectionHasCritical) {
      toast.error(t('documents.bulkConfirmBlocked'))
      return
    }
    const hasTaxRelevant = ids.some((id) => {
      const level = levelOf.get(id)
      return level === 'warning'
    })
    if (hasTaxRelevant) setConfirmBulkIds(ids)
    else runBulkConfirm(ids)
  }

  const saveCopies = async (targets: string[]): Promise<void> => {
    if (savingCopies || targets.length === 0) return
    setSavingCopies(true)
    try {
      const result = await api().saveDocumentCopies(targets)
      if (result.canceled) return
      if (result.saved > 0) {
        toast.success(t('documents.copiesSavedToast', { count: result.saved }))
      }
      if (result.failed > 0) {
        toast.error(t('documents.copiesSavePartial', { count: result.failed }))
      }
    } catch (err) {
      toast.error(t(errorToKey(err)))
    } finally {
      setSavingCopies(false)
    }
  }

  const runBulkAction = (action: string): void => {
    switch (action) {
      case 'payment-today':
        void runBulk(() => api().setPaymentDate({ ids, mode: 'date', date: todayIso() }))
        break
      case 'payment-invoice':
        void runBulk(() => api().setPaymentDate({ ids, mode: 'invoice_date' }))
        break
      case 'payment-pick':
        setPickDateFor(ids)
        break
      case 'payment-unpaid':
        void runBulk(() => api().setPaymentDate({ ids, mode: 'not_paid' }))
        break
      case 'move-income':
        void runBulk(() => api().setDirection({ ids, direction: 'income' }))
        break
      case 'move-expense':
        void runBulk(() => api().setDirection({ ids, direction: 'expense' }))
        break
      case 're-extract':
        void runBulk(async () => {
          const res = await api().reExtractDocuments(ids)
          toast.success(t('documents.reExtractDone', { updated: res.updated, skipped: res.skipped }))
        })
        break
      case 'llm':
        void runBulk(async () => {
          const res = await api().runLlmCheck(ids)
          toast.success(t('llm.bulkQueuedToast', { queued: res.queued, skipped: res.skipped }))
        })
        break
    }
  }

  const deleteDocuments = async (targets: string[]): Promise<void> => {
    try {
      const result = await api().deleteDocuments(targets, 'trash')
      if (result.deleted > 0) {
        toast.success(t('documents.bulkDeletedToast', { count: result.deleted }))
      }
      if (result.failed > 0) {
        toast.error(t('documents.bulkDeletePartial', { count: result.failed }))
      }
    } catch (err) {
      toast.error(t(errorToKey(err)))
    } finally {
      setSelection(new Set())
      emitDataChanged()
    }
  }

  const emptyTrash = async (): Promise<void> => {
    if (emptyingTrash) return
    setEmptyingTrash(true)
    try {
      const result = await api().emptyTrash()
      if (result.deleted > 0) {
        toast.success(t('documents.trashEmptiedToast', { count: result.deleted }))
      }
      if (result.failed > 0) {
        toast.error(t('documents.emptyTrashPartial', { count: result.failed }))
      }
      if (result.failed === 0) {
        setFilters((current) => ({ ...current, includeDeleted: false }))
        setTrashCount(0)
      } else {
        setTrashCount((current) => Math.max(0, current - result.deleted))
      }
      setConfirmEmptyTrash(false)
      emitDataChanged()
    } catch (err) {
      toast.error(t(errorToKey(err)))
      emitDataChanged()
    } finally {
      setEmptyingTrash(false)
    }
  }

  const clearFilters = (): void => {
    setSearchText('')
    setFilters((current) => ({
      ...current,
      search: '',
      direction: '',
      reviewStatus: '',
      clientFilter: null
    }))
  }

  const set = <K extends keyof DocumentsFilters>(key: K, value: DocumentsFilters[K]): void => {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  return (
    <div className="content-inner documents-page" aria-busy={loading}>
      <header className="page-header">
        <h1>{t('documents.title')}</h1>
        {!loading ? (
          <span className="page-count num">{t('documents.total', { count: documentCount })}</span>
        ) : null}
      </header>
      <div className="toolbar filter-toolbar">
        <label className="filter-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            placeholder={t('search.placeholder')}
            aria-label={t('search.aria')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </label>
        <select
          className="select"
          aria-label={t('documents.filterDirection')}
          value={filters.direction}
          onChange={(e) => set('direction', e.target.value as DocumentsFilters['direction'])}
        >
          <option value="">{t('common.all')}</option>
          <option value="income">{t('direction.income_plural')}</option>
          <option value="expense">{t('direction.expense_plural')}</option>
        </select>
        <select
          className="select"
          aria-label={t('documents.sortLabel')}
          value={filters.sort}
          onChange={(e) => set('sort', e.target.value as DocumentsFilters['sort'])}
        >
          <option value="newest">{t('documents.sortNewest')}</option>
          <option value="oldest">{t('documents.sortOldest')}</option>
        </select>
        {filters.reviewStatus !== '' ? (
          <span className="chip chip-neutral">
            {t(`reviewStatus.${filters.reviewStatus}`)}
            <button
              type="button"
              className="icon-btn"
              style={{ width: 18, height: 18 }}
              aria-label={t('documents.clearFilter')}
              onClick={() => set('reviewStatus', '')}
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        ) : null}
        {allPeriods ? (
          <span className="chip chip-neutral">
            {t('documents.allPeriodsChip')}
            <button
              type="button"
              className="icon-btn"
              style={{ width: 18, height: 18 }}
              aria-label={t('documents.clearFilter')}
              onClick={() => setAllPeriods(false)}
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        ) : null}
        {filters.clientFilter ? (
          <span className="chip chip-warn">
            {filters.clientFilter === 'payment_missing'
              ? t('documents.clientFilterPayment')
              : t('documents.clientFilterRate')}
            <button
              type="button"
              className="icon-btn"
              style={{ width: 18, height: 18 }}
              aria-label={t('documents.clearFilter')}
              onClick={() => set('clientFilter', null)}
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        ) : null}
        {trashCount > 0 ? (
          <div className="trash-toolbar-actions">
            <label
              className="checkbox-row small muted trash-toolbar-toggle"
              aria-label={`${t('documents.showTrash')} (${trashCount})`}
            >
              <input
                type="checkbox"
                checked={filters.includeDeleted}
                onChange={(e) => set('includeDeleted', e.target.checked)}
              />
              <span>{t('documents.showTrash')}</span>
              <span className="trash-count num" aria-hidden="true">
                {trashCount}
              </span>
            </label>
            <button
              type="button"
              className="btn btn-sm trash-empty-button"
              disabled={emptyingTrash}
              onClick={() => setConfirmEmptyTrash(true)}
            >
              <Icon name="trash" size={13} />
              {t('documents.emptyTrash')}
            </button>
          </div>
        ) : null}
      </div>

      {loading && docs.length === 0 ? (
        <div
          className="card doc-list document-skeletons"
          role="status"
          aria-label={t('app.loading')}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="doc-row skeleton-row">
              <span className="skeleton-dot" />
              <span className="doc-main">
                <span className="skeleton-line medium" />
                <span className="skeleton-line short" />
              </span>
              <span className="skeleton-line amount" />
            </div>
          ))}
        </div>
      ) : activeDocs.length === 0 && trashedDocs.length === 0 ? (
        hasExplicitFilters ? (
          <div className="card empty-state rich-empty-state">
            <span className="empty-icon"><Icon name="search" size={20} /></span>
            <strong>{t('documents.noMatches')}</strong>
            <button type="button" className="btn mt-16" onClick={clearFilters}>
              {t('documents.clearFilters')}
            </button>
          </div>
        ) : !allPeriods && hasAnyDocuments === true ? (
          <div className="card empty-state rich-empty-state">
            <span className="empty-icon"><Icon name="search" size={20} /></span>
            <strong>{t('documents.emptyFiltered')}</strong>
            <button type="button" className="btn mt-16" onClick={() => void showAllYears()}>
              {t('documents.showAllYears')}
            </button>
          </div>
        ) : (
          <div className="card empty-state rich-empty-state">
            <span className="empty-icon"><Icon name="documents" size={20} /></span>
            <strong>{t('documents.emptyTitle')}</strong>
            <button type="button" className="btn btn-primary mt-16" onClick={() => push({ name: 'overview' })}>
              <Icon name="upload" size={14} /> {t('documents.addDocuments')}
            </button>
          </div>
        )
      ) : activeDocs.length === 0 ? null : (
        <>
          <div className="document-list-tools" data-tour="confirm-flow">
            <div className="row small attention-filters">
              {ATTENTION_LEVELS.filter((level) => attentionCounts[level] > 0).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`attn-chip${attentionFilter.has(level) ? ' active' : ''}`}
                  aria-pressed={attentionFilter.has(level)}
                  aria-label={`${t(`attention.label.${level}`)} (${attentionCounts[level]})`}
                  title={t(`attention.tooltip.${level}`)}
                  onClick={() => toggleAttentionFilter(level)}
                >
                  <AttentionBadge level={level} size={12} />
                  <span>{t(`attention.label.${level}`)}</span>
                  <span>{attentionCounts[level]}</span>
                </button>
              ))}
            </div>
            <div className="row small muted selection-tools">
              <label className="checkbox-row">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  aria-label={t('documents.selectAll')}
                  onChange={() =>
                    setSelection(allSelected ? new Set() : new Set(shownDocs.map((d) => d.id)))
                  }
                />
                {t('documents.selectAll')}
              </label>
              <select
                className="select"
                aria-label={t('documents.selectMenuLabel')}
                value=""
                onChange={(e) => {
                  const choice = e.target.value as SelectMenuChoice | ''
                  if (choice !== '') applySelectMenu(choice)
                }}
              >
                <option value="" disabled>
                  {t('documents.selectMenuLabel')}
                </option>
                <option value="all">{t('documents.selectMenuAll')}</option>
                <option value="confirmed">{t('documents.selectMenuConfirmed')}</option>
                <option value="ok">{t('documents.selectMenuOk')}</option>
                <option value="minor">{t('documents.selectMenuMinor')}</option>
                <option value="warning">{t('documents.selectMenuWarning')}</option>
                <option value="critical">{t('documents.selectMenuCritical')}</option>
                <option value="none">{t('documents.selectMenuNone')}</option>
              </select>
            </div>
          </div>
          <div className="card doc-list">
            {shownDocs.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                selectable
                selected={selection.has(doc.id)}
                onToggleSelect={toggleSelect}
                onOpen={(id) => push({ name: 'review', id })}
                trailing={
                  <span className="doc-row-actions">
                    <button
                      type="button"
                      className="icon-btn doc-row-action"
                      aria-label={`${t('common.edit')}: ${counterpartyName(doc)?.trim() || doc.storedFilename}`}
                      title={t('common.edit')}
                      onClick={(event) => {
                        event.stopPropagation()
                        push({ name: 'review', id: doc.id })
                      }}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn doc-row-action danger"
                      aria-label={`${t('common.delete')}: ${counterpartyName(doc)?.trim() || doc.storedFilename}`}
                      title={t('common.delete')}
                      onClick={(event) => {
                        event.stopPropagation()
                        setConfirmDeleteIds([doc.id])
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                }
              />
            ))}
            {shownDocs.length === 0 ? (
              <div className="empty-state filtered-empty">
                <strong>{t('documents.noAttentionMatches')}</strong>
                <button type="button" className="btn btn-sm" onClick={() => setAttentionFilter(new Set())}>
                  {t('documents.clearAttentionFilters')}
                </button>
              </div>
            ) : null}
          </div>
          {!filters.clientFilter && docs.length < total ? (
            <div className="row mt-16" style={{ justifyContent: 'center' }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const next = offset + PAGE_SIZE
                  setOffset(next)
                  void fetchDocs(next, true)
                }}
              >
                {t('common.loadMore')}
              </button>
            </div>
          ) : null}
        </>
      )}

      {filters.includeDeleted && trashedDocs.length > 0 ? (
        <section className="mt-32">
          <h2 className="section-title">{t('documents.trashTitle')}</h2>
          <div className="card doc-list">
            {trashedDocs.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                onOpen={(id) => push({ name: 'review', id })}
                trailing={
                  <span className="doc-row-actions">
                    <button
                      type="button"
                      className="icon-btn doc-row-action"
                      aria-label={`${t('documents.saveCopy')}: ${counterpartyName(doc)?.trim() || doc.storedFilename}`}
                      title={t('documents.saveCopy')}
                      disabled={savingCopies}
                      onClick={(event) => {
                        event.stopPropagation()
                        void saveCopies([doc.id])
                      }}
                    >
                      <Icon name="download" size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        void runBulk(
                          () => api().restoreDocument(doc.id),
                          t('review.restoredToast')
                        )
                      }}
                    >
                      <Icon name="restore" size={13} /> {t('common.restore')}
                    </button>
                  </span>
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      {selection.size > 0 ? (
        <div className="bulk-bar" role="toolbar" aria-label={t('documents.selected', { count: selection.size })}>
          <strong className="small">{t('documents.selected', { count: selection.size })}</strong>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={selectionHasCritical}
            title={selectionHasCritical ? t('documents.bulkConfirmBlocked') : undefined}
            onClick={bulkConfirm}
          >
            <Icon name="check" size={13} /> {t('documents.bulkConfirm')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={savingCopies}
            onClick={() => void saveCopies(ids)}
          >
            <Icon name="download" size={13} />
            {savingCopies
              ? t('documents.savingCopies')
              : selection.size === 1
                ? t('documents.saveCopy')
                : t('documents.saveCopies')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger bulk-delete-btn"
            onClick={() => setConfirmDeleteIds(ids)}
          >
            <Icon name="trash" size={13} /> {t('documents.bulkDelete')}
          </button>
          <select
            className="select bulk-actions-select"
            aria-label={t('documents.bulkActions')}
            value=""
            onChange={(event) => runBulkAction(event.target.value)}
          >
            <option value="" disabled>{t('documents.bulkActions')}</option>
            <optgroup label={t('documents.bulkPayment')}>
              <option value="payment-today">{t('documents.bulkPaymentToday')}</option>
              <option value="payment-invoice">{t('documents.bulkPaymentInvoiceDate')}</option>
              <option value="payment-pick">{t('documents.bulkPaymentPick')}</option>
              <option value="payment-unpaid">{t('documents.bulkPaymentNotPaid')}</option>
            </optgroup>
            <option value="move-income">{t('documents.bulkMoveIncome')}</option>
            <option value="move-expense">{t('documents.bulkMoveExpense')}</option>
            <option value="re-extract">{t('documents.bulkReExtract')}</option>
            {llmReady ? <option value="llm">{t('documents.bulkLlmCheck')}</option> : null}
          </select>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('common.close')}
            onClick={() => setSelection(new Set())}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}

      {pickDateFor ? (
        <Dialog
          title={t('documents.pickDateTitle')}
          onClose={() => setPickDateFor(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPickDateFor(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const targets = pickDateFor
                  setPickDateFor(null)
                  void runBulk(() =>
                    api().setPaymentDate({ ids: targets, mode: 'date', date: pickedDate })
                  )
                }}
              >
                {t('common.confirm')}
              </button>
            </>
          }
        >
          <input
            className="input"
            type="date"
            aria-label={t('review.paymentDate')}
            value={pickedDate}
            onChange={(e) => setPickedDate(e.target.value)}
          />
          <p className="small muted mt-8">{formatIsoDate(pickedDate, lang)}</p>
        </Dialog>
      ) : null}

      {confirmBulkIds ? (
        <ConfirmDialog
          title={t('documents.bulkConfirmWarningTitle')}
          body={t('documents.bulkConfirmWarningBody')}
          confirmLabel={t('documents.bulkConfirm')}
          onCancel={() => setConfirmBulkIds(null)}
          onConfirm={() => {
            const targets = confirmBulkIds
            setConfirmBulkIds(null)
            runBulkConfirm(targets)
          }}
        />
      ) : null}

      {confirmDeleteIds ? (
        <ConfirmDialog
          title={
            confirmDeleteIds.length === 1
              ? t('review.deleteTitle')
              : t('documents.bulkDeleteConfirmTitle')
          }
          body={
            confirmDeleteIds.length === 1
              ? t('review.deleteBody')
              : t('documents.bulkDeleteConfirmBody', { count: confirmDeleteIds.length })
          }
          danger
          confirmLabel={t('common.delete')}
          onCancel={() => setConfirmDeleteIds(null)}
          onConfirm={() => {
            const targets = confirmDeleteIds
            setConfirmDeleteIds(null)
            void deleteDocuments(targets)
          }}
        />
      ) : null}

      {confirmEmptyTrash ? (
        <Dialog
          title={t('documents.emptyTrashTitle')}
          onClose={() => {
            if (!emptyingTrash) setConfirmEmptyTrash(false)
          }}
          footer={
            <>
              <button
                type="button"
                className="btn"
                disabled={emptyingTrash}
                onClick={() => setConfirmEmptyTrash(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={emptyingTrash}
                onClick={() => void emptyTrash()}
              >
                <Icon name="trash" size={13} />
                {emptyingTrash
                  ? t('documents.emptyingTrash')
                  : t('documents.emptyTrash')}
              </button>
            </>
          }
        >
          <p>{t('documents.emptyTrashBody', { count: trashCount })}</p>
        </Dialog>
      ) : null}
    </div>
  )
}
