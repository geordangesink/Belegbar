import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentDirection } from '@shared/domain'
import { api } from '../lib/api'
import { useImport } from '../context/ImportContext'
import { Icon } from './Icon'

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

export function DropZone({ direction }: { direction: DocumentDirection }): ReactNode {
  const { t } = useTranslation()
  const { startImport } = useImport()
  const [dragover, setDragover] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragDepth = useRef(0)

  const title = direction === 'income' ? t('overview.dropIncome') : t('overview.dropExpense')

  const pickFiles = async (): Promise<void> => {
    setError(null)
    const paths = await api().chooseFiles(direction)
    if (paths.length > 0) await startImport(direction, paths)
  }

  const onDrop = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    dragDepth.current = 0
    setDragover(false)
    setError(null)
    const files = [...e.dataTransfer.files]
    if (files.length === 0) return
    const pdfs = files.filter(isPdf)
    if (pdfs.length < files.length) setError(t('overview.nonPdf'))
    if (pdfs.length === 0) return
    const paths = pdfs.map((f) => api().getPathForFile(f)).filter((p) => p.length > 0)
    if (paths.length === 0) {
      setError(t('overview.noPath'))
      return
    }
    await startImport(direction, paths)
  }

  return (
    <div>
      <div
        className={`dropzone${dragover ? ' dragover' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={t('overview.dropAria', { zone: title })}
        onClick={() => void pickFiles()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            void pickFiles()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          dragDepth.current += 1
          setDragover(true)
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragover(false)
        }}
        onDrop={(e) => void onDrop(e)}
      >
        <span className="muted" aria-hidden="true">
          <Icon name="upload" size={22} />
        </span>
        <div className="dz-title">{title}</div>
        <div className="dz-hint">{t('overview.dropHint')}</div>
        <div className="dz-sub">{t('overview.dropSub')}</div>
      </div>
      {error ? (
        <div className="dz-error" role="alert">
          ⚠ {error}
        </div>
      ) : null}
    </div>
  )
}
