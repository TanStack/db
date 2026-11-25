/**
 * Chromium registration receives the existing installed-SDK snapshot owner's
 * grammar, independent Map/health model and original comparisons. This module
 * only transports its result and enforces its generated construction ledger.
 */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  constructSnapshotHistory,
  snapshotConstructionStates,
  snapshotHistoryArbitrary,
  snapshotStates,
} from './sdk-snapshot-delivery-oracle'
import type {
  SDKSnapshotResult,
  SnapshotHistory,
} from './sdk-snapshot-delivery-oracle'
import type { Observation } from '../../db/tests/oracle-property'

export function registerSnapshotReceiving(
  property: string,
  receive: (
    h: SnapshotHistory,
    dropRows?: boolean,
    fault?: `cleanup-only` | `mismatch-and-cleanup`,
  ) => Promise<SDKSnapshotResult>,
) {
  const drive =
    (dropRows = false, fault?: `cleanup-only` | `mismatch-and-cleanup`) =>
    async (
      history: SnapshotHistory,
      observe: (checkpoint: string, value: unknown) => void,
    ) => {
      const result = await receive(history, dropRows, fault)
      for (const state of result.reached) observe(`reach`, state)
      observe(`completed`, result)
    }
  oracleProperty({
    id: property,
    owns: [`src/electric.ts#electricCollectionOptions`],
    law: {
      statement: `Installed-SDK snapshot deliveries agree with the independent overlapping source, request/source health distinction and retired evidence readiness at every original snapshot checkpoint.`,
      authority: `sdk-snapshot-delivery-oracle.ts; existing electric.sdk-snapshot-delivery contract and dated health/evidence decisions.`,
      limits: `The unchanged width2..4, three ordered overlapping predicates, subset retry/live pause/outage/restart grammar; real Chromium with installed ShapeStream and controlled HTTP. No live Electric service, progressive fetchSnapshot or native persistence.`,
    },
    histories: {
      arbitrary: snapshotHistoryArbitrary,
      states: snapshotStates,
      constructed: [
        {
          name: `subset retries, live pauses, throw-led and throw-crossed outage, restart`,
          enters: snapshotStates,
          build: constructSnapshotHistory,
        },
      ],
      runs: 40,
      fixedSeeds: [20260917],
    },
    model: (history) => snapshotConstructionStates.get(history) ?? [],
    driver: drive(),
    check: (_history, trace, required: ReadonlyArray<string>) => {
      const raw = trace.find((entry) => entry.checkpoint === `completed`)
        ?.value as SDKSnapshotResult | undefined
      if (!raw)
        return violation(
          `completed`,
          `Missing shared snapshot judgment`,
          `snapshot delivery`,
        )
      if (raw.failure)
        return violation(
          raw.failure.checkpoint,
          `Shared installed-SDK snapshot comparison rejected ${raw.failure.checkpoint}${raw.cleanupErrors.length ? `; secondary cleanup: ${raw.cleanupErrors.join(`; `)}` : ``}`,
          `snapshot delivery`,
          raw.failure,
        )
      const missing = required.filter(
        (state) =>
          !trace.some(
            (entry) => entry.checkpoint === `reach` && entry.value === state,
          ),
      )
      if (missing.length)
        return violation(
          `constructed states`,
          `Missing generated ${missing.join(`; `)}`,
          `constructed reach`,
        )
      if (raw.cleanupErrors.length)
        return violation(
          `receiving cleanup`,
          raw.cleanupErrors.join(`; `),
          `receiving cleanup`,
        )
      if (raw.browserErrors?.length)
        return violation(
          `browser`,
          raw.browserErrors.join(`; `),
          `receiving errors`,
        )
      return pass
    },
    calibrations: [
      {
        name: `shared comparison rejects dropped SDK snapshot rows`,
        law: `snapshot delivery`,
        difference: `snapshot 0 applied rows`,
        driver: drive(true),
      },
      ...([`cleanup-only`, `mismatch-and-cleanup`] as const).map((fault) => ({
        name: `actual ${fault} preserves original snapshot judgment`,
        law:
          fault === `cleanup-only` ? `receiving cleanup` : `snapshot delivery`,
        difference:
          fault === `cleanup-only`
            ? `injected snapshot receiving cleanup failure`
            : `snapshot 0 applied rows`,
        driver: drive(false, fault),
      })),
      ...snapshotStates.map((state) => ({
        name: `omits constructed ${state}`,
        law: `constructed reach`,
        corrupt: (
          trace: ReadonlyArray<Observation>,
          history: SnapshotHistory,
        ) =>
          snapshotConstructionStates.has(history)
            ? trace.filter(
                (entry) =>
                  entry.checkpoint !== `reach` || entry.value !== state,
              )
            : undefined,
      })),
    ],
    timeout: 120_000,
  })
}
