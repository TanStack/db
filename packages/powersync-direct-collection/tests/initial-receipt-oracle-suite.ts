/** Shared registration keeps each receipt host on one grammar and judgment. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  initialReceiptHistoryArb,
  initialReceiptModel,
  initialReceiptReached,
  initialReceiptStates,
  initialReceiptViolations,
} from './initial-receipt-oracle'
import type { Observation } from '../../db/tests/oracle-property'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from './initial-receipt-oracle'

export function registerInitialReceiptConformance(
  property: string,
  receive: (
    history: InitialReceiptHistory,
  ) => Promise<InitialReceiptObservation>,
  {
    owns,
    limits,
    heldReceiptOutcome = `rejected`,
    receiveFault,
    receiveFaultDifferences,
    receiveFaultLabel = `actual post-record worker failure`,
  }: {
    owns: ReadonlyArray<string>
    limits: string
    heldReceiptOutcome?: `rejected` | `applied`
    receiveFault?: (
      history: InitialReceiptHistory,
      mode: `cleanup-only` | `mismatch-and-cleanup`,
    ) => Promise<InitialReceiptObservation>
    receiveFaultDifferences?: {
      cleanupOnly?: string
      mismatchAndCleanup?: string
    }
    receiveFaultLabel?: string
  },
) {
  const required = new WeakMap<InitialReceiptHistory, string>()
  const builders = initialReceiptStates.map((state) => ({
    name: `generated ${state}`,
    enters: [state],
    build: (generated: InitialReceiptHistory): InitialReceiptHistory => {
      const history = {
        ...generated,
        ...(state === `held-receipt` || state === `after-application`
          ? { cleanupAt: state }
          : {}),
        ...(state === `empty-source` ? { rows: 0 } : {}),
        ...(state === `nonempty-source`
          ? { rows: generated.rows || (generated.reason % 7) + 1 }
          : {}),
      }
      required.set(history, state)
      return history
    },
  }))
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `Cleanup invalidates an eager sync run while its initial receipt is held or after it applied, leaves an empty cleaned-up public snapshot, and handles every rejected receipt continuation without detached errors.`,
      authority: `Collection commit/cleanup API and glossary cleanup/applied receipt; collection-subscription lifecycle and optimistic-history oracle contracts.`,
      limits,
    },
    histories: {
      arbitrary: initialReceiptHistoryArb,
      states: initialReceiptStates,
      constructed: builders,
      runs: 12,
      fixedSeeds: [2377],
      fixed: [
        {
          name: `cleanup with held initial receipt`,
          history: { rows: 1, cleanupAt: `held-receipt`, reason: 1 },
        },
        {
          name: `cleanup after initial application`,
          history: { rows: 0, cleanupAt: `after-application`, reason: 0 },
        },
      ],
    },
    model: (history) => initialReceiptModel(history, heldReceiptOutcome),
    driver: async (history, observe) => {
      const raw = await receive(history)
      for (const state of initialReceiptReached(history, raw))
        observe(`reach`, state)
      observe(`after cleanup`, raw)
    },
    check: (history, trace, expected) => {
      const raw = trace.find((item) => item.checkpoint === `after cleanup`)
        ?.value as InitialReceiptObservation | undefined
      if (!raw)
        return violation(
          `after cleanup`,
          `Missing native cleanup observation`,
          `initial receipt cleanup`,
        )
      const failures = initialReceiptViolations(history, raw, expected)
      if (failures.length)
        return violation(
          `after cleanup`,
          failures.join(`; `),
          `initial receipt cleanup`,
          { actual: raw, expected },
        )
      // A completed product cut remains the primary judgment. Late receiving
      // teardown diagnostics stay in its raw detail; alone they have their own
      // law and checkpoint instead of becoming an apparent product failure.
      if (raw.cleanupErrors?.length)
        return violation(
          `receiving cleanup`,
          raw.cleanupErrors.join(`; `),
          `receiving cleanup`,
          { actual: raw, expected },
        )
      const state = required.get(history)
      if (
        state &&
        !trace.some(
          (item) => item.checkpoint === `reach` && item.value === state,
        )
      )
        return violation(
          `reach`,
          `Missing generated state ${state}`,
          `constructed builder reach`,
        )
      return pass
    },
    calibrations: [
      ...(receiveFault
        ? ([`cleanup-only`, `mismatch-and-cleanup`] as const).map((mode) => ({
            name: `${receiveFaultLabel} ${mode}`,
            history: { fixed: `cleanup after initial application` },
            law:
              mode === `cleanup-only`
                ? `receiving cleanup`
                : `initial receipt cleanup`,
            difference:
              mode === `cleanup-only`
                ? (receiveFaultDifferences?.cleanupOnly ??
                  `Receipt worker exited after observation`)
                : (receiveFaultDifferences?.mismatchAndCleanup ??
                  `detachedErrors`),
            driver: async (
              history: InitialReceiptHistory,
              observe: (checkpoint: string, value: unknown) => void,
            ) => {
              const raw = await receiveFault(history, mode)
              for (const state of initialReceiptReached(history, raw))
                observe(`reach`, state)
              observe(`after cleanup`, raw)
            },
          }))
        : []),
      {
        name: `completed receipt observation retains cleanup diagnostics`,
        history: { fixed: `cleanup after initial application` },
        law: `receiving cleanup`,
        difference: `injected receiving teardown failure`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint === `after cleanup`
              ? {
                  ...item,
                  value: {
                    ...(item.value as InitialReceiptObservation),
                    cleanupErrors: [`injected receiving teardown failure`],
                  },
                }
              : item,
          ),
      },
      {
        name: `receipt mismatch survives secondary receiving cleanup failure`,
        history: { fixed: `cleanup after initial application` },
        law: `initial receipt cleanup`,
        difference: `detachedErrors`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint === `after cleanup`
              ? {
                  ...item,
                  value: {
                    ...(item.value as InitialReceiptObservation),
                    detachedErrors: [`injected detached receipt rejection`],
                    cleanupErrors: [`secondary receiving teardown failure`],
                  },
                }
              : item,
          ),
      },
      {
        name: `detached receipt rejection`,
        history: { fixed: `cleanup after initial application` },
        law: `initial receipt cleanup`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint === `after cleanup`
              ? {
                  ...item,
                  value: {
                    ...(item.value as InitialReceiptObservation),
                    detachedErrors: [`unhandled source receipt`],
                  },
                }
              : item,
          ),
      },
      ...initialReceiptStates.map((state) => ({
        name: `missing generated cleanup state ${state}`,
        history: { constructed: `generated ${state}` },
        law: `constructed builder reach`,
        corrupt: (
          trace: ReadonlyArray<Observation>,
          history: InitialReceiptHistory,
        ) =>
          required.get(history) === state
            ? trace.filter(
                (item) =>
                  !(item.checkpoint === `reach` && item.value === state),
              )
            : undefined,
      })),
    ],
    timeout: 120_000,
  })
}
