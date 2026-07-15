import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'

/**
 * One lazily rendered PDF page: placeholder until near the viewport, then
 * canvas + selectable text layer. Re-renders on scale/rotation change.
 */
export function PdfPage({
  page,
  width,
  height,
  scale,
  rotation,
  register
}: {
  page: PDFPageProxy
  /** CSS size at current scale/rotation */
  width: number
  height: number
  scale: number
  /** extra user rotation in degrees (0/90/180/270) */
  rotation: number
  register: (el: HTMLDivElement | null) => void
}): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setVisible(true)
        }
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    const textHost = textRef.current
    const host = hostRef.current
    if (!canvas || !textHost || !host) return

    const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const renderTask = page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
    })

    host.style.setProperty('--scale-factor', String(viewport.scale))
    textHost.replaceChildren()
    const textLayer = new pdfjs.TextLayer({
      textContentSource: page.streamTextContent(),
      container: textHost,
      viewport
    })

    renderTask.promise
      .then(() => textLayer.render())
      .catch(() => {
        // cancelled renders are expected during zooming
      })

    return () => {
      renderTask.cancel()
      textLayer.cancel()
    }
  }, [visible, page, scale, rotation])

  return (
    <div
      className="pdf-page"
      ref={(el) => {
        hostRef.current = el
        register(el)
      }}
      style={{ width: Math.floor(width), height: Math.floor(height) }}
    >
      {visible ? (
        <>
          <canvas ref={canvasRef} />
          <div className="textLayer" ref={textRef} />
        </>
      ) : null}
    </div>
  )
}

/** Small always-rendered thumbnail. */
export function PdfThumb({
  page,
  active,
  label,
  onClick
}: {
  page: PDFPageProxy
  active: boolean
  label: string
  onClick: () => void
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const base = page.getViewport({ scale: 1 })
    const scale = 112 / base.width
    const viewport = page.getViewport({ scale })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const task = page.render({ canvasContext: ctx, viewport })
    task.promise.catch(() => {
      // cancelled — fine
    })
    return () => task.cancel()
  }, [page])

  return (
    <button
      type="button"
      className={`pdf-thumb${active ? ' active' : ''}`}
      aria-label={label}
      aria-current={active || undefined}
      onClick={onClick}
    >
      <canvas ref={canvasRef} />
    </button>
  )
}
