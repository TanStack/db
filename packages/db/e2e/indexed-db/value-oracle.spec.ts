/** Native receiving witnesses for the compatibility and persistence value laws.
 * The independent authored descriptions live in structured-clone-oracle.ts.
 * Two pages use actual BroadcastChannel and independent native connections.
 * Settled snapshots, raw native rows and export retain type/content. This owner
 * receives supported mutable capture before delayed persistence as well; it
 * does not claim every browser failure/interleaving.
 */
import { expect } from '@playwright/test'
import {
  expectedValueRows,
  valueKinds,
} from '../../tests/indexed-db/structured-clone-oracle'
import { declareOracle } from '../../tests/oracle-declaration'
import { test } from './browser-test'
import type {} from './coverage-browser'
import { withCoverage } from './coverage-cleanup'

for (const kind of valueKinds) {
  test(`preserves supported ${kind} values or reports native rejection`, async ({
    context,
    browserName,
  }) => {
    const pages = await Promise.all([context.newPage(), context.newPage()])
    const database = `values-${kind}-${crypto.randomUUID()}`
    await withCoverage(pages, async () => {
      await Promise.all(
        pages.map(async (page) => {
          await page.goto('/e2e/indexed-db/coverage.html')
          await page.waitForFunction(() => Boolean(window.coverage))
          await page.evaluate(async (name) => {
            window.valuePeer = await window.coverage.valuePeer(name)
          }, database)
        }),
      )
      const writer = pages[0]
      async function checkpoint(name: string) {
        const rows = expectedValueRows(kind, name)
        for (const page of pages)
          await expect
            .poll(() => page.evaluate(() => window.valuePeer.observe()))
            .toEqual({ status: 'ready', rows, durable: rows, exported: rows })
      }
      const native = await writer.evaluate(
        ({ name, valueKind }) =>
          window.coverage.nativeValueProbe(name, valueKind),
        { name: database, valueKind: kind },
      )
      if (native.outcome === 'rejected') {
        // Playwright WebKit on macOS can reject native Blob preparation. This
        // narrow provider failure is evidence of rejection/rollback, never a
        // passing claim about Blob preservation. Healthy date is the suffix.
        expect(
          test.info().project.name,
          'persistent WebKit must preserve Blob values',
        ).not.toBe('webkit-persistent')
        expect(browserName).toBe('webkit')
        expect(['blob', 'nested']).toContain(kind)
        expect(native).toEqual({
          outcome: 'rejected',
          name: 'UnknownError',
          message:
            'Error preparing Blob/File data to be stored in object store',
        })
        const failure = await writer.evaluate(async (valueKind) => {
          try {
            await window.valuePeer.insert(valueKind)
            return null
          } catch (error) {
            const cause =
              error instanceof Error && error.cause instanceof Error
                ? error.cause
                : error
            return cause instanceof Error
              ? { name: cause.name, message: cause.message }
              : { name: '', message: String(cause) }
          }
        }, kind)
        expect(failure).toEqual({ name: native.name, message: native.message })
        for (const page of pages)
          expect(await page.evaluate(() => window.valuePeer.observe())).toEqual(
            { status: 'ready', rows: [], durable: [], exported: [] },
          )
        await writer.evaluate(() => window.valuePeer.insert('date'))
        const rows = expectedValueRows('date', 'initial')
        for (const page of pages)
          await expect
            .poll(() => page.evaluate(() => window.valuePeer.observe()))
            .toEqual({ status: 'ready', rows, durable: rows, exported: rows })
        await test.info().attach('native-value-limit', {
          body: JSON.stringify({
            kind,
            native,
            law: 'truthful rejection and successful suffix; value preservation not reached',
          }),
          contentType: 'application/json',
        })
        return
      }
      await writer.evaluate(
        (valueKind) => window.valuePeer.insert(valueKind),
        kind,
      )
      await checkpoint('initial')
      await writer.evaluate(() => window.valuePeer.update())
      await checkpoint('updated')
      await writer.evaluate(() => window.valuePeer.replace())
      await checkpoint('updated')
      for (const entry of ['update', 'import'] as const) {
        const capture = await writer.evaluate(
          ({ valueKind, operation }) =>
            window.valuePeer.capture(valueKind, operation),
          { valueKind: kind, operation: entry },
        )
        expect(
          capture.beforeRelease,
          'handler/storage holds real persistence',
        ).toBe(false)
        if (entry === 'update')
          expect(capture.immediate).toEqual(expectedValueRows(kind, 'captured'))
        await checkpoint('captured')
      }
      for (const entry of ['insert', 'import'] as const) {
        for (const badIndex of [0, 1, 2]) {
          expect(
            await writer.evaluate(
              ({ valueKind, operation, index }) =>
                window.valuePeer.reject(valueKind, operation, index),
              { valueKind: kind, operation: entry, index: badIndex },
            ),
          ).toBe('rejected')
          await checkpoint('captured')
        }
      }
      await pages[1].evaluate(() => window.coverage.cleanup())
      await pages[1].reload()
      await pages[1].waitForFunction(() => Boolean(window.coverage))
      await pages[1].evaluate(async (name) => {
        window.valuePeer = await window.coverage.valuePeer(name)
      }, database)
      await checkpoint('captured')
    })
  })
}

// First-open model: a shared database name gives every writer's Collection all
// rows; separate names give each writer only its own row.
function expectedFirstOpenRows<T>(
  rows: Array<T>,
  shared: boolean,
): Array<Array<T>> {
  return rows.map((row) => (shared ? rows : [row]))
}

declareOracle({ model: [expectedFirstOpenRows] })

// Same/independent names distinguish queue sharing from accidental global
// ownership. Prototype and Unicode store names also receive native creation,
// dictionary lookup, broadcast and restore; the wider renaming grammar stays
// in compatibility.test.ts.
for (const shared of [true, false]) {
  for (const store of ['__proto__', '雪/é']) {
    test(`initializes concurrent native opens with shared ${shared} and store ${store}`, async ({
      page,
    }) => {
      await withCoverage([page], async () => {
        await page.goto('/e2e/indexed-db/coverage.html')
        await page.waitForFunction(() => Boolean(window.coverage))
        const evidence = await page.evaluate(
          async ({ name, same, storeName }) => {
            window.initialization = await window.coverage.initialize(
              name,
              same,
              storeName,
            )
            return window.initialization.evidence
          },
          {
            name: `initial-${crypto.randomUUID()}`,
            same: shared,
            storeName: store,
          },
        )
        expect(evidence.admission).toEqual({ admitted: 3, settled: 0 })
        expect(evidence.initialVersions).toEqual(Array(shared ? 1 : 3).fill(0))
        expect(evidence.schema).toEqual(
          Array.from({ length: 3 }, () =>
            ['_versions', store, store + '-neighbor'].sort(),
          ),
        )
        expect(evidence.held).toEqual(
          Array.from({ length: 3 }, () => ({
            status: 'loading',
            reads: ['pending'],
          })),
        )
        expect(evidence.restored).toEqual([
          ['complete'],
          ['complete'],
          ['complete'],
        ])
        const rows = [0, 1, 2].map((id) => ({ id, name: `writer-${id}` }))
        const expected = expectedFirstOpenRows(rows, shared)
        await expect
          .poll(() => page.evaluate(() => window.initialization.rows()))
          .toEqual(expected)
        expect(
          await page.evaluate(() => window.initialization.fresh()),
        ).toEqual(expected)
        // A versionchange closes each connection: local storage can no longer
        // serve reads, so every Collection crashes.
        expect(
          await page.evaluate(() => window.initialization.upgrade()),
        ).toEqual({ blocked: 0, statuses: ['crashed', 'crashed', 'crashed'] })
      })
    })
  }
}
