import { describe, expectTypeOf, it } from 'vitest'
import { createCollection, createOptimisticAction } from '../src/index.js'
import type { OperationConfig } from '../src/types.js'

/**
 * Law and source: collection keys are exact identity values. `get`, `delete`,
 * direct `update`, action-owned `update`, and emitted update mutations must all
 * preserve the collection's declared `TKey` without admitting sibling key
 * domains or erasing a brand.
 *
 * Domain: numeric, string, and branded-string keys; single and bulk updates;
 * config and no-config overloads; direct and optimistic-action-owned calls.
 * Judgment: compare callback and handler boundaries with independently declared
 * row/key types, and require wrong-key calls to fail compilation.
 * Challenge: widening update keys to `unknown` or `string | number` makes the
 * corresponding `@ts-expect-error` controls unused.
 */
type Row<TKey extends string | number> = {
  id: TKey
  title: string
}

type BrandedKey = string & { readonly __brand: `collection-row` }

const operationConfig: OperationConfig = {
  metadata: { source: `collection-update-key-types` },
}

const numberCollection = createCollection<Row<number>, number>({
  getKey: (row) => row.id,
  sync: { sync: () => {} },
  onUpdate: ({ transaction }) => {
    expectTypeOf(transaction.mutations[0].key).toEqualTypeOf<number>()
    return Promise.resolve()
  },
})

const stringCollection = createCollection<Row<string>, string>({
  getKey: (row) => row.id,
  sync: { sync: () => {} },
  onUpdate: ({ transaction }) => {
    expectTypeOf(transaction.mutations[0].key).toEqualTypeOf<string>()
    return Promise.resolve()
  },
})

const brandedCollection = createCollection<Row<BrandedKey>, BrandedKey>({
  getKey: (row) => row.id,
  sync: { sync: () => {} },
  onUpdate: ({ transaction }) => {
    expectTypeOf(transaction.mutations[0].key).toEqualTypeOf<BrandedKey>()
    return Promise.resolve()
  },
})

const brandedKey = `branded-1` as BrandedKey

describe(`Collection.update key types`, () => {
  it(`preserves numeric keys across direct overloads`, () => {
    numberCollection.update(1, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<Row<number>>()
    })
    numberCollection.update([1, 2], (drafts) => {
      expectTypeOf(drafts).toEqualTypeOf<Array<Row<number>>>()
    })
    numberCollection.update(1, operationConfig, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<Row<number>>()
    })
    numberCollection.update([1, 2], operationConfig, (drafts) => {
      expectTypeOf(drafts).toEqualTypeOf<Array<Row<number>>>()
    })

    // @ts-expect-error numeric collections reject string keys
    numberCollection.update(`1`, () => {})
    // @ts-expect-error numeric collections reject string key arrays
    numberCollection.update([`1`], () => {})
    // @ts-expect-error config overloads preserve the numeric key
    numberCollection.update(`1`, operationConfig, () => {})
    // @ts-expect-error bulk config overloads preserve the numeric key
    numberCollection.update([`1`], operationConfig, () => {})
  })

  it(`preserves string keys across direct overloads`, () => {
    stringCollection.update(`1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<Row<string>>()
    })
    stringCollection.update([`1`, `2`], (drafts) => {
      expectTypeOf(drafts).toEqualTypeOf<Array<Row<string>>>()
    })
    stringCollection.update(`1`, operationConfig, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<Row<string>>()
    })
    stringCollection.update([`1`, `2`], operationConfig, (drafts) => {
      expectTypeOf(drafts).toEqualTypeOf<Array<Row<string>>>()
    })

    // @ts-expect-error string collections reject numeric keys
    stringCollection.update(1, () => {})
    // @ts-expect-error string collections reject numeric key arrays
    stringCollection.update([1], () => {})
    // @ts-expect-error config overloads preserve the string key
    stringCollection.update(1, operationConfig, () => {})
    // @ts-expect-error bulk config overloads preserve the string key
    stringCollection.update([1], operationConfig, () => {})
  })

  it(`preserves branded keys across direct overloads`, () => {
    brandedCollection.update(brandedKey, (draft) => {
      expectTypeOf(draft.title).toEqualTypeOf<string>()
    })
    brandedCollection.update([brandedKey], (drafts) => {
      expectTypeOf(drafts[0]!.title).toEqualTypeOf<string>()
    })
    brandedCollection.update(brandedKey, operationConfig, (draft) => {
      expectTypeOf(draft.title).toEqualTypeOf<string>()
    })
    brandedCollection.update([brandedKey], operationConfig, (drafts) => {
      expectTypeOf(drafts[0]!.title).toEqualTypeOf<string>()
    })

    // @ts-expect-error plain strings cannot erase the key brand
    brandedCollection.update(`branded-1`, () => {})
    // @ts-expect-error plain string arrays cannot erase the key brand
    brandedCollection.update([`branded-1`], () => {})
    // @ts-expect-error config overloads preserve the key brand
    brandedCollection.update(`branded-1`, operationConfig, () => {})
    // @ts-expect-error bulk config overloads preserve the key brand
    brandedCollection.update([`branded-1`], operationConfig, () => {})
  })

  it(`preserves exact keys inside optimistic actions`, () => {
    createOptimisticAction<{
      numberKey: number
      stringKey: string
      brandedKey: BrandedKey
    }>({
      onMutate: ({ numberKey, stringKey, brandedKey: actionBrandedKey }) => {
        numberCollection.update(numberKey, () => {})
        numberCollection.update([numberKey], operationConfig, () => {})
        stringCollection.update(stringKey, operationConfig, () => {})
        stringCollection.update([stringKey], () => {})
        brandedCollection.update(actionBrandedKey, () => {})
        brandedCollection.update([actionBrandedKey], operationConfig, () => {})

        // @ts-expect-error action ownership does not widen numeric keys
        numberCollection.update(stringKey, () => {})
        // @ts-expect-error action ownership does not widen numeric key arrays
        numberCollection.update([stringKey], operationConfig, () => {})
        // @ts-expect-error action ownership does not widen string keys
        stringCollection.update(numberKey, operationConfig, () => {})
        // @ts-expect-error action ownership does not widen string key arrays
        stringCollection.update([numberKey], () => {})
        // @ts-expect-error action ownership does not erase a key brand
        brandedCollection.update(stringKey, () => {})
        // @ts-expect-error action ownership does not erase branded key arrays
        brandedCollection.update([stringKey], operationConfig, () => {})
      },
      mutationFn: async () => {},
    })
  })

  it(`keeps get, delete, and mutation-handler keys exact as controls`, () => {
    expectTypeOf(numberCollection.get).parameter(0).toEqualTypeOf<number>()
    expectTypeOf(stringCollection.get).parameter(0).toEqualTypeOf<string>()
    expectTypeOf(brandedCollection.get).parameter(0).toEqualTypeOf<BrandedKey>()

    numberCollection.get(1)
    stringCollection.delete(`1`)
    brandedCollection.delete(brandedKey)

    // @ts-expect-error get already rejects a sibling key domain
    numberCollection.get(`1`)
    // @ts-expect-error delete already rejects a sibling key domain
    stringCollection.delete(1)
    // @ts-expect-error delete already preserves branded keys
    brandedCollection.delete(`branded-1`)
  })
})
