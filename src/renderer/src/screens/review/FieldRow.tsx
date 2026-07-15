import type { ReactNode } from 'react'
import type { TaxDocument } from '@shared/domain'
import type { UpdateDocumentPayload } from '@shared/ipc'
import { ConfidenceChip, confidenceLevel } from '../../components/StatusBits'

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

/** Extraction confidence for a field; tries aliases (e.g. currency). */
export function fieldConf(doc: TaxDocument, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const c = doc.fieldConfidence[key]
    if (typeof c === 'number') return c
  }
  return undefined
}

export function FieldRow({
  label,
  doc,
  patch,
  fieldKey,
  confKeys,
  children
}: {
  label: string
  doc: TaxDocument
  patch: Patch
  fieldKey: PatchKey
  /** extra keys to look up confidence under */
  confKeys?: string[]
  children: ReactNode
}): ReactNode {
  const edited = fieldKey in patch
  const value = effective(doc, patch, fieldKey)
  const level = confidenceLevel(value, fieldConf(doc, fieldKey, ...(confKeys ?? [])), edited)
  return (
    <div className="field-row">
      <div className="fr-label-line">
        <label htmlFor={`field-${fieldKey}`}>{label}</label>
        <ConfidenceChip level={level} />
      </div>
      {children}
    </div>
  )
}
