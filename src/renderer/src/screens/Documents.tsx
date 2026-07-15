import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentDirection, LlmStatus, ReviewStatus, TaxDocument } from '@shared/domain'
import { api, errorToKey } from '../lib/api'
import { emitDataChanged, useDataVersion } from '../lib/bus'
import { activeLanguage } from '../i18n'
import { formatIsoDate, todayIso } from '../lib/format'
import { usePeriod, yearOptions } from '../context/PeriodContext'
import { useRouter, type ClientDocFilter, type DocumentsPreset } from '../context/RouterContext'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { DocumentRow } from '../components/DocumentRow'
import { ConfirmDialog, Dialog } from '../components/Dialog'
import { VAT_TREATMENT_OPTIONS, treatmentLabelKey } from '../lib/vatTreatments'
import { Icon } from '../components/Icon'

const PAGE_SIZE = 100

interface Filters {
  search: string
  year: number | null
  quarter: 1 | 2 | 3 | 4 | null
  direction: DocumentDirection | ''
  reviewStatus: ReviewStatus | ''
  vatTreatmentCode: string
  includeDeleted: boolean
  clientFilter: ClientDocFilter | null
}

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

// Filters survive navigating into a document and back (module-level memory;
// intentionally reset only by a new preset or app restart).
const filterMemory: { filters: Filters | null; search: string } = {
  filters: null,
  search: ''
}

export function Documents({ preset }: { preset?: DocumentsPreset }): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const { year: periodYear, quarter: periodQuarter } = usePeriod()
  const { settings } = useSettings()
  const { push } = useRouter()
  const toast = useToast()
  const dataVersion = useDataVersion()

  const [filters, setFilters] = useState<Filters>(() =>
    !preset && filterMemory.filters
      ? filterMemory.filters
      : {
          search: preset?.search ?? '',
          year: periodYear,
          quarter: periodQuarter,
          direction: preset?.direction ?? '',
          reviewStatus: preset?.reviewStatus ?? '',
          vatTreatmentCode: '',
          includeDeleted: false,
          clientFilter: preset?.clientFilter ?? null
        }
  )
  const [docs, setDocs] = useState<TaxDocument[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [pickDateFor, setPickDateFor] = useState<string[] | null>(null)
  const [pickedDate, setPickedDate] = useState(todayIso())
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null)

  const [searchText, setSearchText] = useState(
    !preset && filterMemory.filters ? filterMemory.search : (preset?.search ?? '')
  )

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
    filterMemory.filters = filters
    filterMemory.search = searchText
  }, [filters, searchText])

  // A new preset (e.g. from global search or overview links) resets the filters.
  useEffect(() => {
    if (!preset) return
    setSearchText(preset.search ?? '')
    setFilters((f) => ({
      ...f,
      search: preset.search ?? '',
      direction: preset.direction ?? '',
      reviewStatus: preset.reviewStatus ?? '',
      clientFilter: preset.clientFilter ?? null
    }))
    setOffset(0)
  }, [preset])

  // Debounce typed search into the effective filter.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((f) => (f.search === searchText ? f : { ...f, search: searchText }))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchText])

  const fetchDocs = useCallback(
    async (nextOffset: number, append: boolean) => {
      try {
        const filter: Record<string, unknown> = {
          limit: filters.clientFilter ? 500 : PAGE_SIZE,
          offset: filters.clientFilter ? 0 : nextOffset
        }
        if (filters.search.trim() !== '') filter.search = filters.search.trim()
        if (filters.year !== null) filter.year = filters.year
        if (filters.quarter !== null) filter.quarter = filters.quarter
        if (filters.direction !== '') filter.direction = filters.direction
        if (filters.reviewStatus !== '') filter.reviewStatus = filters.reviewStatus
        if (filters.vatTreatmentCode !== '') filter.vatTreatmentCode = filters.vatTreatmentCode
        if (filters.includeDeleted) filter.includeDeleted = true
        const result = await api().listDocuments(filter)
        setDocs((current) => (append ? [...current, ...result.documents] : result.documents))
        setTotal(result.total)
      } catch (err) {
        toast.error(t(errorToKey(err)))
      }
    },
    [filters, toast, t]
  )

  useEffect(() => {
    setOffset(0)
    setSelection(new Set())
    void fetchDocs(0, false)
  }, [fetchDocs, dataVersion])

  const visibleDocs = useMemo(() => {
    let list = docs
    if (filters.clientFilter === 'payment_missing') list = list.filter(needsPaymentDate)
    if (filters.clientFilter === 'rate_missing') list = list.filter(needsExchangeRate)
    return list
  }, [docs, filters.clientFilter])

  const activeDocs = visibleDocs.filter((d) => d.deletedAt === null)
  const trashedDocs = visibleDocs.filter((d) => d.deletedAt !== null)

  const toggleSelect = (id: string): void => {
    setSelection((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = activeDocs.length > 0 && activeDocs.every((d) => selection.has(d.id))

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

  const set = <K extends keyof Filters>(key: K, value: Filters[K]): void => {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  return (
    <div className="content-inner">
      <h1 className="section-title">{t('documents.title')}</h1>
      <div className="toolbar">
        <input
          className="input"
          type="search"
          style={{ width: 200 }}
          placeholder={t('search.placeholder')}
          aria-label={t('search.aria')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <select
          className="select"
          aria-label={t('documents.filterYear')}
          value={filters.year ?? ''}
          onChange={(e) => set('year', e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">{t('common.all')}</option>
          {yearOptions(settings.defaultYear).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label={t('documents.filterQuarter')}
          value={filters.quarter ?? ''}
          onChange={(e) =>
            set('quarter', e.target.value === '' ? null : (Number(e.target.value) as 1 | 2 | 3 | 4))
          }
        >
          <option value="">{t('period.fullYear')}</option>
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={q}>
              {t('period.q', { n: q })}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label={t('documents.filterDirection')}
          value={filters.direction}
          onChange={(e) => set('direction', e.target.value as Filters['direction'])}
        >
          <option value="">{t('common.all')}</option>
          <option value="income">{t('direction.income_plural')}</option>
          <option value="expense">{t('direction.expense_plural')}</option>
        </select>
        <select
          className="select"
          aria-label={t('documents.filterStatus')}
          value={filters.reviewStatus}
          onChange={(e) => set('reviewStatus', e.target.value as Filters['reviewStatus'])}
        >
          <option value="">{t('common.all')}</option>
          {(['needs_review', 'confirmed', 'processing', 'failed'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`reviewStatus.${s}`)}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label={t('documents.filterTreatment')}
          value={filters.vatTreatmentCode}
          onChange={(e) => set('vatTreatmentCode', e.target.value)}
        >
          <option value="">{t('documents.filterTreatment')}</option>
          {VAT_TREATMENT_OPTIONS.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {t(treatmentLabelKey(opt.code))}
            </option>
          ))}
        </select>
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
        <label className="checkbox-row small muted" style={{ marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={filters.includeDeleted}
            onChange={(e) => set('includeDeleted', e.target.checked)}
          />
          {t('documents.showTrash')}
        </label>
      </div>

      {activeDocs.length === 0 && trashedDocs.length === 0 ? (
        <div className="card empty-state">{t('documents.empty')}</div>
      ) : (
        <>
          <div className="row small muted mb-16">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={allSelected}
                aria-label={t('documents.selectAll')}
                onChange={() =>
                  setSelection(allSelected ? new Set() : new Set(activeDocs.map((d) => d.id)))
                }
              />
              {t('documents.selectAll')}
            </label>
            <span>·</span>
            <span>{t('documents.total', { count: total })}</span>
          </div>
          <div className="card doc-list">
            {activeDocs.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                selectable
                selected={selection.has(doc.id)}
                onToggleSelect={toggleSelect}
                onOpen={(id) => push({ name: 'review', id })}
              />
            ))}
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
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      {selection.size > 0 ? (
        <div className="bulk-bar" role="toolbar" aria-label={t('documents.selected', { count: selection.size })}>
          <span className="small muted">{t('documents.selected', { count: selection.size })}</span>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() =>
              void runBulk(async () => {
                for (const id of ids) await api().confirmDocument(id)
              }, t('review.confirmedToast'))
            }
          >
            ✓ {t('documents.bulkConfirm')}
          </button>
          <span className="small muted">{t('documents.bulkPayment')}:</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              void runBulk(() => api().setPaymentDate({ ids, mode: 'date', date: todayIso() }))
            }
          >
            {t('documents.bulkPaymentToday')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void runBulk(() => api().setPaymentDate({ ids, mode: 'invoice_date' }))}
          >
            {t('documents.bulkPaymentInvoiceDate')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setPickDateFor(ids)}>
            {t('documents.bulkPaymentPick')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void runBulk(() => api().setPaymentDate({ ids, mode: 'not_paid' }))}
          >
            {t('documents.bulkPaymentNotPaid')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void runBulk(() => api().setDirection({ ids, direction: 'income' }))}
          >
            {t('documents.bulkMoveIncome')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void runBulk(() => api().setDirection({ ids, direction: 'expense' }))}
          >
            {t('documents.bulkMoveExpense')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              void runBulk(async () => {
                const res = await api().reExtractDocuments(ids)
                toast.success(
                  t('documents.reExtractDone', { updated: res.updated, skipped: res.skipped })
                )
              })
            }
          >
            {t('documents.bulkReExtract')}
          </button>
          {llmReady ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                void runBulk(async () => {
                  const res = await api().runLlmCheck(ids)
                  toast.success(
                    t('llm.bulkQueuedToast', { queued: res.queued, skipped: res.skipped })
                  )
                })
              }
            >
              {t('documents.bulkLlmCheck')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => setConfirmDeleteIds(ids)}
          >
            <Icon name="trash" size={13} /> {t('documents.bulkDelete')}
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

      {confirmDeleteIds ? (
        <ConfirmDialog
          title={t('documents.bulkDeleteConfirmTitle')}
          body={t('documents.bulkDeleteConfirmBody', { count: confirmDeleteIds.length })}
          danger
          confirmLabel={t('common.delete')}
          onCancel={() => setConfirmDeleteIds(null)}
          onConfirm={() => {
            const targets = confirmDeleteIds
            setConfirmDeleteIds(null)
            void runBulk(async () => {
              for (const id of targets) await api().deleteDocument(id, 'trash')
            }, t('review.deletedToast'))
          }}
        />
      ) : null}
    </div>
  )
}
