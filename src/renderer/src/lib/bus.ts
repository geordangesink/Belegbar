/**
 * Tiny data-refresh bus: mutations and finished imports invalidate all
 * period/document derived queries. Screens re-fetch when the version bumps.
 */
import { useSyncExternalStore } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()
let dataVersion = 0

export function onDataChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitDataChanged(): void {
  dataVersion += 1
  for (const listener of [...listeners]) listener()
}

/** Bumps on every data change; put it into fetch-effect deps. */
export function useDataVersion(): number {
  return useSyncExternalStore(onDataChanged, () => dataVersion, () => dataVersion)
}

let llmRefreshWired = false
let lastLlmQueueLength = 0

/**
 * App-level wiring, subscribed exactly once: when the local LLM check queue
 * shrinks, a check finished and may have changed a document's issues →
 * bump the data version so every screen refetches and all status badges
 * stay identical across surfaces.
 */
export function wireLlmDataRefresh(): void {
  if (llmRefreshWired) return
  llmRefreshWired = true
  window.belegbar.onLlmProgress((status) => {
    if (status.queueLength < lastLlmQueueLength) emitDataChanged()
    lastLlmQueueLength = status.queueLength
  })
}
