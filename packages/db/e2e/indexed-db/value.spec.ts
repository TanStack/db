// Ordinary native value scenarios. value-oracle.spec.ts owns the structured-clone
// value laws and their models; this foreign-realm witness compares with literal
// bytes and offsets, so it is supplemental coverage.
import { expect } from '@playwright/test'
import { test } from './browser-test'
import { withCoverage } from './coverage-cleanup'
import type {} from './coverage-browser'

// A same-origin iframe supplies actual foreign native constructors in each
// engine. Authored bytes and graph identity judge callback-return capture,
// settled public rows, native storage and export without constructor-source
// inspection in the expected result. Both property orders reach buffer copying.
for (const kind of ['u8', 'view'] as const) {
  for (const viewFirst of [false, true]) {
    test(`captures foreign ${kind} aliases with viewFirst=${viewFirst}`, async ({
      page,
    }) => {
      await withCoverage([page], async () => {
        await page.goto('/e2e/indexed-db/coverage.html')
        await page.waitForFunction(() => Boolean(window.coverage))
        const result = await page.evaluate(
          async ({ name, first, viewKind }) => {
            window.valuePeer = await window.coverage.valuePeer(name)
            return window.valuePeer.captureRealm(first, viewKind)
          },
          {
            name: `realm-${crypto.randomUUID()}`,
            first: viewFirst,
            viewKind: kind,
          },
        )
        expect(result).toEqual(
          Array.from({ length: 4 }, () => ({
            bytes: [0, 1, 2, 3, 4, 5, 6, 7],
            offset: 2,
            length: 3,
            alias: true,
            detached: true,
          })),
        )
      })
    })
  }
}
