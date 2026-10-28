// @vitest-environment jsdom
import { createCollection } from '@tanstack/db'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import {
  oraclePropertyOptions,
  readOracleRunConfig,
} from '../../db/tests/oracle-config.js'
import { createCursorPager, queryCollectionOptions } from '../src/index.js'
import {
  makeClient,
  rowsFor,
  tick,
} from './cursor-pagination-boundary-support.js'

/**
 * # Do browser-facing readers release the right cursor work?
 *
 * Contract authority: cursor-pagination/README.md, "Contract before
 * implementation," and the exported createCursorPager API. QueryClient
 * cancellation rejects a nested QueryCollection preload. A silent replacement
 * may fulfill it only with replacement rows. Reader abort rejects that reader
 * with its reason and leaves Query's shared transport active. Query's configured
 * retry policy applies to both initial and growth Query fetches.
 *
 * Each generated size from one to four creates two pages, so the held second
 * page is always reachable; size zero cannot enter that history. The independent
 * outcome rules above judge QueryClient and QueryCollection at preload
 * settlement, and the reader at abort settlement. Controlled fetchPage calls
 * supply the held response; these histories do not establish behavior of a
 * changing HTTP endpoint. The window, cache, publication, and manual-write
 * owners check their separate boundaries.
 */

const fixedSeed = 1_779_013
const replay = readOracleRunConfig()

/** Ordinary campaigns use the same property, observation, and run budget. */
async function assertBoundaryProperty<Ts>(
  property: fc.IAsyncProperty<Ts>,
  name: string,
): Promise<void> {
  if (replay.replayPath !== undefined && replay.replayProperty !== name) return
  const options = oraclePropertyOptions(30, name)
  if (replay.replaySeed === undefined)
    await fc.assert(property, { ...options, seed: fixedSeed })
  await fc.assert(property, options)
}

async function finishBoundaryCleanup(
  steps: ReadonlyArray<() => void | Promise<void>>,
  primaryFailure: unknown,
): Promise<void> {
  const cleanupFailures: Array<unknown> = []
  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (cleanupFailures.length > 0)
    throw new AggregateError(
      cleanupFailures,
      `Cursor boundary cleanup failed`,
      {
        cause: primaryFailure,
      },
    )
}

describe(`cursor Query fetch boundaries`, () => {
  it.each([false, true])(
    `nested row query settles when pages cancel; replacement=%s`,
    async (replace) => {
      await assertBoundaryProperty(
        fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (size) => {
          const client = makeClient()
          const rows = rowsFor(size)
          const key = [`resource`, `pages`]
          const entered = createDeferred<void>()
          const release = createDeferred<void>()
          let hold = true
          let version = 0
          const logged = vi.spyOn(console, `error`).mockImplementation(() => {})
          const options = {
            queryClient: client,
            queryKey: key,
            fetchPage: async (cursor: string | undefined) => {
              const page = {
                rows: rows
                  .slice(cursor ? size : 0, cursor ? rows.length : size)
                  .map((row) => ({ ...row, version })),
                nextCursor: cursor ? null : `next`,
              }
              if (cursor && hold) {
                entered.resolve()
                await release.promise
              }
              return page
            },
          }
          await createCursorPager(options).read({ limit: size })
          const collection = createCollection(
            queryCollectionOptions({
              queryClient: client,
              queryKey: [`resource`, `rows`],
              getKey: (row: { id: number; version: number }) => row.id,
              queryFn: () => createCursorPager(options).read({}),
            }),
          )
          const pending = collection.preload().then(
            () => ({ ok: true }),
            (error: unknown) => ({ ok: false, error }),
          )
          let primaryFailure: unknown
          try {
            await entered.promise
            if (replace) {
              hold = false
              version = 1
              await client.refetchQueries({ queryKey: key, exact: true })
            } else await client.cancelQueries({ queryKey: key, exact: true })
            await tick()
            expect(
              client.getQueryState([`resource`, `rows`])?.fetchStatus,
            ).toBe(`idle`)
            const outcome = await pending
            expect(outcome.ok).toBe(replace)
            if (replace)
              expect(
                [...collection.values()].map(({ id, version: rowVersion }) => ({
                  id,
                  version: rowVersion,
                })),
              ).toEqual(rows.map((row) => ({ ...row, version: 1 })))
            else {
              expect(client.getQueryState([`resource`, `rows`])?.status).toBe(
                `error`,
              )
              if (!outcome.ok && `error` in outcome)
                expect((outcome.error as Error).name).toBe(`AbortError`)
            }
            expect(logged).toHaveBeenCalledTimes(replace ? 0 : 1)
          } catch (error) {
            primaryFailure = error
            throw error
          } finally {
            await finishBoundaryCleanup(
              [
                () => logged.mockRestore(),
                () => release.resolve(),
                () => collection.cleanup(),
                () => client.clear(),
              ],
              primaryFailure,
            )
          }
        }),
        `cursor-pagination.nested-cancellation`,
      )
    },
  )

  it(`reader abort releases its queue without canceling shared transport`, async () => {
    await assertBoundaryProperty(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (size) => {
        const client = makeClient(),
          rows = rowsFor(size),
          entered = createDeferred<AbortSignal>(),
          release = createDeferred<void>()
        const pager = createCursorPager({
          queryClient: client,
          queryKey: [`abort`],
          fetchPage: async (cursor, signal) => {
            if (cursor) {
              entered.resolve(signal)
              await release.promise
            }
            return {
              rows: rows.slice(cursor ? size : 0, cursor ? rows.length : size),
              nextCursor: cursor ? null : `next`,
            }
          },
        })
        await pager.read({ limit: size })
        const abort = new AbortController(),
          reason = new Error(`reader left`)
        let state: unknown = `pending`
        const pending = pager.read({}, abort.signal).then(
          () => {
            state = `success`
          },
          (error) => {
            state = error
          },
        )
        let primaryFailure: unknown
        try {
          const transport = await entered.promise
          abort.abort(reason)
          await tick()
          expect(state).toBe(reason)
          expect(transport.aborted).toBe(false)
          expect(await pager.read({ limit: size })).toEqual(rows.slice(0, size))
        } catch (error) {
          primaryFailure = error
          throw error
        } finally {
          await finishBoundaryCleanup(
            [() => release.resolve(), () => pending, () => client.clear()],
            primaryFailure,
          )
        }
      }),
      `cursor-pagination.reader-abort`,
    )
  })
})
