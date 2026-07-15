import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GERMAN_FEDERAL_STATES, type AppSettings, type LlmStatus } from '@shared/domain'
import type { UpdateSettingsPayload } from '@shared/ipc'
import { api, errorToKey } from '../lib/api'
import { bytesToMb, llmReasonKey } from '../lib/llm'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { usePeriod, yearOptions } from '../context/PeriodContext'
import { ConfirmDialog } from '../components/Dialog'
import { MoneyInput } from '../components/MoneyInput'
import { useTour } from '../tour/TourProvider'
import type { TourDepth } from '../tour/steps'

function Row({
  label,
  desc,
  children,
  dataTour
}: {
  label: string
  desc?: string
  children: ReactNode
  /** anchor for the guided tour spotlight */
  dataTour?: string
}): ReactNode {
  return (
    <div className="settings-row" data-tour={dataTour}>
      <div className="sr-text">
        <div className="sr-label">{label}</div>
        {desc ? <div className="sr-desc">{desc}</div> : null}
      </div>
      <div className="sr-control">{children}</div>
    </div>
  )
}

function TextRow({
  label,
  desc,
  value,
  onCommit,
  textarea
}: {
  label: string
  desc?: string
  value: string
  onCommit: (v: string) => void
  textarea?: boolean
}): ReactNode {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = (): void => {
    if (text !== value) onCommit(text)
  }
  return (
    <Row label={label} desc={desc}>
      {textarea ? (
        <textarea
          className="textarea"
          style={{ width: 260 }}
          rows={2}
          aria-label={label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          className="input"
          style={{ width: 260 }}
          aria-label={label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
      )}
    </Row>
  )
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): ReactNode {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  )
}

/**
 * "KI-Doppelcheck (lokal)" — opt-in local LLM double-check of extracted
 * fields. Status-driven: download → progress → toggle/remove; degrades to a
 * neutral explanation when the device is unsupported.
 */
function LlmSection(): ReactNode {
  const { t } = useTranslation()
  const { settings, update } = useSettings()
  const toast = useToast()

  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    api()
      .getLlmStatus()
      .then((s) => {
        if (mounted) setStatus(s)
      })
      .catch(() => {
        /* status stays null → section shows loading only */
      })
    const off = api().onLlmProgress((s) => setStatus(s))
    return () => {
      mounted = false
      off()
    }
  }, [])

  const toggleEnabled = (v: boolean): void => {
    void update({ llmCheckerEnabled: v })
      .then(() => toast.success(t('settings.savedToast')))
      .catch((err: unknown) => toast.error(t(errorToKey(err))))
  }

  const download = async (): Promise<void> => {
    setBusy(true)
    try {
      await api().downloadLlmModel()
    } catch (err) {
      toast.error(t(errorToKey(err)))
    } finally {
      setBusy(false)
    }
  }

  const cancelDownload = async (): Promise<void> => {
    try {
      await api().cancelLlmDownload()
    } catch (err) {
      toast.error(t(errorToKey(err)))
    }
  }

  const removeModel = async (): Promise<void> => {
    setBusy(true)
    try {
      await api().removeLlmModel()
      if (settings.llmCheckerEnabled) await update({ llmCheckerEnabled: false })
      toast.success(t('settings.llmRemovedToast'))
      try {
        setStatus(await api().getLlmStatus())
      } catch {
        /* progress events keep the status current */
      }
    } catch (err) {
      toast.error(t(errorToKey(err)))
    } finally {
      setBusy(false)
    }
  }

  const percent =
    status && status.totalBytes > 0
      ? Math.round(Math.min(1, Math.max(0, status.downloadedBytes / status.totalBytes)) * 100)
      : null

  return (
    <section className="settings-group">
      <h2 className="section-title">{t('settings.llmGroup')}</h2>
      <div className="card">
        <div className="settings-row">
          <div className="sr-text">
            <div className="sr-desc">{t('settings.llmIntro')}</div>
          </div>
        </div>
        {status === null ? (
          <Row label={t('app.loading')}>
            <span />
          </Row>
        ) : status.state === 'not_downloaded' ? (
          <Row label={t('settings.llmModelLabel')} desc={t('settings.llmNotDownloadedDesc')}>
            <button type="button" className="btn" disabled={busy} onClick={() => void download()}>
              {t('settings.llmDownload')}
            </button>
          </Row>
        ) : status.state === 'downloading' ? (
          <Row
            label={t('settings.llmDownloading')}
            desc={t('settings.llmProgress', {
              done: bytesToMb(status.downloadedBytes),
              total: bytesToMb(status.totalBytes)
            })}
          >
            <div className="progress-track" style={{ width: 140 }} aria-hidden="true">
              {percent === null ? (
                <div className="progress-fill indeterminate" />
              ) : (
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              )}
            </div>
            <button type="button" className="btn" onClick={() => void cancelDownload()}>
              {t('common.cancel')}
            </button>
          </Row>
        ) : status.state === 'ready' ? (
          <>
            <Row label={t('settings.llmEnable')} desc={t('settings.llmEnableDesc')}>
              <Toggle
                checked={settings.llmCheckerEnabled}
                label={t('settings.llmEnable')}
                onChange={toggleEnabled}
              />
            </Row>
            <Row
              label={t('settings.llmModelLabel')}
              desc={`${status.modelFileName} · ${t('settings.llmModelSize', {
                size: bytesToMb(status.modelSizeBytes)
              })}`}
            >
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setRemoveOpen(true)}
              >
                {t('settings.llmRemove')}
              </button>
            </Row>
          </>
        ) : (
          <Row
            label={t('settings.llmUnavailable')}
            desc={t(llmReasonKey(status.reasonKey), { defaultValue: t('errors.generic') })}
          >
            {status.state === 'error' ? (
              <button type="button" className="btn" disabled={busy} onClick={() => void download()}>
                {t('common.retry')}
              </button>
            ) : (
              <span />
            )}
          </Row>
        )}
      </div>
      {removeOpen ? (
        <ConfirmDialog
          title={t('settings.llmRemoveConfirmTitle')}
          body={t('settings.llmRemoveConfirmBody')}
          confirmLabel={t('settings.llmRemove')}
          onCancel={() => setRemoveOpen(false)}
          onConfirm={() => {
            setRemoveOpen(false)
            void removeModel()
          }}
        />
      ) : null}
    </section>
  )
}

export function Settings(): ReactNode {
  const { t } = useTranslation()
  const { settings, update } = useSettings()
  const { period } = usePeriod()
  const toast = useToast()
  const tour = useTour()

  const [tourDepth, setTourDepth] = useState<TourDepth>('minimum')
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [exportYear, setExportYear] = useState(period.year)
  const [exportQuarter, setExportQuarter] = useState<1 | 2 | 3 | 4 | null>(period.quarter)
  const [exportFormat, setExportFormat] = useState<'csv' | 'json' | 'zip' | 'summary'>('csv')
  const [busy, setBusy] = useState(false)

  const patch = (p: UpdateSettingsPayload): void => {
    void update(p)
      .then(() => toast.success(t('settings.savedToast')))
      .catch((err: unknown) => toast.error(t(errorToKey(err))))
  }

  const select = <K extends keyof AppSettings>(
    key: K,
    options: { value: AppSettings[K] & string; label: string }[]
  ): ReactNode => (
    <select
      className="select"
      aria-label={String(key)}
      value={settings[key] as string}
      onChange={(e) => patch({ [key]: e.target.value } as UpdateSettingsPayload)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )

  const createBackup = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api().createBackup()
      if (result.ok && result.path) toast.success(t('settings.backupCreated', { path: result.path }))
      else toast.error(t(result.errorKey ? `issues.${result.errorKey}` : 'errors.generic', { defaultValue: t('errors.generic') }))
    } catch (err) {
      toast.error(t(errorToKey(err)))
    } finally {
      setBusy(false)
    }
  }

  const restoreBackup = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api().restoreBackup()
      if (result.ok) toast.success(t('settings.backupRestored'))
      else if (result.errorKey) toast.error(t(`issues.${result.errorKey}`, { defaultValue: t('errors.generic') }))
    } catch (err) {
      toast.error(t(errorToKey(err)))
    } finally {
      setBusy(false)
    }
  }

  const runExport = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api().exportPeriod({
        period: { year: exportYear, quarter: exportQuarter, month: null },
        format: exportFormat
      })
      if (result.ok && result.path) toast.success(t('settings.exportDone', { path: result.path }))
      else if (result.errorKey) toast.error(t(`issues.${result.errorKey}`, { defaultValue: t('errors.generic') }))
    } catch (err) {
      toast.error(t(errorToKey(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="content-inner" style={{ maxWidth: 720 }}>
      <section className="settings-group">
        <h2 className="section-title">{t('settings.groupGeneral')}</h2>
        <div className="card">
          <Row label={t('settings.language')}>
            {select('language', [
              { value: 'system', label: t('settings.languageSystem') },
              { value: 'de', label: 'Deutsch' },
              { value: 'en', label: 'English' }
            ])}
          </Row>
          <Row label={t('settings.theme')}>
            {select('theme', [
              { value: 'system', label: t('settings.themeSystem') },
              { value: 'light', label: t('settings.themeLight') },
              { value: 'dark', label: t('settings.themeDark') }
            ])}
          </Row>
          <Row label={t('settings.defaultYear')} desc={t('settings.defaultYearDesc')}>
            <select
              className="select"
              aria-label={t('settings.defaultYear')}
              value={settings.defaultYear}
              onChange={(e) => patch({ defaultYear: Number(e.target.value) })}
            >
              {yearOptions(settings.defaultYear).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.moveOriginals')} desc={t('settings.moveOriginalsDesc')}>
            <Toggle
              checked={settings.moveOriginalsAfterImport}
              label={t('settings.moveOriginals')}
              onChange={(v) => patch({ moveOriginalsAfterImport: v })}
            />
          </Row>
          <Row label={t('tour.laterTitle')} desc={t('tour.laterDesc')}>
            <select
              className="select"
              aria-label={t('tour.depthLabel')}
              value={tourDepth}
              onChange={(e) => setTourDepth(e.target.value as TourDepth)}
            >
              <option value="minimum">{t('tour.optionMinimum')}</option>
              <option value="medium">{t('tour.optionMedium')}</option>
              <option value="full">{t('tour.optionFull')}</option>
            </select>
            <button type="button" className="btn" onClick={() => tour.start(tourDepth)}>
              {t('tour.start')}
            </button>
          </Row>
        </div>
      </section>

      <section className="settings-group">
        <h2 className="section-title">{t('settings.groupBusiness')}</h2>
        <div className="card">
          <TextRow
            label={t('settings.businessName')}
            value={settings.businessName}
            onCommit={(v) => patch({ businessName: v })}
          />
          <TextRow
            label={t('settings.businessAddress')}
            value={settings.businessAddress}
            onCommit={(v) => patch({ businessAddress: v })}
            textarea
          />
          <TextRow
            label={t('settings.businessTaxNumber')}
            value={settings.businessTaxNumber}
            onCommit={(v) => patch({ businessTaxNumber: v })}
          />
          <TextRow
            label={t('settings.businessVatId')}
            value={settings.businessVatId}
            onCommit={(v) => patch({ businessVatId: v.toUpperCase() })}
          />
          <Row label={t('settings.businessType')}>
            {select('businessType', [
              { value: 'freelancer', label: t('settings.businessTypeFreelancer') },
              { value: 'trade', label: t('settings.businessTypeTrade') },
              { value: 'unsure', label: t('settings.businessTypeUnsure') }
            ])}
          </Row>
          <Row label={t('settings.federalState')}>
            <select
              className="select"
              aria-label={t('settings.federalState')}
              value={settings.federalState}
              onChange={(e) => patch({ federalState: e.target.value })}
            >
              {GERMAN_FEDERAL_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Row>
        </div>
      </section>

      <section className="settings-group" data-tour="settings-methods">
        <h2 className="section-title">{t('settings.groupVat')}</h2>
        <div className="card">
          <Row label={t('settings.vatMethodLabel')} desc={t(`vatMethodDesc.${settings.vatMethod}`)}>
            {select('vatMethod', [
              { value: 'ist', label: t('vatMethod.ist') },
              { value: 'soll', label: t('vatMethod.soll') },
              { value: 'kleinunternehmer', label: t('vatMethod.kleinunternehmer') },
              { value: 'unsure', label: t('vatMethod.unsure') }
            ])}
          </Row>
          <Row label={t('settings.filingFrequencyLabel')} desc={t('settings.filingFrequencyDesc')}>
            {select('vatFilingFrequency', [
              { value: 'monthly', label: t('filingFrequency.monthly') },
              { value: 'quarterly', label: t('filingFrequency.quarterly') },
              { value: 'yearly', label: t('filingFrequency.yearly') }
            ])}
          </Row>
        </div>
      </section>

      <section className="settings-group">
        <h2 className="section-title">{t('settings.groupIncomeTax')}</h2>
        <div className="card">
          <Row label={t('settings.incomeTaxMethodLabel')}>
            {select('incomeTaxMethod', [
              { value: 'euer', label: t('incomeTaxMethod.euer') },
              { value: 'accrual', label: t('incomeTaxMethod.accrual') },
              { value: 'unsure', label: t('incomeTaxMethod.unsure') }
            ])}
          </Row>
          <Row label={t('settings.assessmentType')}>
            {select('assessmentType', [
              { value: 'single', label: t('settings.assessmentSingle') },
              { value: 'joint', label: t('settings.assessmentJoint') }
            ])}
          </Row>
          <Row label={t('settings.churchTaxLabel')}>
            {select('churchTax', [
              { value: 'none', label: t('settings.churchNone') },
              { value: 'rate8', label: t('settings.churchRate8') },
              { value: 'rate9', label: t('settings.churchRate9') }
            ])}
          </Row>
          <Row label={t('settings.otherIncome')} desc={t('settings.otherIncomeDesc')}>
            <MoneyInput
              value={settings.otherTaxableIncome}
              ariaLabel={t('settings.otherIncome')}
              onCommit={(v) => patch({ otherTaxableIncome: Math.max(0, v ?? 0) })}
            />
          </Row>
          <Row
            label={t('settings.deductibleContributions')}
            desc={t('settings.deductibleContributionsDesc')}
          >
            <MoneyInput
              value={settings.deductibleContributions}
              ariaLabel={t('settings.deductibleContributions')}
              onCommit={(v) => patch({ deductibleContributions: Math.max(0, v ?? 0) })}
            />
          </Row>
          <Row label={t('settings.prepayments')}>
            <MoneyInput
              value={settings.incomeTaxPrepayments}
              ariaLabel={t('settings.prepayments')}
              onCommit={(v) => patch({ incomeTaxPrepayments: Math.max(0, v ?? 0) })}
            />
          </Row>
          <Row label={t('settings.includeSoli')}>
            <Toggle
              checked={settings.includeSolidaritySurcharge}
              label={t('settings.includeSoli')}
              onChange={(v) => patch({ includeSolidaritySurcharge: v })}
            />
          </Row>
        </div>
      </section>

      <LlmSection />

      <section className="settings-group">
        <h2 className="section-title">{t('settings.groupData')}</h2>
        <div className="card">
          <Row
            label={t('settings.backupCreate')}
            desc={t('settings.backupCreateDesc')}
            dataTour="settings-backup"
          >
            <button type="button" className="btn" disabled={busy} onClick={() => void createBackup()}>
              {t('settings.backupCreate')}
            </button>
          </Row>
          <Row label={t('settings.backupRestore')} desc={t('settings.backupRestoreDesc')}>
            <button type="button" className="btn" disabled={busy} onClick={() => setRestoreOpen(true)}>
              {t('settings.backupRestore')}
            </button>
          </Row>
          <Row label={t('settings.exportTitle')} desc={t('settings.exportDesc')}>
            <select
              className="select"
              aria-label={t('period.year')}
              value={exportYear}
              onChange={(e) => setExportYear(Number(e.target.value))}
            >
              {yearOptions(settings.defaultYear).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label={t('period.quarter')}
              value={exportQuarter ?? ''}
              onChange={(e) =>
                setExportQuarter(e.target.value === '' ? null : (Number(e.target.value) as 1 | 2 | 3 | 4))
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
              aria-label={t('settings.exportTitle')}
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
            >
              <option value="csv">{t('settings.exportFormatCsv')}</option>
              <option value="json">{t('settings.exportFormatJson')}</option>
              <option value="zip">{t('settings.exportFormatZip')}</option>
              <option value="summary">{t('settings.exportFormatSummary')}</option>
            </select>
            <button type="button" className="btn" disabled={busy} onClick={() => void runExport()}>
              {t('settings.exportButton')}
            </button>
          </Row>
          <Row label={t('settings.openDataFolder')} desc={t('settings.openDataFolderDesc')}>
            <button type="button" className="btn" onClick={() => void api().openDataFolder()}>
              {t('settings.openDataFolder')}
            </button>
          </Row>
        </div>
        <div className="card danger-zone mt-16">
          <Row label={t('settings.dangerTitle')} desc={t('settings.dangerDeleteAllHint')}>
            <span />
          </Row>
        </div>
      </section>

      {restoreOpen ? (
        <ConfirmDialog
          title={t('settings.backupRestoreConfirmTitle')}
          body={t('settings.backupRestoreConfirmBody')}
          confirmLabel={t('settings.backupRestore')}
          onCancel={() => setRestoreOpen(false)}
          onConfirm={() => {
            setRestoreOpen(false)
            void restoreBackup()
          }}
        />
      ) : null}
    </div>
  )
}
