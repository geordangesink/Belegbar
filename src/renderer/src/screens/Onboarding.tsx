import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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

interface Draft {
  language: LanguageSetting
  theme: ThemeSetting
  businessName: string
  federalState: string
  businessType: AppSettings['businessType']
  incomeTaxMethod: IncomeTaxMethod
  vatMethod: VatMethod
  vatFilingFrequency: VatFilingFrequency
  moveOriginalsAfterImport: boolean
}

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
      <h1 style={{ fontSize: 22 }}>{t('onboarding.step1Title')}</h1>
      <p className="muted">{t('onboarding.step1Body')}</p>
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
      <h1 style={{ fontSize: 22 }}>{t('onboarding.step2Title')}</h1>
      <p className="muted">{t('onboarding.step2Body')}</p>
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
      <h1 style={{ fontSize: 22 }}>{t('onboarding.step3Title')}</h1>
      <p className="muted">{t('onboarding.step3Body')}</p>
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
    </div>,
    // 4 — import behavior
    <div key="s4" className="stack">
      <h1 style={{ fontSize: 22 }}>{t('onboarding.step4Title')}</h1>
      <p className="muted">{t('onboarding.step4Body')}</p>
      <div className="settings-row mt-16" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
        <div className="sr-text">
          <div className="sr-label">{t('onboarding.step4MoveTitle')}</div>
          <div className="sr-desc">{t('onboarding.step4MoveDesc')}</div>
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={draft.moveOriginalsAfterImport}
          aria-label={t('onboarding.step4MoveTitle')}
          onClick={() => set('moveOriginalsAfterImport', !draft.moveOriginalsAfterImport)}
        />
      </div>
    </div>
  ]

  const isLast = step === steps.length - 1

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={`dot${i === step ? ' active' : ''}`} />
          ))}
        </div>
        {steps[step]}
        <div className="row mt-32" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ visibility: step === 0 ? 'hidden' : undefined }}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            {t('common.back')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => (isLast ? void finish() : setStep((s) => s + 1))}
          >
            {isLast ? t('onboarding.finish') : t('common.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
