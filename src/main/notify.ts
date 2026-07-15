/**
 * Native OS notification service.
 *
 * Electron-free by injection: the Notification constructor and the support
 * probe arrive via deps, so this module never imports electron and unit
 * tests run headless with a fake Notification class.
 *
 * Product rules:
 *  - batch-import notifications ALWAYS fire when at least one file was in
 *    the batch (the user may have switched away during a long import)
 *  - LLM-drain notifications only fire while the window is NOT focused;
 *    the in-app UI already updates live when the user is looking at it
 */

/** Minimal surface of an Electron Notification instance used here. */
export interface NotificationHandle {
  show(): void
  on(event: 'click', listener: () => void): void
}

export interface NotificationOptions {
  title: string
  body: string
  silent: boolean
}

export interface NotifierDeps {
  /** resolved language ('system' already mapped to 'de' | 'en' by the caller) */
  getLanguage: () => 'de' | 'en'
  isWindowFocused: () => boolean
  /** focus/restore the main window */
  onClick: () => void
  /** Notification.isSupported() in production */
  isSupported: () => boolean
  /** `(opts) => new Notification(opts)` in production */
  createNotification: (opts: NotificationOptions) => NotificationHandle
}

/** Outcome counts of one finished import batch (duplicates only in total). */
export interface BatchSummary {
  total: number
  ok: number
  review: number
  failed: number
}

export class Notifier {
  constructor(private readonly deps: NotifierDeps) {}

  /** One import batch settled completely. Fires whenever total > 0. */
  notifyBatchDone(summary: BatchSummary): void {
    if (summary.total <= 0) return
    const de = this.deps.getLanguage() === 'de'
    const parts: string[] = [
      de
        ? summary.total === 1
          ? '1 Beleg importiert'
          : `${summary.total} Belege importiert`
        : summary.total === 1
          ? '1 document imported'
          : `${summary.total} documents imported`
    ]
    if (summary.review > 0) {
      parts.push(de ? `${summary.review} zu prüfen` : `${summary.review} to review`)
    }
    if (summary.failed > 0) {
      parts.push(de ? `${summary.failed} fehlgeschlagen` : `${summary.failed} failed`)
    }
    this.show(de ? 'Import abgeschlossen' : 'Import finished', parts.join(' – '))
  }

  /**
   * The LLM check queue drained after processing `count` documents.
   * Suppressed while the window is focused — the UI updates live there.
   */
  notifyLlmDone(count: number): void {
    if (count <= 0) return
    if (this.deps.isWindowFocused()) return
    const de = this.deps.getLanguage() === 'de'
    const body = de
      ? count === 1
        ? '1 Beleg geprüft'
        : `${count} Belege geprüft`
      : count === 1
        ? '1 document checked'
        : `${count} documents checked`
    this.show(de ? 'KI-Prüfung abgeschlossen' : 'AI check finished', body)
  }

  private show(title: string, body: string): void {
    if (!this.deps.isSupported()) return
    try {
      const notification = this.deps.createNotification({ title, body, silent: false })
      notification.on('click', () => this.deps.onClick())
      notification.show()
    } catch {
      // a broken notification backend must never crash the app
    }
  }
}
