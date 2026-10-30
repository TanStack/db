// Ordinary tests for manual transactions: fixed failed-callback and replacement
// histories with literal expectations. They are supplemental coverage. The
// transaction laws are owned by optimistic-transaction-oracle.property.test.ts,
// and the optimistic snapshot law by optimistic-history-oracle.ts.
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createTransaction } from '../src/transactions.js'
import { withHistoryCleanup } from './optimistic-history-oracle.js'
import type { ReplacementRow, Row } from './optimistic-transaction-support.js'

/**
 * A failed synchronous mutate callback contributes no lasting intent. This
 * bounded history may author a valid update, then throws after a same-key
 * update, a distinct insert, or a delete. The reference retains only the
 * successful callbacks. The real manual transaction must expose those rows
 * and payload at the throw cut, then persist only successful callbacks. A
 * second witness crosses two Collections, including a subscriber failure
 * during restoration. This pending-transaction grammar does not claim to hide
 * events emitted during the failed callback.
 */
describe(`failed manual mutation callback`, () => {
  it(`does not copy prior mutations for a callback with no writes`, async () => {
    const collection = createCollection<Row>({
      getKey: (row) => row.id,
      sync: {
        sync: (actions) => {
          actions.begin()
          actions.commit()
          actions.markReady()
        },
      },
    })
    const tx = createTransaction<Row>({
      autoCommit: false,
      mutationFn: () => Promise.resolve(),
    })
    await withHistoryCleanup(
      async () => {
        await collection.preload()
        for (let id = 1; id <= 16; id++)
          tx.mutate(() => collection.insert({ id, value: id, note: `prior` }))
        const mutations = tx.mutations
        let visits = 0
        tx.mutations = new Proxy(mutations, {
          get(target, property, receiver) {
            if (property === Symbol.iterator)
              return function* () {
                for (const mutation of target) {
                  visits++
                  yield mutation
                }
              }
            return Reflect.get(target, property, receiver)
          },
        })
        for (let index = 0; index < 5; index++) tx.mutate(() => {})
        expect(visits, `no snapshot traversal without a write`).toBe(0)
        expect(tx.mutations).toHaveLength(16)
        tx.mutations = mutations
      },
      () => [
        () => tx.rollback({ isSecondaryRollback: true }),
        () => collection.cleanup(),
      ],
    )
  })

  for (const failure of [
    `same-key update`,
    `distinct insert`,
    `same-key delete`,
  ] as const)
    for (const prior of [false, true])
      it(`restores ${prior ? `earlier intent` : `the base`} after ${failure}`, async () => {
        const collection = createCollection<Row>({
          getKey: (row) => row.id,
          sync: {
            sync: (actions) => {
              actions.begin()
              actions.write({
                type: `insert`,
                value: { id: 1, value: 0, note: `base` },
              })
              actions.commit()
              actions.markReady()
            },
          },
        })
        const payloads: Array<Array<{ id: number; value: number }>> = []
        const tx = createTransaction<Row>({
          autoCommit: false,
          mutationFn: ({ transaction }) => {
            payloads.push(
              transaction.mutations.map(({ modified }) => ({
                id: modified.id,
                value: modified.value,
              })),
            )
            return Promise.resolve()
          },
        })
        await withHistoryCleanup(
          async () => {
            await collection.preload()
            if (prior)
              tx.mutate(() =>
                collection.update(1, (draft) => {
                  draft.value = 1
                }),
              )
            const failureReason = new Error(`callback failed`)
            expect(() =>
              tx.mutate(() => {
                if (failure === `same-key update`)
                  collection.update(1, (draft) => {
                    draft.value = 2
                  })
                else if (failure === `distinct insert`)
                  collection.insert({ id: 2, value: 2, note: `failed` })
                else collection.delete(1)
                throw failureReason
              }),
            ).toThrow(failureReason)
            expect(collection.get(1)?.value, `successful row survives`).toBe(
              prior ? 1 : 0,
            )
            expect(collection.get(2), `failed insert is absent`).toBeUndefined()
            const survivingIntent = prior ? [{ id: 1, value: 1 }] : []
            expect(
              tx.mutations.map(({ modified }) => ({
                id: modified.id,
                value: modified.value,
              })),
              `failed intent is absent`,
            ).toEqual(survivingIntent)
            tx.mutate(() =>
              collection.insert({ id: 3, value: 3, note: `later` }),
            )
            await tx.commit()
            expect(payloads).toEqual([
              [...survivingIntent, { id: 3, value: 3 }],
            ])
          },
          () => [() => collection.cleanup()],
        )
      })

  it(`restores every touched Collection and keeps earlier intent`, async () => {
    const makeCollection = (id: string, initial: Array<Row>) =>
      createCollection<Row>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: (actions) => {
            actions.begin()
            for (const row of initial)
              actions.write({ type: `insert`, value: row })
            actions.commit()
            actions.markReady()
          },
        },
      })
    const first = makeCollection(`failed-callback-first`, [
      { id: 1, value: 0, note: `base` },
    ])
    const second = makeCollection(`failed-callback-second`, [])
    const tx = createTransaction<Row>({
      autoCommit: false,
      mutationFn: () => Promise.resolve(),
    })
    await withHistoryCleanup(
      async () => {
        await Promise.all([first.preload(), second.preload()])
        tx.mutate(() =>
          first.update(1, (draft) => {
            draft.value = 1
          }),
        )
        const failureReason = new Error(`callback failed`)
        expect(() =>
          tx.mutate(() => {
            first.update(1, (draft) => {
              draft.value = 2
            })
            second.insert({ id: 2, value: 2, note: `failed` })
            throw failureReason
          }),
        ).toThrow(failureReason)
        expect(first.get(1)?.value).toBe(1)
        expect(second.get(2)).toBeUndefined()
        expect(tx.mutations).toHaveLength(1)
        await tx.commit()
      },
      () => [() => first.cleanup(), () => second.cleanup()],
    )
  })

  it(`restores every Collection when one restoration listener throws`, async () => {
    const makeCollection = (id: string) =>
      createCollection<Row>({
        id,
        getKey: (row) => row.id,
        sync: {
          sync: (actions) => {
            actions.begin()
            actions.write({
              type: `insert`,
              value: { id: 1, value: 0, note: `base` },
            })
            actions.commit()
            actions.markReady()
          },
        },
      })
    const first = makeCollection(`failed-listener-first`)
    const second = makeCollection(`failed-listener-second`)
    const tx = createTransaction<Row>({
      autoCommit: false,
      mutationFn: () => Promise.resolve(),
    })
    let subscription: ReturnType<typeof first.subscribeChanges> | undefined
    await withHistoryCleanup(
      async () => {
        await Promise.all([first.preload(), second.preload()])
        tx.mutate(() =>
          first.update(1, (draft) => {
            draft.value = 1
          }),
        )
        const listenerFailure = new Error(`restoration listener failed`)
        subscription = first.subscribeChanges(
          (batch) => {
            if (batch.some((change) => change.value.value === 1))
              throw listenerFailure
          },
          { includeInitialState: false },
        )
        const callbackFailure = new Error(`callback failed`)
        let thrown: unknown
        try {
          tx.mutate(() => {
            first.update(1, (draft) => {
              draft.value = 2
            })
            second.update(1, (draft) => {
              draft.value = 2
            })
            throw callbackFailure
          })
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBeInstanceOf(AggregateError)
        expect((thrown as AggregateError).cause).toBe(callbackFailure)
        expect((thrown as AggregateError).errors).toContain(listenerFailure)
        expect(first.get(1)?.value).toBe(1)
        expect(second.get(1)?.value).toBe(0)
        expect(tx.mutations.map(({ modified }) => modified.value)).toEqual([1])
      },
      () => [
        () => subscription?.unsubscribe(),
        () => first.cleanup(),
        () => second.cleanup(),
      ],
    )
  })

  /**
   * The transaction context belongs to the synchronous mutate callback. A
   * subscriber responding to restoration runs after that callback has thrown,
   * so its new write is independent. The reference classifies intent by the
   * authoring action: the failed callback contributes none, while the later
   * subscriber contributes its own row. At the throw and commit cuts, the
   * failed transaction must not contain or persist the subscriber's row.
   */
  it(`keeps a restoration subscriber write out of the failed callback transaction`, async () => {
    const collection = createCollection<Row>({
      getKey: (row) => row.id,
      onInsert: () => Promise.resolve(),
      sync: {
        sync: (actions) => {
          actions.begin()
          actions.write({
            type: `insert`,
            value: { id: 1, value: 0, note: `base` },
          })
          actions.commit()
          actions.markReady()
        },
      },
    })
    const payloads: Array<Array<number>> = []
    const tx = createTransaction<Row>({
      autoCommit: false,
      mutationFn: ({ transaction }) => {
        payloads.push(transaction.mutations.map(({ modified }) => modified.id))
        return Promise.resolve()
      },
    })
    let subscription: ReturnType<typeof collection.subscribeChanges> | undefined
    await withHistoryCleanup(
      async () => {
        await collection.preload()
        let restored = false
        subscription = collection.subscribeChanges(
          (batch) => {
            if (
              !restored &&
              batch.some(
                (change) => change.value.id === 1 && change.value.value === 0,
              )
            ) {
              restored = true
              collection.insert({ id: 3, value: 3, note: `subscriber` })
            }
          },
          { includeInitialState: false },
        )
        const failure = new Error(`callback failed`)
        expect(() =>
          tx.mutate(() => {
            collection.update(1, (draft) => {
              draft.value = 2
            })
            throw failure
          }),
        ).toThrow(failure)
        expect(restored, `restoration reached the subscriber`).toBe(true)
        expect(collection.get(1)?.value).toBe(0)
        expect(collection.get(3)?.value).toBe(3)
        expect(
          tx.mutations.map(({ modified }) => modified.id),
          `subscriber intent has a separate owner`,
        ).toEqual([])
        await tx.commit()
        expect(
          payloads,
          `failed transaction persisted no subscriber write`,
        ).toEqual([])
      },
      () => [() => subscription?.unsubscribe(), () => collection.cleanup()],
    )
  })

  /**
   * Nested mutate calls use one transaction context per callback frame. After
   * the inner frame returns or throws, the outer frame still owns later
   * Collection writes. The reference retains the inner row only on success
   * and always retains the outer row authored after the inner cut.
   */
  for (const nestedFails of [false, true])
    it(`keeps the outer transaction active after a nested ${nestedFails ? `failure` : `success`}`, async () => {
      const collection = createCollection<Row>({
        getKey: (row) => row.id,
        sync: {
          sync: (actions) => {
            actions.begin()
            actions.commit()
            actions.markReady()
          },
        },
      })
      const payloads: Array<Array<number>> = []
      const tx = createTransaction<Row>({
        autoCommit: false,
        mutationFn: ({ transaction }) => {
          payloads.push(
            transaction.mutations.map(({ modified }) => modified.id),
          )
          return Promise.resolve()
        },
      })
      await withHistoryCleanup(
        async () => {
          await collection.preload()
          tx.mutate(() => {
            const inner = () =>
              tx.mutate(() => {
                collection.insert({ id: 2, value: 2, note: `inner` })
                if (nestedFails) throw new Error(`inner failed`)
              })
            if (nestedFails) expect(inner).toThrow(`inner failed`)
            else inner()
            collection.insert({ id: 3, value: 3, note: `outer` })
          })
          const expected = nestedFails ? [3] : [2, 3]
          expect(tx.mutations.map(({ modified }) => modified.id)).toEqual(
            expected,
          )
          await tx.commit()
          expect(payloads).toEqual([expected])
        },
        () => [() => collection.cleanup()],
      )
    })
})

describe(`Delete then insert transaction laws`, () => {
  it(`delivers a replacement after duplicate deletes of another overlay`, async () => {
    const original = { id: 1, value: 0, note: `original` }
    const overlaid = { id: 1, value: 1, note: `original` }
    const collection = createCollection<ReplacementRow, number>({
      getKey: (row) => row.id,
      sync: {
        sync: (actions) => {
          actions.begin()
          actions.write({ type: `insert`, value: original })
          actions.commit()
          actions.markReady()
        },
      },
    })
    let rejectOverlay!: (error: Error) => void
    const overlayGate = new Promise<void>((_resolve, reject) => {
      rejectOverlay = reject
    })
    const overlay = createTransaction<ReplacementRow>({
      autoCommit: false,
      mutationFn: () => overlayGate,
    })
    let deliveries = 0
    let delivered: ReplacementRow | undefined
    const replacement = createTransaction<ReplacementRow>({
      autoCommit: false,
      mutationFn: ({ transaction }) => {
        deliveries++
        delivered = transaction.mutations[0].modified
        return Promise.resolve()
      },
    })
    const overlaySettlement = overlay.when('settled').catch(() => undefined)
    const replacementSettlement = replacement
      .when('settled')
      .catch(() => undefined)

    await withHistoryCleanup(
      async () => {
        await collection.preload()
        overlay.mutate(() =>
          collection.update(1, (draft) => {
            draft.value = 1
          }),
        )
        const overlayCommit = overlay.commit().catch(() => undefined)
        await Promise.resolve()

        replacement.mutate(() => {
          collection.delete([1, 1])
          collection.insert(overlaid)
        })
        await replacement.commit()

        expect(deliveries, `replacement persistence delivery count`).toBe(1)
        expect(delivered, `replacement server payload`).toStrictEqual(overlaid)

        rejectOverlay(new Error(`earlier overlay failed`))
        await overlayCommit
      },
      () => [
        () => {
          if (overlay.state === `pending` || overlay.state === `persisting`)
            overlay.rollback()
        },
        () => {
          if (
            replacement.state === `pending` ||
            replacement.state === `persisting`
          )
            replacement.rollback()
        },
        () => rejectOverlay(new Error(`overlay test cleanup`)),
        () => overlaySettlement,
        () => replacementSettlement,
        () => collection.cleanup(),
      ],
    )
  })

  it(`delivers a replacement equal only to another pending insert`, async () => {
    const inserted = { id: 1, value: 1, note: `inserted` }
    const collection = createCollection<ReplacementRow, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => markReady(),
      },
    })
    let rejectInsert!: (error: Error) => void
    const insertGate = new Promise<void>((_resolve, reject) => {
      rejectInsert = reject
    })
    const pendingInsert = createTransaction<ReplacementRow>({
      autoCommit: false,
      mutationFn: () => insertGate,
    })
    let deliveries = 0
    let delivered: { type: string; modified: ReplacementRow } | undefined
    const replacement = createTransaction<ReplacementRow>({
      autoCommit: false,
      mutationFn: ({ transaction }) => {
        deliveries++
        const mutation = transaction.mutations[0]
        delivered = {
          type: mutation.type,
          modified: mutation.modified,
        }
        return Promise.resolve()
      },
    })
    const insertSettlement = pendingInsert
      .when('settled')
      .catch(() => undefined)
    const replacementSettlement = replacement
      .when('settled')
      .catch(() => undefined)

    await withHistoryCleanup(
      async () => {
        await collection.preload()
        pendingInsert.mutate(() => collection.insert(inserted))
        const insertCommit = pendingInsert.commit().catch(() => undefined)
        await Promise.resolve()

        replacement.mutate(() => {
          collection.delete(1)
          collection.insert(inserted)
        })
        await replacement.commit()

        expect(deliveries, `replacement persistence delivery count`).toBe(1)
        expect(delivered, `replacement server mutation`).toStrictEqual({
          type: `insert`,
          modified: inserted,
        })

        rejectInsert(new Error(`earlier insert failed`))
        await insertCommit
      },
      () => [
        () => {
          if (
            pendingInsert.state === `pending` ||
            pendingInsert.state === `persisting`
          )
            pendingInsert.rollback()
        },
        () => {
          if (
            replacement.state === `pending` ||
            replacement.state === `persisting`
          )
            replacement.rollback()
        },
        () => rejectInsert(new Error(`insert test cleanup`)),
        () => insertSettlement,
        () => replacementSettlement,
        () => collection.cleanup(),
      ],
    )
  })
})
