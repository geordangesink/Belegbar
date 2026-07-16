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
  const [picking, setPicking] = useState(false)
  const [acceptedCount, setAcceptedCount] = useState(0)
  const dragDepth = useRef(0)

  const title = direction === 'income' ? t('overview.dropIncome') : t('overview.dropExpense')

  const pickFiles = async (): Promise<void> => {
    if (picking) return
    setPicking(true)
    setError(null)
    setAcceptedCount(0)
    try {
      const paths = await api().chooseFiles(direction)
      if (paths.length > 0) {
        setAcceptedCount(paths.length)
        await startImport(direction, paths)
      }
    } finally {
      setPicking(false)
    }
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
    setAcceptedCount(paths.length)
    await startImport(direction, paths)
  }

  return (
    <div>
      <div
        className={`dropzone ${direction}${dragover ? ' dragover' : ''}${picking ? ' busy' : ''}${acceptedCount > 0 ? ' accepted' : ''}`}
        role="button"
        tabIndex={0}
        aria-busy={picking}
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
        <span className="dropzone-icon" aria-hidden="true">
          <Icon name={acceptedCount > 0 ? 'check' : 'upload'} size={22} />
        </span>
        <div className="dz-title">{title}</div>
        <div className="dz-hint">
          {acceptedCount > 0
            ? t('overview.addedCount', { count: acceptedCount })
            : picking
              ? t('overview.choosing')
              : t('overview.dropHint')}
        </div>
      </div>
      {error ? (
        <div className="dz-error" role="alert">
          ⚠ {error}
        </div>
      ) : null}
    </div>
  )
}
