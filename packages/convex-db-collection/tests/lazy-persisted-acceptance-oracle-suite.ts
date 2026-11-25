/**
 * Same six-revision judgment as the controlled deferred-baseline owner, received
 * through actual SDK callbacks and storage. Public rows stay old while receipts
 * are held; accepted rows already include each predecessor before its successor.
 * Each host declares its own reach, so one environment cannot cover another.
 */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  assertDeferredBaselineRows,
  deferredBaselineGrammar,
  deferredBaselineRows,
} from './lazy-deferred-baseline-oracle'
import { LazyVersionModel } from './lazy-paging-version-model-oracle'
import { lazyOracleBaseRuns } from './lazy-paging-campaign'
import type { DeferredBaselineHistory } from './lazy-deferred-baseline-oracle'
import type { PersistedAcceptanceResult } from './lazy-persisted-acceptance-driver'
import type { Observation } from '../../db/tests/oracle-property'

const states = [
  `real SDK revisions consumed`,
  `accepted predecessor before next callback`,
  `actual SQLite acceptance before application`,
]

export function registerPersistedAcceptance(
  property: string,
  receive: (
    history: DeferredBaselineHistory,
    id: string,
  ) => Promise<PersistedAcceptanceResult>,
  options: { owns: ReadonlyArray<string>; path: string },
) {
  let sequence = 0
  oracleProperty({
    id: property,
    owns: options.owns,
    law: {
      statement: `After durable acceptance and before application, each complete acquired-source revision remains the keyed baseline for its successor, and the eventual publication belongs to one authored source revision.`,
      authority: `SyncAppliedReceipt, whenSyncAccepted, glossary accepted/deferred sync transaction and Convex complete acquired range contract.`,
      limits: `${options.path}. Whole acquired source, six successful revisions, one optimistic hold; no failed acceptance, finite-prefix deletion authority, persistence reopen or commit reentry claim. Relation values ignore Collection iteration order.`,
    },
    histories: {
      arbitrary: deferredBaselineGrammar.filter(
        (history) => history.acceptance === `before-next-callback`,
      ),
      runs: lazyOracleBaseRuns(12),
      fixedSeeds: [20261124],
      states,
      constructed: [
        {
          name: `durable accepted predecessor before next callback`,
          enters: states,
          build: (history) => ({ ...history }),
        },
      ],
    },
    model: deferredBaselineRows,
    driver: async (history, observe) => {
      const result = await receive(history, `${property}-${sequence++}`)
      for (const state of result.reached) observe(`reach`, state)
      observe(`result`, result)
    },
    check: (history, trace, expected) => {
      const result = trace.find(
        (observation) => observation.checkpoint === `result`,
      )?.value as PersistedAcceptanceResult | undefined
      if (!result)
        return violation(
          `receiving premise`,
          `Missing acceptance record`,
          `accepted baseline`,
        )
      try {
        if (result.cuts.length !== expected.revisions.length)
          throw new Error(
            `Expected ${expected.revisions.length} accepted cuts, got ${result.cuts.length}`,
          )
        for (const [index, cut] of result.cuts.entries()) {
          if (!cut.receiptPending)
            throw new Error(`Applied receipt settled before held cut ${index}`)
          assertDeferredBaselineRows(
            cut.publicRows,
            expected.original,
            history,
            `public rows before application ${index}`,
          )
          assertDeferredBaselineRows(
            cut.accepted,
            expected.revisions[index]!,
            history,
            `accepted predecessor ${index}`,
          )
          assertDeferredBaselineRows(
            cut.durable,
            expected.revisions[index]!,
            history,
            `durable predecessor ${index}`,
          )
        }
        const versions = new LazyVersionModel()
        versions.offer(expected.original)
        for (const rows of expected.revisions) versions.offer(rows)
        if (!result.publications.length)
          throw new Error(`No applied publication observed`)
        for (const publication of result.publications)
          versions.observe(publication)
        assertDeferredBaselineRows(
          result.finalRows,
          expected.revisions.at(-1)!,
          history,
          `final applied rows`,
        )
        if (result.syncError !== undefined)
          throw new Error(`Legal revisions reported ${result.syncError}`)
        if (result.cleanupErrors.length || result.browserErrors?.length)
          throw new Error(
            `Receiving cleanup/browser failure: ${[...result.cleanupErrors, ...(result.browserErrors ?? [])].join(`; `)}`,
          )
        const reached = new Set(
          trace
            .filter((item) => item.checkpoint === `reach`)
            .map((item) => item.value),
        )
        if (states.some((state) => !reached.has(state)))
          throw new Error(`Missing generated acceptance reach`)
        return pass
      } catch (error) {
        return violation(
          `accepted predecessor before next callback`,
          error instanceof Error ? error.message : String(error),
          `accepted baseline`,
        )
      }
    },
    timeout: 60000,
    calibrations: [
      {
        name: `rejects omitted generated acceptance reach`,
        history: {
          constructed: `durable accepted predecessor before next callback`,
        },
        law: `accepted baseline`,
        difference: `Missing generated acceptance reach`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.filter((item) => item.checkpoint !== `reach`),
      },
      {
        name: `rejects a deleted predecessor retained by the baseline`,
        history: {
          constructed: `durable accepted predecessor before next callback`,
        },
        law: `accepted baseline`,
        difference: `accepted predecessor 2`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) => {
            if (item.checkpoint !== `result`) return item
            const result = item.value as PersistedAcceptanceResult
            const added = result.cuts[1]!.accepted.find(
              (row) => row.id === `added`,
            )
            if (!added)
              throw new Error(
                `Deletion calibration requires its accepted predecessor`,
              )
            return {
              ...item,
              value: {
                ...result,
                cuts: result.cuts.map((cut, index) =>
                  index === 2
                    ? { ...cut, accepted: [...cut.accepted, added] }
                    : cut,
                ),
              },
            }
          }),
      },
      {
        name: `rejects an accepted baseline that omits the inserted predecessor`,
        history: {
          constructed: `durable accepted predecessor before next callback`,
        },
        law: `accepted baseline`,
        difference: `accepted predecessor 0`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as PersistedAcceptanceResult),
                    cuts: (item.value as PersistedAcceptanceResult).cuts.map(
                      (cut, index) =>
                        index
                          ? cut
                          : {
                              ...cut,
                              accepted: cut.accepted.filter(
                                (row) => row.id !== `added`,
                              ),
                            },
                    ),
                  },
                },
          ),
      },
    ],
  })
}
