import { useEffect, useState, type ReactNode } from 'react'
import { activeLanguage } from '../i18n'
import { formatNumber, parseDecimalInput, round2 } from '../lib/format'

/**
 * Locale-tolerant decimal input: accepts both "1.234,56" and "1,234.56",
 * commits on blur/Enter, shows the value formatted for the active locale.
 */
export function MoneyInput({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  digits = 2,
  id
}: {
  value: number | null
  onCommit: (value: number | null) => void
  ariaLabel?: string
  placeholder?: string
  digits?: number
  id?: string
}): ReactNode {
  const lang = activeLanguage()
  const display = value === null ? '' : formatNumber(value, lang, digits)
  const [text, setText] = useState(display)
  const [focused, setFocused] = useState(false)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    if (!focused) {
      setText(display)
      setInvalid(false)
    }
  }, [display, focused])

  const commit = (): void => {
    const trimmed = text.trim()
    if (trimmed === '') {
      setInvalid(false)
      if (value !== null) onCommit(null)
      return
    }
    const parsed = parseDecimalInput(trimmed)
    if (parsed === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    const roundedNew = digits === 2 ? round2(parsed) : parsed
    if (roundedNew !== value) onCommit(roundedNew)
    else setText(display)
  }

  return (
    <input
      id={id}
      className="input num"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      onChange={(e) => setText(e.target.value)}
    />
  )
}
