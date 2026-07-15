import type { SteuerfachApi } from '../shared/api'

declare global {
  interface Window {
    steuerfach: SteuerfachApi
  }
}

export {}
