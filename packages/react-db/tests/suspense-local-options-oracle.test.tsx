/**
 * The shared independent-caller law receives real React Suspense mounts in
 * unscoped and DbClient scopes. Each option varies alone over absent/equal/
 * different declarations, with derived, same and different explicit keys.
 * Public output identity and supplied config references are checked after
 * each committed mount and the first is checked again after its peer mounts.
 * These mounts create no reusable DbClient preload record. Cached-result
 * getKey/schema conflicts are judged by cache-options-oracle's warm driver.
 * This receiver makes no server-render or hydration scheduling claim.
 */
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { DbClient, createCollection } from '@tanstack/db'
import { expect, test } from 'vitest'
import { DbProvider } from '../src/DbProvider'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import {
  checkLocalOptionSharing,
  compatibleLocalOptions,
  localOptionPairs,
} from '../../db/tests/live-query-cache-options-oracle'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  mockSyncCollectionOptions,
  withOracleCleanup,
} from '../../db/tests/utils'
import type { Collection, Context, InitialQueryBuilder } from '@tanstack/db'
import type { UseLiveQueryConfig } from '../src/useLiveQuery'
import type { ReactNode } from 'react'

declareOracle({
  grammar: [localOptionPairs],
  model: [compatibleLocalOptions],
  check: [checkLocalOptionSharing],
})
const histories = localOptionPairs.flatMap((history, cell) =>
  ([`unscoped`, `client`] as const).map((scope) => ({
    ...history,
    scope,
    cell,
  })),
)

test.each(histories)(
  `independent Suspense output options: %j`,
  async (history) => {
    const reach = createOracleReach(
      `Suspense local options/${history.scope}/${history.cell}`,
      [`first-output`, `second-output`, `retained-first`],
    )
    reach.beginHistory()
    const client = history.scope === `client` ? new DbClient() : undefined
    type Row = { id: string }
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `local-options-${history.scope}-${history.cell}`,
        getKey: (row) => row.id,
        initialData: [{ id: `one` }],
      }),
    )
    const query = (q: InitialQueryBuilder) => q.from({ row: source })
    const schema = () => ({
      '~standard': {
        version: 1,
        vendor: `local-options`,
        validate: (value: unknown) => ({ value }),
      },
    })
    const fixtures = {
      getKey: [
        (row: Row) => `first-${row.id}`,
        (row: Row) => `other-${row.id}`,
      ],
      schema: [schema(), schema()],
      onInsert: [async () => {}, async () => {}],
      onUpdate: [async () => {}, async () => {}],
      onDelete: [async () => {}, async () => {}],
      id: [`first`, `other`],
      startSync: [false, true],
      gcTime: [0, 10000],
      singleResult: [true],
      defaultStringCollation: [
        { stringSort: `lexical` },
        { stringSort: `lexical` },
      ],
    } satisfies Record<
      Exclude<
        keyof UseLiveQueryConfig<Context>,
        | `query`
        | `queryKey`
        | `client`
        | `pool`
        | `autoIndex`
        | `defaultIndexType`
      >,
      ReadonlyArray<unknown>
    >
    const values = {
      absent: undefined,
      first: fixtures[history.option][0],
      other: fixtures[history.option][1],
    }
    function Wrapper({ children }: { children: ReactNode }) {
      const content = <Suspense fallback={null}>{children}</Suspense>
      return client ? (
        <DbProvider client={client}>{content}</DbProvider>
      ) : (
        content
      )
    }
    const outputs = new Set<Pick<Collection, `cleanup`>>()
    const mount = async (binding: 0 | 1) => {
      const declaration = history.declarations[binding]
      const value = values[declaration]
      const result = renderHook(
        () =>
          useLiveSuspenseQuery({
            query,
            queryKey:
              history.identity === `derived`
                ? undefined
                : [
                    `local-options`,
                    history.cell,
                    history.identity === `same-key` ? 0 : binding,
                  ],
            ...(declaration === `absent` ? {} : { [history.option]: value }),
          }),
        { wrapper: Wrapper },
      )
      // This authored query is a list. The builder's findOne action owns
      // result shape; this receiver judges local option identity only.
      await waitFor(() => expect(result.result.current.data).toHaveLength(1))
      const output = result.result.current.collection
      outputs.add(output)
      if (declaration !== `absent` && history.option !== `singleResult`)
        expect(output.config[history.option]).toBe(value)
      return output
    }
    await withOracleCleanup(async () => {
      await source.preload()
      const first = await mount(0)
      const firstOptions = { ...first.config }
      reach.reach(`first-output`)
      const second = await mount(1)
      reach.reach(`second-output`)
      checkLocalOptionSharing(first, second, history)
      expect(first.config).toEqual(firstOptions)
      reach.reach(`retained-first`)
      reach.assertReached()
    }, [
      () => cleanup(),
      () =>
        withOracleCleanup(
          () => {},
          [...outputs].map(
            (output) => () => output.cleanup({ dependents: true }),
          ),
        ),
      () => client?.cleanup(),
      () => source.cleanup({ dependents: true }),
    ])
  },
)
