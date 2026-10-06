/**
 * Native transaction observers compose with wrapper settlement. The callback is
 * given a public IDBTransaction, so installing, replacing, or clearing its event
 * properties cannot erase executeTransaction's completion obligation. Native
 * abort rejects even with a held callback; native completion requires callback
 * fulfillment before success. This law comes from the exported wrapper contract.
 *
 * The independent model has only two facts: native outcome and callback outcome.
 * Event registration is a history dimension, never an input to that model. The
 * driver reaches actual native complete/abort, then reads through a separate raw
 * transaction to establish durability and drain the terminal event's promise
 * continuations. That is the comparison checkpoint; no timeout counts as RED.
 * A second checkpoint follows callback release. User observers must still run
 * exactly once for the terminal event, except when deliberately cleared. This
 * prevents a repair from reclaiming event properties at the caller's expense.
 *
 * The grammar exhausts 2 native outcomes x 5 observer registrations x 2 callback
 * timings. Fake-IDB supplies native events. These checks make no abnormal-close,
 * crash, browser scheduling, or callback-rejection policy claim; wrapper.test.ts
 * separately owns callback failure identity and late rejection after commit.
 */
import { expect, it } from 'vitest'
import { executeTransaction } from '../src'
import { deferred, readStore, withHarness } from './harness'

type NativeOutcome = 'complete' | 'abort'
type CallerOutcome = 'pending' | 'fulfilled' | 'rejected'

// Success is a conjunction; abort is sufficient failure. Neither observer
// syntax nor registration order can change these obligations.
function expectedCaller(
  native: NativeOutcome,
  callbackFulfilled: boolean,
): CallerOutcome {
  if (native === 'abort') return 'rejected'
  return callbackFulfilled ? 'fulfilled' : 'pending'
}

for (const native of ['complete', 'abort'] as const) {
  for (const registration of [
    'none',
    'additive',
    'property',
    'replace-property',
    'clear-property',
  ] as const) {
    for (const heldCallback of [false, true]) {
      it(`preserves ${native} settlement with ${registration} observers and held callback ${heldCallback}`, async () => {
        await withHarness(async (h) => {
          const row = { id: 1, name: 'authored' }
          const callback = deferred<string>()
          const terminal = deferred()
          const userEvents: Array<string> = []
          const caller: { state: CallerOutcome; result?: unknown } = {
            state: 'pending',
          }
          const outcome = executeTransaction(
            h.db.db,
            'items',
            'readwrite',
            (tx, stores) => {
              tx.addEventListener(native, () => terminal.resolve())
              const observe = (event: Event) => userEvents.push(event.type)
              if (registration === 'additive') {
                tx.addEventListener('complete', observe)
                tx.addEventListener('abort', observe)
              } else if (registration !== 'none') {
                tx.oncomplete = observe
                tx.onabort = observe
                if (registration === 'replace-property') {
                  tx.oncomplete = () => userEvents.push('replacement-complete')
                  tx.onabort = () => userEvents.push('replacement-abort')
                } else if (registration === 'clear-property') {
                  tx.oncomplete = null
                  tx.onabort = null
                }
              }
              stores.items!.put(row, row.id)
              if (native === 'abort') tx.abort()
              return heldCallback ? callback.promise : 'callback result'
            },
          ).then(
            (value) => {
              caller.state = 'fulfilled'
              caller.result = value
            },
            (error: unknown) => {
              caller.state = 'rejected'
              caller.result = error
            },
          )
          try {
            await terminal.promise
            const durable = await readStore(h.db, 'items')
            expect(
              durable.rows,
              'native outcome determines durable rows',
            ).toEqual(native === 'complete' ? [row] : [])
            expect(caller.state, 'native terminal checkpoint').toBe(
              expectedCaller(native, !heldCallback),
            )
            expect(userEvents, 'wrapper preserves caller observers').toEqual(
              registration === 'none' || registration === 'clear-property'
                ? []
                : [
                    registration === 'replace-property'
                      ? `replacement-${native}`
                      : native,
                  ],
            )
            callback.resolve('callback result')
            await readStore(h.db, 'items')
            expect(caller.state, 'both obligations settled checkpoint').toBe(
              expectedCaller(native, true),
            )
            await outcome
            if (native === 'complete')
              expect(caller.result).toBe('callback result')
            else expect(caller.result).toBeInstanceOf(Error)
          } finally {
            callback.resolve('callback result')
          }
        })
      })
    }
  }
}

// A canceled native request error permits the transaction to commit. This
// neighboring history rejects copying idb's error-event rejection policy into
// this callback API: only terminal complete/abort decides the native obligation.
// The authored seed survives either history; only the valid sibling is conditional.
for (const cancelRequestError of [false, true]) {
  it(`uses terminal outcome after a request error canceled ${cancelRequestError}`, async () => {
    await withHarness(async (h) => {
      const seed = { id: 1, name: 'retained' }
      const sibling = { id: 2, name: 'valid sibling' }
      await executeTransaction(h.db.db, 'items', 'readwrite', (_, stores) => {
        stores.items!.put(seed, seed.id)
      })
      const native: NativeOutcome = cancelRequestError ? 'complete' : 'abort'
      const terminal = deferred()
      const errors: Array<string> = []
      const caller: { state: CallerOutcome; result?: unknown } = {
        state: 'pending',
      }
      const outcome = executeTransaction(
        h.db.db,
        'items',
        'readwrite',
        (tx, stores) => {
          tx.addEventListener(native, () => terminal.resolve())
          const duplicate = stores.items!.add(seed, seed.id)
          duplicate.addEventListener('error', (event) => {
            errors.push(duplicate.error!.name)
            if (cancelRequestError) event.preventDefault()
          })
          stores.items!.put(sibling, sibling.id)
          return 'callback result'
        },
      ).then(
        (value) => {
          caller.state = 'fulfilled'
          caller.result = value
        },
        (error: unknown) => {
          caller.state = 'rejected'
          caller.result = error
        },
      )
      await terminal.promise
      const durable = await readStore(h.db, 'items')
      expect(errors, 'native request-error premise').toEqual([
        'ConstraintError',
      ])
      expect(durable.rows, 'native terminal durability').toEqual(
        cancelRequestError ? [seed, sibling] : [seed],
      )
      expect(caller.state, 'terminal outcome controls caller settlement').toBe(
        expectedCaller(native, true),
      )
      await outcome
      if (cancelRequestError) expect(caller.result).toBe('callback result')
      else expect(caller.result).toMatchObject({ name: 'ConstraintError' })
    })
  })
}
