/**
 * Preact receives the shared inline-option binding law through its real hook.
 * The finite grammar varies each configured option and query/key identity.
 * Three ordinary rerenders, a source publication and identity replacement are
 * observed at Preact commit after its native act flush. A render budget catches
 * repeated reconstruction. Preact has no DbClient input; cache admission is
 * therefore not its public receiving boundary.
 */
import { createCollection, gt } from '@tanstack/db'
import { act } from 'preact/test-utils'
import { afterAll, expect, test } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery'
import {
  mockSyncCollectionOptions,
  withOracleCleanup,
} from '../../db/tests/utils'
import {
  boundOptionHistories,
  captureBoundOptions,
  checkBoundOptions,
} from '../../db/tests/live-query-bound-options-oracle'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { renderHook, settle } from './render-probe'
import type { InitialQueryBuilder } from '@tanstack/db'

type Row = { id: string; label: string; rank: number }
const reach = createOracleReach(`Preact bound options`, [
  `rerender`,
  `source-update`,
  `identity-change`,
  `getKey`,
  `schema`,
  `both`,
  `query`,
  `queryKey`,
])
afterAll(() => {
  reach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `Preact bound option reach`,
      Object.fromEntries(reach.counts()),
    )
})
declareOracle({ check: [checkBoundOptions], grammar: [boundOptionHistories] })
test.each(boundOptionHistories)(
  `Preact retains bound options %j`,
  async ({ option, identity }) => {
    reach.beginHistory()
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `preact-bound-options`,
        getKey: (row) => row.id,
        initialData: [{ id: `one`, label: `before`, rank: 1 }],
      }),
    )
    const collections = new Set<{ cleanup: () => Promise<void> }>()
    let renders = 0
    let unmount: (() => void) | undefined
    await withOracleCleanup(async () => {
      const hook = renderHook(
        ({ revision }: { revision: number }) => {
          if (++renders > 30)
            throw new Error(`inline options rebuilt on every render`)
          const config = {
            query: (q: InitialQueryBuilder) =>
              q
                .from({ row: source })
                .where(({ row }) =>
                  gt(row.rank, identity === `query` ? -revision : 0),
                ),
            ...(identity === `queryKey` ? { queryKey: [revision] } : {}),
            ...(option !== `schema`
              ? { getKey: (row: Row) => `bound-${revision}-${row.id}` }
              : {}),
          }
          if (option !== `getKey`)
            Object.assign(config, {
              schema: {
                '~standard': {
                  version: 1,
                  vendor: `bound-options`,
                  validate: (value: unknown) => ({ value }),
                },
              },
            })
          const result = useLiveQuery(config)
          collections.add(result.collection)
          return result
        },
        { initialProps: { revision: 0 } },
      )
      unmount = hook.unmount
      await settle()
      const initial = captureBoundOptions(hook.result.current.collection)
      for (let turn = 0; turn < 3; turn++) {
        hook.rerender({ revision: 0 })
        await settle()
        checkBoundOptions(
          initial,
          hook.result.current.collection,
          false,
          option,
        )
        reach.reach(`rerender`)
      }
      act(() => {
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: { id: `one`, label: `after`, rank: 1 },
        })
        source.utils.commit()
      })
      await settle()
      checkBoundOptions(initial, hook.result.current.collection, false, option)
      expect(
        hook.result.current.data.map((row: Row) => ({
          id: row.id,
          label: row.label,
        })),
      ).toEqual([{ id: `one`, label: `after` }])
      reach.reach(`source-update`)
      hook.rerender({ revision: 1 })
      await settle()
      checkBoundOptions(initial, hook.result.current.collection, true, option)
      expect([...hook.result.current.state.keys()]).toEqual([
        option === `schema` ? `one` : `bound-1-one`,
      ])
      reach.reach(`identity-change`)
      reach.reach(option)
      reach.reach(identity)
    }, [
      () => unmount?.(),
      () =>
        withOracleCleanup(() => {}, [
          ...[...collections].map((collection) => () => collection.cleanup()),
          () => source.cleanup({ dependents: true }),
        ]),
    ])
  },
)

// Same-Collection config mutation must not mutate the expected references too.
test.each(boundOptionHistories)(
  `bound-option checker rejects in-place replacement %j`,
  ({ option }) => {
    const collection = { config: { getKey: () => `initial`, schema: {} } }
    const initial = captureBoundOptions(collection)
    if (option !== `schema`) collection.config.getKey = () => `replacement`
    if (option !== `getKey`) collection.config.schema = {}
    expect(() =>
      checkBoundOptions(initial, collection, false, option),
    ).toThrow()
  },
)
