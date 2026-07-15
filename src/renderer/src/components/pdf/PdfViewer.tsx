import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { api } from '../../lib/api'
import { Icon } from '../Icon'
import { PdfPage, PdfThumb } from './PdfPage'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type ZoomMode = 'fit-width' | 'fit-page' | 'custom'

interface PageInfo {
  page: PDFPageProxy
  width: number
  height: number
}

const PADDING = 48 // scroll container padding (both sides)

export function PdfViewer({ documentId }: { documentId: string }): ReactNode {
  const { t } = useTranslation()
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<PageInfo[]>([])
  const [error, setError] = useState(false)
  const [mode, setMode] = useState<ZoomMode>('fit-width')
  const [customScale, setCustomScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [showThumbs, setShowThumbs] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 })
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<number[] | null>(null)
  const [matchIndex, setMatchIndex] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pageEls = useRef(new Map<number, HTMLDivElement>())
  const pageTexts = useRef(new Map<number, string>())

  // Load the document.
  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    setDoc(null)
    setPages([])
    setError(false)
    setMatches(null)
    setQuery('')
    void (async () => {
      try {
        const bytes = await api().getDocumentPdf(documentId)
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise
        if (cancelled) {
          void pdf.destroy()
          return
        }
        loaded = pdf
        const infos: PageInfo[] = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const vp = page.getViewport({ scale: 1 })
          infos.push({ page, width: vp.width, height: vp.height })
        }
        if (cancelled) return
        setDoc(pdf)
        setPages(infos)
        setCurrentPage(1)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => {
      cancelled = true
      pageEls.current.clear()
      pageTexts.current.clear()
      if (loaded) void loaded.destroy()
    }
  }, [documentId])

  // Track container size for fit modes.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setContainerSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  const rotatedSize = useCallback(
    (info: PageInfo): { w: number; h: number } => {
      const swap = rotation % 180 !== 0
      return swap ? { w: info.height, h: info.width } : { w: info.width, h: info.height }
    },
    [rotation]
  )

  const scale = useMemo(() => {
    const first = pages[0]
    if (!first) return 1
    const { w, h } = rotatedSize(first)
    if (mode === 'fit-width') return Math.max(0.1, (containerSize.width - PADDING) / w)
    if (mode === 'fit-page')
      return Math.max(0.1, Math.min((containerSize.width - PADDING) / w, (containerSize.height - PADDING) / h))
    return customScale
  }, [pages, mode, customScale, containerSize, rotatedSize])

  const zoomBy = (factor: number): void => {
    setCustomScale(Math.min(5, Math.max(0.25, scale * factor)))
    setMode('custom')
  }

  const scrollToPage = useCallback((pageNumber: number) => {
    pageEls.current.get(pageNumber)?.scrollIntoView({ block: 'start' })
  }, [])

  // Current page from scroll position.
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const middle = el.scrollTop + el.clientHeight / 3
    let acc = 24 // top padding
    for (let i = 0; i < pages.length; i++) {
      const info = pages[i]
      if (!info) continue
      const { h } = rotatedSize(info)
      acc += h * scale + 16
      if (middle < acc) {
        setCurrentPage(i + 1)
        return
      }
    }
    setCurrentPage(pages.length)
  }, [pages, scale, rotatedSize])

  const pageText = async (pageNumber: number): Promise<string> => {
    const cached = pageTexts.current.get(pageNumber)
    if (cached !== undefined) return cached
    const info = pages[pageNumber - 1]
    if (!info) return ''
    const content = await info.page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .toLowerCase()
    pageTexts.current.set(pageNumber, text)
    return text
  }

  const runSearch = async (): Promise<void> => {
    const q = query.trim().toLowerCase()
    if (q === '' || pages.length === 0) {
      setMatches(null)
      return
    }
    const found: number[] = []
    for (let i = 1; i <= pages.length; i++) {
      if ((await pageText(i)).includes(q)) found.push(i)
    }
    setMatches(found)
    setMatchIndex(0)
    const first = found[0]
    if (first !== undefined) scrollToPage(first)
  }

  const stepMatch = (delta: number): void => {
    if (!matches || matches.length === 0) return
    const next = (matchIndex + delta + matches.length) % matches.length
    setMatchIndex(next)
    const target = matches[next]
    if (target !== undefined) scrollToPage(target)
  }

  if (error) {
    return (
      <div className="empty-state" role="alert">
        ⚠ {t('pdf.loadError')}
      </div>
    )
  }

  return (
    <>
      <div className="pdf-toolbar">
        <button
          type="button"
          className={`icon-btn${showThumbs ? ' active' : ''}`}
          aria-label={t('pdf.thumbnails')}
          aria-pressed={showThumbs}
          title={t('pdf.thumbnails')}
          onClick={() => setShowThumbs((v) => !v)}
        >
          <Icon name="thumbs" />
        </button>
        <button type="button" className="icon-btn" aria-label={t('pdf.zoomOut')} title={t('pdf.zoomOut')} onClick={() => zoomBy(1 / 1.2)}>
          <Icon name="zoom-out" />
        </button>
        <button type="button" className="icon-btn" aria-label={t('pdf.zoomIn')} title={t('pdf.zoomIn')} onClick={() => zoomBy(1.2)}>
          <Icon name="zoom-in" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('pdf.fitWidth')}
          title={t('pdf.fitWidth')}
          onClick={() => setMode('fit-width')}
        >
          <Icon name="fit-width" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('pdf.fitPage')}
          title={t('pdf.fitPage')}
          onClick={() => setMode('fit-page')}
        >
          <Icon name="fit-page" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('pdf.rotate')}
          title={t('pdf.rotate')}
          onClick={() => setRotation((r) => (r + 90) % 360)}
        >
          <Icon name="rotate" />
        </button>
        <span className="muted small num" aria-live="polite">
          {t('pdf.pageIndicator', { current: currentPage, total: pages.length || 1 })}
        </span>
        <span style={{ flex: 1 }} />
        <input
          className="input"
          style={{ width: 160 }}
          type="search"
          placeholder={t('pdf.searchPlaceholder')}
          aria-label={t('pdf.searchPlaceholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (e.target.value.trim() === '') setMatches(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
          }}
        />
        {matches !== null ? (
          <span className="muted small">
            {matches.length === 0 ? (
              t('pdf.searchNoMatch')
            ) : (
              <>
                {t('pdf.searchMatches', { count: matches.length })}{' '}
                <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={() => stepMatch(-1)}>
                  ‹
                </button>
                <button type="button" className="icon-btn" aria-label={t('common.next')} onClick={() => stepMatch(1)}>
                  ›
                </button>
              </>
            )}
          </span>
        ) : null}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void api().openDocumentExternal(documentId)}
        >
          <Icon name="external" size={13} /> {t('pdf.openExternal')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void api().revealDocument(documentId)}>
          <Icon name="folder" size={13} /> {t('pdf.reveal')}
        </button>
      </div>
      <div className="pdf-main">
        {showThumbs && doc ? (
          <div className="pdf-thumbs" role="list" aria-label={t('pdf.thumbnails')}>
            {pages.map((info, i) => (
              <PdfThumb
                key={i + 1}
                page={info.page}
                active={currentPage === i + 1}
                label={t('pdf.page', { n: i + 1 })}
                onClick={() => scrollToPage(i + 1)}
              />
            ))}
          </div>
        ) : null}
        <div className="pdf-scroll" ref={scrollRef} onScroll={onScroll}>
          {doc === null ? (
            <div className="empty-state">{t('app.loading')}</div>
          ) : (
            pages.map((info, i) => {
              const { w, h } = rotatedSize(info)
              return (
                <PdfPage
                  key={`${i + 1}`}
                  page={info.page}
                  width={w * scale}
                  height={h * scale}
                  scale={scale}
                  rotation={rotation}
                  register={(el) => {
                    if (el) pageEls.current.set(i + 1, el)
                    else pageEls.current.delete(i + 1)
                  }}
                />
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
