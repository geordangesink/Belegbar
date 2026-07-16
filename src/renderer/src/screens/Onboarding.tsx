import { useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import appIconUrl from '../../../../build/icon.png'
import {
  GERMAN_FEDERAL_STATES,
  type AppSettings,
  type IncomeTaxMethod,
  type LanguageSetting,
  type ThemeSetting,
  type VatFilingFrequency,
  type VatMethod
} from '@shared/domain'
import { errorToKey } from '../lib/api'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { ImportModeControl } from '../components/ImportModeControl'

interface Draft {
  language: LanguageSetting
  theme: ThemeSetting
  businessName: string
  federalState: string
  businessType: AppSettings['businessType']
  incomeTaxMethod: IncomeTaxMethod
  vatMethod: VatMethod
  vatFilingFrequency: VatFilingFrequency
  churchTax: AppSettings['churchTax']
  moveOriginalsAfterImport: boolean
}

const ONBOARDING_STEP_IDS = ['welcome', 'business', 'methods', 'filing', 'import'] as const

function OptionCards<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; title: string; desc?: string }[]
  value: T
  onChange: (v: T) => void
}): ReactNode {
  return (
    <div className="option-cards">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`option-card${value === opt.value ? ' selected' : ''}`}
          aria-pressed={value === opt.value}
          data-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          <span className="oc-title">{opt.title}</span>
          {opt.desc ? <span className="oc-desc">{opt.desc}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Onboarding({ onDone }: { onDone: () => void }): ReactNode {
  const { t } = useTranslation()
  const { settings, update } = useSettings()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<Draft>({
    language: settings.language,
    theme: settings.theme,
    businessName: settings.businessName,
    federalState: settings.federalState,
    businessType: settings.businessType,
    incomeTaxMethod: settings.incomeTaxMethod,
    vatMethod: settings.vatMethod,
    vatFilingFrequency: settings.vatFilingFrequency,
    churchTax: settings.churchTax,
    moveOriginalsAfterImport: settings.moveOriginalsAfterImport
  })

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }))

  // Language/theme apply immediately so the wizard itself reacts.
  const applyLanguage = (v: LanguageSetting): void => {
    set('language', v)
    void update({ language: v }).catch(() => undefined)
  }
  const applyTheme = (v: ThemeSetting): void => {
    set('theme', v)
    void update({ theme: v }).catch(() => undefined)
  }

  const finish = async (): Promise<void> => {
    try {
      await update({
        businessName: draft.businessName,
        federalState: draft.federalState,
        businessType: draft.businessType,
        incomeTaxMethod: draft.incomeTaxMethod,
        vatMethod: draft.vatMethod,
        vatFilingFrequency: draft.vatFilingFrequency,
        churchTax: draft.churchTax,
        moveOriginalsAfterImport: draft.moveOriginalsAfterImport,
        onboardingCompleted: true
      })
      onDone()
    } catch (err) {
      toast.error(t(errorToKey(err)))
    }
  }

  const steps: ReactNode[] = [
    // 1 — welcome, language + theme
    <div key="s1" className="stack">
      <h1 id="onboarding-step-welcome">{t('onboarding.step1Title')}</h1>
      <div className="field-row mt-16">
        <label htmlFor="ob-lang">{t('settings.language')}</label>
        <select
          id="ob-lang"
          className="select"
          value={draft.language}
          onChange={(e) => applyLanguage(e.target.value as LanguageSetting)}
        >
          <option value="system">{t('settings.languageSystem')}</option>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </div>
      <div className="field-row">
        <label htmlFor="ob-theme">{t('settings.theme')}</label>
        <select
          id="ob-theme"
          className="select"
          value={draft.theme}
          onChange={(e) => applyTheme(e.target.value as ThemeSetting)}
        >
          <option value="system">{t('settings.themeSystem')}</option>
          <option value="light">{t('settings.themeLight')}</option>
          <option value="dark">{t('settings.themeDark')}</option>
        </select>
      </div>
    </div>,
    // 2 — business
    <div key="s2" className="stack">
      <h1 id="onboarding-step-business">{t('onboarding.step2Title')}</h1>
      <div className="field-row mt-16">
        <label htmlFor="ob-name">{t('onboarding.nameOptional')}</label>
        <input
          id="ob-name"
          className="input"
          value={draft.businessName}
          onChange={(e) => set('businessName', e.target.value)}
        />
      </div>
      <div className="field-row">
        <label htmlFor="ob-state">{t('settings.federalState')}</label>
        <select
          id="ob-state"
          className="select"
          value={draft.federalState}
          onChange={(e) => set('federalState', e.target.value)}
        >
          {GERMAN_FEDERAL_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <span className="small muted">{t('settings.businessType')}</span>
        <OptionCards
          value={draft.businessType}
          onChange={(v) => set('businessType', v)}
          options={[
            { value: 'freelancer', title: t('settings.businessTypeFreelancer') },
            { value: 'trade', title: t('settings.businessTypeTrade') },
            { value: 'unsure', title: t('settings.businessTypeUnsure') }
          ]}
        />
      </div>
    </div>,
    // 3 — tax methods
    <div key="s3" className="stack">
      <h1 id="onboarding-step-methods">{t('onboarding.step3Title')}</h1>
      <h2 className="section-title mt-16">{t('onboarding.incomeTaxMethodTitle')}</h2>
      <OptionCards
        value={draft.incomeTaxMethod}
        onChange={(v) => set('incomeTaxMethod', v)}
        options={[
          { value: 'euer', title: t('incomeTaxMethod.euer'), desc: t('onboarding.euerDesc') },
          { value: 'accrual', title: t('incomeTaxMethod.accrual'), desc: t('onboarding.accrualDesc') },
          { value: 'unsure', title: t('incomeTaxMethod.unsure'), desc: t('onboarding.unsureIncomeDesc') }
        ]}
      />
      <h2 className="section-title mt-16">{t('onboarding.vatMethodTitle')}</h2>
      <OptionCards
        value={draft.vatMethod}
        onChange={(v) => set('vatMethod', v)}
        options={[
          { value: 'ist', title: t('vatMethod.ist'), desc: t('vatMethodDesc.ist') },
          { value: 'soll', title: t('vatMethod.soll'), desc: t('vatMethodDesc.soll') },
          {
            value: 'kleinunternehmer',
            title: t('vatMethod.kleinunternehmer'),
            desc: t('vatMethodDesc.kleinunternehmer')
          },
          { value: 'unsure', title: t('vatMethod.unsure'), desc: t('vatMethodDesc.unsure') }
        ]}
      />
    </div>,
    // 4 — filing rhythm + church tax
    <div key="s3b" className="stack">
      <h1 id="onboarding-step-filing">{t('onboarding.step3bTitle')}</h1>
      <h2 className="section-title mt-16">{t('onboarding.filingTitle')}</h2>
      <OptionCards
        value={draft.vatFilingFrequency}
        onChange={(v) => set('vatFilingFrequency', v)}
        options={[
          { value: 'monthly', title: t('filingFrequency.monthly'), desc: t('onboarding.filingMonthlyDesc') },
          { value: 'quarterly', title: t('filingFrequency.quarterly'), desc: t('onboarding.filingQuarterlyDesc') },
          { value: 'yearly', title: t('filingFrequency.yearly'), desc: t('onboarding.filingYearlyDesc') }
        ]}
      />
      <h2 className="section-title mt-16">{t('settings.churchTaxLabel')}</h2>
      <OptionCards
        value={draft.churchTax}
        onChange={(v) => set('churchTax', v)}
        options={[
          { value: 'none', title: t('settings.churchNone'), desc: t('onboarding.churchNoneDesc') },
          { value: 'rate8', title: t('settings.churchRate8'), desc: t('onboarding.church8Desc') },
          { value: 'rate9', title: t('settings.churchRate9'), desc: t('onboarding.church9Desc') }
        ]}
      />
    </div>,
    // 5 — import behavior
    <div key="s4" className="stack">
      <h1 id="onboarding-step-import">{t('onboarding.step4Title')}</h1>
      <div className="settings-row onboarding-setting mt-16">
        <div className="sr-text">
          <div className="sr-label">{t('settings.importHandling')}</div>
          <div className="sr-desc">{t('settings.importHandlingDesc')}</div>
        </div>
        <ImportModeControl
          moveOriginals={draft.moveOriginalsAfterImport}
          onChange={(moveOriginalsAfterImport) =>
            set('moveOriginalsAfterImport', moveOriginalsAfterImport)
          }
        />
      </div>
    </div>
  ]

  const isLast = step === steps.length - 1
  const currentStepId = ONBOARDING_STEP_IDS[step] ?? ONBOARDING_STEP_IDS[0]
  const progress = ((step + 1) / steps.length) * 100

  return (
    <div className="onboarding" data-testid="onboarding">
      <div className="onboarding-card" data-step={currentStepId} data-step-index={step}>
        <header className="onboarding-brand">
          <img className="onboarding-brand-mark" src={appIconUrl} alt="" draggable={false} />
          <span className="onboarding-brand-name">{t('app.name')}</span>
        </header>
        <div
          className="onboarding-progress"
          data-progress={step + 1}
          style={{ '--onboarding-progress': `${progress}%` } as CSSProperties}
        >
          <div className="onboarding-progress-meta" aria-hidden="true">
            <span className="onboarding-progress-current num">
              {String(step + 1).padStart(2, '0')}
            </span>
            <span className="onboarding-progress-separator">/</span>
            <span className="onboarding-progress-total num">
              {String(steps.length).padStart(2, '0')}
            </span>
          </div>
          <div
            className="onboarding-progress-track"
            role="progressbar"
            aria-labelledby={`onboarding-step-${currentStepId}`}
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={step + 1}
          >
            <span className="onboarding-progress-fill" />
          </div>
        </div>
        <section
          key={currentStepId}
          className="onboarding-step-content"
          data-step={currentStepId}
          aria-labelledby={`onboarding-step-${currentStepId}`}
        >
          {steps[step]}
        </section>
        <footer className="onboarding-actions row mt-32" data-last-step={isLast}>
          {step > 0 ? (
            <button
              type="button"
              className="btn btn-ghost onboarding-back"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              {t('common.back')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary onboarding-next"
            onClick={() => (isLast ? void finish() : setStep((s) => s + 1))}
          >
            {isLast ? t('onboarding.finish') : t('common.next')}
          </button>
        </footer>
      </div>
    </div>
  )
}
