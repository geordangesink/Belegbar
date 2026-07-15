/**
 * Tiny data-refresh bus: mutations and finished imports invalidate all
 * period/document derived queries. Screens re-fetch when the version bumps.
 */
import { useEffect, useState } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()

export function onDataChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitDataChanged(): void {
  for (const listener of [...listeners]) listener()
}

/** Bumps on every data change; put it into fetch-effect deps. */
export function useDataVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => onDataChanged(() => setVersion((v) => v + 1)), [])
  return version
}
