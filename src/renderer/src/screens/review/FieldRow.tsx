import type { ReactNode } from 'react'
import type { TaxDocument } from '@shared/domain'
import type { FieldAttentionLevel } from '@core/review/attention'
import type { UpdateDocumentPayload } from '@shared/ipc'
import { ConfidenceChip, type ConfidenceLevel } from '../../components/StatusBits'

export type Patch = UpdateDocumentPayload['patch']
export type PatchKey = keyof Patch

/** Reads the effective (edited-or-stored) value of a field. */
export function effective<K extends PatchKey>(
  doc: TaxDocument,
  patch: Patch,
  key: K
): Patch[K] | null {
  if (key in patch) return patch[key] as Patch[K]
  const raw = (doc as unknown as Record<string, unknown>)[key]
  return (raw === undefined ? null : raw) as Patch[K] | null
}

export function FieldRow({
  label,
  doc,
  patch,
  fieldKey,
  fieldAttention,
  children
}: {
  label: string
  doc: TaxDocument
  patch: Patch
  fieldKey: PatchKey
  fieldAttention: Readonly<Record<string, FieldAttentionLevel>>
  children: ReactNode
}): ReactNode {
  const edited = fieldKey in patch
  const value = effective(doc, patch, fieldKey)
  const attention = fieldAttention[fieldKey]
  const missing = value === null || value === undefined || value === ''
  const level: ConfidenceLevel = edited
    ? 'manual'
    : attention
      ? missing
        ? 'missing'
        : 'check'
      : 'recognized'
  return (
    <div className="field-row">
      <div className="fr-label-line">
        <label htmlFor={`field-${fieldKey}`}>{label}</label>
        {level !== 'recognized' ? <ConfidenceChip level={level} attention={attention} /> : null}
      </div>
      {children}
    </div>
  )
}
