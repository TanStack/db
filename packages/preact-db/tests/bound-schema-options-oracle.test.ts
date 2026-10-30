/**
 * Preact receives the shared schema-mutation law through its real live hook.
 * Its commit-time render probe and native act supply the host observation cut.
 * The common driver preserves the synchronous Collection return observation.
 * This is a controlled Collection witness, without provider/SSR claims.
 */
import { act } from 'preact/test-utils'
import { afterAll, test } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  boundSchemaHistories,
  boundSchemaReachStates,
  checkBoundSchemaMutation,
} from '../../db/tests/live-query-bound-options-oracle'
import { runBoundSchemaHistory } from '../../db/tests/live-query-bound-options-support'
import { renderHook, settle } from './render-probe'
import type { BoundSchemaNativeHost } from '../../db/tests/live-query-bound-options-support'

const reach = createOracleReach(`Preact schema binding`, boundSchemaReachStates)
let ran = false
afterAll(() => {
  if (!ran) return
  reach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `Preact schema binding reach`,
      Object.fromEntries(reach.counts()),
    )
})
test.each(boundSchemaHistories)(
  `Preact binds mutation schemas %j`,
  async (history) => {
    ran = true
    const host: BoundSchemaNativeHost = {
      mount: (input) => {
        const mounted = renderHook(
          (props: { revision: number; proposed: boolean }) =>
            useLiveQuery(input(props)),
          { initialProps: { revision: 0, proposed: false } },
        )
        return {
          current: () => mounted.result.current,
          rerender: mounted.rerender,
          flush: async (action) => {
            act(() => {
              action?.()
            })
            await settle()
          },
          unmount: mounted.unmount,
        }
      },
    }
    await runBoundSchemaHistory(history, host, reach)
  },
)
declareOracle({
  grammar: [boundSchemaHistories],
  check: [checkBoundSchemaMutation],
})
