import type { BelegbarApi } from '../shared/api'

declare global {
  interface Window {
    belegbar: BelegbarApi
  }
}

export {}
