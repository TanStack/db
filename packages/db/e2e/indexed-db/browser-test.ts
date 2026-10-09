import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base, webkit } from '@playwright/test'

// WebKit's ephemeral profile may reject native Blob preparation. Run the SAME
// value histories in a disposable persistent profile as a positive receiving
// witness, while retaining the ordinary profile's truthful-rejection coverage.
export const test = base.extend({
  context: async ({ context }, use, info) => {
    if (info.project.name !== 'webkit-persistent') {
      await use(context)
      return
    }
    const profile = await mkdtemp(join(tmpdir(), 'indexeddb-webkit-'))
    try {
      const persistent = await webkit.launchPersistentContext(profile, {
        headless: true,
        baseURL: String(info.project.use.baseURL),
      })
      try {
        await use(persistent)
      } finally {
        await persistent.close()
      }
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  },
})
