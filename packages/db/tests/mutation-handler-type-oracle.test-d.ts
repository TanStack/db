import { describe, expectTypeOf, it } from 'vitest'
import { CollectionImpl, createCollection } from '../src/collection/index.js'
import type { Transaction, TransactionState } from '../src/index.js'

/**
 * Law and source: a collection mutation handler receives one homogeneous direct
 * operation, so every nested mutation carries the same row, key, and utilities
 * as the sibling `collection` parameter. `isPersisted.promise` remains the
 * documented local transaction-settlement receipt, not backend confirmation.
 *
 * Domain: insert/update/delete; branded-string and numeric keys; incompatible
 * authoritative-sync and refetch utility records.
 * Judgment: compare each inferred boundary with independently declared types.
 * Production path: contextual handler types produced by `createCollection`.
 * Observe: operation, row, key, collection key/utilities, state, and receipt.
 * Challenge: explicit `IsAny` checks plus wrong-key and cross-utility mutants.
 */
type IsAny<T> = 0 extends 1 & T ? true : false

type Row<TKey extends string | number> = {
  id: TKey
  value: string
}

type AuthoritativeSyncUtils = {
  awaitTxId: (txid: number) => Promise<void>
}

type RefetchUtils = {
  refetch: () => Promise<void>
}

type BrandedKey = string & { readonly __brand: `row-key` }

describe(`mutation handler type oracle`, () => {
  it(`preserves the utility namespace on the concrete collection implementation`, () => {
    const collection = new CollectionImpl<
      Row<BrandedKey>,
      BrandedKey,
      AuthoritativeSyncUtils,
      never,
      Row<BrandedKey>
    >({
      getKey: (row) => row.id,
      sync: { sync: () => {} },
      utils: {
        awaitTxId: () => Promise.resolve(),
      },
    })

    expectTypeOf(collection.utils).toEqualTypeOf<AuthoritativeSyncUtils>()
    expectTypeOf(collection.config.utils).toEqualTypeOf<
      AuthoritativeSyncUtils | undefined
    >()
    expectTypeOf(collection.utils.awaitTxId).toEqualTypeOf<
      AuthoritativeSyncUtils[`awaitTxId`]
    >()
    // @ts-expect-error the concrete collection preserves its closed utility namespace
    collection.utils.refetch()

    new CollectionImpl<
      Row<BrandedKey>,
      BrandedKey,
      AuthoritativeSyncUtils,
      never,
      Row<BrandedKey>
    >({
      getKey: (row) => row.id,
      sync: { sync: () => {} },
      utils: {
        // @ts-expect-error the declared utilities must match the runtime object
        refetch: () => Promise.resolve(),
      },
    })

    new CollectionImpl<
      Row<BrandedKey>,
      BrandedKey,
      AuthoritativeSyncUtils,
      never,
      Row<BrandedKey>
    >(
      // @ts-expect-error a closed utility namespace requires its runtime object
      {
        getKey: (row) => row.id,
        sync: { sync: () => {} },
      },
    )
  })

  it(`preserves a branded key and authoritative-sync utility through every mutation`, () => {
    createCollection<Row<BrandedKey>, BrandedKey, AuthoritativeSyncUtils>({
      getKey: (row) => row.id,
      sync: { sync: () => {} },
      utils: {
        awaitTxId: () => Promise.resolve(),
      },
      onInsert: ({ transaction, collection }) => {
        const mutation = transaction.mutations[0]

        expectTypeOf(mutation.type).toEqualTypeOf<`insert`>()
        expectTypeOf(mutation.modified).toEqualTypeOf<Row<BrandedKey>>()
        expectTypeOf(mutation.key).toEqualTypeOf<BrandedKey>()
        expectTypeOf<IsAny<typeof mutation.key>>().toEqualTypeOf<false>()
        expectTypeOf(mutation.collection.get)
          .parameter(0)
          .toEqualTypeOf<BrandedKey>()
        expectTypeOf(mutation.collection.utils.awaitTxId).toEqualTypeOf<
          AuthoritativeSyncUtils[`awaitTxId`]
        >()
        expectTypeOf(collection.utils).toEqualTypeOf<AuthoritativeSyncUtils>()
        expectTypeOf(transaction.state).toEqualTypeOf<TransactionState>()
        expectTypeOf(transaction.isPersisted.promise).toEqualTypeOf<
          Promise<Transaction<Row<BrandedKey>>>
        >()

        // @ts-expect-error a branded string key is never a number
        const _wrongKey: number = mutation.key
        // @ts-expect-error this collection only exposes authoritative-sync utilities
        mutation.collection.utils.refetch()
        return Promise.resolve()
      },
      onUpdate: ({ transaction }) => {
        const mutation = transaction.mutations[0]

        expectTypeOf(mutation.type).toEqualTypeOf<`update`>()
        expectTypeOf(mutation.original).toEqualTypeOf<Row<BrandedKey>>()
        expectTypeOf(mutation.key).toEqualTypeOf<BrandedKey>()
        expectTypeOf<IsAny<typeof mutation.key>>().toEqualTypeOf<false>()
        expectTypeOf(mutation.collection.utils.awaitTxId).toEqualTypeOf<
          AuthoritativeSyncUtils[`awaitTxId`]
        >()

        // @ts-expect-error a branded string key is never a number
        const _wrongKey: number = mutation.key
        // @ts-expect-error this collection only exposes authoritative-sync utilities
        mutation.collection.utils.refetch()
        return Promise.resolve()
      },
      onDelete: ({ transaction }) => {
        const mutation = transaction.mutations[0]

        expectTypeOf(mutation.type).toEqualTypeOf<`delete`>()
        expectTypeOf(mutation.original).toEqualTypeOf<Row<BrandedKey>>()
        expectTypeOf(mutation.key).toEqualTypeOf<BrandedKey>()
        expectTypeOf<IsAny<typeof mutation.key>>().toEqualTypeOf<false>()
        expectTypeOf(mutation.collection.utils.awaitTxId).toEqualTypeOf<
          AuthoritativeSyncUtils[`awaitTxId`]
        >()

        // @ts-expect-error a branded string key is never a number
        const _wrongKey: number = mutation.key
        // @ts-expect-error this collection only exposes authoritative-sync utilities
        mutation.collection.utils.refetch()
        return Promise.resolve()
      },
    })
  })

  it(`keeps numeric keys and refetch utilities distinct from the sync shape`, () => {
    createCollection<Row<number>, number, RefetchUtils>({
      getKey: (row) => row.id,
      sync: { sync: () => {} },
      utils: {
        refetch: () => Promise.resolve(),
      },
      onInsert: ({ transaction }) => {
        const mutation = transaction.mutations[0]

        expectTypeOf(mutation.key).toEqualTypeOf<number>()
        expectTypeOf<IsAny<typeof mutation.key>>().toEqualTypeOf<false>()
        expectTypeOf(mutation.collection.utils.refetch).toEqualTypeOf<
          RefetchUtils[`refetch`]
        >()

        // @ts-expect-error a numeric key is never a string
        const _wrongKey: string = mutation.key
        // @ts-expect-error this collection only exposes refetch utilities
        mutation.collection.utils.awaitTxId(1)
        return Promise.resolve()
      },
      onUpdate: ({ transaction }) => {
        const mutation = transaction.mutations[0]

        expectTypeOf(mutation.key).toEqualTypeOf<number>()
        expectTypeOf<IsAny<typeof mutation.key>>().toEqualTypeOf<false>()
        expectTypeOf(mutation.collection.utils.refetch).toEqualTypeOf<
          RefetchUtils[`refetch`]
        >()

        // @ts-expect-error a numeric key is never a string
        const _wrongKey: string = mutation.key
        // @ts-expect-error this collection only exposes refetch utilities
        mutation.collection.utils.awaitTxId(1)
        return Promise.resolve()
      },
      onDelete: ({ transaction }) => {
        const mutation = transaction.mutations[0]

        expectTypeOf(mutation.key).toEqualTypeOf<number>()
        expectTypeOf<IsAny<typeof mutation.key>>().toEqualTypeOf<false>()
        expectTypeOf(mutation.collection.utils.refetch).toEqualTypeOf<
          RefetchUtils[`refetch`]
        >()

        // @ts-expect-error a numeric key is never a string
        const _wrongKey: string = mutation.key
        // @ts-expect-error this collection only exposes refetch utilities
        mutation.collection.utils.awaitTxId(1)
        return Promise.resolve()
      },
    })
  })
})
