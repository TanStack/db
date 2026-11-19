/**
 * React receiving driver for the core Effect metadata owner's callback law.
 * The shared oracle authors source versions, callback changes and comparisons.
 * Real renderHook/act commits supply the hook's callback-replacement premise.
 * Observation cuts follow act and one host turn. This covers eager sources,
 * not arbitrary host scheduling or other framework bindings.
 */
import { afterAll } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { Query, createCollection } from '@tanstack/db'
import { useLiveQueryEffect } from '../src/useLiveQueryEffect'
import {
  callbackHistories,
  callbackReach,
  runCallbackHistory,
} from '../../db/tests/query/effect-callback-oracle'
import { checkWithCleanup } from '../../db/tests/query/virtual-row-fields-support'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { flushPromises, mockSyncCollectionOptions } from '../../db/tests/utils'
import type {
  CallbackHistory,
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
async function runReactCallbackHistory(
  history: CallbackHistory,
): Promise<void> {
  ran = true
  await runCallbackHistory(
    history,
    {
      mount: async ({ skipInitial, ordered, project, handlers }) => {
        const source = createCollection(
          mockSyncCollectionOptions<CallbackRow>({
            id: `callback-react`,
            getKey: (row) => row.id,
            initialData: [{ id: 1, version: 0 }],
          }),
        )
        await source.preload()
        const rows = new Query().from({ row: source })
        const query = (
          ordered ? rows.orderBy(({ row }) => row.id).limit(10) : rows
        ).fn.select(({ row }) => project(row))
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
}

const CALLBACK_LAW = `React Effect callback values`

oracleProperty({
  id: `react.effect-callback`,
  law: {
    statement: `useLiveQueryEffect callbacks receive the current Effect values that the shared callback model owes across callback profiles and handler replacement.`,
    authority: `The core Effect metadata owner's callback law in effect-callback-oracle.ts.`,
    limits: `The shared bounded callback histories with eager sources; observation cuts follow act and one host turn, not arbitrary host scheduling or other framework bindings.`,
  },
  owns: [`src/useLiveQueryEffect.ts#useLiveQueryEffect`],
  histories: callbackHistories,
  label: (history) =>
    `receives current Effect values across callback profiles: ${JSON.stringify(history)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(CALLBACK_LAW, plan, observe, () =>
      runReactCallbackHistory(plan.history),
    ),
  check: forwardAssertionJudgment,
})
