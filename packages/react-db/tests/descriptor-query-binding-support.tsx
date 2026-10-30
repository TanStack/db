// Shared row type and SSR render host for the descriptor query binding tests.
// The law is owned by descriptor-query-binding-oracle.test.tsx.
import { renderToString } from 'react-dom/server'
import { vi } from 'vitest'
import type { ReactNode } from 'react'

export type Row = { id: string; value: string }

// React's server renderer runs in this jsdom test process. Remove the browser
// global only for that host call; hydrateRoot retains the real browser globals.
export function renderSsr(node: ReactNode): string {
  const browserWindow = globalThis.window
  vi.stubGlobal(`window`, undefined)
  try {
    return renderToString(node)
  } finally {
    vi.stubGlobal(`window`, browserWindow)
  }
}
