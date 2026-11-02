/**
 * React receiving driver for the core Effect metadata owner's callback law.
 * The shared oracle authors source versions, callback changes and comparisons.
 * Real renderHook/act commits supply the hook's callback-replacement premise.
 * Observation cuts follow act and one host turn. This covers eager sources,
 * not arbitrary host scheduling or other framework bindings.
 */
import { afterAll, test } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { Query, createCollection } from '@tanstack/db'
import { useLiveQueryEffect } from '../src/useLiveQueryEffect'
import {
  callbackHistories,
  callbackReach,
  runCallbackHistory,
} from '../../db/tests/query/effect-callback-oracle'
import { checkWithCleanup } from '../../db/tests/query/virtual-row-fields-support'
import { flushPromises, mockSyncCollectionOptions } from '../../db/tests/utils'
import type {
  CallbackOutput,
  CallbackRow,
} from '../../db/tests/query/effect-callback-oracle'
import type { EffectConfig } from '@tanstack/db'

const reach = callbackReach(`React`)
let ran = false
afterAll(() => {
  if (ran) reach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `Effect React callback reach`,
      Object.fromEntries(reach.counts()),
    )
})
test.each(callbackHistories)(
  `receives current Effect values across callback profiles: %j`,
  async (history) => {
    ran = true
    await runCallbackHistory(
      history,
      {
        mount: async ({ skipInitial, project, handlers }) => {
          const source = createCollection(
            mockSyncCollectionOptions<CallbackRow>({
              id: `callback-react`,
              getKey: (row) => row.id,
              initialData: [{ id: 1, version: 0 }],
            }),
          )
          await source.preload()
          const query = new Query()
            .from({ row: source })
            .fn.select(({ row }) => project(row))
          const mounted = renderHook(
            ({ config }: { config: EffectConfig<CallbackOutput> }) =>
              useLiveQueryEffect(config),
            { initialProps: { config: { query, skipInitial, ...handlers } } },
          )
          await act(async () => {
            await flushPromises()
          })
          return {
            write: async (type, version) => {
              await act(async () => {
                source.utils.begin()
                source.utils.write({ type, value: { id: 1, version } })
                source.utils.commit()
                await flushPromises()
              })
            },
            replaceHandlers: async (replacement) => {
              mounted.rerender({
                config: { query, skipInitial, ...replacement },
              })
              await act(async () => {
                await flushPromises()
              })
            },
            dispose: async () => {
              mounted.unmount()
              await act(async () => {
                await flushPromises()
              })
            },
            cleanup: () =>
              checkWithCleanup(async () => {
                mounted.unmount()
                await act(async () => {
                  await flushPromises()
                })
              }, [
                async () => {
                  await source.cleanup()
                },
              ]),
          }
        },
      },
      reach,
    )
  },
)
