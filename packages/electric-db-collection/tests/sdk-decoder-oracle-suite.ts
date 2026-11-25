/** One Electric-owned decoder judgment receives Node and Chromium paths. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  decoderHistoryArb,
  decoderModel,
  decoderState,
  decoderViolations,
} from './sdk-decoder-oracle'
import type { DecoderHistory, DecoderObservation } from './sdk-decoder-oracle'
import type { DecoderFault } from './sdk-decoder-driver'
import type { Observation } from '../../db/tests/oracle-property'

export function registerDecoder(
  property: string,
  receive: (
    h: DecoderHistory,
    id: string,
    fault?: DecoderFault,
  ) => Promise<DecoderObservation>,
) {
  const cells = ([`eager`, `on-demand`] as const).flatMap((mode) =>
    ([`initial`, `live`] as const).flatMap((phase) =>
      ([`valid`, `throw`] as const).map((outcome) => ({
        mode,
        phase,
        outcome,
      })),
    ),
  )
  const states = [
    ...cells.map(decoderState),
    `prefix-before-refusal`,
    `valid-transformed-key`,
  ]
  const required = new WeakMap<DecoderHistory, string>()
  const builders = states.map((state, index) => ({
    name: state,
    enters: [state],
    build: (h: DecoderHistory): DecoderHistory => {
      const cell =
        cells[index] ??
        (state === `prefix-before-refusal`
          ? { mode: h.mode, phase: h.phase, outcome: `throw` as const }
          : { mode: h.mode, phase: h.phase, outcome: `valid` as const })
      const result = {
        ...h,
        ...cell,
        ...(state === `prefix-before-refusal`
          ? { count: 4, refusalIndex: 3 }
          : {}),
      }
      required.set(result, state)
      return result
    },
  }))
  let sequence = 0
  oracleProperty({
    id: property,
    owns: [`src/electric.ts#electricCollectionOptions`],
    law: {
      statement: `A thrown field parser publishes no partial response. Eager give-up ends its run, while subset parse rejection remains request-owned. A valid next use succeeds with application keys selected after parsing.`,
      authority: `ShapeStreamOptions.parser/onError; docs/collections/electric-collection.md required getKey; glossary atomic publication, loading error, sync error and request error; sdk-decoder-oracle.ts.`,
      limits: `Eager and on-demand requestSnapshot, one initial/live response, 1–4 rows, one refusal and valid next use. No real Electric server, progressive fetchSnapshot, persistence, arbitrary retries or schema-validation contract.`,
    },
    histories: {
      arbitrary: decoderHistoryArb,
      states,
      constructed: builders,
      runs: 30,
      fixedSeeds: [2377],
    },
    model: decoderModel,
    driver: async (h, observe) => {
      const raw = await receive(h, `${property}-${sequence++}`)
      if (
        (h.outcome === `throw` && raw.refusalParsed) ||
        (h.outcome === `valid` && raw.attempt === `fulfilled`)
      )
        observe(`reach`, decoderState(h))
      if (h.outcome === `throw` && raw.refusalParsed && raw.prefixParsed)
        observe(`reach`, `prefix-before-refusal`)
      if (
        h.outcome === `valid` &&
        raw.transformedKeyParsed &&
        raw.attempt === `fulfilled`
      )
        observe(`reach`, `valid-transformed-key`)
      observe(`parser delivery`, raw)
    },
    check: (h, trace) => {
      const raw = trace.find((entry) => entry.checkpoint === `parser delivery`)
        ?.value as DecoderObservation | undefined
      if (!raw)
        return violation(
          `parser delivery`,
          `Missing installed SDK observation`,
          `Electric parser delivery`,
        )
      const errors = decoderViolations(h, raw)
      if (errors.length)
        return violation(
          `parser delivery`,
          errors.join(`; `),
          `Electric parser delivery`,
          { actual: raw, expected: decoderModel(h) },
        )
      if (raw.cleanupErrors?.length)
        return violation(
          `receiving cleanup`,
          raw.cleanupErrors.join(`; `),
          `receiving cleanup`,
        )
      const state = required.get(h)
      return state &&
        !trace.some(
          (entry) => entry.checkpoint === `reach` && entry.value === state,
        )
        ? violation(
            `reach`,
            `Missing generated construction ${state}`,
            `constructed parser reach`,
          )
        : pass
    },
    calibrations: [
      ...([`wrong-parser-value`, `missing-ready`] as const).map((fault) => ({
        name: `actual ${fault} reaches the semantic decoder comparison`,
        history: { constructed: `eager:initial:valid` },
        law: `Electric parser delivery`,
        difference: fault === `wrong-parser-value` ? `afterAttempt` : `status`,
        driver: async (
          h: DecoderHistory,
          observe: (checkpoint: string, value: unknown) => void,
        ) => {
          observe(
            `parser delivery`,
            await receive(h, `${property}-boundary-${sequence++}`, fault),
          )
        },
      })),
      ...[
        {
          name: `rejects retryable health for an eager parser give-up`,
          changes: { sourceError: false, sourceFailureReason: true },
        },
        {
          name: `rejects a different parser cause on source health`,
          changes: { sourceCauseMatches: false },
        },
        {
          name: `rejects parser health retained after valid next use`,
          changes: { nextSourceErrors: true },
        },
      ].map(({ name, changes }) => ({
        name,
        history: { constructed: `eager:live:throw` },
        law: `Electric parser delivery`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `parser delivery`
              ? entry
              : {
                  ...entry,
                  value: { ...(entry.value as DecoderObservation), ...changes },
                },
          ),
      })),
      ...([`cleanup-only`, `mismatch-and-cleanup`] as const).map((fault) => ({
        name: `actual ${fault} preserves completed decoder observations`,
        history: { constructed: `valid-transformed-key` },
        law:
          fault === `cleanup-only`
            ? `receiving cleanup`
            : `Electric parser delivery`,
        driver: async (
          h: DecoderHistory,
          observe: (checkpoint: string, value: unknown) => void,
        ) => {
          const raw = await receive(h, `${property}-fault-${sequence++}`, fault)
          observe(`parser delivery`, raw)
        },
      })),
      {
        name: `rejects an extra undefined application field`,
        history: { constructed: `valid-transformed-key` },
        law: `Electric parser delivery`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `parser delivery`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as DecoderObservation),
                    afterAttempt: (
                      entry.value as DecoderObservation
                    ).afterAttempt.map((row) => ({
                      ...row,
                      unexpectedApplicationField: undefined,
                    })),
                  },
                },
          ),
      },
      {
        name: `rejects an extra application field`,
        history: { constructed: `valid-transformed-key` },
        law: `Electric parser delivery`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `parser delivery`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as DecoderObservation),
                    afterAttempt: (
                      entry.value as DecoderObservation
                    ).afterAttempt.map((row) => ({
                      ...row,
                      unexpectedApplicationField: `leaked`,
                    })),
                  },
                },
          ),
      },
      {
        name: `rejects a published prefix before parser refusal`,
        history: { constructed: `prefix-before-refusal` },
        law: `Electric parser delivery`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `parser delivery`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as DecoderObservation),
                    publications: [[{ id: `partial`, value: -1 }]],
                  },
                },
          ),
      },
      ...builders.map((builder) => ({
        name: `rejects missing generated ${builder.name}`,
        history: { constructed: builder.name },
        law: `constructed parser reach`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.filter(
            (entry) =>
              entry.checkpoint !== `reach` || entry.value !== builder.name,
          ),
      })),
    ],
  })
}
